# Spec: reset-preflight-counter-on-changes-requested — Reset pre-flight rejection counter when a real review round runs

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

`preflight_rejections_current_loop` is the per-loop counter for "consecutive pre-flight handoff rejections since the last real review round." It feeds two consumers:

1. **Prompt routing** — `promptImplementRevisions` ([scripts/run-task/prompts/index.ts:284-285](scripts/run-task/prompts/index.ts)) computes `hasPreflightFindings = maxPreflightRejections > 0`, and `hasReviewFindings = maxCodeReviewIter > 0 && !hasPreflightFindings`. A non-zero pre-flight counter forces `hasReviewFindings` to `false`, so Codex is served the **pre-flight** revision prompt ("input-validation failure, *not* a code-quality finding — fix the handoff; that is the entire scope of this iteration") instead of the **review-findings** prompt that points at Claude's `review.md` round.
2. **Auto-block gate** — `runCodeReviewPhase` ([scripts/run-task/phases/code-review.ts:34-45](scripts/run-task/phases/code-review.ts)) blocks when `iterations_current_loop + preflight_rejections_current_loop >= cap`.

The counter is reset to `0` in exactly one place — `updateReviewCounters` ([src/task/index.ts:378-384](src/task/index.ts)) — and **only in the `approved` / `approved_with_nits` branch**. The `changes_requested` / `needs_re_review` branch bumps `iterations_current_loop` but leaves the pre-flight counter untouched.

**Consequence (observed live on a gallery_wall adopter task):** once any pre-flight rejection occurs in a `code_review` loop, the counter stays ≥1 for the rest of the loop because real review rounds keep returning `changes_requested` (never `approved`). Every subsequent re-implement is therefore served the pre-flight prompt, so Codex re-touches the handoff and **never addresses Claude's actual review findings**. On that task, Codex wrote three handoff iterations all titled "addressing pre-flight handoff rejection" — re-confirming a validation row that was already present — while a real `correctness bug` flagged in review round 1 went untouched, until the combined counter hit the cap and auto-blocked. The failure is silent: it is invisible from `status.json` alone and only surfaces by reading `handoff.md`.

This is a **declared-vs-executable drift** (see `docs/decisions.md` → "Declared Canon vs Executable Canon"). The code comment at [prompts/index.ts:275-283](scripts/run-task/prompts/index.ts) explicitly declares the intended behavior — *"address the pre-flight now, get back into a state where the real review can run, then any unresolved prior findings will surface in the next real review round naturally"* — but the code never delivers it, because the counter that gates the prompt is never cleared once a real review round runs with a non-approving verdict.

## Decision

A real review round only runs after the handoff has cleared the pre-flight gate. Therefore **any real review verdict — not just an approving one — ends the pre-flight streak.** Reset `preflight_rejections_current_loop` to `0` whenever `updateReviewCounters` records a `code_review` verdict of `changes_requested` or `needs_re_review`, in addition to the existing reset on `approved` / `approved_with_nits`.

After this change, the sequence *pre-flight rejection → real `changes_requested` round → re-implement* leaves the pre-flight counter at `0`, so `promptImplementRevisions` selects the review-findings branch and points Codex at the latest `## Round N` section of `review.md` — restoring the behavior the prompt comment already claims.

The monotonic totals (`preflight_rejections_total`, `changes_requested_total`, `iterations_total`) are unaffected — only the per-loop streak counter clears. The auto-block safeguard against infinite pre-flight bouncing is preserved: the reset fires only when a *real review verdict* is recorded, never on a pre-flight rejection itself, so a pure pre-flight loop (handoff repeatedly rejected, no real review ever running) still accumulates the counter and still trips the cap.

## Non-Goals

