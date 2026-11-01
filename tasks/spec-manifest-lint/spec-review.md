# Spec Review: spec-manifest-lint

> Reviewer: spec reviewer | Spec: `tasks/spec-manifest-lint/spec.md`

## Shape Check

no concerns

The new lint addresses verified scope loss at appropriate phase boundaries. The parser correction in AC-6 has a confirmed deterministic mechanism and explicit red-first tests with handoff evidence requirements.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality beyond the explicitly intended fence/comment exclusion

Re-read the current spec and inspected the markdown scanner, manifest/path parsing, phase gate, evidence recovery, plan/implement dispatch, reroute state handling, scope consumers, guidance surfaces, and managed-file registry.

Executed current-source probes confirm the specified regression fixtures: the fenced example returns only `example.ts`; a commented table returns `old.ts` alongside `real.ts`, whether it precedes or follows the live table. The task's own manifest parses to 28 existing paths with no malformed cells.

## Issues Found

### Correctness Issues

None.

### Missing Edge Cases

None.

### Type Safety / Interface Gaps

None.

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase

Remaining verification belongs to implementation: execution of the new gates and bypasses, bundle/worktree coverage, and archive false-positive calibration. No implementation validation results are claimed by this review.
