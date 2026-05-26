# Spec: fix-ship-non-worktree-enoent — Fix `canon run --ship` ENOENT for non-worktree tasks

> Written by: Claude | Review by: Codex
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

For a task with `worktree: false`, `canon run <id> --ship` crashes with `ENOENT: no such file or directory, open '<repo>/tasks/<id>/status.json'`. Documented in `docs/BACKLOG.md` L546; reported by GP 2026-05-24.

**Sequencing inversion in `shipTasks`** (`scripts/run-task/main.ts:1570-1730`):

1. Line 1647: `ensureCheckedOutBaseBranch(taskIds)` switches the working tree from the task branch to the base branch.
2. Line 1650: `mergeOpenPRsAndPull(taskIds)` is called.
3. Line 1650's helper calls `getBaseBranch(taskIds)` at `main.ts:1445`, which calls `readStatus(id)` at `git.ts:113`.
4. `readStatus` resolves via `statusFileFor(taskId)` → `resolveTaskCwd(taskId)`. For **non-worktree** tasks `resolveTaskCwd` falls back to `REPO_ROOT`; REPO_ROOT is now on the base branch where `tasks/<id>/status.json` does not yet exist (the PR merge that would put it there is the step `--ship` is supposed to perform next). ENOENT.
5. Worktree-mode tasks escape because `resolveTaskCwd` finds the task's worktree (still present until teardown at line 1688), so the read succeeds before the worktree is torn down.

**The bug has more post-switch readers than the first-failing call**:

- `assertLocalBaseInSyncWithOrigin(taskIds)` at line 1661 calls `getBaseBranch(taskIds)` at line 1135 — same ENOENT path on the no-PR-merged branch.
- `assertOriginTaskBranchAbsent(taskId)` at line 1670 (and the same helper at line 1481 inside `mergeOpenPRsAndPull` on the local-delete-failed path) calls `getBaseBranch([taskId])` at line 1250.
- `resolveTaskBranchName(taskId)` at line 1183 reads `splitState.readStatus(taskId).branch` to find each task's recorded branch and falls back to `task/<id>` if status is missing. It's called post-switch from `mergeOpenPRsAndPull` (line 1447), `assertNoOpenPRForTask` (line 1366), `assertOriginTaskBranchAbsent` (line 1249), and the archive loop (line 1702). For non-worktree tasks whose recorded branch is not the conventional `task/<id>` form, the silent fallback makes downstream code query, merge, verify, or delete the *wrong* branch — a worse failure mode than ENOENT.
- The archive loop at line 1684 reads `splitState.readStatus(taskId)` directly for the worktree flag — same ENOENT path.

**Severity:** blocks `--ship` for any non-worktree adopter. Workaround is manual `gh pr merge --squash --delete-branch && git pull && canon run --ship` — undermines `--ship`'s value proposition. canon-ai-dev itself uses worktrees so dogfood does not exercise the failing path; this is an adopter-only bug.

**Why the existing smoke test misses it:** `tests/run-task-safety.test.ts:1346` runs `main --ship` against a task built by `makeCompleteStatus()` (line 293), which sets `worktree: false`. The test passes today despite using the failing config, so either the test's git environment short-circuits the post-switch read (e.g., the fake remote and the local both have the task dir) or the assertions are too loose to surface the ENOENT. This is part of the audit work.

## Decision

Capture all status.json-derived values at the top of `shipTasks` — before `ensureCheckedOutBaseBranch` — and thread them through every helper that currently re-reads status in the post-switch code path. Touch only `shipTasks` and the helpers it invokes after the branch switch (`mergeOpenPRsAndPull`, `assertNoOpenPRForTask`, `assertLocalBaseInSyncWithOrigin`, `assertOriginTaskBranchAbsent`, and the archive loop). Do not refactor `state.ts`, `getBaseBranch`, `resolveTaskCwd`, or `resolveTaskBranchName` itself — those are correct for the rest of the orchestrator's reads; the bug is the post-switch call sites in `shipTasks`'s call tree.

Concrete steps:

1. **Capture `baseBranch` once.** At the top of `shipTasks` (before line 1647), call `splitGit.getBaseBranch(taskIds)` and bind the result to a local `const baseBranch`. This call runs while REPO_ROOT is still on the task branch (worktree-mode) or while the task dir still exists (non-worktree on task branch), so the read succeeds.

