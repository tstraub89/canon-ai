# Spec: recovery-surface-hardening — Guard canon task accept against missing verdicts; scope reroute amendment pre-flight to spec_gap tasks

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

Two operator-recovery gaps shipped with `operator-review-recovery` (1.11.0, PR #151), both independently re-confirmed by the Codex review of the v1.11.0 release diff (PR #154):

1. **`canon task accept` can sanction a review that never ran.** `taskAccept` (`src/task/index.ts:559`) is meant to override a verdict the operator disagrees with, but it never checks that a verdict exists: `ensurePhaseEntry` + an empty `currentVerdict` (`src/task/index.ts:709-710`) fall through to writing `verdict: 'sanctioned'`, `status: 'done'`. A premature or wrong-task-id `accept` silently skips the review phase entirely and advances the task with zero review having run.

2. **Mixed-bundle spec_gap recovery contradicts its own guidance.** When a bundle blocks at `code_review` with task A = `spec_gap` and task B = `approved`, the recovery banner (`scripts/run-task/main.ts:2845-2878`) correctly tells the operator to amend only the gap task's spec — but `rerouteFromHumanReview`'s pre-flight loop (`main.ts:2159-2171`) calls `verifyRerouteAmendment` for **every** task in the invocation. Following the guidance — amend only A — makes `canon run A B --reroute` abort on B for a missing `## Amendment`, even though B's spec was never wrong. Fails loud, but the sanctioned recovery path is unusable for mixed bundles.

Both are hardening of the same 1.11.0 recovery surface; BACKLOG files them as one task (`docs/BACKLOG.md` Harness Bugs, first two entries).

## Decision

1. **Verdict-exists guard on `accept`.** For review phases (`spec_review`, `code_review`), `canon task accept` refuses to sanction a phase whose recorded verdict is empty, with an actionable message ("no review verdict exists to sanction — run the review first, or pass `--force`"). The existing `--force` flag (already parsed and threaded into `taskAccept`) bypasses the guard, consistent with the other `--force`-escapable gates. In a bundle, the guard evaluates per-task and refuses **before mutating any task's state**, naming the offending task(s). Blocked reviews that carry a real verdict (`spec_gap`, `changes_requested`) sanction exactly as today. The non-review `accept` path (`implement`) is untouched.

2. **Amendment pre-flight scoped by reroute entry point.** In a spec_gap-entry reroute (`isSpecGapReroute`, `main.ts:2137`), the `## Amendment` requirement applies only to tasks whose `code_review` verdict is `spec_gap`. Approved/non-gap siblings are rerouted with the bundle without an amendment. The human_review-entry reroute is unchanged: every task must amend, as today.

   Downstream consequence the implementation must honor: a sibling exempted from amending must not be tripped by later reroute-evidence gates that expect amendment artifacts (e.g. `checkRerouteEvidence`'s requirement that a rerouted task's `spec_review` verdict come from a current-round `## Amendment Review` section). The bundle must be able to run spec_review → plan → implement → code_review to completion with one amended task and one exempt sibling. How the exemption is represented (per-task counter semantics, a status marker, or gate-side tolerance) is a plan/implement decision — mechanics deferred — but whatever shape is chosen must keep amendment-round numbering collision-free for **subsequent** reroutes (the `reroute_count` desync class fixed in 1.11.0 must not regress: a later legitimate reroute must compute a required `## Amendment [Round N]` heading that cannot match a stale heading from an earlier round).

## Non-Goals

- No change to the bless path (`canon task accept` semantics beyond the verdict guard), the notes.md audit line format, or the `sanctioned` verdict's meaning.
- No change to the human_review-entry reroute contract (all tasks amend) or to single-task spec_gap reroutes (the common case — already correct).
- Full-send spec_gap auto-amend stays in BACKLOG; this task only fixes the manual recovery path.
- No new CLI commands or flags; `--force` is the existing escape hatch.

## Acceptance Criteria

- [ ] AC-1: `canon task accept <id> code_review --reason "..."` on a task whose `code_review` phase has no recorded verdict (e.g. pending/never-run, or blocked with empty verdict) exits non-zero with a message that names the task, states that no review verdict exists, and points at running the review or passing `--force`. `status.json` is unchanged (no `sanctioned` verdict, no phase advance, no notes.md audit line). The same single-task refusal holds for `spec_review` (asserted directly, not only via the bundle case in AC-4).
- [ ] AC-2: The same invocation with `--force` proceeds: `sanctioned` verdict, `status: 'done'`, notes.md audit line — current behavior.
- [ ] AC-3: `accept` on a review phase blocked with verdict `spec_gap` or `changes_requested` sanctions exactly as in 1.11.0 (existing tests keep passing).
- [ ] AC-4: Bundle `accept` where at least one task has no verdict refuses before mutating **any** task in the bundle, and the error names exactly the verdict-less task(s). The same applies to `spec_review`.
- [ ] AC-5: With a bundle blocked at `code_review` where A has verdict `spec_gap` and B has verdict `approved`: after amending only A's spec with `## Amendment`, `canon run A B --reroute` proceeds (no missing-amendment abort on B), and reroute bookkeeping is written for the bundle.
- [ ] AC-6: After the AC-5 reroute, the bundle's subsequent phases do not demand amendment evidence from B: B passes the reroute-evidence gates (`spec_review`/`plan` evidence checks and phase gates) without an `## Amendment` or `## Amendment Review` section in its spec.
- [ ] AC-7: A human_review-entry reroute still requires an amendment from every task in the invocation (existing behavior; existing tests keep passing).
- [ ] AC-8: A second, later reroute computes a required amendment heading that cannot match any stale heading from the first round (regression guard for the reroute_count desync class), covering **both** tasks from the AC-5 bundle: (a) for A (amended in round 1), the required round advances past round 1; (b) for B (exempted in round 1), when B itself is the `spec_gap` task in the later reroute, the heading required for B's first-ever amendment is well-defined, enforced by the pre-flight, and cannot be satisfied by any heading already present in B's spec. The test asserts the exact required heading for each task.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/task/index.ts` | Verdict-exists guard in `taskAccept` review-phase branch (~line 709), evaluated per-task before any mutation; `--force` bypass; actionable error message |
| `scripts/run-task/main.ts` | Scope the `verifyRerouteAmendment` pre-flight loop (~2159-2171) to spec_gap tasks when `isSpecGapReroute`; keep human_review path requiring all; reroute bookkeeping consistent with the chosen exemption shape |
| `scripts/run-task/validation.ts` | Only if the chosen exemption shape needs gate-side tolerance in `checkRerouteEvidence` / `verifyRerouteAmendment` (mechanics deferred to plan) |
| `tests/task-cli.test.ts` | New cases: AC-1, AC-2, AC-4; assert AC-3 via existing cases |
| `tests/run-task-reroute-preflight.test.ts` | New mixed-bundle cases: AC-5, AC-6, AC-8 |
| `docs/pipeline-orchestrator.md` | Operator recovery docs: verdictless-accept refusal + spec_gap-only amendment requirement |
| `templates/docs/pipeline-orchestrator.md` | Derived mirror — auto-synced from the root copy by the pre-commit hook |
| `dist/cli/index.js` | Regenerated by `npm run build` (src/task changes bundle into the CLI entry) |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` (main.ts/validation.ts changes bundle into the orchestrator entry) |

### Interaction Dependencies

- The 1.11.0 `operator-review-recovery` machinery: `--reroute`-from-spec_gap, `canon task accept` sanctions, `reroute_count`/`## Amendment Round N` heading gate. This task tightens that surface; it must not regress the single-task paths its tests cover.
- The recovery banner text (`main.ts:2849-2853`) already instructs amending only gap tasks — verify the wording still matches post-change behavior (it should, since behavior moves toward the wording).

### Data Model Changes

None expected. If the exemption shape adds a per-task status field, it must be additive and default-absent (older tasks unaffected); flag it in the handoff.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `build` (`npm run build`) — commit `dist/` deltas
- [x] `sync-templates:check` (`npm run sync-templates:check`)
- [x] `docs-refs-check` (`npm run docs-refs-check`)

## Docs Impact

`docs/pipeline-orchestrator.md` — if its `--reroute` / `accept` sections describe the all-tasks amendment requirement or the unguarded accept, update the affected sentences. Likely a one-line touch or none.

## Known Risks

- **Delicate routing surface.** The reroute amendment pre-flight is the same gate the 1.11.0 `reroute_count` desync fix depends on. The exemption must apply only to the spec_gap entry point; accidentally relaxing the human_review path would let un-amended reroutes through silently. AC-7 is the guard.
- **Downstream gate cascade.** Exempting a sibling at pre-flight but leaving `checkRerouteEvidence` strict would just move the abort later (spec_review evidence). AC-6 exists precisely to force the implementation to trace the full gate chain, not only the pre-flight.
- **Blocked-with-empty-verdict reviews.** `autoBlockPhase` sets `status: 'blocked'` without a verdict (`scripts/run-task/state.ts:205`), so an infrastructure-halt block has no verdict and will now require `--force` to bless. That is the intended fail-closed direction; the error message must make the `--force` path obvious so operators aren't stuck.

## Human Test Plan

1. Create a throwaway task; before any review has run, try to accept its code review with a reason. Expected: the command refuses, explains no review verdict exists, and suggests running the review or forcing.
2. Repeat with the force option. Expected: it proceeds and the task's notes record the override.
3. On a two-task bundle where review flagged a spec problem in one task and approved the other: amend only the flagged task's spec, then reroute the bundle. Expected: the reroute proceeds without complaining about the approved task, and the pipeline runs through to review again without demanding anything from the approved task's spec.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]` (not `- [ ]`). `- [ ]` is a placeholder; the spec author flips required checks to `- [x]` before marking spec done. The orchestrator's code_review pre-flight blocks if no `[x]` items are present.

## Amendment

**Source**: Codex PR #155 review (P1, 2026-06-11) — "Preserve non-gap review failures during spec-gap reroutes."

**Problem**: the shipped exemption treats *every* non-`spec_gap` sibling in a spec_gap-entry reroute as if it were approved. A sibling blocked with `changes_requested` or `needs_re_review` gets marked `reroute_exempt`, and the reroute prompts then describe it as "prior code review approved — only re-verify shared behavior," so its unresolved `review.md` findings are silently dropped from the reroute round.

**Decision**: the *amendment requirement* exemption stays verdict-agnostic — no non-gap sibling is ever required to produce an `## Amendment` (the recovery guidance "amend only the gap tasks" is unchanged). But the downstream semantics become verdict-aware:

- **Advancing siblings** (`approved`, `approved_with_nits`): current behavior — prompts describe them as approved; implement only re-verifies behavior shared with amended siblings.
- **Failing siblings** (`changes_requested`, `needs_re_review`): no amendment demanded, but their prior review findings remain binding. The implement-reroute prompt line must direct the implementer at the task's existing `tasks/<id>/review.md` findings (naming the prior verdict), and must NOT describe the task as approved. The spec_review and plan reroute prompt lines must likewise not claim approval; they continue to demand no amendment artifacts (first-pass evidence rules per AC-6 apply to both flavors).

The reroute reset clears phase verdicts, so whatever marker shape carries the exemption must also preserve enough of the pre-reset verdict for prompt rendering to pick the right flavor — mechanics deferred to plan (e.g. recording the prior verdict alongside the exemption marker).

### Amendment Acceptance Criteria

- [ ] AC-9: With a bundle blocked at `code_review` where A = `spec_gap` and B carries a failing verdict — asserted for **both** flavors, `changes_requested` and `needs_re_review`, as separate test cases: after amending only A's spec, `canon run A B --reroute` proceeds (no missing-amendment abort on B), and the implement-reroute prompt's line for B directs the implementer at B's existing `review.md` findings, names B's prior verdict (the specific flavor), and does not describe B as approved. The spec_review and plan reroute prompt lines for B also do not describe B as approved.
- [ ] AC-10: B's exemption from amendment-evidence gates (AC-6 semantics) holds identically for the failing-sibling flavor: spec_review/plan evidence checks treat B as first-pass with no `## Amendment` / `## Amendment Review` / `## Reroute Plan` demanded.
- [ ] AC-11: Approved-sibling behavior is unchanged (AC-5, AC-6, AC-8 and their tests keep passing), and the prior-verdict information used for prompt flavor selection survives the reroute's verdict-clearing reset (asserted in the AC-9 test by rendering prompts from post-reroute state).

### Affected Files

> Amendment delta — additive to the original table above.

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Exemption marker records the sibling's pre-reset verdict (shape per plan) |
| `scripts/run-task/prompts/index.ts` | Per-task reroute lines render the failing-sibling flavor (review.md findings + prior verdict) vs the approved flavor |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Skip-clause wording defers fully to per-task lines (covers both exempt flavors) — only if wording changes are needed |
| `scripts/run-task/prompts/templates/spec-review-reroute.md` | Same — only if wording changes are needed |
| `scripts/run-task/prompts/templates/plan-reroute.md` | Same — only if wording changes are needed |
| `tests/run-task-reroute-preflight.test.ts` | AC-9/AC-10 mixed-bundle failing-sibling cases |
| `tests/run-task-prompts.test.ts` | Failing-sibling prompt-flavor cases (both `changes_requested` and `needs_re_review`); goldens regenerated if template wording changes |
| `tests/run-task-prompts.golden.json` | Regenerated via `UPDATE_GOLDENS=1 npm test` if prompt/template output changes |
| `dist/cli/index.js` | Regenerated by `npm run build` |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` |
