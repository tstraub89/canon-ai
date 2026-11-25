# Completion Summary: empty-model-env-unset — Treat empty model env vars as unset

> For the human. This is what you need to know.

## What Changed

An exported model setting that is empty, or only spaces, now counts as unset. Before this change, a blank `CLAUDE_MODEL` (or a blank per-phase Claude model, a blank light/strong tier variable, or a blank `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL`, including their deprecated names) was passed to the agent as an empty model name. Every Claude phase without another model setting ran with a blank model, and a blank Codex variable also hid both the deprecated fallback and the Codex model set in `.canon/config.json`. Now a blank value falls through to the next setting in the same order as before, so Codex uses the config file again. Non-empty model values have surrounding spaces trimmed. The deprecation warning for legacy model variables stays silent for blank values. The precedence order and the default models are unchanged.

## Files Changed

- `src/orchestrator/env.ts` — adds the `envModel` helper, which returns the trimmed value or nothing when the variable is unset or blank. The deprecation warning for the legacy model variables uses it too.
- `src/orchestrator/policy.ts` — every Claude and Codex model variable is read through `envModel`. `CLAUDE_BUDGET` is unchanged.
- `tests/pipeline-policy.test.ts` — checks blank and whitespace-only values for all 14 model names against their unset baseline, named precedence cases, trimming, legacy warnings, and the unchanged empty budget.
- `tests/run-task-codex-config.test.ts` — checks that blank Codex mini and full variables fall through to the configured models.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — one sentence in Environment Variables saying blank model variables count as unset and values are trimmed.
- `dist/cli/index.js` and `dist/orchestrator/run-task.js` — rebuilt bundles.

`src/lib/pipeline-policy.ts` is not changed.

## How to Test

1. In a project that uses canon, run `export CLAUDE_MODEL=` (nothing after the equals sign), then start a pipeline run on a small task.
2. Expected: each phase's log shows its normal default model (for example Sonnet for a light phase and Haiku for QA), not a blank model, and no agent fails at start.
3. Unset `CLAUDE_MODEL`, run `export CODEX_MODEL_MINI=` with nothing after, and make sure `.canon/config.json` names a mini Codex model. Run a phase that uses Codex.
4. Expected: the Codex phase uses the model named in `.canon/config.json`.
5. Run `export CLAUDE_MODEL='  '` (spaces only).
6. Expected: no deprecation warning is printed for it.
7. Run `export CODEX_MODEL_MINI=` and `export CODEX_MODEL_DEFAULT=legacy-mini`.
8. Expected: the run uses `legacy-mini`, and the only deprecation warning is the existing one for `CODEX_MODEL_DEFAULT`.

## Test Results

| Check | Result | Notes |
|---|---|---|
| Lint | Pass | `npm run lint`, from the handoff's Validation Outcomes (iteration 2). QA did not re-run it. |
| Type-check | Pass | `npm run type-check`, from the handoff. QA did not re-run it. |
| Unit tests | Pass | `npm test`: 2,323 passed, 1 skipped, from the handoff. QA did not re-run it. |
| E2E tests | Skipped | Not in the spec's Validation Required list. |
| Build | Pass | `npm run build`; `dist/` rebuilt and committed. From the handoff. |
| Template sync | Pass | `npm run sync-templates:check`, from the handoff. |
| Docs refs | Pass | `npm run docs-refs-check`, from the handoff. |
| Red-first, Claude (AC-6) | Recorded | On the pre-fix source, a blank `CLAUDE_MODEL` resolved to `''` where `sonnet` was expected. |
| Red-first, Codex (AC-6) | Recorded | On the pre-fix source, a blank `CODEX_MODEL_MINI` resolved to `''` where the fallback should apply. |

## Human Verification Required

None. No check in the latest Validation Outcomes is `human_pending`.

Pre-merge checklist. QA could not confirm these:

- [ ] Version correct (per project policy). The bump tier and version number are decided at the release step. This is a bug fix, so it would be a patch release under the policy.
- [ ] Changelog updated if needed. The proposed entry is below; the human finalizes it.
- [x] PR body current. `tasks/empty-model-env-unset/pr-body.md` was written in QA.
- [ ] Final CI/CD checks green. QA did not check CI.
- [ ] Final diff matches spec intent. QA checked the spec, handoff and review text against the diff summary. A human should read the diff once before merge.

