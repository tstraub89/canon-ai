# Implementation Plan: bundle-preflight-atomic-rejection

> Written by: Claude | Implements: `tasks/bundle-preflight-atomic-rejection/spec.md`

## Nit from spec-review incorporated

The spec-review nit asks the plan to specify how `<N>` is derived for the appended clean-task headings (AC-4). Resolution: `preflight_rejections_current_loop + 1`, read from the task's status BEFORE the `taskPhasePreflightRejected` call. This is 1-based, stable across reroute loops, and the test assertions below pin the numeric convention explicitly.

---

## Approach

Single-file refactor of `scripts/run-task/phases/code-review.ts`. The pre-flight rejection write loop currently iterates only `preflightFailed`; we broaden it to iterate ALL `tasks`, writing per-task content based on whether the task is in `preflightFailed` or not. A new helper `buildCleanTaskReviewStub` handles the four cases (route × append-vs-fresh). The `taskPhasePreflightRejected` call on Route A is broadened to all N tasks. Route B is unchanged except the clean-task `review.md` is now written. Tests live in `tests/run-task-validation.test.ts` (already houses all pre-flight tests).

---

## Steps

### Step 1: Add `buildCleanTaskReviewStub` to `code-review.ts`

File: `scripts/run-task/phases/code-review.ts`

Add an exported function immediately after `buildPreflightReviewBlock`. It takes:
- `taskId: string` — the clean task.
- `siblingTaskIds: readonly string[]` — the failing sibling IDs.
- `route: PreflightRoute` — `'implement'` or `'auto_block'`.
- `appendHeadingN: number | null` — `null` for fresh-write; `number` for append.

The function returns the full stub string for fresh cases, or just the appendable block for append cases. The caller is responsible for prepending the `# Code Review: <id>\n\n` header on fresh writes, and for assembling `${existing.replace(/\s*$/, '')}\n\n---\n\n${stub}` on appends — identical to the failing-task append in lines 186-188.

**Route A, fresh write** (`route === 'implement'`, `appendHeadingN === null`): produce the full file with `## Bundle Pre-Flight Rejection` section, sibling bullets, `## Verdict` with `- [x] **Changes requested**` checkbox. The `## Verdict` is authoritative here because `extractCheckedVerdict` will scan the whole file (no `## Round` heading) and return `changes_requested`, matching the `status.json` verdict written by `taskPhasePreflightRejected` (AC-7).

**Route A, append** (`route === 'implement'`, `appendHeadingN !== null`): produce only the append block: `## Bundle Pre-Flight Rejection (round <N>) — sibling task(s) failed` (does NOT start with `## Round`), description + sibling bullets. **No `## Verdict` checkbox** — per AC-4, the parser will keep reading the prior verdict from the real `## Round` / `## Final Verdict` above. This is the recovery affordance: clean-task can be re-advanced via `canon task phase code_review done <prior-verdict>` without a re-run.

**Route B, fresh write** (`route === 'auto_block'`, `appendHeadingN === null`): produce the full file with `## Bundle Pre-Flight Halt` section, sibling bullets, human-triage instructions. **No `## Verdict` and no checkbox** — per AC-11. A later `canon task phase code_review done <verdict>` recovery must not read a stale checkbox.

**Route B, append** (`route === 'auto_block'`, `appendHeadingN !== null`): produce only the append block: `## Bundle Pre-Flight Halt (round <N>) — sibling infrastructure unavailable`, description + sibling bullets + human triage. No `## Verdict` checkbox.

Sibling bullets format (backtick paths are fine here — prose context, not the Changes table):
```
- `<sibId>` — see `tasks/<sibId>/review.md`
```

---

### Step 2: Refactor the pre-flight rejection write loop in `runCodeReviewPhase`

File: `scripts/run-task/phases/code-review.ts` (lines ~154–213)

Replace the existing loop body. New structure:

```
if (preflightFailed.length > 0) {
    const route = determinePreflightRoute(preflightFailed);
    const failedIds = new Set(preflightFailed.map(f => f.taskId));
    warn('Validation pre-flight FAILED — rejecting handoff without Claude review:');
    for (const { taskId, classified } of preflightFailed) {
        for (const issue of classified) warn(`  [${taskId}:${issue.bucket}] ${issue.message}`);
    }

    // Write review.md for ALL bundle tasks.
    const siblingIds = preflightFailed.map(f => f.taskId);
    for (const t of tasks) {
        const reviewPath = path.join(taskDirFor(t.taskId), 'review.md');
        let existing = '';
        try { existing = fs.readFileSync(reviewPath, 'utf8'); } catch { /* missing */ }
        const hasPriorRealReview =
            existing.length > 0 && !isTemplateUnfilled(existing) && /^## Stage 1\b/m.test(existing);

        let reviewContent: string;
        if (failedIds.has(t.taskId)) {
            // Failing task: existing content — BLOCKED block with per-task findings.
            const classified = preflightFailed.find(f => f.taskId === t.taskId)!.classified;
            const blockedBlock = buildPreflightReviewBlock(classified, route);
            reviewContent = hasPriorRealReview
                ? `${existing.replace(/\s*$/, '')}\n\n---\n\n${blockedBlock}`
                : `# Code Review: ${t.taskId}\n\n${blockedBlock}`;
        } else {
            // Clean task: route-appropriate stub pointing at failing siblings.
            // appendHeadingN: current counter + 1 (read before taskPhasePreflightRejected bumps it).
            const currentPreflight = t.status.phases.code_review?.preflight_rejections_current_loop ?? 0;
            const appendHeadingN = hasPriorRealReview ? currentPreflight + 1 : null;
            const stub = buildCleanTaskReviewStub(t.taskId, siblingIds, route, appendHeadingN);
            reviewContent = hasPriorRealReview
                ? `${existing.replace(/\s*$/, '')}\n\n---\n\n${stub}`
                : stub;
        }
        fs.writeFileSync(reviewPath, reviewContent);
    }

    if (route === 'auto_block') {
        const reason =
            `Code review pre-flight found only blocked validation rows for task(s) ${preflightFailed.map(f => f.taskId).join(', ')}. ` +
            `Infrastructure was unavailable, and re-implementation cannot resolve it. ` +
            `Human triage required. To resume after infrastructure is restored: update the affected ` +
            `handoff.md Validation Outcomes rows, set phases.code_review.status = "pending" for all ` +
            `bundle tasks in status.json, and re-run the pipeline.`;
        warn(reason);
        autoBlockPhase(taskIds, 'code_review', worstTask.combined, reason);
        process.exit(2);
    }

    // Route A: apply taskPhasePreflightRejected to ALL N tasks (not just preflightFailed).
    for (const t of tasks) {
        taskPhasePreflightRejected(t.taskId, 'code_review');
    }
    return { agent: 'claude', sessionId: null, exitCode: 0 };
}
```

Key invariants preserved:
- `review.md` writes happen BEFORE status updates (same as existing code).
- Route B: `autoBlockPhase` + `process.exit(2)` still fires; `taskPhasePreflightRejected` is NOT called.
- Route A: `taskPhasePreflightRejected` now covers all `tasks`, not just `preflightFailed`.
- The `buildPreflightReviewBlock` / `buildCleanTaskReviewStub` split: failing tasks use the former; clean tasks use the latter.
- The `## Stage 1` append detection and content pattern is identical for both failing and clean tasks (reuses the same `hasPriorRealReview` check per task).

---

### Step 3: Extend `taskPhasePreflightRejected` docstring

File: `src/task/index.ts` (function at line ~477)

Add to the existing docstring:

> **Bundle mode**: in a bundle pre-flight rejection (Route A), this is called for ALL bundle tasks including clean siblings whose own handoff passed. The clean task's `review.md` contains a bundle-rejection stub (not per-task validation findings). The counter increment for a clean task accurately reflects that the bundle had a code-review attempt that was blocked by a sibling's handoff.

---

### Step 4: Add tests in `tests/run-task-validation.test.ts`

Extend the existing file (which already imports `buildPreflightReviewBlock`, `determinePreflightRoute`, and `extractCheckedVerdict` from code-review.ts and validation.ts). Add new import for `buildCleanTaskReviewStub` from `../scripts/run-task/phases/code-review.js`.

Add a `withTempTasks` helper inline (same pattern as `tests/run-task-counter-schema.test.ts:51-66` — sets `CANON_TASKS_DIR_OVERRIDE` to a tmpdir, creates `tasks/` subdirectory, restores env after). Add a `makeCodeReviewStatus` factory that produces a minimal valid `StatusJson` shape (similar to `makeStatus` in counter-schema.test.ts) with `phases.code_review.status = 'pending'`.

**Test 1** — Route A, 2-task bundle, one fails fixable → both get `taskPhasePreflightRejected`:
- Write tasks `task-a` (failing, format blocker) and `task-b` (clean, status pending).
- Call `buildCleanTaskReviewStub('task-b', ['task-a'], 'implement', null)` and write the result to `task-b/review.md`.
- Call `taskPhasePreflightRejected('task-a', 'code_review')` and `taskPhasePreflightRejected('task-b', 'code_review')`.
- Assert: both have `phases.code_review.status === 'done'` and `verdict === 'changes_requested'`.
- Assert: `task-b/review.md` does NOT contain `## Stage 1`.
- Assert: `task-b/review.md` contains `## Bundle Pre-Flight Rejection`.
- Assert: `task-b/review.md` contains `- [x] **Changes requested**`.
- Assert: `task-b/review.md` contains `` `task-a` ``.
- Assert: `extractCheckedVerdict(review_b_content) === 'changes_requested'`.

