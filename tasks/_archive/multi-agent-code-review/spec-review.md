# Spec Review: multi-agent-code-review

> Reviewer: Codex | Spec: `tasks/multi-agent-code-review/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

No concerns. The problem is real, the all-LLM foreman tradeoff is explicit, and the deterministic test surface is now scoped to what the Node layer can actually verify.

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

None found.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- **Non-blocking — define `spec_gap` counter behavior in the plan.** `src/task/index.ts` centralizes review counters in `updateReviewCounters()`, which currently updates counters only for `changes_requested` / `needs_re_review` and approval verdicts (`src/task/index.ts:362-383`). Since `spec_gap` is a completed review that then blocks for human escalation, the plan should state whether it increments `iterations_total`, resets or preserves `iterations_current_loop`, and clears `preflight_rejections_current_loop`.

- **Non-blocking — fix the verdict-surface count label.** AC-10 now enumerates seven verdict surfaces (`spec.md:67`), while AC-11 still says "all six surfaces" (`spec.md:68`). The actual surfaces and affected files are usable; the count label should be corrected during planning or spec polish to avoid test-name drift.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

None found.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
