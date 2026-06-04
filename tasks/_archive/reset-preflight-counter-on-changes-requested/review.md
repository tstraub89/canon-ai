# Code Review: reset-preflight-counter-on-changes-requested

> Reviewer: Claude | Spec: `tasks/reset-preflight-counter-on-changes-requested/spec.md`

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (`npm run lint`, `npm run type-check`, `npm test`, `npm run build`)
- [x] No required checks were skipped

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: pre-flight → real `changes_requested` resets streak counter, real iteration counts | Met | `src/task/index.ts:380` resets `preflight_rejections_current_loop` in the `changes_requested`/`needs_re_review` branch. Existing test at `tests/run-task-counter-schema.test.ts:208` now asserts `preflight_rejections_current_loop === 0` and `iterations_current_loop === 1`. |
| AC-2: same reset for `needs_re_review` | Met | New sibling test at `tests/run-task-counter-schema.test.ts:239` asserts the reset after `taskPhasePreflightRejected` → `needs_re_review`. Branch placement (shared with `changes_requested`) makes both verdicts share the same code path. |
| AC-3: existing `approved` / `approved_with_nits` reset preserved | Met | Untouched in the diff — the `approved` branch at `src/task/index.ts:381-388` retains its existing reset; existing test at `tests/run-task-counter-schema.test.ts:157` is not modified. |
| AC-4: monotonic totals not reset | Met | The AC-1 test now asserts `iterations_total === 1`, `changes_requested_total === 2`, `preflight_rejections_total === 1`. Implementation only mutates the loop-local field, not the `_total` fields. |
| AC-5: pure pre-flight streak unaffected | Met | Existing test at `tests/run-task-counter-schema.test.ts:133` (three consecutive pre-flight rejections → `preflight_rejections_current_loop === 3`) is unchanged. The new reset only fires from `updateReviewCounters`, which `taskPhasePreflightRejected` does not call — safeguard holds. |
| AC-6: prompt routing — review-findings when counter=0, pre-flight when ≥1 | Met | Two new tests at `tests/run-task-prompts.test.ts:337` and `:356` assert the rendered text contains "addressing code review round N" (review-findings) or "addressing pre-flight handoff rejection" (pre-flight) per counter state. |

### Dropped Sections Check

- [x] Non-goals respected — `taskPhasePreflightRejected` untouched; no change to auto-block gate, `promptImplementRevisions`, or the `## Stage 1` detector mismatch (correctly deferred).
- [x] Known Risks addressed — `dist/` deltas committed (`dist/cli/index.js`, `dist/scripts/run-task.js`); both verdicts covered (AC-2 locks in `needs_re_review`); reset confined to `updateReviewCounters` so pre-flight rejection path doesn't accidentally clear (AC-5).
- [x] Human Test Plan satisfiable — orchestrator-only fix; unit suite covers the regression shape.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality

### Summary

Clean, minimal, exactly to spec. Codex chose the "mirror into branches" option (vs. hoist-above) and added a one-sentence comment explaining why. The doc comment on `PhaseEntry.preflight_rejections_current_loop` was updated to reflect the new behavior. Build artifacts (`dist/cli/index.js`, `dist/scripts/run-task.js`) regenerated and committed. Tests cover the three scenarios the spec calls out (changes_requested reset, needs_re_review reset, prompt routing branches). No deviations from plan.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

(none)

## Final Verdict

- [x] **Approved** — ship as-is
