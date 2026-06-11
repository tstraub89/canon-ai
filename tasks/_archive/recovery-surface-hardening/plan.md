# Implementation Plan: recovery-surface-hardening

> Written by: Claude | Implements: `tasks/recovery-surface-hardening/spec.md`

## Approach

Two independent guard additions on the v1.11.0 operator-recovery surface. They share no runtime coupling — implement them in sequence, each with its own tests.

**Gap 1 (verdict-exists guard on `accept`)**: Pre-mutation scan in `taskAccept` collects verdict-less tasks before any `status.json` write. Single-task and bundle are handled uniformly: refuse if any task has an empty review verdict, name them in the error, point at `--force`. The existing mutation loop is unchanged; the guard is a pure read pass that gates it.

**Gap 2 (amendment pre-flight scoping)**: The loop at `main.ts:~2159` calls `verifyRerouteAmendment` for every task in the bundle unconditionally. Scope it with a `continue` predicated on `isSpecGapReroute && currentVerdict !== 'spec_gap'`. Exempt siblings also need `reroute_exempt: true` written to their implement phase entry so the downstream `spec_review`/`plan` gates (`checkRerouteEvidence`) know not to require an `## Amendment Review` section. Clear the field on all tasks at every reroute entry (spec_gap or human_review) so the exemption doesn't persist across rounds.

**Nits from spec review** (incorporated into implementation steps):
- `needs_re_review` is a real non-advancing code_review verdict. The verdict-exists guard must only block on truly empty string — `needs_re_review`, `changes_requested`, and `spec_gap` all carry content and must pass through to the existing sanctioning logic as-is. Document this in test assertions.
- A mixed bundle with a `changes_requested` or `needs_re_review` sibling (not just `approved`) in a spec_gap reroute also qualifies as `isSpecGapReroute`. The `continue` exemption applies to any task whose verdict is not `spec_gap` — not only `approved`. Note this in test coverage.
- The spec mentions that a new status marker requires expanding Affected Files to include `scripts/run-task/types.ts`. This plan adopts the `reroute_exempt?: boolean` field on the implement phase entry in `types.ts`.

## Steps

### Step 1: Add `reroute_exempt?: boolean` to the implement phase type

File: `scripts/run-task/types.ts`

Near the existing `rerouted?: boolean` and `reroute_count?: number` fields (~line 52), add:

```typescript
/**
 * Set on non-spec_gap siblings in a spec_gap bundle reroute. Causes
 * `checkRerouteEvidence` to treat the task as first-pass (no Amendment
 * Review section required). Cleared on every subsequent reroute entry.
 */
reroute_exempt?: boolean;
```

This field is additive and default-absent — older tasks without it are unaffected.

### Step 2: Verdict-exists guard in `taskAccept` (`src/task/index.ts`)

Location: inside `taskAccept` (~line 705), after the worktree homogeneity/same-tree checks and before the `originalSnapshots` loop.

**What to add** — a pre-mutation scan for review phases only:

