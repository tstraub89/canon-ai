# Spec Review: cold-codex-review-invocation-policy

> Reviewer: Codex | Spec: `tasks/cold-codex-review-invocation-policy/spec.md`

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

- **Nit — remove the “QA-phase doc update” labels or make the plan explicitly schedule AC-10 during implement.** The two documentation rows in Affected Files call these QA-phase edits, but AC-10 is binding on the implementer, the Generated Artifacts section requires the synchronized mirror in `handoff.md`, and `code_review` precedes `qa` in `scripts/run-task/types.ts:10`. Deferring them literally to QA would present code review with an unmet AC. The obvious implementation is to make both doc changes before handoff; the plan should say that plainly.
- **Nit — the optional human failure example is not deterministic.** The unchanged success gate in `scripts/run-task/agents/codex.ts:167-172` accepts any non-empty completed `agent_message`; reviewing a branch with no changes can therefore still return a completed explanatory message instead of failing. Use a guaranteed failure action in the Human Test Plan (for example, make the Codex CLI unavailable for that run or terminate the cold subprocess before completion) if the optional failed-row check is retained.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
