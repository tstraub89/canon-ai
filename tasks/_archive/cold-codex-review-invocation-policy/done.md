# Completion Summary: cold-codex-review-invocation-policy — Cold-Codex review lens gets canon-resolved effort and a telemetry row

> For the human. This is what you need to know.

## What Changed

The cold-Codex review lens — the mandatory third `code_review` reviewer, a GPT-family model reviewing the diff independently of Claude — used to spawn without any of canon's usual Codex safeguards. It inherited whatever reasoning-effort value sat in the operator's personal `~/.codex/config.toml`, and it wrote no telemetry row at all. An external adopter (GitHub issue #195) had a personal effort setting (`ultra`) that the Codex CLI itself rejects; because the cold lens is hard-fail by design, that single misconfigured personal setting killed `code_review` for every task on their machine, with no record of the failed attempt anywhere. This task brings the cold lens onto the same rails as every other Codex call: its reasoning effort is now resolved from canon's own policy table (`high`, at every task size, model unchanged) and passed explicitly on the command line — overriding the user's personal config for canon's own review, without ever touching that config file — and every attempt, successful or failed, now writes exactly one telemetry row to `docs/pipeline-invocations.md`. A new shared guard also rejects any resolved effort value the Codex CLI can't accept, before it ever spawns a process, for all three Codex call sites (fresh, resumed, and cold).

## Files Changed

- `scripts/pipeline-policy.ts` — added a `code_review` row to the Codex policy matrix: model stays mini, effort is `high` at every size (XS–XL).
- `scripts/run-task/agents/codex.ts` — cold review now takes an explicit effort and metrics context; added a shared pre-spawn effort-validation guard used by fresh, resumed, and cold Codex calls; added token-usage parsing and an exactly-once telemetry write for the cold lens.
- `scripts/run-task/phases/code-review.ts` — cold review's model/effort now comes from the same policy resolver as other Codex phases, and the phase supplies the telemetry context (task ID(s), round number).
- `tests/pipeline-policy.test.ts` — new coverage for all five `code_review` policy cells plus the delicate-size-promotion case.
- `tests/run-task-code-review.test.ts` — new exact-argv assertion for the cold lens, three "invalid effort never spawns" guards, and success/failure/no-usage telemetry tests.
- `tests/run-task-reroute-preflight.test.ts` — tightened to pin the complete argv for both fresh and resumed Codex invocations.
- `tests/run-task-safety.test.ts` — swapped placeholder invalid effort values for a valid one so pre-existing failure-ladder tests still reach their intended failure branch under the new guard.
- `docs/decisions.md` — updated the cold-lens decision entry to describe the policy-resolved model/effort.
- `docs/pipeline-orchestrator.md` (+ synced `templates/docs/pipeline-orchestrator.md`) — documented the new `code_review` matrix row and the invocation-scoped effort override.
- `dist/scripts/run-task.js` — rebuilt bundle reflecting the source changes.

## How to Test

1. Set your personal Codex reasoning effort to a value the Codex CLI itself rejects (the original reporter used `ultra`), then run any canon task through `code_review`. Expected: the cold review completes normally — canon's own setting wins for canon-run reviews — and your personal config file is unchanged afterward.
2. After a `code_review` run, open `docs/pipeline-invocations.md`. Expected: exactly one new row for the cold lens, showing model, duration, status, and token usage (when available), as its own row distinct from the Claude foreman's `code_review` row.
3. Make the Codex command unavailable (or otherwise force the cold review to fail) for one run. Expected: the run halts with a clear message, and the log still gains exactly one row for that attempt, marked failed.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (975 passed, 0 failed, 1 skipped) |
| E2E tests | N/A — no e2e suite in this project |
| Build | Pass (only `dist/scripts/run-task.js` changed) |
| `docs-refs-check` | Pass |
| `sync-templates:check` | Pass |

Code review: three-lens agreement (anchored Claude, cold Claude, cold Codex) — **approved with nits**, no correctness bugs, no spec gaps. The one risk nit (an invalid-effort guard failure on the *ordinary* `runCodex` path records zero telemetry rows, unlike the cold path) was verified real but unable to fire today, since every production caller already passes a matrix-resolved, valid effort — left as a documented, non-blocking asymmetry.

## Human Verification Required

None. All Validation Outcomes checks recorded `Pass`; no `human_pending` rows.

Worth knowing, not blocking: this task's own `code_review` ran against the globally-installed `canon-ai` npm package, not this dev build, so the actual cold-Codex telemetry row and effort override introduced here did not execute during this task's own pipeline run — `docs/pipeline-invocations.md`'s `code_review` row for this task is the Claude foreman only, no `agent=codex` row yet. That's expected (unreleased engine changes don't run in `canon run` until published), not a gap in this task. The spec's Human Test Plan describes exercising the fix live once released.

## Proposed Changelog

- **The cold-Codex `code_review` lens now runs through canon's own Codex invocation policy instead of inheriting the operator's personal reasoning-effort setting.** Previously, the mandatory third review lens spawned with no `-c model_reasoning_effort` override, so it silently inherited whatever value sat in the operator's `~/.codex/config.toml` — and because the Codex CLI only accepts `none|minimal|low|medium|high|xhigh`, a personal setting outside that set (reported as `ultra` in [#195](https://github.com/tstraub89/canon-ai/issues/195)) made every `code_review` hard-fail with no diagnostic trail, since the lens wrote no telemetry either. The cold lens now resolves its effort from the same policy matrix as other Codex calls (`high` at every task size; model is unchanged), passes it explicitly on the command line without touching the operator's config file, and writes exactly one telemetry row per attempt — successful or failed — to `docs/pipeline-invocations.md`, matching the existing per-invocation contract. A new shared guard also rejects any effort value the Codex CLI can't accept before spawning, across all Codex call sites, with a message naming the invalid value, the valid set, and that canon's per-invocation override always wins.

## Decisions Made

- Cold-lens effort is flat `high` at every task size (XS–XL) — a deliberate simplification since the human decision was "just raise it," not "keep a size curve."
- The invalid-effort guard is shared across all three Codex call sites (fresh, resumed, cold) rather than duplicated, so future CLI drift is caught in one place.
- `docs/decisions.md` was amended root-only, with no edit to `templates/docs/decisions.md` — that file is an intentionally generic adopter scaffold and is not in canon's managed-file set.
- `tests/run-task-safety.test.ts` was corrected (not in the spec's Affected Files) after the new guard exposed four placeholder effort values that the CLI would now reject before reaching the failure branches those tests exist to exercise — a documented, in-scope deviation restoring the tests' original intent under the new contract.

## Open Questions

None — code review closed clean (approved with nits, no blocking items) and all ACs are met.
