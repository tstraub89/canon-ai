# Spec Review: add-xs-tier

> Reviewer: Codex | Spec: `tasks/add-xs-tier/spec.md`

## Shape Check

No concerns. The current spec frames the work as the actual policy change plus the necessary live-guidance sweep, and the revised AC-18 gate now covers the previously missed fast-tier identity shapes.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Policy changes fit the table-driven `scripts/pipeline-policy.ts` pattern
- [x] Guidance sweep has structural gates for the zero-gateable stale families
- [x] Tier-dependent non-policy test fixtures are called out
- [ ] Minor test cleanup detail noted below

## Issues Found

### Correctness Issues

None.

### Missing Edge Cases

1. **Non-blocking nit: carry the `tests/pipeline-policy.test.ts` empty-input assertion through the XS floor change.** AC-9 requires `maxSize` to seed at the XS floor (`tasks/add-xs-tier/spec.md:62`), and the affected-file row correctly says `scripts/pipeline-policy.ts` should seed `maxSize` at `'XS'` (`tasks/add-xs-tier/spec.md:132`). The current test suite also has a defensive empty-list test named `policy: empty task list falls back to S/fast tier` whose assertions expect nominal/effective `S` (`tests/pipeline-policy.test.ts:235`-`241`). That is not called out in AC-12 or the test affected-file row (`tasks/add-xs-tier/spec.md:71`, `tasks/add-xs-tier/spec.md:133`). `npm test` will expose it, and the expected update follows directly from the new floor, so this is not blocking; plan/implementation should include renaming/updating that test to expect XS/fast tier.

### Type Safety / Interface Gaps

None found.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
