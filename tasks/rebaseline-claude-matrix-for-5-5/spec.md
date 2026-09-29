# Spec: rebaseline-claude-matrix-for-5-5 — Re-baseline Claude model/effort matrix for the 5.5 generation

> Written by: Claude | Review by: Codex
> Status: draft
> Size: S | delicate: true (edits `src/lib/pipeline-policy.ts`, a listed delicate surface in `docs/product-context.md`: a wrong model or effort affects cost, latency, and quality for every later task)

## Problem

Canon's Claude matrix (`claudeMatrix`, `src/lib/pipeline-policy.ts:267-309`) was last re-baselined in 2026-06 for Opus 4.8 / Sonnet 4.6 (`docs/decisions.md` §"Model-generation re-baseline (2026-06)"). The `opus`/`sonnet` aliases now resolve to the 5.5 generation, and the current matrix no longer fits the published cost/quality data:

| Phase | XS | S | M | L | XL / delicate |
|---|---|---|---|---|---|
| spec | opus/medium | opus/medium | opus/high | opus/high | opus/xhigh |
| plan | sonnet/medium | sonnet/medium | sonnet/high | sonnet/high | sonnet/high |
| code_review | sonnet/medium | sonnet/medium | sonnet/high | sonnet/high | opus/xhigh |
| qa | sonnet/medium | sonnet/medium | sonnet/medium | sonnet/high | sonnet/high |

Evidence, consulted 2026-09-28:

- **xhigh buys almost nothing on Opus 5.5.** On Anthropic's Terminal-Bench 4.0 cost/accuracy chart (Claude Code harness), Opus 5.5 scores about 64% at high ($3.88/attempt) and 66% at xhigh (about $7.30). Max scores lower than xhigh.
- **Sonnet above medium is dominated by Opus.** Sonnet 5.5 at high (about $1.95, 43%) costs more than Opus low (about $1.30, 39%), and Opus medium (about $2.90, 58%) scores much higher. Sonnet xhigh (about $5.30, 62%) costs more than Opus high and scores lower. The Sonnet 5.5 announcement says it "complements Opus 5.5 best when running at lower effort settings", and that Opus remains stronger at open-ended work requiring sustained judgment.
- **Code review.** In CodeRabbit's same-input evaluation on 13 hard known-bug cases, Opus 5.5 caught 8/13 at 67% actionable precision and Sonnet 5.5 caught 6/13 at 41%. CodeRabbit calls Sonnet 5.5 the first Sonnet it would consider for a main review pass, which supports Sonnet for small tasks and Opus above.
- **Medium is the Opus workhorse.** Artificial Analysis places Opus 5.5 medium, high, xhigh, and max on its cost/intelligence frontier, and medium is Claude Code's default. Low scored well below medium (42 vs 51 on their index). Anthropic warns that low effort can skip verification, which is exactly what plan and review exist to do.
- **Plans shape implementation.** A 2026-09-28 analysis of 422 archived tasks found that Codex changes the plan's approach in only 6% of tasks, and that plan errors account for about 40% of the non-hygiene code-review blocking findings sampled (tstraub89/canon-ai#68). Today's M/L plans run on Sonnet high.
- **QA does not gate.** The QA prompt writes `done.md`, lessons, and quality-log cells. It cannot block or reroute, so it gains nothing from a larger model or more effort at any size.

This is vendor and third-party evidence from the generation's first weeks, not a controlled canon evaluation. The change is an opinionated default, reversible by release.

## Decision

Replace the Claude matrix with three tiers, built from two models: *light* (Sonnet) and *strong* (Opus). Nothing runs above `high`:

| Phase | XS | S | M | L | XL / delicate |
|---|---|---|---|---|---|
| spec | light/medium | light/medium | strong/medium | strong/medium | strong/high |
| plan | light/medium | light/medium | strong/medium | strong/medium | strong/high |
| code_review | light/medium | light/medium | strong/medium | strong/medium | strong/high |
| qa | light/medium | light/medium | light/medium | light/medium | light/medium |

- **What stays the same:**
  - effective size (delicate promotes to XL) selects the column;
  - the foreman's lenses inherit its model and effort;
  - budgets, loop caps, and the Codex matrix.
