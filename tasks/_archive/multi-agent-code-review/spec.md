# Spec: multi-agent-code-review — anchored + cold review lenses, adjudicated by a synthesis foreman

> Written by: Claude | Review by: Codex
> Status: draft (for human review — not scaffolded, not run)
> Supersedes the parked `codex-code-review-phase` (kept as reference).
> Task setup (at scaffold): `delicate: true` · `base_branch: release/v1.10` (cut the branch at scaffold time) · full tier.

## Problem

Canon's `code_review` runs as a **single Claude session**: the orchestrator spawns it (`scripts/run-task/agents/claude.ts`, `claude -p … --dangerously-skip-permissions`) with the `code-review-round-1.md` prompt, and that one session reviews the diff, writes `review.md`, and sets the verdict. The review *methodology* (CLAUDE.md "Reviewing Code": Stage 1 AC-compliance gate, then Stage 2 quality) is a single spec-**anchored** pass — the reviewer reads the diff with the spec in hand.

Evidence (`tasks/codex-code-review-phase/evidence-codex-vs-claude.md`): across 173 Codex PR findings, **~76% sat off-AC** (62% cold-read lifecycle/race/consistency + 14% spec-level) — the class a spec-anchored review structurally misses — and **0 were false positives**. A blind head-to-head found a spec-blind ("cold") reader and the anchored reader are **complementary, not substitutes**. So the highest-value, evidence-backed addition is a second, *spec-blind* lens reading the diff cold — and a step that merges the two reviewers into one coherent verdict.

Today there is no cold lens, and no merge step: one anchored pass is the whole review.

## Decision

Restructure the existing `code_review` phase (no new phase, no `PHASE_ORDER` change) into **two review lenses adjudicated by a synthesis foreman**. The phase session becomes the **foreman**; it spawns the lenses as isolated Task sub-agents (verified: a headless `claude -p --dangerously-skip-permissions` session spawns fresh context-isolated sub-agents in parallel), collects their findings, and writes the single `review.md` + verdict the pipeline already consumes.

**Lenses** (two; each a fresh isolated context):
1. **Anchored** — canon's *current* code-review charter unchanged (Stage 1 AC compliance + Stage 2 quality + test-integrity), at the *current* `code_review` model tier. The only change vs. today: it **returns structured findings to the foreman** instead of writing `review.md` / setting the verdict itself.
2. **Cold** — spec-**blind** adversarial review of the full diff vs `base_branch`. Receives the diff only — **no spec / ACs / canon context**. That isolation is the entire point.

**Foreman** (the phase session) — **adjudication + synthesis**, not re-review:
- **Dedup**: findings both lenses raise collapse to one.
- **Cold-vs-spec reconciliation**: the foreman holds the spec; the cold lens did not, so it can flag behavior that's actually intended (e.g. ruled out by a Non-Goal). The foreman resolves those using information the cold lens lacked. (This is asymmetric-information adjudication, *not* a same-model re-verification pass — see Non-Goals.)
- **Altitude classification + verdict**: each surviving finding is classified **code-bug** or **spec-gap**; the foreman writes `review.md` and sets the verdict.

