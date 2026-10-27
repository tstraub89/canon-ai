# Spec: codex-implement-effort-xhigh — Raise mini implement effort and default the full model to GPT-6.1 Sol

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon's Codex `implement` row still carries effort cells inherited from earlier model generations: the mini model (`gpt-6-luna` by default) runs XS/S at `medium` and M/L at `high`. The 5.6-generation entry and the 2026-09 GPT-6 entry in `docs/decisions.md` each deferred "effort-tier re-evaluation" to a separate future task. This is that task.

**Benchmark evidence.** OpenAI's GPT-6 Sol/Luna launch post publishes per-effort DeepSWE results (cost per task, score):

| Luna effort | Cost | DeepSWE |
|---|---|---|
| `low` | $0.006 | 2.4% |
| `medium` | $0.052 | 44.5% |
| `high` | $0.084 | 59.3% |
| `xhigh` | $0.11 | 61.3% |
| `max` | $0.22 | 66.6% |

GPT-6 Sol scores 66.6% at `xhigh` ($1.00) and 68.8% at `max` ($2.74). FrontierCode has the same shape: Luna `max` scores 42.4% at $0.11, against Sol `high` at 47.7% ($1.08).

The existing 2026-09 entry quotes "DeepSWE 66→64%" for Luna's GPT-5.6 → GPT-6 change. The launch post's own chart instead shows `max` going from 62.2% (GPT-5.6 Luna) to 66.6% (GPT-6 Luna), so the 2026-09 figure came from a different source or benchmark version. The new entry cites the launch chart and notes the discrepancy rather than reconciling the numbers.

Luna at `medium` sits on the steep part of its curve. XS/S implement currently runs where Luna scores 44.5%; `xhigh` adds 17 points for about $0.06 more per task. `max` reaches Sol-`xhigh` quality at about a fifth of Sol's cost.

A missed implement costs a Claude `code_review` round (three lenses plus foreman). That is far more expensive than the Codex call, so buying first-pass quality cheaply on the mini model fits canon's token-discipline thesis. The extra `max` spend goes to M and L, where misses cost the most rounds.

**`max` is rejected today.** `VALID_CODEX_EFFORTS` in `src/orchestrator/agents/codex.ts` stops at `xhigh`, so no matrix cell can select `max`. On Codex CLI 0.164.0 with `gpt-6-luna`, `-c model_reasoning_effort=max` is honored on both paths canon uses. A fresh `codex exec` probe and a `codex exec resume` probe of the same session on 2026-10-27 both completed, and the session rollout JSONL recorded `"reasoning_effort":"max"` for each. No other CLI version or mini model has been probed.

**Stale "raise via env" claims.** These tell readers to raise effort via env, but no Codex effort env var exists:

- the `codexMatrix()` comment in `src/lib/pipeline-policy.ts`
- `docs/pipeline-orchestrator.md` (shipped to adopters through its `templates/` mirror)
- the 2026-06 entry in `docs/decisions.md`

`src/orchestrator/env.ts` lists `CODEX_EFFORT_DEFAULT` and `CODEX_EFFORT_DELICATE` as retired, with "no equivalent knob".

**Full-model default.** The operator has run `CODEX_MODEL_FULL=gpt-6.1-sol` since 2026-10-04, across canon-ai and one adopter repo. This is an operator-reported comparison from both repos' archived `status.json` phase counters and run-log model lines; canon-ai's own quality log holds only part of it and does not record model generation.

| Delicate tasks | `code_review` rounds (median) | `changes_requested` per task | Reroutes |
|---|---|---|---|
| 10 on `gpt-6-sol` (2026-09-25 to 10-02) | 2 | 1.1 | 2/10 |
| 12 on `gpt-6.1-sol` (2026-10-03 to 10-25) | 2 | 0.75 | 4/12 |

The extra reroutes on `gpt-6.1-sol` are concentrated in large iOS/IAP tasks. There is no regression, and pricing is unchanged ($2 / $10 per 1M input/output tokens). The shipped fallback still names `gpt-6-sol`.

## Decision

- **Codex `implement` effort for the mini-model rows:** `xhigh` at XS and S, `max` at M and L.
  - The XL/delicate row stays `full` / `high`. Delicate work already gets the stronger model.
  - Re-evaluating the *full* model's effort curve (Sol at `xhigh` costs about 1.5–2× Sol at `high`) is a separate follow-up, not part of this task.
  - `spec_review` and `code_review` rows are unchanged.
