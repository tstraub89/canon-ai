# Spec: default-codex-models-to-5-6-generation — Default Codex models to the 5.6 generation, retire 5.4-mini/5.5

> Written by: Claude | Review by: Codex
> Status: draft

## Amendment

Round-1 `spec_review` (`changes_requested`) raised two blocking spec defects; both accepted as genuine and fixed here:

1. **AC-1 overreached.** The original verification clause required the two whole `config` objects in `env.ts`/`policy.ts` to be "byte-identical," but they legitimately differ (`env.ts` carries `projectName`/`maxContextBytes` and a different field order — `claudeBudget` is in both), so literal compliance would force an out-of-scope config refactor. AC-1 now scopes the equivalence to the two Codex default/override *expressions* (the `codexModelMini`/`codexModelFull` lines) being identical across the files, and states explicitly that the surrounding objects' other differences stay.
2. **AC-2 contradicted its own AC-7/Docs Impact.** The original gate required **zero** retired-identifier hits outside an allowlist of immutable-*history* docs, but AC-7 permits the incidental test fixtures to remain, Docs Impact marks the `BACKLOG.md` item non-required, and `CHANGELOG.md` is a release-time step — all non-allowlisted hits the spec itself allows. AC-2 is reframed as a two-bucket classification: a zero-result gate on **current-state surfaces (Bucket A)** only, with every other hit classified into an explicit **permitted-to-remain set (Bucket B)** that now includes the test fixtures/comment, the backlog item, and the changelog. Docs Impact's stale `:1340` line reference corrected to `:1347`.

No scope change: both edits make the ACs coherent with the spec's existing Decision, Non-Goals, and AC-7. A pre-review self-check (`/canon-spec-review`) then tightened four consistency loose ends the AC-1 narrowing exposed: the `policy.ts` Affected-Files row no longer says "keep byte-identical"; AC-4 now *requires* dropping the retired identifier on its three surfaces (they are AC-2 Bucket A, so the earlier "or drop it" phrasing could have passed AC-4 yet failed AC-2's grep); `claudeBudget` removed from the env-only field list (it is in both files); and AC-5 no longer claims `dist/cli/index.js` inlines two config copies (it inlines one — `run-task.js` inlines both).

## Problem

Canon's shipped Codex model defaults are a generation behind. The fallback defaults are `gpt-5.4-mini` (mini tier) and `gpt-5.5` (full tier), resolved in two duplicated `config` objects:

- `scripts/run-task/env.ts:134-135`
- `scripts/run-task/policy.ts:23-24`

Canon now runs on the 5.6 generation in practice — the operator's environment overrides both tiers (`CODEX_MODEL_MINI=gpt-5.6-luna`, `CODEX_MODEL_FULL=gpt-5.6-sol`), and the current generation (luna reportedly matches or beats the prior flagship on coding-agent benchmarks) is what new adopters should get by default. Any adopter who does *not* set the override still gets the two-generations-old models, and every operator-facing surface that names the defaults (env-var table, current-state rationale prose) states retired model identifiers. This is a **canon-supplied default change** — a *minor* per `docs/decisions.md` §"Versioning and release policy" ("Changed canon-supplied defaults are minor"), human-authorized.

## Decision

Bump the shipped Codex model defaults to the 5.6 generation and update every operator-facing mention of the retired identifiers, without changing routing, effort tiers, or any other policy.

- **Mini tier** default: `gpt-5.4-mini` → `gpt-5.6-luna`.
- **Full tier** default: `gpt-5.5` → `gpt-5.6-sol`.
- The two duplicated code defaults change identically; the override env-var chains (`CODEX_MODEL_MINI` → `CODEX_MODEL_DEFAULT`; `CODEX_MODEL_FULL` → `CODEX_MODEL_DELICATE`) are unchanged.
- Every **current-state** operator surface naming the retired models is updated to the new defaults; **historical/dated** records are left untouched.
- A new dated `docs/decisions.md` entry records the generation re-baseline, explicitly reconciling it with the prior caution at `docs/decisions.md` (the "do not chase a Codex model-family upgrade … on the strength of the pre-correction iteration data" line in §"`spec_review` M effort raised").

