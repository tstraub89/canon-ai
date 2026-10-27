# Spec: default-qa-model-to-haiku — Make Claude Haiku 5.5 the default QA model

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon's `qa` phase runs on the light Claude tier (`sonnet` / `medium`) at every size. The 2026-09 Claude re-baseline entry in `docs/decisions.md` kept it there because QA "writes completion artifacts but cannot block or reroute". That reasoning also supports a cheaper model: QA failures cost summary quality, not pipeline correctness.

**Field evidence.** The operator has run `CLAUDE_MODEL_QA=claude-haiku-5-5` since about 2026-10-06, across canon-ai and one adopter repo. The operator's assessment of about 37 Haiku-QA tasks across both repos:

- no QA phase failures, no budget-cap hits, and no QA retries;
- every completed task got its task-quality-log row;
- completion summaries (`done.md`) ran about 75–115 lines, as long as or longer than in the Sonnet era;
- a spot-checked summary was accurate and candid about what was not verified.

canon-ai's own `docs/pipeline-invocations.md` holds 20 of those QA invocations on `claude-haiku-5-5` (the first on 2026-10-16), all with status `ok`, 44–214 s each. The adopter rows are not in this repo. This is an operator-reported, uncontrolled comparison, not a canon evaluation.

**Effort is already compatible.** Those runs passed `--effort medium` to Haiku through the existing QA cell, so the effort column needs no change.

**Where the QA model resolves today.** `resolveClaudeModel()` in `src/lib/pipeline-policy.ts` reads `CLAUDE_CELLS.qa[size].tier` (`'light'` at every size), then applies: `CLAUDE_MODEL_QA` pin → `CLAUDE_MODEL_LIGHT` → legacy `CLAUDE_MODEL` → `'sonnet'`. The same chain is restated in the 2026-09 decisions entry (table row and **Override precedence** paragraph), in `docs/pipeline-orchestrator.md` (Claude matrix table, its prose, the Environment Variables lead-in and the `CLAUDE_MODEL_LIGHT` / `CLAUDE_MODEL_QA` / `CLAUDE_MODEL` rows), in `docs/product-context.md`'s full-tier summary, in the `PipelinePolicy.effectiveSize` comment ("QA remains light/medium"), and in the `CLAUDE_MODEL` legacy-warning text in `src/orchestrator/env.ts`.

### Design question: QA-specific default or a third Claude tier

Three shapes were considered.

1. **Third tier** (`light` / `strong` / a new small tier with its own `CLAUDE_MODEL_<X>` variable defaulting to Haiku). Its only member would be `qa`, which already has a phase pin (`CLAUDE_MODEL_QA`) that covers every size. The new tier variable would therefore be a second name for the same knob, adding an env var, a docs row and a test family with no reachable difference in behavior.
2. **QA stays in the light tier; only the final fallback changes to Haiku.** The light tier would no longer have one default (`sonnet` for XS/S spec/plan/review, Haiku for QA), and `CLAUDE_MODEL_LIGHT` would still override QA. An adopter who sets `CLAUDE_MODEL_LIGHT` to pin a Sonnet version would silently keep Sonnet on QA and never receive the new default.
3. **QA leaves the tier system and gets its own default model** (recommended). QA resolves `CLAUDE_MODEL_QA` → legacy `CLAUDE_MODEL` → `claude-haiku-5-5`. The light and strong tiers each keep one default and stop reaching QA. No env var is added.

Option 3 is chosen. It keeps the invariant "each tier variable has one default and covers the cells that name that tier", and the knob adopters need already exists. If a second Claude cell ever wants a Haiku-class default, promote the QA default to a named tier at that point.

**Default change rather than a documented opt-in.** The opt-in already exists (`CLAUDE_MODEL_QA`), and leaving Sonnet as the default would make every adopter pay Sonnet prices for a phase that cannot block or reroute. Because the evidence is uncontrolled, the decision entry treats it as a hypothesis to measure, with a one-variable rollback.

**Model ID.** The default is the full ID `claude-haiku-5-5`, the model the field evidence covers, rather than the floating `haiku` alias. The light/strong defaults stay as aliases. A future Haiku generation should be adopted by a decision entry with its own evidence, not by alias drift on a phase that has only operator evidence.

## Decision

- **QA default model:** the `qa` cell at every size (XS through XL/delicate) defaults to `claude-haiku-5-5` at `medium` effort. Effort is unchanged.
- **QA precedence** (first match wins): `CLAUDE_MODEL_QA` → legacy `CLAUDE_MODEL` → `claude-haiku-5-5`. `CLAUDE_MODEL_LIGHT` and `CLAUDE_MODEL_STRONG` no longer affect QA.
- **Other cells unchanged:** `spec`, `plan` and `code_review` keep their tiers, effort, pins and defaults (`sonnet` light, `opus` strong). Budgets, loop caps and Codex policy are unchanged.
- **Pinned-adopter changes** (adopters who set `CLAUDE_MODEL_QA` see no change in any case):
  - Neither `CLAUDE_MODEL_LIGHT` nor `CLAUDE_MODEL` set: QA moves from `sonnet` to `claude-haiku-5-5`. This is the intended default change.
  - `CLAUDE_MODEL_LIGHT=X` without `CLAUDE_MODEL`: QA moves from `X` to `claude-haiku-5-5`. Intended; otherwise these adopters would never receive the new default.
  - `CLAUDE_MODEL_LIGHT=X` and `CLAUDE_MODEL=Y`: QA moves from `X` to `Y`, because the light variable no longer reaches QA and legacy beats the QA default. This is a side effect of QA leaving the tier system, recorded so it isn't a surprise.
  - `CLAUDE_MODEL=Y` without `CLAUDE_MODEL_LIGHT`: no change; QA stays `Y`.
  - Rollback for any of these: set `CLAUDE_MODEL_QA` to the previous QA model (`sonnet` for an adopter who set nothing, otherwise their light-tier model `X`). It applies at every size.
- **Release class:** a canon-supplied default change, so a **minor** release item per §"Versioning and release policy" in `docs/decisions.md`.

## Non-Goals