## Proposed Changelog

Scope: this is a bug fix that changes what adopters get when they export a blank model variable, so it qualifies under the policy's changelog scope and the "would a user notice" test. The version number and bump tier are not proposed here.

- **Blank model variables are ignored.** An exported `CLAUDE_MODEL`, per-phase `CLAUDE_MODEL_*` variable, `CODEX_MODEL_MINI` or `CODEX_MODEL_FULL` that is empty or only spaces used to reach the agent as an empty model name. canon now treats it as unset and uses the next setting in the usual order, including `.canon/config.json` for Codex. Surrounding spaces in a model name are trimmed.

## Judgment Calls to Confirm

- Whitespace-only values count as unset — chosen: unset, like empty; alternative: only `''` counts as unset, matching the current `CLAUDE_MODEL_LIGHT` behavior.
- Non-empty values are trimmed before use — chosen: trimmed; alternative: used verbatim, so a trailing space reaches `--model`. The `.canon/config.json` model strings are not trimmed.
- Blank values are silent — chosen: no warning; alternative: warn "X is set but empty; ignoring", as the spec's judgment-call table records.
- Helper location — chosen: one exported helper in `src/orchestrator/env.ts`, used by `policy.ts` and the warning; alternative: a helper in `policy.ts` with a second check in `env.ts`.
- Scope — chosen: model variables only; alternative: include `CLAUDE_BUDGET`, which has the same `??` empty-string issue.
- Delicate — chosen: not delicate; alternative: treat as delicate, since `docs/product-context.md` lists pipeline policy as delicate.

## Decisions Made

- The helper is `envModel(name)`, which returns `process.env[name]?.trim() || null`. The warning uses it for every entry in the legacy fallback list, which holds the three legacy model variables. The `CODEX_EFFORT_*` ignored-variable check keeps its existing truthy check, as the spec's Non-Goals require.
- The fix sits only at the env read boundary. `src/lib/pipeline-policy.ts` is not touched, which keeps the AC-5 check clean.
- Code review round 1 requested changes because the named precedence cases in AC-1 had no direct assertions. Round 2 added a test, `blank model overrides preserve Claude and Codex fallback precedence`, that asserts each case.
- The AC-6 red-first evidence was recorded against the pre-fix working tree for Claude and the HEAD policy source for Codex. It is not tied to a commit. The reviewer accepted it.

## Open Questions

None.

## Follow-ups

| Category | Follow-up | Tracked |
|---|---|---|
| nit | `envModel` sits above the path constants in `src/orchestrator/env.ts`. Move it below them to match the file's layout. | #185 |
| nit | In `tests/pipeline-policy.test.ts`, the test `blank legacy model overrides resolve like unset variables` overlaps the new precedence test. Keep or merge them. The red-first command targets it by name. | #185 |
| nit | In `tests/pipeline-policy.test.ts`, the legacy-warning test hard-codes a count of five messages. It breaks if the legacy list changes. | #185 |
| nit | The handoff's AC-6 Claude red-first evidence cites the pre-fix working tree, not a commit. The reviewer accepted it. | dropped |
| observation | `CLAUDE_BUDGET=''` still passes through as an empty string. It needs its own number parsing (spec Non-Goal). | #185 |
| observation | The `CODEX_EFFORT_*` legacy warnings still use a truthy check, so a whitespace-only value still prints a warning. | #185 |
| observation | Trim the model strings in `.canon/config.json` so env and config agree on surrounding spaces (spec Non-Goal). | #185 |
| observation | The remaining #185 items: doctor wording, the unknown-key hint, duplicated defaults and the deprecation text. | #185 |

## Quality Log

- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 1
- Validation gaps: 0
- Notes: Code review round 1 requested changes because AC-1's named precedence cases had no assertions; round 2 fixed it, and the handoff also needed an iteration to fix a table pipe.

## Root Cause

- execution: AC-1's named precedence cases (a blank primary variable shadowing a set fallback) were covered only by the unset-baseline loop, so round 1 found no assertion for them. The context was adequate.
- execution: the first handoff had an unescaped pipe inside a table cell, which the handoff parser rejected at pre-flight.

Maintenance: lessons-learned.md plus this task’s fragment have 19 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
