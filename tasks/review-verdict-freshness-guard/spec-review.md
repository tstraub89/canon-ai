# Spec Review: review-verdict-freshness-guard

> Reviewer: Codex | Spec: `tasks/review-verdict-freshness-guard/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- **Non-blocking nit — narrow the non-zero-exit claims to the non-interactive `codex exec` path.** In interactive mode, `runCodex()` calls `runCommandOrDie()` (`scripts/run-task/agents/codex.ts:50-67`), whose non-zero/spawn/signal branches call `process.exit(...)` directly (`scripts/run-task/git.ts:25-29`); that mode never returns a non-zero `PhaseRunResult` and therefore cannot reach the new park branch. Interactive failure already fails closed (no stale recovery/counter mutation), so this does not undermine the fix, but the Problem/Decision/docs should avoid saying *every* non-zero Codex `spec_review` reaches and parks in `checkAndRoute`. State that the new guard covers the returning non-interactive exit-code path demonstrated by the live repro, while interactive mode remains under the wrapper-exit Non-Goal.

- **Non-blocking nit — make AC-4's verdict and counter expectation explicit.** `updateReviewCounters()` increments both `iterations_current_loop` and `iterations_total` only for `changes_requested` / `needs_re_review`; approval verdicts increment total but reset the loop counter to zero (`src/task/index.ts:394-415`). AC-4 currently asks a generic “freshly written checked verdict” fixture to assert both counters are incremented. Specify `changes_requested` for that fixture, or state verdict-dependent expected counters. The same precision should replace the Problem's broader claim that the counters increment “unconditionally”; that statement is accurate for the reproduced stale-`changes_requested` case, not for every verdict.

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
