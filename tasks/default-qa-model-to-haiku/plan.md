# Implementation Plan: default-qa-model-to-haiku

> Written by: Claude | Implements: `tasks/default-qa-model-to-haiku/spec.md`

## Approach

QA leaves the light/strong tier system. `src/lib/pipeline-policy.ts` gets a third `ClaudeTier` value, `'qa'`, which has no env variable. `resolveClaudeModel()` handles it as: `CLAUDE_MODEL_QA` pin (already handled by `claudePinFor`) → legacy `claudeModelLegacy` → `claude-haiku-5-5`. Light and strong cells are untouched. This is spec option 3 and adds no env var. Effort stays in `CLAUDE_CELLS` and stays `medium`.

**Feasibility check**

- **Exists:** confirmed by search. `CLAUDE_CELLS`, `ClaudeTier`, `claudePinFor`, `resolveClaudeModel` (`src/lib/pipeline-policy.ts:251-303`) and `LEGACY_FALLBACK_ENV_VARS` (`src/orchestrator/env.ts:41`) exist. So do `CLAUDE_MATRIX_TABLE`, `loadPolicyConfigForEnv` and `TEST_CONFIG` in `tests/pipeline-policy.test.ts`. The docs anchors exist: `docs/pipeline-orchestrator.md` lines 232-269, `docs/product-context.md:91`, and `docs/decisions.md` lines 448 (Codex entry) and 464-481 (2026-09 Claude entry).
- **Real path:** `policy.ts` `policyConfig()` → `getClaudeConfig(phase, tasks)` → `getPipelinePolicy().claude()` → `claudeMatrix()` → `resolveClaudeModel()`. Callers are `main.ts:1776`, `:3577` and `:3942`, and `phases/qa.ts`. All resolve QA through this one function, so there is no other code that already handles QA's model.
- **Callers:** `resolveClaudeModel` is module-private and only `claudeMatrix` calls it. Its return contract is unchanged (a string). The `ClaudeTier` type is not exported.
- **Tests that can fail:** the QA rows change from `sonnet` to `claude-haiku-5-5`, so against the unchanged code they fail on model. The legacy-with-light test fails against old code because QA would be `light`, not `legacy`. The strong-variable test fails against old code only if QA is asserted as Haiku (done explicitly). `loadPolicyConfigForEnv` clears all `CLAUDE_MODEL*` vars first, so inherited operator env, including the operator's `CLAUDE_MODEL_QA`, cannot mask them.
- **Predicates:** `claudeModelLegacy !== null` is the existing check. An empty-string legacy value would pass it, but `policy.ts` is unchanged and the spec excludes the `??` vs `||` fix. `CLAUDE_MODEL_QA=''` keeps today's behavior. Every size XS–XL is covered, and delicate promotes to XL, which keeps the `qa` cell at medium.
- **Scope:** every file below is in the spec's Affected Files. Not edited: `policy.ts`, `templates/` (sync only), the CHANGELOG.
- **Async/stateful:** N/A. The change is pure and has no re-entry.
- **Other `sonnet` QA assertions:** `grep` of `tests/` and `src/` found only `tests/pipeline-policy.test.ts` lines 280, 296, 368, 395 and 460 and the `effectiveSize` comment. No golden fixtures or dry-run tests assert the QA model.

No contradiction with the spec.

## Steps

### Step 1: Policy resolution

Files: `src/lib/pipeline-policy.ts`

1. Change `type ClaudeTier = 'light' | 'strong';` to `'light' | 'strong' | 'qa'`. Add a comment: QA has no tier variable; its pin is `CLAUDE_MODEL_QA`.
2. Add a constant next to `CLAUDE_CELLS`: `const QA_DEFAULT_MODEL = 'claude-haiku-5-5';`. Give it a short comment that it is the full ID, not the `haiku` alias, and that the 2026-10 decisions entry records why.
3. In `CLAUDE_CELLS.qa`, set `tier: 'qa'` for all five sizes. Keep `effort: 'medium'`.
4. In `resolveClaudeModel`, after the pin check:
   ```ts
   const tier = CLAUDE_CELLS[phase][size].tier;
   if (tier === 'qa') return config.claudeModelLegacy ?? QA_DEFAULT_MODEL;
   const tierModel = tier === 'light' ? config.claudeModelLight : config.claudeModelStrong;
   // rest unchanged
   ```
5. Update the `effectiveSize` comment (line ~111) to: "… selects the strong Claude model at high effort for spec, plan, and review; QA keeps its own default model at medium effort regardless of size." This removes "QA remains light/medium".

