# Spec Review: bundle-secondary-branch-worktree-routing

> Reviewer: Codex | Spec: `tasks/bundle-secondary-branch-worktree-routing/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- **[Non-blocking nit] The performance risk understates the scan frequency.** Known Risks says `resolveTaskCwd` is called “per phase boundary,” but `readStatus()` calls `statusFileFor()` on every status read (`scripts/run-task/state.ts:110-159`), and current consumers repeatedly resolve task artifacts and statuses within a phase (`scripts/run-task/context.ts:83,126,143`; `scripts/run-task/validation.ts:76-77,692-693,1071,1102`; `scripts/run-task/main.ts:2347,2377,2426,2544,2642`). The heartbeat resolver also calls `statusFileFor()` on every tick (`scripts/run-task/main.ts:3381,3425,3440`). For every secondary whose main branch remains empty, each such resolution executes the proposed `git worktree list --porcelain` scan. This does not make the design unimplementable, but the plan should treat it as repeated subprocess work and either accept it with a quick measurement or introduce a safely invalidated per-enumeration seam; it should not assume one scan per phase.

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
