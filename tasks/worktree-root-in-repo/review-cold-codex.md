The new missing-worktree guard does not detect stale registrations whose path remains on disk but no longer contains a usable checkout. This can bypass the safety check and route a task to the main checkout.

Review comment:

- [P2] Check that registered worktree paths are usable — /Users/tstraub/canon-ai/dev-worktrees/worktree-root-in-repo/src/orchestrator/state.ts:148-150
  If a deleted worktree leaves an empty or stale directory at its registered path, `fs.existsSync(worktree.path)` returns true and this guard allows the run. For canonical tasks whose main-checkout branch is blank, `resolveTaskCwd()` can then fall back to `REPO_ROOT`, allowing phases to run against the wrong checkout; require a usable worktree directory (including its checkout/status markers) before treating the registration as healthy.