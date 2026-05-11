# Plan: counter-schema-migration

> Written by: Claude | Task size: L | Tier: full

## Overview

Add four new counter fields to the three iterative phase blocks in `status.json`, migrate all consumers to the correct field, fix the PR #37 P2 runtime_validation shadowing bug, and add tests. Steps are ordered with foundational schema/type changes first, then each consumer file group, then tests.

---

## Step 1 — Update `tasks/_templates/status.json` (AC-1)

Add all four new fields with default values to the three iterative phase blocks. Keep `iterations` for back-compat alias.

**Target**: `tasks/_templates/status.json`

Change each of `spec_review`, `code_review`, and `runtime_validation` phase blocks from:
```json
{ "status": "pending", "agent": "...", "verdict": "", "iterations": 0 }
```
to:
```json
{
  "status": "pending", "agent": "...", "verdict": "",
  "iterations": 0,
  "iterations_current_loop": 0,
  "iterations_total": 0,
  "changes_requested_total": 0,
  "auto_block_count": 0
}
```

---

## Step 2 — Update `scripts/run-task/types.ts` (AC-2)

**2a. Extend `PhaseEntry`** (lines 29-36) with the four new optional fields:

```typescript
export type PhaseEntry = {
    status: PhaseStatus;
    agent: string;
    verdict?: Verdict;
    iterations?: number;               // back-compat alias
    iterations_current_loop?: number;  // new
    iterations_total?: number;         // new
    changes_requested_total?: number;  // new
    auto_block_count?: number;         // new
    rerouted?: boolean;
    reroute_count?: number;
};
```

**2b. Extend `TaskContext`** (lines 80-88) with explicit new fields (keep existing aliases):

```typescript
export type TaskContext = {
    taskId: string;
    title: string;
    specReviewVerdict: Verdict;
    iterations: number;                     // alias for iterations_current_loop (code_review)
    iterations_current_loop: number;        // new
    iterations_total: number;               // new
    runtimeIterations: number;              // alias for runtimeIterations_current_loop
    runtimeIterations_current_loop: number; // new
    runtimeIterations_total: number;        // new
    rerouteCount: number;
    status: StatusJson;
};
```

---

## Step 3 — Update `scripts/task.sh` — `cmd_phase` jq filter (AC-3)

**Target**: `scripts/task.sh` lines ~360-365 (the iteration block inside the `jq` command in `cmd_phase`).

Replace the current iteration block:
```jq
(if ($phase == "code_review" or $phase == "spec_review" or $phase == "runtime_validation")
  then .phases[$phase].iterations = (.phases[$phase].iterations // 0) |
    if ($verdict == "changes_requested" or $verdict == "needs_re_review") then .phases[$phase].iterations += 1
    elif ($verdict == "approved" or $verdict == "approved_with_nits") then .phases[$phase].iterations = 0
    else . end
  else . end) |
```

With a block that:
1. Detects iterative phases only
2. Back-compat initializes missing new fields from legacy `iterations` value using `//=`
3. Writes all 4 counters per verdict semantics
4. Keeps `iterations` alias = `iterations_current_loop`

```jq
(if ($phase == "code_review" or $phase == "spec_review" or $phase == "runtime_validation")
  then
    .phases[$phase].iterations_current_loop //= (.phases[$phase].iterations // 0) |
    .phases[$phase].iterations_total        //= (.phases[$phase].iterations // 0) |
    .phases[$phase].changes_requested_total //= 0 |
    .phases[$phase].auto_block_count        //= 0 |
    if ($verdict == "changes_requested" or $verdict == "needs_re_review") then
      .phases[$phase].iterations_current_loop += 1 |
      .phases[$phase].iterations_total        += 1 |
      .phases[$phase].changes_requested_total += 1 |
      .phases[$phase].iterations = .phases[$phase].iterations_current_loop
    elif ($verdict == "approved" or $verdict == "approved_with_nits") then
      .phases[$phase].iterations_total        += 1 |
      .phases[$phase].iterations_current_loop  = 0 |
      .phases[$phase].iterations               = 0
    else . end
  else . end) |
```

Key semantics to verify:
- `//=` is jq's "assign if null/false" — seeds missing fields only, does not overwrite existing values
- `iterations_total += 1` on BOTH `approved` and `changes_requested`
- `iterations_current_loop` resets to 0 only on `approved`/`approved_with_nits`
- `changes_requested_total` increments only on `changes_requested`/`needs_re_review`

> **jq version note**: `//=` requires jq 1.6+. If the CI environment uses jq 1.5, expand each `//=` to an explicit `if (.phases[$phase].field == null) then .phases[$phase].field = default else . end` form. Check `jq --version` in the test harness first; document the choice in handoff.md.

---

## Step 4 — Update `scripts/task.sh` — `cmd_reset_spec_review` jq filter (AC-4b)

**Target**: `scripts/task.sh` lines ~414-420 (the jq iteration reset inside `cmd_reset_spec_review`).

The current filter:
```jq
.phases.spec_review.status = "pending" |
.phases.spec_review.iterations = 0 |
.phases.spec_review.verdict = "" |
```

Replace with (reset `iterations_current_loop` and alias; preserve cumulative counters):
```jq
.phases.spec_review.status              = "pending" |
.phases.spec_review.verdict             = "" |
.phases.spec_review.iterations          = 0 |
.phases.spec_review.iterations_current_loop = 0 |
```

Leave `iterations_total`, `changes_requested_total`, and `auto_block_count` untouched — they are not in the filter, so jq will not modify them. No `//=` initialization needed here: `reset-spec-review` is only called after a prior `task.sh phase` write that already seeded those fields via the AC-3 filter.

---

## Step 5 — Update `scripts/run-task/state.ts` (AC-4, AC-5)

**5a. `autoBlockPhase`** (lines 66-82): increment `auto_block_count` when setting phase to blocked. Add one line after `phaseEntry.status = 'blocked'`:

```typescript
if (phaseEntry) {
    phaseEntry.status = 'blocked';
    phaseEntry.auto_block_count = (phaseEntry.auto_block_count ?? 0) + 1; // new
}
```

**5b. `readStatus` default for runtime_validation** (lines 26-33): when backfilling a missing `runtime_validation` block, include the four new fields with defaults so consumers always see them:

```typescript
parsed.phases.runtime_validation = {
    status: 'done',
    agent: 'orchestrator',
    verdict: 'approved',
    iterations: 0,
    iterations_current_loop: 0,
    iterations_total: 0,
    changes_requested_total: 0,
    auto_block_count: 0,
};
```

**5c. Back-compat read pattern (AC-5)**: Applied inline at each consumer call site as `field_new ?? field_legacy ?? 0` — no central helper needed. The template now ships all fields at 0, so only mid-flight tasks created before this migration will ever hit the fallback.

---

## Step 6 — Update `scripts/run-task/main.ts` (AC-6)

**6a. `getIterations` helper** (line 133): back-compat read for `code_review` current-loop counter:

```typescript
function getIterations(status: StatusJson): number {
    const cr = status.phases.code_review;
    return cr?.iterations_current_loop ?? cr?.iterations ?? 0;
}
```

**6b. `buildPipelineState`** (lines 143-156): populate all new `TaskContext` fields alongside the existing aliases:

```typescript
const tasks: TaskContext[] = taskIds.map((taskId, i) => {
    const s = statuses[i];
    const cr = s.phases.code_review;
    const rv = s.phases.runtime_validation;
    const crCurrentLoop = cr?.iterations_current_loop ?? cr?.iterations ?? 0;
    const crTotal       = cr?.iterations_total        ?? cr?.iterations ?? 0;
    const rvCurrentLoop = rv?.iterations_current_loop ?? rv?.iterations ?? 0;
    const rvTotal       = rv?.iterations_total        ?? rv?.iterations ?? 0;
    return {
        taskId,
        title: getTitle(s),
        specReviewVerdict: getVerdict(s, 'spec_review'),
        iterations:                     crCurrentLoop, // alias — keeps existing consumers working
        iterations_current_loop:        crCurrentLoop,
        iterations_total:               crTotal,
        runtimeIterations:              rvCurrentLoop, // alias
        runtimeIterations_current_loop: rvCurrentLoop,
        runtimeIterations_total:        rvTotal,
        rerouteCount: s.phases.implement?.reroute_count ?? 0,
        status: s,
    };
});
```

---

## Step 7 — Update `scripts/run-task/context.ts` (AC-6)

**`buildImplementStateHeader`** (line 148): use explicit `iterations_current_loop` instead of alias:

```typescript
const maxCodeReviewIter = tasks.reduce((max, task) => Math.max(max, task.iterations_current_loop), 0);
const maxRuntimeIter    = tasks.reduce((max, task) => Math.max(max, task.runtimeIterations_current_loop), 0);
```

---

## Step 8 — Update `scripts/run-task/phases/spec-review.ts` (AC-4, AC-6)

**8a. `autoBlockSpecReview`** (lines 17-28): add `auto_block_count` increment (mirrors `autoBlockPhase` from Step 5a, but operates on a raw `phases.spec_review` entry directly since this bespoke helper does not call `autoBlockPhase`):

