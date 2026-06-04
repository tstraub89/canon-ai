# Spec Review: qa-drafts-pr-body

> Reviewer: Codex | Spec: `tasks/qa-drafts-pr-body/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- no concerns

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

(none)

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- non-blocking nit: `scripts/run-task/worktree.ts` is worth updating for registry consistency, but the current `--pr` commit path does not use `TASK_ARTIFACT_FILES` as its source of truth. `commitTaskArtifactsToBase()` stages the whole `tasks/<id>/` tree, so adding `pr-body.md` there is bookkeeping rather than a prerequisite for commit coverage. The plan should treat that change as hygiene, not as the mechanism that makes `--pr` include the new artifact.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
