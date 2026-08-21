# Done: relax-reroute-gate-post-implement

## Summary

`--reroute` used to work in exactly two situations: every named task sitting at `human_review`, or every named task blocked at `code_review` with a `spec_gap` verdict. Everything else — most notably a task auto-blocked at `code_review` after too many review rounds, or a task waiting on `qa` — had no sanctioned way to reroute at all; the only workarounds were hand-editing `status.json` or misusing `canon task accept`. This task widens the gate to admit `--reroute` from **any** phase that implies a completed `implement` round: `code_review`, `qa`, or `human_review`, in any status/verdict combination, for single tasks and mixed-phase bundles alike. Nothing about *what happens after* admission changes — the Amendment pre-flight, the spec-gap sibling exemption, and the reset loop are all untouched — so the only behavioral change is which starting states are allowed in. Every operator-facing and agent-facing surface that stated the old two-case rule (CLI help x2, README x2, the pipeline doc, the pipeline skill) now states the new rule, and every reroute prompt that used to claim "a human reviewed/ran/tried the prior implementation" now makes the weaker, always-true claim that a human decided to reroute and wrote an amendment after a completed implementation round — because after the widening, that claim is false in three of the five newly-admitted states.

## Files Changed

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Replaced the `allAtHumanReview \|\| isSpecGapReroute` admission check with a membership test over `{code_review, qa, human_review}` on the derived current phase; added per-task entry-phase banner labels and reworded the fail-closed rejection. |
| `src/cli/index.ts`, `src/orchestrator/cli.ts` | Both independently-authored `--reroute` help blocks updated to the new admission rule. |
| `src/orchestrator/context.ts` | Made the implement reroute state header phase-neutral; kept the human actor and reroute round. |
| `src/orchestrator/prompts/index.ts` | Reframed implement-reroute banners/preamble around a human-authored post-implement amendment; removed `humanReviewRound`. |
| `src/orchestrator/prompts/templates/implement-reroute.md`, `plan-reroute.md`, `spec-review-reroute.md` | Replaced the human-review-origin claim with a human-authored-amendment opener in each template. |
| `docs/pipeline-orchestrator.md` (+ `templates/` mirror) | Documented the widened admission rule, the unchanged spec-gap exemption, the new human-decision-required guardrail sentence, and the pre-QA uncommitted-artifact risk. |
| `.claude/skills/canon-pipeline/SKILL.md` (+ `templates/` mirror) | Renamed the reroute section heading, documented the widened rule and the human-decision guardrail. |
| `README.md` | Updated both `--reroute` descriptions. |
| `tests/run-task-reroute-preflight.test.ts` | Added admitted/rejected state matrices, mixed-phase normalization, exemption-unchanged and spec-gap-still-guarded coverage, `--force` coverage, and state-varying banner assertions. |
| `tests/run-task-prompts.test.ts` | Re-pointed the round-2 strong-anchor assertions at the new reroute-round phrasing. |
| `tests/run-task-prompts.golden.json` | Regenerated exactly the six reroute prompt entries; both QA entries stayed byte-identical. |
| `dist/orchestrator/run-task.js`, `dist/cli/index.js` | Rebuilt from the changed sources. |
| `docs/patterns.md` | **QA fix**: corrected a sentence the widening made false (see Decisions Made). No `templates/` mirror — canon-ai-internal doc. |

## How to Test

1. Take a task whose code review finished but whose QA has not started (or one auto-blocked at code review after too many review rounds). Write a new amendment section into its spec, then reroute it.
   - Expected: accepted — no complaint about phase — and the run reports it's resuming from the amended spec, naming the actual phase it came from (not "human review").
2. Ask for the CLI help two ways: the general `canon --help` and `canon run --help`.
   - Expected: both describe the identical widened rule; neither says reroute only works after human review.
3. Bundle a task waiting on `qa` with a task waiting on `human_review`, amend both, reroute the pair.
   - Expected: accepted; the banner names both entry phases; afterward both tasks land at the same pipeline point.
4. Repeat the existing spec-gap recovery flow (one task blocked at code review with a spec-gap verdict, a sibling approved) — amend only the gap task.
   - Expected: unchanged from today — accepted, sibling rides along unamended.
5. Try to reroute a task still mid-implementation, or one already fully accepted/closed.
   - Expected: refused both times, listing each task's current phase.
6. Reroute at a newly-allowed point without writing an amendment.
   - Expected: refused, pointed at adding an amendment or using `--force`; `--force` proceeds with a warning and grants no exemption.
7. Read `docs/pipeline-orchestrator.md` §"Human Reroute" and the `canon-pipeline` skill's reroute section.
   - Expected: both state plainly that deciding to reroute is a human call, not something an agent (including under `--full-send`) infers on its own.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-run independently by code review. |
| `npm run type-check` | Pass | Re-run independently by code review. |
| `npm test` | Pass | 1167/1167, 0 failed, 0 skipped — re-run independently by code review. |
| `npm run build` | Pass | Both tracked bundles reproduce byte-identically from a fresh build. |
| `npm run sync-templates:check` | Pass | Both managed mirrors in sync. |
| `npm run docs-refs-check` | Pass | All root and adopter-scaffold references pass. |
| Focused reroute-preflight suite | Pass | 42/42, independently re-run; 12 of the 42 fail against `main`'s source, confirming the tests exercise the fix. |
| Focused prompt suite | Pass | 35/35, independently re-run. |
| Golden scope audit | Pass | Exactly 6 of 16 entries changed; both QA entries byte-identical to `main`. |
| `git diff --check` | Pass | No whitespace errors. |
| 3-lens code review | Approved with nits | Anchored + cold-Claude + cold-Codex; all 13 ACs pass on independent verification; 0 correctness bugs; nits below. |