### Step 2: Legacy warning text

Files: `src/orchestrator/env.ts`

Replace the `CLAUDE_MODEL` replacement with text like: `'CLAUDE_MODEL_LIGHT / CLAUDE_MODEL_STRONG, and CLAUDE_MODEL_QA to keep a legacy model on qa (still honored as a fallback for every Claude phase, including qa)'`. It must keep the substring `fallback for every Claude phase` and must not contain `not applied to qa`. The adopter-facing wording does not cite canon-ai paths.

### Step 3: Tests

Files: `tests/pipeline-policy.test.ts`

- `CLAUDE_MATRIX_TABLE` QA rows (line 280): `model: 'claude-haiku-5-5'`.
- "delicate M … but not qa" (line 296): expect `claude-haiku-5-5` / `medium`.
- "no Claude model variables uses defaults" (line 368): expect `claude-haiku-5-5`.
- "strong tier variable only changes strong cells" (line 395): QA assertion becomes `claude-haiku-5-5`.
- "phase pin beats tier variable" (line 460): the QA assertion becomes `claude-haiku-5-5`, because `CLAUDE_MODEL_LIGHT` no longer reaches QA.
- The tests at lines 374 (light only), 440 (light beats legacy) and 449 (strong beats legacy) derive expectations from `row.model`, so they stay correct. For QA rows they now expect Haiku, `legacy` and `legacy` respectively, which is the intended behavior. Do not edit them, but confirm they pass.
- Add a new test, "QA precedence: pin, then legacy, then Haiku default", that loops over XS–XL plus delicate M and asserts the following. Effort is `medium` in every case.
  - `{}` → `claude-haiku-5-5`
  - `{ CLAUDE_MODEL_LIGHT: 'light' }` → `claude-haiku-5-5`
  - `{ CLAUDE_MODEL_STRONG: 'strong' }` → `claude-haiku-5-5`
  - `{ CLAUDE_MODEL: 'legacy' }` → `legacy`
  - `{ CLAUDE_MODEL: 'legacy', CLAUDE_MODEL_LIGHT: 'light' }` → `legacy`
  - `{ CLAUDE_MODEL_QA: 'pinned', CLAUDE_MODEL: 'legacy', CLAUDE_MODEL_LIGHT: 'light' }` → `pinned`
- Legacy warning test: add `assert.match(entry.replacement, /CLAUDE_MODEL_QA/);`, keeping the existing assertions.
- Prove one test can fail: temporarily revert step 1's `tier === 'qa'` branch, confirm the new test and the matrix rows go red, then restore it.

### Step 4: Docs

Files: `docs/pipeline-orchestrator.md`, `docs/product-context.md`

`docs/pipeline-orchestrator.md`:
- Matrix lead-in (line ~234): "The light tier defaults to `sonnet`, the strong tier to `opus`, and `qa` runs its own default, `claude-haiku-5-5`:".
- Table row (line 241): `qa` is `claude-haiku-5-5 / medium` in all five columns.
- Prose (line 243): replace "so it stays light/medium at every size" with text saying QA runs its own default model rather than the light tier at every size, because it cannot block or reroute. Cite the operator-reported, uncontrolled field evidence. Say that `CLAUDE_MODEL_QA=sonnet` restores the previous model.
- Environment Variables lead-in (line ~258): the light tier covers XS/S spec, plan and code review only. Add a sentence that QA uses its own default.
- `CLAUDE_MODEL_LIGHT` row (line 262): list only XS/S `spec`/`plan`/`code_review`.
- `CLAUDE_MODEL_QA` row (line 268): default is `claude-haiku-5-5`. Pins `qa` at every size, replacing the model only. It is QA's only override besides legacy `CLAUDE_MODEL`. Setting `sonnet` (or the previous light-tier model) restores the pre-change QA model.
- `CLAUDE_MODEL` row (line 269): "Phase pin → tier variable (tiered cells only) → this fallback → default (`sonnet` light, `opus` strong, `claude-haiku-5-5` for `qa`)". For `qa` it applies when no `CLAUDE_MODEL_QA` is set.
- Then read the whole matrix section and Environment Variables section for paraphrases.

`docs/product-context.md` line 91: "QA remains Sonnet/medium" → "QA runs Haiku/medium".

Do not edit `templates/docs/pipeline-orchestrator.md` by hand. Step 6 regenerates it.

### Step 5: Decisions entry

Files: `docs/decisions.md`

`docs/decisions.md` is root-only with no `templates/` mirror, so there is nothing to sync for it.

