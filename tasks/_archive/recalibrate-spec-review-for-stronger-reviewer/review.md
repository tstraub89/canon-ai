# Code Review: recalibrate-spec-review-for-stronger-reviewer

> Reviewer: Claude | Spec: `tasks/recalibrate-spec-review-for-stronger-reviewer/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Lens signals this round:** anchored → approve; cold-Claude → approve (5 low/medium observations, all non-blocking); cold-Codex → approve ("scoped correctly, propagated to golden fixture and shipped bundle, test suite passes without regressions").

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens independently re-ran the suite: `npm test` (1027 tests, 1026 pass + 1 expected worktree-`.git` skip), `npm run build` + `git diff --exit-code -- dist/` (dist clean), and `npm run docs-refs-check` (All refs OK). All green.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Clean spec is a valid outcome | Pass | Objective reworded to "catch genuine blocking problems, precisely" + "A spec with no blocking findings is a valid, expected result — approving a clean spec is not a shortfall." `grep 'failure mode'` on the prompt returns no match; the "Neutral or confirmatory review is a failure mode" assertion is fully removed. |
| AC-2: Whole-review silence default | Pass | "Silence is the default — for this whole review, Shape Check and implementability alike." Implementability probe reworded to "apply that same default while probing" and closes "An empty list here is a valid result, not a gap in your review." No longer reads as an obligation to produce findings. |
| AC-3: Scope boundary + omitted-dep carve-out | Pass | New Scope-boundary paragraph downgrades only "explicitly excludes and verifies as unaffected" behavior to "a nit at most, never blocking," and preserves **blocking** status for required-but-omitted change / transitive effect / internal contradiction. Discriminator sentence present ("not 'can I reach this code' — it's whether the spec named it out of scope and showed it stays unaffected"). |
| AC-4: Blocking-vs-nit calibration example | Pass | Added `*Example*:` — an under-specification with a strongly-implied default (implied field name) is "a nit for the plan phase, not Blocking." |
| AC-5: Guardrail-phrase preservation | Pass | Exact strings `No agent reviews its own output` and `Each role owns a checkpoint` still present; `task baseline` and `git -C` absent. `tests/run-task-prompts.test.ts` unchanged (not in diff); full suite green → AC-11 structural assertions pass unchanged. |
| AC-6: Golden regenerated | Pass | Of 16 keys in `tests/run-task-prompts.golden.json`, only `promptSpecReview` changed; `promptSpecRevision` and all `promptSpecReview_reroute_*` variants byte-identical. The regenerated value carries the recalibrated strings and no "failure mode" — an honest renderer regen, not a hand-forged snapshot. `npm test` passes against the committed golden. |
| AC-7: Shipped bundle rebuilt | Pass | `dist/scripts/run-task.js` `spec_review_default` line updated byte-for-byte to the escaped source edit; `dist/cli/index.js` unchanged. `npm run build` + `git diff --exit-code -- dist/` → clean, so the CI dist-clean gate passes on the committed tree. |
| AC-8: Durable meta-insight recorded | Pass | `docs/decisions.md` gains dated entry "Guardrail prompts carry an implicit model-strength calibration (2026-07)" citing trigger `recalibrate-spec-review-for-stronger-reviewer`. `docs-refs-check` passes. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work) — `spec-review-reroute.md`, verdict thresholds, evidence ladder, artifact template, model routing/defaults, effort all untouched; the four changed files match the declared scope.
- [x] Known Risks addressed or documented as accepted — over-correction, self-referential review, golden/build drift, and AC-11 phrase-removal risks are all covered; the two cold-lens over/under-firing observations below map onto the spec's own accepted "over-correction" risk.
- [x] Human Test Plan satisfiable by the implementation.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

A tight, well-scoped prose-calibration change: four surgical edits to one prompt template, faithfully propagated to the golden fixture and shipped bundle, plus a decision-log entry. Derived-artifact propagation is honest (both Claude lenses independently confirmed the golden and bundle are byte-for-byte the escaped source edit; `dist/cli/index.js` correctly untouched). Mustache tags remain balanced, no surviving "find fault / failure mode" framing contradicts the new disposition, and the blocking definition + Shape-Check probes + bug/flake evidence ladder are preserved verbatim as intended. No code-bugs and no blocking spec-gaps surfaced across three lenses; the surviving items are minor and non-blocking.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

(none — the two "disposition swings toward clean/silence" observations are accounted for by intact blocking criteria and the spec's documented over-correction risk; see Optional Cleanup and Dismissed below.)

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- **Full-send block left un-recalibrated (`scripts/run-task/prompts/templates/spec-review.md:9`, flagged by anchored + cold-Claude).** The `{{#fullSendActive}}` block still says "raise the bar … expectations for thoroughness are higher" — a "push harder" framing sitting in the very file this task recalibrates. It's non-blocking and defensibly out of this task's scope: the over-firing evidence is entirely from the normal changes_requested loop, none of AC-1..AC-4 touch full-send, and full-send is a distinct regime (no human read the spec, so higher scrutiny is arguably warranted). Worth noting as a follow-up candidate — the decision entry this task adds (AC-8) explicitly names "a 'push harder' framing" on peer guardrails as the pattern to re-check on a generation bump, and this block is exactly that. A future task, not a change here.
- **`*Example*:` bullet indentation (`scripts/run-task/prompts/templates/spec-review.md:34`, cold-Claude).** The example sits at the same list level as the **Blocking** / **Non-blocking (nit)** bullets, so it structurally reads as a third peer finding-class rather than as a sub-example of the nit category. Content is unambiguous ("a nit for the plan phase, not Blocking") and satisfies AC-4; nesting it under the nit bullet would read marginally cleaner. Cosmetic.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong. If a surviving finding's root cause is the spec rather than the code, the final verdict is `spec_gap`.

(none blocking) — cold-Claude's scope-boundary observation (below) is a prose-latitude note on AC-3's inherent design, not an implementer guess or a spec defect; recorded but not routed as `spec_gap` because the code faithfully encodes AC-3 and the spec's Known Risks already reasons about and accepts the tension.

### Dismissed Cold Findings

> Cold-lens findings dropped after verification. Verified cold findings are not dismissed merely for being off-AC.

- **Dismissed (cold-Claude): Scope-boundary paragraph is two-directionally under-specified (`spec-review.md:29`, medium/medium) — retained as a note, not blocking.** Verified against the diff and AC-3. The prompt faithfully encodes AC-3's two cases. The specific hole cold-Claude raises — a transitive effect landing *on* a Non-Goal behavior — is already closed by the text: case (a) requires the behavior be "verified as unaffected," so a genuine transitive effect (by definition, an effect) fails that antecedent and stays blocking under the case-(b) "transitive effect" clause; the third sentence ("showed it stays unaffected") is the discriminator. The residual "how high is the bar" latitude is inherent to prose guidance to a reasoning model and is exactly the over/under-firing tension the spec's **Known Risks → Over-correction** section names and accepts as bounded by conservative design. Holds against the code; not a defect.
- **Dismissed (cold-Claude): Aggregate disposition swings toward "clean is expected," could depress recall (low/low, self-tagged "likely intended").** The three reassurance phrases are the deliberate AC-1/AC-2 contract. Blocking criteria (Blocking definition, Shape-Check probes, bug/flake evidence ladder) are intact as counterweight and unchanged. This is the spec's intended recalibration direction, with under-firing explicitly accepted as a bounded risk guarded by the human-observed dogfood loop. Not a defect.
- **Dismissed (cold-Claude): `docs/decisions.md:381` "Why" asserts three tasks each showed an in-loop convergence failure — unverifiable from the diff (low/low, deferred to foreman).** Verified against the spec's Problem section, which documents all three tasks with specifics (7/6/6 rounds, the auto-block hit, `docs/lessons-learned.md` citations, and `docs/pipeline-invocations.md` telemetry rows). The decision-log entry is a faithful condensation of that reviewed premise. Holds; not a defect.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

> Three lenses converge on approve. Stage 1 passes with all 8 ACs met and independently re-verified checks. No code-bugs, no blocking spec-gaps. Two non-blocking nits carried forward: the un-recalibrated full-send block (a follow-up candidate the new decision entry itself flags) and the cosmetic example-bullet indentation. Neither warrants a revision round.
