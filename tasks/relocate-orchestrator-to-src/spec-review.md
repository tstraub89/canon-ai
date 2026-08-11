# Spec Review: relocate-orchestrator-to-src

> Reviewer: Codex | Spec: `tasks/relocate-orchestrator-to-src/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

No concerns.

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

- **Non-blocking nit — two bare `run-task/signals.ts` comment references evade AC-2 and would become stale.** The entry-point comment at `scripts/run-task.ts:3` and the signal-isolation comment at `scripts/run-task/agents/stream.ts:39` both name `run-task/signals.ts` without the `scripts/` prefix. AC-2 searches for `scripts/run-task`, so it will not detect either reference after the move. The Affected Files table requires the entry point's imports to change but does not mention its comment (`spec.md:179`), and explicitly says `agents/stream.ts` remains byte-for-byte unchanged (`spec.md:150`). This does not affect runtime behavior or make the move unimplementable, but the plan should update both comments to an accurate `src/orchestrator/signals.ts` or local `signals.ts` reference so the relocation does not leave source guidance pointing at a nonexistent directory.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
