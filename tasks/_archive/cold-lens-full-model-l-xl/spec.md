# Spec: cold-lens-full-model-l-xl — Cold-Codex review lens uses the full model at L and XL/delicate

> Written by: Claude | Review by: spec reviewer
> Status: draft

## Problem

In mixed mode, `code_review` starts with an orchestrator-run cold-Codex diff review (`runColdCodexReview()` in `src/orchestrator/agents/codex.ts`). Its model and effort come from the `code_review` row of `codexMatrix()` in `src/lib/pipeline-policy.ts`, which pins every size — XS through XL, including delicate — to `config.codexModelMini` at `high`. `docs/decisions.md` §"Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)" records this as deliberate: "The lens deliberately receives no full-model upgrade."

That flat row is now the weakest link on the largest tasks. Evidence gathered on 2026-11-03:

- **Post-PR defect fixes rise with task size.** Classifying commits pushed to task PRs after the pipeline approved them (plus human reroute amendments) found that the share of PRs needing at least one defect fix rises with size. In a private adopter project (384 task PRs): XS 16%, S 40%, M 49%, L 68%. On canon-ai's own public task PRs (39): S 57%, M 78%. Roughly 80% of those defects were caught by the PR-level Codex review bot, i.e. after the in-pipeline cold-Codex lens had passed the same code.
- **The in-pipeline lens is usually silent.** In the archived-review yield audit, the share of tasks whose last cold-Codex run had any finding fell from ~36% (pre-5.6) to ~14% (5.6-mini) and ~10% (`gpt-6-luna`), tracking the move to the mini model rather than a model generation (see the `docs/BACKLOG.md` cold-lens entry).
- **A full-model replay recovered the serious misses on one PR.** `tstraub89/canon-ai` PR #120 (`pr-pushes-scaffold-base`, delicate M) was replayed at its PR-open head with the exact cold-lens invocation shape (`codex exec review --base <merge-base>`) on `gpt-6.1-sol` at `high`. It reported both P1s the PR bot later found (stale origin refs surviving a narrowed-refspec prune; a missing tracking ref after remote base creation) and backed them with reproductions. The pipeline's mini/high run on the same code had reported "No actionable regressions." A second replay (PR #88, `configurable-docs-freshness`) found none of the bot's ~6 hostile-input findings on either model, so the upgrade helps git/state reasoning, not adversarial-input hunting.

**How strong this evidence is.** The size gradient alone does not prove a model-tier effect: larger diffs contain more defects whatever reviews them. The causal evidence is one positive replay and one null replay. The positive replay was a delicate task, so it bears directly on the XL/delicate cell; extending the full model to non-delicate L rests on L having the highest leak rate while being a small share of tasks. This is a bounded bet, with a re-measurement follow-up (AC-7), not a settled finding.

**Why the PR bot is not enough.** A defect the PR bot catches costs a fix round after the PR opens (in the canon-ai sample several PRs needed 3–5 bot rounds on one bug class), and adopters that run no PR-level review bot get no backstop at all. The cold lens is the in-pipeline place to catch these.

A `spec_review` upgrade at L was investigated alongside this and rejected: classifying 23 tasks with spec problems found Sol-reviewed XL/delicate specs had the same reviewer-catchable problem rate (1.9 per task) as Luna-reviewed L specs.

## Decision

Change the cold-Codex lens's `code_review` cells so that effective size **L** and **XL** (which includes every delicate task and any bundle containing a delicate member) run on the full Codex model (`config.codexModelFull`, default `gpt-6.1-sol`) at `high`. XS, S, and M stay on the mini model at `high`. Effort stays `high` everywhere. No other matrix row changes.

The lens keeps taking no prompt and keeps its sequential, hard-fail, one-review-per-bundle contract. Because the lens model now follows the matrix like other Codex phases, `CODEX_MODEL_FULL` (and its deprecated fallback `CODEX_MODEL_DELICATE`) steers the lens at L/XL, and `CODEX_MODEL_MINI` (and `CODEX_MODEL_DEFAULT`) steers it at XS/S/M.

