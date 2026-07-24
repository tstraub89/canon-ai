# Spec: recalibrate-spec-review-for-stronger-reviewer — Recalibrate the `spec_review` prompt for a 5.6-generation reviewer

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon's Codex `spec_review` prompt (`scripts/run-task/prompts/templates/spec-review.md`) was calibrated for a reviewer that needed pushing to find issues. Under a stronger, more literal reviewer (the 5.6 generation canon now runs — `CODEX_MODEL_MINI=gpt-5.6-luna`, `CODEX_MODEL_FULL=gpt-5.6-sol`), the same framing **over-fires**: it produces high-recall, low-precision reviews that manufacture blocking findings on specs that are actually clean, and it drifts into pre-existing code the task does not touch.

**This is a prompt-calibration change, not a code defect.** There is no deterministic runtime branch to force-repro; the evidence is the observed review disposition across the tasks that ran under the 5.6 generation, plus vendor guidance on the generation's disposition. The regression guard is structural (the golden snapshot + the AC-11 prompt-text assertions), not a red-first runtime test — so the bug/flake red-first-test requirement is **N/A** for this task.

**Evidence (internal, ground truth).** Three tasks in one week, all reviewed by 5.6-generation Codex, exhibit the same convergence failure — a *new* "blocking" finding each round on a spec whose shape was already sound:

- `update-install-root-provenance` (gpt-5.6-luna): **7 `spec_review` rounds** before an operator diagnosed that the reviewer had dropped to reviewing pseudocode; distilled in `docs/lessons-learned.md` ("An over-mechanized spec silently converts spec_review into code review of pseudocode", 2026-07-19).
- `stable-validation-ids` (gpt-5.6-sol): **6 rounds, abandoned pre-implementation**; distilled in `docs/lessons-learned.md` ("Before hardening a brittle check, ask whether another layer already owns the concern", 2026-07-21).
- `fix-installed-provenance-version` (gpt-5.6-luna): **6 rounds, hit the 3-in-a-row auto-block, never approved**. Its `spec-review.md` Shape Check reads "no concerns" from round 3 on, yet the final blocking finding attacked AC-5's *live vendored-submodule root resolution* — behavior the spec **explicitly declared out of scope** in Non-Goals and AC-5 itself. The reviewer built a local host/submodule git fixture to press a finding against untouched, pre-existing code. (Telemetry rows in `docs/pipeline-invocations.md`; artifacts under `tasks/fix-installed-provenance-version/`.)

**Evidence (vendor, corroborating).** OpenAI's GPT-5.6 model guidance headlines "stop over-prompting" and "state each instruction once," noting that repeated directives "can paradoxically cause unnecessary approval requests for safe actions" — the over-firing mechanism, named. Independent review benchmarking (CodeRabbit) measured the 5.6 flagship at **higher recall but lower precision** than the prior generation, posting substantially more comments, and observed that "a raw model that posts too much can train people to ignore it"; higher-precision reviewers achieve their precision "through stricter filtering." Canon's `spec_review` has **no foreman filter** (unlike `code_review`), so that filtering discipline must live in the prompt.

**Why evidence, not an executed eval.** The direction of this change is established by the *convergence* of internal disposition (the three 5.6-generation tasks above) and vendor guidance (sources below) — not by a runtime repro. A prompt's effect on a **stochastic** reviewer is not deterministically reproducible: the same prompt yields different findings run to run, so a one-shot current-vs-candidate "replay" proves nothing, and a statistically meaningful precision/recall eval is a research harness disproportionate to a prose-calibration change — and is itself the over-mechanization this program guards against (`docs/lessons-learned.md`, "An over-mechanized spec silently converts spec_review into code review of pseudocode"). The downside (suppressing real blockers) is bounded by **conservative design** — the Blocking definition, the substantive Shape-Check probes, and the bug/flake evidence ladder are all unchanged — and the empirical loop is **human-observed dogfood**: the sibling task `default-codex-models-to-5-6-generation` is the first task run under the recalibrated prompt, and any genuine blocker it *fails* to surface is the signal to re-open. Building an executed prompt-comparison or precision/recall validation contract is an explicit Non-Goal.

