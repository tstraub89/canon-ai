# QA Summary: bundle-preflight-atomic-rejection

## What Changed

When any task in a bundle fails handoff pre-flight validation, the whole bundle now moves atomically to the same terminal state. Previously, only the failing tasks were processed; clean siblings were left at `pending`, which caused the orchestrator to trigger phantom solo Claude review retries for them, diverged per-task loop counters, and left clean siblings with no `review.md` on the blocked-only route.

The fix preserves the existing two-route split and applies bundle atomicity within each route:

**Fixable route** (`format`/`regression` blocker — reroutes to implement): All bundle tasks now get `taskPhasePreflightRejected('code_review')` applied, landing every task at `status: done, verdict: changes_requested`. Clean siblings get a stub `review.md` pointing at the failing sibling(s). The bundle then reroutes to implement together via the existing `anyChangesRequested` path — no phantom solo retries, consistent counters across all tasks.

**Blocked-only route** (infrastructure unavailable — halts for human triage): All tasks are already auto-blocked via the existing `autoBlockPhase(taskIds, …)`. The only change here is that clean siblings now also receive a halt stub `review.md` — previously they were auto-blocked with no artifact at all, leaving an asymmetric audit trail.

Both stub types omit `## Stage 1` so `bundleHasRealPriorReview` correctly identifies them as not-a-real-review. When a clean sibling already has a prior real review (e.g., from `rerouteFromHumanReview`), the stub is appended under a non-`## Round` heading without a verdict checkbox, preserving the prior verdict for `extractCheckedVerdict` — a deliberate recovery affordance that mirrors the existing failing-task append pattern.

A new exported `writePreflightReviewArtifacts` function centralizes the artifact loop and provides a test seam exercised by the new test suite.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/phases/code-review.ts` | Refactored pre-flight rejection block to enumerate all `tasks` (not just `preflightFailed`); added `buildCleanTaskReviewStub` and exported `writePreflightReviewArtifacts`; broadened Route A `taskPhasePreflightRejected` calls to all bundle tasks |
| `tests/run-task-validation.test.ts` | Added bundle pre-flight regression tests: Route A 2-task, Route A 3-task, prior-review append, prior-approved parser divergence, Route B auto-block, all-pass no-op, single-task Route A/Route B |
| `dist/scripts/run-task.js` | Regenerated build artifact (`dist/cli/index.js` stayed byte-identical) |

## How to Test

1. **Fixable route (implement reroute)**: Create a 2-task bundle. Manually corrupt one task's `handoff.md` Validation Outcomes table so it has a fixable blocker — e.g., remove the required `lint` row or mark a check `Fail`. Run `canon run <task1> <task2>` past implement. Confirm both tasks land at `code_review.status: done, verdict: changes_requested` via `canon task status <task1>` and `canon task status <task2>`. Confirm both tasks have a `review.md`; the corrupted task's should show the validation-gate BLOCKED block, the clean task's should show the bundle-rejection stub pointing at the sibling. Confirm both reroute to implement on the next pipeline pass.

2. **Blocked-only route (auto-block halt)**: Repeat with one task's handoff having a `blocked` row (infrastructure unavailable, not a `Fail`). Confirm both tasks land at `code_review.status: blocked`. Confirm both have a `review.md` — the corrupted task's with the HALTED human-triage block, the clean task's with the Bundle Pre-Flight Halt stub and no "Changes requested" checkbox. Confirm the bundle does NOT reroute to implement.

3. **Regression — single-task path**: Corrupt a single task's handoff (no bundle siblings). Confirm behavior matches the prior release — only that task gets the BLOCKED `review.md`, on whichever route its blocker class selects.

## Test Results

| Check | Result | Notes |
|---|---|---|
| Linting (`npm run lint`) | Pass | |
| Type checking (`npm run type-check`) | Pass | |
| Unit tests (`npm test`) | Pass | 764 tests: 763 pass, 1 skipped |
| Full build (`npm run build`) | Pass | `dist/scripts/run-task.js` regenerated; `dist/cli/index.js` byte-identical |
| Docs references (`npm run docs-refs-check`) | Fail – unrelated | Pre-existing broken refs in `docs/decisions.md` lines 242–244 to archived `tasks/codex-code-review-phase/` files; outside this task's Affected Files |
| Canon-managed template sync (`npm run sync-templates:check`) | Pass | |

## Human Verification Required

None.

## Decisions Made

- **Counter bump on clean tasks (Route A)**: `preflight_rejections_current_loop` is incremented for clean siblings, not just failing ones. A clean task in a bundle that gets pre-flight rejected did have a code-review attempt — blocked by a sibling's handoff. This is accepted; the `taskPhasePreflightRejected` docstring should note the bundle case in a follow-up.
- **Intentional artifact↔status divergence on append-over-approved**: A clean task that already has a prior `- [x] **Approved**` `review.md` will, after a pre-flight rejection, have `status.json` record `changes_requested` while `extractCheckedVerdict(review.md)` still returns `approved` (the appended stub uses a non-`## Round` heading and carries no verdict checkbox). This mirrors the existing failing-task BLOCKED-block append and is a deliberate recovery affordance: the operator can recover via `canon task phase code_review done <prior-verdict>` once the sibling is fixed, without forcing a re-run of a passing review. AC-14's prior-approved test case pins this behavior.
- **Route B clean-task stub carries no verdict checkbox**: Consistent with the failing-task auto-block block. Prevents a stale `changes_requested` from misleading recovery routing.
- **`dist/cli/index.js` unchanged**: Build produced an identical CLI bundle despite `code-review.ts` being in the import chain. Documented as a handoff deviation.

## Open Questions

- Whether to add a sentence to `docs/pipeline-orchestrator.md` noting that `preflight_rejections_current_loop` for a "clean" bundle task includes bumps the task itself didn't cause. Low urgency; the Known Risks section of the spec documents the convention.

## Proposed Changelog

**Audience**: canon-ai contributors and adopters watching what changes between installed versions.

**Proposed entry** (add to `## [1.10.0] — unreleased` → `### Fixed`):

> **Pre-flight rejection in bundle mode is now all-or-nothing.** When any task in a bundle fails handoff pre-flight, all sibling tasks now receive the same outcome. On the fixable route (`format`/`regression` blocker), all tasks get `changes_requested` and the bundle reroutes to implement together — ending phantom solo Claude retries for clean siblings and divergent per-task counters. On the blocked-only route (infrastructure unavailable), all tasks receive a halt stub `review.md`; previously clean siblings were auto-blocked with no artifact and an incomplete audit trail.

**Proposed version bump**: No bump needed — this is a bug-fix addition to the unreleased `1.10.0` block already in progress. If `1.10.0` were already released, this would be a **patch** bump (bug fix only, no schema change, no new user-visible capability beyond fixing incorrect behavior).
