# Spec Review: path-scoped-pitfalls

> Reviewer: Codex | Spec: `tasks/path-scoped-pitfalls/spec.md`

## Shape Check

no concerns

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

none

### Missing Edge Cases

- **Nit — park-resume prompt coverage is not explicit.** The Problem section says park-resume receives the block because it renders the fresh implement prompt, but AC-12 names only fresh, reroute, and reroute-resumed golden snapshots. `promptImplementParkResume()` currently calls `promptImplement(state, 'fresh', ...)` in `src/orchestrator/prompts/index.ts`, so the behavior is clear and should flow through; add a focused assertion or golden to ensure the path remains covered.

### Type Safety / Interface Gaps

none

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase

## Amendment Review

- [ ] **Approved**
- [x] **Approved with nits**
- [ ] **Changes requested**

> Findings:
> - **Nit — AC-15 has a dangling fixture reference.** It says “The AC-4 fixture's nested table carries a path token again,” but AC-4 does not describe a nested-table fixture. Clarify which fixture/test this refers to; the required behaviors in AC-15 and the target-precedence cases in AC-16 are otherwise implementable and verifiable.