```typescript
function autoBlockSpecReview(taskIds: string[], iterationCount: number, reason: string): void {
    const today = new Date().toISOString().slice(0, 10);
    for (const taskId of taskIds) {
        const status = readStatus(taskId);
        const phaseEntry = status.phases.spec_review;
        if (phaseEntry) {
            phaseEntry.status = 'blocked';
            phaseEntry.auto_block_count = (phaseEntry.auto_block_count ?? 0) + 1; // new
        }
        status.escalations = status.escalations ?? [];
        status.escalations.push({ date: today, phase: 'spec_review', iteration_count: iterationCount, reason });
        status.updated = today;
        writeStatus(taskId, status);
    }
}
```

**8b. Loop-cap max** (line 73-76): back-compat read of `iterations_current_loop`:

```typescript
const maxSpecIter = tasks.reduce(
    (max, t) => Math.max(
        max,
        t.status.phases.spec_review?.iterations_current_loop
            ?? t.status.phases.spec_review?.iterations
            ?? 0
    ),
    0,
);
```

**8c. Auto-block message text** (lines 80-86): update recovery instruction to reference `iterations_current_loop`:

```diff
-`phases.spec_review.status = "pending" and ` +
-`phases.spec_review.iterations = 0 in status.json, then re-run the pipeline.`
+`phases.spec_review.status = "pending" and ` +
+`phases.spec_review.iterations_current_loop = 0 (and the legacy ` +
+`phases.spec_review.iterations = 0 alias) in status.json, then re-run the pipeline.`
```

---

## Step 9 — Update `scripts/run-task/phases/code-review.ts` (AC-6)

**9a. Loop-cap max** (line 28): use explicit `iterations_current_loop` (alias value is the same, but explicit per spec migration table):

```typescript
const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations_current_loop), 0);
```

**9b. Auto-block message text** (lines 32-37): update recovery instruction:

```diff
-`phases.code_review.status = "pending" and ` +
-`phases.code_review.iterations = 0 in status.json, then re-run the pipeline.`
+`phases.code_review.status = "pending" and ` +
+`phases.code_review.iterations_current_loop = 0 (and the legacy ` +
+`phases.code_review.iterations = 0 alias) in status.json, then re-run the pipeline.`
```

---

## Step 10 — Update `scripts/run-task/phases/runtime-validation.ts` (AC-6, PR #37 P2 fix)

This file has the most changes. Work in order:

**10a. `setRuntimeValidationPhase`** (lines 32-55): replace the single `iterations` increment/reset with writes to all 4 fields, mirroring `task.sh` AC-3 logic:

```typescript
function setRuntimeValidationPhase(
    taskId: string,
    status: 'pending' | 'in_progress' | 'done',
    verdict?: 'approved' | 'changes_requested',
): void {
    const taskStatus = readStatus(taskId);
    taskStatus.phases.runtime_validation = taskStatus.phases.runtime_validation ?? {
        status: 'pending',
        agent: 'orchestrator',
        verdict: '',
        iterations: 0,
        iterations_current_loop: 0,
        iterations_total: 0,
        changes_requested_total: 0,
        auto_block_count: 0,
    };
    const entry = taskStatus.phases.runtime_validation;
    // Back-compat seed: initialize new fields from legacy iterations if absent
    entry.iterations_current_loop ??= entry.iterations ?? 0;
    entry.iterations_total        ??= entry.iterations ?? 0;
    entry.changes_requested_total ??= 0;
    entry.auto_block_count        ??= 0;

    entry.status = status;
    entry.agent = 'orchestrator';
    if (verdict) {
        entry.verdict = verdict;
        if (verdict === 'changes_requested') {
            entry.iterations_current_loop  += 1;
            entry.iterations_total         += 1;
            entry.changes_requested_total  += 1;
            entry.iterations = entry.iterations_current_loop; // alias
        } else if (verdict === 'approved') {
            entry.iterations_total         += 1;
            entry.iterations_current_loop   = 0;
            entry.iterations                = 0; // alias
        }
    }
    taskStatus.updated = new Date().toISOString().slice(0, 10);
    writeStatus(taskId, taskStatus);
}
```

**10b. PR #37 P2 fix** (lines 475-484): split the single `priorIterations` read into two reads — one for the h2/h3 branch decision (uses `iterations_total`, never resets) and one for artifact directory naming (uses `iterations_current_loop`, resets each loop).

