# Spec Review: code-review-codex-lens

> Reviewer: Codex | Spec: `tasks/code-review-codex-lens/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [ ] Affected files exist and contain what the spec assumes
- [ ] Proposed patterns are consistent with existing conventions
- [ ] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- **Blocking:** AC-4's hard-fail path does not match the current orchestrator. The spec requires the foreman to write a "Cold-Codex lens failed — review incomplete" note into `review.md`, run no `canon task phase ... code_review done <verdict>`, and end its turn; it then claims leaving `code_review` not-done makes the existing "phase did not reach done -> stop for human" path halt the run (spec.md:40). Current `checkAndRoute()` does not halt immediately when a phase is not done: it calls `recoverPhaseForTask()` first (scripts/run-task/main.ts:2925-2953). For `code_review`, the evidence rule reads `review.md`; if the file is populated but has no checked verdict, it returns "no verdict box checked" rather than advancing (scripts/run-task/main.ts:2742-2748), and `recoverPhaseForTask()` then attempts a one-shot retry before it will stop (scripts/run-task/main.ts:2889-2920). The session is stored before `checkAndRoute()` runs for `code_review` (scripts/run-task/main.ts:3366-3388), so the retry path is available and will resume the same Claude review session with an explicit instruction to finish the phase. That means AC-4's "write note + end turn" behavior can trigger a retry turn rather than the intended operator halt, and the retry prompt pressures the foreman to run `canon task phase ... done <verdict>`. The spec needs either an orchestrator change/sentinel that bypasses recovery for this deliberate incomplete-review state, or a different failure contract that works with the current recovery machinery.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

None beyond the AC-4 recovery-path blocker above.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (list items above)