**Test 2** — Route A, 3-task bundle, one fails → all 3 get pre-flight rejection:
- Write tasks `task-a` (failing), `task-b`, `task-c` (clean).
- Build stubs for task-b and task-c pointing at task-a.
- Apply `taskPhasePreflightRejected` to all three.
- Assert: all three have `changes_requested` verdict in status.json.
- Assert: both clean tasks' review.md list `` `task-a` `` and are missing `## Stage 1`.

**Test 3** — Route A, clean task has prior real `review.md` → stub appended, not overwritten:
- Pre-write `task-b/review.md` with content containing `## Stage 1\n\nsome AC findings\n`.
- Call `buildCleanTaskReviewStub('task-b', ['task-a'], 'implement', 1)`.
- Assemble: `${prior.replace(/\s*$/, '')}\n\n---\n\n${stub}`.
- Assert: result starts with the prior content (`## Stage 1` preserved).
- Assert: result contains `## Bundle Pre-Flight Rejection (round 1) — sibling task(s) failed`.
- Assert: appended block does NOT contain `## Verdict`.
- Assert: `extractCheckedVerdict(result) === null` — the fixture has `## Stage 1` but no `## Final Verdict` checkbox, so whole-file scope finds nothing.

**Test 4** — Route A, clean task has prior approved Round-1 (artifact↔status divergence pin per AC-14):
- Pre-write `task-b/review.md` with:
  ```markdown
  # Code Review: task-b

  ## Stage 1
  ...some AC table...

  ## Final Verdict

  - [x] **Approved**
  ```
- Call `buildCleanTaskReviewStub('task-b', ['task-a'], 'implement', 1)` and assemble the appended result.
- Assert (a): prior `## Stage 1` and `## Final Verdict` preserved.
- Assert (b): `## Bundle Pre-Flight Rejection (round 1) — sibling task(s) failed` appended.
- Assert (c): appended block has NO `- [x] **Changes requested**` checkbox.
- Assert (d): `extractCheckedVerdict(assembled_content) === 'approved'` — prior verdict survives.
- Call `taskPhasePreflightRejected('task-b', 'code_review')`.
- Assert (e): `status.json` records `verdict === 'changes_requested'` (intentional divergence).

**Test 5** — Route B, 2-task bundle, one fails blocked-only → both auto-blocked, both have `review.md`:
- Build `buildCleanTaskReviewStub('task-b', ['task-a'], 'auto_block', null)`.
- Assert: stub has NO `## Verdict` section and NO `## Stage 1`.
- Assert: stub contains `## Bundle Pre-Flight Halt`.
- Assert: stub contains `Human triage required`.
- Assert: stub contains `` `task-a` ``.
- Call `autoBlockPhase(['task-a', 'task-b'], 'code_review', 0, reason)`.
- Assert: both have `phases.code_review.status === 'blocked'` and `auto_block_count === 1`.
- Assert: neither has `preflight_rejections_current_loop > 0`.

**Test 6** — Both tasks pass pre-flight → no clean stub (regression guard):
- Drive the logic with `preflightFailed = []`. Assert no review.md is written or modified.

**Test 7** — Single-task bundle, fixable failure → existing single-task behavior unchanged:
- One failing task. `tasks.length === 1`, `preflightFailed.length === 1`. All tasks are in `failedIds`. No `buildCleanTaskReviewStub` path. Assert same outcome as prior tests for single-task pre-flight.

**Test 8** — Single-task bundle, blocked-only failure → existing behavior unchanged:
- One task, Route B. Assert `auto_block_count` bumped, no `taskPhasePreflightRejected`.

---

### Step 5: Run validation

```bash
npm run lint
npm run type-check
npm test
npm run build
npm run docs-refs-check
npm run sync-templates:check
```

Confirm:
- All new tests pass.
- `pre-flight blocked-only route halts for human triage` (`tests/run-task-validation.test.ts`) still passes.
- `dist/scripts/run-task.js` and `dist/cli/index.js` regenerated (both listed in Affected Files).

---

## File map

| File | Change |
|---|---|
| `scripts/run-task/phases/code-review.ts` | Add `buildCleanTaskReviewStub`; refactor pre-flight write loop to cover all tasks; broaden `taskPhasePreflightRejected` to all tasks on Route A |
| `src/task/index.ts` | Extend `taskPhasePreflightRejected` docstring for bundle case |
| `tests/run-task-validation.test.ts` | Add 8 new tests per AC-14 |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` |
| `dist/cli/index.js` | Regenerated by `npm run build` |
