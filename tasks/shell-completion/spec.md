# Spec: shell-completion — Shell completion for the canon CLI (bash, zsh, fish, tcsh)

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`canon` has no shell completion. Users have to type every subcommand, task subcommand, flag, phase name and task id in full, and fall back on `--help` or the README to recall flag spellings (`--allow-divergent-base`) and value sets (the seven phase names).

The design-of-record is the "Shell completion for the `canon` CLI" entry in `docs/BACKLOG.md`, under Tooling & Dev Experience. Two of its premises have changed since it was written.

1. **The declarations exist, but record flag names only.** `per-command-help` shipped an `ArgDeclaration` (`src/lib/cli-args.ts:1-9`) for each command, next to that command's parser:
   - `INIT_ARGS` in `src/cli/commands/init.ts`
   - `DOCTOR_ARGS` in `src/cli/commands/doctor.ts`
   - `RUN_ARGS` in `src/orchestrator/cli.ts`
   - `WATCH_ARGS` in `src/cli/commands/watch.ts`
   - `STOP_ARGS` in `src/cli/commands/stop.ts`
   - `UPDATE_ARGS` in `src/cli/commands/update.ts`
   - `UPGRADE_ARGS` in `src/cli/commands/upgrade.ts`
   - `TASK_ARGS` and `TASK_SUBCOMMAND_ARGS` in `src/task/index.ts`

   The declarations do not say what a positional slot holds (a task id, a phase, a field) or which values a value flag accepts. Several value sets also have no exported home:
   - task sizes are the module-private `TASK_SIZE_VALUES` (`src/task/index.ts:40`), duplicated by the module-private `SIZE_ORDER` (`src/lib/pipeline-policy.ts:121`);
   - accept phases are an inline literal chain in `taskAccept` (`src/task/index.ts:607`);
   - update channels are an inline `value !== 'main'` check in `parseUpdateArgs` (`src/cli/commands/update.ts:64`);
   - the field → value mapping for `task set` lives only in a `switch` (`src/task/index.ts:1494-1515`).

2. **The parser → declaration source scan is mostly moot.** Every command except `watch` runs `handlePreScan` before its own parser, so an undeclared flag is rejected before the parser sees it. `watch` calls `preScanArgs` for help only, and its unknown-flag rejection happens in `parseWatchArgs` (`src/cli/commands/watch.ts:701-712`). A flag that `parseWatchArgs` accepts but `WATCH_ARGS` lacks would therefore be accepted and never completed. That residual gap is accepted here and retires with the `util.parseArgs` follow-up.

   Declaration → parser consistency is already tested (`tests/cli-args.test.ts:48-77`). The new drift risk this task adds is completion versus declarations. The human chose to replace the source scan with the completion↔declaration and value-set tests (AC-6, AC-7).

**Task ids must resolve from any directory.** `canon task` resolves `tasks/` relative to the cwd, so it finds no tasks from a subdirectory. That is a separate bug, #122. The orchestrator resolves the main checkout's `tasks/` via `git rev-parse --git-common-dir` (`src/orchestrator/env.ts`), and completion follows the orchestrator.

## Decision

Add `canon completion <bash|zsh|fish|tcsh>`, which prints a static completion script to stdout. Users install it with one line in their shell rc file. `canon init` never touches rc files.

The script is generated, at the moment the command runs, from two sources:
- a side-effect-free command registry;
- the same `ArgDeclaration`s that drive `--help` and unknown-flag rejection.

Completion therefore cannot offer a command or flag that canon would reject. Value sets are context-aware wherever canon's validation is:
- verdicts are offered only after a review phase;
- `spec_gap` is offered only after `code_review`;
- a `task set` value depends on the field.

`ArgDeclaration` gains an optional `completion` field. It describes positional slots and value-flag values, drawing on value sets from exported constants. Each value set that is private today is exported, and the code that validates those values reads the same constant.

Tab completion never starts node. Task ids are read shell-side from the main checkout's `tasks/` directory.

## Non-Goals

