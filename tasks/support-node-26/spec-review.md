# Spec Review: support-node-26

> Reviewer: Codex | Spec: `tasks/support-node-26/spec.md`

## Shape Check

no concerns

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

None.

### Missing Edge Cases

None.

### Type Safety / Interface Gaps

None.

### Nits

- The first Judgment Calls row says an admin bypass covers the PR that introduces the renamed checks, but Known Risks and Human Test Plan step 5 say the human must replace the old required checks before merging. The spec also notes `canon run --ship` uses plain `gh pr merge` without `--admin`. Reconcile the rationale with the explicit pre-merge ruleset update so the operator path is consistent. This is non-blocking because the risk mitigation and Human Test Plan specify the implementable path.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase
