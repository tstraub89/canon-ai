# Completion Summary: default-qa-model-to-haiku — Make Claude Haiku 5.5 the default QA model

> For the human. This is what you need to know.

## What Changed

The QA step now runs Claude Haiku 5.5 at medium effort at every task size, including delicate, unless you override it. Before, QA shared the light model tier with the spec, plan and code-review steps for small tasks, so it ran Sonnet by default. QA now has its own default, and the light and strong model settings no longer reach it. Setting `CLAUDE_MODEL_QA` still overrides it, and the legacy `CLAUDE_MODEL` setting still works as a fallback. Spec, plan and code review are unchanged. The reason is that QA writes the completion summary and cannot block or reroute a task. The evidence is operator-reported (about 37 Haiku-QA tasks across two repos, no QA failures) and uncontrolled, so the decision entry treats it as a hypothesis to measure.

Adopters who pinned only the light model see QA move to Haiku on upgrade. Adopters who pinned both the light model and the legacy `CLAUDE_MODEL` see QA move to the legacy value. Adopters who pinned `CLAUDE_MODEL_QA` see no change. The decision entry lists every case and the one-line rollback.

## Files Changed

- `src/lib/pipeline-policy.ts` — QA resolves `CLAUDE_MODEL_QA` → `CLAUDE_MODEL` → `claude-haiku-5-5`; the `effectiveSize` comment now says QA keeps its own default.
- `src/orchestrator/env.ts` — the legacy `CLAUDE_MODEL` warning names `CLAUDE_MODEL_QA` as a replacement.
- `tests/pipeline-policy.test.ts` — QA matrix rows updated for every size and delicate M; new precedence cases for QA.
- `docs/pipeline-orchestrator.md` — model matrix, prose and environment-variable rows updated for the QA default and rollback.
- `templates/docs/pipeline-orchestrator.md` — regenerated mirror of the guide above (not hand-edited).
- `docs/product-context.md` — full-tier summary now says QA runs Haiku at medium.
- `docs/decisions.md` — new entry after the Codex implement-effort decision, with the evidence, precedence table, pinned-adopter changes, rollback and measurement rule; superseding notes on the 2026-09 Claude entry.
- `dist/orchestrator/run-task.js` — rebuilt; contains `claude-haiku-5-5`.

## How to Test

1. With no Claude model variables set, preview the pipeline for a small task and for a large task. Expected: QA shows Claude Haiku 5.5 at medium effort. Spec, plan and code review show the same models as before (Sonnet for small, Opus for large).
2. Preview a delicate task. Expected: QA still uses Haiku at medium; the other Claude steps use Opus at high.
3. Set only the light-tier model override and preview a small task. Expected: small-task spec, plan and code review use the override; QA still uses Haiku.
4. Set the QA model override to Sonnet and preview any task. Expected: QA uses Sonnet.
5. Read the Claude model table and environment-variable list in the pipeline guide. Expected: they match the previews, and the guide explains how to put QA back on Sonnet.

## Test Results

These are the results recorded by the implementer in `tasks/default-qa-model-to-haiku/handoff.md`. QA did not re-run them.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass (1,756 passed, 1 skipped, 0 failed) |
| `node --import tsx --test tests/pipeline-policy.test.ts` | Pass (109 passed) |
| `npm run build` and `git diff --exit-code -- dist/` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| AC-4 stale-phrase greps | Pass (zero matches) |
| AC-5 model-variable grep | Pass (exact seven-variable set) |
| `git diff --check` | Pass |

Code review (`tasks/default-qa-model-to-haiku/review.md`) approved with nits. All seven acceptance criteria were marked met. The nits are optional and were not acted on.

## Human Verification Required

None.

Pre-merge checklist (none of these can be confirmed from the QA phase):

- [ ] Version correct — decided at the release step, not here. This is a minor bump per `docs/decisions.md` §"Versioning and release policy".
- [ ] Changelog updated — the proposed bullet below is for `/canon-changelog` at release time.
- [x] PR body current — drafted in `tasks/default-qa-model-to-haiku/pr-body.md`.
- [ ] Final CI/CD checks green — not checked.
- [ ] Final diff matches spec intent — code review marked all ACs met; QA did not re-diff.

## Proposed Changelog

- **QA now defaults to Claude Haiku 5.5 instead of Sonnet.** The QA step runs `claude-haiku-5-5` at medium effort at every task size, and `CLAUDE_MODEL_LIGHT` no longer changes it. Set `CLAUDE_MODEL_QA=sonnet` to keep the old model. If you set `CLAUDE_MODEL_LIGHT` and also `CLAUDE_MODEL`, QA moves to the `CLAUDE_MODEL` value instead of Haiku.

## Decisions Made

- QA gets its own default model rather than a third tier or a changed light-tier fallback. This follows the spec's option 3. No new environment variable was added.
- The default is the full ID `claude-haiku-5-5`, not the floating `haiku` alias, so a future Haiku generation needs its own decision entry.
- Internally, QA is a `qa` value on the unexported `ClaudeTier` with a `QA_DEFAULT_MODEL` constant. The spec left this representation to the implementer; the code review accepted it.
- Effort stays at medium for QA, and no budget, prompt or Codex setting changed.

## Open Questions

- The empty-string `CLAUDE_MODEL_QA` case is unchanged: the policy module's existing nullish-coalescing check on that variable (`src/orchestrator/policy.ts`) still treats an empty value as set. The spec kept this out of scope. Decide whether it needs a follow-up.
- The QA fix-up session has no Haiku runs in the field evidence. If it fails on Haiku, pin `CLAUDE_MODEL_QA`.
- Bundle QA does not salvage a `done.md` that the agent streams to stdout. The field runs did not show this, but if it appears, bundle QA stops incomplete.
- Measurement is still open. Compare `qa` rows on Sonnet with rows on `claude-haiku-5-5` in `docs/pipeline-invocations.md` for status, duration, and any `done.md` gaps seen at human review, as the decision entry describes.

Maintenance: lessons-learned.md plus this task's fragment have 19 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Spec approved on the first Codex review with no changes; code review approved with nits and no dropped ACs.
