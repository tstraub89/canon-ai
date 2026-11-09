# Spec Review: spec-prompts-term-renames-rule

> Reviewer: spec reviewer | Spec: `tasks/spec-prompts-term-renames-rule/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)
- Does the spec list every judgment call it makes? A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. A choice a project doc already settles is not a judgment call: follow the doc and cite it.

(no concerns / list items)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [ ] Affected files exist and contain what the spec assumes
- [ ] Proposed patterns are consistent with existing conventions
- [ ] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

(none / list items)

### Missing Edge Cases

> Scenarios the spec doesn't account for.

(none / list items)

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none / list items)

## Verdict

- [x] **Approved** — spec is implementable as written

Fast tier full-send — no human spec approval; `/canon-spec-review` run before launch (1 BLOCKING fixed: AC-4 task-artifact exclusion; 1 STRONG resolved by declaring the review-side exclusion); spec review skipped.
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
