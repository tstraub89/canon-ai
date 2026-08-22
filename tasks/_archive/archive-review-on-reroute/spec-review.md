# Spec Review: archive-review-on-reroute

> Reviewer: Codex | Spec: `tasks/archive-review-on-reroute/spec.md`

## Shape Check

No concerns. The problem is a deterministic stale-artifact bug, and the stated mechanism still reproduces against the current parser: a stale checked verdict in the last `## Round N` section wins over a later top-level fresh approval. AC-1 provides the required red-first production-path regression. Archiving the stale artifact is the right layer; changing the deliberate latest-round parser would solve an adjacent problem.

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

### Non-blocking Nits for Plan

- Keep the template-stub exception scoped to `rerouteFromHumanReview`. Current `taskResetCodeReview` archives any existing `review.md` (`src/task/index.ts:1120-1126`), while the spec permits only its allocator to change (`spec.md:36`). The non-binding helper sketch at `spec.md:137` returns null for a stub; if implemented as unconditional helper behavior, that would silently add a second observable `reset-code-review` change not covered by its existing tests. A reroute-side pre-check or an explicit helper option preserves the stated boundary.
- Read AC-3's “no test file edits” as “do not modify the existing reset-code-review test cases.” Taken literally, it conflicts with AC-6 and the Affected Files table, which require adding a separate reroute worktree test to `tests/task-cli.test.ts` (`spec.md:45,48,69`). The intended default is otherwise clear.
- Decide explicitly whether to add an exempt-failing-sibling golden case. The current recorded goldens cover non-exempt reroute prompts (`tests/run-task-prompts.test.ts:239-257,458-460`); the exempt findings lines are direct assertions only (`:355-386`). Updating those assertions and regenerating therefore produces no `tests/run-task-prompts.golden.json` delta unless the plan adds a recorded variant, while AC-12 and the Affected Files table currently expect that generated file to change (`spec.md:54,71`). Either add the golden variant or treat the unchanged regeneration as the expected result.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