- **No new env var and no third tier variable.** No `CLAUDE_MODEL_*` variable is added. AC-5 backs this with an exact-set grep. How QA's default is represented internally (for example a new `ClaudeTier` value with no env var, or a per-cell default) is a plan/implement choice.
- **No change to QA effort, budget or prompt.** The QA cells stay `medium`; the single-pass budget curve and `src/orchestrator/prompts/templates/qa.md` are untouched. AC-1's table pins effort.
- **No change to other Claude or Codex cells.** AC-1 pins every non-QA cell to its current value.
- **No change to the `/canon-spec-review` factual lens**, which already passes `model: haiku` and is outside the pipeline matrix.
- **No fix to the existing `??` vs `||` empty-string handling** of `CLAUDE_MODEL_QA` in `src/orchestrator/policy.ts`. An empty `CLAUDE_MODEL_QA` keeps today's behavior.
- **No change to the QA `done.md` stdout-salvage path** in `src/orchestrator/phases/qa.ts`.
- **No CHANGELOG edit.** `/canon-changelog` drafts release notes at release time.
- **No edits to historical material:** `docs/harness-audit-2026-06.md`, `docs/canon-opus48-gpt55-report.md`, `docs/BACKLOG.md`, `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, archived tasks, and the body text of past `docs/decisions.md` entries (which get inline notes only).

## Acceptance Criteria

- [ ] **AC-1: matrix cells.** With no Claude model env vars set, `getPipelinePolicy(...).claude('qa')` returns `{ model: 'claude-haiku-5-5', effort: 'medium' }` for XS, S, M, L, XL, and delicate M. Every `spec`, `plan` and `code_review` cell returns exactly its current model and effort. Verified by the `CLAUDE_MATRIX_TABLE` rows in `tests/pipeline-policy.test.ts` (QA rows updated, other rows unchanged and passing) and by the existing "delicate M promotes spec, plan, and review, but not qa" and "no Claude model variables uses defaults" tests, updated to expect `claude-haiku-5-5` for QA.
- [ ] **AC-2: QA precedence.** New or updated tests in `tests/pipeline-policy.test.ts` assert, for QA at every size:
  - `CLAUDE_MODEL_LIGHT=custom-light` alone → QA is `claude-haiku-5-5`; the XS/S spec/plan/code_review cells are `custom-light`. (The existing "light tier variable only changes light cells" test already expresses this once QA rows are Haiku; it must still pass.)
  - `CLAUDE_MODEL_STRONG=custom-strong` alone, including delicate M → QA is `claude-haiku-5-5`.
  - `CLAUDE_MODEL=legacy` alone → QA is `legacy`; `CLAUDE_MODEL=legacy` with `CLAUDE_MODEL_LIGHT=light` → QA is `legacy`.
  - `CLAUDE_MODEL_QA=pinned` with `CLAUDE_MODEL=legacy` and `CLAUDE_MODEL_LIGHT=light` → QA is `pinned`.
  - The "phase pin beats tier variable" test's QA assertion changes from `light` to `claude-haiku-5-5`.
  - Effort is `medium` in every case.
- [ ] **AC-3: legacy warning text.** The `CLAUDE_MODEL` entry in `LEGACY_FALLBACK_ENV_VARS` (`src/orchestrator/env.ts`) names `CLAUDE_MODEL_QA` alongside `CLAUDE_MODEL_LIGHT` and `CLAUDE_MODEL_STRONG` as replacements, and still says it is honored as a fallback for every Claude phase. It makes clear that QA needs `CLAUDE_MODEL_QA` to keep the legacy model once the tier variables replace `CLAUDE_MODEL`; exact wording is the implementer's. The "legacy warning names tier variables and every-phase fallback" test adds `assert.match(entry.replacement, /CLAUDE_MODEL_QA/)` and keeps its existing assertions.
- [ ] **AC-4: docs sweep.** Every restatement of the QA cell and the light tier's coverage reflects *Decision*:
  - `docs/pipeline-orchestrator.md` §"Claude Model/Effort Matrix": the lead-in names the QA default; the `qa` table row reads `claude-haiku-5-5 / medium` in every column; the prose after the table says QA runs its own default model rather than the light tier, and why (cannot block or reroute; the operator field evidence).
  - `docs/pipeline-orchestrator.md` §"Environment Variables": the lead-in no longer says the light tier covers QA; the `CLAUDE_MODEL_LIGHT` row lists only XS/S `spec`/`plan`/`code_review`; the `CLAUDE_MODEL_QA` row states the QA default (`claude-haiku-5-5`), that it is QA's only override besides legacy `CLAUDE_MODEL`, and that setting it to `sonnet` (or the previous light-tier model) restores the pre-change QA model; the `CLAUDE_MODEL` row's precedence sentence is correct for QA (pin → this fallback → QA default) as well as for tiered cells.
  - `docs/product-context.md`'s full-tier summary says QA runs Haiku/medium, not "Sonnet/medium".
  - The `effectiveSize` comment on `PipelinePolicy` in `src/lib/pipeline-policy.ts` says QA keeps its own default model at `medium` regardless of size, replacing "QA remains light/medium".
  - These zero-match greps pass, each targeting a known stale phrasing:
    - `grep -nE "^\| .qa. \| sonnet" docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md`
    - `grep -rniE "QA remains (Sonnet|light)|stays light/medium|and for QA at every size|and \`qa\` at every size" docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md docs/product-context.md src/lib/pipeline-policy.ts`
  - The greps prove only that the known phrasings are gone. The implementer reads §"Claude Model/Effort Matrix" and §"Environment Variables" of `docs/pipeline-orchestrator.md` and the tier summary in `docs/product-context.md` in full for paraphrases.
- [ ] **AC-5: no new knob.** `grep -rhoE "CLAUDE_MODEL_[A-Z_]+" src | sort -u` lists exactly the set on `main` before this change: `CLAUDE_MODEL_LIGHT`, `_PLAN`, `_QA`, `_REVIEW`, `_REVIEW_LARGE`, `_SPEC`, `_STRONG`.
- [ ] **AC-6: decisions entry.** `docs/decisions.md` gains one new entry, placed immediately after §"Codex implement effort raised; full-model default → GPT-6.1 Sol (2026-10)", with a `_Generation:_` line naming Haiku 5.5 / Sonnet 5.5 / Opus 5.5 and **Decision**, **Why**, **Override precedence** and **Rule** sections. It:
  - (a) gives the current Claude matrix table with the QA row at `claude-haiku-5-5 / medium`;
  - (b) records the field evidence from *Problem*, labelled operator-reported and uncontrolled, including the 20 canon-ai invocation rows;
  - (c) records the design choice (QA-specific default over a third tier or a light-tier fallback change) with the reasons from *Problem*, and the trigger for revisiting it (a second Haiku-class cell);
  - (d) states the full precedence for every cell: phase pin → tier variable (tiered cells only) → legacy `CLAUDE_MODEL` → default (`sonnet` light, `opus` strong, `claude-haiku-5-5` QA); pins replace the model only and effort has no env override;
  - (e) states every pinned-adopter change and the rollback from *Decision*, and why the default is the full ID rather than the `haiku` alias;
  - (f) names the follow-up measurement, keyed on the invocation log's Model column rather than the entry's date (canon-ai's own QA has run Haiku through an operator pin since before this entry): compare `qa` rows on Sonnet against rows on `claude-haiku-5-5` in `docs/pipeline-invocations.md` for Status and Duration, and note whether `done.md` gaps surface at `human_review`. It also says that adopter-side data exists only where an adopter keeps its own invocation log.

  Inline "superseded by" notes pointing to the new entry, leaving the original text in place, go on the 2026-09 "Model-generation re-baseline (2026-09): Claude defaults → 5.5 generation" entry's `qa` table row (or the table's lead-in), its "QA … stays light/medium" sentence, and its **Override precedence** paragraph.
- [ ] **AC-7: mirror and build outputs in sync.**
  - `templates/docs/pipeline-orchestrator.md` is regenerated from the root copy with `npm run sync-templates`; `npm run sync-templates:check` passes.
  - `dist/` is rebuilt with `npm run build` and committed; `git diff --exit-code -- dist/` is clean after a fresh build. `grep -c "claude-haiku-5-5" dist/orchestrator/run-task.js` is at least 1. The rebuilt bundle must not be reverted.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/pipeline-policy.ts` | QA cells stop naming the light tier and resolve `CLAUDE_MODEL_QA` → legacy → `claude-haiku-5-5`; update the `effectiveSize` comment per AC-4 |
