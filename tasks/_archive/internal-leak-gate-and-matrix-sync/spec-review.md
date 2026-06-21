# Spec Review: internal-leak-gate-and-matrix-sync

> Reviewer: Codex | Spec: `tasks/internal-leak-gate-and-matrix-sync/spec.md`

## Shape Check

no concerns

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

(none)

### Missing Edge Cases

- The Human Test Plan still uses file names and code-like phrases, even though the spec checklist says it should stay in product language only. That does not block implementation, but it leaves the reviewer-facing plan less aligned with the documented spec style.
- AC-1 through AC-3 refer to a generic "scan entry point" without naming the seam the tests should target. The obvious implementation path is `tests/sync-canon-templates.test.ts` against `findSyncErrors`, but the spec would be easier to execute if it named that seam explicitly.

### Type Safety / Interface Gaps

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
