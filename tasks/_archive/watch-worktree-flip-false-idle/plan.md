# Plan: watch-worktree-flip-false-idle

> Written by: Claude | Implements: `tasks/watch-worktree-flip-false-idle/spec.md`

## Overview

Three files change (heartbeat.ts, worktree.ts) plus three test files — five ordered steps. No new modules; no changes to existing watch/gatherRunContext logic. The fix is purely additive: expose the existing `writeOnce` closure as a `tick()` method, sweep all active handles from a new `tickAllHeartbeats()` export, and call it inside `ensureWorktree` best-effort so the worktree task dir has a fresh `.heartbeat.json` before the orchestrator proceeds past worktree creation.

Spec-review nit addressed in Step 4: the AC-3 integration test calls `ensureBranch` **in-process** (not via `runNodeInline`) because `activeHandles` is process-local. The dirty-source-file tests use `runNodeInline` because they exercise `die()` (process.exit); AC-3 does not, so a direct call works and keeps the seeded handle in the same registry.

---

## Step 1 — Add `tick()` to `HeartbeatHandle` and export `tickAllHeartbeats()` (`heartbeat.ts`)

**File**: `scripts/run-task/heartbeat.ts`

### 1a. Extend the `HeartbeatHandle` interface (current lines 49–52)

```typescript
export interface HeartbeatHandle {
    stop: () => void;
    tick: () => void;    // force one synchronous write; resolves dir dynamically at call time
}
```

### 1b. Wire `writeOnce` as the `tick` method on the returned handle

The `writeOnce` closure (lines 70–97) already resolves the target dir dynamically per call and is already wrapped best-effort internally (FS errors caught per-task at lines 92–95; resolver throws caught at lines 82–84). Simply add `tick: writeOnce` to the handle literal built at lines 106–127:

```typescript
const handle: HeartbeatHandle = {
    stop: (): void => {
        clearInterval(timer);
        activeHandles.delete(handle);
        for (const taskId of taskIds) {
            let dir: string;
            try { dir = resolveTaskDir(taskId); } catch { continue; }
            try { fs.unlinkSync(path.join(dir, HEARTBEAT_FILENAME)); } catch { /* already gone */ }
        }
    },
    tick: writeOnce,    // same write the interval performs; dir resolved dynamically at call time
};
```

No other change inside `startHeartbeat`.

### 1c. Add `tickAllHeartbeats()` after `stopAllHeartbeats()` (after line 141)

```typescript
/**
 * Fire one synchronous heartbeat tick on every active handle. Called by
 * ensureWorktree immediately after worktree creation so the worktree task dir
 * has a fresh .heartbeat.json before the orchestrator advances to implement.
 * Best-effort: each handle's writeOnce already swallows FS errors internally.
 */
export function tickAllHeartbeats(): void {
    for (const handle of [...activeHandles]) {
        handle.tick();
    }
}
```

Mirrors `stopAllHeartbeats` exactly — iterate a snapshot (spread) of the set. No outer try/catch needed: `writeOnce` already catches all FS errors per-task and all resolver throws. Any remaining unforeseen throw propagates to the call site in `ensureWorktree`, which wraps the whole call best-effort (Step 2).

---

## Step 2 — Call `tickAllHeartbeats()` in `ensureWorktree` (`worktree.ts`)

**File**: `scripts/run-task/worktree.ts`

### 2a. Add `tickAllHeartbeats` to the import from `./heartbeat.js`

```typescript
import { tickAllHeartbeats } from './heartbeat.js';
```

`heartbeat.ts` imports only `node:fs` and `node:path` — no internal modules — so this import introduces no cycle.

### 2b. Tick before each return in `ensureWorktree`

Per spec Interaction Dependencies: "The force-tick fires regardless of whether `ensureWorktree` created a new worktree or found an existing one." Three return sites exist in `ensureWorktree`:

**Site 1** — existing worktree at canonical path (current lines 95–97):
```typescript
if (fs.existsSync(wt)) {
    info(`Worktree already exists: ${wt}`);
    try { tickAllHeartbeats(); } catch { /* best-effort — never abort worktree creation */ }
    return wt;
}
```

**Site 2** — existing worktree found for the branch at a different path (current lines 99–102):
```typescript
if (existingWt) {
    info(`Worktree already exists for branch '${branch}': ${existingWt}`);
    try { tickAllHeartbeats(); } catch { /* best-effort */ }
    return existingWt;
}
```

**Site 3** — new worktree just created (current lines 147–148, just before `return wt`):
```typescript
info('Worktree ready.');
try { tickAllHeartbeats(); } catch { /* best-effort */ }
return wt;
```

The outer `try/catch` at each site is defense-in-depth: `writeOnce` already swallows FS failures internally, but any unexpected throw from the registry sweep is caught here so worktree creation always succeeds regardless of heartbeat state.

**Tick placement** (Known Risk addressed): the tick fires at the natural `return` point of `ensureWorktree`, before the function returns to `ensureBranch`. At this point the worktree dir exists and `resolveTaskCwd` can already return it. This places the tick before `ensureBranch` records the branch name in `status.json` and before any scaffold commit — satisfying "before the orchestrator proceeds past worktree creation."

---

## Step 3 — AC-1 and AC-2 tests (`heartbeat.test.ts`)

**File**: `tests/heartbeat.test.ts`

### 3a. Add `tickAllHeartbeats` to the existing import

```typescript
import {
    HEARTBEAT_STALE_AFTER_MS,
    isHeartbeatStale,
    readHeartbeat,
    readHeartbeatStatus,
    startHeartbeat,
    stopAllHeartbeats,
    tickAllHeartbeats,           // new
    type HeartbeatRecord,
} from '../scripts/run-task/heartbeat.js';
```

### 3b. AC-1 test — `handle.tick()` writes to the dir the resolver currently points to

```typescript
void test('handle.tick() writes heartbeat to the dir the resolver currently points to', () => {
    withTempDir((root) => {
        const dir1 = path.join(root, 'tasks', 'dir1');
        const dir2 = path.join(root, 'tasks', 'dir2');
        let currentDir = dir1;
        const handle = startHeartbeat(['t1'], () => currentDir, { intervalMs: 999_999 });
        try {
            // Initial write landed in dir1.
            assert.ok(fs.existsSync(path.join(dir1, '.heartbeat.json')));
            assert.ok(!fs.existsSync(path.join(dir2, '.heartbeat.json')));

            // Advance resolver; tick must write to dir2.
            currentDir = dir2;
            handle.tick();

            const file2 = path.join(dir2, '.heartbeat.json');
            assert.ok(fs.existsSync(file2), 'tick must write heartbeat to the new resolver dir');
            const record = JSON.parse(fs.readFileSync(file2, 'utf8')) as HeartbeatRecord;
            assert.equal(record.pid, process.pid);
            assert.ok(Date.now() - record.last_update_ms < 1_000, 'heartbeat must be fresh after tick');
        } finally {
            handle.stop();
        }
    });
});
```

### 3c. AC-2 test — `tickAllHeartbeats()` fires all active handles

```typescript
void test('tickAllHeartbeats() writes fresh heartbeat for every active handle', () => {
    withTempDir((root) => {
        const dir1 = path.join(root, 'tasks', 'h1');
        const dir2 = path.join(root, 'tasks', 'h2');
        // Large interval so ticks only happen when explicitly triggered.
        const h1 = startHeartbeat(['h1'], () => dir1, { intervalMs: 999_999 });
        const h2 = startHeartbeat(['h2'], () => dir2, { intervalMs: 999_999 });
        try {
            // Delete initial writes so the assertion is causally load-bearing:
            // only tickAllHeartbeats() can restore them.
            fs.unlinkSync(path.join(dir1, '.heartbeat.json'));
            fs.unlinkSync(path.join(dir2, '.heartbeat.json'));

            tickAllHeartbeats();

            assert.ok(fs.existsSync(path.join(dir1, '.heartbeat.json')), 'h1 must have heartbeat after tickAllHeartbeats');
            assert.ok(fs.existsSync(path.join(dir2, '.heartbeat.json')), 'h2 must have heartbeat after tickAllHeartbeats');
        } finally {
            h1.stop();
            h2.stop();
        }
    });
});
```

