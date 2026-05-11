# Spec: counter-schema-migration — Status counter schema migration

> Written by: Claude | Review by: Codex (full tier — L non-delicate)
> Status: draft

## Problem

`scripts/task.sh:341-367` resets `phases.<phase>.iterations` to 0 on `approved`/`approved_with_nits` verdicts. The field is overloaded: it models the *current loop* (for loop-cap detection — "hit X iterations in a row → auto-block") AND is the only durable record of how many iterations the phase has run total. Resetting on approval destroys the cumulative signal.

**Concrete bugs this has caused (verified, 2026-05-10/11):**

1. **PR #37 P2 (deferred — runtime_validation cumulative-section shadowing).** `runtime-validation.ts:51` checks `iterations === 0` to decide whether to write a new `## Runtime Validation Outcomes` h2 baseline or append a `### Re-run runtime validation` h3. After an approved runtime pass followed by a code-review reroute, `iterations` is back to 0, so the next pass writes a SECOND h2 baseline. `computeLatestRuntimeResults()` reads only the first baseline section — failures introduced post-approval are silently shadowed.
2. **Stale spec_review iteration counts on shipped tasks.** James's TokenAnxiety ui-001 has an escalation record citing 3 consecutive spec_review `changes_requested` rounds, but final `spec_review.iterations` is 0. Same for `code_review` on tasks with iteration history (e.g. runtime-validation-phase actually ran 5 spec_review rounds; status.json says 0). Dogfood reports lose the signal James hand-extracted from escalation records.
3. **Recovery guidance is misleading.** Canon's own auto-block message tells operators to "set `phases.<phase>.iterations = 0`" — which destroys the iteration signal in exchange for unblocking. The right recovery is raising `MAX_REVIEW_LOOPS` (per memory `feedback_never_reset_iteration_counters`). The schema doesn't support a distinction between "reset current loop" and "preserve cumulative."

**Adjacent observability gaps**:
- No count of changes_requested verdicts across the task's lifetime (currently only the per-loop count exists).
- No count of how many times this phase has auto-blocked.

## Decision

Augment each iterative phase's `status.json` block with four new fields and migrate every consumer to use the right field. The legacy `iterations` field stays as an alias for `iterations_current_loop` during one release of deprecation window — adopters keep working through the transition.

**New phase fields** (apply to phases with iteration semantics: `spec_review`, `code_review`, `runtime_validation`):

| Field | Semantics | Reset behavior |
|---|---|---|
| `iterations_current_loop` | Replaces semantic meaning of today's `iterations`. Counts iterations in the current loop only. | Resets to 0 on `approved`/`approved_with_nits` |
| `iterations_total` | Monotonic count of how many times this phase has run, across all loops and reroutes. | Never resets |
| `changes_requested_total` | Count of `changes_requested` (or `needs_re_review`) verdicts across the task's lifetime. | Never resets |
| `auto_block_count` | Count of auto-blocks for this phase across the task's lifetime. | Never resets |

**Back-compat alias**: `iterations` remains a valid field on the phase block, and `task.sh phase` writes it alongside `iterations_current_loop` (same value). Existing status.json files without the new fields read as `iterations_current_loop = iterations`, `iterations_total = iterations` (so a task mid-flight gets the lower bound; future iterations grow both correctly), and the other new fields default to 0.

**Deferred field**: `verdict_source` was proposed (agent / human / auto_fast_tier) but dropped from this task's scope — see [BACKLOG](../docs/BACKLOG.md) §"`verdict_source` field on phase blocks". Justification: signal is mostly inferable from existing data (git commits, session IDs, escalations) and `canon dogfood-report` doesn't exist yet to consume it. Adding it is cheap when there's a concrete use case.

**Consumer migration (option B from grill discussion — full migration, not minimal)**:

| Call site (file:line) | Current | Migrate to |
|---|---|---|
| `scripts/run-task/phases/spec-review.ts:74` (loop-cap max) | `iterations ?? 0` | `iterations_current_loop ?? 0` |
| `scripts/run-task/phases/spec-review.ts:80,86` (auto-block message) | `iterations` reference | `iterations_current_loop` |
| `scripts/run-task/phases/code-review.ts:28` (loop-cap max) | `t.iterations` | `t.iterations_current_loop` |
| `scripts/run-task/phases/code-review.ts:32,37` (auto-block message) | `iterations` reference | `iterations_current_loop` |
| `scripts/run-task/phases/runtime-validation.ts:42-52` (setRuntimeValidationPhase iteration math) | Direct increment/reset of `iterations` | Write all 5 fields directly, mirroring task.sh logic (or call a shared helper) |
| `scripts/run-task/phases/runtime-validation.ts:51` (write-path decision: write h2 baseline vs h3 re-run) | `iterations === 0` | `iterations_total === 0` (**this is the PR #37 P2 fix**) |
| `scripts/run-task/phases/runtime-validation.ts:436,440,476` (auto-block message + prior iterations) | `iterations` | `iterations_current_loop` for messaging; `iterations_total` for "ever run before" decisions |
| `scripts/run-task/phases/implement.ts:14` (`shouldUseImplementRevision`) | `iterations > 0 \|\| runtimeIterations > 0` | `iterations_current_loop > 0 \|\| runtimeIterations_current_loop > 0` (loop-current semantics; reroute flag covers the approve-then-reroute case) |
| `scripts/run-task/phases/implement.ts:101` (autoBlockPhase iteration count) | `tasks[0].iterations + 1` | `tasks[0].iterations_current_loop + 1` |
| `scripts/run-task/phases/implement.ts:72` (revision iteration display) | `tasks[0].iterations` | `tasks[0].iterations_current_loop` |
| `scripts/run-task/phases/spec.ts:24,36` (iteration display) | `iterations` | `iterations_current_loop` |
| `scripts/run-task/phases/plan.ts:30` (iteration display) | `iterations` | `iterations_current_loop` |
| `scripts/run-task/phases/qa.ts:29` (iteration display) | `iterations` | `iterations_current_loop` |
| `scripts/run-task/main.ts:134` (`getIterations`) | `code_review?.iterations ?? 0` | `code_review?.iterations_current_loop ?? code_review?.iterations ?? 0` (back-compat read) |
| `scripts/run-task/main.ts:150` (`buildPipelineState.iterations`) | Same pattern | Same |
| `scripts/run-task/main.ts:151` (`buildPipelineState.runtimeIterations`) | `runtime_validation?.iterations ?? 0` | `runtime_validation?.iterations_current_loop ?? runtime_validation?.iterations ?? 0` |
| `scripts/run-task/context.ts:148` (`maxCodeReviewIter`) | `task.iterations` | `task.iterations_current_loop` |
| `scripts/run-task/state.ts:66-78` (`autoBlockPhase`) | Writes escalation entry | Same + increment `phases.<phase>.auto_block_count` |

`TaskContext.iterations` stays as an alias for `iterations_current_loop` (same value populated by `buildPipelineState`) so any consumer not in the table above keeps working at lower fidelity. New code uses the explicit `_current_loop` / `_total` fields.

## Non-Goals

- **Invariant-gate enforcement** ("phase status = done implies a real artifact with a real verdict") — that's task **1a-2**'s scope. This task only covers the counter schema + consumer migration. The invariant gate consumes some of the same primitives but is independently buildable on top.
- **Validation result state enum extension** (`human_pending`, `deferred_by_spec`, etc.) — task 1b's scope.
- **Canon snapshot stamping** — task 1c's scope.
- **Dogfood-report consumption** — a future S task once the counters are durable.
- **Migrate existing in-flight tasks** to the new schema fields explicitly. The back-compat read shim handles them lazily — first write under the new task.sh fills in missing fields. Tasks already at `complete` are not retroactively rewritten.
- **Replace `escalations` array with a counter** — both stay; `escalations` carries reason text (useful for triage), `auto_block_count` is the cheap-read counter.
- **Reshape the recovery message** in canon's own auto-block error text. That recommendation still says "set iterations = 0" — but post-this-migration, the right recovery is `iterations_current_loop = 0` (preserving total). The message update is a follow-on doc tweak, not part of this task's AC. Mention in *Docs Impact*.

## Acceptance Criteria

- [ ] AC-1: `tasks/_templates/status.json` updated so the three iterative phase blocks (`spec_review`, `code_review`, `runtime_validation`) declare the four new fields with default values: `iterations_current_loop: 0`, `iterations_total: 0`, `changes_requested_total: 0`, `auto_block_count: 0`. `iterations: 0` stays for back-compat (alias).

- [ ] AC-2: `scripts/run-task/types.ts` updated:
  - `PhaseEntry` (or whatever the per-phase block type is) gains the four fields, all optional for back-compat reads.
  - `TaskContext` gains `iterations_current_loop`, `iterations_total`, `runtimeIterations_current_loop`, `runtimeIterations_total` (`iterations` / `runtimeIterations` stay as aliases for the `_current_loop` variants).
  - `Verdict` type unchanged.

- [ ] AC-3: `scripts/task.sh` jq filter at lines ~341-367 updated to write all four fields on every verdict transition. Semantics:
  - On `changes_requested` or `needs_re_review`: `iterations_current_loop += 1`, `iterations_total += 1`, `changes_requested_total += 1`. `iterations` (alias) written = `iterations_current_loop`.
  - On `approved` or `approved_with_nits`: `iterations_current_loop = 0`, `iterations_total` stays, `changes_requested_total` stays. `iterations` (alias) written = 0.
  - For phases without iteration semantics, no counter writes (skip the math block).
  - For tasks whose status.json has only the legacy `iterations` field: when the jq filter runs, initialize `iterations_total = iterations`, `iterations_current_loop = iterations`, `changes_requested_total = 0`, `auto_block_count = 0` before applying the verdict logic.

- [ ] AC-4: `scripts/run-task/state.ts` `autoBlockPhase` increments `phases.<phase>.auto_block_count` (creating the field at 0 if absent) at the same time it appends to `escalations`. Backward-compatible: tasks without the field get it created.

- [ ] AC-5: Back-compat read shim in `scripts/run-task/state.ts` (or wherever status reads happen): when reading a phase block, `iterations_current_loop ?? iterations ?? 0`, `iterations_total ?? iterations ?? 0` for tasks created before this migration. New tasks created after this migration land already have the fields. Mid-flight tasks get the fields filled in on the next `task.sh phase` write or the next direct `writeStatus` call.

- [ ] AC-6: Every consumer call site listed in the **Consumer migration** table above is updated to use the right field. Specifically:
  - Loop-cap math (3 call sites in `phases/*.ts`) reads `iterations_current_loop`.
  - Auto-block message text (3 call sites) references `iterations_current_loop`.
  - Telemetry display (5 call sites in phases/spec.ts, plan.ts, qa.ts, implement.ts) shows `iterations_current_loop`.
  - Write-path decision in `runtime-validation.ts:51` switches to `iterations_total === 0` (the PR #37 P2 fix).
  - `runtime-validation.ts`'s `setRuntimeValidationPhase` direct iteration math is replaced with writes to all four fields, mirroring task.sh logic.
  - `buildPipelineState` populates both `iterations_current_loop` and `iterations_total` on `TaskContext` (and the runtime equivalents).

- [ ] AC-7: New tests (in `tests/run-task-counter-schema.test.ts` if cleaner, or extensions to existing test files — implementer decides):
  - jq filter on changes_requested: increments all three counters correctly.
  - jq filter on approved: resets `iterations_current_loop` to 0, preserves `iterations_total`, preserves `changes_requested_total`.
  - Back-compat: input with only legacy `iterations: 3` after the filter has `iterations_total = 3`, `iterations_current_loop = 3` (before verdict applied), `changes_requested_total = 0`.
  - `autoBlockPhase` increments `auto_block_count` and appends to `escalations`.
  - `runtime-validation.ts` write-path: simulate "approved then reroute" and assert the second runtime pass writes a `### Re-run runtime validation` h3 (not a second `## Runtime Validation Outcomes` h2 baseline). This is the PR #37 P2 regression test.

- [ ] AC-8: Existing test suite passes unchanged. Specifically `tests/run-task-runtime-validation.test.ts`, `tests/run-task-validation.test.ts`, `tests/run-task-extract-verdict.test.ts`, `tests/run-task-prompts.test.ts` — all 118 currently-passing tests still pass.

## Design

### Affected Files

| File | Change |
|---|---|
| `tasks/_templates/status.json` | Add four new fields on `spec_review`, `code_review`, `runtime_validation` phase blocks. Keep `iterations` field. |
| `scripts/task.sh` | Rewrite jq filter at ~341-367 to write all 4 fields per verdict transition; handle back-compat for tasks with only legacy `iterations`. |
| `scripts/run-task/types.ts` | Add new optional fields to phase entry type; add `iterations_current_loop` / `iterations_total` (and runtime equivalents) to `TaskContext`. |
| `scripts/run-task/state.ts` | Update `autoBlockPhase` to increment `auto_block_count`; add back-compat read helpers if needed. |
| `scripts/run-task/main.ts` | `getIterations` + `buildPipelineState` use new fields with back-compat fallback. |
| `scripts/run-task/context.ts` | Update `maxCodeReviewIter` at line 148 to use new field. |
| `scripts/run-task/phases/spec-review.ts` | Migrate loop-cap math + auto-block message + escalations append at line 23-24. |
| `scripts/run-task/phases/code-review.ts` | Migrate loop-cap math, auto-block message. |
| `scripts/run-task/phases/runtime-validation.ts` | Migrate `setRuntimeValidationPhase` to write all 4 fields. Change write-path decision at line 51 to use `iterations_total === 0` (fixes PR #37 P2). Migrate auto-block message + cumulative section detection. |
| `scripts/run-task/phases/implement.ts` | Migrate `shouldUseImplementRevision`; migrate `autoBlockPhase` count site. |
| `scripts/run-task/phases/spec.ts`, `plan.ts`, `qa.ts` | Telemetry display: use `iterations_current_loop`. |
| `docs/pipeline-orchestrator.md` | Document the new counter fields under a new subsection (or expand the existing "Phase Routing + Auto-Block" section). |
| `docs/decisions.md` | Add a brief entry on the counter migration (the why — preserving signal for dogfood-report) and the augment-then-deprecate pattern. |
| `tests/run-task-counter-schema.test.ts` *(new, or extensions to existing files)* | Tests per AC-10. |
| `tests/run-task-validation.test.ts`, `tests/run-task-runtime-validation.test.ts` | Update existing tests if they reference `iterations` directly in assertions on status.json; otherwise unchanged. Add PR #37 P2 regression to runtime test. |

### Interaction Dependencies

- **PR #37 P2 fix** (runtime_validation cumulative-section shadowing) — closed by AC-7's `iterations_total === 0` change.
- **1a-2 invariant-gate framework** consumes `verdict_source` (to decide whether a non-template artifact was authored by an agent or a human). 1a-1 must land first.
- **1b validation result enum extension** uses `auto_block_count` and `iterations_total` for its enforcement gate.
- **1c canon snapshot stamping** is independent of this work.
- **`canon dogfood-report` future task** is the primary downstream consumer of all five new fields.

### Data Model Changes

- Phase entry shape gains 5 optional fields (back-compat: optional). New fields are populated by writes; reads handle missing fields gracefully.
- `TaskContext` shape gains 4 fields. `iterations` and `runtimeIterations` stay as aliases.
- No breaking changes for adopters who don't read the new fields directly.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (118 existing + new tests per AC-10)

Build, E2E, Migration runner: N/A (no compile step; no UI; schema migration is back-compatible — no data migration runner needed).

## Docs Impact

- `docs/pipeline-orchestrator.md` — counter schema docs.
- `docs/decisions.md` — counter migration rationale + augment-then-deprecate pattern.
- `docs/lessons-learned.md` — likely an entry distilled from this work (Codex/Claude QA emits one if appropriate).

## Known Risks

- **Direct status.json writes outside `task.sh`** (e.g., `runtime-validation.ts`'s `setRuntimeValidationPhase` at line 36-55) must mirror the jq logic precisely or the two write paths diverge. Mitigation: keep the increment/reset logic in BOTH places identical (with test coverage on each path), or factor a shared TS helper that `setRuntimeValidationPhase` uses while `task.sh` keeps its jq filter. Implementer decides — both are acceptable.
- **Test files that assert specific `iterations` values** in status.json fixtures may need updates. The intent of `iterations` as alias for `iterations_current_loop` should keep them green, but any test that asserts the ABSENCE of new fields needs adjustment.
- **Forgotten consumer**: the migration table is best-effort from a grep audit. If a consumer is missed, it keeps reading the alias and works at lower fidelity. Future code review or test failure surfaces it.
- **task.sh jq complexity creep**: the existing filter is already gnarly; adding 4 fields × back-compat × verdict-conditional logic could push it past readability. Implementer may extract the verdict-counter math into a jq helper function or, if it becomes unmanageable, move the increment logic to a separate Node helper called from task.sh. Decision deferred to implement.
- **PR #37 P2 regression-test concrete repro**: AC-7's "approved-then-rerouted runtime pass writes h3 not h2" test needs a deterministic harness. Likely: stub `writeStatus`/`readStatus` in test, call `setRuntimeValidationPhase` twice (approved, then changes_requested), inspect the handoff write path. Implementer designs the test fixture.

## Human Test Plan

Product owner: developer using canon-ai's pipeline.

1. After pipeline completes, inspect any existing task's `tasks/<id>/status.json` (e.g. `tasks/_archive/runtime-validation-phase/status.json`). It should still have a valid status.json — back-compat shim preserves old shape.
2. Run a small task through the pipeline (could be a no-op spec task). Watch `tasks/<task-id>/status.json` evolve. After spec_review completes: check that `phases.spec_review` has `iterations_current_loop`, `iterations_total`, `changes_requested_total`, `auto_block_count` fields.
3. Force an iteration: trigger code_review `changes_requested` on a test task. After Codex addresses + Claude re-reviews + verdict goes to `approved`: check `phases.code_review`. `iterations_current_loop` is 0, but `iterations_total` is 2 (round 1 + round 2), and `changes_requested_total` is 1.
4. Run `MAX_REVIEW_LOOPS=2 npx tsx scripts/run-task.ts <id> --step` on a task likely to need >2 iterations. After auto-block: check `phases.<phase>.auto_block_count` is 1 and `escalations` has the entry. After raising MAX_REVIEW_LOOPS and approving: counter stays at 1.
5. The PR #37 P2 case: simulate an approved-then-rerouted runtime_validation. After the second runtime pass, check that the handoff has a `### Re-run runtime validation` h3 inside the latest `## Iteration N` section, NOT a second `## Runtime Validation Outcomes` h2 baseline.

---

## Spec Quality Checklist

- [x] Every AC states how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Known Risks covers the main failure modes (write-path divergence, fixture brittleness, jq complexity, PR #37 P2 test repro design)
- [x] Human Test Plan uses product-level steps (run a task, inspect status.json, force an iteration)
- [x] Validation Required has lint, type-check, unit tests
- [x] Non-Goals prevents scope creep (1a-2 invariant gates, 1b enum, 1c stamp, dogfood-report consumption all deferred)
