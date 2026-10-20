# PR Body: watch-late-attach-crash - Late watch attach reports a crashed run as death

## Summary

- `canon watch <id>` now reports a detached run that crashed before watch attached as a crash (exit 4), with the failure reason and the `canon run <id>` resume command. Before, a crash after a finished phase showed up as "nothing to watch" (exit 2).
- The crash-evidence check (dead orchestrator pid left behind, or a fresh non-zero exit marker in the run log) moved out of `classifyIdle()` into `findCrashEvidence()` in `src/cli/commands/watch.ts`. Both the idle and attach classifiers call it. The freshness comparison now lives in one place.
- Attach `death` carries an optional reason, and the death reporter prints it in the same shape the idle path uses. Without a reason, attach prints the old resume hint.
- Exit-code documentation for `4` in `docs/pipeline-orchestrator.md` (and its template mirror) says the crash evidence applies whether watch attached before or after the run exited.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- A regression test (`tests/watch.test.ts`) reproduces the late-attach miss: a phase finished, the next phase is pending, and the run log ends with a fresh `code=1` marker. Before the fix, it returned `nothing_to_watch`. The test now expects `death` with the reason. It also covers the no-evidence, clean-exit, and stale-marker cases, and an end-to-end `watchCmd` run that checks exit 4.
- The suite passes with one test skipped. That test is the linked-worktree `REPO_ROOT` check, which the sandbox skips because it needs `.git` writes. It has not been run in an unrestricted environment yet.
- Not changed: bundle secondary members with no heartbeat still report "nothing to watch" on a late attach, because their log candidates don't include the primary's log. This is recorded in the spec's Known Risks.
- Not changed: `human_review`, blocked, and complete handling on attach. A fresh crash marker under a pending `human_review` is ignored.