**Verdict + routing** — the verdict set gains `spec_gap`:
- `approved` / `approved_with_nits` → `qa` (existing).
- `changes_requested` (code-bug findings) → `implement` (existing reroute, unchanged).
- `spec_gap` (root cause is the spec, not the code) → **halt for human** via the existing escalation/human path — do **not** reroute to `implement` (an implementer can't fix a missing/wrong requirement). The human's path back is canon's existing flow: revise the spec's Amendment section and re-run.

**Models**: no new model matrix — both lenses and the foreman run at the **existing `code_review` tier** (`scripts/pipeline-policy.ts`: sonnet at S/M, opus at L/XL/delicate). The diversity that matters here is *framing* (anchored vs cold), not model family, so same-tier is correct; this also naturally gives an opus foreman on exactly the high-stakes (L/XL/delicate) tasks. No haiku.

**Always-on**, scaling with diff size (per-lens tokens scale with the diff). No opt-in flag, no tier gate.

### Why no false-positive revalidation pass
Deepsec-style "re-verify each finding, name the mitigation to drop it" was considered and **rejected** for this MVP. Canon's empirical FP rate in code review is ~0 (Codex: 0 FPs / 173), because reviewing a spec'd diff is a low-FP regime — unlike security scanning, where revalidation earns its keep. And a *same-model* revalidation shares the model's blind spots, so it would largely rubber-stamp rather than independently disconfirm. The legitimate FP-adjacent work (a cold finding that the spec explains away) is handled by the foreman's cold-vs-spec reconciliation above, which is asymmetric-information adjudication, not self-review. **Reversible**: if a nonzero FP rate shows up in practice, a revalidation step is a clean add-back.

### Explicitly dissolved vs the parked Codex design
No new phase; no opt-in flag; no `MAX_CODEX_REROUTES` cap; no full-send auto-amend; no separate iteration counters; no agreement-voting (degenerate at 2 lenses); no FP-revalidation pass.

## Non-Goals

- **A new pipeline phase.** This restructures `code_review` internally; `PHASE_ORDER` is unchanged.
- **A false-positive revalidation pass.** Out for this MVP (see above); reversible add-back if data demands.
- **A third (test-sufficiency) lens.** Coverage sufficiency is a spec/`spec_review` concern; only test-*integrity* (gaming/weakening) is reviewed, inside the anchored lens.
- **An architect / solution-shape lens.** A cold "did we solve the right problem, not just satisfy the ACs?" reviewer is deferred to a follow-up that adds it as lens #3 once this fan-out + foreman + `spec_gap`-halt infra ships (see `docs/BACKLOG.md` → `architect_review` lens). Its `block_due_to_architecture_risk` outcome maps onto the `spec_gap`→halt path this task builds. The foreman and synthesis must therefore be **n-lens shaped**, not hardcoded to two, so adding lens #3 is a small edit.
- **Splitting compliance from quality.** The anchored lens keeps canon's current combined charter; it is not split into separate sub-agents.
- **Replacing Codex-on-PR.** Codex's async PR review remains the independent-*model* backstop before merge. In-pipeline model diversity (e.g. a `codex review` lens) is a future option, not v1.
- **Full-send auto-amend of spec gaps.** `spec_gap` halts for human even under full-send in this MVP; autonomous amendment is a deferred follow-up task.
- **Output determinism.** Not claimed; robustness comes from the two-framing fan-out + fail-loud, not seeds.

## Acceptance Criteria

> Behavioral contracts only. Mechanics (exact lens prompts/charters, the sub-agent spawn + model wiring, `review.md` section format, the dedup signature, how cold-vs-spec reconciliation is prompted) live in *Design → Mechanics* as implementer guidance, verified at implement time — not AC surface. Verification is consolidated in AC-11.

- [ ] **AC-1 (structure)**: `code_review` runs as a synthesis foreman (the phase session) that spawns the two lenses as **isolated** sub-agents and writes the single `review.md` + verdict. No `PHASE_ORDER` change; phase name, artifact, reroute target, bundle behavior, and iteration counters are those of today's `code_review` except where AC-5 extends the verdict set.
- [ ] **AC-2 (anchored lens)**: Lens 1 applies canon's current code-review charter unchanged — Stage 1 AC compliance (AC table, dropped-sections, validation-outcomes) + Stage 2 quality + test-integrity — at the current `code_review` model tier, and **returns structured findings to the foreman** rather than writing `review.md` or setting the verdict.
- [ ] **AC-3 (cold lens + isolation)**: Lens 2 reviews the full diff vs `base_branch` adversarially with **no spec/AC/canon context injected** — diff (and base ref) only. The isolation is a hard contract: the cold lens must not receive `spec.md` content.
- [ ] **AC-4 (adjudication/synthesis — outcomes)**: The foreman produces one consolidated finding set in which (a) findings raised by both lenses appear once (deduped), and (b) a cold-lens finding that the spec shows is intended is dropped/demoted with the spec reason recorded. The foreman does **not** re-review the diff for novel bugs (it adjudicates the lenses' outputs + the spec).
- [ ] **AC-5 (altitude + verdict + concrete routing)**: Each surviving finding is classified **code-bug** or **spec-gap**. The verdict is one of `approved` / `approved_with_nits` / `changes_requested` / `spec_gap`. Routing in `checkAndRoute()` (`scripts/run-task/main.ts`): `changes_requested` → `implement` (existing); `approved`/`approved_with_nits` → `qa` (existing fall-through); **`spec_gap` → halt for human by reusing canon's *existing* block/escalation mechanism (`autoBlockPhase` / append `Escalation`) — set `code_review.status='blocked'`, do NOT fall through to `qa`** (the current fall-through advances to the next pending phase, which would be `qa` — AC violated unless `spec_gap` is intercepted before that logic). Reusing the existing mechanism (not a new halt state) keeps the run resumable: the human's path back is canon's existing flow — revise the spec's Amendment section and re-run (re-enters review). Test-integrity findings are code-bugs.
- [ ] **AC-6 (fail-loud — phase level)**: If the foreman does not emit a filled `review.md` with a recognized verdict, the phase **hard-fails** — reset-to-pending for retry (reuse the existing template-unfilled detection in `code-review.ts`) or block — and surfaces the failure; it never silently resolves to `approved` or an empty finding set. (Lens-internal malformed output is the foreman's responsibility to handle; the deterministic guarantee is at the phase boundary: no valid `review.md` + verdict ⇒ no pass.)
- [ ] **AC-7 (effects to DELETE)**: The current single-session behavior where the `code_review` agent writes `review.md` and sets the verdict **directly** is removed/replaced — that responsibility now belongs solely to the foreman. The old direct-review path must not remain alongside the new one (no dual path).
- [ ] **AC-8 (models — reuse existing tier)**: Both lenses and the foreman run at the existing `code_review` model tier (sonnet S/M, opus L/XL/delicate per `scripts/pipeline-policy.ts`). No new model matrix is introduced; no `haiku`. (Lens defs pin/inherit this tier — mechanism deferred.)
- [ ] **AC-9 (single artifact + re-review)**: The foreman writes one `review.md` (consolidated findings with per-finding altitude, and the spec reason for any dropped cold finding, plus the verdict). Re-review after any `implement` reroute re-runs **both** lenses from scratch (existing "any implement cycle invalidates prior approvals" invariant holds).
- [ ] **AC-10 (verdict plumbing — all seven surfaces)**: `spec_gap` is added consistently across **every** surface that defines/validates the verdict set, not just the type: (1) the `Verdict` union (`scripts/run-task/types.ts`); (2) the runtime `VALID_VERDICTS` set **and** `assertValidVerdict()` in `src/task/index.ts` — these currently diverge from the type by design, so adding only the union type-checks while `canon task phase … spec_gap` still throws at runtime; (3) the CLI help verdict list (`src/cli/index.ts`); (4) the `_verdict_values` template hint (`.canon/templates/status.json` + mirror); (5) the phase gate in `scripts/run-task/validation.ts` — both `PHASE_GATE_CONFIG` acceptance **and** the `extractCheckedVerdict()` checkbox regex (the verdict is read from a checked checkbox in `review.md`, so without a matching regex the verdict reads as `null` and the gate rejects); (6) the `review.md` artifact template (`.canon/templates/review.md` + mirror) needs a `spec_gap` verdict checkbox for (5) to detect; (7) the dispatcher routing (`scripts/run-task/main.ts`, per AC-5). All kept consistent. (Codex spec_review flagged that omitting (2)/(3) makes the foreman's `canon task phase … spec_gap` fail before status.json updates, and the Affected-Files scope cap blocks the implementer from adding them silently.)
- [ ] **AC-11 (Testing Matrix — deterministic surface only)**: Synthesis is performed inside the foreman's LLM reasoning (no Node synthesis layer in this MVP — see Decisions), so automated tests cover only the **deterministic, Node-level** surface: (1) **verdict plumbing** — `spec_gap` is accepted across all seven surfaces (AC-10); `canon task phase … code_review done spec_gap` succeeds and writes status.json. (2) **routing** — `spec_gap` → `code_review.status='blocked'` + escalation entry and does **NOT** advance to `qa`; `changes_requested` → implement; `approved`/`approved_with_nits` → qa. (3) **phase-level fail-loud** — an unfilled/template `review.md` (or unrecognized verdict) resets-to-pending/blocks, never silent-approves. (4) model tier resolves to the existing code_review tier. **Dedup, cold-vs-spec reconciliation, and altitude *classification quality* are LLM judgment and are validated by the Human Test Plan, not unit tests.**
- [ ] **AC-12 (docs)**: `CLAUDE.md` / `AGENTS.md` "Reviewing Code" / "Review Responsibilities" are updated to describe the two-lens + foreman model and the `spec_gap` verdict; canon-managed templates sync (`sync-templates:check` passes); `docs-refs-check` passes. The new lens agent-definition files are registered as canon-owned and mirrored to `templates/`.

## Design

### Affected Files

> Derived from a full end-to-end trace of the `code_review` surface (prompt selection → spawn → artifact → verdict definition/validation → routing → templates → docs), not just the files the author expected to touch. Every verdict-set and template *mirror* is enumerated so the implementer isn't bounced for an omitted surface.

> **One path per row, single table (required by the base-drift allow-list parser).** `parseTableH3` stops at the first blank line, and `parseHandoffPathCell` rejects any first-column cell containing more than one backticked path — so every path is its own row, grouped only by ordering. Mirrors and per-file test entries are enumerated explicitly. `dist/` is the directory form (matches subpaths); wildcards are rejected.

| File | Change |
|---|---|
| `scripts/run-task/phases/code-review.ts` | Restructure to the foreman model: build the foreman prompt, spawn the two lens sub-agents, adjudicate, write `review.md`, set verdict (incl. spec_gap). Remove the old direct single-review write (AC-7). (May be unchanged if the all-LLM foreman lives entirely in the prompt template + prompts/index.ts.) |
| `scripts/run-task/prompts/index.ts` | promptCodeReview() adds foreman-prompt selection; anchored lens reuses the existing round-1/-N prompt. |
| `scripts/run-task/prompts/templates/code-review-foreman.md` | NEW. The foreman's synthesis/adjudication prompt (spawn lenses, dedup, cold-vs-spec reconciliation, altitude, write review.md + verdict). |
| `scripts/run-task/prompts/templates/code-review-round-1.md` | Reused as the anchored-lens charter; output redirected to "return findings to the foreman" (not write review.md/verdict). |
| `scripts/run-task/prompts/templates/code-review-round-n.md` | Same as round-1, re-review variant. |
| `.claude/agents/code-review-anchored.md` | NEW (dir doesn't exist yet). Anchored lens definition; model = existing code_review tier. |
| `.claude/agents/code-review-cold.md` | NEW. Cold (spec-blind) lens definition; model = existing code_review tier. |
| `templates/.claude/agents/code-review-anchored.md` | NEW mirror (ships to adopters via `canon upgrade`). |
| `templates/.claude/agents/code-review-cold.md` | NEW mirror. |
| `scripts/run-task/agents/claude.ts` | Support the foreman spawning lens sub-agents at the code_review tier. |
| `scripts/run-task/types.ts` | Add spec_gap to `_VERDICT_VALUES` + `Verdict` union. (Reuse the existing `Escalation` type for the spec_gap halt — no new type.) |
| `src/task/index.ts` | Add spec_gap to the runtime `VALID_VERDICTS` set AND `assertValidVerdict()` (diverges from the type — else rejected at runtime). |
| `src/cli/index.ts` | Add spec_gap to the CLI help verdict list. |
| `scripts/run-task/validation.ts` | extractCheckedVerdict() regex for the spec_gap checkbox; `PHASE_GATE_CONFIG` code_review accepts spec_gap; phase-level fail-loud (unfilled/invalid review.md ⇒ no pass). |
| `.canon/templates/status.json` | `_verdict_values` hint includes spec_gap. |
| `templates/.canon/templates/status.json` | Mirror of the status.json hint. |
| `scripts/run-task/main.ts` | checkAndRoute(): intercept spec_gap BEFORE the changes_requested/fall-through logic → reuse the existing block/escalation mechanism (`autoBlockPhase` / append `Escalation`) to set `code_review.status='blocked'` + halt; must NOT fall through to qa. |
| `.canon/templates/review.md` | Add a spec_gap verdict checkbox to the verdict section; note the foreman writes one consolidated verdict. |
| `templates/.canon/templates/review.md` | Mirror of the review.md template. |
| `scripts/pipeline-policy.ts` | Verify code_review tier resolves for foreman + lenses (likely no change). |
| `src/lib/canon-owned.ts` | Register the two new lens defs (so they sync + ship to adopters). |
| `CLAUDE.md` | Reviewing-Code / Review-Responsibilities: two-lens + foreman + spec_gap. |
| `AGENTS.md` | Same as CLAUDE.md. |
| `templates/CLAUDE.md` | Mirror of CLAUDE.md. |
| `templates/AGENTS.md` | Mirror of AGENTS.md. |
| `docs/pipeline-orchestrator.md` | code_review routing + verdict table: add spec_gap (blocks + escalates, does NOT route to implement). |
| `templates/docs/pipeline-orchestrator.md` | Mirror of pipeline-orchestrator.md. |
| `tests/run-task-extract-verdict.test.ts` | AC-11: spec_gap verdict extraction. |
| `tests/run-task-validation.test.ts` | AC-11: spec_gap phase-gate acceptance. |
| `tests/run-task-prompts.test.ts` | AC-11: foreman + lens prompt contract. |
| `tests/run-task-safety.test.ts` | AC-11: spec_gap routing (blocks, does NOT advance qa). |
| `tests/task-cli.test.ts` | AC-11: runtime verdict acceptance + counters. |
| `tests/run-task-counter-schema.test.ts` | AC-11: spec_gap counter behavior. |
| `tests/run-task-prompts.golden.json` | Regenerate the prompt golden snapshot (code-review prompt templates change). Update via the test's golden-regen path, don't hand-edit. |
| `dist/` | Rebuild; committed to satisfy the CI dist gate (directory form — matches dist/cli/ and dist/scripts/). |

> **Spawn mechanism (decided): `.claude/agents/*.md` definitions** (one per lens), invoked by the foreman via `subagent_type`. Verified: a headless `claude -p --dangerously-skip-permissions` session spawns fresh, context-isolated sub-agents in parallel, and per-sub-agent model assignment is honored. Lens models follow the existing code_review tier (pin or `inherit` from the foreman — pick at implement time).
>
> **Synthesis is all-LLM (no Node layer in MVP)**: the foreman is a single `claude -p` session that spawns the two lens sub-agents and performs dedup + cold-vs-spec reconciliation + altitude classification *in its own reasoning*, then writes `review.md` + the verdict. The lens "findings" are a prompt convention the foreman reads (the foreman consumes them), not a typed stream a Node parser validates. This keeps the verified single-`claude -p` architecture intact; the tradeoff (dedup/reconciliation not unit-testable) is accepted and reversible (see Known Risks).
>
> **Mechanics deferred to plan/implement**: exact lens charters, the foreman's synthesis/reconciliation prompt, the `review.md` section format, and the `spec_gap` → blocked+escalation wiring (confirm the existing escalation/block path in `main.ts`). The anchored lens charter is canon's *current* review prompt with its output redirected to "return findings to the foreman," not a rewrite.

### Prior art / why these decisions
- Evidence: `tasks/codex-code-review-phase/evidence-codex-vs-claude.md` (76% off-AC, 0 FP, complementary cold vs anchored).
- deepsec (`vercel-labs/deepsec`): borrowed the *cold/independent* read and **fail-loud on malformed output**; **not** borrowed: the FP-revalidation pass (security-tool regime, high FP — doesn't fit canon's ~0-FP code-review regime), same-model verification, no-voting/lock/sandbox machinery.
- Anthropic orchestrator-workers ("invest in synthesis"); the lenses are the diverse jury (framing diversity), the foreman is the foreman.

## Validation Required

- [x] Linting (`npm run lint`) — required for all changes
- [x] Type checking (`npm run type-check`) — verdict union + phase wiring affect inference across the orchestrator
- [x] Unit tests (`npm test`) — AC-11 synthesis/routing/fail-loud + verdict-plumbing tests
- [x] Full build (`npm run build`) — changes `scripts/run-task/**` + prompt templates bundled into `dist/`; committed `dist/` must match a fresh build
- [x] Docs references (`npm run docs-refs-check`) — new agent-def paths referenced from docs
- [x] Canon-managed template sync (`npm run sync-templates:check`) — CLAUDE.md / AGENTS.md / status.json template + new canon-owned agent defs must stay mirrored
- [ ] End-to-end tests — N/A per `docs/architecture.md` (no E2E surface in canon-ai)

## Known Risks

- **No FP-revalidation → cold-lens noise could cause a spurious reroute.** Mitigated by the foreman's cold-vs-spec reconciliation (AC-4) + canon's existing review-loop cap + the human at `human_review`; empirically the FP rate is ~0. **Reversible** — add a revalidation step only if a nonzero FP rate appears.
- **Pure-synthesis foreman = a coverage seam.** A bug *both* lenses miss is not caught in-pipeline, and the (often strongest) foreman model is spent on adjudication, not novel diff-reading. Accepted by design (the anchored+cold framings cover different failure modes; Codex-on-PR is the independent-model net). Named here rather than glossed.
- **All-LLM synthesis is not unit-testable (dedup/reconciliation/altitude quality).** Resolving Codex spec_review's Finding 1 toward the lean all-LLM foreman (vs. a Node synthesis layer) means dedup, cold-vs-spec reconciliation, and altitude *quality* are validated only by the Human Test Plan, not unit tests. The deterministic safety net IS tested (verdict plumbing, `spec_gap` halt routing, phase-level fail-loud). **Reversible**: if early runs show the foreman is sloppy at dedup or mis-classifies altitude, introduce structured lens outputs + a Node synthesis/dedup layer (Codex's option (a)) and promote those into unit tests.
- **Fixed 2-lens overhead on tiny diffs.** Per-lens tokens scale with the diff, but the lens *count* is fixed — a trivial S task pays for 2 lenses + foreman. Accepted (always-on); a size-based dial is possible future tuning.
- **All-Claude lenses share model blind spots.** The framing diversity (anchored vs cold) is the lever, not model family; true model diversity stays at Codex-on-PR.
- **Restructuring the QA gatekeeper is high blast radius.** This is the review gate itself — a regression ships bugs. Hence `delicate: true` (opus review chains) and a thorough Human Test Plan; the first real exercise of the new `code_review` is reviewing some later task — validate on a planted-bug task first.
- **`spec_gap` must route out cleanly.** The halt-for-human must reuse an existing escalation/human path the dispatcher can resume from (revise-amendment + re-run); a brand-new dead-end halt state would strand the run. Called out in AC-10 / Mechanics.

## Human Test Plan

> Steps for the product owner — observable run outcomes, not internals.

1. **A spec-blind bug is caught.** Run a task whose diff has a deliberate lifecycle/race bug that no acceptance criterion names. Confirm the run does **not** approve — it asks for changes, and the review output names that bug.
2. **A spec problem is surfaced, not mis-fixed.** Run a task whose code faithfully matches the spec but where the spec itself is wrong/incomplete. Confirm the run **halts and asks the human** (does not loop back into implementation), and the review output explains the spec problem.
3. **Intended-but-unusual behavior is not flagged.** Run a task that does something a cold reader would find suspicious but that the spec explicitly intends (a Non-Goal). Confirm the run is **not** blocked on it, and the review output records why it was dismissed.
4. **A weakened test is caught.** Run a task whose diff edits a test to pass against broken behavior. Confirm the run asks for changes (treated as a real bug), not approved.
5. **A clean change passes.** Run a correct task. Confirm it approves and proceeds, with the review output showing both review perspectives were applied.
6. **A broken review run fails loudly.** If a reviewer errors/returns garbage, confirm the run visibly fails/retries rather than silently approving.
7. **Cost/latency sanity.** Confirm the two reviews run concurrently (wall-clock ≈ the slower one) and a small task's cost stays proportionally small.
8. **Trust audit (synthesis quality — the main thing HTP guards now).** On a real task, read the review output: are duplicate findings actually collapsed (no near-identical entries)? Are dismissed findings genuinely intended? Are the code-bug vs spec-gap calls right? This is the check before relying on the new gate, and the signal for whether the all-LLM foreman needs the Node dedup layer (see Known Risks).

## Decisions (resolved)
- **Two lenses** (anchored = current charter unchanged; cold = spec-blind) + **synthesis foreman** = the phase session. No third lens, no compliance/quality split.
- **No FP-revalidation pass** in the MVP (canon's FP rate ~0; same-model revalidation rubber-stamps). Reversible.
- **Foreman = adjudication/synthesis** (dedup + cold-vs-spec reconciliation + altitude + verdict), not re-review. **All-LLM** — one `claude -p` session, no Node synthesis layer in the MVP (resolves Codex spec_review Finding 1 toward the lean option). AC-11 therefore tests only the deterministic gates (plumbing, `spec_gap` halt routing, phase-level fail-loud); synthesis quality → Human Test Plan. Reversible.
- **`spec_gap` halt = `code_review.status='blocked'` + escalation entry** intercepted in `checkAndRoute()` (must not fall through to `qa`). Verdict `spec_gap` added across all seven surfaces incl. `src/task/index.ts` `VALID_VERDICTS` + `src/cli/index.ts` help (Codex spec_review Finding 2).
- **Spawn mechanism** = `.claude/agents/*.md` definitions (model-pin verified working).
- **Models** = reuse the existing `code_review` tier for lenses + foreman; no new matrix; no haiku.
- **`spec_gap` always halts for human** (incl. full-send); full-send auto-amend deferred to a separate task.
- **Release vehicle** `release/v1.10`; **`delicate: true`**; always-on.
