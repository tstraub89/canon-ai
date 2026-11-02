# PR Body: ship-merge-method - Let --ship merge with the repo's configured method

## Summary

- `--ship` now merges the task PR with the method set under the `ship.merge_method` key in `.canon/config.json` (squash, rebase, or merge). Squash stays the default, so repos without the setting behave as before.
- Before any local change, `--ship` checks GitHub's allowed merge methods when there is an open task PR to merge. If the method isn't allowed, or the PR listing or repo settings can't be read, it stops with the configured method, the setting name, and the allowed methods. The working tree, branch, and telemetry notes are left alone.
- A merge that fails without merging now restores the telemetry notes `--ship` set aside before it exits. Before this, the notes were stranded in a temp backup.
- Progress lines, recovery hints, `--ship` help, and the pipeline docs name the configured method instead of "squash". The guard hook now denies every `gh pr merge` strategy on `task/*` PRs, and its deny message explains how to set `ship.merge_method`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- The pre-flight adds one read-only `gh` call (open-PR listing, then `gh repo view`) before any `--ship` that has an open PR. A confirmed-empty listing, such as a PR merged outside canon, skips the settings query.
- The guard hook previously allowed direct `--rebase` and `--merge`; since `--ship` can now do both, it denies them too (spec Amendment). The `--ship` open-PR hint now says to merge in the GitHub UI if needed.
- Rebase-merge adds several commits per task to the base branch, including canon's artifact commits. Merge-commit usually gives a fast-forward protected-base pull.
- The live-GitHub check (set each method on a repo that allows it and ship a task) has not been run. The method, pre-flight, and recovery paths are covered by the fake-`gh` integration tests.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