```typescript
// Verdict-exists guard: refuse to sanction a review that never ran.
// Must evaluate before any status.json write (the write loop starts below).
if (phaseArg === 'spec_review' || phaseArg === 'code_review') {
    const verdictlessTasks: string[] = [];
    for (const ctx of ctxByTask.values()) {
        const verdict = ctx.status.phases[phaseArg]?.verdict ?? '';
        if (!verdict) verdictlessTasks.push(ctx.id);
    }
    if (verdictlessTasks.length > 0) {
        const taskList = verdictlessTasks.join(', ');
        const msg =
            `Error: cannot sanction ${phaseArg} for [${taskList}] — no review verdict exists to sanction. ` +
            `Run the review first, or pass \`--force\` to override.`;
        if (!options.force) throw new Error(msg);
        for (const id of verdictlessTasks) {
            console.error(`Warning: --force bypass: ${id} has no ${phaseArg} verdict; sanctioning anyway.`);
        }
    }
}
```

Key details:
- Read `ctx.status.phases[phaseArg]?.verdict` directly (optional-chain read, no `ensurePhaseEntry`) — avoids creating a stub entry as a side effect.
- An empty-string verdict (`''`) is treated the same as absent — both mean "the review hasn't produced a verdict yet." A task with verdict `spec_gap`, `changes_requested`, or `needs_re_review` passes the guard and falls through to the existing mutation loop unchanged (AC-3).
- The error is thrown BEFORE `originalSnapshots` is built, so no mutation has started and no rollback is needed.
- In a bundle (AC-4), all verdict-less tasks are collected first, then a single error names them all. No partial mutation occurs.
- The `--force` path emits a per-task warning and continues (AC-2).

The `implement` phase path in `taskAccept` is separate (`phaseArg !== 'spec_review' && phaseArg !== 'code_review'`) — unchanged by this guard.

### Step 3: Scope amendment pre-flight to spec_gap tasks in `scripts/run-task/main.ts`

Location: the for-loop at ~2159–2171, inside `rerouteFromHumanReview`.

Add an early-continue at the top of the loop body:

```typescript
for (const taskId of taskIds) {
    const status = splitState.readStatus(taskId);
    // Spec_gap reroutes: only the gap task(s) need an Amendment heading.
    // Approved/non-gap siblings are exempt (their spec was never wrong).
    // Human_review reroutes: every task must amend — no early-continue.
    if (isSpecGapReroute && getVerdict(status, 'code_review') !== 'spec_gap') {
        continue;
    }
    const requiredRound = (status.phases.implement?.reroute_count ?? 0) + 1;
    const result = splitValidation.verifyRerouteAmendment(taskId, requiredRound);
    ...
}
```

`getVerdict` already exists in scope (imported/used elsewhere in `main.ts`). The check covers any non-spec_gap verdict (`approved`, `approved_with_nits`, `changes_requested`, `needs_re_review`) — all exempt. The human_review path (`!isSpecGapReroute`) is unaffected (AC-7).

### Step 4: Set/clear `reroute_exempt` in the phase-reset loop in `scripts/run-task/main.ts`

Location: in the `for (const taskId of taskIds)` phase-reset loop at ~2204, inside the `if (implement)` block, after the `reroute_count` increment.

```typescript
const implement = status.phases.implement;
if (implement) {
    // Capture current code_review verdict BEFORE the codeReview block clears it.
    const currentCodeReviewVerdict = getVerdict(status, 'code_review');
    implement.rerouted = true;
    implement.reroute_count = (implement.reroute_count ?? 0) + 1;
    clearPhaseOperatorAcceptance(implement);
    // Set or clear reroute_exempt based on this reroute's entry point.
    // Always reset to avoid leaking exemptions from a prior round.
    if (isSpecGapReroute) {
        implement.reroute_exempt = currentCodeReviewVerdict !== 'spec_gap';
    } else {
        implement.reroute_exempt = undefined; // human_review: no exemptions
    }
}
```

The code_review verdict is read from the freshly-read `status` object at the top of this loop iteration, before the `codeReview.verdict = ''` reset lower in the same loop body. Reading it here is safe.

Setting `reroute_exempt = undefined` serializes as absent in JSON (same as not having the field), which is the correct "cleared" representation.

**AC-8 correctness**: A non-gap task B exempted in round 1 gets `reroute_count: 1, reroute_exempt: true`. In a later reroute (round 2, B is now the gap task): the pre-flight reads `reroute_count: 1` before resetting, computes `requiredRound = 2`, and checks B's spec for `## Amendment Round 2` — B's spec has no amendment sections → pre-flight blocks, forcing the operator to add the heading. The `reroute_exempt` from round 1 is still set at pre-flight time but is irrelevant (the pre-flight reads spec.md directly, ignoring `reroute_exempt`). After passing, the phase-reset sets `reroute_exempt = undefined` (B is now a gap task, not exempt). Similarly for A in round 2: `requiredRound = 2`, A's spec has `## Amendment` (round 1) but not `## Amendment Round 2` → pre-flight blocks.

### Step 5: Honor `reroute_exempt` in `checkRerouteEvidence` (`scripts/run-task/validation.ts`)

