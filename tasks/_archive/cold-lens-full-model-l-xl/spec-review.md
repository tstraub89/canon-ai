# Spec Review: cold-lens-full-model-l-xl

> Reviewer: Codex | Spec: `tasks/cold-lens-full-model-l-xl/spec.md`

## Shape Check

No concerns.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

Verified the matrix and effective-size promotion in `src/lib/pipeline-policy.ts`, the module-load environment resolution in `src/orchestrator/policy.ts`, and the real cold-review path through `src/orchestrator/phases/code-review.ts` and `src/orchestrator/agents/codex.ts`. The backend already forwards the resolved model and effort; the specified matrix change needs no additional runtime caller changes. The named documentation and mirror edits cover the live flat-mini claims found during review.

Baseline verification: the following scoped command passed all 18 selected tests against the current, pre-change code:

```bash
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='codex matrix|review invocation parity' tests/pipeline-policy.test.ts tests/run-task-code-review.test.ts
```

`npm run docs-refs-check` also passed after writing this review.

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

No findings. Remaining risk: the review-quality benefit is a bounded policy bet, as the spec states. This review did not repeat the live model replays or independently reproduce the historical defect-rate audit; AC-7 retains the post-release measurement follow-up.
