# Plan: default-codex-models-to-5-6-generation

> Spec: `tasks/default-codex-models-to-5-6-generation/spec.md` (verdict: `approved_with_nits`)

Spec-review nit incorporated: Step 4 below names the `docs/BACKLOG.md:943` historical log hit explicitly in the Bucket B classification, not just the fallback "genuinely immutable" sentence.

## Step 1 — Bump the two code defaults (AC-1)

1. `scripts/run-task/env.ts:134-135`: change
   - `codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? 'gpt-5.4-mini',`
   - `codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? 'gpt-5.5',`

   to

   - `codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? 'gpt-5.6-luna',`
   - `codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? 'gpt-5.6-sol',`

2. `scripts/run-task/policy.ts:23-24`: identical edit, same two lines, same fallback chain. Do **not** touch any other field in either `config` object — `env.ts`'s `projectName`/`maxContextBytes` and field-order differences from `policy.ts` are intentional (spec-review confirmed this in `notes.md`); only these two lines need to match across files.

Verify: `grep -n "codexModel" scripts/run-task/env.ts scripts/run-task/policy.ts` shows identical fallback chains ending in `'gpt-5.6-luna'` / `'gpt-5.6-sol'` in both files.

## Step 2 — Env-var reference table (AC-3)

`docs/pipeline-orchestrator.md:261-262`:

```
| `CODEX_MODEL_MINI` | `gpt-5.4-mini` | Codex model for XS/S/M/L non-delicate phases. |
| `CODEX_MODEL_FULL` | `gpt-5.5` | Codex model for XL or delicate phases. |
```

→

```
| `CODEX_MODEL_MINI` | `gpt-5.6-luna` | Codex model for XS/S/M/L non-delicate phases. |
| `CODEX_MODEL_FULL` | `gpt-5.6-sol` | Codex model for XL or delicate phases. |
```