- **The `## Stage 1` / `### Stage 1` detector mismatch** in `hasPriorRealReview` ([code-review.ts:118-119](scripts/run-task/phases/code-review.ts)) and `bundleHasRealPriorReview` ([prompts/index.ts:342-357](scripts/run-task/prompts/index.ts)) — both match `/^## Stage 1\b/m` but filled review rounds may use `### Stage 1` nested under `## Round N`. Real but separate; filed to `docs/BACKLOG.md` for its own task.
- **Changing the auto-block cap or its combined-counting formula.** The cap stays exactly as-is; this task only changes *when the pre-flight component resets*.
- **No migration or backfill for in-flight tasks.** The fix is go-forward only. Tasks already stuck on this bug are recovered manually (set `preflight_rejections_current_loop = 0`).
- **No changes to `promptImplementRevisions`, `shouldUseImplementRevision`, or the auto-block gate.** They read the counter correctly; the counter was simply stale.
- **No change to `taskPhasePreflightRejected`.** Pre-flight rejection accounting is correct and must stay untouched.

## Acceptance Criteria

- [ ] AC-1: After `taskPhasePreflightRejected(id, 'code_review')` followed by a real `code_review` verdict of `changes_requested` (via `taskPhase`), `preflight_rejections_current_loop === 0` and `iterations_current_loop === 1`. Verified by extending the existing test `'taskPhasePreflightRejected followed by a real changes_requested round counts only the real round'` in `tests/run-task-counter-schema.test.ts` with the missing pre-flight-counter assertion.
- [ ] AC-2: The same reset occurs for a `needs_re_review` verdict. Verified by a sibling unit test asserting `preflight_rejections_current_loop === 0` after a pre-flight rejection followed by a `needs_re_review` round.
- [ ] AC-3: The existing `approved` / `approved_with_nits` reset is preserved — the test `'approved real review resets preflight_rejections_current_loop alongside iterations'` continues to pass unchanged.
- [ ] AC-4: Monotonic totals are not reset by this change. In the AC-1 scenario, `preflight_rejections_total === 1`, `changes_requested_total === 2`, and `iterations_total === 1` (the pre-flight rejection and the real round each counted once in their respective totals).
- [ ] AC-5: A pure pre-flight streak is unaffected — the safeguard holds. The existing test `'taskPhasePreflightRejected bumps preflight_rejections counters for auto-block visibility'` (three consecutive rejections → `preflight_rejections_current_loop === 3`) continues to pass unchanged, confirming the reset does not fire on a pre-flight rejection.
- [ ] AC-6: End-to-end routing consequence. Given a `code_review` phase state with `preflight_rejections_current_loop === 0` and `iterations_current_loop >= 1`, `promptImplementRevisions` renders the **review-findings** instructions (directs Codex to read the latest `## Round N` section of `review.md`) and not the pre-flight instructions; given `preflight_rejections_current_loop >= 1`, it renders the **pre-flight** instructions. Verified by a focused unit test in `tests/run-task-prompts.test.ts` asserting the selected branch from the rendered prompt text (the prompt-routing branch currently has no direct test).

## Design

> Mechanics deferred to plan/implement: the exact placement of the reset (hoist it ahead of the verdict branches so it fires on any real verdict, vs. mirror the existing `approved`-branch line into the `changes_requested` / `needs_re_review` branch). Either satisfies the contract. Constraint: do not introduce a spurious reset path that changes `spec_review` or `taskPhasePreflightRejected` behavior beyond what the existing `approved` branch already does.

### Affected Files

> Build-generated artifacts are listed alongside their source per CLAUDE.md and the `--pr` base-drift gate: a change to `src/**` regenerates the bundled `dist/` and an undeclared `dist/` delta fails the gate.

