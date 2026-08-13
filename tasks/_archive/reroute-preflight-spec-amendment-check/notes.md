# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement] The reroute amendment check has to resolve spec.md through `resolveTaskCwd(taskId)` in worktree-backed tasks. Reading the main checkout spec can approve the wrong content when the worktree copy diverges.
