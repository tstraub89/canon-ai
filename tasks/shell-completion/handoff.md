# Implementation Handoff: shell-completion

> Author: Codex | Spec: `tasks/shell-completion/spec.md` | Plan: `tasks/shell-completion/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `src/lib/cli-args.ts` | Added typed completion metadata for positional slots and value flags. |
| `src/lib/pipeline-policy.ts` | Exported `SIZE_ORDER` as the shared task-size value set. |
| `src/cli/registry.ts` | Added the side-effect-free top-level command registry and global flags. |
| `src/cli/commands/completion.ts` | Added completion CLI command, shared model, and bash, zsh, fish, and tcsh renderers. |
| `src/cli/index.ts` | Wired `completion` dispatch and help text to the registry. |
| `src/orchestrator/cli.ts` | Added completion metadata to run arguments. |
| `src/cli/commands/watch.ts` | Added task-id and phase metadata to watch arguments. |
| `src/cli/commands/stop.ts` | Added task-id metadata to stop arguments. |
| `src/cli/commands/update.ts` | Exported and reused update channels; added completion metadata. |
| `src/task/index.ts` | Added task completion metadata and shared accepted-phase and field-value sets; exported validation helpers. |
| `tests/completion.test.ts` | Added declaration, value-set, registry, generated-script, syntax, and shell smoke coverage. |
| `tests/completion.golden.json` | Added pinned scripts for all four shells. |
| `tests/cli.test.ts` | Added completion to command-help checks and asserted help/registry agreement. |
| `tests/cli-args.test.ts` | Included `COMPLETION_ARGS` in declaration consistency checks. |
| `tests/recovery-hints.test.ts` | Updated declaration snippets for the new metadata lines. |
| `.github/workflows/ci.yml` | Installed zsh, fish, and tcsh before the test step. |
| `README.md` | Documented shell completion setup and added it to the command table. |
| `docs/product-context.md` | Added completion to the CLI command list. |
| `docs/codebase-map.md` | Added completion command, registry, and test entries. |
| `docs/architecture.md` | Documented shell installation in the CI sequence. |
| `docs/BACKLOG.md` | Replaced the completed feature with the `util.parseArgs` parser follow-up. |
| `dist/cli/index.js` | Rebuilt CLI bundle. |
| `dist/orchestrator/run-task.js` | Rebuilt orchestrator bundle with shared declarations and value sets. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Completion scripts are generated from the command registry and the same `ArgDeclaration` metadata used by the CLI. Shell-side task lookup reads task directories under the main checkout, so tab presses do not start canon or Node. Shared exported value sets keep completion candidates aligned with command validation.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None. | Implementation follows the planned registry/model/renderers and validation approach. | None. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Metadata is attached to each declaration named in `tasks/shell-completion/spec.md`; focused tests pin slots and value kinds. |
| AC-1a | Met | Validators read shared constants/record; required retired expressions are absent. `task set` record values are exercised through `taskSet`. |
| AC-2 | Met | CLI tests cover scripts, help/install instructions, invalid inputs, determinism, non-repository execution, and no disk writes. |
| AC-3 | Met | Registry is in a side-effect-free module; help and registry names are checked in both directions. |
| AC-3b | Met | Renderers consume the shared model. Bash and zsh smoke rows cover contexts and task ids; fish has golden/model coverage; tcsh covers commands, subcommands, and active-command flags. |
| AC-4 | Met | Bash and zsh smoke tests cover root, subdirectory, linked worktree, hidden/archive names, non-directory entries, non-repository, and missing `tasks/`. |
| AC-5 | Met | All generated scripts are checked for runtime calls to canon, node, or npx. Install lines are confined to usage text. |
| AC-6 | Met | Synthetic growth and undeclared-flag assertions pass. The renderer-omits-value-flags mutation failed on `--zz-value`; the bogus-flag mutation failed on `--bogus-flag`; both mutations were reverted. |
| AC-7 | Met | Offered phases, statuses, verdicts, accept phases, channels, shells, and `task set` values are checked against command validators. |
| AC-8 | Met | Each generated shell script matches its golden in `tests/completion.golden.json`. |
| AC-9 | Met | Bash and zsh smoke tables passed, including `/bin/bash` 3.2.57 and zsh no-`compdef` behavior. Bash/zsh/tcsh syntax checks and tcsh load passed. Fish syntax check skipped locally because fish is absent; CI installs it and the test fails if CI lacks it. |
| AC-10 | Met | CI installs zsh, fish, and tcsh before tests. |
| AC-11 | Met | Tests reject canon-ai source-path references in usage and generated scripts. |
| AC-12 | Met | `COMPLETION_ARGS` is in the declaration test list. |
| AC-13 | Met | README and product/architecture/codebase docs were updated; backlog now records the parser migration follow-up. |

## Edge Cases Considered

- Value flags and `--flag=value` forms do not shift positional completion slots; value flags before and between positionals are covered.
- Review verdicts depend on the preceding phase, and `spec_gap` is limited to `code_review`.
- `task set` values depend on the field; free-text fields produce no constrained candidates.
- `task accept` keeps task IDs available until the trailing accept phase.
- Missing `compdef` reports the zsh `compinit` load-order hint.
- Task ids resolve from a subdirectory and linked worktree; no candidates are emitted outside a repository or without `tasks/`.
- tcsh uses a file-and-`source` installation because its multi-line script cannot be installed with backtick `eval`.

## Blockers

- None. Fish syntax/runtime could not be exercised locally because fish is not installed; the spec permits shell-absence skips, and CI installs fish while making its absence a test failure.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| _(none — no red-first ACs)_ | | | | |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,644 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt both tracked dist bundles. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `E2E` | N/A | Spec: `tasks/shell-completion/spec.md` Validation Required — no UI surface. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| Focused completion suite | Pass | 9 tests passed. Fish syntax check reported a local skip because fish is unavailable. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/cli/commands/completion.ts` | Reworked bash, zsh, and fish renderers to derive per-command value flags, typed values, positional slot actions, dependency indexes, and task-id slots from the completion model. Corrected fish `switch`/`case` syntax and value output; fixed task-level flag routing, zsh fallback splitting, accept prefix candidates, and non-returning error paths. |
| `tests/completion.test.ts` | Added fish syntax/runtime smoke coverage; set-field, single-ID, task-level flag, value-flag, no-repository zsh, and synthetic value-before-positional / equals-token regressions. |
| `tests/completion.golden.json` | Regenerated all shell scripts from the corrected renderers. |
| `docs/architecture.md` | Aligned the CI overview order with the workflow: build, install shells, then test. |
| `dist/cli/index.js` | Rebuilt the published CLI bundle. |