**Sources.**
- OpenAI, GPT-5.6 prompt guidance ("stop over-prompting"; "state each instruction once"): https://developers.openai.com/api/docs/guides/prompt-guidance-gpt-5p6
- CodeRabbit, GPT-5.6 Sol/Terra code-review benchmark (higher recall / lower precision; "a raw model that posts too much can train people to ignore it"; precision via stricter filtering): https://www.coderabbit.ai/blog/gpt-5-6-sol-and-terra-benchmark

The meta-insight, worth encoding durably: a guardrail prompt carries an **implicit model-strength calibration**. Upgrading the model under a fixed guardrail shifts its operating point — a reviewer strong enough to no longer need pushing will, under a prompt that still pushes, over-fire. (Relates to canon's "guardrails let smaller models win" thesis in `docs/product-context.md` and the model-generation re-baseline entries in `docs/decisions.md`.)

## Decision

Recalibrate the `spec_review` prompt so a strong, literal reviewer reviews with **precision, not just recall** — surfacing genuine blocking problems while treating a clean spec as a valid outcome and staying within the surface the task changes. The recalibration de-scaffolds the "push to find fault" framing (vendor-aligned: state the objective once, outcome-first) and adds the two guardrails the prompt currently lacks: a whole-review silence default and a scope boundary.

Four behavioral changes to `scripts/run-task/prompts/templates/spec-review.md`:

1. **State the objective once, outcome-first, with a clean spec as a valid stopping condition.** The prompt currently frames the reviewer's job as finding fault and asserts that "Neutral or confirmatory review is a failure mode." Replace that with a single objective statement that a clean spec — one with no blocking findings — is a valid, expected outcome, not a review failure. The "neutral/confirmatory review is a failure mode" framing must not survive.

2. **Extend "silence is the default" to the entire review.** Today the silence default governs only the Shape Check. The implementability probe reads as an obligation to produce findings. State silence-as-default once as a principle that governs the whole review (Shape Check *and* implementability): flag only what is actually off.

3. **Add a scope boundary — with an omitted-dependency carve-out.** Genuinely out-of-scope behavior — pre-existing behavior the task *explicitly excludes and leaves verifiably unaffected* — is a nit at most, never blocking. But a change the spec *should* make and omitted (a required caller, parser, migration, or test surface), a transitive effect of the change, or an internal contradiction stays a **blocking** implementability finding even though the affected code is pre-existing. The downgrade applies only to excluded-and-unaffected behavior; it must not suppress omitted-required dependencies (that is what the current prompt's "file/interaction dependencies Claude missed" probe is for). The `fix-installed-provenance-version` round-6 over-fire is the out-of-scope case done right to *skip*: its live-submodule path was named in Non-Goals **and** verified unaffected — that is what "out of scope" means, not merely "untouched code the reviewer can reach."

4. **Add one Blocking-vs-nit calibration example.** Under the existing Blocking/nit classification, include a worked example: an under-specification whose intended value is strongly implied by the task context (e.g. a field name the surrounding context makes obvious) is a **nit for the plan phase**, not a Blocking finding.

The recalibration also records the durable meta-insight (implicit model-strength calibration) in `docs/decisions.md`, so a future model-generation bump prompts a re-check of this and peer guardrails.

## Non-Goals

- **No change to `spec-review-reroute.md`.** That template serves a different flow — the post-`human_review` amendment review (`implement.rerouted === true`), not the `spec_review` changes_requested loop. The over-firing evidence is entirely in the changes_requested loop, which renders `spec-review.md` only. Out of scope.
- **No change to verdict thresholds or the verdict set.** `approved` / `approved_with_nits` / `changes_requested` and their meanings are unchanged. This task changes *what the reviewer flags*, not *how a flag maps to a verdict*.
- **No change to the bug/flake-fix evidence ladder** (the deterministic-vs-runtime mechanism-class rungs and the red-first-test requirement). That block stays verbatim.
- **No change to the review-output artifact template** `.canon/templates/spec-review.md`. It is output structure the reviewer fills in, not the reviewer's behavioral instruction; the prompt is the driver. (Its Shape-Check "Silence is the default" line is left as-is; aligning it is a trivial follow-up, not this task.)
- **No model-routing change.** Whether `spec_review` should route to a higher-precision tier (e.g. Terra) rather than luna/sol is a `pipeline-policy.ts` matrix question, tracked separately. Out of scope here.
- **No model-default change.** Retiring the `gpt-5.4-mini`/`gpt-5.5` shipped defaults is a sibling task (`default-codex-models-to-5-6-generation`), not this one.
- **No reasoning-effort change.** `spec_review` effort tiers are unchanged.
- **No executed prompt A/B eval or precision/recall validation contract.** A prompt's effect on a stochastic reviewer is not deterministically reproducible, so a one-shot replay proves nothing and a meaningful eval is a research harness disproportionate to a prose calibration — and building one is the over-mechanization this program exists to prevent. Verification is convergent evidence (internal + vendor) + conservative design + the human-observed dogfood loop; see Problem.

## Acceptance Criteria

Each criterion is a verifiable property of the recalibrated prompt or the test/build state. Exact wording is the plan/implement phase's craft; the ACs pin the behavioral contract, not the sentences.

- [ ] AC-1 (clean spec is a valid outcome): In `scripts/run-task/prompts/templates/spec-review.md`, the reviewer's objective is stated so that a spec with no blocking findings is a valid, expected outcome. The assertion that a neutral or confirmatory review is a failure mode is **removed**. Verify by reading the prompt: it states that returning no blocking findings (approving) is valid, and a grep for `failure mode` returns no occurrence that frames a clean/neutral review as failing.
- [ ] AC-2 (whole-review silence default): The "silence is the default" principle governs the whole review, not only the Shape Check — the implementability probe is covered by the same default (flag only what is actually off, do not manufacture findings). Verify by reading the prompt: the silence default is stated as a review-wide principle (or explicitly restated for the implementability probe), and the implementability section no longer reads as an obligation to produce findings.
- [ ] AC-3 (scope boundary, with omitted-dependency carve-out): The prompt states a scope boundary that distinguishes two cases: **(a)** behavior the task *explicitly excludes and leaves verifiably unaffected* (e.g. pre-existing behavior named in Non-Goals) is out of scope — a nit at most; **(b)** a change the spec *should* make but omitted — a required caller, parser, migration, or test surface — a transitive effect of the change, or an internal contradiction remains a **blocking** implementability finding, even though the affected code is pre-existing. The "nit at most" downgrade applies only to case (a) and must not suppress case (b). Verify by reading the prompt: the scope-boundary statement scopes the downgrade to explicitly-excluded-and-verified-unaffected behavior and preserves blocking status for required-but-omitted dependencies / transitive effects / contradictions.
- [ ] AC-4 (Blocking-vs-nit calibration example): The Blocking/nit classification includes a worked example that an under-specification with a strongly-implied default (a value the task context makes obvious, such as a field name) is a nit for the plan phase, not Blocking. Verify the prompt contains that example.
- [ ] AC-5 (guardrail-phrase preservation): The recalibrated prompt still contains the exact strings `No agent reviews its own output` and `Each role owns a checkpoint`, and introduces neither `task baseline` nor `git -C`. Verify the existing AC-11 structural assertions in `tests/run-task-prompts.test.ts` pass unchanged.
- [ ] AC-6 (golden regenerated): `tests/run-task-prompts.golden.json` is regenerated (`UPDATE_GOLDENS=1 npm test`) so `npm test` passes with the committed golden. The `promptSpecReview` entry reflects the recalibrated template; entries that render other templates (`promptSpecRevision`, the `promptSpecReview_reroute_*` variants) are unchanged. Verify `npm test` passes and the golden diff is confined to the `promptSpecReview` entry.
- [ ] AC-7 (shipped bundle rebuilt): `npm run build` is run and the rebuilt bundle carrying the prompt (`dist/scripts/run-task.js`) is committed, so the shipped binary uses the recalibrated prompt. Verify the recalibrated text appears in `dist/scripts/run-task.js` and the CI dist-clean check (`npm run build && git diff --exit-code -- dist/`) would pass on the committed tree.
- [ ] AC-8 (durable meta-insight recorded): `docs/decisions.md` gains a dated entry stating that canon's guardrail prompts carry an implicit model-strength calibration — a model-generation upgrade under a fixed guardrail shifts the operating point (a stronger reviewer over-fires under a prompt tuned to push a weaker one) — so the `spec_review` prompt and peer guardrails must be re-checked on a generation bump. The entry cites this recalibration's trigger. Verify `docs/decisions.md` contains the entry and `npm run docs-refs-check` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/prompts/templates/spec-review.md` | Apply the four behavioral changes (AC-1–AC-4). Runtime-only internal prompt — **not** in `CANON_OWNED`/`DELIMITED`, so no `templates/` mirror to declare. |
| `tests/run-task-prompts.golden.json` | Regenerated snapshot; diff confined to the `promptSpecReview` entry (AC-6). |
| `dist/scripts/run-task.js` | Rebuilt bundle — `spec-review.md` is inlined here at build time via tsup's `.md` text loader (AC-7). Declared for the `--pr` base-drift gate. |
| `docs/decisions.md` | New dated entry recording the model-strength-calibration meta-insight (AC-8). Root-only doc — no `templates/` mirror (confirm against `src/lib/canon-owned.ts`). |

### Interaction Dependencies

- The prompt template is imported as a build-time text module (`import specReviewTemplate from './templates/spec-review.md'` in `scripts/run-task/prompts/index.ts`) and inlined into `dist/scripts/run-task.js` by tsup (`loader: { '.md': 'text' }`). The tests read the `.md` from source at runtime via `tests/md-loader-hooks.mjs`, so golden regen (AC-6) reflects the edit *without* a build, but the shipped binary requires the build (AC-7) — both are needed.
- `dist/cli/index.js` does **not** import the prompt builders (the prompt text is absent from it), so `npm run build` is not expected to change that artifact. If a build leaves it byte-identical, do not declare or commit it; if a build does touch it, add it to the handoff Changes table then (the base-drift gate rejects undeclared dist artifacts, and a declared artifact that never appears in the diff is also rejected).
- `promptSpecReview` (`scripts/run-task/prompts/index.ts`) renders `spec-review.md` only when no task is in the `implement.rerouted` branch; the reroute branch renders `spec-review-reroute.md`, which this task does not touch — so no reroute golden entry should change.

### Data Model Changes

None. No type, schema, or `status.json` shape change.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; includes the regenerated golden (AC-6) and the AC-11 structural assertions (AC-5)
- [x] `npm run build` — the prompt is inlined into `dist/`; commit the rebuilt `dist/scripts/run-task.js` (AC-7)
- [x] `npm run docs-refs-check` — `docs/decisions.md` changes (AC-8)
- [ ] `npm run sync-templates:check` — no canon-managed file changes (the prompt is not canon-owned; `docs/decisions.md` is root-only). Run it to confirm it stays green, but no mirror edits are expected.

## Docs Impact

- `docs/decisions.md` — gains the new meta-insight entry (AC-8); this is the change, not a staleness heads-up.
- `docs/product-context.md`, `docs/pipeline-orchestrator.md`, `docs/patterns.md`, `docs/codebase-map.md`, `docs/architecture.md` — none go stale. The `spec_review` prompt's behavior is not enumerated in operator docs, and the prompt file is an internal orchestrator surface.

## Known Risks

- **Over-correction (under-firing).** The failure mode of the fix is a prompt so relaxed the reviewer waves through genuine blocking issues — the inverse of today's problem. Two specific traps: a scope boundary that downgrades a *required-but-omitted* dependency (guarded by AC-3's carve-out — omitted-required changes stay blocking), and a silence default read as "say nothing." Mitigation: the recalibration removes the *push-to-find-fault* scaffolding and adds a *bounded* scope boundary and a *clean-is-valid stopping condition*; it does **not** weaken the Blocking definition or the Shape Check's substantive probes, and it leaves the bug/flake evidence ladder verbatim. The empirical guard is the dogfood loop, not a CI contract (see Non-Goals): `default-codex-models-to-5-6-generation` runs first under the recalibrated prompt, and a genuine blocker it fails to surface is the signal to re-open.
- **Self-referential review.** This task's own `spec_review` runs under the *current* (un-recalibrated) prompt, so it may itself over-fire. Expected and acceptable — the recalibration cannot retroactively govern its own review. If it over-fires on an out-of-scope or clean-spec finding, that is corroborating evidence, not a signal to expand scope.
- **Golden/build drift.** Forgetting the golden regen fails `npm test`; forgetting the build leaves the shipped binary on the old prompt and bounces the dist-clean CI check. Both are in Validation Required and called out in Interaction Dependencies.
- **AC-11 phrase removal.** Editing near the cross-review or 3-role-checkpoint sentences could drop a phrase the AC-11 test pins. Guarded by AC-5; the four changes target different sentences (objective framing, silence default, scope boundary, nit calibration), not the preserved phrases.

## Human Test Plan

1. Open canon's `spec_review` reviewer instructions and read them as if you were the reviewer. Expected: it tells you to surface genuine blocking problems but makes clear that a clean spec — nothing blocking — is a perfectly good result, rather than implying you've failed if you don't find something.
2. Read the same instructions for guidance on what to comment on. Expected: it tells you to stay on what the task actually changes and to leave genuinely out-of-scope, unaffected behavior alone (at most a minor note) — while still treating a *missing* required change (something the task should have covered but didn't) as a serious finding, not a minor one — rather than hunting through unrelated code.
3. Read the guidance on what counts as a blocking problem versus a minor note. Expected: it gives an example that a detail the task context makes obvious (like an implied field name) is a minor note for the planning step, not a blocker.
4. Confirm the project's checks pass on the change (the automated test suite and build), and that canon's decision log now has an entry explaining that a review-guardrail's strictness is tied to the model behind it and should be revisited when the model generation changes.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Acceptance Criteria are behavioral/structural contracts (prompt properties, golden/AC-11 state, build/docs gates); exact prompt wording is left to plan/implement
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] If this spec replaces existing behavior: framed as replacement ("the 'neutral/confirmatory review is a failure mode' framing must not survive"; AC-1 pins a zero-result grep on `failure mode`-as-failure framing)
- [x] Known Risks covers failure modes for the trickiest ACs (over-correction, self-referential review, golden/build drift, phrase removal)
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] Non-Goals rules out the tempting scope expansions (reroute template, verdict thresholds, evidence ladder, artifact template, model routing, model defaults, effort) — each backed by a positive scope bound or reason, not bare prose
- [x] Symbols named in ACs exist: `promptSpecReview`, `promptSpecRevision`, `promptSpecReview_reroute_*` (`scripts/run-task/prompts/index.ts` + golden), `tests/run-task-prompts.golden.json`, `UPDATE_GOLDENS`, the AC-11 assertions in `tests/run-task-prompts.test.ts`, `dist/scripts/run-task.js` — all grep-verified during exploration
- [x] (Bug/flake fixes) N/A — this is a prompt-calibration/guidance change, not a code defect; Problem states why a red-first runtime test is N/A and names the structural regression guard (golden + AC-11)
