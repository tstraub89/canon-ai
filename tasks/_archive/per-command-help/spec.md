# Spec: per-command-help — Per-command --help and unknown-flag rejection across the canon CLI

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`--help` works on only two of canon's entry points, and unknown arguments are handled several different ways. Observed on 3.13.0 by reading each parser:

| Command | `--help` today | Unknown flag today |
|---|---|---|
| `canon --help` / `-h` | prints the full help (`printHelp()` in `src/cli/index.ts`), exit 0 | unknown *command* → message + full help, exit 1 |
| `canon run` | honoured only as `argv[0]` (`parseArgs()` in `src/orchestrator/cli.ts`); `canon run foo --help` dies with "Unknown option"; `-h` is treated as a task id | `❌ Unknown option: X`, exit 1 (`--x` only; a single-dash unknown falls through as a task id) |
| `canon watch` | usage error: usage to stderr, `state=usage reason=usage_error` on stdout, exit 2 | `Unknown option: X`, same usage-error path, exit 2 |
| `canon stop` | `args[0]` is the task id, so `canon stop --help` reports "task '--help' not found" | `canon stop --bogus` → "task not found"; `canon stop <id> --bogus` silently ignores the flag |
| `canon update` | `parseUpdateArgs()` throws `unknown flag '--help'…`, message to stderr, exit 1 | same; bare words are rejected the same way |
| `canon upgrade` | `parseUpgradeArgs()` throws, uncaught by `upgradeCmd()` → stack trace | same; bare words are rejected the same way |
| `canon init` | ignored — `initCmd()` runs `checkDeps()` then **init runs** | ignored |
| `canon doctor` | ignored — doctor runs | ignored |
| `canon task …` | `canon task --help` → "Unknown subcommand" + `usage()`, exit 1; `canon task <sub> --help` runs or fails the subcommand. `assertManagedInvocationRoot()` runs before dispatch, so from a linked git worktree canon does not manage, even `canon task --help` dies | per subcommand; `task accept` and `task new` parse flags inline |

Separately, all detail lives in one 110-line `printHelp()` that restates the `canon run` options (also in `printUsage()` in `src/orchestrator/cli.ts`) and the task subcommand table (also in `usage()` in `src/task/index.ts`). These independently-authored copies have already drifted: `printHelp()` omits `--allow-divergent-base`, which `parseArgs()` accepts. Nothing ties a parser's accepted flags to its help text, so the drift recurs whenever a flag is added.

This is a feature task, not a bug fix: the red-first mechanism rule does not apply, though AC-2 through AC-5 are each red against today's behavior by construction.

## Decision

Adopt the git/gh help shape: summaries at the top, detail on the command, and one declaration per command that the help pre-scan, the unknown-flag check, and the help-completeness test all read.

