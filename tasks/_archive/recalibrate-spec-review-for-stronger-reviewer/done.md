# Completion Summary: recalibrate-spec-review-for-stronger-reviewer — Recalibrate spec_review prompt for the 5.6-generation reviewer

> For the human. This is what you need to know.

## What Changed

Canon's Codex `spec_review` prompt was written to push a reviewer that needed prodding to find fault, and under the newer, more literal 5.6-generation reviewer that framing was backfiring — three tasks in one week burned 6–7 spec_review rounds each on manufactured "blocking" findings against specs that were already sound, including one attack on behavior a spec had explicitly excluded and verified unaffected. This task recalibrates the prompt with four edits: it now says a clean spec with no blocking findings is a valid outcome (not a review failure); the "silence is the default" principle now covers the whole review, not just the initial shape check; a new scope boundary lets the reviewer set aside genuinely out-of-scope, already-verified-unaffected behavior as a minor note at most, while still treating a missing required change as a serious finding; and a worked example clarifies that an obviously-implied detail (like a field name) is a minor planning note, not a blocker. What counts as blocking, and the evidence bar for bug/flake fixes, are unchanged. The golden test fixture and the shipped orchestrator bundle were both regenerated so the recalibrated wording is what actually ships, and the decision log gained an entry noting that a review guardrail's strictness is implicitly tied to the model behind it — so it should be revisited whenever canon bumps to a new model generation.

## Files Changed

- `scripts/run-task/prompts/templates/spec-review.md` — the four behavioral edits: outcome-first objective, whole-review silence default, scope boundary with an omitted-dependency carve-out, and a Blocking-vs-nit worked example; plus a **post-QA inline follow-up** reconciling the full-send block with the recalibrated base (see Post-QA follow-up below).
- `tests/run-task-prompts.golden.json` — regenerated test fixture; only the `promptSpecReview` entry changed.
- `dist/scripts/run-task.js` — rebuilt shipped bundle carrying the recalibrated prompt; `dist/cli/index.js` is unaffected.
- `docs/decisions.md` — new dated entry recording the model-strength-calibration insight, citing this task as the trigger.

## How to Test

1. Open `scripts/run-task/prompts/templates/spec-review.md` and read it as if you were the Codex spec reviewer.
2. Expected: it tells you to surface genuine blocking problems but makes clear a clean spec — nothing blocking — is a perfectly good result, not a sign you didn't look hard enough.
3. Expected: it tells you to stay on what the task actually changes and leave genuinely out-of-scope, unaffected behavior alone (at most a minor note), while still treating a *missing* required change as a serious finding, not a minor one.
4. Expected: it gives a worked example that an obviously-implied detail (like a field name) is a minor planning note, not a blocker.
5. Expected: `docs/decisions.md` now has an entry explaining that a review guardrail's strictness is tied to the model behind it and should be revisited when the model generation changes.
6. The real-world test is the next task that runs `spec_review` under the 5.6-generation Codex (`default-codex-models-to-5-6-generation` is first) — watch whether it converges faster without missing a genuine blocker.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests (1,027 total, 1 expected environment skip) | Pass |
| Build (dist bundle rebuilt, only declared artifact changed) | Pass |
| Docs references check | Pass |
| Canon-managed template sync check | Pass |
| Diff hygiene | Pass |

Code review: three independent lenses (anchored Claude, cold Claude, cold Codex) converged on **approved with nits** — no correctness bugs, no blocking spec gaps. Two non-blocking nits were left as-is by design: the full-send variant of the prompt still uses a "raise the bar" framing (deliberately out of this task's scope), and the new example's bullet indentation is cosmetic.

## Human Verification Required

None. The handoff's Validation Outcomes table has no `human_pending` rows — every check is `Pass`.

**Handoff Validation pre-merge checklist:**
- [x] Version correct — this is a pre-release change; version bump happens at the changelog/release step.
- [ ] Changelog updated — proposed below; final wording and version are decided at the release step.
- [x] PR body current — drafted in `pr-body.md`.
- [ ] Final CI/CD checks green — confirm on the opened PR before merge.
- [x] Final diff matches spec intent — all 8 ACs verified met by Codex's handoff and independently re-verified by the 3-lens code review.

## Proposed Changelog

- **The `spec_review` prompt now asks the Codex reviewer for precision, not just recall.** Under the newer, more literal 5.6-generation reviewer, the prior "push to find fault" framing was manufacturing blocking findings on specs that were already sound — including flagging pre-existing behavior a spec had explicitly excluded and verified unaffected. The reviewer's objective now states plainly that a spec with no blocking findings is a valid, expected result; "silence is the default" now covers the whole review, not just the initial shape check; and a new scope boundary lets it set aside genuinely out-of-scope, unaffected behavior as a minor note at most, while still treating a missing required change as a serious finding. What counts as blocking, and the evidence bar for bug/flake fixes, are unchanged. Ships to adopters via `canon upgrade`.

## Decisions Made

- **Operator override at `spec_review` (sanctioned).** Round 2 of this task's own spec review demanded an executed prompt A/B precision/recall eval before approving. The operator accepted via `canon task accept` instead: the round-1 blocker (a scope-boundary wording that could have downgraded omitted-required dependencies) was already fixed and confirmed resolved by round 2, and the remaining ask was disproportionate — a statistically meaningful eval of a prose-calibration change on a stochastic reviewer is itself the over-mechanization this task exists to correct. The empirical guard instead is a live dogfood observation: `default-codex-models-to-5-6-generation` is the first task to run `spec_review` under the recalibrated prompt.
- **Scope-boundary carve-out worded narrowly.** The new scope boundary only downgrades behavior a spec both *explicitly excludes* and *verifies as unaffected* — not merely "untouched code the reviewer happens to reach." That distinction is the exact failure mode that caused one of the three source over-firing incidents.
- **The reroute variant of the prompt (`spec-review-reroute.md`) was left untouched.** The over-firing evidence is entirely from the normal spec_review changes_requested loop; the reroute template serves a different, post-human-review amendment flow and was out of scope by spec design.

## Open Questions

- Whether `spec_review` should route to a higher-precision Codex tier is explicitly deferred — tracked separately as a model-routing question, not part of this task.
- The full-send variant's "raise the bar" framing — flagged by code review as the same pattern this task's new decision entry says to re-check — was reconciled in a **post-QA inline follow-up** (see below) rather than deferred; the higher-scrutiny intent for the no-human-spec regime is preserved, but redirected from volume to attention and bound to the silence default.

## Post-QA follow-up

After QA, the full-send block of `spec-review.md` was reconciled inline with the recalibrated base — the "raise the bar / thoroughness higher" wording became "what full-send changes is *where you look*, not how much you flag," now explicitly bound to the silence default, scope boundary, and verdict rules the rest of the prompt sets out (the three focus areas unchanged). This edit landed after the 3-lens pipeline code_review, so it was reviewed independently via `codex review`: clean approval, with one positional-reference P2 caught and fixed (the note said rules "above" when the full-send block renders before them; now stated position-independently). The golden fixture was unaffected (the full-send block is not rendered in any golden entry); `dist/scripts/run-task.js` was rebuilt and the full suite re-run green.
- This recalibration's validation is a live dogfood observation, not a CI-enforced contract: if the next tasks run under it show the reviewer missing a genuine blocker, that's the signal to reopen this work.
