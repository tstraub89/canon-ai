# Spec Review: code-review-codex-lens

> Reviewer: Codex | Spec: `tasks/code-review-codex-lens/spec.md`

## Shape Check

> Strategic read of the spec itself - does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [ ] Proposed patterns are consistent with existing conventions
- [ ] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

None.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

None.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- **Blocking:** AC-4 requires an additive telemetry field with a diff-size proxy written through `scripts/run-task/metrics.ts` (`spec.md:44`, `spec.md:104`, `spec.md:146`), but the spec also lists `types.ts` under "Not edited" because there is no new verdict (`spec.md:135`). In the current code, `recordMetric()` is typed as `MetricEntry` from `scripts/run-task/types.ts` (`metrics.ts:5`, `metrics.ts:13`), writes a fixed markdown row shape (`metrics.ts:22-32`), and `MetricEntry` has no diff-size/cold-Codex telemetry field (`types.ts:158-168`). If implementation follows the "not edited" instruction, adding the field at the call site or in `recordMetric()` will fail type-check; if it avoids the type change, AC-4's "additive telemetry field" has no specified typed contract and risks being hidden in an existing column or a parallel untyped writer. The spec needs to add `scripts/run-task/types.ts` to Affected Files for a `MetricEntry`-only change and clarify "no Verdict union/status schema changes", or specify a telemetry design that does not extend `MetricEntry`.

## Verdict

- [ ] **Approved** - spec is implementable as written
- [ ] **Approved with nits** - implementable, but noting observations for plan phase
- [x] **Changes requested** - spec must be revised before plan phase (list items above)
