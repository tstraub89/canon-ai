# Spec Review: ship-merge-proof

> Reviewer: Codex | Spec: `tasks/ship-merge-proof/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist or are explicitly marked new
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

None.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

None.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

None.

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**

> Findings: No blockers. The amendment is implementable as written and integrates coherently with the approved spec. The current code supports the amended premise: `assertTaskBranchPushed()` permits the local branch to be behind origin when local has no unique commits, while `mergeOpenPRsAndPull()` merges the open PR from the remote branch. Replacing strict local-tip equality with `git merge-base --is-ancestor <localTip> <headRefOid>` preserves the fail-closed behavior for local-only commits and stale/reused PRs, and AC-14/AC-15 make the behind-local pass case and unmaterializable-head failure case directly verifiable.
