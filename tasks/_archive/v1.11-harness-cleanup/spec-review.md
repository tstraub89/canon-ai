# Spec Review: v1.11-harness-cleanup

> Reviewer: Codex | Spec: `tasks/v1.11-harness-cleanup/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

no concerns

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

none

### Missing Edge Cases

> Scenarios the spec doesn't account for.

none

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

none

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [x] **Approved with nits**
> Findings: The sidecar path is coherent and removes the cancellation race cleanly. One implementation detail should be made explicit in plan/implementation: malformed or unreadable `.pr-number` content should fail closed and fall back the same way the current `readPinnedPrNumber` path does, rather than being treated as a trusted pin.

## Amendment Review Round 2

- [x] **Approved**
> Findings: no blockers. Round 2 cleanly narrows the budget change to print-mode sessions and preserves the sidecar-based `--ship` recovery shape with the missing-worktree fallback explicitly covered.

## Amendment Review Round 3

- [x] **Approved**
> Findings: no blockers. The round-3 correction cleanly delegates `--ship` cwd resolution to the shared resolver, which preserves the branch-based worktree lookup and `CANON_TASKS_DIR_OVERRIDE` behavior the earlier hand-rolled helper had bypassed.
