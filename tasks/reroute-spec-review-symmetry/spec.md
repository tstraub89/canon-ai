# Spec: reroute-spec-review-symmetry — Full-tier reroute re-enters at spec_review + plan, not implement

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`--reroute` ([`rerouteFromHumanReview()`](../../scripts/run-task/main.ts) ~L1817) resets `implement`, `code_review`, `qa`, and `human_review` to `pending` and leaves `spec_review` and `plan` at `done`. The pipeline therefore resumes at **implement** for every tier, and the human's amendment goes straight from prose into Codex's implement prompt.

The only thing between an amendment and implementation is `verifyRerouteAmendment()` ([`scripts/run-task/validation.ts`](../../scripts/run-task/validation.ts) ~L157) — a **presence check**, not a review. It confirms a `## Amendment [Round N]` heading exists; it says nothing about whether the amendment is implementable, internally consistent with the already-approved ACs, or in scope.

This is an **asymmetry by tier**. The reason full-tier tasks (M/L/XL/delicate) get a Codex `spec_review` pass is to catch unimplementable ACs, contradictions with approved ACs, and scope-expansion *before* an implement cycle burns. An amendment to a delicate/XL task — the same sensitive surface — gets none of that. Protection *drops* between the original spec and the amendment, for exactly the tasks where scrutiny matters most. (For fast tier — S, non-delicate — the original spec gets *no* Codex spec_review either; the human gate replaces it. So straight-to-implement is already the correct, symmetric behavior for fast tier.)

A secondary gap rides along: `plan.md` is never refreshed on reroute, so the plan describes the pre-amendment design while implement-reroute runs against the amendment.

## Decision

Make `--reroute` re-enter a task at the same review altitude the tier gave its *original* spec:

- **Full tier (M/L/XL/delicate)**: a reroute additionally resets `spec_review` and `plan` to `pending`. The pipeline re-enters at **`spec_review`** (Codex reviews the amendment as a gate), then **`plan`** (append-only reroute plan), then **`implement`**.
  - **spec_review-reroute** reviews the amendment **and** how it interacts with the previously-approved ACs **and** overall shape — not the amendment in isolation. It stays in the spec domain (does not audit the implementation).
  - On **`changes_requested`** during a reroute spec_review, the orchestrator **blocks and surfaces to the human** (Option B): reset `spec_review`→`pending`, print which files to revise, exit. The human owns the amendment and revises it conversationally, then re-runs `canon run <id>`. The pipeline does **not** route back to a pipeline-Claude `spec` revision, and does **not** re-arm the human spec gate on approval (it flows through to `human_review`).
  - **plan-reroute** *appends* a `## Reroute Plan [Round N]` section to `plan.md` (does not regenerate the existing plan), planning only the delta.
  - **implement-reroute** additionally reads the `## Reroute Plan [Round N]` section.

- **Fast tier (S, non-delicate)**: unchanged mechanically — reroute still resets only `implement` onward and re-enters at `implement`. Conversational Claude *may* append a `## Reroute Plan` section to `plan.md` when amending a fast-tier spec (mirroring how it writes the plan inline during fast-tier spec authorship); implement-reroute reads it if present, otherwise Codex sorts the delta from amendment + handoff as today.

**Symmetry vs. deliberate divergence.** This restores symmetry on the *review altitude* axis: a full-tier amendment now gets a Codex review before implementation, like the original spec did. It deliberately **diverges** on the *iteration* axis: the original spec's `spec_review` `changes_requested` auto-iterates via a pipeline-Claude `spec` revision (`routeBackTo('spec')`), whereas a reroute amendment rejection (Option B) exits to the human. This is intended, not an artifact of avoiding a third template — the amendment is human-authored conversational input, so the human, not pipeline-Claude, owns revising it. The consequence (a rerouted task gets less *automated* spec iteration than its original) is accepted: reroutes are human-initiated, low-frequency events where a human is already in the loop.

### Context each reroute phase reads

| Phase | Agent | Reads | Does NOT read | Rationale |
|---|---|---|---|---|
| spec_review-reroute | Codex | `spec.md` (full, incl. Amendment) + prior `spec-review.md` | handoff / review / done | Stays in the spec domain. Feeding Codex its own `handoff.md` invites it to rationalize its prior implementation and is a self-review smell (cross-review rule, `docs/decisions.md`). Prior `spec-review.md` lets it avoid re-litigating already-settled ACs. |
| plan-reroute | Claude | amended `spec.md` + prior `plan.md` + prior `handoff.md` + reroute `spec-review.md` | done | Planning the delta requires knowing what was built (`handoff.md`). Claude reading Codex's handoff is normal cross-review, not self-review. |
| implement-reroute | Codex | `spec.md` (Amendment Round N) + `plan.md` (`## Reroute Plan Round N`, if present) + its own `handoff.md` | review / done | Unchanged except the new plan read. Codex reading its own handoff to compute the delta is resumption. |

The human's rejection reasoning lives entirely in the Amendment section of `spec.md` — there is no separate machine-readable rejection artifact, and this spec does not add one. The amendment **is** the feedback (already true today for implement-reroute).

### The `implement.rerouted` dispatch flag — invariant, not a new clear

Reroute-variant prompt selection keys off `implement.rerouted === true` (the existing flag, mirroring `phases/implement.ts` L60). The flag is set in `rerouteFromHumanReview()` and **never cleared** in code — the comment at `main.ts` ~L1879 claiming it is "consumed and cleared in runPhase case 'implement'" is **stale and false**.

This spec does **not** add a clear. Adding a write to delicate phase-routing state has its own blast radius, and the dispatch is provably correct without it, because of this invariant:

> At `spec_review` / `plan` / `implement` dispatch time, `implement.rerouted === true` **iff** a human reroute is in progress.

Why it holds (the four reset paths):
1. **Task creation** — all phases pending, `rerouted` falsy → normal variants. ✓
2. **`routeBackTo('spec')`** (original spec_review `changes_requested` loop) — resets spec/spec_review/plan/implement. This only fires on the *first* pass, before any reroute, because **Option B intercepts reroute + `changes_requested` before the `routeBackTo('spec')` line is reached** (AC-5). So `rerouted` is falsy here → normal variants, which is correct (this is the original spec-revision loop, not a reroute). ✓
3. **`routeBackTo('implement')`** (code_review `changes_requested` loop) — resets implement only. `implement.ts` checks `isRevision` (`iterations_current_loop > 0`) *before* `isRerouted`, so the revision prompt wins regardless of `rerouted`'s value. Stale `rerouted` cannot mis-route here. ✓
4. **`rerouteFromHumanReview()`** — sets `rerouted = true`, resets spec_review(full)/plan(full)/implement. → reroute variants. ✓

The fix is to **correct the stale comment** to document this invariant, not to add a clear. (Codex spec_review: please verify the invariant proof against the routing code, since the whole dispatch correctness rests on Option B intercepting before `routeBackTo('spec')`.)

## Non-Goals

- **No machine-readable "human rejection" artifact.** The Amendment section is the feedback.
- **No re-arming the human spec gate on reroute.** Approved amendment flows through to `human_review` (the human is already engaged, having authored the amendment). `human_spec_gate` is already consumed (false) after the first pass; this spec does not re-set it.
- **No pipeline-Claude amendment revision.** Option B blocks to the human on amendment rejection; there is no `spec-reroute`/amendment-revision template and no third reroute template.
- **No change to fast-tier reroute mechanics.** No new pipeline phase for fast tier.
- **No change to `verifyRerouteAmendment()`, the amendment-heading convention, or `reroute_count` semantics.** `reroute_count` still increments only on `--reroute`; an Option B block + re-run does *not* bump the round (the human revises the same `## Amendment Round N` section).
- **No clearing of `implement.rerouted`.** (See invariant above.)

## Acceptance Criteria