- **Model overrides.** Precedence per cell, first match wins:
  1. **The phase's existing pin, with its current scope unchanged.** `CLAUDE_MODEL_SPEC`, `CLAUDE_MODEL_PLAN`, and `CLAUDE_MODEL_QA` pin their phase at every size. `CLAUDE_MODEL_REVIEW` pins code_review at XS–L. `CLAUDE_MODEL_REVIEW_LARGE` pins code_review at XL, where `_LARGE` refers to task size, not model tier.
  2. **The cell's tier model:** new `CLAUDE_MODEL_LIGHT` or `CLAUDE_MODEL_STRONG`.
  3. **Legacy `CLAUDE_MODEL`,** which keeps today's meaning: a fallback for every phase.
  4. **The default:** `sonnet` for light, `opus` for strong.
- **A pin replaces the model only.** Effort always comes from the cell. Claude effort has never been env-overridable. So an adopter who pinned `CLAUDE_MODEL_REVIEW=sonnet` or `CLAUDE_MODEL_PLAN=sonnet` goes from high to medium effort on M/L review or plan. This is intended, and the decision entry and changelog must say so.
- **One resolver.** `src/orchestrator/policy.ts` becomes the only resolver for policy config. The unused duplicate policy block in `src/orchestrator/env.ts` (`config.claudeModel*`, `codexModel*`, `claudeBudget`, `maxReviewLoops`, none of which is read outside `env.ts` today) is removed.

## Non-Goals

- No Codex matrix, Codex env var, budget, or loop-cap changes.
- No per-task or per-phase effort override, and no new override files.
- No separate model or effort for the code-review lenses; they keep inheriting the foreman's.
- No prompt changes. Prompt calibration is `claude-55-calibration`.
- No deprecation or removal of the existing per-phase `CLAUDE_MODEL_*` pins.
- No `low` effort in any cell.
- No version pinning. Defaults stay the `sonnet`/`opus` aliases.
- No rewriting of historical decision entries, dated audit reports (`docs/harness-audit-2026-06.md`, `docs/canon-opus48-gpt55-report.md`), or `CHANGELOG.md`. The changelog entry is written at release time with `/canon-changelog`.

## Acceptance Criteria

- [ ] **AC-1: Matrix.** A table-driven test in `tests/pipeline-policy.test.ts` asserts the model and effort from `getPipelinePolicy(…).claude(phase)` for all four phases × five sizes with default config, matching the Decision table. It also asserts:
  - a delicate M task resolves spec/plan/code_review to `opus`/`high` and qa to `sonnet`/`medium`;
  - an empty task list resolves spec to `sonnet`/`medium`.

  Every existing Claude-cell assertion in the file is rewritten or removed to match: `CLAUDE_TABLE` (`:271-282`), `CODE_REVIEW_TABLE` (`:285-298`), the delicate-M code_review test (`:300-303`), and the empty-task-list test (`:357`). So are the comments describing the old split (`:263-268`, `:289`). The budget tests (`:186-218`) pass unmodified.
- [ ] **AC-2: No xhigh; old helpers gone.**
  - A test iterates every phase × size, plus a delicate case, and asserts each Claude effort is `medium` or `high`.
  - `rg -n "xhigh" src/lib/pipeline-policy.ts` returns only the Codex implement-row comment explaining why Codex XL runs at `high`.
  - `rg -n "buildHigh|buildMedium|codeReviewMatrix|claudeModelFor" src/` returns no hits.
  - The Codex matrix tests (`tests/pipeline-policy.test.ts:228-261`) pass unmodified.
- [ ] **AC-3: Override precedence.** Subprocess tests assert the Decision's precedence. They use a `loadPolicyConfig` variant that takes an env map and *deletes* every `CLAUDE_MODEL*` variable (`CLAUDE_MODEL`, `_SPEC`, `_PLAN`, `_REVIEW`, `_REVIEW_LARGE`, `_QA`, `_LIGHT`, `_STRONG`) from the inherited environment before applying the case. The child prints `policyConfig()`, and the parent resolves cells with `getPipelinePolicy(inputs, loaded).claude(phase)`. Cases:
  - none;
  - `CLAUDE_MODEL_LIGHT` only;
  - `CLAUDE_MODEL_STRONG` only;
  - each per-phase pin alone, asserting its exact scope: `CLAUDE_MODEL_REVIEW` changes XS–L review, not XL; `CLAUDE_MODEL_REVIEW_LARGE` changes XL review only;
  - legacy `CLAUDE_MODEL` alone (every cell uses it);
  - `CLAUDE_MODEL` plus `CLAUDE_MODEL_LIGHT` (the light cells use the tier var, the strong cells use `CLAUDE_MODEL`);
  - a pin plus the tier var for the same cell (the pin wins).

  A custom model string such as `claude-opus-5-5` passes through verbatim. Effort matches the default matrix in every case.
