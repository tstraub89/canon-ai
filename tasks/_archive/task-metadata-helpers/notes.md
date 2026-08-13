# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement] `task set` warnings need to key off phase progress in `status.phases`, not the cached top-level `status` pointer, because scaffolded tasks still report `spec` while all phases remain pending.
[implement] `base_branch` reuse needs an explicit empty/whitespace-only rejection before the shared branch validator, since `validateBranchField()` still treats an empty string as the default-base case.
[implement-revision] `task set` has to resolve the task cwd before choosing `status.json`; otherwise worktree-backed tasks write to the supervising checkout and silently bypass the active worktree copy.
[implement-reroute] `worktree` and `base_branch` need the branch-recorded lock before value parsing, or a valid topology change can brick the task state before the guard has a chance to stop it.


