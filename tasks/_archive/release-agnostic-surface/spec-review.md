# Spec Review: release-agnostic-surface

> Reviewer: Codex | Spec: `tasks/release-agnostic-surface/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [ ] Affected files exist and contain what the spec assumes
- [ ] Proposed patterns are consistent with existing conventions
- [ ] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

(none)

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- AC-4 says the skill should emit a one-time nudge when `docs/decisions.md §Versioning` is missing, but it does not pin the surface for that nudge. The plan should choose whether it appears in the skill's response, as a warning, or as a generated note so the behavior is deterministic.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [x] **Approved with nits**
> Findings: no blocking issues in the amendment itself. AC-12 is implementable as a present-case read/apply step ahead of the generic changelog heuristics, and AC-13 cleanly reframes the `npm version` / `.canon/version` init block as an example instead of a universal requirement. The earlier AC-4 ambiguity about the exact surface of the one-time nudge remains a non-blocking nit.

## Amendment Review Round 2

- [x] **Approved with nits**
> Findings: no blocking issues in the revised amendment. The reconciliation note now resolves the AC-4/AC-14 mismatch by explicitly superseding the old greenfield-default wording and aligning it with the actual `canon-changelog` prerequisite template, so finalize mode has a defined version-less `## [Unreleased]` input to operate on. The remaining AC-4 one-time-nudge surface is still a non-blocking nit.

## Amendment Review Round 2

- [x] **Approved with nits**
> Findings: no blocking issues in the revised amendment. The new reconciliation text cleanly supersedes AC-4's greenfield-default wording so it matches the actual `canon-changelog` prerequisite template, and AC-14 now has a defined version-less `## [Unreleased]` input to operate on. The remaining AC-4 nudge-surface ambiguity is still a non-blocking nit, but it does not block implementation.