1. Insert one new entry immediately after the Codex entry's trailing `---` (line ~462) and before the 2026-09 Claude entry. Title: `## Claude QA default → Haiku 5.5 (2026-10)`. Use the repo's existing format: `_Generation: Haiku 5.5 / Sonnet 5.5 / Opus 5.5._` plus the sections below.
   - **Decision**: the QA cell defaults to `claude-haiku-5-5` at `medium`, with a Claude matrix table whose QA row is `claude-haiku-5-5 / medium` (AC-6a). Release class: minor.
   - **Why**:
     - Operator-reported, uncontrolled evidence: about 37 tasks, the `CLAUDE_MODEL_QA` pin since about 2026-10-06, no failures, budget hits or retries, and `done.md` summaries of about 75–115 lines (AC-6b).
     - The 20 `docs/pipeline-invocations.md` QA rows on `claude-haiku-5-5`, all `ok`, 44–214 s, first on 2026-10-16.
     - The design choice: QA-specific default over a third tier or a light-tier fallback change, with the reasons from the spec. Trigger to revisit: a second Haiku-class cell (AC-6c).
     - Why the default is the full ID rather than the `haiku` alias.
   - **Override precedence**: for every cell, phase pin → tier variable (tiered cells only) → legacy `CLAUDE_MODEL` → default (`sonnet` light, `opus` strong, `claude-haiku-5-5` QA). Pins replace the model only, and effort has no env override (AC-6d).
   - **Pinned-adopter changes and rollback**: the four cases from the spec's *Decision*, plus the rollback `CLAUDE_MODEL_QA=<previous model>` (AC-6e).
   - **Rule**: the follow-up measurement keyed on the invocation log's Model column. Compare `qa` rows on Sonnet against `claude-haiku-5-5` rows for Status and Duration, and note whether `done.md` gaps surface at `human_review`. Adopter-side data exists only where an adopter keeps its own invocation log (AC-6f).
2. Add inline "superseded by" notes, leaving the original text in place, in the 2026-09 Claude entry. Follow the `*(Superseded by "…")*` style used elsewhere in the file. Target the title string `Claude QA default → Haiku 5.5 (2026-10)`.
   - The `qa` table row (line ~475) or the table lead-in.
   - The "QA … stays light/medium" sentence in **Evidence** (line 477).
   - The **Override precedence** paragraph (line 479).
3. Do not edit any other past entry body.

### Step 6: Mirror and build

Run `npm run sync-templates`, then `npm run sync-templates:check`. Then run `npm run build`; it regenerates `dist/orchestrator/run-task.js` and possibly `dist/cli/index.js`. Keep the rebuilt `dist/`. Do not revert it. Confirm `grep -c "claude-haiku-5-5" dist/orchestrator/run-task.js` is at least 1.

### Step 7: Verification

Run `npm run lint`, `npm run type-check`, `npm test` (full suite), `npm run docs-refs-check`, and `git diff --exit-code -- dist/` after the build is committed. Also run:
- `grep -nE "^\| .qa. \| sonnet" docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md`
- `grep -rniE "QA remains (Sonnet|light)|stays light/medium|and for QA at every size|and \`qa\` at every size" docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md docs/product-context.md src/lib/pipeline-policy.ts`
- `grep -rhoE "CLAUDE_MODEL_[A-Z_]+" src | sort -u`

The first two must have zero matches. The third must list exactly `CLAUDE_MODEL_LIGHT`, `_PLAN`, `_QA`, `_REVIEW`, `_REVIEW_LARGE`, `_SPEC`, `_STRONG`. Note that the 2026-09 Claude entry's table row, which says `sonnet / medium`, is in `docs/decisions.md` and is deliberately kept. The zero-match greps do not cover that file.

## Testing Plan

- **Unit:** `tests/pipeline-policy.test.ts` as in Step 3. Run it alone first with `node --import tsx --test tests/pipeline-policy.test.ts`, then the full suite.
- **E2E:** none.
- **Manual:** the spec's Human Test Plan. A dry run of a small task and a delicate task shows `qa: Claude / claude-haiku-5-5 / medium`. It requires a build from this branch and no Claude env vars set.
- Handoff note: tests that use `loadPolicyConfigForEnv` spawn `tsx` subprocesses. A skipped test is unverified, not passing.

## Rollback Plan

Revert the commit and rebuild `dist/`. For adopters on an installed release, set `CLAUDE_MODEL_QA` to the previous QA model (`sonnet`, or their light-tier model). No data migration.