Location: inside `checkRerouteEvidence`, after the `if (rerouted !== true) return { reroute: false };` line (~264).

```typescript
if (rerouted !== true) return { reroute: false }; // first-pass

// Non-gap sibling exempted from this reroute's amendment round:
// treat as first-pass so spec_review and plan don't demand Amendment Review.
const rerouteExempt = (impl as { reroute_exempt?: unknown }).reroute_exempt;
if (rerouteExempt === true) return { reroute: false };
```

The `impl` cast is already in scope at that point in the function. The `unknown` cast matches the existing pattern for `rerouted` and `reroute_count` reads in the same function — defer narrowing to the explicit boolean check.

Returning `{ reroute: false }` causes the caller (in `spec_review` and `plan` dispatch) to use the full-artifact first-pass path: no Amendment Review section required. The task proceeds normally through spec_review and plan against its original (unchanged) spec.

### Step 6: Update `docs/pipeline-orchestrator.md` — two sentences

1. In the task management table (the `accept` row, ~line 115): append to the `spec_review` and `code_review` sentence: "Refuses if the phase has no recorded verdict (use `--force` to override)."

2. In the reroute section (~line 406): change "Before rerouting, write the new requirements into `tasks/<id>/spec.md`..." to clarify that only gap tasks need an Amendment section: "Before rerouting, each task whose `code_review` verdict is `spec_gap` must have an Amendment section added to its `spec.md` in the active task directory. Approved or non-gap siblings in the same bundle do not need amendment."

### Step 7: Tests for AC-1, AC-2, AC-3, AC-4 in `tests/task-cli.test.ts`

**Setup helper** (local to new tests): a minimal task status with `code_review: { status: 'blocked', verdict: '', ... }`. Follow the existing `makeSpec` / `makeStatus` patterns in the test file.

**AC-1 — single task, code_review, no verdict**:
```
taskAccept(['the-task'], 'code_review', { reason: 'test' })
→ throws with message matching /no review verdict exists/ and /the-task/
→ status.json unchanged (verify by re-reading phases.code_review.verdict)
```

**AC-1 — single task, spec_review, no verdict** (spec requires direct assertion, not only via bundle):
```
taskAccept(['the-task'], 'spec_review', { reason: 'test' })
→ throws with message matching /no review verdict exists/ and /the-task/
→ status.json unchanged
```

**AC-2 — force flag bypasses guard**:
```
taskAccept(['the-task'], 'code_review', { reason: 'override', force: true })
→ succeeds
→ status.phases.code_review.verdict === 'sanctioned'
→ notes.md contains audit line
```

**AC-3 — real non-advancing verdicts still sanctioned** (assert `needs_re_review` explicitly, not only `spec_gap`/`changes_requested`):
Create a task with `code_review: { verdict: 'needs_re_review', status: 'blocked' }`. `taskAccept` with `--reason` → `verdict: 'sanctioned'`. This verifies the guard does not block on non-empty verdicts.

**AC-4 — bundle refuses before mutating any task**:
Setup: task-A has `code_review` verdict `''`; task-B has `code_review` verdict `changes_requested`.
```
taskAccept(['task-a', 'task-b'], 'code_review', { reason: 'test' })
→ throws naming task-a in message
→ task-B's status.json is ALSO unchanged (re-read both files to verify)
```

### Step 8: Tests for AC-5, AC-6, AC-8 in `tests/run-task-reroute-preflight.test.ts`

Follow the existing `withTempDir`, `initGitRepo`, `makeCodeReviewBlockedStatus`, `writeSpec`, `runReroute`, `readStatus` patterns used in the file.

**AC-5 — mixed bundle: amend only gap task, reroute succeeds**:
- task-A: `code_review blocked spec_gap`, spec has `## Amendment`
- task-B: `code_review blocked approved`, spec has NO `## Amendment`
- `runReroute(dir, ['task-a', 'task-b'], false)` → `result.status === 0`
- Assert: task-B's updated status has `implement.reroute_exempt === true`
- Assert: task-A's updated status has `implement.reroute_exempt` absent or falsy

