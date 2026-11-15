# Spec Review: ship-followup-capture

> Reviewer: Codex | Spec: `tasks/ship-followup-capture/spec.md`

## Shape Check

(no concerns)

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

(none)

### Missing Edge Cases

(none)

### Type Safety / Interface Gaps

(none)

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase

## Amendment Review
- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**
> Findings:
> - **AC-15 changes an existing blocked-session contract.** It says a salvaged `done.md` that passes the gate “still advances qa → done as before,” without preserving the explicit blocked-session exception. `runQaPhase` in `src/orchestrator/phases/qa.ts:57-63` leaves QA blocked after salvage, and `tests/run-task-safety-routing.test.ts:1559-1588` pins that behavior. Clarify that only a non-blocked QA phase advances after a passing gate, and retain/assert the blocked-session behavior in the salvage coverage.

## Amendment Review
- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**
> Findings:
> - **Shape Check — AC-15 lacks the required bug-fix checkpoint evidence.** The amendment adds a QA salvage bug fix, but `## Problem` still describes only the original follow-up loss; it does not state the confirmed salvage mechanism and evidence. The current path is deterministic: `runQaPhase` in `src/orchestrator/phases/qa.ts` writes salvaged stdout to `done.md` and calls `taskPhase(..., 'qa', 'done')`, while `taskPhase` throws when the QA phase gate rejects the artifact. AC-15's test requirement checks the expected outcome but does not say to run the regression test red against this pre-fix path. Add the mechanism and confirming evidence to Problem, and specify the salvage regression test must fail before the fix and pass after it.

## Amendment Review
- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**
> Findings: none. The amendment now states the deterministic salvage → QA gate throw mechanism and its fixture reproduction evidence, requires the regression test to fail before the fix, and preserves the blocked-session behavior. AC-16 updates the QA fixtures affected by the new gate, and AC-17 documents the same requirement for manual phase completion.