| `src/orchestrator/env.ts` | `CLAUDE_MODEL` legacy-warning replacement text names `CLAUDE_MODEL_QA` per AC-3 |
| `tests/pipeline-policy.test.ts` | QA rows of `CLAUDE_MATRIX_TABLE`; QA assertions in the defaults, delicate, strong-tier, phase-pin and legacy-warning tests; new QA precedence cases per AC-2 |
| `docs/pipeline-orchestrator.md` | Claude matrix lead-in, table and prose; Environment Variables lead-in and the `CLAUDE_MODEL_LIGHT`, `CLAUDE_MODEL_QA` and `CLAUDE_MODEL` rows |
| `templates/docs/pipeline-orchestrator.md` | regenerated by `npm run sync-templates`; never hand-edited |
| `docs/product-context.md` | full-tier summary's QA model |
| `docs/decisions.md` | new entry per AC-6; inline supersede notes on the 2026-09 Claude entry |
| `dist/orchestrator/run-task.js` | rebuilt by `npm run build`; commit it, do not revert |
| `dist/cli/index.js` | rebuilt by `npm run build` if the build changes it; commit it, do not revert |

### Interaction Dependencies

- `src/orchestrator/policy.ts` already reads `CLAUDE_MODEL_QA`, `CLAUDE_MODEL_LIGHT`, `CLAUDE_MODEL_STRONG` and `CLAUDE_MODEL` into `PolicyConfig`; no field is added or removed, so it needs no change.
- Three Claude sessions resolve the QA cell through `getClaudeConfig('qa', …)` and inherit the new default with no code change:
  - `runQaPhase` in `src/orchestrator/phases/qa.ts`, the QA phase itself;
  - `retryAgentForPhase` in `src/orchestrator/main.ts`, the one-shot recovery retry for `qa`;
  - `fixUpOwnArtifactRefs` in `src/orchestrator/main.ts` with phase `qa`, the artifact-ref fix-up session (logged as `qa_fixup`). The field evidence has no `qa_fixup` runs on Haiku.
