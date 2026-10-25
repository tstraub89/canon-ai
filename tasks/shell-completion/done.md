# Completion Summary: shell-completion — Shell completion for the canon CLI (bash, zsh, fish, tcsh)

> For the human. This is what you need to know.

## What Changed

`canon` now has tab completion. Running `canon completion <bash|zsh|fish|tcsh>` prints a completion script to the terminal, and the user adds one line to their shell startup file to load it. Completion covers the top-level commands, the `task` subcommands, every flag each command accepts, and the values that canon's own validation accepts: the seven phase names, the phase statuses, review verdicts (offered only after a review phase, and `spec_gap` only after code review), task sizes, the `--until` and `--channel` values, and the settable `task set` fields and their values. Task ids complete from the main checkout's `tasks/` directory, so they work from a subdirectory and from a linked worktree, without starting canon or Node on each Tab press. The scripts are generated from the same command declarations that drive `--help` and unknown-flag rejection, so completion cannot offer a flag canon would reject. Shared value sets (task sizes, accept phases, update channels, the `task set` field-to-value record) are now exported constants that the validators read, which removes the duplicate inline lists.

tcsh completes commands, subcommands, and flags only, as the spec requires. Its install line sources a file, not an `eval`, because a multi-line script does not survive tcsh's backtick `eval`. Fish is verified only in CI, because fish is not installed on the machine where this phase ran.

## Files Changed

- `src/cli/commands/completion.ts` — new `canon completion` command, the shared completion model, and the four shell renderers.
- `src/cli/registry.ts` — new side-effect-free registry of top-level commands and global flags.
- `src/cli/index.ts` — dispatches `completion`; help text reads from the registry.
- `src/lib/cli-args.ts` — optional `completion` metadata on `ArgDeclaration`.
- `src/lib/pipeline-policy.ts` — exports `SIZE_ORDER`.
- `src/orchestrator/cli.ts` — completion metadata on `RUN_ARGS`.
- `src/cli/commands/watch.ts` — completion metadata on `WATCH_ARGS`.
- `src/cli/commands/stop.ts` — completion metadata on `STOP_ARGS`.
- `src/cli/commands/update.ts` — exports the update-channel constant; completion metadata on `UPDATE_ARGS`.
- `src/task/index.ts` — accept-phase and `task set` field-value constants; `TASK_SIZE_VALUES` removed in favor of `SIZE_ORDER`; validation helpers exported; completion metadata on the task subcommand declarations.
- `tests/completion.test.ts` — new. Declaration, value-set, registry, script, syntax, and shell smoke coverage.
- `tests/completion.golden.json` — new. Pinned script for each shell.
- `tests/cli.test.ts` — completion added to the help checks; help and registry agreement asserted.
- `tests/cli-args.test.ts` — `COMPLETION_ARGS` added to the declaration checks.
- `tests/recovery-hints.test.ts` — four declaration snippets shortened so the new metadata does not break them.
- `.github/workflows/ci.yml` — installs `zsh`, `fish`, and `tcsh` before the test step.
- `README.md` — `### Shell completion` subsection after Install; `canon completion <shell>` row in Key commands.
- `docs/product-context.md`, `docs/codebase-map.md`, `docs/architecture.md` — command list, new file rows, CI step order.
- `docs/BACKLOG.md` — shell-completion entry replaced by the `util.parseArgs` follow-up.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt.

## How to Test

1. Add the install line for your shell to your startup file, then open a new terminal. The line is printed by `canon completion --help`.
2. In a directory with canon tasks, type `canon ` and press Tab. Expected: the canon commands, including `completion`.
3. Type `canon run ` and press Tab. Expected: your open task ids. Archived tasks do not appear.
4. Type `canon run --` and press Tab. Expected: the run options, such as `--pr`, `--ship`, and `--reroute`.
5. Type `canon task phase <a task id> code_review done ` and press Tab. Expected: the review verdicts, including `spec_gap`. Repeat with `plan` in place of `code_review`. Expected: nothing.
6. `cd` into a subfolder of the repo and repeat step 3. Expected: the same task ids.
7. Run `canon completion powershell`. Expected: a one-line error that points to `canon completion --help`.
8. Expected: completion responds without a visible delay throughout.

## Test Results

Figures are from the final validation run in `tasks/shell-completion/handoff.md` (Iteration 4). QA did not re-run them.

| Check | Result |
|---|---|
| Lint (`npm run lint`) | Pass |
| Type-check (`npm run type-check`) | Pass |
| Unit tests (`npm test`) | Pass — 1,646 passed, 1 skipped, 0 failed |
| Completion suite (`tests/completion.test.ts`) | Pass — 11 passed. Fish syntax and runtime checks skipped locally (fish not installed); they run in CI, which installs fish and fails if it is missing |
| Build (`npm run build`) | Pass |
| Docs refs (`npm run docs-refs-check`) | Pass |
| Template sync (`npm run sync-templates:check`) | Pass |
| Bash 3.2 smoke (`/bin/bash` 3.2.57) | Pass |
| zsh smoke, including no-`compdef` case | Pass |
| tcsh syntax and load | Pass |
| bash, zsh, tcsh syntax checks (AC-9) | Pass |
| fish syntax and runtime (AC-9) | Not run locally — CI-only |
| E2E | N/A — no UI surface (per spec) |

Code review's final round returned **Approved with nits** (`tasks/shell-completion/review.md`). The nits are R10–R13, all non-blocking.

## Human Verification Required

None.

Note: fish checks were not run locally. They are CI-verified only, and the pre-merge check "Final CI/CD checks green" is still open.

## Proposed Changelog

- **`canon completion` prints a shell completion script for bash, zsh, fish, and tcsh.** Add one line to your shell startup file (the line is printed by `canon completion --help`), and Tab completes commands, `task` subcommands, flags, phase names, review verdicts, task sizes, and task ids. Task ids complete from any directory in the repo, including a linked worktree. Completion never offers a flag canon would reject.

## Decisions Made

- **Scripts are generated, not shipped.** `canon completion <shell>` writes the script at run time from the command registry and the command declarations. Nothing is added to the npm package, and `canon init` and `canon upgrade` never write rc files.
- **Task-id lookup is shell-side.** Tab presses read the main checkout's `tasks/` directory directly, so they never start canon or Node. The lookup does not change how `canon task` itself finds `tasks/` (#122 stays separate).
- **tcsh uses a file-and-`source` install line,** not a backtick `eval`, because the multi-line script does not survive `eval`.
- **Shared value sets are exported constants** that the validators read: `SIZE_ORDER` replaces `TASK_SIZE_VALUES`; accept phases, update channels, and the `task set` field-to-value record are new exports. Error text and exit codes are unchanged; the existing tests pass without edits.
- **The registry lives in its own module** (`src/cli/registry.ts`), not in `src/cli/index.ts`, because the CLI entry point dispatches on `process.argv` at import time.
- **Four declaration snippets in `tests/recovery-hints.test.ts` were shortened** so inline completion metadata does not break their line matches. The spec allowed this in Affected Files.
- **Parser migration to `util.parseArgs` is deferred** to a BACKLOG follow-up, as the spec says.

## Open Questions

- **Fish verification.** Fish syntax and runtime checks have only run in CI. Confirm the CI run is green on the PR head before merging.
- **tcsh regression guard (R13).** The guard that protects the tcsh script from slashes is a text scan, not a live tcsh session. A pty-based smoke test would be stronger. Decide whether to file it as a follow-up.
- **Deferred non-blocking findings (R10–R12).** These cover future equals-value completion, an invalid `--until=` invocation, and shell escaping for task directory names with spaces. No current declaration or valid task id exercises them. Decide whether to track them.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 3
- Validation gaps: 1
- Notes: Code review auto-blocked after three rounds (AC-3b, AC-6, AC-9 found partial or failing); fish checks ran only in CI.
