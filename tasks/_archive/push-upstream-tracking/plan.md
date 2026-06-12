# Implementation Plan: push-upstream-tracking

> Written by: Claude | Implements: `tasks/push-upstream-tracking/spec.md`

## Approach

Add `--set-upstream` (`-u`) to the two `git push` argument vectors at the `human_review` push sites in `scripts/run-task/main.ts`. Both sites currently call `gitSafeAt(cwd, 'push', 'origin', branchName)`; the change inserts `'--set-upstream'` before `'origin'`. `-u` is idempotent — a no-op that re-affirms tracking when the branch already tracks origin — so it is safe on the idempotent `--pr` retry path. No control-flow change, no change to the `die(...)` failure handling. Rebuild `dist/scripts/run-task.js`.

## Steps

### Step 1: Add `-u` to the clean-tree push site

Files: `scripts/run-task/main.ts`

At the clean-tree idempotent-retry push (≈ line 1117):
```ts
const pushResult = gitSafeAt(cwd, 'push', '--set-upstream', 'origin', branchName);
```
(currently `gitSafeAt(cwd, 'push', 'origin', branchName)`). Leave the surrounding comment block and the `if (!pushResult.ok) die(...)` handling unchanged.

### Step 2: Add `-u` to the dirty-tree commit-then-push site

Files: `scripts/run-task/main.ts`

At the post-commit push (≈ line 1215):
```ts
const pushResult = gitSafeAt(cwd, 'push', '--set-upstream', 'origin', branchName);
```
Same shape; preserve the failure-handling.

### Step 3: Rebuild dist

Files: `dist/scripts/run-task.js`

Run `npm run build` and commit the regenerated `dist/scripts/run-task.js` (bundles `scripts/run-task/**`). Confirm `git diff --exit-code -- dist/` is clean after build (CI gate).

## Testing Plan

- **Unit**: Add/extend a test asserting both push sites issue `--set-upstream`. If `gitSafeAt` is not directly spy-able, an integration-style test that runs `--pr` against a throwaway local bare remote and then asserts `git -C <worktree> rev-parse --abbrev-ref <branch>@{upstream}` resolves to `origin/<branch>` (AC-3) and `git status -sb` shows the tracking header (AC-4). Reference existing push/worktree tests in `tests/` for the harness pattern.
- **Manual**: After `canon run <id> --pr`, in the worktree run `git status` (expect "up to date with 'origin/…'") and bare `git pull` / `git push` (expect no "no upstream configured").
- **E2E**: N/A (no UI).

## Rollback Plan

Trivial — revert the two-line change and rebuild `dist/`. No data migration, no state shape change. A branch pushed with `-u` is indistinguishable on origin from one pushed without; only the local tracking ref differs, which is harmless to leave or drop.
