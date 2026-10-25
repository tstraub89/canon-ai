# Implementation Handoff: per-command-help

> Author: Codex | Spec: `tasks/per-command-help/spec.md` | Plan: `tasks/per-command-help/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/lib/cli-args.ts` | Added shared argument declarations, position-aware help/unknown pre-scan, and standard error/pointer builders. |
| `src/cli/index.ts` | Reduced top-level help to the command summary and typical workflow. |
| `src/orchestrator/cli.ts` | Added the full `run` declaration and usage; pre-scans direct parser calls and rejects single-dash unknowns. |
| `src/cli/commands/run-task.ts` | Handles `run` help and unknown flags before dependency probes or spawning. |
| `src/cli/commands/watch.ts` | Added watch declaration and shared usage; help exits cleanly, unknown flags retain the usage summary path and add the pointer. |
| `src/cli/commands/stop.ts` | Added stop declaration/usage and pre-scan before task lookup or signaling. |
| `src/cli/commands/update.ts` | Added update declaration/usage, pre-scan before install inspection, and standard unknown/unexpected argument errors. |
| `src/cli/commands/upgrade.ts` | Added upgrade declaration/usage, pre-scan, and caught parser errors without stack traces. |
| `src/cli/commands/init.ts` | Added init help and unknown-flag pre-scan before dependency checks. |
| `src/cli/commands/doctor.ts` | Added doctor help and unknown-flag pre-scan before environment checks. |
| `src/task/index.ts` | Added task overview and per-subcommand declarations/usages; hoisted task help ahead of the managed-root check; extracted `parseTaskNewArgs()` and `parseTaskAcceptArgs()`. |
| `dist/cli/index.js` | Rebuilt the published CLI bundle. |
| `dist/orchestrator/run-task.js` | Rebuilt the bundled orchestrator entry point. |
| `tests/cli-args.test.ts` | Added pre-scan and declaration/usage/parser agreement coverage, including AC-4 and AC-6 parse cases. |
| `tests/cli.test.ts` | Retargeted help assertions; added command help, side-effect, unknown-option, and update-runner checks; updated parser error pins. |
| `tests/task-cli.test.ts` | Added task help, foreign-worktree guard/control, unknown-flag, and free-text/`--base=` coverage. |
| `tests/run-task-cli.test.ts` | Added run help-anywhere, literal value, and single-dash unknown parser assertions. |
| `tests/watch.test.ts` | Added help/no-summary, unknown pointer/summary, and `--until --help` cases. |
| `tests/stop.test.ts` | Added help and unknown-option checks proving signaling is skipped. |
| `tests/run-task-validation.test.ts` | Retargeted verdict-list and sanctioned-note assertions to `TASK_SUBCOMMAND_ARGS.phase.usage`. |
| `tests/recovery-hints.test.ts` | Removed top-level-help hint entries and retargeted usage/declaration snippets to their new source lines. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented that watch help prints usage without a summary line; generated the mirror with template sync. |
| `docs/codebase-map.md` | Documented the shared argument module and test, and moved the verdict-help step to task phase usage. |
| `docs/BACKLOG.md` | Updated the shell-completion entry to consume the declarations introduced here. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Each command owns its usage and declaration. The shared pre-scan recognizes help before command work, keeps value-taking flags literal, counts free-text positional slots, and rejects undeclared dash-prefixed arguments consistently. Watch keeps its existing usage-error summary contract while taking the help path without emitting a summary.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Command handlers use `handlePreScan()` to print and exit on help/errors instead of each handler consuming a returned `'help'` value. `preScanArgs()` remains the pure result API used by watch and unit tests. | Centralizes exit codes and shared error output; watch keeps its command-specific summary behavior. | None |
| AC-4 uses the permitted parse-level assertion for `task accept --reason --help` instead of mutating a fixture task. | The spec explicitly permits a parse result carrying the literal value; the table and dedicated unit test pin both parser and pre-scan behavior. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: Declarations, usage, and parsers agree | Met | The table-driven test covers all eight command declarations and nine task subcommands, every declared flag, usage prefixes, and parser adapters. |
| AC-2: Help works at any position and wins | Met | Built `dist` run cases, watch/stop/update cases, and task subcommand cases cover end-position help, `-h`, and help after an unknown option. |
| AC-3: Help has no command-level side effects | Met | Tests cover init dependency checks/writes, upgrade writes, update runners, stop kill, run `gh` probing, and task managed-root/task lookup ordering. Foreign-worktree control confirms the guard fixture is active. |
| AC-4: Flag values stay literal | Met | `--reason --help` remains the reason value; watch treats `--until --help` as an invalid phase. |
| AC-5: Unknown arguments are rejected everywhere | Met | Tests cover each top-level command and every task subcommand, pointers, exit codes, and no side effects for init/doctor/task. |
| AC-6: Free-text slots and `=` forms still work | Met | Tests verify dash-leading task title/value, task new `--base=main`, and watch `--timeout=5s`. |
| AC-7: Top-level and task help are summaries | Met | Top-level and task overview help are summaries; moved detail assertions now target their owning usage declarations. |
| AC-8: Help detail has a single home | Met | The required grep against `src/cli/index.ts` printed no matches. |
| AC-9: Existing behavior unchanged | Met | The full test suite passes; existing test edits are limited to help/unknown text, side-effect/help coverage requested by the spec, recovery-hint registry relocation, and moved-string assertions. |

## Edge Cases Considered

