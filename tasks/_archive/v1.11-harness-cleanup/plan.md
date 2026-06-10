# Implementation Plan: v1.11-harness-cleanup

> Written by: Claude (pipeline) | Implements: `tasks/v1.11-harness-cleanup/spec.md`

## Approach

Implement Fix B (budget-by-tier) first — it is purely additive (new type fields, new policy table, parameter threading) with no behavior change for existing S/M tasks. Fix A (skip-ci marker) second — the conditional commit-marker logic is the trickier piece and benefits from a clean, passing state before layering in.

Fix B follows the Pure Policy + Test Discipline pattern from `docs/patterns.ms`: all routing logic lives in `pipeline-policy.ts` (pure, table-driven, no env reads), env resolution in `policy.ts`, and every new matrix cell has a corresponding test row in `pipeline-policy.test.ts`.

Fix A adds a single pure predicate (`willPinCommitFollow`) that does one `gh pr list` call before the artifacts commit to decide whether an unmarked pin commit will follow. The contract is simple: mark only when a subsequent unmarked head is guaranteed.

---

## Steps

### Step 1: `scripts/pipeline-policy.ts` — extend types + add budget resolution

**Files**: `scripts/pipeline-policy.ts`

1. Add `claudeBudget: string | null` to `PolicyConfig`:
   ```typescript
   maxReviewLoops: number | null;
   claudeBudget: string | null; // null → use tiered default; string → flat override
   ```

2. Add `budget: string` to `ClaudeModelConfig`:
   ```typescript
   export type ClaudeModelConfig = { model: string; effort: string; budget: string };
   ```

3. Add a module-level budget table and resolver (no side effects — follows the existing pure-function pattern for `codexMatrix`/`claudeMatrix`):
   ```typescript
   const BUDGET_TABLE: Record<TaskSize, string> = {
       S: '5.00', M: '5.00', L: '10.00', XL: '20.00',
   };
   function resolveBudget(effectiveSize: TaskSize, claudeBudget: string | null): string {
       return claudeBudget ?? BUDGET_TABLE[effectiveSize];
   }
   ```

4. In `getPipelinePolicy`, compute budget once and thread into every `claude()` return:
   ```typescript
   const budget = resolveBudget(effectiveSize, config.claudeBudget);
   return {
       ...
       claude: (phase) => ({ ...claudeMat[phase][effectiveSize], budget }),
   };
   ```

### Step 2: `scripts/run-task/env.ts` — change `claudeBudget` type to `string | null`

**Files**: `scripts/run-task/env.ts`

At line 124, change the fallback from `'5.00'` to `null`:
```typescript
// Before:
claudeBudget: process.env.CLAUDE_BUDGET ?? '5.00',
// After:
claudeBudget: process.env.CLAUDE_BUDGET ?? null,
```
Type changes from `string` to `string | null`. This lets downstream consumers (policy) distinguish "operator set a flat cap" from "use the tier" — the semantic the spec requires.

### Step 3: `scripts/run-task/policy.ts` — expose `claudeBudget` in `policyConfig()`

**Files**: `scripts/run-task/policy.ts`

Add `claudeBudget` to the module-level `config` object (same pattern as the model env vars already there):
```typescript
const config = {
    ...existing model vars...
    maxReviewLoops: process.env.MAX_REVIEW_LOOPS ? Number.parseInt(process.env.MAX_REVIEW_LOOPS, 10) : null,
    claudeBudget: process.env.CLAUDE_BUDGET ?? null,
};
```

Add `claudeBudget: config.claudeBudget` to the `policyConfig()` return:
```typescript
export function policyConfig(): PolicyConfig {
    return {
        ...existing fields...
        maxReviewLoops: config.maxReviewLoops,
        claudeBudget: config.claudeBudget,
    };
}
```

### Step 4: `scripts/run-task/agents/claude.ts` — add `budget` param, remove flat read

**Files**: `scripts/run-task/agents/claude.ts`

