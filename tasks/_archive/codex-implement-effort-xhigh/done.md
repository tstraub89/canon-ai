# Completion Summary: codex-implement-effort-xhigh — Raise mini implement effort and default the full model to GPT-6.1 Sol

> For the human. This is what you need to know.

## What Changed

Codex implementation now runs at higher effort on small and medium-to-large tasks. Extra-small and small tasks use the mini model at extra-high effort, up from medium. Medium and large tasks use the mini model at a new maximum effort, up from high. Extra-large and delicate tasks keep the full model at high effort, which is unchanged. The shipped default for the full model moves from GPT-6 Sol to GPT-6.1 Sol. Users who set the full-model environment variable themselves are unaffected.

Maximum effort is now an accepted value. It needs a Codex CLI and mini model that accept it. Only Codex CLI 0.164.0 with `gpt-6-luna` has been verified. Canon does not check this at runtime. If an older CLI or a different mini model is in use, a medium or large implement run can fail at the Codex call. The pipeline guide's environment-table caveat gives the recovery steps.

Effort has no environment override, so the stale "raise effort via env" claims in the code comment, the pipeline guide, the product context and the decisions log are corrected. Those docs now say effort comes only from the matrix.

The new decisions entry records the evidence (vendor-published benchmarks plus a small operator cohort), both maximum-effort probes, the rollback steps, and the follow-up measurement. It is written as a hypothesis to measure, not a settled result.

## Files Changed

- `src/lib/pipeline-policy.ts` — implement cells set to mini/xhigh (XS, S), mini/max (M, L); implement comment rewritten.
- `src/orchestrator/agents/codex.ts` — `max` added to valid Codex efforts.
- `src/orchestrator/policy.ts` — full-model fallback changed to `gpt-6.1-sol`.
- `tests/pipeline-policy.test.ts` — implement matrix expectations updated.
- `tests/run-task-code-review.test.ts` — `max` accepted, unknown effort still rejected, effort-list assertion ends `|xhigh|max`.
- `docs/pipeline-orchestrator.md` — Codex matrix table and prose, full-model default row, `max` caveat with recovery path, delicate wording.
- `templates/docs/pipeline-orchestrator.md` — regenerated mirror of the guide above.
- `docs/product-context.md` — tier summary (XS cell, effort-scaling claim, XL/delicate sentence and cross-reference).
- `README.md` — delicate flag wording and the "effort scaling by task size" phrase.
- `docs/decisions.md` — new GPT-6.1 entry; inline "superseded by" notes on the earlier entries.
- `dist/orchestrator/run-task.js` — rebuilt bundle, committed with the change.

## How to Test

1. Preview the pipeline plan for a small task and for a medium task. Expected: implementation uses the mini model at extra-high effort for the small task and at maximum effort for the medium one.
2. Preview the plan for a delicate task. Expected: implementation uses GPT-6.1 Sol at high effort.
3. Read the Codex model and effort table in `docs/pipeline-orchestrator.md`. Expected: it matches the previews. It says nothing about raising effort with an environment variable, and it names the Codex CLI and model that support maximum effort.
4. Read the README's description of the delicate flag. Expected: it describes a stronger model, not "highest effort".

## Test Results

These results come from the implementer's validation run recorded in `tasks/codex-implement-effort-xhigh/handoff.md`. QA did not re-run the checks.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass (1,752 passed, 0 failed, 1 skipped as environment-gated) |
| `npm run build` | Pass (`dist/orchestrator/run-task.js` rebuilt; `dist/cli/index.js` unchanged) |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| Stale-claim and source-default greps (AC-3, AC-4, AC-5) | Pass (no matches) |
| E2E tests | Not in this spec's validation list; not run |

Code review verdict: approved with nits. The nit is listed under Open Questions.

## Human Verification Required

None.

Pre-merge checklist. None of these can be confirmed from the QA phase:

- [ ] Version correct. The release step decides the bump tier. The decisions entry classifies this as a minor change, so the bump is minor.
- [ ] Changelog updated. The proposed entry is below. It goes in at release time through `/canon-changelog`.
- [x] PR body current. Drafted in `tasks/codex-implement-effort-xhigh/pr-body.md`.
- [ ] Final CI/CD checks green. Not checked; the branch has not been pushed.
- [x] Final diff matches spec intent. Code review found all eight acceptance criteria met.

## Proposed Changelog

### Changed

- **Codex `implement` runs at higher effort on small through large tasks, and the full model now defaults to GPT-6.1 Sol.** Extra-small and small tasks run the mini model at `xhigh` effort, and medium and large tasks run it at `max`. Extra-large and delicate tasks stay on the full model at `high`. The shipped full-model default moves from `gpt-6-sol` to `gpt-6.1-sol`; set `CODEX_MODEL_FULL` to keep the old model. Effort has no environment override, so restoring the old effort cells means installing the previous release. `max` needs a Codex CLI and mini model that accept it; the pipeline guide lists the verified pair.

## Decisions Made

- **Effort values.** XS and S use `xhigh`; M and L use `max`. XL and delicate stay on the full model at `high`. The spec sets these values, and the decisions entry gives the reasons.
- **Maximum effort is not gated.** Canon does not check the Codex CLI or mini-model version, per the spec's non-goals. The guide documents the requirement and the recovery path.
- **Docs that record past decisions were not rewritten.** Earlier decision entries keep their original text and get inline "superseded by" notes, as the spec requires. The 2026-06 entry's "overthinks" rationale stays as written, with a superseded note. The new entry addresses the 2026-07 "diminishing returns" evidence.
- **Dismissed review findings.** The cold reviewers raised the CLI-version gap, the missing `canon doctor` check, and the unverified `gpt-6.1-sol` string. Each is an accepted spec non-goal or known risk, and each is recorded in `tasks/codex-implement-effort-xhigh/review.md`.
- **Docs freshness.** QA grepped the shipped docs, README and source for stale effort and model claims. The only remaining matches are historical decision text, which the spec keeps, and the still-correct spec-review comment. No further edits were needed.

## Open Questions

- **Optional test gap.** No test pins the `gpt-6.1-sol` default string, and no test checks that matrix efforts pass the validator. The review rated this a nit at `tests/run-task-code-review.test.ts:247`. Decide whether to add a follow-up test.
- **Maximum effort is verified on one pair only.** Only Codex CLI 0.164.0 with `gpt-6-luna` has been probed. The decisions entry names the follow-up measurement: `code_review` rounds and `changes_requested` rates for non-delicate XS–L tasks, before and after the change date, in `docs/task-quality-log.md`.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Code review approved with nits (one optional test-pin nit); no human reroute; check results taken from the handoff run, not re-run in QA.

Maintenance: lessons-learned.md plus this task's fragment have 16 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
