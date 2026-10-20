# Spec Review: watch-crash-not-step-done

> Reviewer: Codex | Spec: `tasks/watch-crash-not-step-done/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

No concerns. The reported false `step_done` follows deterministically from the traced idle-classifier branch, and the spec includes a red-first regression AC for that branch.

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

> Findings: None. The amendment adds the generated bundle files omitted from the prior Affected Files list and makes the build freshness condition verifiable. AC-12's documentation placement and line-start parser test fit the approved stderr-only diagnostic and summary-line contract without changing its behavior.

## Amendment Review Round 2
- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**

> Findings: None. Round 2 replaces the line-start constraint with a marker match that can begin after unterminated agent output while requiring the timestamp to terminate the line or file. The new cases verify both the mid-line marker and truncated-tail fallback. This is consistent with the existing writer's marker suffix and preserves the approved diagnostic and summary-line behavior.

## Amendment Review Round 3
- [x] **Approved**
- [ ] **Approved with nits**
- [ ] **Changes requested**

> Findings: None. The current detached launcher opens the run log under the primary task directory once, and heartbeat records carry the ordered `task_ids`, confirming the worktree and bundle lookup gap described by this amendment. AC-13 covers both the main-checkout and resolved task directories while retaining the primary ID across heartbeat cleanup; AC-14 and AC-15 verify the worktree and bundle regressions. AC-16 gives a bounded implementation choice for `--follow` and requires the residual gap to be recorded if it is not included. This integrates with the approved crash-marker behavior and leaves the existing verdict and stdout summary contracts intact.
