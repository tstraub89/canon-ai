# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- spec (rev 2): spec_review r1 blocker = separate-git-dir root. Verified in /tmp: main tree has git-dir == common-dir and --show-toplevel is right; linked worktree of a separate-git-dir repo is unrecoverable (git worktree list names the gitdir). Chose main-tree→show-toplevel / linked→parent-of-common-dir split (AC-15) over a Non-Goal, because a Non-Goal would regress `task list` at the root of such repos (works today via cwd-relative tasksRoot). Linked worktrees of separate-git-dir/submodule repos stay a Non-Goal.
- [plan] No spec contradictions found. Decisions taken unattended (recorded in plan Approach): relative CANON_TASKS_DIR_OVERRIDE resolves against cwd at the three override sites (matches state.ts); checkActiveOrchestrators keeps its cwd param and enumerates tasksDir(cwd); review-archive.ts needs no change.