| File | Change |
|---|---|
| `src/task/index.ts` | In `updateReviewCounters`, also reset `preflight_rejections_current_loop = 0` when the verdict is `changes_requested` or `needs_re_review` (currently only the `approved` / `approved_with_nits` branch resets it). |
| `scripts/run-task/types.ts` | Update the `PhaseEntry.preflight_rejections_current_loop` doc comment (currently "Reset to 0 when a real reviewer round returns approved / approved_with_nits") to state the field resets when **any** real review verdict ends the pre-flight streak. Comment-only; type-only file → no `dist/` impact. (Codex spec-review nit.) |
| `tests/run-task-counter-schema.test.ts` | Extend the `'...followed by a real changes_requested round...'` test with the `preflight_rejections_current_loop === 0` assertion (AC-1, AC-4); add a `needs_re_review` sibling test (AC-2). AC-3 and AC-5 are existing tests that must continue to pass. |
| `tests/run-task-prompts.test.ts` | Add a focused test asserting `promptImplementRevisions` selects the review-findings branch when `preflight_rejections_current_loop === 0 && iterations_current_loop >= 1`, and the pre-flight branch when `preflight_rejections_current_loop >= 1` (AC-6). |
| `dist/cli/index.js` | Regenerated by `npm run build` (bundles `src/task/index.ts`). Commit the delta. |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` (bundles `src/task/index.ts`). Commit the delta. |

### Interaction Dependencies

- `promptImplementRevisions` and `shouldUseImplementRevision` — downstream readers of the counter; behavior changes only via the corrected counter value, no code change in them.
- The auto-block gate in `code-review.ts` — reads `iterations_current_loop + preflight_rejections_current_loop`. After the fix, a real review round zeroes the pre-flight component, so combined attempts past that point are counted by `iterations_current_loop` alone. This is the intended semantic and does not weaken the cap (pure pre-flight loops still climb the pre-flight counter; mixed loops climb the iteration counter).

### Data Model Changes

None. No new fields; no schema change. The same `preflight_rejections_current_loop` field is written under one additional condition.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — required: `src/task/index.ts` is bundled into `dist/`; CI runs `npm run build && git diff --exit-code -- dist/` and fails on a stale `dist/`. Commit regenerated `dist/cli/index.js` and `dist/scripts/run-task.js`.

## Docs Impact

None. The fix aligns executable behavior with intent already declared in code comments and `docs/decisions.md` ("Declared Canon vs Executable Canon"). No protected doc restates the buggy behavior, so none needs updating.

## Known Risks

- **`dist/` drift / base-drift gate.** `src/task/index.ts` bundles into both `dist/cli/index.js` and `dist/scripts/run-task.js`. If `npm run build` is skipped or the `dist/` deltas are not committed, CI's `git diff --exit-code -- dist/` fails and the `--pr` base-drift gate rejects the undeclared artifact. Both `dist/` paths are declared in Affected Files; run the build and commit the deltas as part of implement.
- **Verdict coverage gap.** Four real verdicts exist (`approved`, `approved_with_nits`, `changes_requested`, `needs_re_review`). `needs_re_review` shares the bump branch with `changes_requested` and is easy to overlook — AC-2 exists specifically to lock it in. A hoist-above-the-branches implementation covers all four for free.
- **Over-resetting would break the auto-block safeguard.** If the reset were placed so it also fired on a pre-flight rejection (i.e., inside or before `taskPhasePreflightRejected`), a pure pre-flight loop would never accumulate and never trip the cap — Codex would bounce implement→pre-flight→implement forever. The reset must fire only on a real review verdict recorded through `updateReviewCounters`. AC-5 guards against this.
- **`spec_review` side effect.** `updateReviewCounters` also runs for `spec_review` verdicts. The existing `approved` branch already resets `preflight_rejections_current_loop` on `spec_review` (a harmless no-op, since spec review has no pre-flight gate). The new reset must not introduce behavior on `spec_review` beyond that existing harmless write — i.e., do not make the reset conditional on phase in a way that diverges from the current `approved`-branch precedent.

## Human Test Plan

This is an internal orchestrator fix with no user-facing surface; the behavior is exercised by the unit suite. To confirm end-to-end against the original failure shape:

1. Take a task that has had a real review round return "changes requested," then a handoff that gets rejected by the pre-flight gate for a formatting issue (e.g., a missing validation row), then fixes only that formatting issue.
2. Before this fix: the next re-implementation is told to fix only the handoff and ignores the outstanding review feedback, so the same review finding keeps recurring until the pipeline auto-blocks.
3. Expected after this fix: once a real review round has run, the next re-implementation is pointed at the reviewer's findings and addresses the actual code feedback — the pipeline does not get stuck re-litigating the handoff format.
4. Run the full unit suite and confirm it passes, including the new pre-flight-counter assertions and the unchanged approved-reset and pure-streak tests.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
