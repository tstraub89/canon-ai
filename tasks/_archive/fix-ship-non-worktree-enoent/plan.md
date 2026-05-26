# Plan: fix-ship-non-worktree-enoent

> Verdict: approved_with_nits. The two nits (AC cross-reference in spec.md:112 and helper count in spec.md:131) are editorial only — they do not block implementation. This plan is written against the correct ACs.

## Context

`shipTasks` in `scripts/run-task/main.ts` (lines 1570–1730) calls `splitGit.ensureCheckedOutBaseBranch(taskIds)` at line 1647, switching REPO_ROOT to the base branch. For non-worktree tasks, `tasks/<id>/` does not exist on the base branch until the PR squash-merge + `git pull` completes (which happens inside `mergeOpenPRsAndPull`). Four helpers — and the archive loop itself — read `status.json` AFTER the branch switch, causing ENOENT.

The fix: capture `baseBranch` and a per-task snapshot (branch name, worktree flag, full `StatusJson`) before the switch, then thread those values into every post-switch reader.

---

## Step 1 — Pre-implementation audit

Before writing any code, grep for all callers of the four helpers being refactored:

```bash
grep -n "mergeOpenPRsAndPull\|assertLocalBaseInSyncWithOrigin\|assertNoOpenPRForTask\|assertOriginTaskBranchAbsent" scripts/run-task/main.ts
```

Confirm each helper is only called from `shipTasks` (and, for `assertOriginTaskBranchAbsent`, also from inside `mergeOpenPRsAndPull`). Type-check will catch any missed external callers after the signature changes, but this grep ensures there are no surprises in the same file.

---

## Step 2 — Build the pre-switch snapshot in `shipTasks`

**Location**: `scripts/run-task/main.ts`, inside `shipTasks`, immediately before line 1647 (`splitGit.ensureCheckedOutBaseBranch(taskIds)`).

**Add** (before `ensureCheckedOutBaseBranch`):

```typescript
// Capture baseBranch and per-task state before the branch switch.
// After ensureCheckedOutBaseBranch, REPO_ROOT is on the base branch where
// tasks/<id>/ does not exist yet for non-worktree tasks (it arrives only
// after the squash-merge + git pull inside mergeOpenPRsAndPull).
const baseBranch = splitGit.getBaseBranch(taskIds);
type TaskSnapshot = { branch: string; worktree: boolean; status: StatusJson };
const taskSnapshot = new Map<string, TaskSnapshot>();
for (const taskId of taskIds) {
    const s = splitState.readStatus(taskId);
    taskSnapshot.set(taskId, {
        branch: resolveTaskBranchName(taskId),
        worktree: s.worktree === true,
        status: s,
    });
}
const branchByTaskId = new Map(taskIds.map(id => [id, taskSnapshot.get(id)!.branch]));
```

**Delete** the post-switch `baseBranch` capture at line 1676:
```typescript
const baseBranch = splitGit.getBaseBranch(taskIds);  // DELETE this line
```
`baseBranch` is now available from the pre-switch capture.

---

## Step 3 — Update `assertLocalBaseInSyncWithOrigin`

**Current signature** (line ~1134):
```typescript
function assertLocalBaseInSyncWithOrigin(taskIds: string[]): void {
    const baseBranch = getBaseBranch(taskIds);
    // ...
}
```

**New signature** (drop `taskIds`; it was only used to derive `baseBranch`):
```typescript
function assertLocalBaseInSyncWithOrigin(baseBranch: string): void {
    // remove the const baseBranch = getBaseBranch(taskIds) line; use the param
    // ...
}
```

**Update caller** at line ~1661:
```
assertLocalBaseInSyncWithOrigin(taskIds)
→ assertLocalBaseInSyncWithOrigin(baseBranch)
```

---

## Step 4 — Update `assertNoOpenPRForTask`

**Current signature** (line ~1365):
```typescript
function assertNoOpenPRForTask(taskId: string): void {
    const branchName = resolveTaskBranchName(taskId);
    const baseBranch = splitGit.getBaseBranch([taskId]);
    // ...
}
```

