# Spec Review: runtime-validation-phase

> Reviewer: Codex | Spec: `tasks/runtime-validation-phase/spec.md`

## Shape Check

No concerns.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

- **Non-blocking nit:** The affected-files row for `scripts/run-task/prompts/index.ts` + `implement-revisions.md` says the template uses Handlebars conditional blocks (`tasks/runtime-validation-phase/spec.md:198`), but the current renderer imports and calls Mustache (`scripts/run-task/prompts/render.ts:1`). The specific `{{#hasReviewFindings}}...{{/hasReviewFindings}}` section syntax named in the spec is Mustache-compatible, so this is implementable, but the plan should avoid any Handlebars-only helpers or assumptions.

### Missing Edge Cases

- **Non-blocking nit:** AC-12 requires the reroute prompt to include `artifactReadingHint` when set (`tasks/runtime-validation-phase/spec.md:141`), while the affected-files row says the prompt builder computes the runtime-failure list from `computeLatestRuntimeResults` parsed from handoff (`tasks/runtime-validation-phase/spec.md:198`). Since the handoff row format in AC-5 does not carry `artifactReadingHint`, the plan should explicitly source the hint from `RUNTIME_CHECKS` by check name, or persist it in the runtime result data.

### Type Safety / Interface Gaps

- **Non-blocking nit:** AC-4 defines the new phase entrypoint as `runRuntimeValidationPhase(taskIds, ctx, checks?)` with `checks?: readonly RuntimeCheck[]` as the test seam (`tasks/runtime-validation-phase/spec.md:55-56`), but the affected-files table lists `runRuntimeValidationPhase(taskIds, ctx)` only (`tasks/runtime-validation-phase/spec.md:194`). The AC is clear enough to implement; update the plan signature from AC-4 rather than the shortened table row.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
