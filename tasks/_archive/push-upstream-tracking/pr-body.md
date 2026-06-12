## Summary

- `canon run --pr` previously pushed the task branch with a bare `git push origin <branch>`, leaving the local worktree branch without an upstream tracking ref. After the push, `git status` reported no upstream and bare `git pull`/`git push` failed with "no upstream configured."
- Added `-u` (`--set-upstream`) to both `human_review` push call sites in `scripts/run-task/main.ts` (clean-tree path ≈line 1117 and dirty-tree commit-then-push path ≈line 1215).
- After `--pr`, the worktree branch now tracks `origin/<branch>`: `git status` shows the tracking header, and bare git operations work. Re-running `--pr` is idempotent — `-u` is a safe no-op on an already-tracking branch.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/scripts/run-task.js` after source change; committed)

## Notes

- Both push sites changed identically — same `gitSafeAt(cwd, 'push', '-u', 'origin', branchName)` call. They're independent code paths (clean vs. dirty tree) but share the same `die(...)` failure contract, which is verified unchanged by the push-failure regression test.
- Test coverage added in `tests/run-task-safety.test.ts` (fake-git argv assertions for both paths + push-failure regression) and `tests/run-task-ship.test.ts` (real-git `--pr` run asserting `rev-parse --abbrev-ref @{upstream}` and `status -sb` header, plus a second `--pr` run for idempotence).
