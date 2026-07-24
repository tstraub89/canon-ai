# Completion Summary: default-codex-models-to-5-6-generation — Default Codex models to the 5.6 generation, retire 5.4-mini/5.5

> For the human. This is what you need to know.

## What Changed

Canon's shipped Codex model defaults were two generations behind what the operator's own environment actually runs. This task bumps the fallback defaults — the models an adopter gets if they never set a `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL` override — from the retired `gpt-5.4-mini`/`gpt-5.5` to the current `gpt-5.6-luna`/`gpt-5.6-sol`, in both places the config is duplicated. Every operator-facing surface that named the retired models (the env-var reference table, effort-rationale prose in two docs, one code comment) was reframed to drop the old identifiers without asserting any new, unverified claim about how the 5.6 models behave. A new dated entry in `docs/decisions.md` records the change and explicitly reconciles it with an earlier caution against chasing a model upgrade to paper over review-quality churn — this bump is a routine currency re-baseline, not that. Historical records, telemetry, and incidental test fixtures that also happen to contain the old strings were left untouched, as the spec required. No effort tiers, routing, or override-chain behavior changed — only the two default model strings.

## Files Changed

- `scripts/run-task/env.ts` — mini/full fallback defaults → `gpt-5.6-luna`/`gpt-5.6-sol`.
- `scripts/run-task/policy.ts` — identical bump in the duplicated config object; surrounding object differences (env.ts's `projectName`/`maxContextBytes`, field order) intentionally untouched.
- `docs/pipeline-orchestrator.md` (+ `templates/docs/pipeline-orchestrator.md` mirror) — env-var default table updated; effort-rationale prose reframed to drop the retired model name.
- `docs/product-context.md` — full-tier effort rationale reframed.
- `scripts/pipeline-policy.ts` — explanatory code comment updated; matrix logic unchanged.
- `docs/decisions.md` — new "Model-generation re-baseline (2026-07)" entry appended.
- `dist/cli/index.js`, `dist/scripts/run-task.js` — rebuilt bundles carrying the new defaults.

## How to Test

1. In a fresh project that installs canon and sets no Codex model override, start a task and run the pipeline. Expected: the pipeline reports the current-generation Codex models (mini and full tier), not the retired ones.
2. Read canon's environment-variable reference table and the tier/effort explanation in the operator docs. Expected: the documented default model names match what actually runs, and nothing describes an old model as canon's current default.
3. Read canon's decision log. Expected: a new entry explains the default models moved to the current generation, that this is a routine default change, and that it doesn't conflict with the earlier caution about not upgrading models to fix review churn.
4. Confirm the project's automated checks pass on the change.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (1027/1027) |
| Build (both bundles, dist-clean) | Pass |
| `docs-refs-check` | Pass |
| `sync-templates:check` | Pass |

Code review (3-lens: anchored Claude, cold Claude, cold Codex) converged **Approved with nits** — zero correctness bugs, zero risk/guardrail findings, zero spec gaps. The one surviving item is a non-blocking wording nit: the four reframed surfaces use three slightly different phrasings for the same underlying fact ("the prior generation's model showed overthinking" / "the prior-generation model overthought" / "the prior generation overthought") — not a defect, just inconsistent wording. `spec_review` (Codex) converged in 2 rounds: round 1 `changes_requested` on two genuine spec defects (fixed in the spec's Amendment), round 2 `approved_with_nits`.

## Human Verification Required

None.

## Proposed Changelog

- **Canon's shipped Codex model defaults are now the 5.6 generation.** Adopters who don't set `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL` previously got two generations behind current — `gpt-5.4-mini` (mini tier) and `gpt-5.5` (full tier). The defaults are now `gpt-5.6-luna` (mini) and `gpt-5.6-sol` (full); override env-var names and precedence, routing, and effort tiers are unchanged. See [`docs/decisions.md`](docs/decisions.md) §"Model-generation re-baseline (2026-07)". Ships to adopters via `canon upgrade`.

## Decisions Made

- Kept the two config objects in `env.ts`/`policy.ts` intentionally non-identical — only the two Codex default/override expressions had to match across files, per the spec's Amendment narrowing AC-1.
- Classified retired-identifier hits into two buckets rather than gating to zero everywhere: current-state surfaces (code, env-var table, current-state prose) had to hit zero; historical/dated docs, incidental test fixtures, backlog entries, and `CHANGELOG.md` were left untouched, as the spec explicitly permitted.
- Reframed rationale prose to drop the retired model name entirely rather than merely stop calling it "current" — and did not attribute the old models' overthinking-at-`xhigh` behavior to the new 5.6 models, since that hasn't been evaluated.
- Added a new dated `docs/decisions.md` entry even though an existing 2026-07 entry already referenced the 5.6 generation in passing, because that entry didn't record this shipped-default change or reconcile it with the prior caution.
- Deferred the changelog entry for this default change to the release-time `/canon-changelog` step, not this task's ACs, per the spec's Docs Impact.

## Open Questions

- `docs/BACKLOG.md:1347` states the old defaults as the operative scope of an open question about identifier validity across adopter installs; the spec flagged this as non-required but worth a glance before it goes further stale.
- The optional-cleanup wording-consistency nit from code review (three phrasings for one fact across four surfaces) is unaddressed — ship as-is or fold into a follow-up touch-up, your call.
- Re-evaluating effort tiers for the 5.6 generation (OpenAI's migration guidance suggests one level lower may suffice) remains an explicitly separate future task, not folded in here.
