# Spec Review: implementer-blast-radius-map

> Reviewer: Codex | Spec: `tasks/implementer-blast-radius-map/spec.md`

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

- **Nit — park-resume map assertion is missing.** The Decision section requires the map in fresh, park-resume, and reroute implement prompts, but AC-10 only verifies fresh and reroute, and the named golden checks do not cover `promptImplementParkResume`. The park-resume function exists in `src/orchestrator/prompts/index.ts` and renders the implement prompt path, so the plan should add an assertion or golden that its rendered prompt includes the map. The intended behavior is clear; this is a coverage gap, not a blocker.

### Type Safety / Interface Gaps

none

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