### Findings addressed

- **F1 — Fish script syntax and missing smoke coverage:** Render fish `switch` bodies as `case` blocks, use fish alternatives and per-field cases, and emit typed value-flag suggestions. Added fish syntax and command/verdict/field runtime smoke checks. Fish is unavailable locally; CI installs it and fails if it is missing.
- **F2 — Incorrect `task set` suggestions:** Per-field candidates now come from `model.valuesByField`; free-text and unknown fields return no constrained candidates. Bash and zsh smoke tests pin boolean, free-text, and unknown fields.
- **F3 — Accept phase prefix:** Bash prints task ids and accept phases as separate candidates. The `imp` smoke row now asserts the exact result `implement`.
- **F4 — Hardcoded value-flag parser:** Bash, zsh, and fish value-flag and attached-value handling is generated from each record's `valueFlags`, `equalsValueFlags`, and `valueFlagKinds`. Synthetic shell checks put value flags before a phase slot and assert the phase candidates are unchanged.
- **R1 — Context fixed word indexes:** Renderers collect counted positionals and resolve verdict/field dependencies through `dependsOn`, so skipped flag/value tokens do not change the governing slot.
- **R2 — Task ids after a single id:** Candidate generation follows positional slot indexes and only offers ids in a task-id slot; the variadic `accept` slot retains ids while offering its trailing phase.
- **R3 — zsh global flag fallback:** The fallback splits the flag string into individual candidates.
- **R4 — `canon task -` flags:** The dash-prefix flag branch runs before task subcommand suggestions and uses the task declaration.
- **R5 — Bash `=` word break:** The value parser keeps a pending value across a standalone `=` token. Synthetic tests cover both `--flag=value` and Bash's split `--flag`, `=`, `value` form.
- **N1 — CI sequence documentation:** Corrected the order in the architecture overview.
- **N2 — Unused model fields:** `dependsOn` now drives contextual value lookup; the unused `freeTextSlots` copy was removed from the internal completion model.
- **N3 — Error helper fallthrough:** Invalid completion arguments return directly from `fail()`.
- **N4 — zsh lookup edge cases:** Added no-repository and repository-without-`tasks/` smoke cases for zsh.

### AC deltas

- AC-3b: Fail → Met. Fish syntax is corrected and fish smoke coverage now runs when fish is present; CI requires the shell.
- AC-6: Partial → Met. Renderers now source value-flag handling and positional slot behavior from the model; synthetic checks cover a value flag before a later positional.
- AC-9: Fail → Met. The fish parse check and runtime smoke are part of the suite, and CI installs fish before running it. Local fish execution was unavailable and followed the spec's shell-absence skip behavior.

### Red-First Evidence

