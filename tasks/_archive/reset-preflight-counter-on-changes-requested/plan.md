# Implementation Plan: reset-preflight-counter-on-changes-requested

> Written by: Claude | Implements: `tasks/reset-preflight-counter-on-changes-requested/spec.md`

## Approach

One-line fix in `updateReviewCounters` (mirror the `approved`-branch reset into the `changes_requested`/`needs_re_review` branch) + a doc-comment update + three test additions (two counter assertions in the existing counter schema test + one new `needs_re_review` sibling test + two new routing assertions in the prompts test) + a `dist/` rebuild. No new abstractions, no schema changes.

Mirror strategy chosen over hoist: hoisting the reset ahead of all verdict branches would also fire when `verdict === undefined` (e.g., `in_progress` transitions), which is unintended. Mirroring the single line from the `approved` branch into the `changes_requested`/`needs_re_review` branch is minimal and follows existing precedent exactly.

## Steps

### Step 1: Fix `updateReviewCounters` in `src/task/index.ts`

Files: `src/task/index.ts`

In `updateReviewCounters` (lines 367–386), add `entry.preflight_rejections_current_loop = 0;` inside the `changes_requested` / `needs_re_review` branch, after the four existing counter mutations. Mirror the comment and placement from the `approved` branch (line 383–384).

```typescript
if (verdict === 'changes_requested' || verdict === 'needs_re_review') {
    entry.iterations_current_loop += 1;
    entry.iterations_total += 1;
    entry.changes_requested_total += 1;
    entry.iterations = entry.iterations_current_loop;
    // A real review verdict (even non-approving) ends the current pre-flight
    // streak — the handoff cleared the gate and an actual review ran.
    entry.preflight_rejections_current_loop = 0;
} else if (verdict === 'approved' || verdict === 'approved_with_nits') {
    // ... existing approved branch unchanged ...
```

`spec_review` side effect: `updateReviewCounters` also runs for `spec_review` verdicts. Resetting `preflight_rejections_current_loop` there is the same harmless no-op as in the existing `approved` branch — spec review has no pre-flight gate, so the field is always 0. No special-casing on phase is needed.

### Step 2: Update doc comment in `scripts/run-task/types.ts`

Files: `scripts/run-task/types.ts`

In the JSDoc block for `PhaseEntry.preflight_rejections_current_loop` (lines 37–48), replace the clause:

> Reset to 0 when a real reviewer round returns approved / approved_with_nits.

With:

> Reset to 0 when any real review verdict ends the pre-flight streak (approved, approved_with_nits, changes_requested, or needs_re_review).

Comment-only change in a type-only file; no `dist/` impact.

### Step 3: Extend the existing counter test (AC-1 and AC-4)

Files: `tests/run-task-counter-schema.test.ts`

In the test `'taskPhasePreflightRejected followed by a real changes_requested round counts only the real round'` (currently ending after the three existing assertions), add two assertions immediately after `assert.equal(phase?.changes_requested_total, 2)`:

```typescript
// Pre-flight counter must be cleared by the real review round (AC-1):
assert.equal(phase?.preflight_rejections_current_loop, 0);
// Preflight total preserved — the rejection is still counted (AC-4):
assert.equal(phase?.preflight_rejections_total, 1);
```

No other changes to this test.

### Step 4: Add sibling test for `needs_re_review` (AC-2)

Files: `tests/run-task-counter-schema.test.ts`

Immediately after the test extended in Step 3, add:

```typescript
void test('taskPhasePreflightRejected followed by a real needs_re_review round resets preflight counter', () => {
    withTempTasks(root => {
        const taskId = 'preflight-then-needs-re-review';
        const base = makeStatus(taskId);
        base.phases.spec_review = { status: 'done', agent: 'codex', verdict: 'approved', iterations: 0 };
        writeTask(root, taskId, base);

        taskPhasePreflightRejected(taskId, 'code_review');
        withSkippedPhaseGate(() => taskPhase(taskId, 'code_review', 'done', 'needs_re_review'));

        const updated = readTaskStatus(root, taskId);
        const phase = updated.phases.code_review;
        // Real review round clears the pre-flight streak (AC-2):
        assert.equal(phase?.preflight_rejections_current_loop, 0);
        // Monotonic totals preserved:
        assert.equal(phase?.preflight_rejections_total, 1);
        assert.equal(phase?.iterations_current_loop, 1);
        assert.equal(phase?.changes_requested_total, 2);
    });
});
```

Pattern: identical structure to the `changes_requested` test, substituting `needs_re_review` as the verdict. Uses the same `base.phases.spec_review` override pattern from the existing test so `taskPhase` isn't blocked by prior-phase checks.

### Step 5: Add `promptImplementRevisions` routing tests (AC-6)

Files: `tests/run-task-prompts.test.ts`

After the existing `'promptImplementRevisions'` golden test (around line 332), add two assertion-style tests (not golden):

```typescript
void test('promptImplementRevisions selects review-findings branch when preflight counter is 0 and iterations >= 1', () => {
    const reviewFindingsTask = makeTask({
        iterations: 1,
        iterations_current_loop: 1,
        iterations_total: 1,
        status: makeStatus({
            phases: {
                ...makeStatus().phases,
                code_review: phase('claude', { preflight_rejections_current_loop: 0 }),
            },
        }),
    });
    const output = normalize(promptImplementRevisions(makeState(reviewFindingsTask), [], 'main'));
    assert.match(output, /addressing code review round \d+/);
    assert.doesNotMatch(output, /addressing pre-flight handoff rejection/);
});

void test('promptImplementRevisions selects pre-flight branch when preflight counter is >= 1', () => {
    const preflightTask = makeTask({
        iterations: 0,
        iterations_current_loop: 0,
        iterations_total: 0,
        status: makeStatus({
            phases: {
                ...makeStatus().phases,
                code_review: phase('claude', { preflight_rejections_current_loop: 1 }),
            },
        }),
    });
    const output = normalize(promptImplementRevisions(makeState(preflightTask), [], 'main'));
    assert.match(output, /addressing pre-flight handoff rejection/);
    assert.doesNotMatch(output, /addressing code review round/);
});
```

Discriminating strings are the `iterBanner` template literals from `prompts/index.ts` lines 288–290 — stable and directly tied to the routing branch. `makeStatus()`, `makeTask()`, `makeState()`, `phase()`, and `normalize()` are all already defined in this file; use them as-is.

### Step 6: Rebuild `dist/`

```bash
npm run build
```

Regenerates `dist/cli/index.js` and `dist/scripts/run-task.js` from the changed `src/task/index.ts`. Commit the delta alongside the source change. Both paths are declared in `spec.md` Affected Files.

### Step 7: Run full validation

```bash
npm run lint
npm run type-check
npm test
npm run build && git diff --exit-code -- dist/
```

All four must pass before marking `implement` done. The `dist/` diff check is the CI gate; the dist delta must be committed before the `--pr` base-drift check runs.

## Testing Plan

- **Unit (counter schema)**: Steps 3–4 — extend existing `changes_requested` test + new `needs_re_review` sibling. Covers AC-1, AC-2, AC-4. AC-3 and AC-5 are the existing passing tests (`approved` reset and pure pre-flight streak) — they must continue to pass unchanged.
- **Unit (prompts routing)**: Step 5 — two new assertion tests for `promptImplementRevisions` branch selection. Covers AC-6.
- **Build gate**: Step 6 — `dist/` delta committed and verified clean. Covers the `dist/` drift known risk.

## Rollback Plan

Revert the single line added in `src/task/index.ts` and rebuild `dist/`. No data migration needed — `preflight_rejections_current_loop` is a transient per-loop counter and any in-flight tasks can be manually patched per the spec's Non-Goals note.
