# Implementation Handoff: agent-failure-parks-phase

> Author: Codex | Spec: `tasks/agent-failure-parks-phase/spec.md` | Plan: `tasks/agent-failure-parks-phase/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/agents/errors.ts` | Added typed session failures and an instanceof guard. |
| `src/orchestrator/agents/claude.ts` | Non-interactive failure branches throw; metrics finally records failed sessions. |
| `src/orchestrator/agents/codex.ts` | Spawn, stall, and signal failures throw; non-zero exit-code return remains intact. |
| `src/orchestrator/phases/code-review.ts` | Unavailable cold-Codex review throws before the foreman. |
| `src/orchestrator/main.ts` | Added the typed-only park boundary around phase execution and recovery; crashed spec reviews now block the full bundle durably. |
| `tests/run-task-safety.test.ts` | Added failure, recovery, bundle, QA, metrics, error-discrimination, and worktree-routing coverage; updated crash assertions and fake plan completion. |
| `tests/run-task-code-review.test.ts` | Cold-Codex failure now expects AgentSessionError. |
| `docs/patterns.md` | Documented throw-and-park behavior and the constraint on agent calls after routing. |
| `docs/architecture.md` | Corrected autoBlockPhase ownership: callers exit. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented durable session parks and whole-bundle recovery; regenerated mirror. |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Auth recovery uses a plain rerun without a manual phase reset; regenerated mirror. |
| `dist/orchestrator/run-task.js` | Rebuilt runtime bundle. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Failed non-interactive sessions unwind through AgentSessionError, preserving metrics cleanup and preventing phase post-processing from treating partial output as success. The main-loop boundary catches only that type, blocks every bundle member, records escalations and a recovery command, and exits 2. Ordinary errors propagate unchanged. Returning non-zero Codex spec reviews retain their existing completion check and now write the same durable blocked state when incomplete.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Reused runReviewLoopMain's existing extraArgs for bundle IDs rather than creating another harness. | Existing argv support exercises the real same-phase check without duplicating the subprocess helper. | AC-13 unchanged. |
| Added plan -> implement to the existing fake-agent completer. | The fake previously marked plan done while leaving its top-level pointer stale; the recovery test exposed this fixture omission. Production derivation needed no change. | Makes AC-5 fixture representative. |
| Added a worktree-routing park regression. | Repo guidance requires this fixture shape for a new status-writing path. | Additional coverage; no scope expansion. |
| Rebuilt both entry points; only the orchestrator bundle changed. | The CLI bundle is byte-identical, so it is omitted from Changes. | AC-12 met. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Grep finds only the interactive Claude process.exit; Codex wrapper has none. Cold-review failure throws. |
| AC-2 | Met | Failure-ladder test catches AgentSessionError for Claude exit 1 and Codex spawn/stall/signal, reaches after-call, and preserves non-zero Codex return. Red-first evidence below. |
| AC-3 | Met | Full main plan fixture verifies exit 2, blocked, escalation with reason/recovery, auto_block_count, banner, and exit marker. |
| AC-4 | Met | Full main implement stall fixture verifies exit 2, blocked, and escalation. |
| AC-5 | Met | Same plan fixture replaces the failing agent, reruns without resetting state, and verifies plan done / implement current. |
| AC-6 | Met | Real runQaPhase rejects after QA-shaped partial output; done.md remains absent and qa stays in_progress. |
| AC-7 | Met | Injected unavailable cold review rejects with AgentSessionError for Codex; foreman never runs. Main catches that shared type. |
| AC-8 | Met | Existing crashed-spec-review test now checks blocked, one escalation, iteration count, recovery reason, and auto_block_count. Self-bookkept and clean-exit tests pass. |
| AC-9 | Met | Boundary test sends an ordinary Error to existing unhandled-rejection handling: exit 1, original reason, no escalation. Typed positive control parks. |
| AC-10 | Met | Claude failure test reads a failed plan metric from CANON_METRICS_FILE_OVERRIDE. |
| AC-11 | Met | All four root doc surfaces updated; both managed mirrors regenerated; sync and references pass. |
| AC-12 | Met | All six required checks pass; full suite: 1489 pass, zero failures, one skip. |
| AC-13 | Met | Signal and returning exit-1 fixtures complete A before B fails; both reopen blocked at spec_review with escalations, then both advance to plan on a plain bundle rerun. Both cases were red first. |

## Edge Cases Considered

- Full-bundle parks deliberately include completed members; artifacts, verdicts, and review counters remain intact. The spec's accepted extra review-round counter cost remains.
- All agent-capable phase runners set in_progress before their session. code_review's reviewer-block check occurs later in checkAndRoute, so crash-parked reviews re-enter the runner. Loop caps still apply. Plan and spec_review re-entry are exercised end to end; code_review follows the same ordering by trace.
- Recovery sessions execute inside the new boundary through checkAndRoute's per-member completion loop. Verdict routing and routeBackTo happen afterward and invoke no agents.
- The worktree regression verifies the supervising checkout's status bytes remain unchanged while the task worktree receives the park.
- Interactive exits, stale Claude resume fallback, shutdown handling, and normal non-zero Codex return behavior remain as specified.
- A blocked implement starts with the fresh prompt when no revision/reroute applies, as described in the plan's existing scope note; partial files remain on disk. No change to implement session-resumption policy was authorized.

## Blockers

- [ambiguity] Which failure kind represents an unavailable cold-Codex review when its result exposes only success? Following the plan, interpreted it as exit_code with exitCode null; retained the existing reason listing possible causes, without inventing an exit number or widening the result/type contracts. No incomplete ACs remain.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final run clean after removing five unnecessary test assertions. |
| `npm run type-check` | Pass | TypeScript completed cleanly. |
| `npm test` | Pass | 1490 tests: 1489 passed, zero failed, one skipped; about 119 seconds. Build completed before this run. |
| `npm run build` | Pass | Both entry points rebuilt; only orchestrator output changed. |
| `npm run sync-templates:check` | Pass | Managed mirrors aligned. |
| `npm run docs-refs-check` | Pass | All references valid. |
| Targeted failure/recovery tests | Pass | Ten selected tests passed, including QA and worktree routing. |
| `git diff --check` | Pass | No whitespace errors. |

### Red-first regression evidence

Before changing failure branches or main routing, added the error type and regression assertions, then ran:

```bash
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='agent failure ladders|main parks a failed plan|main parks a stalled|main reopens a partially|stops the whole bundle before foreman' tests/run-task-safety.test.ts tests/run-task-code-review.test.ts
```

All six selected tests failed for the expected reasons: the Claude wrapper exited 1 instead of allowing a caught error; plan and implement exited 1 instead of 2; the signaled bundle exited 1; the returning exit-1 bundle left A done instead of blocked; and the cold-review assertion received the stubbed process.exit error instead of AgentSessionError. After implementing the fix, these tests passed. The first green run additionally exposed the fake plan completer's stale top-level pointer; correcting that in-scope fixture made recovery pass. QA salvage prevention is a guard against returning partial output as success, rather than a claim that the original exit behavior salvaged it.

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