- Help wins when an unknown option is also present, but a token consumed by `--expect`, `--until`, `--timeout`, `--base`, or `--reason` remains a value.
- Free-text positions are counted only across positional arguments, so `task new` and `task set` accept dash-leading title/value strings while flags retain their declared slots.
- `--timeout=` and `--base=` remain accepted; undeclared equals forms such as `--expect=plan` remain unknown.
- The explicit red checks were run by temporarily removing each help pre-scan, then restoring it: task help failed at the unmanaged-worktree guard; built `run --pr --help` failed at the missing-GitHub-CLI probe. Both targeted cases pass in the final full suite.
- The spec calls out the changed compatibility behavior for `init`, `doctor`, and `stop`; note it in the release changelog when cutting the release. `CHANGELOG.md` is outside this task's Affected Files.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-3 task help ordering | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='task help bypasses managed-root checks' tests/task-cli.test.ts` | Working tree with the task help hoist temporarily removed for the spec's red check | Exited 1 at `assertManagedInvocationRoot()` in the foreign linked worktree instead of printing help with exit 0. | The final `npm test` passes the task help and control cases. |
| AC-3 run help ordering | `npm run build && node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='per-command help short-circuits command work' tests/cli.test.ts` | Working tree with `runCmd()` pre-scan temporarily removed and bundle rebuilt | `run --pr --help` exited 1 with the missing GitHub CLI error instead of printing help with exit 0. | The final `npm test` passes both help and control cases. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Pass | Rebuilt both declared `dist/` artifacts after the final source edits. |
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,630 passed, 1 skipped, 0 failed. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| E2E | deferred_by_spec | Spec: Validation Required — N/A (no UI surface). |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/lib/cli-args.ts` | Removed the previous-token look-behind that swallowed help after a completed `--flag=value` or after a value token that had itself been consumed. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt the bundles with the corrected help pre-scan. |
| `tests/cli-args.test.ts` | Added regressions for help after `--timeout=`, `--base=`, and a repeated `--reason`; exercised AC-6 free-text and equals-form cases through the actual task declarations. |
| `tests/task-cli.test.ts` | Asserted the task overview lists all nine subcommands and points to per-subcommand help. |
| `tests/cli.test.ts` | Retargeted the moved task-set usage assertion to `task set --help`; ran `init --bogus` in a temp directory and asserted no files were created. |
| `docs/BACKLOG.md` | Updated shell-completion follow-up to consume existing declarations and removed the stale fifth-place verdict-chain claim. |

### Findings addressed

- _correctness bug:_ Help after a complete equals-form value or after a value token that was itself consumed was suppressed → removed the look-behind; explicit pre-scan cases now return `help` (`src/lib/cli-args.ts`).
- _risk/guardrail:_ AC-6 tests bypassed production declarations → the tests now call `preScanArgs()` with `TASK_SUBCOMMAND_ARGS.new` and `.set` for both free-text and `--base=` cases (`tests/cli-args.test.ts`).
- _risk/guardrail:_ AC-7's moved-help assertions were incomplete → the task overview test checks all nine subcommand names and the help pointer, and `task set --help` pins the moved usage detail (`tests/task-cli.test.ts`, `tests/cli.test.ts`).
- _risk/guardrail:_ The `init --bogus` no-side-effect test used the repository checkout → it now uses an empty temp directory and asserts the directory remains unchanged (`tests/cli.test.ts`).
- _risk/guardrail:_ The shell-completion backlog still proposed a separate declarations table and referenced a nonexistent fifth verdict-chain link → it now directs completion to the existing declarations and describes the current three-link chain (`docs/BACKLOG.md`).

### AC deltas (if any)

- AC-2 / AC-6: previously missed help-after-value cases now return help, while the existing consumed `--reason --help` case remains a literal reason value (`tests/cli-args.test.ts`).
- AC-5: the init unknown-option no-side-effect assertion now runs in an isolated temp directory (`tests/cli.test.ts`).
- AC-6: free-text and `--base=` pre-scan coverage uses the task command's actual declarations (`tests/cli-args.test.ts`).
- AC-7: task overview and moved task-set usage are asserted at their new output locations (`tests/task-cli.test.ts`, `tests/cli.test.ts`).

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Pass | Rebuilt both declared dist bundles. |
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,631 passed, 1 skipped, 0 failed. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Fail – unrelated | `tasks/per-command-help/review.md:73` contains a backticked reference to missing [src/cli/completion-spec.ts](src/cli/completion-spec.ts); that reviewer artifact is outside this task's Affected Files. Repro: `npm run docs-refs-check`. |

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `tests/cli-args.test.ts` | Replaced the three vacuous synthetic-declaration assertions with separate cases using the production watch, task-new, and task-accept declarations. |
| `tasks/per-command-help/notes.md` | Recorded the free-text-slot fixture pitfall discovered while verifying the regressions. |

### Findings addressed

- _correctness bug:_ The help-after-value regression tests could pass with the bug because their synthetic declaration marked position zero as free text → replaced them with production declarations, which exercise the look-behind branch and fail against its prior behavior (`tests/cli-args.test.ts`).
- _risk/guardrail:_ Broken doc references in reviewer artifacts → no implementer edit required; verified the foreman’s fixes with `npm run docs-refs-check` (all refs OK).

### AC deltas (if any)

- AC-2: separate regression cases now pin help after `watch --timeout=5s`, `task new --base=main`, and a consumed `task accept --reason` token using production declarations (`tests/cli-args.test.ts`).

### Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-2 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='help after' tests/cli-args.test.ts` | Task branch HEAD `ecdbb7b1786613eb2004e447a69f2d88d1781927`, with the previous-token look-behind temporarily restored in `src/lib/cli-args.ts` to reproduce the pre-fix behavior | All three production-declaration cases failed independently: actual `proceed`, expected `help`. | With the look-behind removed, all three cases passed (`3 passed, 0 failed`). |

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| Focused `tests/cli-args.test.ts` cases | Pass | 3 passed, 0 failed. |
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run docs-refs-check` | Pass | All refs OK after the foreman corrected the review artifacts. |