- **Valid efforts:** `max` becomes a valid Codex effort. It requires a Codex CLI and mini model that accept `max`; only CLI 0.164.0 with `gpt-6-luna` has been verified. The env-table caveat in `docs/pipeline-orchestrator.md` states this, plus the recovery path:
  - upgrade the Codex CLI;
  - point `CODEX_MODEL_MINI` at a model that accepts `max`, or unset it;
  - or install the previous canon release.
- **Full-model default:** the shipped `CODEX_MODEL_FULL` fallback becomes `gpt-6.1-sol`. The `CODEX_MODEL_FULL` → `CODEX_MODEL_DELICATE` → default chain is otherwise unchanged.
- **Docs and comments:** every comment and shipped doc that claims any of the following is corrected:
  - effort can be raised via env;
  - delicate is the highest-effort tier;
  - Codex effort scales with task size;
  - `xhigh` overthinks;
  - the GPT-6 effort re-evaluation is still pending.

  After this change, XL/delicate implement runs a *stronger model* (Sol at `high`), not more effort than M/L (Luna at `max`).
- **Decision record:** a new `docs/decisions.md` entry records the change, the evidence and the rollback. Both changes are canon-supplied-default changes, so this is a **minor** release item per §"Versioning and release policy".

## Non-Goals

- **No effort override knob.** No Codex effort env var or other override. AC-4 backs this with a zero-match grep.
- **No change to the other Codex rows.** The `spec_review` and `code_review` (cold lens) cells and the XL/delicate `implement` cell stay as they are. AC-1's table pins all three rows.
- **No other model changes.** `CODEX_MODEL_MINI`'s default (`gpt-6-luna`), Terra, and every Claude matrix cell are unchanged. Making Haiku the QA default is a separate task.
- **No Codex CLI version gate.** No `canon doctor` check and no runtime version gate. The requirement is documented, not enforced.
- **No CHANGELOG edit.** Release notes are drafted by `/canon-changelog` at release time.
- **No edits to historical material:**
  - `docs/harness-audit-2026-06.md` and `docs/canon-opus48-gpt55-report.md`
  - `docs/BACKLOG.md` and `docs/pipeline-invocations.md`
  - archived tasks
  - the body text of past `docs/decisions.md` entries, which only get inline notes

## Acceptance Criteria

- [ ] **AC-1: implement effort cells.**
  - `codexMatrix()` resolves `implement` to: XS `mini/xhigh`, S `mini/xhigh`, M `mini/max`, L `mini/max`, XL `full/high`.
  - The `spec_review` and `code_review` rows resolve to exactly their current values.
  - Verified by the table-driven rows in `tests/pipeline-policy.test.ts`. The implement rows are updated; the spec_review and code_review rows are unchanged and still pass.
  - Any other test asserting `codex('implement')` for a non-XL, non-delicate input is updated. The `delicate` → `full/high` assertion stays.
- [ ] **AC-2: `max` is a valid effort.**
  - `VALID_CODEX_EFFORTS` contains `'max'`, ordered after `'xhigh'`.
  - A new unit test asserts that `invalidCodexEffortMessage('max')` returns `null`, and that an unknown value (e.g. `'ultra'`) still returns a message.
  - The effort-list assertion in `assertInvalidEffortMessage` (`tests/run-task-code-review.test.ts`) requires the full list ending `|xhigh|max`.
- [ ] **AC-3: full-model default.**
  - The `codexModelFull` fallback in `src/orchestrator/policy.ts` is `'gpt-6.1-sol'`, and `grep -rn "'gpt-6-sol'" src` returns no matches.
  - The `CODEX_MODEL_FULL` row of the env table in `docs/pipeline-orchestrator.md` shows `gpt-6.1-sol`.
  - The env-table caveat in the same file states the `max` requirement and the recovery path from *Decision*.
- [ ] **AC-4: stale env and overthinking claims removed.**
  - The `codexMatrix()` implement comment in `src/lib/pipeline-policy.ts` is rewritten. It must not mention env, "overthought", or "pending … re-eval". It must explain the XS/S `xhigh`, M/L `max` and XL Sol-`high` split, including why XL stays at `high` (the reasons in *Decision*). This is verified by reading, because the comment wraps across lines.
  - `grep -rni "raise via\|overthink\|overthought\|pending GPT-6" docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md docs/product-context.md README.md` returns no matches.
  - `grep -rn "process.env.CODEX_EFFORT" src` returns no matches.
  - Replacement wording in the guide says effort comes only from the matrix, without reintroducing those phrases.
  - In `docs/decisions.md`, the 2026-06 entry's "Raise via `CODEX_*`/effort env" sentence stays as historical text. It gets an inline note saying no effort env var exists, pointing to the new entry.