**AC-6 — checkRerouteEvidence returns first-pass for exempt sibling** (unit test, no subprocess):
Inline call to `checkRerouteEvidence`:
```typescript
const bStatus: RerouteStatusView = {
    phases: { implement: { rerouted: true, reroute_count: 1, reroute_exempt: true } }
};
const result = checkRerouteEvidence('spec_review', '# Spec Review\n...(no Amendment Review)...', bStatus);
assert.equal(result.reroute, false); // first-pass: exempt
```
And contrast with gap task A (no `reroute_exempt`):
```typescript
const aStatus: RerouteStatusView = {
    phases: { implement: { rerouted: true, reroute_count: 1 } }
};
const aResult = checkRerouteEvidence('spec_review', '# Spec Review\n...(no Amendment Review)...', aStatus);
assert.equal(aResult.reroute, true);
assert.equal(aResult.ok, false); // requires Amendment Review
```

**AC-8 — second reroute requires non-colliding amendment headings for both A and B**:
This can be a `verifyRerouteAmendment` unit test (no subprocess needed):

For A (already has `## Amendment` from round 1, `reroute_count: 1` before round-2 pre-flight):
```typescript
const result = splitValidation.verifyRerouteAmendment('task-a', 2); // requiredRound = 2
// task-a's spec.md has `## Amendment` only — no `## Amendment Round 2`
assert.equal(result.amended, false);
assert.match(result.reason, /Amendment Round 2/);
```

For B (spec has no amendment headings, `reroute_count: 1` before round-2 pre-flight):
```typescript
const result = splitValidation.verifyRerouteAmendment('task-b', 2);
// task-b's spec.md has no amendment sections
assert.equal(result.amended, false);
assert.match(result.reason, /Amendment Round 2/);
```
Also assert that B's round-2 required heading (`## Amendment Round 2`) is not present in B's spec (i.e., `result.amended === false` proves the stale-round-1-from-A cannot accidentally satisfy B's requirement).

Use temporary spec files (write to tempdir, then call `verifyRerouteAmendment` with the path resolved). The function reads from disk via `taskDirFor` — use the `CANON_TASKS_DIR_OVERRIDE` env var pattern if available, or write via `writeSpec` helper and set up the task dir accordingly.

### Step 9: Build

Run `npm run build` to regenerate `dist/cli/index.js` and `dist/scripts/run-task.js`.

## Testing Plan

