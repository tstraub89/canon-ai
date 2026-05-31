# Spec Review: adopter-gitignore-sync

> Reviewer: Codex | Spec: `tasks/adopter-gitignore-sync/spec.md`

## Shape Check

No concerns.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

1. **Non-blocking nit — `Docs Impact` still names `docs/pipeline-orchestrator.md` even though AC-12 explicitly excludes it.** AC-12 says the task is scoped only to `docs/codebase-map.md` and that `docs/pipeline-orchestrator.md` is not edited because it is in `CANON_OWNED`. The `Docs Impact` section still says `docs/pipeline-orchestrator.md` is "likely a one-line adopter note." Clean that stale line during the plan/spec cleanup so implementers do not accidentally expand scope.

2. **Non-blocking nit — add `templates/.gitignore` to the adopter-shipped leakage scan while touching `tests/cli.test.ts`.** `package.json` ships the `templates/` directory, and the current `ADOPTER_SHIPPED_PATHS` list in `tests/cli.test.ts` enumerates template files plus both dist entries but does not have `templates/.gitignore` yet. The spec already has `tests/cli.test.ts` in scope; adding the new template file to that list keeps the existing "adopter-shipped content does not leak canon-development tokens" guard complete.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

None.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
