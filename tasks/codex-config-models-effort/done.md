# Completion Summary: codex-config-models-effort — Codex models and implement effort in .canon/config.json

> For the human. This is what you need to know.

## What Changed

Codex models and Codex implement effort can now be set per repository in `.canon/config.json`, under a new optional `codex` section. Before this, the implement effort was fixed in the release, and the only override was an environment variable that depended on the shell. The section sets the mini and full Codex models and the implement effort for each task size (XS, S, M, L, XL; XL also covers delicate tasks). Any key left out falls back to the built-in default. Environment variables still win over the file, so the existing per-run overrides keep working.

The built-in implement defaults drop one notch: XS goes from `xhigh` to `medium`, S from `xhigh` to `high`, M from `max` to `high`, and L from `max` to `xhigh`. XL and delicate stay at the full model on `high`. The spec's measurement showed the previous XS and S effort roughly doubled implement time with no measured gain in review rounds. The M and L changes are a judgment call, not a measured result. Spec review and cold-Codex review effort are unchanged.

The Codex section is read only from the main checkout's config, at startup and at each Codex call. An edit on main therefore reaches a task already in flight at its next Codex call. A task worktree's copy of the section is never validated or applied. Invalid values stop the run with a message that names the key and the allowed values. `canon run --ship` skips this section, so a bad value does not block merge or archive. `canon doctor` reports the section under its own check.

Every telemetry row now ends with an Effort cell. Rows written before the upgrade keep their nine cells and show a blank Effort cell.

## Files Changed