- [ ] **AC-4: One resolver, accurate warning.**
  - `rg -n "CLAUDE_MODEL|claudeModel|codexModel|claudeBudget|maxReviewLoops" src/orchestrator/env.ts` returns only the `LEGACY_FALLBACK_ENV_VARS` `CLAUDE_MODEL` entry.
  - `rg -ln "process\.env\.CLAUDE_MODEL" src/` returns only `src/orchestrator/policy.ts`.
  - The `CLAUDE_MODEL` legacy entry names `CLAUDE_MODEL_LIGHT` / `CLAUDE_MODEL_STRONG` and says the variable is honored as a fallback for every Claude phase. `rg "not applied to qa" src/` returns no hits, since today's text is false.
  - A test asserts the new message.
- [ ] **AC-5: Orchestrator doc.** `docs/pipeline-orchestrator.md`:
  - **New section.** It gains `## Claude Model/Effort Matrix` beside the Codex matrix, with the Decision table using concrete `sonnet`/`opus` and a short rationale written for adopters with no canon-internal paths.
  - **Environment Variables table.** It gains `CLAUDE_MODEL_LIGHT` and `CLAUDE_MODEL_STRONG` rows. Each of the five per-phase rows states its pin scope, notes that a pin replaces the model only, and drops generation-specific history. The `CLAUDE_MODEL_REVIEW_LARGE` row states that `_LARGE` means task size.
  - **Tuning sentence.** "Claude is tuned for correctness…" is rewritten to the three-tier rule.