- **Unit**: Steps 7–8 add targeted node:test cases covering AC-1 through AC-8. No subprocess required for AC-6 and AC-8 (pure helper unit tests). AC-1/4 via direct `taskAccept` calls. AC-5 via the existing `runReroute` subprocess helper.
- **Regression**: Existing tests that cover AC-3 (`spec_gap`, `changes_requested` sanction) and AC-7 (human_review-entry reroute requires all amendments) must pass without modification. The mixed-bundle test at `run-task-reroute-preflight.test.ts:528` writes `## Amendment` for both tasks and must still pass (B having an amendment it doesn't need is not a failure).
- **Manual**: Human Test Plan steps 1–3 from `spec.md`.

## Rollback Plan

No data model changes for in-flight tasks (new `reroute_exempt` field is additive and default-absent). If rolled back, tasks with `reroute_exempt: true` in their status.json will just have an unrecognized field ignored by old code — no corruption. The verdict-exists guard is a pure safety addition: removing it restores silent-sanction behavior from 1.11.0.

## Reroute Plan

### Delta

The amendment (§Amendment in spec.md) adds AC-9/AC-10/AC-11. The shipped `reroute_exempt` machinery (Steps 1–8 above) already handles the *exemption* correctly — the gap is that the exemption is verdict-agnostic: every non-gap sibling is described as "prior code review approved" in the reroute prompts, regardless of whether its actual verdict was `approved` or `changes_requested`/`needs_re_review`. The delta is:

1. **Record prior verdict alongside `reroute_exempt` in `scripts/run-task/main.ts`** (~line 2231).

   When writing `reroute_exempt = true`, also write `reroute_exempt_prior_verdict = currentCodeReviewVerdict`. When deleting `reroute_exempt` (non-exempt case), also delete `reroute_exempt_prior_verdict`. The cast already in use (`implement as PhaseEntry & { reroute_exempt?: boolean }`) expands to include the new field — no `types.ts` change needed (consistent with how Codex handled `reroute_exempt` itself, keeping it locally narrowed).

   ```typescript
   const rerouteState = implement as PhaseEntry & {
       reroute_exempt?: boolean;
       reroute_exempt_prior_verdict?: string;
   };
   if (isSpecGapReroute && currentCodeReviewVerdict !== 'spec_gap') {
       rerouteState.reroute_exempt = true;
       rerouteState.reroute_exempt_prior_verdict = currentCodeReviewVerdict;
   } else {
       delete rerouteState.reroute_exempt;
       delete rerouteState.reroute_exempt_prior_verdict;
   }
   ```

2. **Update `isRerouteExempt` in `scripts/run-task/prompts/index.ts`** to return the prior verdict instead of a plain boolean, so callers can choose the right flavor.

   Replace the existing `isRerouteExempt(t): boolean` helper (~line 126) with one that returns the prior verdict string (or `undefined` if not exempt):

   ```typescript
   function getRerouteExemptInfo(t: TaskContext): { exempt: false } | { exempt: true; priorVerdict: string } {
       const impl = t.status.phases.implement as {
           reroute_exempt?: unknown;
           reroute_exempt_prior_verdict?: unknown;
       } | undefined;
       if (impl?.reroute_exempt !== true) return { exempt: false };
       const priorVerdict = typeof impl?.reroute_exempt_prior_verdict === 'string'
           ? impl.reroute_exempt_prior_verdict
           : 'approved'; // safe default: missing field → treat as approved (no prior verdict recorded)
       return { exempt: true, priorVerdict };
   }
   ```

   Update all three call sites that currently call `isRerouteExempt(t)` (`promptSpecReview`, `promptPlan`, `promptImplementReroute`) to call `getRerouteExemptInfo(t)` and branch on `info.priorVerdict`.

3. **Update the three exempt-task per-task line generators in `scripts/run-task/prompts/index.ts`** to emit a verdict-flavored line.

   The two flavors:
   - **Approved/approved_with_nits** (`priorVerdict === 'approved' || priorVerdict === 'approved_with_nits'`): keep the existing "prior code review approved; it rides the bundle" wording. No behavioral change for this path.
   - **Failing** (`changes_requested` or `needs_re_review`): emit a failing-sibling line that directs the agent at `tasks/<id>/review.md`, names the prior verdict explicitly, and does **not** use the word "approved."

   Concrete failing-sibling line text per prompt function:

   **`promptSpecReview` reroute path** (currently line ~146):
   ```
   `- \`${t.taskId}\`: "${t.title}" — EXEMPT from amendment (verdict was \`${info.priorVerdict}\`; spec was not amended). No Amendment section exists — review the spec as-is under first-pass rules. The prior review findings in tasks/${t.taskId}/review.md remain binding; do NOT describe this task as approved.`
   ```

   **`promptPlan` reroute path** (currently line ~197):
   ```
   `- \`${t.taskId}\`: EXEMPT from amendment (verdict was \`${info.priorVerdict}\`; spec unchanged). Do NOT append a Reroute Plan section for this task. The prior review findings remain binding and will be re-evaluated at code review.`
   ```

   **`promptImplementReroute`** (currently line ~371):
   ```
   `- \`${t.taskId}\`: "${t.title}" — EXEMPT from amendment (verdict was \`${info.priorVerdict}\`). There is no Amendment section in tasks/${t.taskId}/spec.md. Your prior review findings at tasks/${t.taskId}/review.md remain binding — read that file and address ALL findings from the most recent review round before submitting. Do NOT treat this task as approved.`
   ```

   The approved-flavor lines for these three sites are unchanged from the shipped text.

4. **Check reroute-prompt templates for approved-flavor assumptions** (`scripts/run-task/prompts/templates/implement-reroute.md`, `spec-review-reroute.md`, `plan-reroute.md`). If the template body frames exempt siblings with language like "approved siblings" in a way that is wrong for failing siblings, update the framing to be flavor-neutral. The per-task `taskLines` are interpolated verbatim, so the only risk is surrounding copy that assumes approval. If no such copy exists, no template change is needed — mark as checked in handoff.

5. **New tests in `tests/run-task-reroute-preflight.test.ts`** (AC-9/AC-10):

   **AC-9a — failing sibling `changes_requested`**:
   - task-A: `code_review` blocked `spec_gap`, spec has `## Amendment`
   - task-B: `code_review` blocked `changes_requested`, spec has NO `## Amendment`
   - `runReroute(dir, ['task-a', 'task-b'], false)` → `result.status === 0`
   - Assert: task-B's updated status has `implement.reroute_exempt === true` AND `implement.reroute_exempt_prior_verdict === 'changes_requested'`
   - Assert: task-A's updated status has `reroute_exempt` absent/falsy

   **AC-9b — failing sibling `needs_re_review`** (separate test case):
   - Same as AC-9a but task-B's verdict is `needs_re_review`
   - Assert: `reroute_exempt_prior_verdict === 'needs_re_review'`

   **AC-10 — `checkRerouteEvidence` still returns first-pass for failing-sibling exempt** (unit test):
   ```typescript
   const bStatus = {
       phases: { implement: { rerouted: true, reroute_count: 1, reroute_exempt: true, reroute_exempt_prior_verdict: 'changes_requested' } }
   };
   const result = checkRerouteEvidence('spec_review', '# Spec Review\n...(no Amendment Review)...', bStatus);
   assert.equal(result.reroute, false); // first-pass: reroute_exempt still drives gate behavior
   ```
   The gate reads only `reroute_exempt` (boolean check) — `reroute_exempt_prior_verdict` is ignored by it, so no gate change is needed and the test simply confirms the existing gate behavior is unchanged for failing-verdict-exempt tasks.

6. **New tests in `tests/run-task-prompts.test.ts`** (AC-9 prompt flavor, AC-11 regression):

   **Failing-sibling prompt flavor** (both verdicts, all three prompt functions):
   - Build a `PipelineState` where task-B has `implement.rerouted: true, reroute_exempt: true, reroute_exempt_prior_verdict: 'changes_requested'` (and a parallel case for `needs_re_review`)
   - `promptImplementReroute(state)` → assert the task-B line contains `review.md`, contains `changes_requested` (or `needs_re_review`), and does NOT contain the word "approved"
   - `promptSpecReview(state)` with reroute state → assert the task-B line does not say "approved"
   - `promptPlan(state)` with reroute state → assert the task-B line does not say "approved"

   **AC-11 — approved-sibling lines unchanged**:
   - Build state with `reroute_exempt_prior_verdict: 'approved'`
   - All three prompts → assert lines match the existing approved-flavor wording (or run against goldens if they exist)

   **Prior-verdict survival after reroute reset (AC-11)**:
   - Simulate a full reroute sequence: run `runReroute` for a bundle, then call `getRerouteExemptInfo` (or read status and render prompts) from post-reset state
   - Assert `reroute_exempt_prior_verdict` is present and has the correct value for the exempt sibling

7. **Golden fixture** (`tests/run-task-prompts.golden.json`): If any template file changes (step 4), regenerate the golden via `UPDATE_GOLDENS=1 npm test`. If no template changes, the goldens need no update — confirm by running the test suite clean.

8. **Build**: `npm run build` to regenerate `dist/cli/index.js` and `dist/scripts/run-task.js`.

### Prior plan steps that still apply

Steps 1–9 from the original plan shipped correctly (AC-1 through AC-8 are all met per the handoff). The reroute plan above is purely additive: it adds the verdict-flavor layer on top of the exempt marker without touching the guard logic (Steps 2–5 above), the test helpers already in place (Steps 7–8), or the docs (Step 6).
