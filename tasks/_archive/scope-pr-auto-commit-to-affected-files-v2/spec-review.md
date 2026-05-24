# Spec Review: scope-pr-auto-commit-to-affected-files-v2

> Reviewer: Codex | Spec: `tasks/scope-pr-auto-commit-to-affected-files-v2/spec.md`

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

None.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- Non-blocking nit: the `tests/run-task-safety.test.ts` Affected Files row still says to cover "AC-9's five cases" (`spec.md:85`), while AC-9 now lists seven cases, including the non-managed source/test-file safety cases (`spec.md:68`). AC-9 itself is clear enough to implement, but the plan should follow AC-9 rather than the stale count in the file table.
- Non-blocking nit: the proposed source/test-file remediation text says managed-doc sync is one possible reason a source or test file is dirty (`spec.md:27`), but the live sync loop only iterates `PIPELINE_SHARED_DOCS` (`scripts/run-task/worktree.ts:287`), which is telemetry plus managed docs (`scripts/run-task/worktree.ts:15-24`). For source/test files, the message should point at unexpected late edits or base-drift/branch contamination generally, not specifically managed-doc sync.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

- Non-blocking nit: AC-5 / the design sketch use `splitWorktree.PIPELINE_MANAGED_DOCS.includes(f)` where `f` is a `string` (`spec.md:60`, `spec.md:83`). Because `PIPELINE_MANAGED_DOCS` is a readonly literal tuple (`scripts/run-task/worktree.ts:15-22`), the implementation will likely need the existing local pattern `(PIPELINE_MANAGED_DOCS as readonly string[]).includes(...)` used in `worktree.ts:289` to satisfy strict TypeScript. This is an implementation detail, not a spec blocker.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