**New signature** (drop `taskId`; it was only used to derive `branchName` and `baseBranch`):
```typescript
function assertNoOpenPRForTask(branchName: string, baseBranch: string): void {
    // remove the two derivation lines; use the params directly
    // ...
}
```

**Update caller** at line ~1662:
```
assertNoOpenPRForTask(taskId)
→ assertNoOpenPRForTask(taskSnapshot.get(taskId)!.branch, baseBranch)
```

---

## Step 5 — Update `assertOriginTaskBranchAbsent`

**Current signature** (line ~1248):
```typescript
function assertOriginTaskBranchAbsent(taskId: string): void {
    const branchName = resolveTaskBranchName(taskId);
    const baseBranch = splitGit.getBaseBranch([taskId]);
    // ...
}
```

**New signature** (keep `taskId`; add two new params):
```typescript
function assertOriginTaskBranchAbsent(taskId: string, branchName: string, baseBranch: string): void {
    // remove the two derivation lines; use the params directly
    // ...
}
```

**Update caller at line ~1670** (in `shipTasks`):
```
assertOriginTaskBranchAbsent(taskId)
→ assertOriginTaskBranchAbsent(taskId, taskSnapshot.get(taskId)!.branch, baseBranch)
```

**Update caller inside `mergeOpenPRsAndPull`** at the local-delete-failed loop (~line 1481) — see Step 6.

---

## Step 6 — Update `mergeOpenPRsAndPull`

**Current signature** (line ~1444):
```typescript
function mergeOpenPRsAndPull(taskIds: string[]): boolean {
    const baseBranch = splitGit.getBaseBranch(taskIds);                           // DELETE
    const branches = [...new Set(taskIds.map(id => resolveTaskBranchName(id)))];  // REPLACE
    // ...
}
```

**New signature**:
```typescript
function mergeOpenPRsAndPull(
    taskIds: string[],
    baseBranch: string,
    branchByTaskId: Map<string, string>,
): boolean {
    const branches = [...new Set(taskIds.map(id => branchByTaskId.get(id) ?? `task/${id}`))];
    // rest of body unchanged except the local-delete-failed loop below
}
```

In the **local-delete-failed loop** (lines ~1479–1483):
```typescript
// BEFORE
for (const taskId of taskIds) {
    if (resolveTaskBranchName(taskId) === branch) {
        assertOriginTaskBranchAbsent(taskId);
    }
}

// AFTER
for (const taskId of taskIds) {
    if ((branchByTaskId.get(taskId) ?? `task/${taskId}`) === branch) {
        assertOriginTaskBranchAbsent(taskId, branch, baseBranch);
    }
}
```

**Update caller** at line ~1650 in `shipTasks`:
```
const merged = mergeOpenPRsAndPull(taskIds);
→ const merged = mergeOpenPRsAndPull(taskIds, baseBranch, branchByTaskId);
```

---

## Step 7 — Fix archive loop reads

**Location**: the `for (const taskId of taskIds)` loop inside `shipTasks` starting at line ~1682.

Replace the `readStatus` and `resolveTaskBranchName` calls with snapshot lookups:

```typescript
// BEFORE (lines ~1684–1685)
const status = splitState.readStatus(taskId);
const hasWorktree = status.worktree === true;

// AFTER
const { status, worktree: hasWorktree } = taskSnapshot.get(taskId)!;
```

```typescript
// BEFORE (line ~1702)
const branchName = resolveTaskBranchName(taskId);

// AFTER
const { branch: branchName } = taskSnapshot.get(taskId)!;
```

`status` is the snapshot object — mutations (`status.updated = ...`, `humanReview.status = 'done'`) are fine since we write back to disk immediately after.

---

## Step 8 — AC-10 grep verification (run after all edits)

Confirm zero hits for post-switch reads within `shipTasks` and within the four updated helper bodies:

```bash
grep -n "readStatus\|getBaseBranch\|resolveTaskBranchName" scripts/run-task/main.ts
```

Any occurrence inside `shipTasks` on a line number AFTER `ensureCheckedOutBaseBranch`, or inside the bodies of the four helpers, is a bug. Type-check independently catches any missed callers of the updated signatures.

---

