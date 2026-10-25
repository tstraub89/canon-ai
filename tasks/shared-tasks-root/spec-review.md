# Spec Review: shared-tasks-root

> Reviewer: Codex | Spec: `tasks/shared-tasks-root/spec.md`

## Shape Check

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

(none)

### Missing Edge Cases

(none)

### Type Safety / Interface Gaps

(none)

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

### Shape Check

- **AC-16 does not define a way to distinguish the non-git case from a git repository root.** `resolveProjectRoot()` returns only a path, and for a process whose cwd is the repository root it returns that same cwd; outside git it also returns cwd. Therefore, if `resolveTaskCwd()` uses only that result to decide whether to skip worktree enumeration, `canon task status` from a git repository root with a `worktree: true` task can take the new non-git shortcut and stop refusing when `git worktree list` fails. Specify a shared-resolver signal/helper that preserves whether its git probe succeeded (and test both a non-git cwd and a git repository root with a failing worktree-list command). This keeps AC-16's non-git shortcut distinct from the existing in-repository fail-closed path.

### Feasibility and Integration

AC-17's removal of the legacy single-field query fits the approved AC-15 resolver contract. AC-4 already supplies a red-first subprocess regression for the out-of-git status/set/list path, and the amendment retains the existing refusal test for a failed worktree enumeration inside git. The amendment otherwise stays within the approved scope.

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

### Shape Check

- **The new bug-fix mechanism is asserted, but its confirmation evidence is not recorded in the Problem statement** (`spec.md:170-176`). The deterministic path is plausible and consistent with the source: a newly scaffolded task has `worktree: true` and an empty `branch` (`.canon/templates/status.json:7,21`); `resolveTaskCwd()` then scans worktrees and dies when enumeration fails (`src/orchestrator/state.ts:339-363`). However, the amendment only says the commands “still fail” and that enumeration is fatal; it does not record a reproduction or a verified trace showing this newly created non-git task reaches that branch. Add that trace (including the triggering status values and observed failure) to the Problem statement. AC-16's future regression tests do not confirm the root cause before the fix, as required by the diagnose checkpoint.

### Feasibility and Integration

The revision resolves the prior review concern: AC-16 now requires a shared-resolver signal for repository membership and tests both a non-git directory and a git repository root, preserving fail-closed behavior. AC-17 remains consistent with the approved resolver contract. No other amendment conflict found.

## Amendment Review

- [ ] **Approved**
- [ ] **Approved with nits**
- [x] **Changes requested**

### Shape Check

- **AC-16 leaves the placement of its non-git short-circuit unspecified** (`spec.md:185-190`). The current `resolveTaskCwd()` checks for `<worktreesRoot>/<taskId>/tasks/<taskId>/status.json` and returns that direct worktree before it reads task metadata or scans git (`src/orchestrator/state.ts:330-334`). If that path exists while cwd is outside git, the new code can still return the worktree instead of the project root, contrary to AC-16. Require the non-git probe check before all worktree resolution and cover the direct-worktree-present case in a test, or narrow the AC's promised behavior explicitly.

### Feasibility and Integration

The updated Problem now supplies executed evidence for the deterministic failure path, including the scaffolded `worktree: true` / empty `branch` values and the observed `git worktree list` error (`spec.md:174-179`); the diagnosis checkpoint is satisfied. AC-16's resolver-outcome signal and repository-root refusal case address the prior review concern. AC-17 remains consistent with approved AC-15.

## Amendment Review

- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**

### Shape Check

The amendment now resolves the outside-git failure by changing the product contract to an early `canon task` refusal, rather than adding a non-git exception to worktree state resolution. AC-4 and the Human Test Plan reflect the decision; the new dispatch-level guard is testable across representative subcommands. The earlier direct-worktree ordering concern no longer applies because AC-16 leaves `resolveTaskCwd()` unchanged.

### Feasibility and Integration

The Problem records the executed failure with the scaffolded status values and observed error, satisfying the diagnosis checkpoint. The fake-git update and removal of the single-field fallback remain scoped to the shared resolver. The change does not contradict the approved project-root fallback contract: that resolver still resolves non-git cwd, while `canon task` now refuses to operate there. No findings.
