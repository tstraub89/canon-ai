# Implementation Handoff: review-verdict-freshness-guard

> Author: Codex | Spec: `tasks/review-verdict-freshness-guard/spec.md` | Plan: `tasks/review-verdict-freshness-guard/plan.md`

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/main.ts` | Added the scoped crash predicate, test-only exit-status seam, and fail-closed park before evidence recovery or retry. |
| `tests/run-task-safety.test.ts` | Added subprocess-isolated regressions for stale-verdict parking, actionable output, done/clean-exit paths, counters, and phase scoping. |
| `docs/pipeline-orchestrator.md` | Documented recovery behavior, fail-closed rationale, operator re-run flow, and the benign-sub-case tradeoff. |
| `templates/docs/pipeline-orchestrator.md` | Regenerated the canon-managed mirror of the orchestrator documentation. |
| `docs/patterns.md` | Added the non-zero-agent-exit recovery pitfall and required guard placement. |
| `docs/BACKLOG.md` | Cross-referenced the agent-wrapper exit work and recorded deferred structural verdict freshness. |
| `dist/scripts/run-task.js` | Regenerated the published orchestrator bundle from the source change. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The recovery loop now treats an incomplete, non-zero-exit Codex `spec_review` as untrusted. It parks before `recoverPhaseForTask()` can read the cumulative artifact or retry the agent, preserving the phase and all durable counters. Completed reviews and every clean-exit recovery path retain their existing behavior.

The condition is a small pure predicate, while the behavioral tests execute `checkAndRoute()` in isolated child processes. This exercises the real exit-2 boundary and filesystem state without leaking the module-level exit status between tests.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Kept the regressions in spec-listed `tests/run-task-safety.test.ts` instead of the plan's proposed `tests/run-task-validation.test.ts`. | The safety suite already provides subprocess isolation for `checkAndRoute()`. Setting `lastCodexExitStatus` inside each child avoids shared module-state leakage and stays within the spec's exact Affected Files cap. | None; AC-1 through AC-5 are covered through the production routing function. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: park and protect counters | Met | Crash fixture exits `2`; status remains `in_progress`, verdict empty, and all three counters unchanged. Removing the park made the regression red (`0 !== 2`) through stale-artifact advancement. |
| AC-2: actionable park message | Met | Test asserts exit status, incomplete/no-verdict language, all named recoverable causes, re-run command, no retry, and no misleading completion note. |
| AC-3: done phase with non-zero exit | Met | Self-bookkept `approved_with_nits` fixture proceeds normally and retains the existing completion warning. |
| AC-4: clean-exit evidence recovery | Met | Fresh `changes_requested` verdict auto-advances, is named in the recovery output, increments all counters exactly once, then follows the existing route back to `spec`. |
| AC-5: `spec_review`-only scope | Met | Predicate table covers `spec_review`, `code_review`, `plan`, `implement`, and `qa`; a clean `code_review` recovery integration remains unchanged. |
| AC-6: recovery docs | Met | Orchestrator docs cover park/re-run behavior, rationale, clean/done exceptions, and the benign noisy-exit tradeoff. |
| AC-7: patterns pitfall | Met | Added a Known Pitfall requiring parking before recovery on the affected exit path. |
| AC-8: backlog follow-up | Met | Bug 2 now shares the agent-failure theme; deferred parser tightening and per-invocation freshness are recorded separately. |
| AC-9: build determinism | Met | Fresh and repeated builds produced the same `dist/scripts/run-task.js` SHA-256; `dist/cli/index.js` remained unchanged. The changed bundle is declared above for orchestrator-owned commit. |

## Edge Cases Considered

- A stale checked verdict cannot be read because the park precedes both evidence recovery and retry.
- A self-bookkept `done` phase bypasses the not-`done` branch even with a trailing non-zero exit.
- A clean-exit skipped-bookkeeping review still advances and retains current counter/routing semantics.
- `code_review`, `plan`, `implement`, and `qa` cannot satisfy the park predicate.
- The rare genuine-verdict plus noisy-exit plus skipped-bookkeeping case intentionally parks for manual re-run.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed cleanly. |
| `npm run type-check` | Pass | TypeScript strict no-emit check completed cleanly. |
| `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added" | Pass | 980 tests: 979 passed, 1 expected environment skip, 0 failed. |
| `npm run build` — required: `scripts/run-task/main.ts` edits rebuild `dist/scripts/run-task.js`; CI runs `npm run build && git diff --exit-code -- dist/` | Pass | Build succeeded; repeat build was byte-stable (`e974b66bca14233a2eeffe0450ba6de13522c7a6d79e4a857186236d37a1669c`); only the declared orchestrator bundle changed. |
| `npm run docs-refs-check` — docs edits (`docs/pipeline-orchestrator.md`, `docs/patterns.md`, `docs/BACKLOG.md`) and their references | Pass | All references valid. |
| `npm run sync-templates:check` | Pass | Root and generated managed docs are synchronized. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
