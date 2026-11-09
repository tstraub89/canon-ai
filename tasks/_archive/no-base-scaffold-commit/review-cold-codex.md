The sync path can irreversibly delete untracked task files that merely collide with incoming tracked paths, without confirming they are disposable backups. Other reviewed changes did not reveal a definite issue.

Review comment:

- [P2] Preserve untracked task files before syncing — /Users/tstraub/canon-ai/.canon/worktrees/no-base-scaffold-commit/src/orchestrator/git.ts:238-239
  When an untracked file under `tasks/` has the same path as a file in the incoming branch, this unlinks it before the pull or reset without verifying it is a stale Canon backup. If the file contains local work, the sync silently destroys it; refuse the sync or preserve the file unless its backup provenance is known.