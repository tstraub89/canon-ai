## Summary

- Implement handoffs now carry a `## Self-Check` table with three rows: test integrity, restatement sweep, and sibling parity. Each row holds the evidence for that check, or `N/A` with a reason.
- The handoff pre-flight rejects a handoff whose baseline Self-Check section is missing, whose rows are missing, or whose evidence is empty, still a placeholder, or a bare `N/A`. The rejection goes to implement under the existing "Fix the handoff" path and counts against the pre-flight loop budget.
- The pre-flight checks presence only. The anchored code-review lens judges whether the evidence holds against the cumulative diff. On revision rounds it reads the latest filled row per check and ignores superseded rows.
- Implement, reroute, revision, and resume prompts, the review template, and the foreman's re-review instruction were updated to match. Docs and the managed template mirrors are in sync.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- The new parser and gate tests were run against the base code before the non-test edits, and they failed there as expected. The `npm test` run in the handoff reported 0 failures. The code review saw one failure in the SIGTERM test in `tests/run-task-signals.test.ts`, which passed when run alone. Treat that test as a possible flake.
- Judgment calls not explicitly confirmed during spec review:
  - A contradicted Self-Check claim fails the anchored review (Stage 1). An unmentioned changed behavioral test is only a Stage 2 `risk/guardrail` finding, so bookkeeping gaps don't cost a full review round.
  - No version exemption for in-flight tasks. The first pre-flight after upgrade rejects a handoff without the baseline section, and the message says to add it in place.
  - Adopter handoff-template overrides still get the instruction to write `## Self-Check`. The gate isn't skipped just because an override template lacks the section.
  - The pre-flight checks only the baseline section. Iteration `### Self-Check` subsections are judged by the anchored lens, not the pre-flight.
  - `checkImplementEvidence` is unchanged, so an implement run can finish with a missing Self-Check row and only be rejected at pre-flight.
  - The test-integrity row covers behavioral tests only. Regenerated snapshots and fixture-only edits can be summarized in one line.
  - Revision rounds judge only the latest filled row per check. A stale row that a later round made untrue is a Stage 1 contradiction, so the fix is one appended row.
- `docs/architecture.md` now names `classifyPreflightBlockers()` as the live pre-review gate, not `validateHandoff()`. `validateHandoff()` remains the test-only parity function.