## Human Verification Required

None. All Validation Outcomes in `handoff.md` (and their code-review re-verification) are `Pass`; no `human_pending` rows exist.

**Handoff Validation pre-merge checklist:**
- [x] Version correct — unversioned change until release step; no version bump proposed at QA (per project policy).
- [x] Changelog updated if needed — draft entry below; human finalizes at `/canon-changelog`.
- [x] PR body current — see `pr-body.md`.
- [x] Final CI/CD checks green — all validation checks above pass.
- [x] Final diff matches spec intent — code review confirms all 13 ACs met; `docs/patterns.md` fix applied at QA per the review's explicit recommendation (see below).

## Decisions Made

- **Fixed `docs/patterns.md:134` at QA, as the code review and the spec's own Docs Impact section both directed.** The line "`--reroute` and `--pr` start from committed post-QA state" became false the moment `code_review`/`qa`-pending reroute was admitted; code review flagged it (finding N-1) as a pre-existing sentence this change falsifies, correctly out of implement's scope (it's not in Affected Files) but with the spec's Docs Impact section naming QA as the place to fix it. Reworded to say `--pr` still starts from committed state while `--reroute` no longer necessarily does, with a pointer to the new §"Human Reroute" doc.
- **The three pre-existing defects code review surfaced in Non-Goal'd files (S-1, S-2, S-3) are left as-is, per the review's own recommendation** — each is real, each predates this task, and each needs its own design rather than a QA-time patch:
  - S-1: a reroute-reset task can wedge `code_review` on a stale trailing `## Round N` verdict in a multi-round `review.md`, since reroute doesn't touch that file. Pre-existing for any `human_review`-origin reroute; this task's widening makes it more reachable because loop-cap auto-block guarantees a multi-round file.
  - S-2: `--full-send` tasks land at `complete` (human_review force-marked `done`) and so can never be rerouted, even though that flow has the least prior human review and the most plausible need for it.
  - S-3: `checkRerouteEvidence()`'s stale-artifact guard covers `spec_review`/`plan` resets but not `code_review`/`qa`, which are newly-supported reroute-reset targets.
- **No other changes made beyond the `docs/patterns.md` fix.** The remaining Stage-2 findings (N-2 through N-18) are nits or recorded audit notes the review verdict explicitly ships as-is ("Approved with nits — ship after addressing optional items (or not)").

## Open Questions

- Should S-1, S-2, and S-3 (above) be filed as follow-up tasks now, or left for whoever next touches reroute/`code_review` evidence gating to discover? None of the three blocks this task; flagging for the human's call on whether to file immediately.
- N-2 (code review) notes `guardConcurrentRun()` is now load-bearing for `--reroute` in a way it wasn't before (admitting `code_review in_progress` / `qa in_progress` means a dead-orchestrator race is now a live concern, not just a theoretical one). No action taken — recorded as an audit note per the review, not a defect — but worth keeping in mind if a future task touches that guard.

## Proposed Changelog

### Changed

- **`--reroute` now admits any phase reached after a completed `implement` round — `code_review`, `qa`, or `human_review` — not just `human_review` or a `code_review` block carrying a `spec_gap` verdict.** The old gate had no sanctioned path for the two most common real cases: a task auto-blocked at `code_review` after too many review rounds, or one simply waiting on `qa` when new information arrives. Both now reroute the same way `human_review` always did — write an `## Amendment` section into the spec and reroute; `--force` still bypasses that check with a warning. Nothing about what happens *after* admission changes: the amendment requirement, the existing spec-gap sibling exemption, and the phase reset are unchanged. The pre-reset banner now names each task's actual entry phase instead of a hard-coded `human_review`/`spec_gap` label, and the reroute prompts no longer claim a human reviewed, ran, or tried the prior implementation — since that's no longer necessarily true — while still naming a human as the one who decided to reroute and wrote the amendment. Both `--help` surfaces, the README, the pipeline reference doc, and the `canon-pipeline` skill are updated to state the new rule, and the reference doc and skill each now say plainly that deciding to reroute is a human call an agent driving canon must not make on its own.

## Quality Log
- Spec verdict: approved (converged after 4 rounds of scope-narrowing findings, all accepted; see spec.md's round-1 through round-4 subsections)
- Human reroute?: No
- Dropped ACs: 0 — all 13 ACs pass on independent code-review verification
- Validation gaps: 0 — every check the spec required ran and passed, independently re-verified by the anchored review lens
- Notes: Widened --reroute admission to code_review/qa/human_review; code review approved with nits (no bugs); fixed a docs/patterns.md sentence the change falsified (N-1) at QA per spec's own Docs Impact designation; three pre-existing defects in Non-Goal'd files (S-1/S-2/S-3) surfaced by cold-Codex lens, left for follow-up tasks.
