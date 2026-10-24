# Completion Summary: per-command-help — Per-command --help and unknown-flag rejection across the canon CLI

> For the human. This is what you need to know.

## What Changed

Every canon command now answers `--help` wherever it appears in the arguments. `canon run foo --help`, `canon watch foo --help`, `canon task accept foo code_review -h`, and the other commands print that command's own usage to stdout and exit 0. Help wins over other argument errors in the same call, and help never runs the command: `canon init --help` in an empty folder creates nothing, and `canon task --help` works from a git worktree canon does not manage. Unknown flags are rejected on every command with `Unknown option: <flag>` and a pointer to that command's help. The top-level `canon --help` is now a short summary, one line per command, and each command's detail lives with its own usage. `canon task --help` lists the nine subcommands. Each command declares its flags once, next to its parser, and the same declaration feeds the help-argument pre-scan and the usage text. Values such as `--reason --help` stay literal, and dash-leading task titles still work.

Compatibility note: `init`, `doctor`, and `stop` used to ignore unknown flags and now exit 1 on them. No caller in this repo passes one, but an adopter script that does will fail after upgrading.

## Files Changed

- `src/lib/cli-args.ts` — new: shared declaration type, help/unknown pre-scan, and error and pointer builders
- `src/cli/index.ts` — top-level help reduced to the command summary and workflow
- `src/cli/commands/run-task.ts` — `run` help and unknown-flag handling before dependency probes or spawning
- `src/orchestrator/cli.ts` — `run` declaration and usage; `parseArgs()` uses the pre-scan
- `src/cli/commands/watch.ts` — watch declaration and shared usage; help prints usage with no summary line
- `src/cli/commands/stop.ts` — stop declaration and usage; pre-scan before task lookup or signaling
- `src/cli/commands/update.ts` — update declaration and usage; `Unexpected argument` for stray words
- `src/cli/commands/upgrade.ts` — upgrade declaration and usage; parser errors print one line instead of a stack trace
- `src/cli/commands/init.ts` — init help and unknown-flag check before dependency checks and writes
- `src/cli/commands/doctor.ts` — doctor help and unknown-flag check before probes
- `src/task/index.ts` — task overview, per-subcommand declarations and usage; help handled before the managed-root check
- `tests/cli-args.test.ts` — new: pre-scan unit tests and the table-driven declaration/usage/parser test
- `tests/cli.test.ts`, `tests/task-cli.test.ts`, `tests/run-task-cli.test.ts`, `tests/watch.test.ts`, `tests/stop.test.ts` — help, unknown-flag, and side-effect coverage; moved-string assertions retargeted
- `tests/run-task-validation.test.ts`, `tests/recovery-hints.test.ts` — assertions retargeted from `src/cli/index.ts` source to the new usage strings
- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` — one sentence: watch `--help` prints usage only
- `docs/codebase-map.md` — new module and test rows; verdict-help step points at `task phase` usage
- `docs/BACKLOG.md` — shell-completion entry now reads the declarations from this task
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles

## How to Test

1. Run `canon --help`. Expected: one line per command, the version line, a short workflow, and the pointer `Run 'canon <command> --help' for details.`
2. Run `canon run foo --help`. Expected: `run`'s usage, exit 0, and nothing else runs (no `gh` check, no child process).
3. Run `canon watch foo --help`. Expected: watch usage including the exit-code table, exit 0, and no `state=` summary line.
4. Make an empty folder, `cd` into it, and run `canon init --help`. Expected: usage only, and the folder is still empty.
5. From a git worktree that canon did not create, run `canon task --help`. Expected: the task overview with all nine subcommands, not an error.
6. Run `canon upgrade --bogus`. Expected: one line `Unknown option: --bogus` with a pointer to `canon upgrade --help`, exit 1, and no stack trace. Run `canon doctor --bogus`. Expected: the same kind of error, and doctor does not run.
7. Run `canon task new "-draft title"` in a test setup. Expected: the task is created with the title `-draft title`.
8. Run `canon task accept <id> code_review --reason "--help"`. Expected: the reason is recorded as `--help` and no usage is printed. (The automated test checks this at the parser level, not against a real task.)

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 1,631 passed, 1 skipped, 0 failed (full run at handoff iteration 2) |
| `npm run build` | Pass — both `dist/` bundles rebuilt |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| Focused `tests/cli-args.test.ts` help-after-value cases | Pass — 3 passed (iteration 3) |
| E2E | deferred_by_spec — spec Validation Required: "N/A (no UI surface)" |

Note: iteration 3 changed only test code and re-ran the focused cases, lint, type-check, and docs-refs-check. The full `npm test` was not re-run after that change. See Open Questions.

## Human Verification Required

None.

Pre-merge checklist — items QA could not confirm:
- [ ] Version correct — the release step decides this (see Proposed Changelog)
- [ ] Changelog updated — the release step applies the entry below
- [ ] PR body current — draft written to `tasks/per-command-help/pr-body.md`; re-check at `--pr`
- [ ] Final CI/CD checks green — not yet run for this head
- [ ] Final diff matches spec intent — human review

## Proposed Changelog

### Added

- **Every canon command answers `--help` in any position.** `canon run foo --help`, `canon watch foo --help`, and the other commands print that command's own usage to stdout and exit 0. Help wins over other argument errors, and it runs nothing: `canon init --help` creates no files.
- **`canon task --help` lists the nine subcommands**, and `canon task <subcommand> --help` gives each one's usage.

### Changed

- **`canon --help` is a short summary.** It lists one line per command and points to `canon <command> --help` for detail.
- **Unknown flags are rejected on every command.** The error names the flag and points to that command's help. The exit code is unchanged: 2 for `watch`, 1 for the others. `init`, `doctor`, and `stop` used to ignore unknown flags and now exit 1 on them.
- **`canon update` and `canon upgrade` reject stray words** with `Unexpected argument: <arg>`.

### Fixed

- **`canon upgrade` with a bad argument prints a one-line error** instead of a stack trace.
- **`canon watch --help` prints its usage on separate lines** and no summary line.

## Decisions Made

- **Help is resolved before any command-level side effect.** Dependency probes, the managed-root check, file writes, and child spawns all come after the help check (`src/lib/cli-args.ts`, `src/task/index.ts`). This follows the spec's Decision 4.
- **`handlePreScan()` prints and exits for help and errors.** The spec sketched each handler consuming a returned `help` value. Centralizing it keeps exit codes and error text in one place; watch keeps its own summary line on the usage-error path. Recorded in the handoff's Deviations table.
- **AC-4's `task accept --reason "--help"` case is verified at the parse level.** The spec allows this. The handoff explains why.
- **`init`, `doctor`, and `stop` reject unknown flags.** The spec calls for this (Decision 5) and flags the compatibility cost. Kept as specced.
- **`docs/patterns.md` is unchanged.** Its "operator-facing text" pitfall cites the old `printHelp()`/`printUsage()` duplication as a past example. The example describes a past task and the rule still holds, so I left it as written.

## Open Questions

- **Release step: is the `init`/`doctor`/`stop` rejection a breaking change?** QA does not set the bump tier. The spec's compatibility note is the input the release step needs.
- **Re-run the full suite before `--pr`.** The last full `npm test` (1,631 passing) ran before the iteration 3 test edit. Re-running it is cheap and confirms the final head.
- **Open a PR?** Not done. `--pr` waits for your go-ahead.

Maintenance: none. The lessons buffer plus this task's fragment hold 11 entries, under the ~15 threshold.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 3
- Validation gaps: 1
- Notes: Code review round 1 found a help-after-`=`-value bug (AC-2) and test gaps in AC-6 and AC-7; all fixed by iteration 3.
