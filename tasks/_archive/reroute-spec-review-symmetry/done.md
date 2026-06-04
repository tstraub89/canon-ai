# QA Summary: reroute-spec-review-symmetry

> Full-tier reroute re-enters at spec_review + plan, not implement

## What Changed

Full-tier (`M`/`L`/`XL`/`delicate`) reroutes now mirror the review altitude the tier gave the original spec. Previously, `canon run --reroute` on any task reset only `implement`, `code_review`, `qa`, and `human_review` to pending, routing directly back to Codex implementation with no amendment review. For full-tier tasks, the amendment received *less* scrutiny than the original spec — despite targeting the same sensitive surfaces.

After this change:

- **Full-tier reroutes reset `spec_review` and `plan` in addition to `implement` onward.** The pipeline re-enters at `spec_review`, where Codex reviews the amendment plus its interaction with already-approved ACs. Then it advances to `plan` (appends a `## Reroute Plan [Round N]` section to the existing plan), then `implement`.
- **Amendment rejection (Option B).** If spec_review returns `changes_requested` during a reroute, the orchestrator stops, lists which `tasks/<id>/spec.md` and `tasks/<id>/spec-review.md` files to revise, and exits cleanly. The human revises the amendment conversationally and re-runs `canon run <id>` (not `--reroute`). The pipeline does not auto-iterate or re-arm the spec gate.
- **Approved amendments flow through** without re-arming `human_spec_gate`.
- **Fast-tier reroutes are unchanged** — still reset `implement` onward and re-enter at `implement`.
- **`--step --expect` for a full-tier reroute now expects `spec_review`** (was `implement`). Any operator script using `canon run --step --expect implement` after a full-tier `--reroute` will fail fast at the guard — this is the intended behavior.
- **Worktree cwd coupling fixed.** `runSpecReviewPhase()` and `runPlanPhase()` were computing `activeCwd` but passing it only to `metricsContext`, not as the subprocess cwd. On reroute, this meant Codex read the stale REPO_ROOT scaffold instead of the worktree's amended `spec.md`. Both phases now pass `activeCwd` as the subprocess cwd.
- **Session slot cleared on reroute.** The stored `codex_spec_review` session was created before the worktree existed (project context bound to REPO_ROOT). Resuming it on reroute would defeat the cwd fix and supply re-review framing instead of fresh amendment-review framing. `rerouteFromHumanReview()` now clears `sessions.codex_spec_review` on full-tier reroute so a fresh session opens in the worktree.
- **Retry path updated.** `retryAgentForPhase()` previously treated `spec_review` as REPO_ROOT-only; reroute spec_review now uses `getActiveCwd()` when `implement.rerouted === true`.
- **Stale comment corrected.** A comment at `main.ts` ~L1879 claimed `implement.rerouted` was "consumed and cleared in runPhase case 'implement'." It is not and never was. The comment now documents the never-cleared invariant and the four-reset-paths proof that makes dispatch correct without a clear.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Tier-aware reset in `rerouteFromHumanReview()`, Option B routing in `checkAndRoute()`, session slot clear, retry cwd fix, stale comment corrected |
| `scripts/run-task/phases/spec-review.ts` | Pass `activeCwd` as subprocess cwd to `runCodex()` |
| `scripts/run-task/phases/plan.ts` | Pass `activeCwd` as subprocess cwd to `runClaude()` |
| `scripts/run-task/prompts/index.ts` | Reroute-variant dispatch for `promptSpecReview()` and `promptPlan()`; new templates registered |
| `scripts/run-task/prompts/templates/spec-review-reroute.md` | New — amendment review prompt (reads spec.md + prior spec-review.md; no implementation audit) |
| `scripts/run-task/prompts/templates/plan-reroute.md` | New — append-only reroute plan prompt |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Add reroute plan read step with base-plan fallback for fast tier |
| `docs/pipeline-orchestrator.md` | §Human Reroute rewritten for full-tier re-entry, Option B, approval flow-through, fast-tier behavior, `--step --expect` change |
| `CLAUDE.md` | Reroute quick-refs updated: full-tier `--expect spec_review`, fast-tier optional conversational reroute plan |
| `templates/CLAUDE.md` | Auto-synced mirror |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced mirror (required by `sync-templates:check`) |
| `tests/run-task-reroute-preflight.test.ts` | Coverage for tier-gated reset, messaging, Option B bundle reset, approved flow-through, spec-review cwd/session, retry cwd |
| `tests/run-task-prompts.test.ts` | Dispatch + golden coverage for spec-review-reroute and plan-reroute; bundle round assertions |
| `tests/run-task-prompts.golden.json` | Regenerated for new and updated templates |
| `tests/run-task-safety.test.ts` | Updated full-send reroute assertion to new full-tier spec_review/plan/implement pending state |
| `dist/scripts/run-task.js` | Regenerated CLI bundle |

