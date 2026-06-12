# Plan: qa-end-commit — Commit QA artifacts at QA-end so the worktree is clean

> Written by: Claude | Implements: `tasks/qa-end-commit/spec.md`
> Spec review verdict: `approved_with_nits`.
> Nit incorporated: the helper stages `tasks/<id>` as a **directory** (via `buildHumanReviewStagePaths`'s whole-task-dir logic), not a narrowed list of five filenames — so `pr-body.md` is naturally included without special-casing.

---

## Approach

Two changes, independently valuable:

1. **Structural fix (AC-9)**: Add `PIPELINE_MANAGED_DOCS` to `autoCommitAllowedSourceBypass` in `validation.ts`. This closes issue #152's root mechanism — a dirty managed doc can no longer be classified as an uncovered implement change — independent of commit timing. Covers the residual implement→first-QA window even after this task ships.

2. **Timing fix (AC-1–8, AC-10)**: Add `commitQaArtifacts(taskIds, cwd)` in `main.ts` and wire it as a `case 'qa':` in `checkAndRoute`. This is the single chokepoint: both the normal QA-completion path and the `tryEvidenceAdvance` evidence-advance path both exit through `checkAndRoute`, so calling it there covers both (AC-3).

The helper mirrors `commitHumanReviewFiles`'s staging/allowlist shape but performs **no** push and **no** PR creation. Since `qa.status === 'done'` at call time, the full `PIPELINE_MANAGED_DOCS` set is the correct `affectedManagedDocs` — the same logic as `commitHumanReviewFiles` lines 1074–1083 (the QA docs-freshness auto-allowlist). No per-task spec Affected Files parsing needed.

---

## Steps

### Step 1: Add `PIPELINE_MANAGED_DOCS` to `autoCommitAllowedSourceBypass` (`scripts/run-task/validation.ts:763`)

**Files**: `scripts/run-task/validation.ts`

**Change**: At the `autoCommitAllowedSourceBypass` function (line 763), add a third return clause:

```ts
function autoCommitAllowedSourceBypass(filePath: string): boolean {
    if (filePath.startsWith('tasks/')) return true;
    if ((PIPELINE_TELEMETRY_FILES as readonly string[]).includes(filePath)) return true;
    return (PIPELINE_MANAGED_DOCS as readonly string[]).includes(filePath);
}
```

`PIPELINE_MANAGED_DOCS` is already imported from `'./worktree.js'` at line 5 — no new import required.

**Why**: The current function exempts only `tasks/` prefixes and `PIPELINE_TELEMETRY_FILES`. A managed doc dirty during the implement phase (e.g. from QA on a prior rerouted iteration) is treated as an uncovered source change, aborting the auto-commit. This is issue #152's root mechanism. The fix is independent of commit timing — it also covers the residual implement→first-QA uncommitted-progress window.

---

### Step 2: Add `commitQaArtifacts(taskIds, cwd)` to `scripts/run-task/main.ts`

**Files**: `scripts/run-task/main.ts`

Place this function directly before `commitHumanReviewFiles` (currently line 969) so both commit helpers are co-located. Do **not** modify `commitHumanReviewFiles`.

```ts
function commitQaArtifacts(taskIds: string[], cwd: string): void {
    // qa.status is 'done' at this point, so the full managed-docs set is in scope —
    // mirrors the QA docs-freshness auto-allowlist in commitHumanReviewFiles (lines 1074-1083).
    const affectedManagedDocs = new Set<string>(splitWorktree.PIPELINE_MANAGED_DOCS);

    const dirtyResult = gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');
    if (!dirtyResult.ok) {
        die(`QA-end commit aborted: failed to inspect dirty files: ${dirtyResult.stderr || 'unknown error'}`);
    }

    const dirtyEntries = splitGit.parsePorcelainEntries(dirtyResult.stdout);

    // Clean tree: nothing to commit. Idempotent — e.g. canon run --step called twice.
    if (dirtyEntries.length === 0) return;

    // Reject dirty files outside the QA-end allowlist (task-artifact dirs, telemetry,
    // managed docs). Source edits must have been committed during implement.
    const unexpected = dirtyEntries.filter(
        entry => !entry.paths.every(p => humanReviewAllowedPath(taskIds, affectedManagedDocs, p)),
    );
    if (unexpected.length > 0) {
        die(
            `QA-end commit aborted: working tree has dirty files outside the QA-end allowlist.\n` +
            unexpected.map(entry => `  ${entry.raw}`).join('\n') + '\n' +
            `The allowlist is: tasks/<id>/, PIPELINE_TELEMETRY_FILES, and all PIPELINE_MANAGED_DOCS.\n` +
            `Source or test edits must be committed during the implement phase, not left dirty at QA-end.`,
        );
    }

    // buildHumanReviewStagePaths stages tasks/<id> as a whole directory (not individual
    // filenames), so pr-body.md and all task artifacts are included without special-casing.
    const stagePaths = buildHumanReviewStagePaths(taskIds, affectedManagedDocs, dirtyEntries);

    if (stagePaths.length === 0) return;

    // Guard against pre-staged files escaping into this commit.
    const stagedBefore = gitSafeAt(cwd, 'diff', '--cached', '--name-only');
    if (!stagedBefore.ok) {
        die(`QA-end commit aborted: could not inspect staged files: ${stagedBefore.stderr || 'unknown error'}`);
    }
    const stagedBeforeUnexpected = stagedBefore.stdout
        .split('\n').map(l => l.trim()).filter(Boolean)
        .filter(p => !humanReviewAllowedPath(taskIds, affectedManagedDocs, p));
    if (stagedBeforeUnexpected.length > 0) {
        die(
            `QA-end commit aborted: staged files outside the QA-end allowlist:\n` +
            stagedBeforeUnexpected.map(f => `    ${f}`).join('\n'),
        );
    }

    for (const relPath of stagePaths) {
        const addResult = gitSafeAt(cwd, 'add', '-A', '--', relPath);
        if (!addResult.ok) {
            die(`QA-end commit aborted: failed to stage ${relPath}: ${addResult.stderr || 'unknown error'}`);
        }
    }

    const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
    const commitMessage = `chore: QA artifacts for ${label}`;
    const commitResult = gitSafeAt(cwd, 'commit', '-m', commitMessage);
    if (!commitResult.ok) {
        die(`QA-end commit aborted: ${commitResult.stderr || 'unknown error'}`);
    }

    info(`Committed QA artifacts: ${commitMessage}`);
    // No push. commitHumanReviewFiles handles push at --pr/--push time.
}
```

**Key design points**:
- `humanReviewAllowedPath` and `buildHumanReviewStagePaths` are already defined in this file — no new imports.
- `gitSafeAtRaw` and `gitSafeAt` are already used throughout this file.
- Do not call `splitValidation.verifyBaseDivergence` or the docs-refs check — those are PR-time gates, not QA-end gates.
- The commit message format `chore: QA artifacts for ${label}` differs from `commitHumanReviewFiles`'s `chore: add task artifacts for ${label}` — this is intentional per spec AC-4.

---

### Step 3: Wire the chokepoint in `checkAndRoute` (`scripts/run-task/main.ts:2840`)

**Files**: `scripts/run-task/main.ts`

Add `case 'qa':` to the `switch (phase)` block in `checkAndRoute`. Insert it before the existing `default: return;`:

```ts
case 'qa': {
    const qaCwd = splitWorktree.getActiveCwd(taskIds);
    commitQaArtifacts(taskIds, qaCwd);
    return;
}
```

**Why this is the single chokepoint (AC-3)**: `checkAndRoute('qa', taskIds)` is called after every QA phase completion, regardless of path:
- **Normal path**: `runQaPhase` → Claude calls `canon task phase <id> qa done` → `checkAndRoute('qa', taskIds)` is called in the main loop at line 3236.
- **Evidence-advance path**: `tryEvidenceAdvance` (called from `recoverPhaseForTask` inside `checkAndRoute`'s pre-verification loop, lines 2803–2828) calls `taskPhase(taskId, 'qa', 'done')` → the loop continues → falls through to the `switch (phase)` at line 2840.

Both paths exit through the same `switch (phase)` tail. Adding `case 'qa':` here covers both without duplicating the call.

`getActiveCwd` is already used with the same `taskIds` pattern at line 2386 (`runPhase` dispatch for the `qa` phase). No new import required.

---

### Step 4: Unit test — managed doc bypass in `findUncoveredTrackedChanges` (`tests/run-task-parse-porcelain.test.ts`)

**Files**: `tests/run-task-parse-porcelain.test.ts`

Add one test (AC-9 / #152 regression). `findUncoveredTrackedChanges` is already imported at line 8.

```ts
void test('findUncoveredTrackedChanges does not flag a dirty managed doc absent from handoff (AC-9, #152 fix)', () => {
    // docs/codebase-map.md is in PIPELINE_MANAGED_DOCS. Even when absent from the
    // handoff files set, it must not be reported as an uncovered implement change.
    const porcelain = ' M docs/codebase-map.md\n M src/feature.ts\n';
    const handoff = new Set(['src/feature.ts']);
    const uncovered = findUncoveredTrackedChanges(porcelain, handoff);
    assert.deepEqual(uncovered, [], 'managed doc must be exempted by autoCommitAllowedSourceBypass');
});
```

No new imports required (both `findUncoveredTrackedChanges` and `assert` are already in scope).

---

### Step 5: Unit tests for the commit helper paths (`tests/run-task-safety.test.ts`)

**Files**: `tests/run-task-safety.test.ts`

Add tests below. Use the existing `withTempDir`, `setupFakeGit`, `writeTaskStatus`, `runNodeInline`, `makeCompleteStatus` helpers. Use `FAKE_GIT_STATUS_OUTPUT` to control porcelain output and `FAKE_GIT_LOG` to assert git commands.

Add `PIPELINE_MANAGED_DOCS` to the import from `'../scripts/run-task/worktree.js'` (already imported as `splitWorktree` at line ~13; add `PIPELINE_MANAGED_DOCS` to the named imports or use `splitWorktree.PIPELINE_MANAGED_DOCS`).

**AC-1/AC-7 — staged-path set derives from worktree git status, includes whole task dir and managed docs**

Unit test on exported `buildHumanReviewStagePaths` (no subprocess needed):

```ts
void test('buildHumanReviewStagePaths with full PIPELINE_MANAGED_DOCS includes any dirty managed doc (AC-1, AC-7)', () => {
    // Simulates affectedManagedDocs that commitQaArtifacts derives (full set, qa is done).
    const allManagedDocs = new Set(PIPELINE_MANAGED_DOCS);
    const paths = buildHumanReviewStagePaths(['task-a'], allManagedDocs, [
        { raw: ' M tasks/task-a/done.md',        indexStatus: ' ', worktreeStatus: 'M', paths: ['tasks/task-a/done.md'] },
        { raw: ' M tasks/task-a/pr-body.md',      indexStatus: ' ', worktreeStatus: 'M', paths: ['tasks/task-a/pr-body.md'] },
        { raw: ' M docs/codebase-map.md',         indexStatus: ' ', worktreeStatus: 'M', paths: ['docs/codebase-map.md'] },
        { raw: ' M docs/lessons-learned.md',      indexStatus: ' ', worktreeStatus: 'M', paths: ['docs/lessons-learned.md'] },
    ]);
    // tasks/<id> staged as whole directory — pr-body.md is included automatically.
    assert.ok(paths.includes('tasks/task-a'), 'task dir staged as whole directory');
    assert.ok(paths.includes('docs/codebase-map.md'), 'managed doc staged');
    assert.ok(paths.includes('docs/lessons-learned.md'), 'telemetry staged');
    // Paths derive from the dirty entries, not from a hardcoded REPO_ROOT list.
    assert.ok(!paths.includes('docs/decisions.md'), 'non-dirty managed doc not staged');
});
```

**AC-10(a) — QA-touched managed doc absent from Affected Files appears in staged set**

Same pattern, using a doc not normally in spec Affected Files:

```ts
void test('buildHumanReviewStagePaths stages a QA-touched managed doc not in spec Affected Files (AC-10a)', () => {
    const allManagedDocs = new Set(PIPELINE_MANAGED_DOCS); // commitQaArtifacts always uses full set
    const paths = buildHumanReviewStagePaths(['task-b'], allManagedDocs, [
        { raw: ' M docs/decisions.md', indexStatus: ' ', worktreeStatus: 'M', paths: ['docs/decisions.md'] },
    ]);
    assert.ok(paths.includes('docs/decisions.md'), 'decisions.md staged even though not in Affected Files');
});
```

**AC-4 — commit message shape for single task and bundle**

Integration test via `runNodeInline` driving the QA→human_review transition:

For single task: set task to `qa pending` with a dirty `tasks/task-a/done.md` entry, run one step of the pipeline past QA, read `FAKE_GIT_LOG` and assert the commit line is `commit -m chore: QA artifacts for task-a`.

For bundle: same pattern with two task IDs (`task-a`, `task-b`), assert the commit line contains both ids.

Pattern follows the existing subprocess-based tests. Use `FAKE_GIT_STATUS_OUTPUT` to inject the dirty state, `FAKE_GIT_LOG` to capture the git invocations. The fake git script at `scripts/run-task/test-fixtures/` (or wherever `setupFakeGit` is defined) records all git calls to the log file.

**AC-5 — `--pr` after QA-end commit succeeds via existing clean-tree path (no regression)**

Extend or add alongside the existing test at line 1884. Setup: task at `human_review`, `FAKE_GIT_STATUS_OUTPUT` empty (simulating a clean tree post-QA-end-commit). Run `--pr`. Assert:
- Exit 0
- `FAKE_GIT_LOG` contains `push origin task/task-a`
- No "nothing to commit" `die` in stderr

**AC-6 — late dirty artifact at `--pr` still commits (no regression)**

Setup: task at `human_review`, `FAKE_GIT_STATUS_OUTPUT = ' M tasks/task-a/done.md'`. Run `--pr`. Assert:
- Exit 0
- `FAKE_GIT_LOG` contains `add -A -- tasks/task-a` and `commit -m`
- `FAKE_GIT_LOG` contains `push origin`

**AC-8 — #152 regression: reroute from clean committed state does not abort implement auto-commit**

This is a `findUncoveredTrackedChanges` unit test (structural, no subprocess needed):

```ts
void test('findUncoveredTrackedChanges does not abort on managed doc dirty during implement (AC-8, #152 regression)', () => {
    // Scenario: QA ran, touched docs/codebase-map.md, QA-end commit fired → now committed.
    // After --reroute, implement auto-commit inspects the tree. Even if docs/codebase-map.md
    // is somehow dirty (residual window), it must not be flagged as uncovered.
    const porcelain = ' M docs/codebase-map.md\n M src/impl.ts\n';
    const handoff = new Set(['src/impl.ts']); // only source in handoff
    const uncovered = findUncoveredTrackedChanges(porcelain, handoff);
    assert.deepEqual(uncovered, [], 'managed doc must not abort implement auto-commit');
});
```

(This test is structurally identical to the Step 4 test but named for the specific regression. Both should exist as separate tests for clarity.)

**AC-10(b) — dirty file outside union aborts QA-end commit**

Integration test via `runNodeInline`: task at `qa done`, `FAKE_GIT_STATUS_OUTPUT = ' M src/something.ts'`. Trigger the QA→human_review transition (run pipeline step). Assert:
- Exit non-zero
- stderr matches `/QA-end commit aborted: working tree has dirty files outside the QA-end allowlist/`

---

### Step 6: Documentation updates

These are implement-phase edits — committed via the handoff Changes table, so they are clean by QA and never staged by `commitQaArtifacts`.

**`docs/pipeline-orchestrator.md`** — Add a QA-end commit paragraph in the pipeline phase walk section (near the QA phase description). Canon-owned file: edit only the root copy; the pre-commit hook auto-syncs `templates/docs/pipeline-orchestrator.md`.

Content: describe that when `qa.status` transitions to `done`, the orchestrator calls `commitQaArtifacts` to commit all task-artifact dirs, dirty `PIPELINE_MANAGED_DOCS`, and telemetry. Commit message format. Why: clean tree prevents reroute abort (issue #152) and removes the stash/pop dance at `--pr`. Note the residual implement→first-QA uncommitted-progress window as a documented non-goal.

**`docs/patterns.md`** — Find the existing pitfall about "Operator git surgery on a task branch between phases discards uncommitted pipeline state" and update it:
- The post-QA window is now closed by the QA-end commit.
- The implement→first-QA residual window (during the implement↔code_review loop before QA ever completes) remains.

**`docs/BACKLOG.md`** — Check off the "Commit pipeline state at QA-end so it survives operator git surgery" backlog item (≈ line 886). Change `[ ]` to `[x]`.

---

### Step 7: `npm run build`

Rebuild `dist/scripts/run-task.js`. This bundles `scripts/run-task/main.ts` and `scripts/run-task/validation.ts`. Commit the rebuilt artifact alongside the source changes.

---

### Step 8: `npm run sync-templates`

Explicitly sync `templates/docs/pipeline-orchestrator.md` from the root copy. Verify with `npm run sync-templates:check`. The pre-commit hook does this automatically, but an explicit run before the handoff confirms the mirror is clean.

---

## Implementation Order

1. Step 1 — `validation.ts` bypass (smallest, most isolated, no dependencies)
2. Step 2 — `commitQaArtifacts` helper in `main.ts`
3. Step 3 — chokepoint wiring in `checkAndRoute`
4. Step 4 — `run-task-parse-porcelain.test.ts` test for AC-9
5. Step 5 — `run-task-safety.test.ts` tests for remaining ACs
6. Step 6 — doc edits (`pipeline-orchestrator.md`, `patterns.md`, `BACKLOG.md`)
7. Step 7 — `npm run build`
8. Step 8 — `npm run sync-templates`

Run `npm run lint && npm run type-check && npm test && npm run build && npm run sync-templates:check && npm run docs-refs-check` before marking implement done.

## Rollback

This change is additive: one new helper function and one new switch case. Reverting removes the QA-end commit and the reconciler exemption. No data migration. In-flight tasks at `human_review` or `complete` at time of rollback retain their already-committed QA artifacts (no harm). Tasks mid-pipeline would revert to the previous dirty-worktree behavior.