- [ ] **AC-6: Stale claims elsewhere.**
  - `docs/product-context.md:91`'s "Claude's `code_review` for XL/delicate stays Opus at `xhigh`" is corrected.
  - `README.md:89`'s sentence that `delicate` upgrades model and effort "across every phase" is rewritten to be accurate: the upgrade covers spec, plan, code review, and Codex spec review and implementation, not QA or the cold-Codex lens.
  - The stale comments in `pipeline-policy.ts` (the `PolicyConfig` review-model history, `PipelinePolicy.effectiveSize`'s "full model at xhigh") are replaced.
  - **Sweep invariant:** `rg -n "xhigh|Sonnet 4\.6|Opus 4\.8" README.md docs/product-context.md docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md src/` returns only hits describing Codex (including `src/orchestrator/agents/codex.ts`'s valid-effort list).
- [ ] **AC-7: Decision record.** `docs/decisions.md` gains "Model-generation re-baseline (2026-09): Claude defaults → 5.5 generation", placed after the existing 2026-09 Codex entry. It covers:
  - the table;
  - the evidence summary with sources;
  - the precedence rule;
  - the pinned-adopter effort change;
  - rollback: pins restore models, but effort cells come back only by installing the previous canon release.
- [ ] **AC-8: Mirrors and bundle.**
  - `npm run sync-templates` regenerates `templates/docs/pipeline-orchestrator.md`, and `npm run sync-templates:check` passes.
  - `dist/orchestrator/run-task.js` is rebuilt with `npm run build`.
  - `tests/run-task-prompts.golden.json` is unchanged, since no prompt embeds model or effort.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/pipeline-policy.ts` | Three-tier `claudeMatrix`; `PolicyConfig` gains light/strong tier models; per-phase fields become optional pins; old helpers and stale comments replaced |
| `src/orchestrator/policy.ts` | Resolve pins, tier vars, and legacy fallback per the Decision precedence |
| `src/orchestrator/env.ts` | Remove the duplicate policy block; correct the `CLAUDE_MODEL` legacy message |
| `tests/pipeline-policy.test.ts` | AC-1–AC-4 tests; old Claude-cell assertions rewritten; `TEST_CONFIG` and `loadPolicyConfig` updated |
| `docs/pipeline-orchestrator.md` | Claude matrix section, env-var rows, tuning sentence |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror |
| `docs/product-context.md` | Correct the XL/delicate code_review line |
| `README.md` | Correct the `delicate` sentence |
| `docs/decisions.md` | New dated re-baseline entry |
| `dist/orchestrator/run-task.js` | Rebuilt bundle |

### Implementation Notes (non-binding; plan and implement own these)

- One helper can build spec/plan/code_review rows from `(lightModel, strongModel)`, with qa as a flat light/medium row.
- Pins typed as `string | null` on `PolicyConfig` let the policy tell "unset" from "set to the default", and survive the AC-3 JSON round trip. `undefined` would be dropped.
- The only `PolicyConfig` constructors are `TEST_CONFIG` (`tests/pipeline-policy.test.ts:74-84`) and `policyConfig()` (`src/orchestrator/policy.ts:30-41`).

### Interaction Dependencies

- Every `getClaudeConfig` call picks up the new cells with no change of its own: spec, plan, code_review, qa, the `--dry-run` listing (`src/orchestrator/main.ts:1451`), and the retry path (`:3130`).
- The pipeline that runs *this* task uses the globally installed canon engine and therefore the old matrix. The new matrix applies from the next release.
- `claude-55-calibration` also edits `docs/decisions.md` (a different section) and rebuilds `dist/orchestrator/run-task.js`. Whichever lands second rebases and rebuilds.
- The uncommitted working-tree edit to `docs/pipeline-orchestrator.md` (the `/canon-spec-review` line near 172) is the human's and not part of this task.

### Data Model Changes

Internal `PolicyConfig` shape only: tier models are added, and per-phase fields become optional pins. No `status.json` or persisted schema change.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run sync-templates:check` (after `npm run sync-templates`)
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/decisions.md`, `docs/product-context.md`, `docs/pipeline-orchestrator.md`, and `README.md` are listed in Affected Files. `docs/architecture.md`, `codebase-map.md`, and `patterns.md` need no change. This is a **minor** release under `docs/decisions.md` §"Versioning and release policy": it changes canon-supplied defaults and adds two env vars.

## Known Risks

- **Budget caps.** Opus medium on M/L plan and review costs more per call than today's Sonnet high, and the caps are unchanged (plan $10; review $15/$20 for M/L). A phase that hits its cap fails mid-phase. Watch M/L invocations after release; `CLAUDE_BUDGET` is the escape hatch.
- **Pinned adopters lose effort.** A Sonnet pin on M/L review or plan drops from high to medium. This is intentional, and AC-5 and AC-7 document it.
- **XL review recall.** xhigh → high on XL review trades a few benchmark points for about half the cost, on the tasks where a miss is most expensive. Codex's cold lens and the PR-level review remain.
- **Sonnet on small specs.** S specs come from Sonnet medium, with Codex `spec_review` as a backstop. XS specs are usually written conversationally by the operator's own session, so the pipeline's spec cell touches them only on revisions.
- **Precedence misread.** Four override layers are easy to get wrong. AC-3 pins every boundary, and the docs state each variable's scope, including what `_REVIEW_LARGE` means.
- **Subscription users** feel cost as usage-limit consumption rather than dollars. The direction is the same.
- **Early data.** The generation is weeks old. Rolling back the effort cells requires the previous release, as AC-7 states.

## Human Test Plan

1. Preview (dry-run) a pipeline run for a small task. Expected: spec, plan, and code review use the light model at medium effort.
2. Preview a medium task. Expected: spec, plan, and code review use the strong model at medium effort, and QA stays on the light model.
3. Preview a delicate task. Expected: spec, plan, and code review use the strong model at high effort, never higher, and QA is unchanged.
4. Set the strong-model override to a different model and preview the medium task again. Expected: spec, plan, and code review change to that model, and QA does not.
5. Set the old catch-all model variable and start a preview. Expected: a deprecation notice names the two new tier settings.
6. Read the orchestrator docs. Expected: a Claude matrix table sits beside the Codex one, and each model setting states which phases and sizes it controls.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps (fast tier) — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has at least one entry marked `- [x]`
- [x] Bug/flake fixes — N/A (default re-baseline)
