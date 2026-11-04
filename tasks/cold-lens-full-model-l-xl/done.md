# Completion Summary: cold-lens-full-model-l-xl — Cold-Codex review lens uses the full model at L and XL/delicate

> For the human. This is what you need to know.

## What Changed

In mixed mode, the orchestrator's cold-Codex review (the diff review that runs before the Claude reviewers in `code_review`) used the mini Codex model at every size, including delicate tasks. It now uses the full model at effective size L and XL, which includes every delicate task and any bundle with an L, XL, or delicate member. XS, S, and M stay on mini. Effort stays `high` everywhere. No other phase or cell changed. The reason is evidence that post-PR defects rise with task size and that the in-pipeline lens was rarely catching them. That evidence is weak (one positive replay, one null replay, size confounded with diff size), so the decision is recorded as a bounded bet with a re-measurement follow-up. `CODEX_MODEL_FULL` now also steers the lens at L/XL, and the rollback is to install the previous canon release, since there is no per-phase override.

## Files Changed

- `src/lib/pipeline-policy.ts` — `code_review` row: L and XL resolve to the full model at `high`; row comment rewritten.
- `tests/pipeline-policy.test.ts` — L/XL cells pinned to full; delicate-M promotion expects full; bundle cases added ([S, L], [S, S-delicate] → full; [XS, M] → mini).
- `tests/run-task-code-review.test.ts` — new fresh-process test through the real Codex backend with distinct explicit `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL` values and literal `-m` assertions for L, delicate M, and ordinary M.
- `docs/pipeline-orchestrator.md` — matrix row, model prose, cold-lens paragraph, invocation placeholder, env-var purpose text, both delicate descriptions.
- `templates/docs/pipeline-orchestrator.md` — synced mirror of the above.
- `docs/decisions.md` — new `## Cold-Codex lens uses the full model at L and XL/delicate (2026-11)` section; the 2026-06 cold-lens entry gets a supersession pointer covering only its model clause.
- `docs/BACKLOG.md` — `CODEX_MODEL_REVIEW` entry rewritten as the post-release re-measurement follow-up; yield baseline kept; private references generalized.
- `README.md` — both delicate descriptions now include the cold-Codex lens.
- `.claude/skills/canon-pipeline/recovery.md` — notes that an M→L bump swaps the cold-lens model.
- `templates/.claude/skills/canon-pipeline/recovery.md` — synced mirror.
- `CHANGELOG.md` — `[Unreleased]` → `### Changed` bullet (see Proposed Changelog).
- `dist/orchestrator/run-task.js` — rebuilt with the new cells. `dist/cli/index.js` rebuilds byte-identical and is not changed.

## How to Test

1. Take a task sized L (not delicate) in a mixed-mode project and run it through code review.
2. Open the task's metrics or the pipeline invocation log and check the cold-Codex review row's model. Expected: the full Codex model (default `gpt-6.1-sol`).
3. Repeat with an M task that is not delicate. Expected: the mini Codex model.
4. Repeat with a small task marked delicate. Expected: the full Codex model.
5. Read the pipeline guide's Codex model table and the README's delicate description. Expected: both say large and delicate tasks get the full model for the cold review.
6. Expected overall: the model used matches the table in every case, and no doc still says the cold review always uses the small model. Steps 2–4 are live, paid runs and were not performed here.

## Test Results

Results below are the implement handoff's runs (`tasks/cold-lens-full-model-l-xl/handoff.md`). QA did not re-run them.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 2,072 tests: 2,071 passed, 0 failed, 1 skipped. The handoff does not say which test was skipped, so the skipped test is unverified. |
| Focused matrix and backend tests (22) | Pass (16 passed plus 6 expected failures before the fix; all 22 pass after) |
| `npm run build` | Pass — both entry points rebuilt; a second build produced identical digests |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| AC-4 stale-claim grep | Pass — sole hit is the superseded historical paragraph in `docs/decisions.md` |
| E2E | N/A — no UI surface (spec Validation Required) |

## Human Verification Required

None. The handoff's Validation Outcomes table has no `human_pending` rows.

The spec's Human Test Plan (How to Test steps 2–4) needs live model runs and was not performed. It is not a handoff check, so it is listed here rather than as a pending check.