## How to Test

Follow the Human Test Plan from the spec:

1. **Full-tier reroute, approved amendment (happy path).** Take any M/L/XL or delicate task that has reached human review. Add an `## Amendment` section to its spec describing a small new requirement. Run `canon run <id> --reroute`. Expected: the pipeline announces it is returning to spec review (not implementation), an independent review of the amendment runs, and — once that review passes — it proceeds to update the plan and re-implement, finally landing back at human review with the amendment built. The original plan content is still present with a new "Reroute Plan" section appended below it.

2. **Full-tier reroute, rejected amendment (Option B).** Write an amendment that contradicts an already-approved requirement or asks for something unimplementable. Run the reroute. Expected: the pipeline stops and tells you the amendment review found problems, names the spec and review files to look at, and asks you to revise the amendment and re-run `canon run <id>` (not `--reroute`). After fixing the amendment and re-running, the amendment review passes and the pipeline continues.

3. **Fast-tier reroute unchanged.** Take an S, non-delicate task at human review, add an amendment, and reroute. Expected: it goes straight to re-implementation with no separate amendment-review step — behavior identical to before this change.

4. **Repeat reroute (round 2).** On a full-tier task already rerouted once, add an `## Amendment Round 2` section and reroute again. Expected: the amendment review and reroute plan both reference round 2, and the round-1 sections remain untouched in both files.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Exit 0 |
| `npm run type-check` | Pass | Exit 0 |
| `npm test` | Pass | 690 tests, 689 pass, 1 existing skip, 0 fail |
| `npm run build` | Pass | Deterministic two-build SHA-256 hash match across two fresh builds |
| `npm run docs-refs-check` | Pass | All refs OK |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync |
| E2E | deferred_by_spec | No UI surface — spec marks E2E N/A |

## Human Verification Required

None.

## Decisions Made

- **Option B (block-to-human) for amendment rejection, not automated amendment revision.** The amendment is human-authored conversational input; the human owns revising it. No pipeline-Claude amendment-revision template, no re-armed spec gate on reroute.
- **`implement.rerouted` is never cleared.** The dispatch invariant is proved from the four reset paths — adding a clear would write to delicate routing state without improving correctness. The stale comment claiming it was cleared has been corrected.
- **Whole-bundle spec_review reset on any rejection (Option B).** Mirrors `routeBackTo('spec')` symmetry; keeps `assertSamePhase()` satisfied on re-run. Cost: already-approved amendments in the same bundle get re-reviewed cheaply on the re-run. Accepted.
- **`codex_spec_review` session slot cleared on reroute, not retained.** The original session is REPO_ROOT-bound and carries re-review framing — both fight the worktree cwd switch and fresh amendment-review context. A fresh session is required.
- **`templates/docs/pipeline-orchestrator.md` not in spec Affected Files.** Included as a deviation because `sync-templates:check` CI gate requires it when the root doc changes. No AC impact.

## Open Questions

None.

## Proposed Changelog

### Proposed entry (target: v1.9.0, under Changed)

- **Full-tier `--reroute` now re-enters at `spec_review`, not `implement`.** When a human rejects a full-tier task (M/L/XL/delicate) at `human_review` and issues `--reroute`, the pipeline re-enters at Codex `spec_review` (amendment review), then `plan` (appends a `## Reroute Plan [Round N]` section to the existing plan), then `implement`. This restores symmetry with the original spec: the same review altitude the tier required on the first pass is now required on amendment. Fast-tier reroutes are unchanged and still re-enter at `implement`. **Operator change**: use `canon run <id> --step --expect spec_review` (was `--expect implement`) after a full-tier `--reroute`. If the amendment review returns `changes_requested`, the orchestrator stops and names the files to revise; re-run `canon run <id>` (not `--reroute`) after amending.

**Proposed version bump:** minor — new observable behavior and operator-visible `--step --expect` change for full-tier reroutes.
