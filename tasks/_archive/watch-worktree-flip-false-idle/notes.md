# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] AC-3 looks like it needs the existing worktree integration harness in `tests/run-task-safety.test.ts`, not just the heartbeat/watch unit tests currently listed in Affected Files.
[spec_review] The AC-3 integration case has to seed the heartbeat handle inside the same subprocess that runs `ensureBranch`; the `activeHandles` registry is process-local, so a parent-process handle would not be visible to the worktree creation path.
[implement] AC-3 needed the fake worktree-add harness to copy `tasks/<id>/status.json` into the new worktree so the heartbeat resolver could flip on creation the same way the real repo does.
[implement-reroute] `WORKTREES_ROOT` is captured when `scripts/run-task/env.ts` loads, so the bundle AC-6 harness had to spawn a child process with the override set before importing the run-task modules.

[implement-revision] Pre-flight handoff checks compare the cumulative Changes tables to the branch diff, so a reverted file must be removed from every prior table, not just the newest section.