- **Touching rc files or system completion directories.** `canon init`/`canon upgrade` do not write rc files. Canon does not ship static completion files in the npm package, and does not install into `~/.zfunc`, bash-completion directories, or fish's `completions/`. Installation is the manual one-liner (AC-2).
- **`npx canon …`.** Only the `canon` command is registered.
- **Migrating parsers to `util.parseArgs`.** This remains a BACKLOG follow-up (AC-13).
- **Fixing how `canon task` finds `tasks/`** (#122). This task changes no lookup in `canon task`, `doctor`, or the orchestrator. AC-4 bounds the new lookup to the generated scripts.
- **Dynamic completion** that calls `canon`/node per Tab (AC-5).
- **Completing git branch names** for `task new --base` and `task post-merge-sync`, or git refs for `update --ref`.
- **A parser source scan**, or closing the `watch` parser-only-flag gap.
- **Native Windows, PowerShell, `cmd.exe`.**
- **tcsh completion beyond commands, subcommands, and flags.** tcsh's `complete` builtin is positional-only.
- **Generating `printHelp` from the registry.** The help text stays hand-written. AC-3 tests that its command list matches the registry.

## Acceptance Criteria

- [ ] **AC-1 — Completion metadata on the declarations.**
  - `ArgDeclaration` gains an optional `completion` field that describes:
    - (a) the ordered positional slots, where any one slot may be variadic and fixed slots may follow it, as with `accept`'s `<TASK-ID...> <phase>`;
    - (b) the value kind of each value flag.
  - Value kinds include at least: task id, phase, phase status, review verdict (phase-dependent, see AC-3b), accept phase, settable field, field value (field-dependent), task size, update channel, shell, and none (free text or not completable).
  - These declarations carry metadata:
    - `RUN_ARGS`: variadic task ids; `--expect` → phase
    - `WATCH_ARGS`: task id; `--until` → phase
    - `STOP_ARGS`: task id
    - `UPDATE_ARGS`: `--channel` → update channel
    - `COMPLETION_ARGS`: shell
    - `TASK_SUBCOMMAND_ARGS` entries:
      - `status`, `reset-spec-review`, `reset-code-review`: task id
      - `phase`: task id, phase, phase status, review verdict
      - `accept`: variadic task ids, then accept phase
      - `set`: task id, settable field, field value
  - Value sets come from these exported constants:

    | Value set | Source |
    |---|---|
    | Phases | `PHASE_ORDER` |
    | Phase statuses | `VALID_STATUSES` |
    | Review verdicts | `VALID_VERDICTS` minus `sanctioned`; also minus `spec_gap` for `spec_review` |
    | Settable fields | `SETTABLE_FIELDS` |
    | Task sizes | `SIZE_ORDER`, newly exported |
    | Accept phases | a new exported constant |
    | `task set` field → value set | a new exported record |
    | Update channels | a new exported constant |
    | Shells | a new exported constant, also used by `canon completion`'s own argument check |
  - Verify by type-check, plus a unit test asserting each listed declaration's slots and flag kinds.

- [ ] **AC-1a — The inline value checks read the exported constants.** Each replacement is a replacement, not a duplicate:
  - `TASK_SIZE_VALUES` is deleted, and the `task_size` check reads `SIZE_ORDER`.
  - `taskAccept`'s `phaseArg !== 'implement' && … 'code_review'` chain is replaced by a check against the accept-phase constant.
  - `parseUpdateArgs`'s `value !== 'main'` comparison is replaced by a check against the channel constant.
  - The `task set` boolean and size cases read the field → value record, or AC-7 asserts that the record and the `switch` agree. The plan picks one.
  - Error text and exit codes stay byte-identical. Pinned at `tests/cli.test.ts:523-524` and `tests/task-cli.test.ts:1367`, and those tests pass unchanged.
  - Verify by grep. None of these strings may appear in `src/`:
    - `TASK_SIZE_VALUES`
    - `phaseArg !== 'implement'`
    - `value !== 'main'`

- [ ] **AC-2 — The `canon completion` command.**
  - `canon completion bash|zsh|fish|tcsh` writes the script to stdout and exits 0.
  - `canon completion --help`, or `-h` anywhere in argv, prints the usage and exits 0. The usage names all four shells and each shell's install line:
    - bash and zsh: `eval "$(canon completion <shell>)"` in the rc file. For zsh, the line goes after `compinit`.
    - fish: `canon completion fish | source` in `config.fish`.
    - tcsh: write the script to a file once, then `source` it from `~/.tcshrc`. A multi-line script does not survive tcsh's backtick `eval`.
  - These errors write a one-line error plus `Run 'canon completion --help' for usage.` to stderr and exit 1:
    - a missing shell;
    - an unknown shell;
    - a second positional;
    - an unknown flag.
  - The command works outside a git repo and outside a canon-initialized repo, and writes nothing to disk.
  - Output is deterministic: no version string, no absolute paths, no timestamps.
  - Verify with CLI tests run from an empty, non-git temp dir.

- [ ] **AC-3 — A side-effect-free command registry, matching the top-level help.**
  - A module with no import-time side effects exports the registry: each top-level command name with its declaration (`init doctor task run watch stop update upgrade completion`), plus the global flags `--help -h --version -v`. `src/cli/index.ts` imports it; the registry must not live in `src/cli/index.ts`, which dispatches on `process.argv` at import.
  - A test asserts that the `Commands:` block of `canon --help` lists exactly the registry's names, in both directions.
  - The existing "canon CLI help mentions watch" test in `tests/cli.test.ts` includes `completion` in its loop.

- [ ] **AC-3b — What each script completes.**
  - **bash, zsh and fish** complete:
    - (a) top-level commands and the registry's global flags;
    - (b) `task` subcommands;
    - (c) every flag in the current command's or subcommand's declaration, plus `--help`/`-h`;
    - (d) each positional slot and value-flag value per AC-1, with task ids per AC-4.
  - **Positional counting** mirrors `preScanArgs`: a value flag's argument and a `--flag=value` form for `equalsValueFlags` do not count as positionals.
  - **Context-dependent slots:**
    - `task phase <id> <phase> <status> ` offers review verdicts only when `<phase>` is `spec_review` or `code_review`, and offers `spec_gap` only for `code_review`. Otherwise it offers nothing.
    - `task set <id> <field> ` offers the field's value set from the record (`task_size` → sizes, boolean fields → `true false`). For any other field it offers nothing.
    - `task accept <id> ` offers task ids and accept phases. Any of the ids may be the last one before the phase.
  - **tcsh** completes (a), (b), and the flags in (c). Nothing more is required.

- [ ] **AC-4 — Task-id lookup.**
  - Candidates are the names of directories directly under `<main checkout>/tasks/`, where the main checkout is the parent of `git rev-parse --path-format=absolute --git-common-dir`.
  - Entries whose names start with `_` or `.`, and non-directories, are skipped.
  - The same candidates come back from the repo root, a subdirectory, and a linked worktree of that repo.
  - Outside a git repo, or with no `tasks/`, there are no candidates and nothing is written to the terminal.
  - Verified in the AC-9 smoke tests against a temp-dir fixture repo containing:
    - tasks `alpha` and `beta`;
    - `_archive/`, `.hidden/`, and a plain file under `tasks/`;
    - a subdirectory;
    - a linked worktree.
  - The linked-worktree sub-case alone may skip, with a reason, when the fixture's git dir is not writable. Use a local probe modelled on `gitDirWritable` in `tests/run-task-safety.test.ts:3544`.

- [ ] **AC-5 — No node per Tab.**
  - No generated script invokes `canon`, `node` or `npx`.
  - Verify with a test asserting that none of the four scripts matches `/\b(node|npx)\b|\$\(\s*canon\b|`\s*canon\b/`.
  - Install-line text appears only in the usage output. The zsh hint in AC-9 must not contain it.

- [ ] **AC-6 — Completion ↔ declaration consistency, both directions.** The generator builds one intermediate model from the registry and the declarations. Each shell renderer renders only from that model.
  - **(a) Renderer coverage.** For each shell, every model token in that shell's scope (per AC-3b) appears in the rendered script. Tokens are the commands, `task` subcommands, and flags.
    - The test runs on the real model.
    - It also runs on a synthetic model with one extra entry in every category: a boolean flag, a value flag, an equals-value flag, and a `task` subcommand.
    - A renderer that drops a category fails.
  - **(b) Model ⊆ declarations.** Every command, subcommand and flag in the model comes from the registry or a declaration.
    - Every `--long` token in each rendered script is either a model flag or on that shell renderer's explicit allowlist of shell-syntax tokens. Example: fish's `complete --no-files`.
    - A flag literal hand-added to a renderer fails.
  - The handoff records each direction being shown to fail: a renderer that skips `valueFlags` fails (a), and a hand-added flag fails (b).
  - Stale scripts after a declaration change are AC-8's job (goldens), not this AC's.

- [ ] **AC-7 — Value sets are accepted by the real validation.** For each value set, every value passes the command's own check:
  - every `--until` value passes `parseWatchArgs`;
  - every phase, every status, and every offered verdict for each review phase passes `canon task phase` validation (`assertValidPhase`/`assertValidStatus`/`assertValidVerdict`, exported for the test);
  - every accept phase passes `taskAccept`'s phase check;
  - every `--channel` value passes `parseUpdateArgs`;
  - every shell value produces a script.
  - **`task set`:** each value in the field → value record is accepted by `canon task set`. The fixture is a fresh task created with `CANON_TASKS_DIR_OVERRIDE` in a temp dir, with no branch recorded and `delicate` false. Set `human_spec_gate` before `delicate`. Every `SETTABLE_FIELDS` entry is either in the record or explicitly listed as free text.
  - `--expect` values are `PHASE_ORDER`. The run parser stores any string, and the phase is checked at runtime, so no parse check is required.

- [ ] **AC-8 — Golden output.** Each shell's script is pinned in `tests/completion.golden.json` and refreshed with `UPDATE_GOLDENS=1`, following `tests/run-task-prompts.test.ts`. Fixtures use neutral ids and no private adopter names.

- [ ] **AC-9 — Syntax checks and smoke tests.**
  - **Parse-only checks:** `bash -n`, `zsh -n`, `fish --no-execute`, and `tcsh -f -n` all pass.
    - `tcsh -f -n` does not catch an unterminated `if`. That gap is accepted.
    - A check skips with a reason when its shell is absent. When `process.env.CI` is set, an absent shell fails instead of skipping.
  - **bash and zsh smoke tests** load the script in a non-interactive shell inside the AC-4 fixture, then request candidates:

    | Input | Expected candidates |
    |---|---|
    | `canon ta` | includes `task` |
    | `canon run --` | includes `--pr` and `--allow-divergent-base` |
    | `canon run ` | exactly `alpha beta` |
    | `canon watch --until plan ` | `alpha beta` |
    | `canon task phase alpha ` | the seven phases |
    | `canon task phase alpha spec ` | the statuses |
    | `canon task phase alpha code_review done ` | includes `spec_gap` |
    | `canon task phase alpha spec_review done ` | excludes `spec_gap` |
    | `canon task phase alpha plan done ` | nothing |
    | `canon task accept alpha --reason x ` | includes `beta` and `implement` |
    | `canon task set alpha task_size ` | `XS S M L XL` |
    | `canon completion ` | the four shells |
  - **bash 3.2.** The bash script must run under bash 3.2, so no bash-4-only features. Where `/bin/bash` is 3.x, the bash smoke test also runs under it.
  - **zsh without `compdef`.** When `compdef` is undefined, the zsh script returns without error and writes exactly one stderr line: `canon completion: compdef not found; load compinit before this line`. A smoke test covers this.

- [ ] **AC-10 — CI installs the shells.** `.github/workflows/ci.yml` installs `zsh fish tcsh` via apt before the test step.

- [ ] **AC-11 — Adopter-safe output.** The usage text and the generated scripts, including their comments, name no canon-ai source paths. Verify with a test asserting that none of them matches `/\bsrc\/|\btests\/|BACKLOG/`.

- [ ] **AC-12 — Declaration tests cover `COMPLETION_ARGS`.** The declaration list in `tests/cli-args.test.ts:49` includes `COMPLETION_ARGS`, or is derived from the registry. Its usage-mentions-every-flag check then runs on it.

- [ ] **AC-13 — Docs.**
  - **README:** a `### Shell completion` subsection directly after `### Install`, with the four install lines; and a `canon completion <shell>` row in Key commands.
  - **`docs/product-context.md`:** the command list includes `completion`.
  - **`docs/codebase-map.md`:** rows for the command file, the registry module, and the new test file.
  - **`docs/architecture.md`:** the CI step lists at :32 and :157 include the shell install step.
  - **`docs/BACKLOG.md`:** the shell-completion entry is replaced by the `util.parseArgs` follow-up alone, naming the `completion` metadata as part of the shared source.
  - `npm run docs-refs-check` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/cli-args.ts` | Optional `completion` field and value-kind types on `ArgDeclaration` |
| `src/lib/pipeline-policy.ts` | Export `SIZE_ORDER` |
| `src/cli/registry.ts` | New. Side-effect-free command registry and global flags (the plan may choose another side-effect-free path; update this row if so) |
| `src/cli/commands/completion.ts` | New. `COMPLETION_USAGE`, `COMPLETION_ARGS`, shell constant, `completionCmd`, model builder, four renderers |
| `src/cli/index.ts` | Import the registry; `case 'completion'`; a `completion` line in `printHelp` |
| `src/orchestrator/cli.ts` | `completion` metadata on `RUN_ARGS` |
| `src/cli/commands/watch.ts` | `completion` metadata on `WATCH_ARGS` |
| `src/cli/commands/stop.ts` | `completion` metadata on `STOP_ARGS` |
| `src/cli/commands/update.ts` | Exported channel constant used by `parseUpdateArgs`; metadata on `UPDATE_ARGS` |
| `src/task/index.ts` | Accept-phase constant and field → value record exported; `TASK_SIZE_VALUES` replaced by `SIZE_ORDER`; `assertValidPhase`/`assertValidStatus`/`assertValidVerdict` exported; metadata on `TASK_SUBCOMMAND_ARGS` entries |
| `tests/completion.test.ts` | New. AC-1, AC-2, AC-3b, and AC-4 through AC-9; AC-11 |
| `tests/completion.golden.json` | New. Per-shell goldens |
| `tests/cli.test.ts` | `completion` in the top-level help loop; help ↔ registry check (AC-3) |
| `tests/cli-args.test.ts` | `COMPLETION_ARGS` in the declaration list (AC-12) |
| `tests/recovery-hints.test.ts` | Update pinned `HINT_SITES` snippets if the quoted `RUN_ARGS`/`TASK_SUBCOMMAND_ARGS` lines change. The snippets run to end of line, so inline metadata on those lines breaks them; putting the metadata on separate lines avoids the edit |
| `.github/workflows/ci.yml` | apt install `zsh fish tcsh` before tests |
| `README.md` | `### Shell completion` subsection; Key commands row |
| `docs/product-context.md` | Command list includes `completion` |
| `docs/codebase-map.md` | Rows for the command, registry, and test files |
| `docs/architecture.md` | CI step lists (:32, :157) include the shell install |
| `docs/BACKLOG.md` | Replace the shell-completion entry with the `util.parseArgs` follow-up |
| `dist/cli/index.js` | Rebuilt |
| `dist/orchestrator/run-task.js` | Rebuilt (`src/orchestrator/cli.ts`, `src/task/index.ts` and `src/lib/pipeline-policy.ts` bundle into it) |

### Interaction Dependencies

- **`handlePreScan` / `preScanArgs`.** Unchanged; they ignore `completion`. `COMPLETION_ARGS` needs `rejectPositionals: true` with `freeTextSlots: [0]`, following the `TASK_SUBCOMMAND_ARGS.set` precedent. Without `freeTextSlots: [0]`, `canon completion bash` would be rejected as an unexpected argument.
- **`tests/recovery-hints.test.ts`.** It scans every `src/` line for `--reroute|reset-code-review|reset-spec-review|canon task accept`. The generator reads those tokens from the declarations and never authors them.
- **`tests/cli-args.test.ts`.** It pins the nine `TASK_SUBCOMMAND_ARGS` keys. This task adds none.
- **CI dist-diff.** The rebuilt `dist/` ships in the same change.

### Data Model Changes

None to persisted state. `ArgDeclaration` gains an optional in-memory field.

### Implementation Notes (non-binding; owned by plan/implement)

- **Task-id lookup (bash/zsh):** `root=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null)`, then `dirname`, then glob `"$root"/tasks/*/` and filter on the basename's first character. In fish, use `string` rather than `path` to stay compatible with fish 3.0.
- **Smoke-test helpers.** Driving zsh's compsys non-interactively is awkward. The zsh script may expose a helper that produces candidates, called by `_canon`, and the smoke test may call that helper directly. For bash, the test can set `COMP_WORDS`/`COMP_CWORD` and call the completion function.
- **bash 3.2.** Avoid `declare -A`, `mapfile`/`readarray`, `${var,,}`, `compopt`, and `[[ -v ]]`.
- **Shell-absence check:** `isAvailable` in `src/cli/deps.ts` is an existing `which` helper the test can mirror.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (full suite)
- [x] `npm run build` (both `dist/` artifacts change)
- [x] `npm run docs-refs-check` (README and `docs/` edits)
- [ ] E2E: N/A, no UI surface

## Docs Impact

`docs/architecture.md`, `docs/codebase-map.md` and `docs/product-context.md` are edited, and are listed in Affected Files. `docs/pipeline-orchestrator.md` has no top-level command table and needs no change.

## Known Risks

- **bash 3.2 on macOS.** CI's bash 5 won't catch bash-4-only constructs. AC-9 runs the smoke test under `/bin/bash` locally when it is 3.x, and code review should read the script with the avoid-list in mind.
- **Context-dependent slots.** Verdict-after-phase, value-after-field, and variadic-then-fixed (`accept`) are where renderers most likely diverge from canon's validation. AC-9's table pins each one in bash and zsh, but fish is covered only by its golden.
- **Positional counting past value flags.** Miscounting shifts every later slot. AC-9 covers both a value flag before a positional and one between positionals.
- **zsh load order.** `compdef` only exists after `compinit`. AC-9 pins the case where it's missing.
- **tcsh.** A backtick `eval` collapses newlines, so the install line uses the file-and-`source` form. `tcsh -f -n` is weak. tcsh is best-effort by design.
- **Linked-worktree fixture under the Codex sandbox.** A gated skip in the handoff is unverified, not passing, so code review or QA must run it.
- **Submodules.** In a submodule, `--git-common-dir` resolves under the superproject's `.git/modules`, so no task ids complete. The orchestrator's lookup (`src/orchestrator/env.ts`) has the same limitation. Accepted.
- **Golden churn.** Every future flag addition changes the goldens. This is intended.

## Human Test Plan

1. In zsh or bash, add the line shown by the completion help to your shell startup file, then open a new terminal.
2. In a repo with canon tasks, type `canon `, then Tab. Expected: the canon commands, including `completion`.
3. Type `canon run `, then Tab. Expected: your open task ids. Archived tasks do not appear.
4. Type `canon run --`, then Tab. Expected: the run options, such as `--pr`, `--ship` and `--reroute`.
5. Type `canon task phase <a task id> code_review done `, then Tab. Expected: the review verdicts. Doing the same with `plan` in place of `code_review` offers nothing.
6. Change into a subfolder of the repo and repeat step 3. Expected: the same task ids.
7. Run `canon completion powershell`. Expected: a one-line error pointing to the completion help.
8. Expected: completion responds instantly throughout.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A, this is a feature
- [x] (Refactors) N/A, this is a feature. AC-1a's replacements keep error text byte-identical, which existing tests pin.