---

## Step 4 — AC-3 integration test (`run-task-safety.test.ts`)

**File**: `tests/run-task-safety.test.ts`

**Process-locality constraint**: Call `ensureBranch` **directly** in the test process — not via `runNodeInline`. `runNodeInline` spawns a subprocess with its own `activeHandles` registry; a handle seeded in the outer test process would be invisible to it. Direct-call tests (e.g., `ensureBranch creates a task branch from the declared release base` at line 540) demonstrate this is fine when `die()` is not being tested. AC-3 does not exercise `die()`.

### 4a. Import `startHeartbeat` from heartbeat

Add to the existing imports at the top of the file:
```typescript
import { startHeartbeat } from '../scripts/run-task/heartbeat.js';
```

### 4b. Add the integration test

```typescript
void test('ensureWorktree ticks active heartbeats into the worktree task dir after creation', () => {
    withTempDir('run-task-safety-heartbeat-tick-', (dir) => {
        const tasksRoot = path.join(dir, 'tasks');
        const worktreesRoot = path.join(dir, 'worktrees');
        const fakeGitDir = path.join(dir, 'fake-git');
        fs.mkdirSync(fakeGitDir, { recursive: true });
        const logPath = path.join(dir, 'git.log');
        const currentBranchPath = path.join(dir, 'current-branch.txt');
        fs.writeFileSync(currentBranchPath, 'release/v1\n');
        setupFakeGit(fakeGitDir);

        const taskId = 'tick-test-task';
        const taskBranch = `task/${taskId}`;
        writeTaskStatus(tasksRoot, taskId, {
            title: taskId,
            base_branch: 'release/v1',
            branch: '',           // no branch recorded → first-worktree creation path
            worktree: true,
            phases: {},
        });

        // Resolver design: initially points to the repo-root tasks dir so the
        // startHeartbeat initial write goes there (not the worktree). Before
        // calling ensureBranch we advance it to the worktree task dir. Only
        // tickAllHeartbeats() (fired inside ensureWorktree) can write there —
        // making the assertion causally load-bearing.
        //
        // writeOnce calls fs.mkdirSync(dir, { recursive: true }), so the
        // worktree task subdir is created by the tick itself; fake git's
        // worktree add only creates <worktreesRoot>/<taskId>/.
        const worktreeTaskDir = path.join(worktreesRoot, taskId, 'tasks', taskId);
        let resolvedDir = path.join(tasksRoot, taskId); // initial: repo-root dir
        const handle = startHeartbeat([taskId], () => resolvedDir, { intervalMs: 999_999 });
        // Advance resolver to worktree dir BEFORE ensureBranch runs.
        resolvedDir = worktreeTaskDir;

        try {
            withFakeGitEnv({
                PATH: `${fakeGitDir}${path.delimiter}${process.env.PATH ?? ''}`,
                FAKE_GIT_LOG: logPath,
                FAKE_GIT_CURRENT_BRANCH: currentBranchPath,
                FAKE_GIT_BASE_BRANCH: 'release/v1',
                FAKE_GIT_TASK_BRANCH: taskBranch,
                CANON_TASKS_DIR_OVERRIDE: tasksRoot,
                CANON_WORKTREES_ROOT: worktreesRoot,
            }, () => {
                ensureBranch([taskId]);   // direct call — same process, same activeHandles
            });

            assert.ok(
                fs.existsSync(path.join(worktreeTaskDir, '.heartbeat.json')),
                'tickAllHeartbeats inside ensureWorktree must write heartbeat to worktree task dir',
            );
        } finally {
            handle.stop();
        }
    });
});
```