1. Add `budget: string` as the **sixth** positional parameter to `runClaude` (after `effort`, before the optional `metricsContext`):
   ```typescript
   export async function runClaude(
       prompt: string,
       interactive: boolean,
       resumeId: string | null,
       model: string,
       effort: string,
       budget: string,
       metricsContext?: { taskId: string; phase: string; iteration?: number; activeCwd?: string },
       cwd = REPO_ROOT,
   ): Promise<ClaudeRunResult>
   ```

2. Replace `config.claudeBudget` with `budget` in the args array (line ~110):
   ```typescript
   '--max-budget-usd', budget,
   ```

3. Remove `config` from the import since it is no longer used in this file:
   ```typescript
   // Before:
   import { REPO_ROOT, config } from '../env.js';
   // After:
   import { REPO_ROOT } from '../env.js';
   ```

### Step 5: Phase files — pass `cfg.budget` to `runClaude`

**Files**: `scripts/run-task/phases/spec.ts`, `phases/plan.ts`, `phases/code-review.ts`, `phases/qa.ts`

Each file calls `runClaude(prompt, interactive, resumeId, cfg.model, cfg.effort, { metricsContext... })`. Insert `cfg.budget` between `cfg.effort` and the metrics object at every call site:

- `phases/spec.ts` line ~23 (`promptSpecRevision` path): add `cfg.budget`
- `phases/spec.ts` line ~39 (`promptSpec` path): add `cfg.budget`
- `phases/plan.ts` line ~25: add `cfg.budget`
- `phases/code-review.ts` line ~302: add `cfg.budget`
- `phases/qa.ts` line ~28: add `cfg.budget`

Pattern at each site:
```typescript
// Before:
const result = await runClaude(promptX(state), interactive, resumeId, cfg.model, cfg.effort, {
    taskId: ..., phase: ..., ...
});
// After:
const result = await runClaude(promptX(state), interactive, resumeId, cfg.model, cfg.effort, cfg.budget, {
    taskId: ..., phase: ..., ...
});
```

### Step 6: `scripts/run-task/main.ts` — update retry call site

**Files**: `scripts/run-task/main.ts`

At line ~2671 (`retryAgentForPhase`), the existing call is:
```typescript
await splitClaude.runClaude(prompt, false, sessionId, cfg.model, cfg.effort, undefined, retryCwd);
```
Insert `cfg.budget` after `cfg.effort`. The `undefined` (metricsContext) and `retryCwd` shift right by one:
```typescript
await splitClaude.runClaude(prompt, false, sessionId, cfg.model, cfg.effort, cfg.budget, undefined, retryCwd);
```

### Step 7: `tests/pipeline-policy.test.ts` — add budget test rows (AC-5, AC-6)

**Files**: `tests/pipeline-policy.test.ts`

1. Add `claudeBudget: null` to the existing `TEST_CONFIG` constant.

2. Add a test for tiered defaults (AC-5):
   ```typescript
   void test('budget-by-effective-size: tiered defaults when CLAUDE_BUDGET unset', () => {
       for (const [tasks, expected] of [
           [[s('S')],        '5.00'],
           [[s('M')],        '5.00'],
           [[s('L')],       '10.00'],
           [[s('XL')],      '20.00'],
           [[s('M', true)], '20.00'], // delicate → XL effective size
       ] as Array<[Array<{ task_size: TaskSize; delicate: boolean }>, string]>) {
           const p = getPipelinePolicy(tasks, TEST_CONFIG);
           assert.equal(p.claude('spec').budget, expected);
           assert.equal(p.claude('qa').budget, expected); // budget is phase-invariant
       }
   });
   ```

3. Add a test for the flat override (AC-6):
   ```typescript
   void test('budget-by-effective-size: CLAUDE_BUDGET flat override wins over tier', () => {
       const cfg = { ...TEST_CONFIG, claudeBudget: '20.00' };
       for (const size of ['S', 'M', 'L', 'XL'] as const) {
           const p = getPipelinePolicy([s(size)], cfg);
           assert.equal(p.claude('spec').budget, '20.00', `size ${size}`);
       }
   });
   ```