Current (buggy):
```typescript
const priorIterations = currentStatus.phases.runtime_validation?.iterations ?? 0;
const artifactIteration = priorIterations + 1;
...
writeRuntimeResults(task.taskId, priorIterations, results);
```

Replace with:
```typescript
const rv = currentStatus.phases.runtime_validation;
// Total never resets: drives h2-baseline vs h3-append decision in writeRuntimeResults.
// After an approved pass + reroute, total > 0, so the next pass correctly appends h3.
const priorTotal       = rv?.iterations_total        ?? rv?.iterations ?? 0;
// Current-loop resets on approval: artifact dir naming restarts at 1 each loop.
const priorCurrentLoop = rv?.iterations_current_loop ?? rv?.iterations ?? 0;
const artifactIteration = priorCurrentLoop + 1;
...
writeRuntimeResults(task.taskId, priorTotal, results);
```

Note: `priorTotal` and `priorCurrentLoop` are both read **before** the `setRuntimeValidationPhase(task.taskId, 'done', verdict)` call that increments them. The sequence (read → run checks → write results → write verdict) is unchanged; only which field feeds each use changes.

**10c. Loop-cap max** (line 432): use explicit `runtimeIterations_current_loop`:

```typescript
const maxIter = tasks.reduce((max, task) => Math.max(max, task.runtimeIterations_current_loop), 0);
```

**10d. Auto-block message** (lines 435-440): update recovery instruction:

```diff
-`and phases.runtime_validation.iterations = 0 in status.json, then re-run the pipeline.`
+`and phases.runtime_validation.iterations_current_loop = 0 (and the legacy ` +
+`phases.runtime_validation.iterations = 0 alias) in status.json, then re-run the pipeline.`
```

---

## Step 11 — Update `scripts/run-task/phases/implement.ts` (AC-6)

**11a. `shouldUseImplementRevision`** (line 14): update Pick type and predicate to use `_current_loop` fields explicitly:

```typescript
export function shouldUseImplementRevision(
    tasks: readonly Pick<TaskContext, 'iterations_current_loop' | 'runtimeIterations_current_loop'>[],
): boolean {
    return tasks.some(t => t.iterations_current_loop > 0 || t.runtimeIterations_current_loop > 0);
}
```

**11b. `autoBlockPhase` call** (line 101): use `iterations_current_loop`:

```typescript
autoBlockPhase(taskIds, 'implement', tasks[0].iterations_current_loop + 1,
    'Revision iteration produced no source-file diff ...');
```

**11c. Metric telemetry display** (line 72, inside the `runCodex` call options object):

```typescript
iteration: tasks[0].iterations_current_loop,
```

---

## Step 12 — Update `phases/spec.ts`, `phases/plan.ts`, `phases/qa.ts` (AC-6 telemetry display)

These files pass `tasks[0].status.phases.<phase>?.iterations` as the `iteration` metric field to agent run calls. The `spec`, `plan`, and `qa` phase blocks won't have `iterations_current_loop` in the status.json for existing tasks (they're non-review phases), so use the back-compat read pattern for forward safety.

**spec.ts lines 24, 36** (`tasks[0].status.phases.spec?.iterations`):
```typescript
iteration: tasks[0].status.phases.spec?.iterations_current_loop
    ?? tasks[0].status.phases.spec?.iterations,
```

**plan.ts line 30** (`tasks[0].status.phases.plan?.iterations`):
```typescript
iteration: tasks[0].status.phases.plan?.iterations_current_loop
    ?? tasks[0].status.phases.plan?.iterations,
```

**qa.ts line 29** (`tasks[0].status.phases.qa?.iterations`):
```typescript
iteration: tasks[0].status.phases.qa?.iterations_current_loop
    ?? tasks[0].status.phases.qa?.iterations,
```

---

## Step 13 — Write tests (AC-7, AC-8)

Create `tests/run-task-counter-schema.test.ts`. Model the test harness after `tests/run-task-runtime-validation.test.ts` (node:test, node:assert/strict, temp task dirs via `CANON_TASKS_DIR_OVERRIDE`, cleanup in `after()`). Use `execFileSync` or `spawnSync` to invoke `scripts/task.sh` for the jq filter tests.

**Test 1 — jq filter `changes_requested`**: Write `spec_review: { status: "done", agent: "codex", verdict: "", iterations: 0, iterations_current_loop: 0, iterations_total: 0, changes_requested_total: 0, auto_block_count: 0 }`. Run `task.sh phase <id> spec_review changes_requested changes_requested`. Read back status.json. Assert `iterations_current_loop = 1`, `iterations_total = 1`, `changes_requested_total = 1`, `auto_block_count = 0`, `iterations = 1` (alias).