**Consequence to note, not change:** the cold-Codex `code_review` lens reads `config.codexModelMini` (`codexMatrix()` in `scripts/pipeline-policy.ts`), so it moves to `gpt-5.6-luna` automatically. That lens uses the stock `codex review` prompt (not a canon-owned template), so no prompt change accompanies the model move. This pairs with the sibling task `recalibrate-spec-review-for-stronger-reviewer`, which recalibrates the one canon-owned reviewer prompt (`spec_review`) for the stronger generation; that task should land first so adopters bumped to 5.6 get the recalibrated prompt.

## Non-Goals

- **No effort-tier change.** The model/effort matrix in `scripts/pipeline-policy.ts` keeps every current effort value (including implement XL/delicate at `high`, not `xhigh`). This task swaps the *model strings* the matrix resolves, nothing else. Re-evaluating effort tiers for 5.6 (OpenAI's migration guidance suggests comparing one effort level lower) is a separate future task.
- **No new empirical claim about 5.6 behavior.** In particular, the retired-generation-specific rationale prose (e.g. "GPT-5.5 tends to overthink at `xhigh`") is reframed so it no longer names a retired model at all (per AC-4), and it is **not** rewritten to assert that the *new* default models overthink at `xhigh` — that property has not been evaluated for 5.6. The effort tier and its original basis are inherited as-is, pending eval.
- **No prompt recalibration.** The `spec_review` prompt recalibration is the sibling task, not this one.
- **No model-routing / tier-selection change.** Which size uses mini vs full is unchanged; routing `spec_review` to a higher-precision tier (e.g. Terra) is out of scope.
- **No edit to dated historical records.** `docs/pipeline-invocations.md` telemetry rows, the dated §"Model-generation re-baseline (2026-06)" and §"`spec_review` M effort raised" entries in `docs/decisions.md`, `docs/harness-audit-2026-06.md`, and `docs/canon-opus48-gpt55-report.md` (including its filename) record what was true when written and stay verbatim.
- **No override-chain or env-var-name change.** `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL` / `CODEX_MODEL_DEFAULT` / `CODEX_MODEL_DELICATE` keep their names and precedence.

## Acceptance Criteria

- [ ] AC-1 (code defaults bumped, both copies): In `scripts/run-task/env.ts` and `scripts/run-task/policy.ts`, the mini default resolves to `gpt-5.6-luna` and the full default to `gpt-5.6-sol`, with the override chains unchanged. Verify by reading both files: the `codexModelMini` fallback ends with `?? 'gpt-5.6-luna'` and the `codexModelFull` fallback with `?? 'gpt-5.6-sol'` in each file, and the two Codex default/override expressions (the `codexModelMini`/`codexModelFull` lines, env-var precedence chains included) are **identical to each other across the two files**. The surrounding `config` objects are *not* otherwise made identical — `env.ts` legitimately carries fields (`projectName`, `maxContextBytes`) and a field order `policy.ts` does not, and that asymmetry stays; only the two Codex default lines must match between the files.
- [ ] AC-2 (no retired identifier survives as a current default on any current-state surface): The implementer runs a fresh repo-wide grep for the retired identifiers `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5`, `GPT-5.4`, `GPT-5.5` (case-sensitive families as listed), including `README.md` and `.canon/`, and classifies **every** hit into one of two buckets. **Bucket A — current-state surfaces**, which must show **zero** retired-identifier hits after the change: code under `scripts/`, the env-var reference table, and current-state operator prose (`docs/pipeline-orchestrator.md`, `docs/product-context.md`, and the `templates/` mirror). **Bucket B — permitted-to-remain surfaces**, left untouched by this task: the immutable-history docs (`docs/pipeline-invocations.md`; the dated `docs/decisions.md` §"Model-generation re-baseline (2026-06)" and §"`spec_review` M effort raised" entries; `docs/harness-audit-2026-06.md`; `docs/canon-opus48-gpt55-report.md`), the incidental test fixtures/comments permitted by AC-7 (`tests/cli.test.ts`, `tests/run-task-safety.test.ts`, and the rationale comment in `tests/pipeline-policy.test.ts`), the `docs/BACKLOG.md` hits (both the `:1347` default-analysis item, non-required per Docs Impact, and the `:943` quoted historical log line, immutable evidence), and `CHANGELOG.md` (a release-time step). (The new strings `gpt-5.6-luna`/`gpt-5.6-sol` share no substring with the retired ones, so a zero-result gate on Bucket A is structurally sound.) Verify by running the grep and confirming every hit falls in Bucket B; the gate passes when Bucket A is empty. Any hit not covered by Bucket B that presents a retired model as canon's current default must be updated (or, if newly discovered and genuinely immutable/historical, added to Bucket B with a one-line justification).
- [ ] AC-3 (env-var default table updated + mirror synced): In `docs/pipeline-orchestrator.md`, the `CODEX_MODEL_MINI` and `CODEX_MODEL_FULL` reference-table default cells show `gpt-5.6-luna` and `gpt-5.6-sol`. `docs/pipeline-orchestrator.md` is canon-managed, so its `templates/docs/pipeline-orchestrator.md` mirror is regenerated by the sync step (not hand-edited). Verify the table cells show the new defaults and `npm run sync-templates:check` passes.
- [ ] AC-4 (current-state rationale prose de-stales, no new 5.6 claim): Current-state prose that names a retired model — `docs/pipeline-orchestrator.md` (the implement-effort rationale line), `docs/product-context.md` (the full-tier effort line), and the code comment in `scripts/pipeline-policy.ts` — is reframed so the retired identifier is **dropped entirely** (not merely recast as non-default), while **not** asserting the overthinking-at-`xhigh` property of the new models. The effort tier is described as inherited pending 5.6 re-eval; the historical model-specific reason may be preserved only by pointing to the dated `docs/decisions.md` entry (Bucket B), never by naming the retired model inline. Verify by reading each: none contains a retired identifier, none claims a 5.6 model overthinks at `xhigh`, and the tier is framed as inherited pending re-eval. (These three surfaces are all AC-2 Bucket A, so dropping the retired string is **required** — this is what makes AC-2's zero-result gate achievable for them, not an optional alternative.)
- [ ] AC-5 (both bundles rebuilt): `npm run build` is run and the rebuilt bundles carrying the defaults are committed — `dist/cli/index.js` inlines the `env.ts` config copy, and `dist/scripts/run-task.js` inlines both the `env.ts` and `policy.ts` copies. Verify the new strings appear in both bundles (both `gpt-5.6-luna`/`gpt-5.6-sol`, and no retired string survives) and the CI dist-clean check (`npm run build && git diff --exit-code -- dist/`) would pass on the committed tree.
- [ ] AC-6 (generation re-baseline recorded + prior caution reconciled): `docs/decisions.md` gains a new dated entry ("Model-generation re-baseline (2026-07)" or similar) stating the new defaults (mini `gpt-5.6-luna`, full `gpt-5.6-sol`), that it is a minor canon-supplied-default change, that effort tiers and routing are unchanged, and that it does **not** contradict the prior caution against chasing a GPT-5.6 upgrade *on the strength of pre-correction iteration data* (this is a generation-currency re-baseline of the shipped defaults, not a reroute-severity fix). The prior dated entries are not edited. Verify `docs/decisions.md` contains the new entry, the `:228`-area caution text is unchanged, and `npm run docs-refs-check` passes.
- [ ] AC-7 (suite stays green): `npm test`, `npm run lint`, `npm run type-check` pass. No test asserts the retired defaults as the canon default (confirmed during exploration: `pipeline-policy.test.ts` uses abstract `mini`/`full` sentinels; the three `gpt-5.4-mini` fixture strings in `tests/cli.test.ts` and `tests/run-task-safety.test.ts` are incidental sample data, not default assertions). Verify the full suite runs clean; refresh incidental fixture strings only if a reviewer prefers consistency, noting it as a non-behavioral touch-up.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/env.ts` | Bump mini/full fallback defaults to `gpt-5.6-luna`/`gpt-5.6-sol` (lines 134-135). |
| `scripts/run-task/policy.ts` | Identical bump in the duplicated `config` object (lines 23-24); the two Codex default lines stay identical to `env.ts`'s copy — the rest of the object legitimately differs (see AC-1), do not force it byte-identical. |
| `docs/pipeline-orchestrator.md` | Env-var table default cells (261-262) → new defaults (AC-3); reframe the implement-effort rationale line (222) so it doesn't name a retired model as current (AC-4). Canon-managed → `templates/` mirror auto-syncs. |
| `docs/product-context.md` | Reframe the full-tier effort line (91) per AC-4. Root-only doc (not canon-managed). |
| `scripts/pipeline-policy.ts` | Reframe the `xhigh`/GPT-5.5 code comment (159) per AC-4. No logic change — the matrix still resolves `config.codexModelMini/Full`. |
| `docs/decisions.md` | New dated re-baseline entry with the prior-caution reconciliation (AC-6). Root-only doc — no mirror. |
| `dist/cli/index.js` | Rebuilt bundle — inlines the defaults (AC-5). Declared for the base-drift gate. |
| `dist/scripts/run-task.js` | Rebuilt bundle — inlines both `config` copies (AC-5). Declared for the base-drift gate. |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror of `docs/pipeline-orchestrator.md`, regenerated by the sync step (pre-commit hook / `npm run sync-templates`); do not hand-edit. Declared as a Generated Artifact. |

### Interaction Dependencies

- `scripts/pipeline-policy.ts` `codexMatrix()` resolves every phase/size cell from `config.codexModelMini`/`config.codexModelFull` — no phase hardcodes a model string, so the two default edits are the single source of truth. The `code_review` cold-Codex lens (all sizes → `config.codexModelMini`) therefore moves to `gpt-5.6-luna` with no separate edit.
- Both `dist/` entry points inline the defaults (`env.ts` in both; `policy.ts`'s copy also in `run-task.js`), so a build rewrites both artifacts. Both declared.
- `docs/pipeline-orchestrator.md` is in `CANON_OWNED`; its mirror must be declared and synced. `docs/product-context.md` and `docs/decisions.md` are root-only (confirm against `src/lib/canon-owned.ts`) — declaring a mirror for them would fail the handoff-diff preflight.

### Data Model Changes

None. No type, schema, or `status.json` shape change.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite (AC-7)
- [x] `npm run build` — defaults feed both bundles; commit `dist/cli/index.js` and `dist/scripts/run-task.js` (AC-5)
- [x] `npm run docs-refs-check` — `docs/pipeline-orchestrator.md`, `docs/product-context.md`, `docs/decisions.md` change (AC-3, AC-4, AC-6)
- [x] `npm run sync-templates:check` — `docs/pipeline-orchestrator.md` is canon-managed; the mirror must stay aligned (AC-3)

## Docs Impact

- `docs/pipeline-orchestrator.md` — env-var table + effort-rationale prose updated (AC-3, AC-4); this is the change.
- `docs/product-context.md` — full-tier effort line reframed (AC-4); this is the change.
- `docs/decisions.md` — new re-baseline entry (AC-6); this is the change.
- `docs/BACKLOG.md:1347` — a backlog analysis item currently states the old defaults (`gpt-5.4-mini`/`gpt-5.5`) as the operative scope of an open question about identifier validity across adopter installs. Not operator guidance and (per AC-2 Bucket B) not gated, but its premise shifts once defaults change; the implementer should update it to reference the new defaults or note the change (non-behavioral). Flagged, not required. (The `:943` retired-id hit in the same file is a quoted historical log line — immutable evidence, leave verbatim.)
- `CHANGELOG.md` — a "Changed" entry for the new defaults is a release-time step (handled via `/canon-changelog`), not part of this task's ACs.
- `docs/patterns.md`, `docs/codebase-map.md`, `docs/architecture.md` — no staleness.

## Known Risks

- **Missing a current-state surface.** The classic operator-guidance failure is updating code but leaving a doc naming the old default. Mitigated by AC-2's repo-wide grep with a zero-result gate on current-state surfaces (Bucket A) and a permitted-to-remain classification for every other hit (Bucket B), run fresh by the implementer.
- **Editing an immutable record.** The inverse risk: "fixing" a dated decision entry, telemetry row, or archived report. Mitigated by AC-2/AC-6 enumerating the allowlist and requiring the dated entries to stay verbatim.
- **Asserting an unverified 5.6 claim.** Reframing the `xhigh`-overthinking prose could tempt a rewrite that attributes the overthinking property to `gpt-5.6-sol`. AC-4 forbids that — the property is unevaluated for 5.6; the effort tier is inherited, not re-justified.
- **Mirror drift / dist-clean.** Hand-editing the `templates/` mirror, or forgetting the build, bounces `sync-templates:check` / the dist-clean CI check. Both are in Validation Required.
- **Decision conflict read as contradiction.** If the new decisions entry doesn't explicitly reconcile with the prior "don't chase GPT-5.6 … on pre-correction iteration data" caution, a reviewer could read B as violating a settled decision. AC-6 requires the reconciliation and leaves the prior entry intact.

## Human Test Plan

1. In a fresh project that installs canon and does not set any Codex model override, start a task and run the pipeline. Expected: the pipeline reports the current-generation Codex models (the fast/mini tier and the full tier) rather than the older ones.
2. Read canon's environment-variable reference and the tier/effort explanation in the operator docs. Expected: the documented default model names match what actually runs, and no explanation presents an old model as canon's current default.
3. Read canon's decision log. Expected: a new entry explains that canon's default models were moved to the current generation, that this is a routine default change, and that it doesn't conflict with the earlier note about not upgrading models to fix review churn.
4. Confirm the project's automated checks pass on the change.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] If this spec replaces existing behavior: framed as replacement (retired identifiers → new defaults; AC-2 pins a zero-result grep on the retired string families with an explicit immutable allowlist)
- [x] Known Risks covers failure modes for the trickiest ACs (missed surface, edited immutable record, unverified 5.6 claim, mirror/dist drift, decision-conflict misread)
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has entries marked `- [x]`
- [x] Non-Goals rules out the tempting scope expansions (effort tiers, new 5.6 claims, prompt recalibration, routing, historical records, override chain) — each backed by a positive scope bound
- [x] Symbols/paths named in ACs exist and were grep-verified: `env.ts:134-135`, `policy.ts:23-24`, `pipeline-policy.ts` `codexMatrix()` + comment at :159, `docs/pipeline-orchestrator.md:222,261-262`, `docs/product-context.md:91`, the `docs/decisions.md` caution text, both `dist/` bundles
- [x] Codebase-wide term change gated per string family, not per enumerated hit: AC-2 decomposes the retired term into its case-sensitive families and gates each with a zero-result grep over current-state surfaces (Bucket A) plus a permitted-to-remain classification for every other hit (Bucket B: immutable-history docs, incidental test fixtures/comments, non-required backlog/changelog); no substring collision with the new `gpt-5.6-*` strings makes zero-result gating sound
- [x] (Bug/flake fixes) N/A — this is a configuration/default change, not a bug fix
