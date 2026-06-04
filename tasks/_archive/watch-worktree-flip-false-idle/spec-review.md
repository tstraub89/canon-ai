# Spec Review: watch-worktree-flip-false-idle

> Reviewer: Codex | Spec: `tasks/watch-worktree-flip-false-idle/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

no concerns

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

- **Nit:** AC-3’s integration test has to seed the heartbeat in the same subprocess that runs `ensureBranch`, because `activeHandles` is process-local. The current `runNodeInline` harness in [`tests/run-task-safety.test.ts`](/Users/tstraub/canon-ai/canon-ai-dev/tests/run-task-safety.test.ts) won’t observe a handle created only in the outer test process, so the plan phase should spell out where that setup lives.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [x] **Approved with nits**
> Findings: The reroute closes the bundle-mode hole cleanly by moving the force-tick after branch recording, so secondary tasks can resolve into the shared worktree before the heartbeat write. The remaining non-blocking note from round 0 still applies: AC-3/AC-6 need the heartbeat handle seeded inside the same subprocess that runs `ensureBranch`, because `activeHandles` is process-local and an outer-test-process seed will not be visible to the code under test.
