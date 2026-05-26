# Spec Review: worktree-canonical-task-state

> Reviewer: Codex | Spec: `tasks/worktree-canonical-task-state/spec.md`

## Shape Check

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

- **Non-blocking nit:** The spec has a stale rationale about first-implement worktree creation timing. It says `getActiveCwd(taskIds)` invokes `ensureWorktree` and creates the worktree (`tasks/worktree-canonical-task-state/spec.md:53`, `spec.md:183`, `spec.md:187`, `spec.md:325`). Current code has `getActiveCwd` only select an existing worktree or die / fall back (`scripts/run-task/worktree.ts:50-72`); first-implement creation happens in `ensureBranch` via `ensureWorktree` before `getActiveCwd` is called (`scripts/run-task/git.ts:173-214`, `scripts/run-task/phases/implement.ts:41-66`). This does not block implementation because AC-9 still requires the right behavior: delete the REPO_ROOT-to-worktree copy loop and preserve the `ensureBranch` / `getActiveCwd` flow. Plan/implementation should avoid relying on the false "getActiveCwd creates the worktree" explanation.

### Missing Edge Cases

(none)

### Type Safety / Interface Gaps

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
