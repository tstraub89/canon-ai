# QA Summary: fix-ship-non-worktree-enoent

> Phase: qa | Reviewer: Claude | Date: 2026-05-25

## What Changed

`canon run --ship` crashed with `ENOENT: no such file or directory, open '…tasks/<id>/status.json'` for any task with `worktree: false`. The crash occurred because `shipTasks` switched REPO_ROOT to the base branch before several helper functions re-read `status.json`. On the base branch, the task directory doesn't exist yet — that's precisely the state `--ship` is there to resolve.

The fix captures all status-derived values at the top of `shipTasks`, before the branch switch, then threads them through every post-switch helper:

- `baseBranch` (string) captured once via `getBaseBranch(taskIds)` before `ensureCheckedOutBaseBranch`.
- Per-task snapshot (`Map<string, { branch, worktree, status }>`) built by iterating `taskIds` before the switch, using `resolveTaskBranchName(id)` while the read still succeeds.
- Four post-switch helpers updated to accept captured values instead of re-deriving them:
  - `mergeOpenPRsAndPull` — accepts `baseBranch` and `branchByTaskId`
  - `assertNoOpenPRForTask` — accepts `branchName` and `baseBranch`
  - `assertLocalBaseInSyncWithOrigin` — accepts `baseBranch` (drops internal `getBaseBranch`)
  - `assertOriginTaskBranchAbsent` — accepts `branchName` and `baseBranch` (drops `taskId`)
- Archive loop uses the captured snapshot instead of calling `readStatus(taskId)` or `resolveTaskBranchName(taskId)` post-switch.

Worktree-mode `--ship` was not broken, but also had no committed test coverage. The task adds regression tests for both modes.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | `shipTasks` pre-switch snapshot; four helper signature changes; archive loop snapshot lookup. |
| `tests/run-task-safety.test.ts` | Two new real-git `--ship` tests (non-worktree, worktree); audit comment above existing fake-git smoke. |
| `CHANGELOG.md` | `### Fixed` entry under `## [1.5.0] — unreleased` (AC-11). |
| `dist/scripts/run-task.js` | Rebuilt bundle via `npm run build`. |

## How to Test

**Reproduce the pre-fix crash (one-shot manual — evidence already captured in handoff.md):**

The ENOENT before the fix is recorded in `handoff.md` under "Manual pre-fix reproduction evidence for AC-7":
```
Error: ENOENT: no such file or directory, open '…/tasks/ship-nw-prefixed/status.json'
    at readStatus (state.ts:109)
    at Module.getBaseBranch (git.ts:113)
    at mergeOpenPRsAndPull (main.ts:1445)
    at shipTasks (main.ts:1650)
```

**Human test plan (from spec):**

1. From a fresh clone on the merged branch, create a non-worktree task at `tasks/<id>/` (any task id you like, e.g. `test-ship-nw`). Set `worktree: false`, `status: "human_review"`, all phases done through `human_review: pending` in the task's `status.json`.
2. Commit the task dir to a branch other than base (so base doesn't have it yet).
3. Open a draft PR against the base.
4. From that branch, run `canon run test-ship-nw --ship`. Expected: ship completes, PR squash-merges, task dir moves to `tasks/_archive/test-ship-nw/`. Pre-fix: ENOENT at the step shown above.
5. Run a worktree-mode task's `--ship` end-to-end to confirm no regression.

**Automated:**

```
npm test
```

The two new tests in `tests/run-task-safety.test.ts` cover:
- `main --ship handles a task with worktree: false when base lacks status.json` — real git fixture; base branch lacks task dir; asserts archive completes without error.
- `main --ship handles a task with worktree: true and tears down the worktree` — real git fixture with a linked worktree; asserts archive completes and worktree is removed.

## Test Results

All validation checks passed (run by Codex during implement):

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run build` | Pass |

## Decisions Made

- **Keep existing state helpers intact** (`readStatus`, `getBaseBranch`, `resolveTaskCwd`). These are correct for all other orchestrator phases; the bug was exclusively the post-branch-switch call sites in `shipTasks`. No need to add fallback logic or refactor `state.ts`.
- **`assertOriginTaskBranchAbsent` drops `taskId`** — once the post-switch status reads are removed, the parameter is unused. Codex's deviation; documented in handoff.
- **Snapshot shape: `Map<string, { branch, worktree, status }>`** — implementer's choice per spec. Captures what the four helpers need and is iterable for bundle scenarios.
- **Existing fake-git `--ship` smoke test left with an audit comment** (line 1346 in tests) explaining that fake checkout doesn't remove the task dir on a branch switch, so it cannot reproduce the ENOENT. AC-7's new real-git test supplies the actual coverage.

## Open Questions

None. All 11 ACs met. Pre-fix ENOENT evidence captured in handoff.md. No blockers.

---

## Proposed Changelog

**Already committed to `CHANGELOG.md` by Codex as part of AC-11:**

> **`canon run --ship` no longer crashes with ENOENT for tasks created with `worktree: false`.** Previously the orchestrator switched to the base branch before reading the task's `status.json`, and on the base branch the task directory does not exist yet — the very state `--ship` is supposed to resolve.

This entry is correctly placed in `### Fixed` under `## [1.5.0] — unreleased`. No change needed.

**Proposed version:** No additional bump. This is a `patch`-class bug fix (adopter-blocking crash), already correctly scoped to the in-progress `1.5.0` release.