---

## Step 8: Fix A — `willPinCommitFollow` helper + conditional marker in `scripts/run-task/main.ts`

**Files**: `scripts/run-task/main.ts`

### 8a. Add `willPinCommitFollow` helper (place near `recordPinnedPRNumber` / `reportOrCreatePR`, ~line 872)

```typescript
/**
 * Returns true iff a subsequent unmarked pr.number commit is guaranteed to
 * follow the artifacts commit on the --pr create path.
 *
 * recordPinnedPRNumber commits only when anyChanged — i.e., when at least one
 * task's status.json doesn't yet have the PR number pinned. When all tasks are
 * already pinned (dirty-tree re-run against an already-open pinned PR), it
 * no-ops and the artifacts commit becomes the branch head. A [skip ci]-marked
 * head on a required-checks repo would block merge — so we mark only when a
 * pin commit is guaranteed to follow.
 */
function willPinCommitFollow(taskIds: string[], branchName: string, baseBranch: string): boolean {
    if (!ghAvailable) return false;
    const openPR = findOpenPRNumber(branchName, baseBranch);
    if (openPR === null) return true; // new PR will be created then pinned → pin commit follows
    // PR exists — check if every task already has this number pinned.
    // If any is missing the pin, recordPinnedPRNumber will commit.
    return taskIds.some(taskId => readPinnedPrNumber(splitState.readStatus(taskId)) !== openPR);
}
```

### 8b. Use it in `commitHumanReviewFiles` (dirty-tree path, ~line 1225)

In the dirty-tree commit path, after `branchName` is resolved (line ~1222) and `label` is set (line ~1223), replace the single `const commitMessage = ...` line with:

```typescript
const skipCi = createPR && willPinCommitFollow(taskIds, branchName, baseBranch);
const commitMessage = `chore: add task artifacts for ${label}${skipCi ? ' [skip ci]' : ''}`;
```

`baseBranch` is already in scope at line 991. The clean-tree branch (lines 1115–1141) returns early before this code and is unaffected.

---

## Step 9: `tests/run-task-ship.test.ts` — add AC-1, AC-2b, AC-2c tests

**Files**: `tests/run-task-ship.test.ts`

Add three new tests after the existing `'--pr pins pr.number on create path and leaves status clean'` test. The test infrastructure (`withTempDir`, `makeGitFixture`, `setupFakeTools`, `writeTaskFiles`, `makeHumanReviewStatus`, `readStatusFile`, `runCanon`, `gitIn`) is already imported/defined in the file.

**Test 1 — AC-1 + AC-2: artifacts commit carries `[skip ci]`, head does not:**
```typescript
void test('--pr create path: artifacts commit carries [skip ci], pr.number commit does not', () => {
    withTempDir('run-task-ship-pr-skip-ci-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-skip-ci';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));

        const result = runCanon(localDir, [taskId, '--pr'], fakeTools, {
            FAKE_GH_STATE_FILE: path.join(dir, 'gh-state.txt'),
            FAKE_GH_CREATE_NUMBER: '42',
        });

        assert.equal(result.status, 0, result.stderr);
        // git log -2 is most-recent first: [0]=HEAD (pr.number commit), [1]=HEAD~1 (artifacts)
        const [headMsg, artifactsMsg] = gitIn(localDir, 'log', '--format=%s', '-2')
            .trim().split('\n');
        // AC-1: artifacts commit is [skip ci]-marked
        assert.match(artifactsMsg ?? '', /\[skip ci\]/, 'artifacts commit must carry [skip ci]');
        // AC-2: head (pr.number commit) is NOT marked
        assert.doesNotMatch(headMsg ?? '', /\[skip ci\]/, 'pr.number commit must not carry [skip ci]');
    });
});
```

