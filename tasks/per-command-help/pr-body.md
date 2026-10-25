# PR Body: per-command-help - Per-command --help and unknown-flag rejection across the canon CLI

## Summary

- `--help` and `-h` now work at any position in every canon command and every `task` subcommand. Each prints that command's own usage to stdout and exits 0. Help wins over other argument errors in the same call.
- Help never runs the command. `canon init --help` makes no files and skips the dependency check. `canon run --pr --help` works without `gh` on the PATH. `canon task --help` works from a linked worktree canon does not manage.
- Unknown flags are rejected on every command with `Unknown option: <flag>` and a pointer to that command's help. Exit codes are unchanged: 2 for `watch`, 1 for the rest. `update` and `upgrade` also reject stray words, and `upgrade` no longer prints a stack trace.
- Each command declares its flags once, next to its parser. The same declaration feeds the pre-scan and the usage text, and a table test checks the two agree.
- `canon --help` is now a summary. The per-command detail moved to each command's usage, so the copies that had drifted (for example, `--allow-divergent-base` was missing from the top-level help) are gone.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [ ] `npm test` — last full run (1,631 passed, 0 failed) was before the final test-only edit; re-run before merging
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- **Compatibility:** `init`, `doctor`, and `stop` now exit 1 on flags they used to ignore. No caller in this repo passes one. Scripts that do will need the flag removed.
- `canon watch --help` prints usage with no `state=` summary line. The summary-line contract still covers actual watching. `docs/pipeline-orchestrator.md` says so.
- Free-text positions still take dash-leading values: `canon task new foo "-draft title"` and `canon task set foo title "-draft"`. `--base=main` and `--timeout=5s` still parse.
- `canon task accept <id> <phase> --reason "--help"` records `--help` as the reason text. This is covered at the parser level, not against a live task.