2. **Capture per-task snapshot once.** Before the branch switch, iterate `taskIds` and build a snapshot shape such as `Map<string, { branch: string; worktree: boolean; status: StatusJson }>` (or equivalent — implementer's choice; the AC just requires that branch name, worktree flag, and the full status be available without re-reading). The `branch` field is the resolved task branch name (use `resolveTaskBranchName(id)` while the read still succeeds — captures the recorded `status.branch`, falling back to `task/<id>` only when actually absent). This snapshot is what later code uses — never re-read via `readStatus` or `resolveTaskBranchName` after the branch switch.

3. **Thread `baseBranch` and resolved branch names into helpers.** Change the signatures of the four post-switch helpers so they no longer re-derive these values:
   - `mergeOpenPRsAndPull(taskIds)` → accepts `baseBranch: string` and a per-task branch lookup (e.g., `branchByTaskId: Map<string, string>` or pass the full snapshot). Body no longer calls `getBaseBranch` or `resolveTaskBranchName`; uses the parameters.
   - `assertNoOpenPRForTask(taskId)` → accepts `branchName: string, baseBranch: string`. Body no longer calls `getBaseBranch` or `resolveTaskBranchName`.
   - `assertLocalBaseInSyncWithOrigin(taskIds)` → either becomes `assertLocalBaseInSyncWithOrigin(baseBranch: string)` (taskIds were only used to look up baseBranch) or accepts `baseBranch` as an added parameter and drops the internal `getBaseBranch` call. Body no longer calls `getBaseBranch`.
   - `assertOriginTaskBranchAbsent(taskId)` → accepts `branchName: string, baseBranch: string`. Body no longer calls `getBaseBranch` or `resolveTaskBranchName`. Both call sites (line 1670 and the local-delete-failed loop at line 1481 inside `mergeOpenPRsAndPull`) pass the captured values.

4. **Use captured snapshot in the archive loop.** Replace `readStatus(taskId)` at `main.ts:1684` and `resolveTaskBranchName(taskId)` at `main.ts:1702` with lookups against the captured snapshot.

5. **Add a non-worktree --ship test.** Build a real fixture where, on the base branch, `tasks/<id>/status.json` does not exist (i.e., the task branch is ahead and the PR is open against the base). Manually verify the pre-fix code reproduces ENOENT by running the new test against the unfixed `main.ts` once (record the captured error message in `handoff.md`'s validation notes — this is evidence, not a runtime check the test performs). The committed test only runs against the fixed code and must complete the ship successfully. Audit `tests/run-task-safety.test.ts:1346` while writing it — figure out why the existing smoke didn't catch the bug. If the existing test's git setup masks the failure, either tighten the existing test or document it (depending on what the audit reveals).

## Non-Goals

- **No `getBaseBranch` / `readStatus` fallback to `git show <task-branch-ref>:tasks/<id>/status.json`.** The BACKLOG entry's "alternative — smaller blast radius" option. Rejected: more action-at-a-distance, harder to reason about, doesn't address the `readStatus` call at line 1684 which is more than just a `getBaseBranch` call.
- **No broader audit of all `readStatus` / `getBaseBranch` / `taskDirFor` / `parseAffectedFilesFromSpec` call sites elsewhere in the orchestrator.** Scope is `shipTasks` and its immediate helpers. Other call sites (implement, code_review, etc.) are not on the post-base-switch code path.
- **No refactor of `state.ts` worktree-aware logic.** `resolveTaskCwd` and `statusFileFor` are correct for the rest of the orchestrator; the bug is exclusively `shipTasks`'s post-switch reads.
- **No worktree-canonical-task-state structural fix.** That is its own in-progress task (`tasks/worktree-canonical-task-state/`) and would subsume this bug as a side effect. Both should land; this is the small fix needed now.
- **No retire of `worktree: false` mode.** Adopters legitimately use it; the fix supports both modes.
- **No change to PR merge mechanics or `gh pr merge` invocation.** The fix is purely about WHEN we read status.json relative to the branch switch.

## Acceptance Criteria

- [ ] **AC-1**: `shipTasks` in `scripts/run-task/main.ts` captures `const baseBranch = splitGit.getBaseBranch(taskIds)` before the call to `splitGit.ensureCheckedOutBaseBranch(taskIds)`. Verify by reading the function: `getBaseBranch` invocation appears in `shipTasks` lexically before the `ensureCheckedOutBaseBranch` call, with the result bound to a local that's referenced later. No other `getBaseBranch(taskIds)` call appears in `shipTasks` after the branch switch.

- [ ] **AC-2**: `shipTasks` captures a per-task snapshot before the branch switch containing, at minimum, the task's resolved branch name (`resolveTaskBranchName(id)` evaluated pre-switch), the worktree flag, and the full status (e.g., `Map<string, { branch: string; worktree: boolean; status: StatusJson }>` — exact shape is implementer's choice). Populated by iterating `taskIds` BEFORE `ensureCheckedOutBaseBranch`. Verify by reading the function: every `readStatus(id)` / `readStatus(taskId)` call inside `shipTasks` lexically appears BEFORE `ensureCheckedOutBaseBranch`. The archive loop at line 1684 (current) reads worktree flag and status from the captured snapshot, not via `readStatus`. The archive loop's `resolveTaskBranchName(taskId)` call at line 1702 (current) is replaced by a snapshot lookup as well.

- [ ] **AC-3**: `mergeOpenPRsAndPull` accepts `baseBranch: string` and a per-task branch lookup (e.g., `branchByTaskId: Map<string, string>` or equivalent passed alongside `taskIds`) and uses them instead of calling `getBaseBranch(taskIds)` and `resolveTaskBranchName` internally. Verify: function signature includes `baseBranch` (typed `string`) and a branch lookup parameter; the body contains zero matches for `getBaseBranch` and zero matches for `resolveTaskBranchName` (grep within the function); `shipTasks` passes the captured values at the call site. The local-delete-failed loop inside `mergeOpenPRsAndPull` (current line 1479-1483) passes the resolved branch name and `baseBranch` into `assertOriginTaskBranchAbsent` per AC-6.

- [ ] **AC-4**: `assertNoOpenPRForTask` accepts `branchName: string, baseBranch: string` and uses them instead of calling `getBaseBranch([taskId])` and `resolveTaskBranchName(taskId)` internally. Verify: function signature includes both parameters; body has zero matches for `getBaseBranch` and `resolveTaskBranchName`; `shipTasks` passes the captured values at the call site (current line 1662).

- [ ] **AC-5**: `assertLocalBaseInSyncWithOrigin` no longer calls `getBaseBranch` internally — either accepts `baseBranch: string` and drops `taskIds`, or accepts `baseBranch` as an added parameter. Verify: function signature reflects the change; body has zero matches for `getBaseBranch`; `shipTasks` passes the captured `baseBranch` at the call site (current line 1661).

- [ ] **AC-6**: `assertOriginTaskBranchAbsent` accepts `branchName: string, baseBranch: string` and uses them instead of calling `getBaseBranch([taskId])` and `resolveTaskBranchName(taskId)` internally. Verify: function signature includes both parameters; body has zero matches for `getBaseBranch` and `resolveTaskBranchName`; both call sites (current line 1670 in `shipTasks` and the local-delete-failed loop at line 1481 inside `mergeOpenPRsAndPull`) pass the captured values.

- [ ] **AC-7**: A new test in `tests/run-task-safety.test.ts` exercises `canon run --ship` against a task with `worktree: false` where the base branch lacks `tasks/<id>/status.json` (task branch is ahead and the PR is open against the base). The test runs against the fixed code and asserts the ship completes (e.g., `Shipped 1 task to _archive/.` in stdout, archive dir present, no thrown error). The implementer must additionally run the same fixture against the unfixed `main.ts` once during implement (e.g., by temporarily reverting the fix locally) and record the captured ENOENT error verbatim in `handoff.md` under validation notes — this is one-shot evidence that the fixture reproduces the bug, not a runtime gate. The committed test does NOT need to revert the fix or inject a fault.

- [ ] **AC-8**: The existing `--ship still works when the task is already complete` test at `tests/run-task-safety.test.ts:1346` is audited. If its git fixture short-circuits the post-switch read (e.g., the base branch has the task dir too), the audit's finding is recorded as a one-line comment immediately above the test explaining what it actually exercises. If the test was simply silent on the failing path, the comment notes that AC-7's new test is the actual coverage. No silent state.

- [ ] **AC-9**: A new test in `tests/run-task-safety.test.ts` exercises `canon run --ship` against a task with `worktree: true` and a real worktree present on disk. The fixture must mirror the worktree-mode shipping path: status.json lives in the task's worktree (not REPO_ROOT/tasks), and the supervising checkout is on the base branch (or switches to it during `--ship` as production does). The test runs against the fixed code and asserts the ship completes (e.g., `Shipped 1 task to _archive/.` in stdout, archive dir present in REPO_ROOT, the worktree is torn down, no thrown error). Rationale: the existing test file has no worktree-mode `--ship` coverage — every `--ship` invocation uses `makeCompleteStatus(...)` which sets `worktree: false`. Without this test, AC-9 has no real verification target and a future regression to worktree-mode shipping could land silently. Implementer may extract a shared helper from AC-7's fixture if both tests overlap; the invariant is that both worktree modes have committed `--ship` coverage after this task.

- [ ] **AC-10**: No `readStatus`, `getBaseBranch`, or `resolveTaskBranchName` calls appear in `shipTasks` AFTER `ensureCheckedOutBaseBranch`. Verify via `grep -n` against the function range: zero matches for those three symbols on lines greater than the `ensureCheckedOutBaseBranch` line within `shipTasks`. (Same constraint extends transitively to the four helpers updated in AC-3–6: their bodies must not call those symbols, since they execute after the switch.) Use of the captured `baseBranch` and per-task snapshot is fine and expected.

- [ ] **AC-11**: A `CHANGELOG.md` entry under `## [1.5.0] — unreleased` `### Fixed` describes the fix in adopter-facing terms (e.g., "`canon run --ship` no longer crashes with ENOENT for tasks created with `worktree: false`. Previously the orchestrator switched to the base branch before reading the task's `status.json`, and on the base branch the task dir doesn't exist yet — the very state `--ship` is supposed to resolve.").

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | `shipTasks` (lines 1570-1730 in current file): capture `baseBranch` + per-task snapshot (branch name, worktree flag, status) before `ensureCheckedOutBaseBranch` (line 1647). Update `mergeOpenPRsAndPull` signature to accept `baseBranch` and per-task branch lookup; remove its internal `getBaseBranch` (line 1445) and `resolveTaskBranchName` (line 1447) calls; thread captured values into the local-delete-failed `assertOriginTaskBranchAbsent` loop (line 1481). Update `assertNoOpenPRForTask` signature to accept `branchName` and `baseBranch`; remove internal `getBaseBranch` (line 1367) and `resolveTaskBranchName` (line 1366) calls. Update `assertLocalBaseInSyncWithOrigin` to accept `baseBranch`; remove internal `getBaseBranch` (line 1135). Update `assertOriginTaskBranchAbsent` to accept `branchName` and `baseBranch`; remove internal `getBaseBranch` (line 1250) and `resolveTaskBranchName` (line 1249) calls. Replace `readStatus(taskId)` at line 1684 and `resolveTaskBranchName(taskId)` at line 1702 with snapshot lookups. |
| `tests/run-task-safety.test.ts` | TWO new tests. (1) `main --ship handles a task with worktree: false` (per AC-7): constructs a git fixture where the base branch lacks `tasks/<id>/status.json`; asserts `--ship` completes without ENOENT. (2) `main --ship handles a task with worktree: true` (per AC-9): constructs a fixture with a real worktree on disk where status.json lives in the worktree; asserts `--ship` completes and the worktree is torn down. Audit existing test at line 1346 — add explanatory comment if needed (per AC-8). |
| `CHANGELOG.md` | `### Fixed` entry under `## [1.5.0] — unreleased` per AC-11. |

### Interaction Dependencies

- **`getBaseBranch`** in `scripts/run-task/git.ts` (currently line 109): no change. Continues to be the right helper to call from `shipTasks` BEFORE the branch switch (when REPO_ROOT is still on the task branch with the task dir present, OR a worktree resolution succeeds).
- **`resolveTaskCwd` / `statusFileFor` / `readStatus`** in `scripts/run-task/state.ts`: no change. These are worktree-aware for the rest of the orchestrator and only fail in the specific post-base-switch context that this spec addresses by avoiding such reads in `shipTasks`.
- **`resolveTaskBranchName`** in `scripts/run-task/main.ts` (currently line 1183): no change to the helper itself — it continues to be useful in pre-switch contexts. The fix moves its call sites inside the four `shipTasks` helpers earlier, so they no longer invoke it after the switch. Pre-switch use in `assertTaskBranchPushed` (line 1194, called at line 1626) is unchanged.
- **`ensureCheckedOutBaseBranch`** in `scripts/run-task/git.ts` (currently line 249): no change. The function's semantics are correct; the bug is that the caller reads status AFTER it.
- **`mergeOpenPRsAndPull`, `assertNoOpenPRForTask`, `assertLocalBaseInSyncWithOrigin`, `assertOriginTaskBranchAbsent`**: signature change. Body grep + caller grep required at implement time — verify these four helpers are only called from `shipTasks` (likely true; if there are external callers, they need the signature change too). Type-check catches missed call sites.
- **Other orchestrator phases**: no impact. Code paths for `implement`, `code_review`, `qa` do NOT switch branches mid-phase, so their status reads are unaffected.
- **Pipeline policy** (`pipeline-policy.ts`): no impact. No routing decisions change.

### Data Model Changes

None. No `status.json` schema changes, no `StatusJson` type shape changes (we read existing fields into a Map; we don't add new ones).

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`) — signature changes will surface here if any caller is missed
- [x] `unit tests` (`npm test`) — including the new test from AC-5
- [x] `docs-refs-check` (`npm run docs-refs-check`)
- [x] `sync-templates:check` (`npm run sync-templates:check`)
- [x] `build` (`npm run build`) — dist-freshness gate
- [ ] `E2E` — N/A; no UI

## Docs Impact

- `CHANGELOG.md` — `### Fixed` entry per AC-11.
- No other protected docs (`AGENTS.md`, `CLAUDE.md`, `CODEX.md`, `docs/codebase-map.md`, `docs/architecture.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/product-context.md`, `docs/pipeline-orchestrator.md`) need updating. The fix is internal to `shipTasks` and does not change adopter-facing behavior beyond "`--ship` now works for non-worktree tasks."

## Known Risks

- **Other callers of the four updated helpers**: signature change ripples to any caller. Likely none exist outside `shipTasks` (these are file-local helpers in `main.ts`), but the implementer must `grep` and verify. If other callers exist, they need the same threading or a wrapper. Type-check catches this; AC-3 / AC-4 / AC-5 / AC-6 each name the grep.
- **Snapshot shape**: trivial choice. Implementer picks the exact type; the AC requires branch name, worktree flag, and status be available without re-reading. `Map<string, { branch: string; worktree: boolean; status: StatusJson }>` is one natural shape; passing a separate `branchByTaskId: Map<string, string>` alongside an existing status Map is another.
- **Worktree-mode regression**: the fix changes WHEN status is read in `shipTasks` but not WHAT it reads. Worktree-mode tasks already had their status read successfully (via `resolveTaskCwd` → worktree path); moving the read earlier just means it happens while REPO_ROOT is also on the task branch instead of relying on the worktree being present. Both paths should still succeed. AC-9 verifies.
- **The existing `--ship` smoke test (line 1346) audit may surface a deeper issue**: if the test passes the failing path silently, that's also true of any future tests that follow its setup pattern. The audit (AC-8) is the proportionate response — document the actual coverage; don't expand scope into a test-harness rewrite.
- **AC-7's manual pre-fix verification is one-shot evidence, not a runtime check**: the committed test only runs against fixed code. The implementer captures the ENOENT verbatim once during implement (running the fixture against unfixed `main.ts`) and pastes it into `handoff.md`. If the implementer skips this step, the reviewer cannot confirm the fixture actually reproduces the bug — flag in handoff if circumstances prevent the manual run.
- **`ensureCheckedOutBaseBranch` semantics**: relies on the working tree being clean before the switch. The pre-flight at lines 1615-1627 (push verification) and the worktree-mode shared-docs cleanup at lines 1629-1645 already prepare for this. Moving the `getBaseBranch`/`readStatus` calls earlier does not change cleanliness.
- **Delicate-flag domain**: per `docs/product-context.md` L97, orchestrator routing logic is a canon-ai delicate surface. The fix is bounded (one function + two helper signatures) and has explicit AC for worktree-mode regression coverage; the delicate flag is set on this task.

## Human Test Plan

1. From a fresh clone on the merged branch, create a non-worktree task: in `tasks/test-ship-nw/status.json`, set `worktree: false`, `status: "human_review"`, and mark all phases done up through `human_review: pending`.
2. Commit the task dir to a branch other than the base branch (so the base branch doesn't have it yet).
3. Open a draft PR for the branch against the base.
4. From that branch's checkout, run `canon run test-ship-nw --ship`. Expected: the ship completes, the PR squash-merges, the task dir moves to `tasks/_archive/test-ship-nw/`. Previously (pre-fix): the run died with `ENOENT: no such file or directory, open '...tasks/test-ship-nw/status.json'`.
5. Re-run the canon-docs-dedup-style workflow (any worktree-mode task) end-to-end to confirm worktree-mode `--ship` still works.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (full tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs (other callers, worktree-mode regression, existing-test silent-pass)
- [x] Human Test Plan uses concrete operator-level steps
- [x] Validation Required has multiple entries marked `- [x]`