- `src/lib/pipeline-policy.ts` — new implement defaults, optional per-size overrides, shared effort type and set.
- `src/orchestrator/docs-freshness.ts` — parser and loader for the `codex` section; the shared parser recognises the key without validating it.
- `src/orchestrator/policy.ts` — env-only model snapshot; Codex settings read fresh from the main checkout and applied after env and before the built-in default.
- `src/orchestrator/main.ts` — startup validation of the main checkout's `codex` section, including `--dry-run`; plain `--ship` skips it.
- `src/cli/commands/doctor.ts` — separate Codex config check.
- `src/orchestrator/agents/codex.ts` — effort recorded on metric rows; revised invalid-effort error; cold-review run-log line with model and effort.
- `src/orchestrator/agents/claude.ts` — resolved effort on session rows; `-` on sub-agent rows.
- `src/orchestrator/types.ts` — required effort field on metric entries.
- `src/orchestrator/metrics.ts` — ten-column skeleton and trailing Effort cell.
- `src/orchestrator/env.ts` — retired effort-variable warning now points to the config section.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt.
- `docs/pipeline-invocations.md`, `templates/docs/pipeline-invocations.md` — Effort header and notes; historical rows unchanged.
- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` — `codex` section, precedence, config root, `--ship` exemption, defaults, validation.
- `.canon/README.md`, `templates/.canon/README.md` — `codex` config example and reference.
- `README.md` — Codex configuration subsection; doctor coverage.
- `docs/decisions.md` — new decision entry with the measurement table; superseded notes on the historical entries named in the spec.
- `docs/product-context.md`, `docs/codebase-map.md`, `docs/architecture.md`, `docs/patterns.md` — current defaults, config mechanism, effort telemetry, and the main-checkout Codex exception.
- Tests: `tests/pipeline-policy.test.ts`, `tests/docs-freshness.test.ts`, `tests/run-task-codex-config.test.ts` (new), `tests/metrics.test.ts`, `tests/claude-subagent-metrics.test.ts`, `tests/run-task-code-review.test.ts`, `tests/agent-backend.test.ts`, `tests/cli.test.ts`, `tests/run-task-ship-docs-fold.test.ts`, `tests/run-task-safety-routing.test.ts`.

## How to Test

1. In a scratch repo with canon installed and no `codex` section, run a dry run for a small task. Expected: implement shows `high` effort.
2. Add `codex.implement_effort` with a small-task value of `low`, then dry-run again. Expected: implement shows `low`; spec review and code review are unchanged.
3. Set one effort to a value outside the allowed list and dry-run. Expected: the run stops immediately, naming the bad value and listing the allowed ones. `canon doctor` reports it under its Codex check, and the docs-freshness check still passes.
4. With that bad value still in place, ship an already-approved task. Expected: shipping is not blocked.
5. Fix the value. Set a mini model name in the config, then set the mini-model environment variable to a different name for one run. Expected: that run uses the environment variable's model; without it, runs use the config's model.
6. Run a small task through review and open the invocation log. Expected: new rows end with an Effort value; older rows show that cell blank.
7. While a task is between implement and review, change the effort in the main checkout's config. Expected: the next implement run uses the new effort.

These are the spec's Human Test Plan steps. They were not run in this QA pass.

## Test Results

| Check | Result |
|---|---|
| `npm run build` | Pass — both declared bundles rebuilt; no `dist/` delta on the final revision |
| `npm run type-check` | Pass |
| `npm run lint` | Pass (type-aware, warnings denied) |
| `npm test` | Pass — 2,248 tests: 2,247 passed, 0 failed, 1 skipped (the handoff does not name the skipped test) |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| Focused Codex config, policy, metrics, and ship-fold suites | Pass (part of the full run; the handoff lists 226 and then 10 focused tests) |
| Cold-Codex review, Round 3 | No findings; 592 scoped tests, type-check, lint, template sync, docs-refs, and fresh-build comparison passed |
| E2E | N/A — no UI surface |

Live Codex and Claude calls were not run in any check. Model and effort compatibility is verified only at the argv level, through the backend tests.

## Human Verification Required

None.

Handoff Validation pre-merge checklist (items this QA pass cannot confirm):

- [ ] Version correct — not bumped in this task. The release step decides the version.
- [ ] Changelog updated if needed — `CHANGELOG.md` is not edited here, per the spec. The release entry must cover the items in the Proposed Changelog section and the spec's Non-Goals.
- [x] PR body current — drafted in `tasks/codex-config-models-effort/pr-body.md`.
- [ ] Final CI/CD checks green — not run in this QA pass.
- [x] Final diff matches spec intent — Round 3 anchored and cold reviews approved, and the spec's acceptance criteria are marked Met.

## Proposed Changelog

- **Codex models and implement effort are configurable in `.canon/config.json`.** A new optional `codex` section sets the mini and full Codex models and the implement effort for each task size. Environment variables still take precedence, and the section is read from the main checkout. Invalid values stop the run and name the key.
- **Default Codex implement effort is lower for XS, S, and M, and for L it drops one step.** XS is now `medium` (was `xhigh`), S is `high` (was `xhigh`), M is `high` (was `max`), and L is `xhigh` (was `max`). XL and delicate tasks are unchanged. Set `codex.implement_effort` to restore the previous values.
- **Telemetry records the effort used for each agent run.** `docs/pipeline-invocations.md` gains a trailing Effort column. Rows from before the upgrade keep nine cells and show a blank Effort cell.
- **`canon doctor` checks the `codex` section on its own**, separately from the docs-freshness check.

## Judgment Calls to Confirm

- Validation strictness — hard error for a wrong type, an invalid effort, or an unknown size key; warning for other unknown keys. Alternative: warn on everything and fall back to defaults, which would silently ignore a bad effort setting.
- Effort config scope — the `implement` row only. Alternative: also spec_review and the cold-Codex lens. The evidence concerns implement only.
- Effort cell when canon passes no effort — `-`; a rejected value is logged as written. Alternative: copy the parent session's effort, or leave the cell blank.
- Doctor reporting — a separate Codex check reading the main checkout. Alternative: fold it into the existing "Docs freshness" check, which would show a "delete the file" hint for a Codex error.
- Spawn-time invalid-effort message — keeps the "bug in canon" attribution and drops "not configurable". Alternative: point the operator at `.canon/config.json`.
- Model × effort compatibility — not validated; effort is checked against the model-agnostic set only. Alternative: a per-model allowed-effort table, which canon has no reliable source for.

## Decisions Made

- The handoff's blocker on `--ship --dry-run` was resolved by interpretation. Plain `--ship` skips the Codex section. The combined `--ship --dry-run` form validates it, because a dry run resolves agent configs. This follows the provider-pin precedent and the spec's "spawns no agent" rationale. Both forms have regression tests. Round 1 accepted this reading.
- Malformed JSON in the main checkout's `.canon/config.json` now stops every non-ship run at startup, including worktree tasks and `claude`-mode runs. This follows the spec's "hard errors stop the run" rule. An unreadable file cannot yield a `codex` section. Documented in the README and the orchestrator doc.
- A malformed main-checkout file in worktree mode was previously invisible, because the shared loader reads the worktree copy. The spec was silent on it; the plan chose the hard error.
- Implementation kept the five implement literals in the matrix cells, not in a separate default map. The override map uses the same size keys. The spec allowed this.
- `PolicyConfig` effort overrides use the shared effort type rather than a string.
- Historical decisions were marked "Superseded by" rather than rewritten, as the spec's contract sweep requires. The 2026-09 and 2026-10 implement-effort and M/L-equivalence clauses now carry notes pointing to the new decision.
- Round 2 found two contract restatements the sweep had missed: the M/L implement-equivalence clause and the operator note on where to edit config. Both are fixed.

## Open Questions

- None for the human to decide before merge. The spec's judgment calls above are the items to confirm.
- Note for the human: `.canon/` status records one escalation from the code_review phase, where the cold-Codex lens could not be obtained during an earlier round. Later rounds obtained it, and Round 3 completed with all three lenses. The escalation entry is historical and has not been cleared in `status.json`.

## Follow-ups

| Category | Follow-up | Tracked |
|---|---|---|
| nit | Round 1 nit: a repo with no `codex` key and malformed JSON now gets the "codex section cannot be read" message instead of the docs-freshness message. Reword it as a whole-file JSON error. (`src/orchestrator/docs-freshness.ts` `unreadableCodex`, reached from `src/orchestrator/main.ts`.) | untracked |
| nit | Round 1 nit: an exported empty `CODEX_MODEL_MINI` or `CODEX_MODEL_FULL` beats the configured model and yields an empty `-m`. Config model strings are validated after trimming but stored untrimmed. (`src/orchestrator/policy.ts`, `src/orchestrator/docs-freshness.ts`.) | untracked |
| nit | Round 1 nit: the unknown-key hint for `codex` reuses the docs-freshness example text, and doctor says "codex section is valid" when the file has no `codex` key. (`src/orchestrator/policy.ts`, `src/cli/commands/doctor.ts`.) | untracked |
| nit | Round 1 nit: the env deprecation text reads "is no longer honored — ignored". (`src/orchestrator/env.ts`.) | untracked |
| nit | Round 1 nit: the doctor Codex check is tested by calling `checkCodexConfig` directly, so removing it from the doctor check list would not fail any test. (`tests/cli.test.ts`, `src/cli/commands/doctor.ts`.) | untracked |
| nit | Round 1 nit: the built-in model defaults `gpt-6-luna` and `gpt-6.2-sol` appear in both `policyConfig()` and `getCodexConfig()`. A future default bump could drift. (`src/orchestrator/policy.ts`.) | untracked |
| nit | Round 1 nit: the gate wording says `--ship` is the only exempt command, but the docs do not say that `--pr` and `--reroute` are blocked by an invalid `codex` section. | untracked |
| nit | Round 1 nit: `tests/agent-backend.test.ts` reads canon-ai's own main config instead of the injectable `root`. It passes today because canon-ai has no `codex` section. (`tests/agent-backend.test.ts`.) | untracked |
| nit | Round 2 nit: the README rewrite dropped the general sentence that malformed JSON stops runs, including reroute and ship. Plain `--ship` still dies on malformed main JSON. (`README.md`.) | untracked |
| nit | Round 2 nit: the `docs/patterns.md` worktree exception does not say that plain `--ship` skips the `codex` read. (`docs/patterns.md`.) | untracked |
| nit | Round 2 nit: the malformed-worktree assertion in the run-level fixture should also match negatively on "main checkout". (`tests/run-task-ship-docs-fold.test.ts`.) | untracked |
| nit | Round 2 nit: the mixed arm of the `--ship --dry-run` test cannot tell startup validation from dry-run plan resolution. Add a comment so a later dedupe does not drop the case. (`tests/run-task-codex-config.test.ts`.) | untracked |
| nit | Round 2 nit (pre-existing): an invalid effort in `runCodex` exits without writing a metric row, so the orchestrator doc's "rejected effort recorded before spawn" holds only for the cold lens. (`src/orchestrator/agents/codex.ts`.) | untracked |
| nit | Round 3 wording: the config-root rule now lives in two full places, `docs/architecture.md` and `docs/pipeline-orchestrator.md`. The "the exception" phrasing could be tightened. Left for a later docs pass. | untracked |
| observation | Write the CHANGELOG entry at release time. Cover the new defaults (a minor, Changed entry), the `codex` section, the Effort column heads-up with blank old cells, and the mixed-width table for fragments folded before `canon upgrade`. The spec's Non-Goals require this. | untracked |
| observation | Re-measure M and L `code_review` reroute rates on runs with the new defaults. The M/L defaults are a judgment call, not a measured result. | untracked |
| observation | Run the spec's seven Human Test Plan steps in a scratch repo before or after merge. They were not run in this QA pass. | untracked |

## Quality Log

- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Spec review's first verdict is inferred from `status.json` (`changes_requested_total: 1`, current verdict approved); the first-round artifact was overwritten. Code review took two changes-requested rounds, both implementation-side (a weakened run-level fixture and two stale contract restatements), and approved in Round 3.

## Root Cause

- execution: a run-level dry-run fixture was changed to expect the new malformed-main failure, which dropped its check that a worktree ignores main's docs-freshness and ship settings (code review Round 1, correctness bug 1; fixed in Round 2).
- execution: the contract sweep searched literal defaults and named decision entries, but missed a relational claim (M identical to L on implement) and an operator instruction on where to edit config (code review Round 2; fixed in Round 3).

Maintenance: lessons-learned.md plus this task's fragment have 17 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
