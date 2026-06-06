# Spec Review: bundle-preflight-atomic-rejection

> Reviewer: Codex | Spec: `tasks/bundle-preflight-atomic-rejection/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes.
- [x] Proposed patterns are consistent with existing conventions.
- [x] No conflicts with existing functionality.

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- None.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- **Non-blocking nit: define how `<N>` is derived for the appended clean-task headings.** AC-4 mandates exact append headings like `## Bundle Pre-Flight Rejection (round <N>) — sibling task(s) failed`, but the current code has no existing helper for that number in the pre-flight append path (`scripts/run-task/phases/code-review.ts:174-188`). `runCodeReviewPhase` has `maxIter` from `iterations_current_loop` (`scripts/run-task/phases/code-review.ts:106`), but after a prior approved review preserved by `rerouteFromHumanReview`, that counter is reset to `0` while the old `review.md` remains on disk (`scripts/run-task/main.ts:1930-1949`). The heading number is not behavior-critical because the heading deliberately does not start with `## Round` and is not parsed by `extractCheckedVerdict` (`scripts/run-task/validation.ts:864-872`), so Codex can choose a stable convention in the plan. The plan should state whether `<N>` means "prior real review count + 1", `maxIter + 1`, or a non-semantic attempt label, and tests should assert that convention.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