Every live restatement of "the cold lens is mini/high at every size" is updated, the superseded clause in `docs/decisions.md` gets a new dated decision section, the `docs/BACKLOG.md` `CODEX_MODEL_REVIEW` entry is rewritten into the post-release re-measurement follow-up, and `CHANGELOG.md` records a minor `### Changed` bullet.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Which sizes get the full model | L and XL/delicate | M and up (leak rate is already 49–78% at M); on the narrow side, XL/delicate only (the cell the positive replay directly supports) | L leaks most (68%) and is rare, so adding it costs little; M is common, and one positive replay is too thin to justify full-model cost on every M task | `Human` |
| `spec_review` L cell | Unchanged (mini/high) | Move L `spec_review` to full alongside the lens | The 23-task classification found no difference in reviewer-catchable spec problems between Luna- and Sol-reviewed specs | `Human` |
| Effort on the new full-model cells | `high` | `xhigh` | Matches XL `spec_review`/`implement`; `docs/decisions.md` records `high → xhigh` as diminishing returns at ~1.5–2× cost, and the replay that motivated this ran at `high` | `Author` |
| BACKLOG `CODEX_MODEL_REVIEW` entry | Rewrite as the post-release re-measurement follow-up, keeping the yield baseline | Retire it and move the baseline into the new decision's Why | Keeps a visible reminder to re-measure and to decide on M with real data | `Human` |
| Rollback mechanism | Install the previous canon release (no new override) | Add a `CODEX_MODEL_REVIEW` per-phase override now | Matches every other matrix change's rollback story; a new env var is new surface with its own docs/tests and was parked in BACKLOG as a separate idea | `Author` |

## Non-Goals

- No change to the XS, S, or M `code_review` cells, to any effort value, or to the `spec_review` and `implement` rows (`implement` L stays mini/`max`).
- No prompt or custom instructions for the cold lens (`codex exec review` rejects a custom prompt combined with `--base`).
- No new environment variable (`CODEX_MODEL_REVIEW` or any per-phase Codex override).
- No change to review scope selection (`resolveCodeReviewScope()` full vs. delta rounds), bundle mechanics, hard-fail behavior, or the foreman's synthesis.
- No change to `claude` provider mode. The cold-Codex lens never runs there (`providerRunsColdLens()` is false); Claude-mode code review uses the anchored and cold-Claude lenses on the Claude matrix, which already moves to the strong tier at M and raises effort at XL/delicate.
- No edits to historical records: released `CHANGELOG.md` sections, `docs/pipeline-invocations.md` telemetry rows, `docs/harness-audit-2026-06.md`, or superseded `docs/decisions.md` entries other than adding a supersession pointer.

## Acceptance Criteria