- [ ] **AC-5: delicate is a model upgrade, and effort does not scale with size.**
  - `grep -ni "highest-effort\|most expensive model+effort\|model/effort scaling\|Codex model and effort scale" README.md docs/pipeline-orchestrator.md templates/docs/pipeline-orchestrator.md` returns no matches. This covers README "highest-effort tier" and "model/effort scaling by task size", plus the guide's "Codex model and effort scale with task size" and "most expensive model+effort tier".
  - The guide's Claude-matrix sentence "Claude model and effort scale with effective task size" is still true and stays unchanged.
  - README's `delicate` sentence says delicate moves Codex spec review and implementation to the full model.
  - `docs/pipeline-orchestrator.md`'s Codex matrix table matches AC-1.
  - Its prose states that M/L implement runs Luna at `max` while XL/delicate runs Sol at `high`.
- [ ] **AC-6: product-context tier summary.**
  - `docs/product-context.md` states XS implement runs mini/xhigh, not "mini/medium".
  - It does not claim Codex effort "scales with size".
  - Its XL/delicate sentence no longer says the tier was "inherited pending GPT-6-generation re-eval". It cross-references the new decisions entry instead of the 2026-09 one. (The AC-4 grep covers this file too.)
- [ ] **AC-7: new decisions entry.** `docs/decisions.md` gains one new entry with a `_Generation:_` line naming `gpt-6-luna` / `gpt-6.1-sol`, and **Decision**, **Why** and **Rule** sections. The entry:
  - (a) cites the DeepSWE Luna curve and the FrontierCode numbers from *Problem*, and notes the discrepancy with the 2026-09 entry's "DeepSWE 66→64%";
  - (b) addresses the 2026-07 entry's "`high → xhigh` shows diminishing-to-negative returns" evidence, noting that it predates the GPT-6 generation and that Luna's published curve does not flatten through `max`;
  - (c) records both `max` probes (fresh and resume, CLI 0.164.0, `gpt-6-luna`) and the operator-reported `gpt-6.1-sol` cohort comparison, labelled as such;
  - (d) states the rollback and recovery:
    - model: `CODEX_MODEL_FULL=gpt-6-sol`;
    - a CLI or model that rejects `max`: upgrade the Codex CLI, or change or unset `CODEX_MODEL_MINI`;
    - restoring the old effort cells: install the previous canon release, since effort has no env override;
  - (e) names the follow-up measurement: `code_review` rounds and `changes_requested` rates for **non-delicate** XS–L tasks in `docs/task-quality-log.md`, before vs. after this entry's date. Delicate tasks also changed model, so they are excluded.
  - (f) gives the reasons XL/delicate stays at Sol `high`, from *Decision*.

  Inline "superseded by" notes, pointing to the new entry and leaving the original text in place, go on:
  - the 2026-06 "Effort floors — audited and already adequate" bullet;
  - the 5.6-generation entry's "re-evaluating effort tiers … is a separate future task" sentence;
  - the 2026-09 GPT-6 entry's "canon runs Luna at `medium`/`high`" sentence;
  - the 2026-09 GPT-6 entry's Rule ("Shipped defaults are `gpt-6-luna` (mini) and `gpt-6-sol` (full)" and "Effort-tier re-evaluation … remains a separate future task").