**Test 2 — AC-2b: clean-tree idempotent re-run leaves head unmarked, no new commits:**
```typescript
void test('--pr clean-tree re-run: head stays unmarked, no new commits', () => {
    withTempDir('run-task-ship-pr-rerun-skip-ci-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-rerun-skip-ci';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));

        const env = {
            FAKE_GH_OPEN_PR_NUMBER: '55',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/55',
        };
        const first = runCanon(localDir, [taskId, '--pr'], fakeTools, env);
        assert.equal(first.status, 0, first.stderr);

        const countAfterFirst = gitIn(localDir, 'log', '--oneline').trim().split('\n').length;
        const headAfterFirst = gitIn(localDir, 'log', '--format=%s', '-1').trim();
        assert.doesNotMatch(headAfterFirst, /\[skip ci\]/);

        const second = runCanon(localDir, [taskId, '--pr'], fakeTools, env);
        assert.equal(second.status, 0, second.stderr);

        const countAfterSecond = gitIn(localDir, 'log', '--oneline').trim().split('\n').length;
        assert.equal(countAfterSecond, countAfterFirst, 'clean-tree re-run must not add commits');
        assert.doesNotMatch(gitIn(localDir, 'log', '--format=%s', '-1').trim(), /\[skip ci\]/);
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
    });
});
```

**Test 3 — AC-2c: dirty-tree with PR already pinned → artifacts commit has NO `[skip ci]`:**
```typescript
void test('--pr dirty-tree already-pinned: artifacts commit not [skip ci]-marked', () => {
    withTempDir('run-task-ship-pr-dirty-pinned-', dir => {
        const { localDir } = makeGitFixture(dir);
        const fakeTools = path.join(dir, 'fake-tools');
        setupFakeTools(fakeTools);
        const taskId = 'ship-pr-dirty-pinned';
        const branch = `task/${taskId}`;
        gitIn(localDir, 'checkout', '-b', branch);

        const env = {
            FAKE_GH_OPEN_PR_NUMBER: '66',
            FAKE_GH_PR_HEAD: branch,
            FAKE_GH_PR_BASE: 'main',
            FAKE_GH_PR_URL: 'https://github.com/example/repo/pull/66',
        };
        // First run: 66 not yet pinned → willPinCommitFollow = true → [skip ci] on artifacts
        writeTaskFiles(localDir, taskId, makeHumanReviewStatus(taskId, branch));
        const first = runCanon(localDir, [taskId, '--pr'], fakeTools, env);
        assert.equal(first.status, 0, first.stderr);
        assert.equal(
            (readStatusFile(localDir, taskId) as { pr?: { number?: number } }).pr?.number,
            66,
        );

        // Dirty a task artifact while 66 is already pinned → willPinCommitFollow = false
        fs.appendFileSync(path.join(localDir, 'tasks', taskId, 'done.md'), '\n## Updated\n', 'utf8');

        const second = runCanon(localDir, [taskId, '--pr'], fakeTools, env);
        assert.equal(second.status, 0, second.stderr);

        // The new artifacts commit is now the head; must NOT have [skip ci]
        const headMsg = gitIn(localDir, 'log', '--format=%s', '-1').trim();
        assert.doesNotMatch(
            headMsg,
            /\[skip ci\]/,
            'when no pin commit follows, artifacts commit must not be [skip ci]-marked',
        );
        assert.equal(gitIn(localDir, 'status', '--porcelain'), '');
    });
});
```

Note: `fs` is imported at the top of the test file as `import fs from 'node:fs'` — confirm this is present (or add it if the existing import uses `import * as fs`).

---

## Step 10: `docs/pipeline-orchestrator.md` — update `CLAUDE_BUDGET` env-var row

**Files**: `docs/pipeline-orchestrator.md`

Find the `CLAUDE_BUDGET` row in the env-var reference table. Update the description to reflect tiered defaults and override semantics:

> **Before**: `Default '5.00'. Max spend per Claude phase.`  
> **After**: `Per-phase budget cap. Default: tiered by effective size — S/M '$5.00', L '$10.00', XL/delicate '$20.00'. Set to a flat value (e.g. '20.00') to override for all phases regardless of size.`

---

## Step 11: Build, validate, and commit

```bash
npm run lint
npm run type-check
npm test
npm run build          # regenerates dist/; required per spec Validation Required
npm run sync-templates:check
npm run docs-refs-check
```

Commit all source + `dist/` changes together (per spec: `npm run build` is declared in Validation Required, so the dist delta is part of the implementation commit, not a separate step).

---

## Testing Plan

- **Unit (policy)**: `tests/pipeline-policy.test.ts` — new budget table rows cover AC-5 and AC-6 for every effective size + the CLAUDE_BUDGET override case.
- **Unit (ship)**: `tests/run-task-ship.test.ts` — three new test cases cover AC-1 (marker present on artifacts commit), AC-2 (marker absent on head), AC-2b (clean-tree re-run), and AC-2c (dirty-tree already-pinned). Existing pin/bundle/clean-tree assertions continue to pass (AC-3).
- **Inspection (AC-7, AC-8)**: After implementation, confirm `grep -rn "claudeBudget" scripts/ src/` shows hits only in `env.ts`, `pipeline-policy.ts`, `policy.ts`; confirm `agents/claude.ts` has no `config.claudeBudget` read. Confirm `runClaude` signature has `budget: string` and all five phase call sites + retry call site pass it.
- **Manual (AC-4)**: Existing `--push`-only tests stay green; no `[skip ci]` marker touches that path.
- **Human Test Plan**: See spec — budget tiers verified via dry-run/log on an L or XL task; CI run count verified on a live `--pr` against a real repo.

## Rollback Plan

Both fixes are orchestrator-internal only — no `status.json` shape changes, no adopter-facing API changes. Reverting the commit drops both changes cleanly. The only user-visible behavior is: (a) `[skip ci]` no longer appears in `--pr` artifacts commit messages (Fix A revert) and (b) XL/delicate phases revert to $5 cap (Fix B revert, safe — $5 was the prior behavior). No data migration concerns.

---

## Reroute Plan

Fix A is completely redesigned by the spec amendment (see `spec.md` §Amendment). Fix B (Steps 1–7) is fully implemented and unchanged — no re-work needed there.

### Delta

**Step R1 — `scripts/run-task/main.ts`: rewrite `recordPinnedPRNumber` to write sidecar (lines 840–870)**

Remove all git-stage/commit/push logic and the `anyChanged` guard. Replace `status.pr = { number: prNum }` + `splitState.writeStatus` with a sidecar write: for each `taskId`, write `String(prNum)` to `path.join(cwd, 'tasks', taskId, '.pr-number')` (create or overwrite — idempotent). Remove the `status.json` mutation entirely. The function signature stays the same; it just no longer touches git.

**Step R2 — `scripts/run-task/main.ts`: delete `willPinCommitFollow` and remove `[skip ci]` from `commitHumanReviewFiles`**

- Delete `willPinCommitFollow` entirely (lines 872–879).
- In `commitHumanReviewFiles` (lines 1233–1237), remove the `willPinCommitFollow` call and the conditional suffix; restore the plain commit message:
  ```typescript
  const commitMessage = `chore: add task artifacts for ${label}`;
  ```
  Remove the `baseBranch` parameter from `commitHumanReviewFiles` if it was added solely for `willPinCommitFollow` (verify at the call site before removing).

**Step R3 — `scripts/run-task/main.ts`: replace `readPinnedPrNumber` with a sidecar reader**

Rename/replace `readPinnedPrNumber(status: StatusJson): number | null` with `readSidecarPRNumber(taskId: string, cwd: string): number | null`:
- Read `path.join(cwd, 'tasks', taskId, '.pr-number')`; return `null` if absent or any I/O error
- Parse the trimmed content as an integer; if malformed, NaN, non-integer, or ≤ 0, **fail closed — return `null`** (amendment-review nit: malformed content must fall back to branch-lookup, never be treated as a trusted pin)
- Return the parsed positive integer