---

## Step 5 — AC-4 test (`watch.test.ts`)

**File**: `tests/watch.test.ts`

No new imports needed — all types already imported.

Add test after the existing stale-boundary test (after line 702). Model on `watchCmd: a stale heartbeat while the pid is alive at a phase boundary is not a false step_done` (line 609):

```typescript
void test('watchCmd: no false step_done during worktree-flip gap (heartbeat present, no .canon-pid)', () => {
    // Scenario: plan→implement transition; orchestrator created the worktree.
    // Worktree dir has a fresh .heartbeat.json but .canon-pid lives only in
    // the repo-root dir (never copied). gatherRunContext resolves pid via the
    // heartbeat-pid fallback path (run-context.ts:127-128): canonPid=null,
    // heartbeatResult.found → resolvedPid=heartbeatPid.
    //
    // Pre-fix: resolvedPid=null → orchestratorStillProgressing bails → false step_done.
    // Post-fix: resolvedPid=livePid → gate holds → watch keeps blocking.
    const clock = makeClock();
    const livePid = 5555;

    const flipWindowCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('implement', {
                spec:        { status: 'done', agent: 'codex' },
                spec_review: { status: 'done', agent: 'claude' },
                plan:        { status: 'done', agent: 'codex' },
                implement:   { status: 'in_progress', agent: 'codex' },
            }),
        },
        heartbeatResult: { kind: 'found', record: makeHeartbeat(livePid, clock.now()) },
        canonPid: null,       // no .canon-pid in the worktree dir (the gap)
        resolvedPid: livePid, // heartbeat-pid fallback from run-context.ts:127-128
    });

    const completeCtx = makeContext({
        statusResult: {
            kind: 'ok',
            file: '/tmp/t1/status.json',
            status: makeStatus('complete', {
                spec:         { status: 'done', agent: 'codex' },
                spec_review:  { status: 'done', agent: 'claude' },
                plan:         { status: 'done', agent: 'codex' },
                implement:    { status: 'done', agent: 'codex' },
                code_review:  { status: 'done', agent: 'claude' },
                qa:           { status: 'done', agent: 'codex' },
                human_review: { status: 'done', agent: 'claude' },
            }),
        },
        heartbeatResult: { kind: 'missing' },
        canonPid: null,
        resolvedPid: null,
    });

    const contexts = [flipWindowCtx, flipWindowCtx, completeCtx];
    let gatherIndex = 0;

    const result = runWatchCommand(['t1'], {
        nowImpl: clock.now,
        sleepImpl: clock.sleep,
        gatherContextImpl: () => contexts[gatherIndex++] ?? completeCtx,
        probeAliveImpl: (pid: number): void => {
            if (pid === livePid) return;
            const err = new Error('ESRCH') as NodeJS.ErrnoException;
            err.code = 'ESRCH';
            throw err;
        },
    });

    assert.doesNotMatch(result.stdout.join('\n'), /step_done/,
        'watch must not emit step_done during worktree-flip gap when heartbeat is present');
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout[result.stdout.length - 1] ?? '', /reason=complete/);
});
```

---

## Validation

Run in order after implementation:

```bash
npm run lint
npm run type-check
npm test
npm run build
```

All four must exit 0. No existing test requires modification (AC-5).

---

## Reroute Plan

### Delta

The amendment relocates `tickAllHeartbeats()` from `ensureWorktree` to `ensureBranch`, so every bundled task's branch field is recorded before any heartbeat is written. Steps 1–3 (heartbeat.ts, heartbeat tests, watch.test.ts) are unchanged. Steps 2 and 4 need surgical edits; a new step covers AC-6.

#### Step R1 — Remove `tickAllHeartbeats()` from `worktree.ts`

**File**: `scripts/run-task/worktree.ts`

Remove the three `try { tickAllHeartbeats(); } catch { ... }` blocks added at round 0 (Sites 1, 2, 3 in Step 2 of the original plan). If `tickAllHeartbeats` is the only import from `./heartbeat.js` in `worktree.ts`, remove the import line too. No other changes to `ensureWorktree`.

