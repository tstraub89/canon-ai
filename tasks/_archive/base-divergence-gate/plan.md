# Plan: base-divergence-gate

> Written by: Claude | For: Codex implementation

## Nit from spec-review incorporated

AC-13 says the reminder prints "exactly once per task" — Codex spec-review flagged this is ambiguous for bundles. This plan resolves it: the reminder prints **once per first-implement invocation** (one call to `runImplementPhase`). In a bundle, `commitTaskArtifactsToBase(taskIds, ...)` runs once inside the single `!worktreeAlreadyCreated` guard for the whole `taskIds` set. The `info()` call is placed immediately after `commitTaskArtifactsToBase` inside that same guard — it fires once and references the shared base branch. No loop over tasks. On reroutes/iterations (`worktreeAlreadyCreated === true`) it never runs.

## Step 1 — Add `getUnpushedBaseCommits` to `scripts/run-task/git.ts` (AC-1)

Place after `commitsAheadOfBase` (line 151). `gitSafeAtRaw` is already imported in this file.

```typescript
export function getUnpushedBaseCommits(
    baseBranch: string,
    cwd: string,
): { commits: { sha: string; subject: string }[]; ok: boolean; stderr: string } {
    const result = gitSafeAtRaw(cwd, 'log', `origin/${baseBranch}..${baseBranch}`, '--format=%H%x09%s');
    if (!result.ok) {
        return { commits: [], ok: false, stderr: result.stderr };
    }
    const commits: { sha: string; subject: string }[] = [];
    for (const line of result.stdout.split('\n')) {
        if (!line.trim()) continue;
        const tabIdx = line.indexOf('\t');
        if (tabIdx === -1) continue;
        commits.push({ sha: line.slice(0, tabIdx), subject: line.slice(tabIdx + 1) });
    }
    return { commits, ok: true, stderr: '' };
}
```

## Step 2 — Add `allowDivergentBase` to `CliArgs` in `scripts/run-task/types.ts` (AC-4 — type part)

Add `allowDivergentBase: boolean` after `force: boolean` at line 129 in the `CliArgs` type:

```typescript
export type CliArgs = {
    // ... existing fields ...
    force: boolean;
    allowDivergentBase: boolean;  // add here
};
```

## Step 3 — Add `--allow-divergent-base` parser in `scripts/run-task/cli.ts` (AC-4 — parser part)

**3a.** In `printUsage`, add a new line after the `--force` entry (around line 44):

```
  --allow-divergent-base  At --push, --pr, and --ship: bypass the commit-divergence block
                          when local <base> has commits not yet on origin/<base>.
                          Does NOT bypass the file-allow-list gate (use --force for that).
                          Independent of --force — both may be needed to pass both gates.
```

**3b.** In `parseArgs`, add `let allowDivergentBase = false` near `let force = false` (line 80).

**3c.** In the `switch (arg)` block, add a case near `'--force'`:

```typescript
case '--allow-divergent-base':
    allowDivergentBase = true;
    break;
```

**3d.** Add `allowDivergentBase` to the returned object at line 130:

```typescript
return { taskIds, interactive, step, expectPhase, push, pr, reroute, ship, dryRun, fullSend, force, allowDivergentBase };
```

## Step 4 — Add `verifyBaseDivergenceFromData` and `verifyBaseDivergence` to `scripts/run-task/validation.ts` (AC-2, AC-3)

**4a.** Add `getUnpushedBaseCommits` to the import from `'./git.js'` at line 7.

**4b.** Place both new functions after `verifyBaseDrift`'s closing brace (~line 1095). Export both.

```typescript
// AC-2: pure data-seam formatter — no I/O. Mirrors verifyBaseDriftFromData's pattern.
export function verifyBaseDivergenceFromData(
    commits: readonly { sha: string; subject: string }[],
): string {
    if (commits.length === 0) return '';
    const lines = [
        `${commits.length} local base commit(s) not yet on origin will collide when base is pulled:`,
        ...commits.map(c => `  ${c.sha.slice(0, 7)}  ${c.subject}`),
        `Fix: git push origin <base-branch>`,
        `Override (skips this check only): --allow-divergent-base`,
    ];
    return lines.join('\n');
}

// AC-3: integration wrapper — fetches then checks. Mirrors verifyBaseDrift's structure.
export function verifyBaseDivergence(
    baseBranch: string,
    cwd: string,
): { commits: { sha: string; subject: string }[]; ok: boolean; stderr: string; fetchFailed: boolean } {
    const fetchResult = gitSafeAt(cwd, 'fetch', 'origin', baseBranch);
    if (!fetchResult.ok) {
        warn(
            `Could not fetch origin/${baseBranch} (${fetchResult.stderr.trim() || 'unknown'}). ` +
            `Skipping base-divergence check — re-run when network access is restored.`,
        );
        return { commits: [], ok: true, stderr: '', fetchFailed: true };
    }
    const helper = getUnpushedBaseCommits(baseBranch, cwd);
    if (!helper.ok) {
        return { commits: [], ok: false, stderr: helper.stderr, fetchFailed: false };
    }
    return { commits: helper.commits, ok: true, stderr: '', fetchFailed: false };
}
```