- [ ] **AC-1 — Full-tier reroute resets spec_review + plan.** In `rerouteFromHumanReview()`, when `detectTier(statuses) === 'full'`, the reset additionally sets `phases.spec_review.status = 'pending'`, clears `phases.spec_review.verdict = ''`, sets `phases.spec_review.iterations_current_loop = 0` (and the legacy `iterations = 0` alias), and sets `phases.plan.status = 'pending'`. `iterations_total`, `changes_requested_total`, and `auto_block_count` on spec_review are **preserved** (monotonic). For fast tier, spec_review and plan are left untouched (current behavior). The reset must **not** touch `reroute_count` — the existing increment at `main.ts` ~L1884 already runs before any phase dispatch, so `reroute_count` is current (= the round being entered) when spec_review-reroute/plan-reroute select their `## Amendment Round N` / `## Reroute Plan Round N` headings. *Verify*: unit test asserting, post-reroute, a full-tier task's derived phase is `spec_review` and a fast-tier task's is `implement`; that spec_review monotonic counters survive; and that `reroute_count` equals the entered round.
- [ ] **AC-2 — Tier-aware reroute messaging.** The `splitCli.info("Rerouting: human_review → implement ...")` line and the trailing guidance in `rerouteFromHumanReview()` reflect the tier: full tier reads `human_review → spec_review (resetting spec_review, plan, implement, code_review, qa)` and tells the operator a stepped reroute now expects `spec_review`; fast tier keeps the `→ implement` wording. *Verify*: assertion on captured info output for one full-tier and one fast-tier reroute.
- [ ] **AC-3 — spec_review-reroute prompt variant.** `promptSpecReview()` renders a new `spec-review-reroute.md` template when `tasks.some(t => t.status.phases.implement?.rerouted === true)`, else the existing `spec-review.md`. The reroute template instructs Codex to: (a) locate `## Amendment [Round N]` (N = `reroute_count`) in `spec.md`; (b) review the amendment **and** its interaction with the previously-approved ACs **and** overall shape; (c) read the prior `spec-review.md` to avoid re-litigating already-settled ACs; (d) **not** read or audit `handoff.md` / `review.md` / `done.md`; (e) emit a verdict via the existing `canon task phase <id> spec_review done <verdict>` command. It injects a reroute round marker mirroring `promptImplementReroute`'s `roundBanner`/per-task lines. *Verify*: golden-snapshot test in `run-task-prompts.test.ts` for the reroute variant (single task + bundle); dispatch test asserting the variant is chosen iff `rerouted === true`.
- [ ] **AC-4 — plan-reroute prompt variant.** `promptPlan()` renders a new `plan-reroute.md` template when `tasks.some(t => t.status.phases.implement?.rerouted === true)`, else the existing `plan.md`. The reroute template instructs Claude to **append** a `## Reroute Plan` section (round 1) / `## Reroute Plan Round N` (round N ≥ 2, N = `reroute_count`) to `plan.md` **without** rewriting or removing the existing plan content, reading amended `spec.md` (Amendment Round N), prior `plan.md`, prior `handoff.md`, and the reroute `spec-review.md`. It injects the round marker. *Verify*: golden-snapshot test; dispatch test.
- [ ] **AC-5 — Option B routing on amendment rejection.** In `checkAndRoute()`'s `spec_review` case, when a reroute is in progress (`statuses.some(s => s.phases.implement?.rerouted === true)`) **and** any task's spec_review verdict is `changes_requested`: the orchestrator resets each such task's `spec_review.status = 'pending'` and `verdict = ''`, prints a human-facing block naming `tasks/<id>/spec.md` and `tasks/<id>/spec-review.md` and instructing the human to revise the amendment and re-run `canon run <id>` (explicitly **not** `--reroute`), then `process.exit(0)`. It does **not** call `routeBackTo('spec')` and does **not** increment `reroute_count`. The non-reroute path (verdict `changes_requested`, `rerouted` falsy) keeps the existing `routeBackTo('spec')` behavior unchanged. This reroute-changes_requested check is evaluated **before** the existing `routeBackTo('spec')` line. *Verify*: unit test that a reroute + `changes_requested` resets spec_review to pending and exits without modifying `phases.spec` (no routeBackTo); and that a first-pass (non-reroute) `changes_requested` still routes back to spec.
- [ ] **AC-6 — Approved reroute amendment flows through (B2).** When a reroute is in progress and spec_review verdict is **not** `changes_requested` (approved), `checkAndRoute()` proceeds without re-arming the human spec gate: because `human_spec_gate` is already `false` after the first pass, the gate block does not fire and the pipeline advances to `plan`. **This is a regression-guard AC, not new code** — it locks in existing flow-through behavior against the AC-5 edits in the same `spec_review` branch; the implementer should add the test, not write new gate logic. *Verify*: unit test asserting an approved reroute spec_review does not exit at a spec gate and that `phases.plan` becomes the next derived phase.
- [ ] **AC-7 — implement-reroute reads the reroute plan.** `implement-reroute.md` instructs Codex to read the `## Reroute Plan [Round N]` section of `plan.md` (matching the task's reroute round) when present, in addition to the existing Amendment + `handoff.md` reads, and to fall back gracefully (read the base plan) when no Reroute Plan section exists (fast-tier case). *Verify*: golden-snapshot diff of the implement-reroute template includes the plan-read instruction; existing implement-reroute golden updated.
- [ ] **AC-8 — Templates registered.** `spec-review-reroute.md` and `plan-reroute.md` are imported in `prompts/index.ts` and added to the `TEMPLATES` map; `loadTemplate` resolves both. *Verify*: type-check + the prompt golden tests render without "Unknown template" throw.
- [ ] **AC-9 — Stale comment corrected.** The comment at `main.ts` ~L1879 is rewritten to state that `implement.rerouted` is set on reroute and **not** cleared, and to document the dispatch invariant (the four-reset-paths argument, condensed). No `delete implement.rerouted` / `rerouted = false` write is introduced anywhere. *Verify*: `grep -rn "rerouted" scripts/` shows assignments only in `rerouteFromHumanReview` (set true) and reads in `implement.ts` + the two new dispatch sites; no clear.
- [ ] **AC-10 — Docs updated.** `docs/pipeline-orchestrator.md` §Human Reroute describes: full-tier re-entry at `spec_review` → `plan` → `implement`; Option B block-to-human on amendment rejection (re-run `canon run`, not `--reroute`); B2 flow-through on approval; fast-tier unchanged; and that `--step --expect` for a full-tier reroute now expects `spec_review` (was `implement`). `CLAUDE.md` reroute guidance notes the full-tier `--expect spec_review` change and the optional conversational `## Reroute Plan` for fast-tier reroutes. *Verify*: `npm run docs-refs-check` passes; manual read confirms accuracy.
- [ ] **AC-11 — Validation + build artifacts green.** `npm run lint`, `npm run type-check`, `npm test`, and `npm run build` all pass, and committed `dist/` matches a fresh build (`git diff --exit-code -- dist/`). `templates/CLAUDE.md` matches `CLAUDE.md` per the sync hook (`npm run sync-templates:check`). *Verify*: run all; record outcomes in handoff.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | `rerouteFromHumanReview()`: tier-gate the reset (full tier also resets `spec_review` + `plan`→pending, clears spec_review verdict + `iterations_current_loop`, preserves monotonic counters); tier-aware info/guidance messages (AC-1, AC-2). `checkAndRoute()` spec_review case: Option B block-to-human on reroute + `changes_requested`, evaluated before `routeBackTo('spec')` (AC-5, AC-6). Correct the stale `rerouted`-cleared comment + document the invariant (AC-9). |
| `scripts/run-task/prompts/index.ts` | `promptSpecReview()` + `promptPlan()` gain reroute-variant dispatch keyed off `implement.rerouted === true`, injecting the reroute round marker; import + register `spec-review-reroute.md` and `plan-reroute.md` in `TEMPLATES` (AC-3, AC-4, AC-8). |
| `scripts/run-task/prompts/templates/spec-review-reroute.md` | **New** — amendment review prompt (amendment + interaction with approved ACs + shape; reads `spec.md` + prior `spec-review.md`; no implementation audit) (AC-3). |
| `scripts/run-task/prompts/templates/plan-reroute.md` | **New** — append-only `## Reroute Plan [Round N]`; reads amended spec + prior plan + handoff + reroute spec-review (AC-4). |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Add a step to read `plan.md`'s `## Reroute Plan [Round N]` section when present (AC-7). |
| `docs/pipeline-orchestrator.md` | §Human Reroute rewrite per AC-10. |
| `CLAUDE.md` | Reroute guidance per AC-10 (full-tier `--expect spec_review`; fast-tier optional conversational reroute plan). |
| `templates/CLAUDE.md` | Auto-synced mirror of `CLAUDE.md` — regenerated + re-staged by the pre-commit sync hook (`npm run sync-templates`). Listed so the `--pr` base-drift gate accepts it. Do not hand-edit. |
| `dist/` | Build-generated CLI bundle (directory-form entry). Regenerated by `npm run build` because `scripts/run-task/**` changed; committed `dist/` must match a fresh build. |
| `tests/run-task-reroute-preflight.test.ts` | Extend (reroute is this file's feature): AC-1 tier-gated reset, AC-2 messaging, AC-5/AC-6 Option B + flow-through routing. |
| `tests/run-task-prompts.test.ts` | Extend: AC-3/AC-4/AC-7 dispatch + golden snapshots for the new/changed templates. |
| `tests/run-task-prompts.golden.json` | Regenerate golden expectations for the new spec-review-reroute / plan-reroute renders and the updated implement-reroute render. |

### Interaction Dependencies

- **`detectTier()`** (`scripts/pipeline-policy.ts` via `scripts/run-task/policy.ts`) — the reset-gating and any tier read inside `rerouteFromHumanReview()` must use the same tier function the dispatcher uses, so reset and routing agree.
- **`deriveTopLevelStatus()`** (`scripts/run-task/state.ts`) — phase routing is purely derived from the first non-`done` phase; resetting `spec_review`→pending is sufficient to route there. No explicit "goto" needed.
- **Fast-tier spec_review auto-skip** (`main.ts` ~L1155: `if (phase === 'spec_review' && state.tier === 'fast') continue;`) — confirms fast tier never runs spec_review even if it were pending; the AC-1 gating avoids resetting it at all, but this is the backstop.
- **Session slots** (`codex_spec_review` is fresh each time, never resumed) — spec_review-reroute runs as a fresh Codex session by existing behavior; no change needed, but the prompt must be self-contained (it is, per AC-3).
- **`run-task-reroute-preflight.test.ts`** — its existing assertions (`implement.rerouted === true`, `reroute_count` increment, amendment-heading gate) must continue to pass unchanged.

### Data Model Changes

None. No new `status.json` fields, no `PhaseEntry` shape change. `implement.rerouted` and `reroute_count` are reused as-is.

## Validation Required

- [x] `npm run lint` (= `eslint scripts/ tests/ src/`)
- [x] `npm run type-check` (= `tsc -p tsconfig.json --noEmit`)
- [x] `npm test` — full suite runs clean (reroute-preflight + prompts goldens included)
- [x] `npm run build` — touches `scripts/run-task/**`; committed `dist/` must match a fresh build (`git diff --exit-code -- dist/`)
- [x] `npm run docs-refs-check` — touches `docs/` + `CLAUDE.md`
- [x] `npm run sync-templates:check` — `CLAUDE.md` edit must be mirrored to `templates/CLAUDE.md`
- [ ] E2E — N/A (no UI surface)

## Docs Impact

- `docs/pipeline-orchestrator.md` (§Human Reroute) — **will** change (AC-10).
- `CLAUDE.md` (reroute Quick-refs + fast-tier guidance) — **will** change (AC-10), with `templates/CLAUDE.md` synced.
- `docs/decisions.md` — candidate for a new decision entry ("Reroute re-enters at the tier's original review altitude; amendment rejection blocks to the human"). QA should evaluate whether this rises to a settled decision worth recording. Not required for the implementation.
- `docs/lessons-learned.md` — the stale-`rerouted`-comment finding (a documented-but-false claim in delicate code) is a candidate lesson for QA distillation.

## Known Risks

- **Dispatch correctness rests on Option B ordering.** The `implement.rerouted` invariant only holds if the reroute + `changes_requested` interception (AC-5) is evaluated *before* `routeBackTo('spec')`. If a future edit reorders these, `routeBackTo('spec')` could fire mid-reroute and re-run `plan` with a stale-true `rerouted` flag, mis-selecting the reroute plan variant. Mitigation: AC-5 makes the ordering explicit; the corrected comment (AC-9) documents the dependency; a test asserts reroute + changes_requested does not touch `phases.spec`.
- **Bundle reroutes with mixed reroute rounds.** Bundles reroute together and may carry mixed `reroute_count` values. The round marker in the new prompts must be per-task (mirror `promptImplementReroute`'s bundle branch), not a single bundle-wide round, or at least one task gets the wrong amendment/plan-round heading. Mitigation: AC-3/AC-4 require mirroring the existing per-task `taskLines` pattern; golden tests cover the bundle case.
- **Append-only plan-reroute is a prompt instruction, not an enforced gate.** Claude could overwrite `plan.md` instead of appending. There is no validator that the prior plan survived. Accepted: this matches how the spec/handoff cumulative-append convention is enforced (by prompt + template comment, per `AGENTS.md`), and code_review reads the result. Flagging rather than building a plan-diff gate this task.
- **`--step --expect` callers break by design.** Any operator script doing `canon run --step --expect implement <id>` on a full-tier reroute will now fail fast (current phase is `spec_review`). This is the intended fail-fast behavior of the guard, documented in AC-10, not a regression.
- **`dist/` regeneration noise.** The bundle diff may be larger than the source diff (tsup re-emits). Reviewer should diff `scripts/run-task/**` for intent and treat `dist/` as mechanical. Per the build-artifact rule, `dist/` is declared in Affected Files so the base-drift gate accepts it.
- **Delicate surface.** This is orchestrator phase-routing (`rerouteFromHumanReview`, `checkAndRoute`) — `delicate: true`. A bug corrupts every reroute that runs after it lands. The review chain runs at the upgraded model; the human test plan below exercises both tiers and the rejection path end to end.

## Human Test Plan

1. **Full-tier reroute, approved amendment (happy path).** Take any M/L/XL or delicate task that has reached human review. Add an `## Amendment` section to its spec describing a small new requirement. Run the reroute command. Expected: the pipeline announces it is returning to spec review (not implementation), an independent review of your amendment runs, and — when that review is satisfied — it proceeds to update the plan and re-implement, finally landing back at human review with the amendment built. The original plan content is still present, with a new "Reroute Plan" section appended below it.
2. **Full-tier reroute, rejected amendment (Option B).** Write an amendment that contradicts an already-approved requirement or asks for something unimplementable. Run the reroute. Expected: the pipeline stops and tells you the amendment review found problems, names the spec and review files to look at, and asks you to revise the amendment and re-run the normal run command (not the reroute command again). After you fix the amendment and re-run, the amendment review runs again and, once satisfied, the pipeline continues.
3. **Fast-tier reroute unchanged.** Take an S, non-delicate task at human review, add an amendment, and reroute. Expected: it goes straight to re-implementation (no separate amendment-review step), exactly as before. Optionally add a "Reroute Plan" section to the plan beforehand and confirm the implementation reflects it.
4. **Repeat reroute (round 2).** On a full-tier task you already rerouted once, add an `## Amendment Round 2` section and reroute again. Expected: the amendment review and reroute plan both reference round 2, and the round-1 sections remain untouched in both files.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (each has a *Verify* clause)
- [x] Affected Files lists specific files with specific change descriptions (incl. build artifacts `dist/`, `templates/CLAUDE.md`)
- [x] Plan steps (fast tier) reference actual function/file names — N/A (full tier; plan is a pipeline phase)
- [x] Known Risks covers failure modes for the trickiest ACs (invariant ordering, bundle rounds, append-only plan)
- [x] Human Test Plan uses product language only
- [x] Validation Required has `[x]` entries
- [x] Symbols named in ACs exist: `rerouteFromHumanReview`, `checkAndRoute`, `promptSpecReview`, `promptPlan`, `promptImplementReroute`, `detectTier`, `deriveTopLevelStatus`, `implement.rerouted`, `reroute_count`, `TEMPLATES`, `loadTemplate`, `verifyRerouteAmendment` — all grep-verified in the codebase