**Test 2 — jq filter `approved`**: Start from `{ iterations_current_loop: 1, iterations_total: 1, changes_requested_total: 1, auto_block_count: 0, iterations: 1 }`. Run `task.sh phase <id> spec_review done approved`. Assert `iterations_current_loop = 0`, `iterations_total = 2`, `changes_requested_total = 1`, `auto_block_count = 0`, `iterations = 0`.

**Test 3 — jq filter sequence `changes_requested` → `approved`**: Run both in series. Assert final state: `iterations_current_loop = 0`, `iterations_total = 2`, `changes_requested_total = 1`.

**Test 4 — back-compat: legacy `iterations: 3` only**: Write `spec_review: { status: "done", agent: "codex", verdict: "", iterations: 3 }` (no new fields). Run `task.sh phase <id> spec_review changes_requested changes_requested`. Assert `iterations_total = 4` (seeded at 3, then +1), `iterations_current_loop = 4`, `changes_requested_total = 1`, `auto_block_count = 0`.

**Test 5 — `autoBlockPhase` increments `auto_block_count` + escalations**: Set up status.json with `code_review: { status: "done", auto_block_count: 0, ... }`. Call `autoBlockPhase(['<id>'], 'code_review', 2, 'test reason')`. Assert `phases.code_review.auto_block_count = 1`, `phases.code_review.status = "blocked"`, `escalations.length = 1`.

**Test 6 — `autoBlockSpecReview` increments `phases.spec_review.auto_block_count`**: Same shape but call `autoBlockSpecReview(['<id>'], 2, 'test reason')`. Assert `phases.spec_review.auto_block_count = 1`. This is a distinct test — `autoBlockSpecReview` is a separate code path from `autoBlockPhase`.

**Test 7 — `cmd_reset_spec_review` preserves cumulative counters**: Write `spec_review: { status: "done", verdict: "changes_requested", iterations: 2, iterations_current_loop: 2, iterations_total: 5, changes_requested_total: 3, auto_block_count: 1 }`. Run `task.sh reset-spec-review <id>`. Assert `iterations_current_loop = 0`, `iterations = 0`, `iterations_total = 5`, `changes_requested_total = 3`, `auto_block_count = 1`, `verdict = ""`, `status = "pending"`.

**Test 8 — PR #37 P2 regression**: Simulate "approved then rerouted" runtime pass via `runRuntimeValidationPhase` with stubbed checks. Structure:
- Create temp task dir with a handoff.md (minimal but valid — must have `## Implementation` section so `insertBaselineRuntimeSection` has an insertion point).
- First call: pass-all checks. `runRuntimeValidationPhase` writes h2 baseline, calls `setRuntimeValidationPhase(id, 'done', 'approved')` → `iterations_total = 1`.
- Simulate reroute: reset `runtime_validation.status = 'pending'` via `writeStatus`.
- Second call: fail-some checks. `priorTotal = 1` so `writeRuntimeResults` takes the `appendIterationRuntimeSection` path.
- Assert handoff.md contains `### Re-run runtime validation` and does NOT contain a second `## Runtime Validation Outcomes` heading.

Model the check stubs after the existing `run-task-runtime-validation.test.ts` pattern (the `failingCheck` / `passingCheck` fixtures).

**Fixture hygiene**: All temp files use non-gitignored names (`handoff.md`, `status.json`). Temp task dirs are cleaned up in `after()` hooks regardless of test outcome. Do not use `*.tmp` or other extensions matching `.gitignore` patterns (see lessons-learned "Porcelain-delta cleanup tests must use non-gitignored fixture paths").

---

## Step 14 — Update docs (Docs Impact from spec)

**14a. `docs/pipeline-orchestrator.md`**: Add a "Phase iteration counters" subsection (or expand the existing auto-block section). Document the four new fields: names, semantics, increment/reset rules, back-compat note. Reference `tasks/_templates/status.json` for default values rather than restating them inline.

**14b. `docs/decisions.md`**: Add a brief entry "Counter schema augment-then-deprecate (2026-05-11)" explaining: why `iterations` stays as a back-compat alias (in-flight tasks); what augment-then-deprecate means for adopters; pointer to `counter-schema-migration` for full rationale.

---

## Validation

Run in order:

```bash
npm run lint
npm run type-check
npm test
```

All 118 existing tests must still pass. New tests in `run-task-counter-schema.test.ts` add to that count. If existing fixtures assert specific `iterations` values in status.json, verify they still pass — the alias semantics keep them green, but any test that asserts the ABSENCE of new fields needs adjustment.