`verifyBaseDrift` is **byte-identical** before and after — purely additive exports.

## Step 5 — Wire `verifyBaseDivergence` into `commitHumanReviewFiles` in `scripts/run-task/main.ts` (AC-5)

`commitHumanReviewFiles` begins at line 902. The existing `verifyBaseDrift` call is at line 908 (`const baseDriftResult = splitValidation.verifyBaseDrift(...)`). Insert the new block **immediately before** that call.

The file uses `splitValidation` as the namespace alias for validation.ts imports — add `verifyBaseDivergence` and `verifyBaseDivergenceFromData` to that namespace (mirror the existing split-import pattern at the top of main.ts for validation.ts).

```typescript
// Base-divergence gate: local base has commits not yet on origin.
// Runs before verifyBaseDrift so the root-cause message fires first.
const baseDivResult = splitValidation.verifyBaseDivergence(baseBranch, cwd);
if (!baseDivResult.ok) {
    splitCli.die(
        `--pr aborted: git error checking base divergence: ${baseDivResult.stderr}`,
    );
} else if (!baseDivResult.fetchFailed && baseDivResult.commits.length > 0) {
    if (!cliArgs.allowDivergentBase) {
        splitCli.die(
            `--pr aborted: base-divergence detected.\n` +
            splitValidation.verifyBaseDivergenceFromData(baseDivResult.commits),
        );
    }
    splitCli.warn(
        `--allow-divergent-base: bypassing base-divergence gate. Divergent commits:\n` +
        baseDivResult.commits.map(c => `  ${c.sha.slice(0, 7)}  ${c.subject}`).join('\n'),
    );
}
// fetchFailed path: warn already emitted by verifyBaseDivergence; proceed to verifyBaseDrift.
```

**Invariant**: `verifyBaseDrift`'s body and its call at line 908 are byte-identical. Only the block before it is new.

## Step 6 — Wire `verifyBaseDivergence` into `shipTasks` in `scripts/run-task/main.ts` (AC-6)

`shipTasks` begins at line 1593. The sequence near line 1688–1691 is:

```typescript
splitGit.ensureCheckedOutBaseBranch(taskIds);
// ... insert here ...
const merged = mergeOpenPRsAndPull(taskIds, baseBranch, branchByTaskId);
```

Insert between `ensureCheckedOutBaseBranch` and `mergeOpenPRsAndPull`:

```typescript
// Base-divergence gate — blocks before the irreversible merge.
// Complements assertLocalBaseInSyncWithOrigin (behind-direction) with the ahead-direction.
const shipBaseDivResult = splitValidation.verifyBaseDivergence(baseBranch, cwd);
if (!shipBaseDivResult.ok) {
    splitCli.die(
        `--ship aborted: git error checking base divergence: ${shipBaseDivResult.stderr}`,
    );
} else if (!shipBaseDivResult.fetchFailed && shipBaseDivResult.commits.length > 0) {
    if (!cliArgs.allowDivergentBase) {
        splitCli.die(
            `--ship aborted: base-divergence detected.\n` +
            splitValidation.verifyBaseDivergenceFromData(shipBaseDivResult.commits),
        );
    }
    splitCli.warn(
        `--allow-divergent-base: bypassing base-divergence gate at --ship. Divergent commits:\n` +
        shipBaseDivResult.commits.map(c => `  ${c.sha.slice(0, 7)}  ${c.subject}`).join('\n'),
    );
}
```

`baseBranch` is already in scope (`const baseBranch = splitGit.getBaseBranch(taskIds)` at line 1659). For `cwd`: use `REPO_ROOT` — check what `ensureCheckedOutBaseBranch` and `assertLocalBaseInSyncWithOrigin` use in this function and mirror it.

## Step 7 — Replace stderr-substring tolerance in `mergeOpenPRsAndPull` (AC-14)