Pre-merge checklist — items not confirmed:
- [ ] Version correct — unversioned per task; the version is decided at the release step.
- [ ] Changelog updated — an `[Unreleased]` bullet is on the branch; confirm the wording (see Proposed Changelog).
- [x] PR body current — `tasks/cold-lens-full-model-l-xl/pr-body.md` written.
- [ ] Final CI/CD checks green — not checked; CI has not run on the PR.
- [ ] Final diff matches spec intent — the anchored code-review lens passed Stage 1 against every AC.

## Proposed Changelog

- **The mixed-mode cold-Codex review lens uses the full Codex model on L and XL/delicate tasks.** XS, S and M tasks keep the mini model; effort stays `high` everywhere. `CODEX_MODEL_FULL` now also steers the lens on L, XL and delicate tasks, so a custom full-model override reaches it. The deprecated `CODEX_MODEL_DELICATE` fallback reaches the lens the same way. A bundle containing an L, XL, or delicate member runs its single cold review on the full model. To restore the mini model at every size, install the previous canon release; there is no per-phase Codex override.

Note: the `[Unreleased]` bullet already on the branch matches this text except that it omits the `CODEX_MODEL_DELICATE` sentence. Code review (N3) flagged that omission as adopter-facing. The sentence is included here as the recommended wording. QA did not edit `CHANGELOG.md`.

## Judgment Calls to Confirm

- Effort on the new full-model cells — chose `high`; alternative: `xhigh`. Matches XL `spec_review`/`implement`. The replay that motivated the change ran at `high`, and `docs/decisions.md` records `high → xhigh` as diminishing returns at roughly 1.5–2× cost.
- Rollback mechanism — chose install the previous canon release (no new override); alternative: add a `CODEX_MODEL_REVIEW` per-phase override now. A new env var is new surface with its own docs and tests, and was parked in `docs/BACKLOG.md`.

## Decisions Made

- Written tests before production edits, so the new assertions were confirmed to fail on the old cells (six expected failures) before the two-cell fix.
- AC-9 read as "rebuild both entry points and keep only real deltas." `dist/cli/index.js` contains only env defaults, not `codexMatrix`, and rebuilds byte-identical, so it is not listed as changed. The spec's Affected Files over-assumed that both bundles change; code review accepted this.
- The new fresh-process test sets both override values before import and drives the real cold-review backend. This is because env values freeze at module load and the `makeDeps` stub hard-codes the cold backend's config, so neither can catch a wrong cell.
- Commits: the implementation is committed as `962f338` on this branch. The handoff notes the orchestrator owns commits.

## Open Questions

Code review returned `approved_with_nits`. None of these blocks merge. The nits are not addressed in the branch. Decide which to fix before merge:

- **N3 (recommended before release):** `CHANGELOG.md` omits the deprecated `CODEX_MODEL_DELICATE` fallback. See Proposed Changelog.
- **N2:** the `CODEX_MODEL_MINI` purpose text in `docs/pipeline-orchestrator.md` (and mirror) can read as the delicate XS–M lens using mini. Suggested: "the non-delicate cold-Codex review lens at XS–M."
- **N4:** the decision's loop-count sentence says "up to" and omits delicate XS, which also resolves to XL with nominal cap 3.
- **N1:** the 2026-10 measurement entry compares non-delicate XS–L rounds before/after its date. Post-release non-delicate L tasks now change the cold-lens model too. A one-line note in the 2026-11 Rule would keep that comparison interpretable.
- **N5:** curly apostrophes in new text (`invocation’s`, `bot’s`, `replay’s`, `bundle’s`) mix with the files' straight quotes. `docs/pipeline-orchestrator.md` ships to adopters.
- **N6:** doubled "in mixed mode" in `README.md`.
- **N7, N8:** no change required (a superseded entry; no multi-task bundle invocation test). Recorded only.

Other open items:
- Which test is the one skipped in `npm test`? The handoff does not name it. Identify it to confirm it is not a required case.
- The live human test plan (cold-lens model on real L, M, and delicate tasks) is still to be run after merge.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Spec approved first pass; code review approved_with_nits (eight non-blocking nits, none blocking); one skipped npm test is unidentified in the handoff.

Maintenance: lessons-learned.md plus this task’s fragment have 29 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Root Cause

None.
