# PR Body: shell-completion - Shell completion for the canon CLI (bash, zsh, fish, tcsh)

## Summary

- Adds `canon completion <bash|zsh|fish|tcsh>`, which prints a completion script to stdout. Users add one line to their shell startup file; `canon init` and `canon upgrade` still never touch rc files.
- Completion covers top-level commands, `task` subcommands, every declared flag, and the values canon's own validation accepts: phases, statuses, review verdicts (verdicts only after a review phase, `spec_gap` only after `code_review`), task sizes, `--until`, `--channel`, and `task set` fields and values.
- Task ids complete from the main checkout's `tasks/` directory, so they work from a subdirectory and a linked worktree. Tab never starts canon or Node.
- The scripts are generated from the same `ArgDeclaration`s that drive `--help` and unknown-flag rejection. Shared value sets (`SIZE_ORDER`, accept phases, update channels, the `task set` field-value record) are exported and read by the validators, which replaces `TASK_SIZE_VALUES` and the inline literal checks. Error text and exit codes are unchanged.
- tcsh completes commands, subcommands, and flags only; its install line sources a file because a multi-line script does not survive a backtick `eval`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Fish is not installed on the machine I used, so the fish syntax and runtime checks ran only in CI. CI installs `zsh`, `fish`, and `tcsh` before the test step, and the completion suite fails rather than skips when `CI` is set. Please confirm the CI run is green before merging.
- Bash smoke tests also ran under `/bin/bash` 3.2.57, since macOS ships it. The bash script avoids bash-4-only constructs.
- Four declaration snippets in `tests/recovery-hints.test.ts` were shortened so the new inline metadata does not break their line matches.
- Deferred, non-blocking follow-ups from review: the tcsh slash-character guard is a text scan rather than a live tcsh session (a pty smoke test would be stronger); completion for equals-value flags, an invalid `--until=` form, and task directory names containing spaces are not exercised by any current declaration.
- Parser migration to `util.parseArgs` stays a BACKLOG follow-up. `docs/BACKLOG.md` now carries only that follow-up.
