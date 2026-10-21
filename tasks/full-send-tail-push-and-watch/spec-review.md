# Spec Review: full-send-tail-push-and-watch

> Reviewer: Codex | Spec: `tasks/full-send-tail-push-and-watch/spec.md`

## Shape Check

No concerns. The spec addresses both observed failures with separate behavior: the full-send tail can publish only commits matching the stated content rule, and watch reports a dead tail rather than a human-review checkpoint.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

None.

### Missing Edge Cases

- **Nit — AC-4 does not positively exercise telemetry-only scaffold commits.** Decision 2 allows the `chore: absorb pre-implement telemetry into scaffold for <ids>` subject when all changed paths are in `PIPELINE_TELEMETRY_FILES`, and `commitTaskArtifactsToBase` creates that commit when pre-implement telemetry is dirty. AC-4 only requires a task-artifact commit to be pushed. A predicate that accepts task paths but accidentally rejects telemetry paths would pass the listed push cases while making a full-send run with an unpushed telemetry absorb commit stop at the divergence gate. Add a real-git positive case for that subject and telemetry-only paths.

### Type Safety / Interface Gaps

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, with the positive telemetry case passed to the plan phase
- [ ] **Changes requested** — spec must be revised before plan phase
