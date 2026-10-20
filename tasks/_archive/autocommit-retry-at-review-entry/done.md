# Completion Summary: autocommit-retry-at-review-entry — Retry a failed implement auto-commit at code_review entry

> For the human. This is what you need to know.

## What Changed

When the implement auto-commit fails (for example, a pre-commit hook rejects a doc citation), the run used to stop, and the next `canon run` went straight to code review. Code review's pre-flight then rejected the uncommitted handoff files, and that rejection used up one of the review loops. Now, before code review starts, the run checks whether any file listed in the handoff still has uncommitted changes. If so, it retries the same scoped auto-commit first. If the retry succeeds, the pre-flight sees committed work and nothing is rejected. If the retry fails, the run stops with the same `Auto-commit failed:` message before the pre-flight, so no review loop is spent. If the operator has accepted implement and HEAD still matches the accepted commit, the retry does nothing and the operator keeps ownership of the commit. The foreman prompt also now says that a quoted `§"Heading"` citation must match a real heading, which is the citation form that caused the failure in issue #84.

## Files Changed

- `src/orchestrator/main.ts` — adds the review-entry retry (skips on a current operator accept) before `runPhase` runs code_review.
- `src/orchestrator/prompts/templates/code-review-foreman.md` — citation rule in step 4.
- `tests/run-task-safety.test.ts` — helper-level tests plus three main-loop tests: retry success, clean handoff with pipeline dirt, and retry commit failure.
- `tests/run-task-prompts.test.ts` — asserts the citation rule appears in the rendered foreman prompt.
- `tests/run-task-prompts.golden.json` — regenerated foreman prompt snapshots.
- `docs/pipeline-orchestrator.md` — one sentence in "Auto-Branch + Auto-Commit" on the retry and its failure behavior.
- `templates/docs/pipeline-orchestrator.md` — managed mirror, regenerated (not hand-edited).
- `dist/orchestrator/run-task.js` — rebuilt bundle.

## How to Test

1. In a repo with a pre-commit check, make the auto-commit after implement fail. A broken doc reference that the check rejects is enough.
2. Run `canon run <id>`. Expected: the run stops with `Auto-commit failed:` and does not start code review.
3. Fix the reference and run `canon run <id>` again.
4. Expected: the run prints `Retrying the implement auto-commit that did not complete…`, commits the pending handoff files, then starts code review. There is no pre-flight rejection and no review loop is used.
5. Variant: leave the check failing. Expected: the run stops again with the same commit-failure message, before code review.

## Test Results

These are the results recorded in `handoff.md` at the implement phase (Iteration 2, Re-run validation). QA did not re-run them.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,492 passed, 1 skipped by the sandbox guard. The skipped test was not identified in QA, so it is unverified. The new retry tests do not sit under that guard. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`. |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |

Red-first: the implementer temporarily removed the retry call and ran the AC-1 main-loop test. It failed with `handoff→diff: initial-fixture.txt listed in handoff but not in diff` and `preflight_rejections_current_loop` became `1`. With the call restored, the test passes with the counter at `0` (`handoff.md`, Iteration 2).

Code review: `approved_with_nits` (round 2). No blocking findings. Round 1 found that AC-1 to AC-3 had only helper-level tests. The fix was the three main-loop tests.

## Human Verification Required

None.

Not run, and recommended before merge (spec Human Test Plan, product-level steps above): a scratch project with a real pre-commit check, run through the failure and retry flow.

Pre-merge checklist items QA could not confirm:
- [ ] Version correct: decided at the release step.
- [ ] Changelog updated: the proposed entry below is not yet in `CHANGELOG.md`.
- [x] PR body current: `pr-body.md` is drafted.
- [ ] Final CI/CD checks green: not checked by QA.
- [ ] Final diff matches spec intent: code review approved with nits; QA did not re-verify.

## Proposed Changelog

### Fixed

- **A failed implement auto-commit is retried before code review starts.** If the auto-commit after implement fails, the next `canon run` commits the pending handoff files first, instead of sending them to the code-review pre-flight, which rejected them and used up a review loop. If the retry fails again, the run stops with the same `Auto-commit failed:` message and no review loop is used. An implement the operator accepted is left alone.
- **The code-review foreman cites headings exactly.** A quoted `§"Heading"` citation in `review.md` must match a real heading in that file. A citation to a bold-lead paragraph no longer fails the docs-refs check at commit time; the foreman uses `file:line` or the unquoted `§Name` form instead.

Borderline: the second bullet is a prompt refinement, so a human may choose to drop it.

## Decisions Made

- The retry sits before `runPhase` in the main loop, outside the agent-failure handling that the concurrent `agent-failure-parks-phase` task adds (spec Interaction Dependencies).
- The operator-accept check reuses the same accepted-flag and HEAD-SHA predicate as `operatorAcceptedImplement`, so the two cannot drift. Spec Decision 2 governs this case.
- `retryImplementAutoCommitAtReviewEntry` is exported so the fixtures can reach it. The main-loop tests are what cover the wiring.
- QA classified the first bullet as Fixed (patch-scope) and left the version tier to the release step.

## Open Questions

- `status.json` still carries a `code_review` escalation (iteration_count 0, auto_block_count 1). It says `tests/run-task-prompts.golden.json` is outside Affected Files. The spec's Affected Files table does list that file (spec.md line 68), so the escalation looks stale. QA did not clear it; the human should confirm and clear it before `--pr`.
- `handoff.md`'s baseline sections (Deviations, AC Coverage, Blockers, and the unchecked "All spec ACs met" box) still show AC-1 to AC-3 as Partial. The Iteration 2 section supersedes them. Code review noted this as a nit.
- The sandbox-skipped test in `npm test` is still unidentified (see Test Results).

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 3
- Validation gaps: 0
- Notes: AC-1 to AC-3 first landed as helper-only tests; code review caught it and the implement revision added main-loop tests plus a red-first run.
