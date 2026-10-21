# Spec Review: full-send-tail-push-and-watch

> Reviewer: Codex | Spec: `tasks/full-send-tail-push-and-watch/spec.md`

## Shape Check

- **Blocking — the proposed scaffold classification does not establish commit provenance.** The Decision defines a commit as a canon scaffold commit solely by its exact subject and paths under `tasks/` or `PIPELINE_TELEMETRY_FILES`. An operator can create an unpushed commit with `task(<id>): commit artifacts pre-pipeline` (or the telemetry subject) touching only those paths; the full-send tail would classify and push it. This conflicts with the stated guarantee that operator commits are never pushed (Decision 2, “If any unpushed commit is not a canon scaffold commit,” and Known Risks). Add a provenance check that distinguishes commits created by canon from operator commits, and an AC covering an operator-created commit with an exact scaffold subject and allowed paths.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

- See Shape Check: exact subject and allowed paths can be supplied by an operator, so those checks alone can push an operator-created commit.

### Missing Edge Cases

- AC-5 tests arbitrary/near-miss subjects and an out-of-scope path, but not an operator-created commit that exactly meets both proposed scaffold predicates.

### Type Safety / Interface Gaps

- None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (see blocking issue above)