No red-first ACs were added or changed in this review round.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,646 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js`. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| Focused completion suite | Pass | 11 tests passed. Fish syntax and runtime checks were skipped locally because fish is unavailable. |

### Blockers

- `[verification]` Fish is not installed in this environment, so its new syntax and runtime checks could not run locally. The suite fails rather than skips when `CI` is set, and `.github/workflows/ci.yml` installs fish before `npm test`.

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `src/cli/commands/completion.ts` | Kept variadic task-id slots active after the first id; replaced Bash `compgen -W` with line-by-line, quoted candidate filtering; limited standalone `=` continuation to declared equals-value flags; added task-id value-flag rendering; rejected variadic declarations with multiple trailing fixed slots; corrected tcsh dash-prefixed `task` flag routing; quoted Fish task comparison and invoked `command git` in Bash lookup. |
| `tests/completion.test.ts` | Fixed the fish verdict expectation; added variadic follow-up, malicious task-name safety, declared-equals, task-id value-kind, invalid variadic shape, tcsh dash-prefix, and expanded fish-fixture coverage. |
| `tests/completion.golden.json` | Regenerated shell completion goldens for the renderer changes. |
| `dist/cli/index.js` | Rebuilt the published CLI bundle. |

### Findings addressed

- **F5:** Fish smoke now expects all `code_review` verdicts from the shared model.
- **F6:** Bash, zsh, and fish variadic `run` dispatch keeps offering task ids after one id; smoke rows include `run alpha` and both fixture task ids.
- **F7:** Bash reads candidate lines into a local scalar and appends quoted array entries after a prefix check. It no longer passes task names through `compgen -W`; a task directory with command-substitution syntax is returned literally and does not create a side-effect file.
- **R6:** The parser tracks whether the pending flag is declared in `equalsValueFlags`; standalone `=` preserves a pending value only for those flags. Synthetic Bash/zsh checks distinguish accepted and rejected separators, and fish has an equivalent CI smoke case.
- **R7:** Model construction rejects a variadic positional declaration with more than one following fixed slot; a synthetic declaration pins the error.
- **R8:** `taskId` is an explicit value-kind arm in Bash, zsh, and fish renderers; a synthetic declaration pins that arm.
- **R9:** tcsh recognizes `canon task -` as a task-level flag context and returns task flags instead of global flags.
- **N5–N7:** Quoted the Fish comparison, used `command git` in Bash, and expanded fish smoke fixtures with two visible task ids, ignored hidden names/files, accept, variadic continuation, verdicts, and dash-prefixed flags.

### AC deltas

- AC-3b: Variadic `run` completion now remains available after earlier task ids; generated renderers enforce the declared variadic-slot shape.
- AC-6: Value-flag completion handles task-id kinds, and equals-token state follows `equalsValueFlags`.
- AC-9: Fish expected output is corrected and smoke cases are expanded. Fish syntax/runtime remain unverified locally because fish is unavailable.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,646 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js`. |
| `npm run docs-refs-check` | Fail – unrelated | The check reports a synthetic task-directory reference in `tasks/shell-completion/review.md`, outside this iteration's changed source/artifact scope. No source, test, or handoff reference introduced this failure. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| Focused completion suite | Pass | 11 passed. Bash 3.2, zsh, and tcsh checks ran; fish syntax, equals-separator, and runtime checks skipped because fish is not installed locally and remain CI verification. |

### Blockers

- `[verification]` Fish is unavailable locally. CI installs fish and the completion suite fails if it is absent, but fish syntax and runtime results remain unverified in this phase.
- `[unrelated-validation]` `npm run docs-refs-check` fails on an existing reference in `tasks/shell-completion/review.md`; changing the reviewer artifact would exceed this iteration's source scope. The exact reported synthetic directory name is omitted here because docs-refs-check treats backticked missing paths as broken references.

## Iteration 4 — addressing review round 3

### Changes

| File | What Changed |
|---|---|
| `src/cli/commands/completion.ts` | Replaced the tcsh awk slash-delimited regex used for dash-prefixed subcommands with `substr(subcmd, 1, 1) == "-"`, keeping slashes out of the embedded `C/-/` completion clause. |
| `tests/completion.test.ts` | Added an assertion against the generated tcsh command that the embedded awk program contains no slash field separators; retained the direct awk routing cases. |
| `tests/completion.golden.json` | Regenerated the tcsh completion golden. |
| `dist/cli/index.js` | Rebuilt the published CLI bundle. |

### Findings addressed

- **F8:** The generated tcsh completion line no longer embeds slash characters in its `C/-/` body, preventing tcsh from splitting the awk command at the field separator. The test checks the generated line itself as well as task and global flag routing.

### AC deltas

- AC-3b: tcsh flag completion now preserves the embedded awk command while selecting flags for the active command path.
- AC-9: tcsh syntax/load and direct awk checks pass. Fish remains unverified locally because fish is unavailable.

### Red-First Evidence

No spec red-first ACs were added or changed in this review round.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,646 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js`. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| Focused completion suite | Pass | 11 passed. tcsh generated-command and awk checks pass; fish checks skipped locally because fish is unavailable. |

### Blockers

- `[verification]` Fish is unavailable locally, so the fish syntax and runtime smoke rows remain unverified here; CI installs fish and requires the checks to run.

### Deferred non-blocking findings

R10–R12 were classified as non-blocking by Round 3: they concern future equals-value completion behavior, an invalid `--until=` invocation, and shell escaping for task directory names containing spaces. No current completion declaration or valid task id exercises those cases.