Update all callers:
- `recordPinnedPRNumber` (line 844): the "already pinned" skip check can now call `readSidecarPRNumber(taskId, cwd)` — `cwd` is already in scope.
- `resolveProofPRNumberForPrefetch` (line 1549–1553): replace `readPinnedPrNumber(status)` with `readSidecarPRNumber(taskId, cwd)`; thread `taskId` and `cwd` through its signature (check the call site to confirm they're available — the function is called during the `--ship` proof-prefetch loop which has both).
- `establishMergeProof` (line 1599): replace `readPinnedPrNumber(status)` with `readSidecarPRNumber(taskId, cwd)` — `cwd` is already in the signature; thread `taskId` through (check the call site).

The `status: StatusJson` parameter can be removed from both ship-path functions once `pr.number` is no longer read from it, but only if it has no other uses there (verify before removing).

**Step R4 — `.gitignore`: add sidecar pattern**

After the existing `tasks/**/.heartbeat.json` line (line 25), add:
```
tasks/**/.pr-number
```

**Step R5 — `tests/run-task-ship.test.ts`: replace `[skip ci]` tests with sidecar tests**

Remove the three tests added in the original iteration that verify `[skip ci]` marker placement (the create-path marker test, the clean-tree re-run test, and the dirty-tree-already-pinned test). Replace with:

- **AC-A1**: After `--pr` on the create path, `git log --oneline` shows exactly one new commit (the artifacts commit) as HEAD with no `record pr.number` commit anywhere in the log.
- **AC-A2**: No `[skip ci]` appears in any commit message (`git log --format=%s` has no `[skip ci]` match). Additionally, `willPinCommitFollow` does not exist (grep check in test or as a separate structural assertion).
- **AC-A3**: After `--pr`, `tasks/<id>/.pr-number` sidecar exists and contains the PR number as a string; `git status --porcelain` is empty (clean tree). `pr.number` is not present in the committed `status.json` (read the file and assert the `pr` field is absent or `pr.number` is missing).
- **AC-A4**: `--ship` reads `pr.number` from the sidecar (sidecar-present path: verify proof succeeds with the sidecar number); when the sidecar is absent, the existing branch-lookup fallback still works (sidecar-absent path: delete the sidecar or use a fixture without one and verify `--ship` still locates the PR via branch-lookup).

Keep all existing clean-tree, pin, and bundle assertions that don't reference `[skip ci]` (AC-3 equivalents for the new design).

**Step R6 — Build and validate**

Same as original Step 11:
```bash
npm run lint
npm run type-check
npm test
npm run build
npm run sync-templates:check
npm run docs-refs-check
```

Commit all source + `dist/` changes together.

---

## Reroute Plan Round 2

<!-- per-round append shape:
## Reroute Plan Round 2
### Delta
- ...ordered steps for the amendment delta only...
-->

Prior plan Steps 1–7 (Fix B) and Reroute Plan Round 1 Steps R1–R6 (Approach B sidecar) are fully implemented and passing. The two delta items below address Amendment Round 2 only.

### Delta

**Step RR1 — `scripts/run-task/agents/claude.ts:83`: Remove `--max-budget-usd` from the interactive branch**

At line 83, the interactive args array reads:
```typescript
const args = ['--model', model, '--effort', effort, '--max-budget-usd', budget, '--add-dir', REPO_ROOT];
```
Remove `'--max-budget-usd', budget,` from this array. The `budget` parameter stays in `runClaude`'s signature — it is still used at line 111 in the print (`-p`) branch. The `info(...)` logging at line 68 (`Budget: ${budget}`) can remain; it is informational only and budget is still resolved and meaningful for the print path.

After: interactive args contain only `--model`, `--effort`, `--add-dir` (plus optional `--add-dir` for non-REPO_ROOT cwd and `--resume`). Print args at line 111 are unchanged.

**Step RR2 — `scripts/run-task/main.ts`: Thread worktree-tolerant cwd into sidecar helpers**

`sidecarPathFor` (line 840) and `readSidecarPRNumber` (line 1507) both resolve the sidecar path through `taskDirFor(taskId)`, which `die()`s when `status.json` has `worktree: true` but the directory is gone. The `--ship` partial-cleanup recovery at lines 1929–1931 and 1976–1978 already calls `getActiveCwd([taskId], { tolerateMissingWorktree: true })` to get a tolerated cwd — but that cwd is never threaded into the sidecar reads.

Two sub-steps:

*RR2a — add optional `cwd` parameter to `sidecarPathFor` and `readSidecarPRNumber`:*
```typescript
// line 840
function sidecarPathFor(taskId: string, cwd?: string): string {
    const base = cwd ?? taskDirFor(taskId);
    return path.join(base, 'tasks', taskId, '.pr-number');
    // NOTE: when cwd is the worktree root (has tasks/<id>/ under it), use:
    //   path.join(cwd, 'tasks', taskId, '.pr-number')
    // When cwd is taskDir itself (no-worktree path, cwd omitted), use:
    //   path.join(taskDirFor(taskId), '.pr-number')
}
```
Check what `taskDirFor` returns — if it returns the `tasks/<id>/` dir itself (not the repo root), then the with-cwd form should be `path.join(cwd, 'tasks', taskId, '.pr-number')` and the without-cwd form stays `path.join(taskDirFor(taskId), '.pr-number')`. Verify by reading the `splitState.taskDirFor` source before making the call; the invariant is that both forms resolve to the same `tasks/<id>/.pr-number` path when the worktree is present.

```typescript
// line 1507
function readSidecarPRNumber(taskId: string, cwd?: string): number | null {
    const sidecarPath = sidecarPathFor(taskId, cwd);
    ...  // unchanged
}
```

*RR2b — update the two `--ship` sidecar-read call sites to pass the tolerated cwd:*

- `resolveProofPRNumberForPrefetch` (line 1523): add `cwd: string` to its signature; pass it through to `readSidecarPRNumber(taskId, cwd)`. Update the call site at line 1932 to pass the already-computed `activeCwd` (which is `getActiveCwd([taskId], { tolerateMissingWorktree: true })` computed at line 1929–1931).

- `establishMergeProof` (line 1565): already receives `cwd: string`; change `readSidecarPRNumber(taskId)` at line 1573 to `readSidecarPRNumber(taskId, cwd)`.

The `recordPinnedPRNumber` callers (`--pr` time, lines 844–852) run only when the worktree is live — no change needed there.

**Step RR3 — `tests/run-task-prompts.test.ts`: Assert interactive args contain no `--max-budget-usd` (AC-R2-1)**

Add a test in `tests/run-task-prompts.test.ts` (existing file). The test inspects the args array produced for an interactive `runClaude` invocation — either by calling the function directly or by extracting the args-building logic — and asserts `--max-budget-usd` is absent. The print-path args assertion (if one exists) should still include `--max-budget-usd`.

If the file only tests prompt text rather than spawn args, add the assertion as a separate structural test. The goal is a regression check: `--max-budget-usd` must not appear in the interactive args array.

**Step RR4 — `tests/run-task-ship.test.ts`: Orphaned-worktree `--ship` reads sidecar without crashing (AC-R2-2)**

Add a test case: construct an orphaned-worktree state (task `status.json` has `worktree: true`, worktree directory is absent, sidecar `.pr-number` exists under the sidecar path resolved via tolerant cwd) and run `--ship`. Assert the run does not crash (exit 0 or expected die with merge-state reason, not a `taskDirFor`-sourced die). Also cover the fallback path: same setup but sidecar absent → `--ship` falls back to branch-lookup without crashing.

**Step RR5 — Build and validate**

Same validation suite as prior rounds:
```bash
npm run lint
npm run type-check
npm test
npm run build
npm run sync-templates:check
npm run docs-refs-check
```

Commit source + `dist/` together.

---

## Reroute Plan Round 3

<!-- per-round append shape:
## Reroute Plan Round 3
### Delta
- ...ordered steps for the amendment delta only...
-->

Prior plan Steps 1–7 (Fix B), Reroute Plan Round 1 Steps R1–R6 (sidecar mechanism), and Reroute Plan Round 2 Steps RR1–RR5 (interactive-flag removal + worktree-tolerant sidecar read) are fully implemented. The single delta item below addresses Amendment Round 3 only.

### Delta

**Step RRR1 — `scripts/run-task/main.ts:1815-1818`: Replace `resolveShipCwd` with delegation to `getActiveCwd`**

The hand-rolled helper at lines 1815-1818 checks `fs.existsSync(worktreePath(taskId)/tasks/<id>/status.json)` and falls back to `REPO_ROOT`. Replace it with a thin wrapper (or inline call) that delegates to the shared resolver:

```typescript
const resolveShipCwd = (taskId: string): string =>
    splitWorktree.getActiveCwd([taskId], { tolerateMissingWorktree: true });
```

This one-line replacement:
- Removes the `fs.existsSync`-on-`worktreePath` approximation (AC-R3-1 structural check: `grep -rn "existsSync.*worktreePath\|worktreePath.*existsSync" scripts/` returns nothing after)
- Restores the branch-based worktree lookup (`findExistingWorktreeForBranch` inside `resolveTaskCwd`), which bundle secondary tasks require — their worktree is named after the primary, so `worktreePath(secondaryId)` does not exist but `getActiveCwd` finds it via branch lookup (AC-R3-2)
- Restores `CANON_TASKS_DIR_OVERRIDE` semantics from `state.ts:36/47/111` (AC-R3-3)
- Preserves the orphaned-worktree `tolerateMissingWorktree: true` fallback from Round 2 (AC-R3-4)

All six `resolveShipCwd` call sites in `shipTasks` (`readShipStatus`, `readShipBranchName`, the phase guard at line 1872, and the sidecar read paths) are unchanged in shape — they all call `resolveShipCwd(taskId)` and receive the correct cwd.

The `fs` import in this area of `main.ts` may become unused after removing `fs.existsSync` from `resolveShipCwd` — verify and remove the import if no other callers remain in scope (do not remove if `fs` is used elsewhere in the file).

**Step RRR2 — `tests/run-task-ship.test.ts`: Add AC-R3-2 and AC-R3-3 tests**

Add two new test cases after the existing orphaned-worktree test:

- **AC-R3-2 — bundle-secondary resolution**: Set up a two-task bundle where the primary task has a worktree and the secondary does not have its own `worktreePath(secondaryId)` directory (simulating the real bundle layout where one worktree hosts both). Run `--ship` with both task IDs and assert the secondary's ship-path reads (status + `.pr-number` sidecar) resolve to the shared worktree path, not `REPO_ROOT`. The existing fake-git/gh subprocess harness already supports multi-task `runCanon` calls; mirror the pattern from the existing bundle-ship test in the file.

- **AC-R3-3 — `CANON_TASKS_DIR_OVERRIDE`**: Set up a fixture with `CANON_TASKS_DIR_OVERRIDE` pointing to a temp override dir containing the task's `tasks/<id>/` artifacts. Run `--ship` and assert the status read resolves under the override directory (not `REPO_ROOT/tasks`). Pass `CANON_TASKS_DIR_OVERRIDE` via the env arg of `runCanon`.

The existing AC-R2-2 orphaned-worktree test (added in Round 2) must continue to pass without modification — no changes to it.

**Step RRR3 — Build and validate**

Same validation suite as prior rounds:
```bash
npm run lint
npm run type-check
npm test
npm run build
npm run sync-templates:check
npm run docs-refs-check
```

Commit source + `dist/` together.