#### Step R2 — Add `tickAllHeartbeats()` to `ensureBranch` in `git.ts`

**File**: `scripts/run-task/git.ts`

`heartbeat.ts` imports only `node:fs` and `node:path`, so `git.ts → heartbeat.ts` introduces no cycle.

**2a.** Add `tickAllHeartbeats` to `git.ts` imports from `./heartbeat.js`:

```typescript
import { tickAllHeartbeats } from './heartbeat.js';
```

**2b. Existing-branch worktree path** (currently git.ts ~line 261–271): fire after `ensureWorktree` returns, branches are already recorded from a prior run:

```typescript
if (primaryStatus.branch) {
    if (useWorktree) {
        ensureWorktree(taskIds[0], primaryStatus.branch);
        try { tickAllHeartbeats(); } catch { /* best-effort */ }
    } else {
        // non-worktree checkout path — unchanged
    }
    return;
}
```

**2c. First-creation worktree path** (currently git.ts ~line 284–291): fire **after** the branch-recording loop so all bundled tasks have their `branch` field populated before the tick writes any heartbeat:

```typescript
ensureWorktree(taskIds[0], branchName, baseBranch);
for (const taskId of taskIds) {
    const s = readStatus(taskId);
    s.branch = branchName;
    writeStatus(taskId, s);
}
info(`Branch recorded: ${branchName} (worktree mode — main checkout untouched)`);
try { tickAllHeartbeats(); } catch { /* best-effort */ }
return;
```

Both sites: the `try/catch` is defense-in-depth; `writeOnce` already catches all FS errors and resolver throws internally.

#### Step R3 — AC-3 (revised) and AC-6 tests (`run-task-safety.test.ts`)

**File**: `tests/run-task-safety.test.ts`

**Process-locality constraint (from amendment review nit)**: Both AC-3 and AC-6 must seed the heartbeat handle inside the same subprocess that runs `ensureBranch` — `activeHandles` is process-local. If Codex's round-0 AC-3 implementation already used a subprocess harness (as noted in handoff.md deviation table), the same harness applies here. The tick now fires from `ensureBranch`, not `ensureWorktree`, so the integration assertion is identical but the causal trigger moves one level up the call stack — no observable difference in the test.

**AC-3 (revised)**: The existing single-task causal case needs no assertion change (it seeds a handle, calls `ensureBranch`, and asserts a fresh heartbeat in the worktree task dir). If the test currently calls `ensureWorktree` directly, redirect it to call `ensureBranch` instead, so the tick fires through the revised call site.

**AC-6 (new)**: Bundle case — 2-task bundle, primary + secondary. Same subprocess harness as AC-3:

1. Seed an active heartbeat handle (or two handles, one per task ID) inside the subprocess.
2. Write `status.json` for both tasks with `branch: ''` (no branch recorded yet, first-creation path).
3. Call `ensureBranch([primaryId, secondaryId])` directly in the subprocess.
4. Assert a fresh `.heartbeat.json` exists in the shared worktree task dir for **both** primary and secondary tasks.

The secondary task assertion is what's load-bearing: without the amendment, the tick would fire before the secondary's branch is recorded, miss the worktree dir, and write to REPO_ROOT instead.

#### Affected Files (reroute delta only)

| File | Change |
|---|---|
| `scripts/run-task/git.ts` | Add `tickAllHeartbeats` import; fire best-effort tick after branch recording on both worktree paths in `ensureBranch`. |
| `scripts/run-task/worktree.ts` | Remove the three `tickAllHeartbeats()` call sites added in round 0; remove import if now unused. |
| `tests/run-task-safety.test.ts` | Revise AC-3 test to call `ensureBranch` (not `ensureWorktree`) if needed; add AC-6 bundle case. |
| `dist/` | Regenerated build artifact — rebuild after source changes. |