`mergeOpenPRsAndPull` is at line 1459. The block to replace is lines 1485–1509 (the `localDeleteFailed` stderr-check and the subsequent handling).

**7a.** Add exported pure decision helper (module-level in main.ts, exported for testability):

```typescript
// Pure — no I/O. Tests AC-15 directly.
export function classifyMergeOutcome(opts: { exitOk: boolean; mergeConfirmed: boolean }): 'tolerate' | 'fail' {
    if (opts.exitOk) return 'tolerate';
    if (opts.mergeConfirmed) return 'tolerate';
    return 'fail';
}
```

**7b.** Add private `isPRMerged` helper (near `findOpenPRNumber`):

```typescript
function isPRMerged(prNum: number): boolean {
    const result = splitGit.runCommand('gh', ['pr', 'view', String(prNum), '--json', 'state', '--jq', '.state']);
    return result.ok && result.stdout.trim() === 'MERGED';
}
```

**7c.** Replace the tolerance block (lines 1485–1509) with:

```typescript
const outcome = classifyMergeOutcome({
    exitOk: result.ok,
    mergeConfirmed: result.ok ? true : isPRMerged(prNum),
});
if (outcome === 'fail') {
    splitCli.die(`Failed to merge PR #${prNum}: ${result.stderr}`);
}
if (!result.ok) {
    // merge succeeded but branch-delete failed (worktree holds it, or GitHub auto-deleted it already)
    splitCli.warn(`PR #${prNum} merged; branch-delete step failed (tolerated): ${result.stderr.trim()}`);
    // Preserve the assertOriginTaskBranchAbsent safety net — same as prior localDeleteFailed path.
    for (const taskId of taskIds) {
        const branchName = branchByTaskId.get(taskId);
        if (branchName === branch) {
            assertOriginTaskBranchAbsent(branchName, baseBranch);
        }
    }
} else {
    splitCli.info(`PR #${prNum} merged.`);
}
anyMerged = true;
```

**Key invariants:**
- `assertOriginTaskBranchAbsent` still runs in the tolerated path (mirrors prior `localDeleteFailed` path at lines 1501–1506).
- `isPRMerged(prNum)` queries the specific PR number from the current `gh pr merge` attempt — NOT `findMergedPRNumber(branch, baseBranch)` which matches by branch name and can false-tolerate a reused branch.
- The `already merged` and `used by worktree` stderr cases are now subsumed by the merge-state check: both result in a merged PR → `isPRMerged(prNum) === true` → tolerate.

## Step 8 — Add push-reminder `info()` in `scripts/run-task/phases/implement.ts` (AC-13)

The `!worktreeAlreadyCreated` guard is at line 46. Both `info` (line 1) and `getBaseBranch` (line 5) are already imported.

Modify the guard:

```typescript
if (!worktreeAlreadyCreated) {
    commitTaskArtifactsToBase(taskIds, TASK_ARTIFACT_FILES);
    const scaffoldBase = getBaseBranch(taskIds);
    info(
        `Scaffold committed to local ${scaffoldBase} — ` +
        `run \`git push origin ${scaffoldBase}\` to keep origin in sync ` +
        `and avoid base-divergence at --push/--pr/--ship.`,
    );
}
ensureBranch(taskIds, { force });
```

`getBaseBranch(taskIds)` is also called later at line 52 — that assignment is unchanged. Calling it twice is acceptable (reads status.json, cheap, pure).

**Bundle behaviour:** `commitTaskArtifactsToBase(taskIds, ...)` runs once for the bundle inside this guard → `info()` fires once → one reminder referencing the shared base branch name. Not once per task.

## Step 9 — Tests in `tests/run-task-validation.test.ts` (AC-7, AC-8)

Add imports at top:

```typescript
import {
    verifyBaseDivergenceFromData,
    verifyBaseDivergence,
    // ... existing imports
} from '../scripts/run-task/validation.js';
```

**AC-7 — `verifyBaseDivergenceFromData` unit tests:**

```typescript
void test('verifyBaseDivergenceFromData: empty commits returns empty string', () => {
    assert.equal(verifyBaseDivergenceFromData([]), '');
});

void test('verifyBaseDivergenceFromData: single commit includes short-sha and full subject', () => {
    const msg = verifyBaseDivergenceFromData([
        { sha: 'abcdef1234567890', subject: 'task(foo): commit artifacts' },
    ]);
    assert.ok(msg.includes('abcdef1'), 'should include first 7 chars of sha');
    assert.ok(msg.includes('task(foo): commit artifacts'), 'should include full subject');
});

