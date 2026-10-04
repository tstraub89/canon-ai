## Summary

- `getAffectedFiles` used to turn a failed `git diff <base>...HEAD` into an empty list, so scope guards read "couldn't read the diff" as "nothing changed" and failed open. It now returns an explicit `ok`/`stderr` result with no files field on failure, so every caller has to handle it.
- Full-send review router and code-review pre-flight now block `code_review` with the git error instead of advancing to QA or misrouting to re-implement. Existing bundle precedence is kept (SPEC GAP halts, requested changes reroute, only advancing bundles get the new block).
- `--pr`/`--push` drift abort reports that task-changed files couldn't be computed rather than giving wrong rebase advice; `--force` does not bypass it.
- Implement phase continues on failure but tells the agent to run the full check matrix instead of claiming "no prior commits".

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (1,348 tests, 1,347 pass, 1 skipped: an existing linked-worktree fixture guarded by `.git` write access)
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Behavior change: `--force` no longer skips the task-changed probe when tree drift is present; an unreadable diff dies even with `--force`. Successful-diff force override is unchanged.
- In the SPEC GAP path with an unreadable diff, the message requires repairing the base/history and verifying scope manually before blessing, since the later `--pr` drift gate skips when the base fetch fails.
- Regression tests were written red-first and failed on the old behavior before the fix.
- Follow-up not in this PR: a sibling evidence probe has the same fail-open shape.