## Step 9 — Write AC-7 test: non-worktree `--ship` with base branch lacking task dir

**File**: `tests/run-task-safety.test.ts` — add after the existing smoke test at line ~1389.

**Test goal**: prove `--ship` completes without ENOENT when real `git checkout main` removes `tasks/<id>/` from disk before the snapshot would have been read.

**Why real git is required**: the existing smoke test at line 1346 uses fake git, whose `checkout` command only updates a text file — `tasks/<id>/` remains on disk regardless of the simulated branch. The fake-git test cannot reproduce the ENOENT. The new test uses `makeGitFixture` (real bare origin + real local clone) so the real `git checkout main` actually removes the task dir.

**Fixture setup**:

1. `makeGitFixture(dir)` → `localDir`, `originDir`
2. `fakeBins` directory with `setupFakeCliTools` (provides fake `gh`)
3. In `localDir`: `git checkout -b task/ship-nw`; create `tasks/ship-nw/status.json` (`makeCompleteStatus('ship-nw', 'task/ship-nw')`) and a minimal `tasks/ship-nw/spec.md`; `git add tasks/ship-nw`; commit; push to origin
4. Create `thirdPartyDir` (clone of `originDir`): copy the same `tasks/ship-nw/` files, commit, `git push origin main` — puts task content on `origin/main`, simulating the squash-merge result that `git pull` will deliver inside `mergeOpenPRsAndPull`
5. Keep `localDir` on `task/ship-nw`; local `main` does NOT have `tasks/ship-nw/`

**Manual pre-fix bug reproduction** (AC-7 requirement, done by implementer, NOT committed):
Before writing any fix code, run the fixture against the unpatched `shipTasks`. Record the exact ENOENT error string in `handoff.md` under validation notes. This is the one-shot evidence that the fixture actually exercises the failing path.