1. **A per-command argument declaration and one shared pre-scan.** Each command and each `task` subcommand declares, next to its parser: its boolean flags (with short aliases), its value-taking flags (including any `--flag=value` form the parser accepts today — at minimum `--base=` for `task new` and `--timeout=` for `watch`), and which positional slots are free text (the `task new` title, the `task set` value). One shared pre-scan helper consumes a declaration and the raw argv, before the command body runs, and returns one of: *help requested*, *unknown argument X*, or *proceed*. Every command routes through it. Because the pre-scan rejects any dash-prefixed argument the declaration does not list, a parser cannot silently accept an undeclared flag.
2. **One usage string per command and per `task` subcommand**, defined next to its declaration. Each lists every declared flag (with a value placeholder where it takes one) and every positional. Detail printed today in `printHelp()` (the `watch` exit codes, `update`'s `--channel`/`--ref` rules, the phase/status/verdict lists and the "sanctioned is written via canon task accept --reason" note for `task phase`, the settable fields for `task set`, the pipeline-phase order) moves to the owning command's usage and is deleted from `printHelp()`.
3. **`canon --help` becomes a summary**: one line per command, the `--version` line, a short typical-workflow block, and the pointer `Run 'canon <command> --help' for details.` The pipeline-phase list leaves the top level (it lives in `canon task phase --help`). **`canon task --help`** lists one line per subcommand and points at `canon task <subcommand> --help`.
4. **`--help` / `-h` is honoured anywhere** in a command's arguments, printing that command's (or subcommand's) usage to **stdout** and exiting **0**. **Help wins over any other argument error** in the same invocation (e.g. `canon watch foo --bogus --help` prints help, exit 0). The only exception: an argument consumed as the **value of a value-taking flag** is that value, not a help request. `--help` in a positional slot (a task id, a `task new` title, a `task set` value) is a help request. The help path runs **no command-level side effect**: no dependency probe (`checkDeps()`, `checkDepForFlag()`), no managed-root check, no file write, no task lookup, no signal, no spawned child, and no command-issued git/npm/gh subprocess. Read-only work done at module load (e.g. `REPO_ROOT` resolution in `src/orchestrator/env.ts`) is out of scope for this rule.
5. **Unknown arguments are rejected on every command.** A dash-prefixed argument that is not declared, not a flag's value, and not in a free-text positional slot prints `Unknown option: <arg>` and `Run 'canon <command> --help' for usage.` (for task subcommands, `canon task <subcommand> --help`) to **stderr**. `update` and `upgrade`, which already reject bare words, print `Unexpected argument: <arg>` with the same pointer for those. Each command keeps its current non-zero exit code: `watch` 2, every other command 1. `upgrade` no longer prints a stack trace. Other commands' handling of extra *bare* positionals is unchanged.
6. **`watch` help is not a watch.** `canon watch --help` prints usage to stdout and **no** `state=… reason=…` summary line; the summary-line stdout contract applies to actual watching only. The unknown-option path keeps today's usage-error behavior (summary line `state=usage reason=usage_error` on stdout, exit 2) and gains the `--help` pointer on stderr. `docs/pipeline-orchestrator.md` says so in one sentence.

## Non-Goals

- A `canon help <command>` alias, or a `--` end-of-options marker.
- Normalising exit codes across commands (watch's 0/2/3/4/5 contract stays).
- Changing what any declared flag does, or any flag's name or accepted forms.
- Fixing the existing `task accept` quirk where `rest.includes('--force')` sets force even when `--force` is the `--reason` text.
- Migrating parsers to `util.parseArgs` or a CLI library; shell completion (both are `docs/BACKLOG.md` entries sequenced after this task — the declarations here are what completion will later read).
- Rejecting unexpected extra bare positionals on commands other than `update`/`upgrade`.
- Making module load side-effect-free (lazy imports of `src/orchestrator/env.ts`).

## Acceptance Criteria

- [ ] **AC-1 — Declarations, usage, and parsers agree.** Every command (`init`, `doctor`, `run`, `watch`, `stop`, `update`, `upgrade`, `task`) and every `task` subcommand (`new`, `list`, `status`, `phase`, `accept`, `set`, `reset-spec-review`, `reset-code-review`, `post-merge-sync`) has an exported declaration. A table-driven test asserts, for each declaration: (a) its usage string begins with `Usage: canon <cmd>` (or `Usage: canon task <sub>`) and contains every declared flag; (b) feeding each declared flag (with a dummy value where it takes one, and each `--flag=value` form) to the real parser is not rejected as unknown. The declarations include at least `--allow-divergent-base` and `-1`/`--step` for `run`, `--timeout`/`--timeout=` for `watch`, `--check`/`--dry-run`/`--force`/`--no-stage` for `upgrade`, `--base`/`--base=` for `task new`, and `--reason`/`--force` for `task accept`.
- [ ] **AC-2 — Help works at any position and wins.** Tests assert exit 0 + that command's usage on stdout for, at minimum: `canon run foo --help`, `canon run -h`, `canon watch foo --help`, `canon watch foo --bogus --help`, `canon stop --help`, `canon update --channel main --help`, `canon task accept foo code_review -h`, `canon task new foo --help`. `canon watch foo --help` stdout contains no `state=` line. `canon --help` keeps exiting 0. The `run` cases run against the built `dist/cli/index.js` (the tsx harness cannot resolve `dist/orchestrator/run-task.js` from `src/`).
- [ ] **AC-3 — Help has no command-level side effects.** Tests assert, per case, that the side effect did not happen: `canon init --help` in an empty temp directory creates no files and does not call `checkDeps()` (exits 0 with usage even when a required dependency is unavailable on `PATH`); `canon upgrade --help` leaves a temp-dir fixture's listing unchanged; `canon update --help` invokes neither the injected spawn runner nor the git runner; `canon stop foo --help` does not call stop's injected `kill`; `canon run --pr --help` exits 0 with usage when `gh` is unavailable on `PATH` (no dependency probe, no child spawned); `canon task --help` and `canon task status foo --help` exit 0 with usage when invoked from a **linked git worktree that canon does not manage**, with `CANON_TASKS_DIR_OVERRIDE` **unset** (the fixture under which `assertManagedInvocationRoot()` would otherwise die).
- [ ] **AC-4 — Flag values stay literal.** `canon task accept foo code_review --reason "--help"` records reason text `--help` on a fixture task (or the parse result carries it) and prints no usage. `canon watch foo --until --help` is rejected as an invalid phase, not treated as help.
- [ ] **AC-5 — Unknown arguments are rejected everywhere.** For each of `init`, `doctor`, `run`, `watch`, `stop`, `update`, `upgrade`, and each `task` subcommand, passing `--bogus` in a non-free-text position (for `task new`: `canon task new --bogus`; for `task set`: `canon task set foo --bogus x`) exits non-zero (2 for `watch`, 1 otherwise) with stderr containing `Unknown option: --bogus` and the matching `--help` pointer, and performs no side effect (`init`/`doctor` do not run). `canon upgrade --bogus` stderr contains no stack frame (no line matching `^\s+at `). `canon upgrade foo` and `canon update foo` exit 1 with `Unexpected argument: foo` and the pointer. `canon run -z foo` is rejected as an unknown option rather than treated as a task id.
- [ ] **AC-6 — Free-text slots and `=` forms still work.** With `CANON_TASKS_DIR_OVERRIDE` pointing at a fixture: `canon task set foo title "-draft"` sets the title to `-draft`; `canon task new foo "-draft title"` creates the task with that title; `canon task new bar "Title" --base=main` records base branch `main`. `canon watch foo --timeout=5s` is accepted by the watch parser (parse-level test).
- [ ] **AC-7 — Top-level and `task` help are summaries.** `canon --help` contains each of the eight command names and the string `canon <command> --help`, and does **not** contain `--allow-divergent-base`, `Exit codes:`, `--channel main`, `set <id> <field> <value>`, or `spec → spec_review`. `canon task --help` lists the nine subcommand names and points at `canon task <subcommand> --help`. Existing assertions that pin detail strings in top-level help or in `src/cli/index.ts` source — `tests/cli.test.ts` (`--help` contents), `tests/run-task-validation.test.ts` (verdict list and the "sanctioned is written via canon task accept --reason" note), and `tests/recovery-hints.test.ts` (`HINT_SITES` entries for `src/cli/index.ts` and the `usage()` exemptions) — are retargeted at the new home of each string, not deleted.
- [ ] **AC-8 — Help detail has a single home.** `grep -nE "allow-divergent-base|reset-spec-review <id>|--until <phase>|needs_re_review" src/cli/index.ts` returns zero results.
- [ ] **AC-9 — Existing behavior unchanged.** The full `npm test` suite passes. Edits to existing tests are limited to help-text, unknown-argument, and moved-string assertions; no test of what a declared flag does is modified. The handoff names every edited existing test and why.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/cli-args.ts` | New: the declaration type, the shared pre-scan (help / unknown argument / proceed, honouring value-taking flags, `=` forms, and free-text slots), and the shared unknown-option and pointer message builders |
| `src/cli/index.ts` | `printHelp()` becomes the summary (Decision 3); top-level `--help`/`-h` handling stays |
| `src/cli/commands/run-task.ts` | Run the `run` declaration's pre-scan before `checkDepForFlag()`; on help, print `run` usage and exit 0 without probing `gh` or spawning the child |
| `src/orchestrator/cli.ts` | Export the `run` declaration; `parseArgs()` routes through the pre-scan (help anywhere, single-dash unknowns rejected); `printUsage()` lists every declared flag |
| `src/cli/commands/watch.ts` | Declaration; help → usage to stdout, exit 0, no summary line; unknown-option path gains the pointer; usage carries the exit-code table moved from `printHelp()`; one usage string shared by both paths |
| `src/cli/commands/stop.ts` | Declaration and usage; pre-scan before task lookup and any `kill` |
| `src/cli/commands/update.ts` | Declaration and usage (carries the `--channel`/`--ref` detail); pre-scan before any runner call; bare-word rejection message per Decision 5 |
| `src/cli/commands/upgrade.ts` | Declaration and usage; pre-scan; `upgradeCmd()` prints the Decision 5 message instead of throwing; bare-word rejection message per Decision 5 |
| `src/cli/commands/init.ts` | Declaration and usage; pre-scan before `checkDeps()` and any write |
| `src/cli/commands/doctor.ts` | Declaration and usage; pre-scan before any probe |
| `src/task/index.ts` | `usage()` becomes the `task` overview; a declaration and usage per subcommand (verdict list, settable fields, phase order move here); `taskCmd()` resolves help before `assertManagedInvocationRoot()`; per-subcommand pre-scan |
| `tests/cli-args.test.ts` | New: pre-scan unit tests (help anywhere, help wins, value slots, `=` forms, free-text slots, unknown rejection) and the AC-1 table-driven declaration/usage/parser test |
| `tests/cli.test.ts` | Move top-level detail assertions to per-command help tests; AC-2/3/5/7 coverage for non-task commands (the `run` cases against `dist/cli/index.js`); update the pinned `parseUpgradeArgs`/`parseUpdateArgs` message assertions |
| `tests/task-cli.test.ts` | AC-2/3/4/5/6 coverage for `task` and its subcommands, including the foreign-linked-worktree fixture with the override unset; adjust usage-text assertions |
| `tests/run-task-cli.test.ts` | `parseArgs()` help-anywhere and single-dash-unknown cases |
| `tests/watch.test.ts` | Help exit 0 / stdout / no summary line; unknown-option pointer; `--timeout=` parse case |
| `tests/stop.test.ts` | Help and unknown-flag cases asserting `kill` is not called |
| `tests/run-task-validation.test.ts` | Retarget the verdict-list and sanctioned-note assertions at their new home in `src/task/index.ts` |
| `tests/recovery-hints.test.ts` | Update `HINT_SITES` for hint lines that move out of `src/cli/index.ts` into per-command usage, and the `usage()` exemptions |
| `docs/pipeline-orchestrator.md` | One sentence under `canon watch`: `--help` prints usage only; the summary-line contract covers watching, not help |
| `templates/docs/pipeline-orchestrator.md` | Mirror of the above (`npm run sync-templates`) |
| `docs/codebase-map.md` | `src/cli/index.ts` row no longer claims it holds all help; add `src/lib/cli-args.ts` and `tests/cli-args.test.ts` rows; "Add a new review verdict" chain points its help-text step at `task phase` usage in `src/task/index.ts` |
| `docs/BACKLOG.md` | Shell-completion entry: replace the "today only `canon --help` and `canon run --help` work…" sentence with a note that per-command help and declarations landed here and that completion should read those declarations |
| `dist/cli/index.js` | Rebuilt (`npm run build`) — bundles all touched `src/cli`, `src/task`, `src/orchestrator/cli.ts`, `src/lib` modules |
| `dist/orchestrator/run-task.js` | Rebuilt — `src/orchestrator/cli.ts`, `src/task/index.ts` (via `main.ts`), and `src/lib/cli-args.ts` bundle into this entry too |

### Interaction Dependencies

- `canon run` spawns `dist/orchestrator/run-task.js`; help is resolved in the wrapper so the child is never spawned for help, and `parseArgs()` in the child uses the same pre-scan so direct invocations of `run-task.js --help` agree.
- `canon run --help` is pinned by `tests/task-cli.test.ts` against the built `dist/orchestrator/run-task.js` (`Usage: canon run`); keep that working.
- `tests/recovery-hints.test.ts` scans all of `src/` for recovery-command hints (`canon task accept`, `reset-*`, `--reroute`); every new usage line containing one must be registered in `HINT_SITES` or the test fails.
- The `docs/BACKLOG.md` shell-completion entry will read the declarations introduced here.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — commit both `dist/` artifacts; CI diffs `dist/` against a fresh build
- [x] `npm run sync-templates:check` — `docs/pipeline-orchestrator.md` is canon-managed
- [x] `npm run docs-refs-check` — `docs/` changes
- [ ] E2E — N/A (no UI surface)

## Docs Impact

- `docs/codebase-map.md`, `docs/pipeline-orchestrator.md` (+ mirror), `docs/BACKLOG.md` — edited (Affected Files).
- `docs/product-context.md` — command list at "Current state" is unchanged (no new command); heads-up only.
- `docs/patterns.md` — the "independently-authored duplicates" pitfall cites the `printHelp()`/`printUsage()` `--reroute` duplication as its example; after this task that duplication no longer exists. Heads-up for QA; the pitfall's rule still stands.
- `CHANGELOG.md` — release-time note: `init`, `doctor`, `stop` now reject unknown flags they used to ignore.

## Known Risks

- **Free-text slots vs unknown-flag rejection (AC-5, AC-6).** `task new` and `task set` decide by position whether a dash-leading argument is a title/value or a flag. The pre-scan must count positionals per the declaration; test both directions (AC-5 names non-free-text positions, AC-6 the free-text ones).
- **`=` forms.** `--base=` and `--timeout=` are accepted today with no existing test; a declaration that lists only the spaced form would silently reject them. AC-1(b) and AC-6 pin both.
- **Help short-circuit ordering.** `initCmd()` calls `checkDeps()` first, `taskCmd()` calls `assertManagedInvocationRoot()` before dispatch, and `runCmd()` probes `gh` before spawning. AC-3 pins each.
- **AC-3's managed-root case can pass vacuously.** `assertManagedInvocationRoot()` returns early when `CANON_TASKS_DIR_OVERRIDE` is set and only dies for a foreign linked worktree; the test must unset the override and use that fixture, or it proves nothing.
- **Compatibility.** `init`, `doctor`, and `stop` start rejecting flags they used to ignore; an adopter script passing one exits 1 after upgrading. No in-repo caller does; note it in the release changelog.
- **Pinned text moves.** `tests/run-task-validation.test.ts` and `tests/recovery-hints.test.ts` read `src/cli/index.ts` source directly; retarget rather than delete (AC-7).
- **`-h` was a (useless) task-id token for `run`.** `validateTaskId()` rejects any id not matching `^[a-z0-9]`, so no valid id is lost.

## Human Test Plan

1. Run the top-level help. Expected: a short list of commands, one line each, with a hint to ask any command for its own help.
2. Ask `run`, `watch`, and `task accept` for help, putting the help flag at the end of an otherwise normal command. Expected: each prints its own detailed usage and nothing else happens.
3. Ask `init` for help in an empty folder. Expected: usage only; the folder stays empty.
4. Ask `task` for help from a git worktree that canon didn't create. Expected: the task overview prints instead of an error.
5. Pass a made-up flag to `upgrade` and to `doctor`. Expected: a one-line "unknown option" message with a pointer to that command's help — no stack trace, and doctor does not run.
6. Accept a review with the reason text "--help". Expected: the acceptance is recorded with that reason; no help is printed.
7. Create a task whose title starts with a dash. Expected: it is created with that title.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A, feature task
- [x] (Refactors) — N/A, feature task