void test('verifyBaseDivergenceFromData: multiple commits listed in input order', () => {
    const commits = [
        { sha: 'aaaaaaa000000001', subject: 'first commit' },
        { sha: 'bbbbbbb000000002', subject: 'second commit' },
    ];
    const msg = verifyBaseDivergenceFromData(commits);
    const firstIdx = msg.indexOf('first commit');
    const secondIdx = msg.indexOf('second commit');
    assert.ok(firstIdx !== -1 && secondIdx !== -1, 'both commits present');
    assert.ok(firstIdx < secondIdx, 'first commit listed before second');
});

void test('verifyBaseDivergenceFromData: message includes required literal substrings', () => {
    const msg = verifyBaseDivergenceFromData([
        { sha: 'deadbeef00000000', subject: 'some change' },
    ]);
    assert.ok(msg.includes('git push origin'), 'must contain literal: git push origin');
    assert.ok(msg.includes('--allow-divergent-base'), 'must contain literal: --allow-divergent-base');
});
```

**AC-8 — `verifyBaseDivergence` integration tests:**

Use the existing `makeGitFixture(dir)` helper (line 234) and `gitIn` helper:

```typescript
void test('verifyBaseDivergence: clean repo with no divergent commits returns empty ok result', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'base-divergence-clean-'));
    try {
        const { localDir } = makeGitFixture(dir);
        const result = verifyBaseDivergence('main', localDir);
        assert.equal(result.ok, true);
        assert.equal(result.fetchFailed, false);
        assert.deepEqual(result.commits, []);
        assert.equal(result.stderr, '');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

void test('verifyBaseDivergence: non-existent cwd returns ok:false with non-empty stderr', () => {
    const result = verifyBaseDivergence('main', `/tmp/does-not-exist-canon-test-${Date.now()}`);
    assert.equal(result.ok, false);
    assert.ok(result.stderr.length > 0, 'stderr should be non-empty on git failure');
});
```

Optional (recommended for full round-trip confidence): after `makeGitFixture`, make a commit on local without pushing, assert `verifyBaseDivergence` returns `commits.length === 1` with the expected sha/subject.

## Step 10 — Tests in `tests/run-task-safety.test.ts` (AC-9, AC-13, AC-15)

**AC-15 — `classifyMergeOutcome` unit tests:**

Add import: `import { classifyMergeOutcome } from '../scripts/run-task/main.js';`

```typescript
void test('classifyMergeOutcome: exit ok → tolerate', () => {
    assert.equal(classifyMergeOutcome({ exitOk: true, mergeConfirmed: false }), 'tolerate');
});

void test('classifyMergeOutcome: exit non-ok + mergeConfirmed true → tolerate', () => {
    assert.equal(classifyMergeOutcome({ exitOk: false, mergeConfirmed: true }), 'tolerate');
});

void test('classifyMergeOutcome: exit non-ok + mergeConfirmed false → fail', () => {
    assert.equal(classifyMergeOutcome({ exitOk: false, mergeConfirmed: false }), 'fail');
});
```

**AC-9 — subprocess `--push` block/bypass tests (real-git fixture + `main()`):**

`commitHumanReviewFiles` reads module-level `cliArgs` — tests must route through `main()` via subprocess (patterns.md "module-level `cliArgs`" pitfall). Use the `spawnSync` pattern already in this file.

Setup: create a real git repo with a bare origin, clone it, make an initial commit and push (so origin/main exists), then make a second commit on local base **without pushing** (this is the divergence). Set up a task directory with a `status.json` in `human_review` state.

```typescript
void test('AC-9a: --push without --allow-divergent-base dies with divergent sha and flag hint', () => {
    withTempDir('base-div-block-', (dir) => {
        const { localDir, shortSha, tasksDir } = setupDivergentBase(dir, taskId);
        const result = spawnSync(
            'node',
            ['--import', TSX_LOADER, path.join(WORKTREE_ROOT, 'scripts/run-task.ts'), taskId, '--push'],
            { env: { ...process.env, CANON_TASKS_DIR_OVERRIDE: tasksDir }, cwd: localDir, encoding: 'utf8' },
        );
        assert.notEqual(result.status, 0, 'should exit non-zero');
        assert.ok(result.stderr.includes(shortSha), 'stderr includes divergent commit sha');
        assert.ok(result.stderr.includes('--allow-divergent-base'), 'stderr includes bypass flag hint');
    });
});

void test('AC-9b: --push with --allow-divergent-base passes the divergence gate', () => {
    withTempDir('base-div-bypass-', (dir) => {
        const { localDir, tasksDir } = setupDivergentBase(dir, taskId);
        const result = spawnSync(
            'node',
            ['--import', TSX_LOADER, path.join(WORKTREE_ROOT, 'scripts/run-task.ts'), taskId, '--push', '--allow-divergent-base'],
            { env: { ...process.env, CANON_TASKS_DIR_OVERRIDE: tasksDir }, cwd: localDir, encoding: 'utf8' },
        );
        // May fail at verifyBaseDrift or later — assert only that the divergence gate did NOT fire.
        assert.ok(
            !result.stderr.includes('--push aborted: base-divergence detected'),
            'should not die at the base-divergence gate',
        );
    });
});
```

Extract a `setupDivergentBase(dir, taskId)` helper that: initializes bare origin + local clone, makes a pushed initial commit, makes a second unpushed commit (captures its short sha), writes a minimal `status.json` in human_review state under `tasksDir`, and returns `{ localDir, originDir, shortSha, tasksDir }`.

**AC-13 — push-reminder tests:**

Because `runImplementPhase` calls `runCodex` (async LLM), testing the reminder via a subprocess that invokes the full pipeline is impractical. Use a unit test that stubs the I/O boundary: directly call `runImplementPhase` with a mocked `runCodex` that returns a minimal passing result, and a real minimal git fixture where `worktreeAlreadyCreated === false`. Capture `console.log` output via `captureConsoleLog` (add a helper analogous to `captureConsoleError` already in `run-task-validation.test.ts`) and assert the reminder substring appears in the captured output.

If `runImplementPhase` is too tightly coupled to make mocking clean, alternatively:
- Add the reminder assertion to an existing implement-phase integration test if one exists.
- Or test via process inspection: call the function, stub `commitTaskArtifactsToBase` and `ensureBranch` to no-ops, and assert `info()` fires once.

Minimum required assertions per AC-13(c):
1. On fresh first-implement (`worktreeAlreadyCreated === false`): `console.log` output includes `git push origin` and the resolved base-branch name exactly once.
2. On reroute/iteration (`worktreeAlreadyCreated === true`): `console.log` output does NOT include the reminder message.

## Step 11 — Update `docs/codebase-map.md` (AC-11)

Find the row for "Base-drift gate" in the Pipeline Orchestration feature table. Update it to:

- **Name**: "Base-drift + base-divergence gates"
- **Entry points**: `--push`, `--pr`, `--ship` (all three)
- **Description**: Reference both `verifyBaseDrift` (file-allow-list; `--push`/`--pr`) and `verifyBaseDivergence` / `getUnpushedBaseCommits` (commit-divergence; runs first; all three boundaries). Note commit-divergence check runs first, blocking at all three; file-allow-list check blocks at `--push`/`--pr`.

## Step 12 — Update `docs/pipeline-orchestrator.md` (AC-12)

In the flags reference section, add an `--allow-divergent-base` entry near `--force`. Include:

1. Name and applicable phases (`--push`, `--pr`, `--ship`).
2. What it bypasses: the commit-divergence check only (when local `<base>` is ahead of `origin/<base>`).
3. What it does NOT bypass: the file-allow-list gate (`verifyBaseDrift`) — use `--force` for that.
4. Independence: `--allow-divergent-base` and `--force` bypass distinct gates; pass both to bypass both.
5. If a §Shipping section exists, add a note that `--ship` now blocks on ahead-divergence (complements `assertLocalBaseInSyncWithOrigin`'s behind-direction block); bypass with `--allow-divergent-base`.

## Validation checklist

Run in order:

1. `npm run lint`
2. `npm run type-check`
3. `npm test`
4. `npm run docs-refs-check`

## Key invariants Codex must preserve (Stage 1 review checklist)

- `verifyBaseDrift` body and its call at line 908 of `commitHumanReviewFiles` are **byte-identical** before and after — any change is a Stage 1 fail.
- `assertLocalBaseInSyncWithOrigin` (behind-direction block in `shipTasks`) is **untouched**.
- `assertOriginTaskBranchAbsent` still runs in the tolerated merge path (AC-14).
- `--force` bypasses only `verifyBaseDrift`; `--allow-divergent-base` bypasses only `verifyBaseDivergence`. No coalescing.
- The `info()` in implement.ts adds no branching to `commitTaskArtifactsToBase` or `ensureBranch`.
- `isPRMerged` in AC-14 uses the specific `prNum` from the current `gh pr merge` call, not `findMergedPRNumber(branch, baseBranch)`.
