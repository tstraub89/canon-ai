# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `shipTasks` has post-base-switch status-derived reads beyond the spec's helper list: `assertLocalBaseInSyncWithOrigin`, `assertOriginTaskBranchAbsent`, and `resolveTaskBranchName` call paths need pre-switch snapshots too.
[spec_review] Revised spec expects an existing worktree-mode `--ship` test, but current `tests/run-task-safety.test.ts` only runs `--ship` for a `worktree: false` fixture.
[implement] Real-git subprocess tests must import `main.ts` from the active worktree (`process.cwd()`), not `REPO_ROOT`; `REPO_ROOT` resolves to the supervising checkout in linked-worktree test runs.