- [ ] AC-1: **Policy cells.** `codexMatrix()`'s `code_review` row resolves L and XL to `config.codexModelFull` at `high`, and XS, S, and M to `config.codexModelMini` at `high`. Verify: `tests/pipeline-policy.test.ts`'s `CODEX_MATRIX` table has `code_review` rows XS/S/M → `{model:'mini', effort:'high'}` and L/XL → `{model:'full', effort:'high'}`, and the suite passes. The `spec_review` and `implement` rows in that table are unchanged by this task's diff.
- [ ] AC-2: **Delicate and bundle promotion.** Effective-size promotion carries through to the lens: a delicate M task, a bundle of [S, L], and a bundle of [S, S-delicate] all resolve `codex('code_review')` to the full model at `high`; a bundle of [XS, M] resolves to the mini model at `high`. Verify: `tests/pipeline-policy.test.ts` asserts these four cases (the existing "delicate M uses XL row" test updated to expect `full` for `code_review`, plus new bundle cases).
- [ ] AC-3: **Invocation uses the resolved model.** The cold-Codex subprocess for a `code_review` run receives `-m <CODEX_MODEL_FULL value>` for an L task and for a delicate task, and `-m <CODEX_MODEL_MINI value>` for an M non-delicate task, always with `model_reasoning_effort=high`. Verify: a test drives the real cold-review path (the real `codexBackend`, not the `makeDeps` stub, which hard-codes the cold backend's config and the effective size) with distinct, explicit `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL` values and asserts the literal `-m` argument per case, so it fails if the L/XL cells still point at the mini model. Because those env values are read once at module load, the values must be set in a spawned process; the existing "review invocation parity" harness in `tests/run-task-code-review.test.ts` (fake `codex` on `PATH`, real `agentBackendFor`) is the template.
- [ ] AC-4: **No stale "flat mini" claim remains.** Verify mechanically: `grep -rnE "deliberately flat|stays on (the )?mini|no full-model upgrade|mini / .high. at every size|-m <miniModel>|only comes out for XL|XS/S/M/L non-delicate|review lens stay on their regular" src docs templates README.md .canon .claude --exclude-dir=worktrees --exclude=pipeline-invocations.md --exclude=harness-audit-2026-06.md` returns hits only inside `docs/decisions.md` text covered by an explicit "*(Superseded by …)*" pointer (see AC-6).
- [ ] AC-5: **Named surfaces state the split.** Each of these, read after the change, states that the cold-Codex lens runs the full model at L and XL/delicate and the mini model at XS–M (or, for delicate-only passages, that delicate also moves the mixed-mode cold-Codex lens to the full model):
  - `src/lib/pipeline-policy.ts` `code_review` row comment;
  - `docs/pipeline-orchestrator.md`: the Codex matrix row (the `L` and `XL / delicate` columns read `full / high`), the "the mini model handles most phases…" sentence, the cold-lens paragraph that currently calls the lens "deliberately flat", the `codex exec review` invocation description (placeholder renamed from `<miniModel>` to a size-neutral name, "every size" parenthetical corrected), the `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL` purpose text, and both delicate descriptions (the `delicate` field-table row and the delicate paragraph that lists what delicate promotes), each gaining the lens;
  - `README.md`: the delicate problem/solution table row and the `delicate: true` paragraph;
  - `.claude/skills/canon-pipeline/recovery.md`: the sentence saying a one-step size bump "often raises effort or budget rather than swapping the underlying model" notes that an M→L bump now swaps the mixed-mode cold-Codex lens model.
- [ ] AC-6: **Decision recorded.** `docs/decisions.md` gains a new dated `##` section (2026-11) with Decision / Why / Rule that: states the new cells; summarizes the evidence from *Problem*, including its "how strong this evidence is" caveat, without naming any private project; supersedes only the model clause of §"Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)" (its sequential, hard-fail, bundle, and verbatim-findings rules stay in force); and names the rollback (install the previous canon release, since no per-phase Codex override exists). An inline "*(Superseded by …)*" pointer to the new heading covers both sentences of that 2026-06 Decision paragraph that state the mini model (the `-m <miniModel>` invocation sentence and the "pins … at every size … no full-model upgrade" sentence). No existing heading is renamed. Verify by reading, and `npm run docs-refs-check` passes.
- [ ] AC-7: **BACKLOG follow-up.** The `docs/BACKLOG.md` `CODEX_MODEL_REVIEW` entry is replaced by a re-measurement entry that keeps the yield baseline numbers, names the two post-release measures (cold-lens finding rate and post-PR defect-fix rate on L and delicate tasks), and carries the open question of whether M should follow. Verify by reading, plus mechanically: the rewritten entry contains no match for `\bGP\b|[Gg]allery|@capacitor|Style\.Dark` (the current entry has four such references, which must be generalized, e.g. to "a private adopter project"), and the lines this task adds to `docs/decisions.md` and `CHANGELOG.md` contain none either.
- [ ] AC-8: **Changelog.** `CHANGELOG.md` `## [Unreleased]` gains a `### Changed` subsection (none exists yet) with an adopter-facing bullet covering: the new cold-lens cells; that `CODEX_MODEL_FULL` now also steers the lens at L/XL, so a custom full-model override reaches it; that a bundle containing an L, XL, or delicate member runs its single cold review on the full model; and the rollback path. Verify by reading.
- [ ] AC-9: **Mirror and build parity.** `templates/docs/pipeline-orchestrator.md` matches the root copy (`npm run sync-templates:check` passes), and committed `dist/` matches a fresh `npm run build` (both `dist/cli/index.js` and `dist/orchestrator/run-task.js` are rebuilt).

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/pipeline-policy.ts` | `codexMatrix()` `code_review` row: L and XL → `config.codexModelFull` at `high`; rewrite the row comment |
| `tests/pipeline-policy.test.ts` | Update `CODEX_MATRIX` L/XL `code_review` rows and the delicate-M test; add bundle cases (AC-2) |
| `tests/run-task-code-review.test.ts` | Add the per-size `-m` invocation assertions (AC-3) |
| `docs/pipeline-orchestrator.md` | Matrix row, mini/full model prose, cold-lens paragraph, invocation description, env-var purpose text, delicate paragraph |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror of the root doc (regenerated by `npm run sync-templates`) |
| `docs/decisions.md` | New dated decision section; supersession pointer on the 2026-06 cold-lens model clause |
| `docs/BACKLOG.md` | Rewrite the `CODEX_MODEL_REVIEW` entry as the re-measurement follow-up |
| `README.md` | Delicate table row and `delicate: true` paragraph include the cold-Codex lens |
| `.claude/skills/canon-pipeline/recovery.md` | Size-bump sentence notes the cold-lens model swap at L |
| `templates/.claude/skills/canon-pipeline/recovery.md` | Synced mirror of the root skill file (regenerated by `npm run sync-templates`) |
| `CHANGELOG.md` | `[Unreleased]` → `### Changed` bullet |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt by `npm run build` |

### Interaction Dependencies

- Effective-size resolution (`getEffectiveSize()` in `src/lib/pipeline-policy.ts`): delicate promotes to XL and bundles take the max size, so one L/XL/delicate member puts the whole bundle's single cold review on the full model. This is existing behavior, settled by `docs/decisions.md` (bundle contract), not changed here.
- `resolveCodeReviewScope()`: non-delicate L tasks can still run delta-scope rounds after round 1; XL/delicate always run full scope. Both now run on the full model at L/XL.
- `MAX_REVIEW_LOOPS` uses nominal size: up to five full-model cold reviews per nominal L/XL task, and up to three per delicate S/M task (delicate resolves to the XL cell but keeps its nominal loop cap).
- `docs/pipeline-orchestrator.md` and `.claude/skills/canon-pipeline/recovery.md` are canon-managed and ship to adopters: their new text must not cite canon-internal source paths (the template-sync leak guard rejects backticked `src/orchestrator/` references), so describe the behavior, not `getCodexConfig()` or `policy.ts`.
- `CODEX_MODEL_FULL` / `CODEX_MODEL_DELICATE` now also govern the lens at L/XL; `src/orchestrator/policy.ts` already reads both, no code change there.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — and confirm `git diff --exit-code -- dist/` is clean after committing the rebuilt artifacts
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [ ] `<E2E>` — N/A for canon-ai (no UI surface)

## Docs Impact

- `docs/product-context.md`: line 91 describes mixed-mode Codex models for implementation only; still accurate, but QA should confirm no cold-lens model claim was added elsewhere.
- `docs/architecture.md` and `docs/codebase-map.md`: describe the cold lens without a model; no change expected.
- `docs/patterns.md`: no change expected.

## Known Risks

- **Missed restatement.** The "mini at every size" claim lives in prose across several docs, often paraphrased. Mitigation: AC-4's grep (which includes the known paraphrases) plus AC-5's named read-list.
- **Cost on review loops.** Up to five full-model cold reviews per nominal L/XL task and up to three per delicate S/M task. Mitigation: `high` (not `xhigh`) effort; L and delicate tasks are a minority; the BACKLOG re-measurement entry tracks whether the yield justifies it.
- **AC-3 test passing vacuously or not reaching the matrix.** The existing parity test reads the model dynamically from `getCodexConfig()`, and the `makeDeps` helper stubs the cold backend's config, so neither can catch a wrong cell. Env model values freeze at module load, so in-process env changes do nothing. AC-3 requires a spawned process with distinct explicit model values and literal `-m` expectations per size, following the parity harness.
- **Bundle cost surprise.** A small task bundled with an L, XL, or delicate one now gets a full-model cold review over the combined diff. This follows the existing effective-size rule; AC-8 requires the changelog to say so.
- **Adopter env overrides.** An adopter who set `CODEX_MODEL_FULL` to an expensive or experimental model will now see it on the cold lens at L/XL too; AC-8 requires the changelog to say so.
- **Private names leaking into public docs.** The BACKLOG entry being rewritten already names the private adopter project. AC-7's grep gates the rewritten entry and the new decision/changelog text.

## Human Test Plan

1. Create or pick a task sized L (not delicate) in a mixed-mode project and run it through code review.
2. Open the task's metrics or the pipeline invocation log and check the cold-Codex review row's model: it should be the full Codex model.
3. Repeat with an M task that is not delicate: the cold-Codex review row should show the mini Codex model.
4. Repeat with a small task marked delicate: the cold-Codex review row should show the full Codex model.
5. Read the pipeline guide's Codex model table and the delicate description in the README: they should say large and delicate tasks get the full model for the cold review.
6. Expected: the model used matches the table in every case, and nothing in the docs still claims the cold review always uses the small model.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row (dist artifacts comma-joined), each with a specific change description.
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] If this spec replaces existing behavior: framed as replacing the flat-mini cells with a size split; AC-4 is the structural grep
- [x] Non-Goals rules out the most tempting scope expansions; AC-1 pins the untouched rows
- [x] Symbols named in ACs actually exist in the codebase (grep-verify before marking spec done)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A — behavior change, not a bug fix
- [x] (Refactors) N/A — not a refactor
- [x] *Judgment Calls* lists every judgment call the spec makes, each with its strongest alternative and a Decided by value