- The dry-run line (`<phase>: Claude / <model> / <effort>`) and the runtime `Model: … | Effort: … | Budget: …` line print the resolved model without validating it.
- The QA `done.md` salvage path (Claude streams the summary to stdout instead of writing it) is single-task only; bundles are not salvaged. Unchanged here; see Known Risks.
- canon-on-canon pipeline runs execute the globally installed canon. The new default takes effect for those runs only after release and `canon update`; the operator's `CLAUDE_MODEL_QA` setting masks it either way.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; a check here means the suite runs clean, not just that new tests were added
- [x] `npm run build`, then `git diff --exit-code -- dist/` (clean after the rebuilt `dist/` is committed)
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/decisions.md`, `docs/product-context.md` and `docs/pipeline-orchestrator.md` are edited directly (listed in Affected Files); all three are in `.canon/config.json`'s protected docs-freshness list. `docs/codebase-map.md`, `docs/architecture.md` and `docs/patterns.md` are not expected to go stale: no files, entry points or patterns move.

## Known Risks

- **Summary quality on large tasks.** The evidence is about 37 tasks, mostly S/M, and one spot-check. Haiku may under-report on L/XL/delicate completions or under-flag docs freshness. QA cannot block or reroute, so the cost is a weaker `done.md` that the human reads at `human_review`. Mitigation: AC-6(f) names the measurement; setting `CLAUDE_MODEL_QA` is a one-line rollback.
- **Pinned adopters change silently.** Adopters with `CLAUDE_MODEL_LIGHT` set move off their light model on QA without touching their config: to Haiku, or to their legacy `CLAUDE_MODEL` if they set both. Recorded case by case in *Decision* and the decisions entry, with the rollback.
- **QA fix-up session on Haiku is untested in the field.** The artifact-ref fix-up runs on the QA cell but has no Haiku runs in the evidence. If Haiku handles it poorly, the fix-up fails loudly and the operator can pin `CLAUDE_MODEL_QA`.
- **Bundle QA with no salvage.** If Haiku streams `done.md` to stdout instead of using the Write tool, single-task QA salvages it, but bundle QA does not and the phase stays incomplete. Not observed in the field runs; the failure is loud (QA not done) and recoverable by re-running QA or pinning `CLAUDE_MODEL_QA`.
- **Stale restatements missed.** The QA cell is restated in five places. AC-4's grep catches the common phrasings; paraphrases need the full read AC-4 requires. A stale restatement is a P2 under the repo's code-review rules.
- **Generated outputs.** A hand-edited `templates/` mirror fails `sync-templates:check`; a stale or reverted `dist/` fails CI. AC-7 covers both.
- **Model ID availability.** `claude-haiku-5-5` must stay resolvable by the Claude CLI. If it is retired, every QA run fails at launch until the default is bumped or `CLAUDE_MODEL_QA` is set. Canon's own exit message does not name the model; the Claude CLI's stderr, streamed through, is the signal.

## Human Test Plan

Use this branch's build of canon, with no Claude model override set in the environment.

1. Preview the pipeline plan for a small task and for a large task. Expected: the QA step uses Claude Haiku 5.5 at medium effort; spec, plan and code review show the same models as before (Sonnet for small, Opus for large).
2. Preview the plan for a delicate task. Expected: QA still uses Haiku at medium effort; the other Claude steps use Opus at high effort.
3. Set only the light-tier model override and preview a small task. Expected: small-task spec, plan and code review use the override; QA still uses Haiku.
4. Set the QA model override to Sonnet and preview any task. Expected: QA uses Sonnet.
5. Read the Claude model table and environment-variable list in the pipeline guide. Expected: they match what the previews showed, and the guide explains how to put QA back on Sonnet.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A, default change
- [x] (Refactors) — N/A
