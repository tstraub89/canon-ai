The added exit-marker check detects some crashes after watch has attached, but misses the same persisted crash when watch starts after the orchestrator exits. In that case the initial attach classification bypasses this check and reports nothing to watch.

Review comment:

- [P2] Detect persisted crashes when watch starts after the exit — /Users/tstraub/canon-ai/.canon/worktrees/watch-crash-not-step-done/src/cli/commands/watch.ts:445-446
  When `canon watch` is first invoked after the orchestrator has already exited with the current phase pending or in progress after a completed phase, `classifyAttach` returns `nothing_to_watch` before `classifyIdle` reaches this exit-marker check. The command therefore exits with code 2 instead of reporting the crash with code 4, so the new behavior only works if watch was already attached when the run died.