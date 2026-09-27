# Spec Review: fix-staged-deletion-autocommit-and-dir-refs

> Reviewer: Codex | Spec: `tasks/fix-staged-deletion-autocommit-and-dir-refs/spec.md`

## Shape Check

No concerns. The spec gives executed Git reproductions for the staging failure, a deterministic trace for directory refs, and unskipped red-first regression criteria.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No blocking conflict with existing functionality found

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

None.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

None.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

None.

### Non-blocking scope note

- **Nit — Docs Impact exceeds the Affected Files list.** The revised Docs Impact says `docs/patterns.md` “gets one line,” but that file is absent from Affected Files. It is a root-only doc, absent from `CANON_OWNED` in `src/lib/canon-owned.ts`; its existing `templates/docs/patterns.md` is not a sync mirror. Given the Affected Files cap, I interpret the line as an advisory QA documentation note, not an implement edit. The plan should make that interpretation explicit; if the line is required in this task's implementation, the spec author should add `docs/patterns.md` to Affected Files. This does not affect the bug-fix ACs.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, with the Docs Impact scope interpretation above for plan
- [ ] **Changes requested** — spec must be revised before plan phase
