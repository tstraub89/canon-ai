# QA Summary: reset-preflight-counter-on-changes-requested

## What Changed

The pipeline's internal "how many consecutive pre-flight rejections have happened since the last real review round" counter now resets correctly whenever a real reviewer round runs — even when that round returns "changes requested" rather than approving the code. Previously, the counter only reset on approval, so any pre-flight rejection earlier in the same review loop would stay recorded for the entire loop. The downstream effect was that Codex kept receiving the "fix your handoff formatting" prompt instead of the "address the reviewer's actual findings" prompt, causing it to churn on handoff formatting while real correctness bugs went untouched until the auto-block cap fired. This was the failure observed on the gallery_wall adopter task. The fix is a one-line change that aligns executable behavior with the intent the codebase's own comments already declared.

## Files Changed

- `src/task/index.ts` — reset `preflight_rejections_current_loop` in the `changes_requested` / `needs_re_review` branch of `updateReviewCounters`
- `scripts/run-task/types.ts` — updated the doc comment on `preflight_rejections_current_loop` to state it resets on any real review verdict
- `tests/run-task-counter-schema.test.ts` — extended the pre-flight → `changes_requested` test with the counter reset assertion; added a `needs_re_review` sibling test
- `tests/run-task-prompts.test.ts` — added focused branch-selection tests for the review-findings vs. pre-flight prompt routing
- `dist/cli/index.js` — regenerated bundle
- `dist/scripts/run-task.js` — regenerated bundle

## How to Test

1. Run the full unit suite: `npm test`. All new and extended tests directly cover the fixed behavior.
2. To verify end-to-end: trigger a `code_review` loop where a pre-flight rejection precedes a real `changes_requested` round. After the fix, the next re-implementation prompt directs Codex to read the latest `## Round N` section of `review.md` instead of re-litigating the handoff format.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 701 pass, 1 skip, 0 fail |
| `npm run build` | Pass — both `dist/` bundles regenerated and committed |

## Human Verification Required

None.

## Decisions Made

- **Reset placement**: the spec allowed either hoisting the reset above all verdict branches or mirroring the existing `approved`-branch line into the `changes_requested`/`needs_re_review` branch. Codex chose the mirror approach; both are equivalent given the exhaustive four-verdict test coverage.
- **Monotonic totals untouched**: only the loop-local streak counter resets; `preflight_rejections_total`, `changes_requested_total`, and `iterations_total` remain cumulative.
- **`spec_review` side effect**: the reset on `spec_review` verdicts is a harmless no-op (that phase has no pre-flight gate), matching the precedent already set by the existing `approved`-branch reset.

## Open Questions

None.

## Proposed Changelog

**Proposed version bump:** patch — pure behavioral bug fix with no new public API or user-visible feature.

```markdown
### Fixed

- **Pre-flight rejection counter resets after a real review round runs.** Previously, `preflight_rejections_current_loop` was cleared only on an `approved` / `approved_with_nits` verdict. A `changes_requested` or `needs_re_review` round left the counter ≥ 1, causing every subsequent re-implementation in that loop to receive the "fix your handoff" prompt instead of the reviewer's actual findings — Codex would keep re-confirming handoff formatting while correctness bugs went untouched until the auto-block cap fired. The counter now resets on any real review verdict, restoring the routing behavior the prompt comment already declared.
```
