# Spec Review: canon-snapshot-robustness

> Reviewer: Codex | Spec: `tasks/canon-snapshot-robustness/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

(none)

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- The `scripts/run-task/canon-snapshot.ts` code sketch in the Affected Files table still says `process.env.CANON_UPSTREAM_REPO ?? CANON_UPSTREAM_REPO`, which conflicts with AC-1's trimmed non-empty override and empty/whitespace fallback. That line should be tightened to match the actual resolution rule so the implementer does not accidentally stamp an empty repo.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**

## Amendment Review Round 2

- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**