This file is `CANON_OWNED` (`src/lib/canon-owned.ts:23`) — do not hand-edit `templates/docs/pipeline-orchestrator.md`; it regenerates via the pre-commit hook / `npm run sync-templates`. Declare both the root file and its mirror in the handoff Changes table (see patterns.md Known Pitfall "Declare `templates/` mirrors ... in BOTH the spec Affected Files and the handoff Changes table" — already declared in the spec's Affected Files).

## Step 3 — De-stale the three rationale surfaces without asserting a new 5.6 claim (AC-4)

All three currently read "GPT-5.5 tends to overthink at `xhigh`" or an equivalent. Drop the retired identifier entirely; keep the tier and point to the historical decision entry instead of restating the (unverified-for-5.6) reason inline.

**a. `docs/pipeline-orchestrator.md:222`**

Current:
> Codex is tuned for token efficiency — the mini model handles most phases; the full model only comes out for XL or delicate work. XL/delicate implement runs at `high`, not `xhigh`: GPT-5.5 tends to overthink at `xhigh` with open-ended tool access (cost without quality gain). Raise via env only if eval shows under-reasoning.

Replace with (drops the model name, keeps the tier + rationale pointer, no new-model claim):
> Codex is tuned for token efficiency — the mini model handles most phases; the full model only comes out for XL or delicate work. XL/delicate implement runs at `high`, not `xhigh` — the prior generation's model showed overthinking at `xhigh` with open-ended tool access (cost without quality gain); the tier is inherited pending a 5.6-generation re-eval. See [`docs/decisions.md`](docs/decisions.md) §"Model-generation re-baseline (2026-06)". Raise via env only if eval shows under-reasoning.

**b. `docs/product-context.md:91`**

Current:
> - **Full tier**: anything `S`, `M`, `L`, `XL`, or `delicate`. Spec and plan in separate Claude sessions. Codex runs spec review. Higher model effort scaling with size; XL/delicate uses the full Codex model at `high` effort (re-baselined from `xhigh` in 1.11.0 — GPT-5.5 overthinks at `xhigh` with open-ended tools; see `docs/decisions.md` §"Model-generation re-baseline (2026-06)"). Claude's `code_review` for XL/delicate stays Opus at `xhigh`.

Replace with:
> - **Full tier**: anything `S`, `M`, `L`, `XL`, or `delicate`. Spec and plan in separate Claude sessions. Codex runs spec review. Higher model effort scaling with size; XL/delicate uses the full Codex model at `high` effort (re-baselined from `xhigh` in 1.11.0 — the prior-generation model overthought at `xhigh` with open-ended tools; tier inherited pending 5.6-generation re-eval — see `docs/decisions.md` §"Model-generation re-baseline (2026-06)"). Claude's `code_review` for XL/delicate stays Opus at `xhigh`.

**c. `scripts/pipeline-policy.ts:159`** (comment inside `codexMatrix()`)

Current block (lines ~157-162):
```
//   implement:   mini through L. XS/S get medium effort (token savings on
//                the smallest changes). XL/delicate: full model at high. Not
//                xhigh — GPT-5.5 tends to overthink at xhigh with open-ended
//                tool access (cost without quality gain), and canon's thesis
//                is token discipline over reflexive max-effort. Raise via
//                env only if eval shows under-reasoning on delicate work.
```

Replace the retired-model line only, keep the rest of the comment block's meaning intact:
```
//   implement:   mini through L. XS/S get medium effort (token savings on
//                the smallest changes). XL/delicate: full model at high. Not
//                xhigh — the prior generation overthought at xhigh with
//                open-ended tool access (cost without quality gain); tier
//                inherited pending 5.6-generation re-eval, and canon's thesis
//                is token discipline over reflexive max-effort. Raise via
//                env only if eval shows under-reasoning on delicate work.
```

(Reflow to the file's existing comment width convention; content is what matters, not exact line breaks.)

Verify: `grep -rn "gpt-5\.4\|gpt-5\.5\|GPT-5\.4\|GPT-5\.5" docs/pipeline-orchestrator.md docs/product-context.md scripts/pipeline-policy.ts` returns nothing — confirm none of these three files still contains a retired identifier, and neither rewritten sentence claims the *new* model overthinks at `xhigh`.

## Step 4 — Repeat the repo-wide grep and classify every hit (AC-2)

Run fresh (case-sensitive families): grep for `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5`, `GPT-5.4`, `GPT-5.5` across the repo (`scripts/`, `docs/`, `templates/`, `tests/`, `README.md`, `.canon/`, `CHANGELOG.md`, and `dist/` after Step 7's rebuild).

Already identified via exploration (re-verify after Steps 1–3):

**Bucket A (must be zero after this task)**:
- `scripts/run-task/env.ts`, `scripts/run-task/policy.ts` — fixed in Step 1.
- `docs/pipeline-orchestrator.md` (table cells :261-262, rationale :222) — fixed in Steps 2–3.
- `docs/product-context.md:91` — fixed in Step 3.
- `scripts/pipeline-policy.ts:159` comment — fixed in Step 3.
- `templates/docs/pipeline-orchestrator.md` — resolved automatically by the sync step after Step 2 (do not hand-edit).

**Bucket B (permitted to remain, do not touch)**:
- `docs/pipeline-invocations.md` — telemetry rows, immutable.
- `docs/decisions.md` §"Model-generation re-baseline (2026-06)" (lines ~201-217, incl. `_Generation: Opus 4.8 / Sonnet 4.6 / GPT-5.5._` at :203 and "GPT-5.5 overthinks" at :210) and §"`spec_review` M effort raised" (lines ~220-230, incl. the practitioner-study line at :228 and the "Do not chase a Codex model-family upgrade... on the strength of the pre-correction iteration data" caution at :230) — dated historical entries, left verbatim.
- `docs/harness-audit-2026-06.md`, `docs/canon-opus48-gpt55-report.md` (filename included) — archived reports, immutable.
- `tests/cli.test.ts:1332` (`'model = "gpt-5.4-mini"'`) and `:2533` (telemetry fixture row `gpt-5.4-mini`) — incidental sample data per AC-7.
- `tests/run-task-safety.test.ts:5287` (`model: 'gpt-5.4-mini'` in a `recordMetric` fixture string) — incidental sample data per AC-7.
- `tests/pipeline-policy.test.ts:153` (comment: `// re-baselined 2026-06: was xhigh (GPT-5.5 overthinks at xhigh w/ open-ended tools)`) — rationale comment permitted by AC-7.
- `docs/BACKLOG.md:1347` — default-analysis backlog item (non-required per Docs Impact; optionally update per Step 5).
- `docs/BACKLOG.md:943` — quoted historical log line (`→ Model: gpt-5.5 | Effort: high`) inside a stall-diagnosis writeup; immutable evidence of what actually ran at the time. **Explicitly named here per the spec-review nit** — this is the second BACKLOG.md hit Docs Impact calls out; leave verbatim, do not fold into the :1347 edit.
- `CHANGELOG.md` — no current hits found; a later release-time entry quoting the old default is expected and out of scope here.

No hits found in `README.md` or `.canon/` during exploration — re-confirm with the fresh grep since Steps 1-3 don't touch them.

If the fresh grep surfaces anything not listed above, classify it: if it presents a retired model as canon's current default → fix it (Bucket A); if genuinely historical/immutable and newly discovered → add to Bucket B with a one-line justification in the handoff.

Verify: Bucket A grep is empty; every other hit matches the Bucket B list above (or is added with justification).

## Step 5 — Docs Impact: optional non-behavioral touch-up (not gated)

`docs/BACKLOG.md:1347` — the default-analysis item's premise ("defaults `gpt-5.4-mini`/`gpt-5.5`") is now stale. Update the scope line to reference the new defaults (`gpt-5.6-luna`/`gpt-5.6-sol`) or add a one-line note that defaults moved, per Docs Impact. Flagged, not required — skip if time-constrained, but if touched, do not alter the `:943` log-quote hit in the same file.

## Step 6 — New decisions.md entry (AC-6)

Append a new dated section at the end of `docs/decisions.md` (check the file's current tail before inserting — other tasks may have appended since exploration), following the same Decision/Why/Rule structure as the existing "Model-generation re-baseline" / "effort raised" entries:

```markdown
---

## Model-generation re-baseline (2026-07): Codex defaults → 5.6 generation

_Generation: gpt-5.6-luna (mini) / gpt-5.6-sol (full)._

**Decision**: Bump canon's shipped Codex defaults from the 5.4/5.5 generation (`gpt-5.4-mini`, `gpt-5.5`) to the 5.6 generation (`gpt-5.6-luna`, `gpt-5.6-sol`). This is a **minor** canon-supplied-default change per §"Versioning and release policy". Effort tiers, routing (which size uses mini vs. full), and the override env-var chains (`CODEX_MODEL_MINI`/`CODEX_MODEL_FULL`/`CODEX_MODEL_DEFAULT`/`CODEX_MODEL_DELICATE`) are all unchanged — only the two fallback model strings move.

**Why**: The operator's own environment had already overridden both tiers to the 5.6 generation in practice, and 5.6-luna reportedly matches or beats the prior flagship on coding-agent benchmarks. Adopters who don't set an override were shipping two generations behind current. This is a generation-currency re-baseline of the shipped defaults, not a response to review-quality churn.

**Does this contradict the `spec_review` M-effort entry's caution?** No. The §"`spec_review` M effort raised" entry above says: "Do not chase a Codex model-family upgrade (e.g. GPT-5.6 Luna/Sol) for M or L on the strength of the pre-correction iteration data — that data pointed at a spec_review effort gap, not a model-capability gap." That caution is scoped to *using a model upgrade to fix reroute-severity/iteration-count churn* — it does not bar a routine currency bump of the shipped default made on its own, independent grounds (generation staleness, benchmark parity), unconnected to the M/L reroute-rate analysis. Re-measuring M vs. L reroute rate (per that entry) remains a separate, still-open follow-up; this change does not substitute for it.

**Rule**: Shipped defaults are `gpt-5.6-luna` (mini) and `gpt-5.6-sol` (full) as of this entry. Effort tiers and the model/effort matrix in `scripts/pipeline-policy.ts` are unchanged; re-evaluating effort tiers for the 5.6 generation (OpenAI's migration guidance suggests comparing one effort level lower) is a separate future task, not folded into this change.
```

Do not edit the two existing dated entries above it (§"Model-generation re-baseline (2026-06)", §"`spec_review` M effort raised") — verify their text, including the `:230`-area caution line, is byte-unchanged after this edit.

Verify: `npm run docs-refs-check` passes; the two prior entries are unchanged (`git diff` on `docs/decisions.md` shows only an appended section, no deletions/edits above it).

## Step 7 — Rebuild both bundles (AC-5)

Run `npm run build`. Confirm:
- `dist/cli/index.js` contains `gpt-5.6-luna` / `gpt-5.6-sol` (inlines `env.ts`'s copy) and no retired string.
- `dist/scripts/run-task.js` contains both new strings twice (inlines both `env.ts` and `policy.ts` copies) and no retired string.

Commit the rebuilt `dist/` files — this is what makes the CI dist-clean check (`npm run build && git diff --exit-code -- dist/`) pass.

## Step 8 — Validation suite (AC-7)

Run in order: `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (already done in Step 7 — re-run if any later edit touches source), `npm run docs-refs-check`, `npm run sync-templates:check`.

No test asserts the retired defaults as canon's default (`pipeline-policy.test.ts` uses abstract `mini`/`full` sentinels, confirmed in exploration). The `tests/cli.test.ts` and `tests/run-task-safety.test.ts` fixture strings are incidental sample data — leave as-is unless doing the optional non-behavioral consistency touch-up AC-7 permits (not required).

## Handoff notes

- Handoff Changes table must list: `scripts/run-task/env.ts`, `scripts/run-task/policy.ts`, `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` (generated mirror), `docs/product-context.md`, `scripts/pipeline-policy.ts`, `docs/decisions.md`, `dist/cli/index.js`, `dist/scripts/run-task.js`, and (if done) `docs/BACKLOG.md`.
- `docs/product-context.md` and `docs/decisions.md` are root-only — do **not** declare or create a `templates/` mirror row for either (patterns.md "root-only doc" pitfall).
- Plain config/prose change to non-hot-path surfaces (model default strings, doc prose, one comment) — no `pipeline-policy.ts` *logic* change (only a comment edit), no new phase, no `status.json` shape change. The Pure Policy + Test Discipline pattern's "every routing decision has a test row" applies to matrix *values*, which are untouched here, so no new test row is required for the comment edit.
