# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement] Child-process tests for `scripts/run-task/main.ts` need the current worktree cwd, not the other checkout root, or they can load stale source and miss the `complete` branch.
[implement] The spawned loader stack must include `tests/md-loader-register.mjs` plus `tsx`; `main()` imports prompt `.md` modules at runtime.
