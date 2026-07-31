# Spec Review: preroute-review-loop-autoblock

> Reviewer: Codex | Spec: `tasks/preroute-review-loop-autoblock/spec.md`

## Shape Check

No concerns. The spec confirms the deterministic ordering defect from the current control flow, moves the cap checkpoint to the revision-phase entry while preserving `routeBackTo()` as the continuation mechanism, and includes red-first coverage that prevents the capped revision from starting.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed checkpoint, evaluator, and reset-helper patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

- **Non-blocking nit — isolate the resume-order clause before applying AC-10's phase-name assertion.** AC-10 proposes matching the persisted reason with `/\bspec\b/`, but the current reason already contains standalone `spec` tokens outside the future resume-order clause: its opening is `Spec review hit`, it later says `another spec revision`, and it includes `reset-spec-review`. Therefore the revision-entry assertion can pass even if the clause omits `spec` or incorrectly names `spec_review`. The intended mapping is otherwise clear and implementable. In the plan, give the clause a stable prefix and assert the canonical phase immediately after that prefix, extract and test that clause, or expose the derived resume phase as structured evaluator output while keeping prose assertions narrow.

### Missing Edge Cases

None.

### Type Safety / Interface Gaps

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase
