# Spec Review: reset-preflight-counter-on-changes-requested

> Reviewer: Codex | Spec: `tasks/reset-preflight-counter-on-changes-requested/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns.

Grounding: current `src/task/index.ts` leaves `preflight_rejections_current_loop` untouched in the `changes_requested` / `needs_re_review` branch, while `scripts/run-task/prompts/index.ts` gives any non-zero code-review pre-flight counter priority over review-findings routing. A targeted local repro of `taskPhasePreflightRejected(id, 'code_review')` followed by `taskPhase(id, 'code_review', 'done', 'changes_requested')` left `preflight_rejections_current_loop: 1` with `iterations_current_loop: 1`, matching the spec's failure mechanism.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

None.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- Non-blocking nit: add `scripts/run-task/types.ts` to Affected Files or call it out in the plan. Its `PhaseEntry.preflight_rejections_current_loop` comment currently says the field is reset only when a real reviewer round returns `approved` / `approved_with_nits`; after this task, that type contract should say it resets when any real review verdict ends the pre-flight streak. The implementation can still ship without a behavior bug, but leaving the comment stale would contradict the new counter semantics.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
