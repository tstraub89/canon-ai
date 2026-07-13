The new node_modules validation is bypassed whenever the worktree already exists, so the safety carve-out does not apply on reruns and can leave a bad symlink undetected. That makes the patch incomplete for the scenario it is meant to guard.

Review comment:

- [P2] Revalidate node_modules on existing worktree reuse — /Users/tstraub/canon-ai/dev-worktrees/worktree-node-modules-gate-carveout/scripts/run-task/worktree.ts:142-149
  If `ensureWorktree()` is rerun for a task whose worktree already exists, the `fs.existsSync(wt)` / `findExistingWorktreeForBranch()` early returns skip the new `probeNodeModulesEntry()` check entirely. That means a stale or manually swapped `node_modules` symlink can still survive on the reuse path, so the fail-closed guard only works for first-time creation and not for the common retry case.