# Spec Review: adopt-eslint

> Reviewer: Codex | Spec: `tasks/adopt-eslint/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- no concerns

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- nit: `docs/architecture.md` needs the lint row rewritten, not just the `N/A` token replaced. The current row says "Adding one is a future task"; if that text stays, the updated validation table will contradict the new ESLint adoption.
- nit: the human test plan says the suite "currently [has] 58" tests, but the current tree only has three test files and the visible registrations in them total 41 top-level tests. That count is stale and should be updated or removed so QA doesn't verify against the wrong number.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- none

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- none

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