- [ ] **AC-8: mirror and build outputs are in sync.**
  - `templates/docs/pipeline-orchestrator.md` is regenerated from the root copy, and `npm run sync-templates:check` passes.
  - `dist/` is rebuilt with `npm run build` and committed, and `git diff --exit-code -- dist/` is clean after a fresh build. The rebuilt bundle must not be reverted.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/pipeline-policy.ts` | `implement` mini rows → `xhigh` (XS/S) and `max` (M/L); rewrite the implement paragraph of the `codexMatrix()` comment per AC-4 |
| `src/orchestrator/agents/codex.ts` | add `'max'` to `VALID_CODEX_EFFORTS` |
| `src/orchestrator/policy.ts` | `codexModelFull` fallback `'gpt-6-sol'` → `'gpt-6.1-sol'` |
| `tests/pipeline-policy.test.ts` | implement rows; any other non-XL `codex('implement')` assertion |
| `tests/run-task-code-review.test.ts` | effort-list regex includes `max`; `invalidCodexEffortMessage` accept/reject cases (or a new focused test file if cleaner) |
| `docs/pipeline-orchestrator.md` | Codex matrix table, lead-in and prose; delicate wording; `CODEX_MODEL_FULL` default row; env-table caveat on `max` support |
| `templates/docs/pipeline-orchestrator.md` | regenerated by `npm run sync-templates`; never hand-edited |
| `docs/product-context.md` | tier summary (XS cell, effort-scaling claim, XL/delicate sentence and cross-reference) |
| `README.md` | both `delicate` descriptions and the "model/effort scaling by task size" phrase |
| `docs/decisions.md` | new entry; inline supersede notes per AC-7 |
| `dist/orchestrator/run-task.js` | rebuilt by `npm run build`; commit it, do not revert |
| `dist/cli/index.js` | rebuilt by `npm run build` if the build changes it; commit it, do not revert |

### Interaction Dependencies

- `runCodex` (fresh and resume) and `runColdCodexReview` call `invalidCodexEffortMessage` before spawning. Widening the list only admits a new value; no existing value becomes invalid.
- Dry-run output and the `→ Model: … | Effort:` log lines print effort strings without validating them. Metrics record the model only. Neither needs a change.
- Interactive `canon run -I` does not pass effort, so it is unaffected.
- canon-on-canon pipeline runs execute the globally installed canon. The new cells take effect for those runs only after release and `canon update`.

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

`docs/decisions.md`, `docs/product-context.md` and `docs/pipeline-orchestrator.md` are edited directly (listed in Affected Files). `docs/codebase-map.md`, `docs/architecture.md` and `docs/patterns.md` are not expected to go stale: no files, entry points or patterns move.

## Known Risks

- **`max` rejected or ignored outside the verified pair.**
  - Only Codex CLI 0.164.0 with `gpt-6-luna` has been probed.
  - On an older CLI, or with `CODEX_MODEL_MINI` pointing elsewhere (including the documented `gpt-5.6-luna` rollback), every M/L implement could hard-fail at the Codex call, or silently run at a lower effort.
  - Accepted: canon has no version gate (Non-Goal). The mitigation is the env-table caveat and the AC-7(d) recovery path. A hard failure is loud and names the effort in the Codex error.
- **`max` overthinking or runaway cost on M/L.**
  - GPT-5.5 overthought at `xhigh` with open-ended tools. Luna's published curve keeps rising through `max`, but canon's implement sessions are longer and more tool-heavy than benchmark tasks, and M is a common size.
  - Mitigation: the decisions entry names the measurement and the rollback. The implement duration and token columns in `docs/pipeline-invocations.md` give a per-run cost signal.
- **Stale restatements missed.** The matrix is restated in four docs. AC-4 and AC-5 back the known phrases with zero-match greps, but a paraphrase could survive. The implementer should read the Codex matrix section of `docs/pipeline-orchestrator.md` and the tier section of `docs/product-context.md` in full rather than relying on the greps alone.
- **Generated outputs.** A hand-edited `templates/` mirror fails `sync-templates:check`. A `dist/` left stale or reverted fails CI. AC-8 covers both.
- **Benchmark-to-canon transfer.** The evidence is vendor-published, self-reported benchmarks plus a small operator cohort. The decision entry must present this as a hypothesis to measure.

## Human Test Plan

Use this branch's build of canon, with no Codex model override set in the environment (so the shipped defaults are what you see).

1. Preview the pipeline plan for a small task and for a medium task. Expected: implementation uses the small Codex model at extra-high effort for the small task and at maximum effort for the medium one.
2. Preview the plan for a delicate task. Expected: implementation uses the GPT-6.1 Sol model at high effort.
3. Read the Codex model and effort table in the pipeline guide. Expected: it matches what the previews showed. It says nothing about raising effort with an environment variable, and it notes which Codex CLI and model support maximum effort.
4. Read the README's description of the delicate flag. Expected: it describes a stronger model, not "highest effort".

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A, feature/default change
- [x] (Refactors) — N/A