**Run the test** via `runNodeInline` with `cwd = localDir` (so `REPO_ROOT` resolves to `localDir` via `git rev-parse --git-common-dir`) and absolute import path for `main.ts` (relative imports don't work from a temp dir):

```typescript
const mainHref = pathToFileURL(path.join(REPO_ROOT, 'scripts/run-task/main.ts')).href;
const script = [
    `import(${JSON.stringify(mainHref)})`,
    `.then(m => {`,
    `  process.argv = ['node', 'canon', 'ship-nw', '--ship'];`,
    `  return m.main();`,
    `})`,
    `.catch(err => { console.error(err); process.exit(1); });`,
].join('\n');
const result = runNodeInline(script, {
    ...process.env,
    PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
    FAKE_GH_PR_NUMBER: '42',
    FAKE_GH_PR_HEAD: 'task/ship-nw',
    FAKE_GH_PR_BASE: 'main',
}, localDir);
```

**Assertions**:
- `assert.equal(result.status, 0, result.stderr)`
- `assert.match(result.stdout, /Shipped 1 task to _archive\//)`
- `assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', 'ship-nw')))`

No cleanup needed beyond `withTempDir`'s automatic removal of `dir`.

---

## Step 10 — AC-8 audit: add comment to existing smoke test

**Location**: `tests/run-task-safety.test.ts` line ~1346, the `'main --ship still works when the task is already complete'` test.

**Finding**: this test uses fake git (via `setupFakeGit`) whose `checkout` command only updates a text file rather than moving git-tracked files on disk. `tasks/ship-smoke/` is written to the real filesystem and stays accessible regardless of the simulated branch. The test exercises the "task already at complete" path but does NOT reproduce the non-worktree ENOENT: the task dir is never absent during any status read.

**Add a one-line comment** immediately above `void test('main --ship still works when the task is already complete', ...`:

```typescript
// Fake git: checkout doesn't remove files, so tasks/<id>/ stays on disk regardless of branch.
// This exercises complete/archived state; the non-worktree ENOENT is covered by the real-git test below.
```

---

## Step 11 — Write AC-9 test: worktree-mode `--ship`

**File**: `tests/run-task-safety.test.ts` — add after the AC-7 test.

**Test goal**: confirm the snapshot approach doesn't regress worktree-mode shipping. In worktree mode, `resolveTaskCwd` returns the worktree path, so `readStatus` always read from the worktree (not REPO_ROOT) — the pre-fix code happened to work for worktree tasks too. The new pre-capture snapshot must still read from the right place.

**Why real git is required**: `teardownWorktree` calls `git worktree remove`, and `getActiveCwd` / `resolveTaskCwd` rely on `git worktree list --porcelain`. Both need real git worktree infrastructure.

**Fixture setup**:

1. `makeGitFixture(dir)` → `localDir`, `originDir`
2. `worktreesRoot = path.join(dir, 'worktrees')`; `worktreeDir = path.join(worktreesRoot, 'ship-wt')`
3. `fakeBins` with `setupFakeCliTools`
4. In `localDir`: `git checkout -b task/ship-wt`; create `tasks/ship-wt/status.json` (`makeCompleteStatus('ship-wt', 'task/ship-wt')` with `worktree: true`) and `tasks/ship-wt/spec.md`; commit; push to origin
5. `git checkout main` in `localDir`; `git worktree add <worktreeDir> task/ship-wt` — creates the worktree at `worktreeDir` on the task branch
6. Create `thirdPartyDir` (clone of `originDir`): copy same `tasks/ship-wt/` files, commit, `git push origin main` — puts task content on `origin/main` so `git pull` delivers it
7. `localDir` is on `main`; `worktreeDir` is on `task/ship-wt` with `tasks/ship-wt/status.json` inside it

**Run the test** with `cwd = localDir`, same absolute-import pattern as AC-7:

```typescript
const result = runNodeInline(script, {
    ...process.env,
    PATH: `${fakeBins}${path.delimiter}${process.env.PATH ?? ''}`,
    FAKE_GH_PR_NUMBER: '43',
    FAKE_GH_PR_HEAD: 'task/ship-wt',
    FAKE_GH_PR_BASE: 'main',
    CANON_WORKTREES_ROOT: worktreesRoot,
}, localDir);
```

**Assertions**:
- `assert.equal(result.status, 0, result.stderr)`
- `assert.match(result.stdout, /Shipped 1 task to _archive\//)`
- `assert.ok(fs.existsSync(path.join(localDir, 'tasks', '_archive', 'ship-wt')))` — archive present in REPO_ROOT
- `assert.ok(!fs.existsSync(worktreeDir))` — worktree torn down

**Cleanup**: wrap the test body in a try/finally that calls `spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: localDir })` if the worktree still exists, so a test failure doesn't leave a dangling worktree. (`withTempDir` removes `dir` but `worktreeDir` is inside `dir` so this is already covered — the finally is belt-and-suspenders for git's tracking.)

**Shared helper**: if Steps 9 and 11 share boilerplate (fixture setup, script construction), extract a `makeShipFixture` or equivalent helper inside the test file. The two tests must remain independent — shared setup is fine, shared assertions are not.

---

## Step 12 — CHANGELOG entry

In `CHANGELOG.md`, under `## [1.5.0] — unreleased`, add to the `### Fixed` section:

```markdown
- **`canon run --ship` no longer crashes with ENOENT for tasks created with `worktree: false`.** Previously the orchestrator switched to the base branch before reading the task's `status.json`, and on the base branch the task directory doesn't exist yet — the very state `--ship` is supposed to resolve. The fix captures `baseBranch` and per-task status once before the branch switch and threads the captured values through the four post-switch helpers (`mergeOpenPRsAndPull`, `assertLocalBaseInSyncWithOrigin`, `assertNoOpenPRForTask`, `assertOriginTaskBranchAbsent`) and the archive loop.
```

---

## Validation checklist (run before marking implement done)

- `npm run lint`
- `npm run type-check` — signature changes surface missed callers as type errors
- `npm test` — including the two new tests
- `npm run docs-refs-check`
- `npm run sync-templates:check`
- `npm run build`

---

## Notes on spec nits (from spec-review.md)

- spec.md:112 references "the new test from AC-5" — should be AC-7 and AC-9. This plan is written against the correct AC numbers.
- spec.md:131 says "one function + two helper signatures" — the actual scope is `shipTasks` plus four helper signature changes. This plan reflects the correct scope.
