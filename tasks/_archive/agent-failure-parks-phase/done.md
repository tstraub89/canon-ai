# Completion Summary: agent-failure-parks-phase — Agent session failures park the phase blocked instead of killing the orchestrator

> For the human. This is what you need to know.

## What Changed

When an agent session fails during a pipeline run (the agent fails to start, stalls, is killed by a signal, or Claude exits non-zero, for example on budget exhaustion or an expired login), the run used to die on the spot. That left the phase stuck `in_progress`, with no escalation and no stop message. Now the failure is raised as a typed error that the main loop catches at one point. The loop marks the phase `blocked` on every task in the bundle, records an escalation with the reason and the recovery command, prints a stop banner, and exits `2`. Fix the cause and run `canon run <id>` again: the phase re-runs with no manual reset. Interactive sessions still exit immediately, as before. Non-agent errors still propagate unchanged. A crashed Codex `spec_review` now writes the same blocked state and escalation, and a bundle that fails partway through a phase is parked as a whole, so the re-run can start the phase for every member together.

## Files Changed

- `src/orchestrator/agents/errors.ts` — new `AgentSessionError` type and an `isAgentSessionError` guard.
- `src/orchestrator/agents/claude.ts` — non-interactive failure branches throw instead of exiting; the metrics `finally` now records failed sessions.
- `src/orchestrator/agents/codex.ts` — spawn, stall and signal failures throw; the non-zero exit-code return path is unchanged.
- `src/orchestrator/phases/code-review.ts` — an unavailable cold-Codex review throws before the foreman runs.
- `src/orchestrator/main.ts` — the park boundary around phase execution and recovery; crashed `spec_review` parks the full bundle.
- `tests/run-task-safety.test.ts` — failure, park, recovery, bundle, QA-salvage, metrics and worktree-routing tests; updated crash assertions.
- `tests/run-task-code-review.test.ts` — cold-Codex failure expects `AgentSessionError`.
- `docs/patterns.md`, `docs/architecture.md`, `docs/pipeline-orchestrator.md`, `.claude/skills/canon-pipeline/recovery.md` — describe the park and recovery behavior.
- `templates/docs/pipeline-orchestrator.md`, `templates/.claude/skills/canon-pipeline/recovery.md` — regenerated mirrors.
- `dist/orchestrator/run-task.js` — rebuilt bundle.

## How to Test

1. On a scratch full-tier task, start a detached run, then break the planning agent (for example, sign it out of its login).
2. Expected: the run stops with a banner naming the phase, the agent, the reason and the command to resume. The task shows `blocked`, not `in_progress`, and `canon watch` reports a blocked stop rather than a crash.
3. Restore the agent's login and run `canon run <id>` again.
4. Expected: the same phase re-runs and the run carries on, with no status edits.
5. Optional: stall a Codex `implement` run (a very low stall timeout) and confirm the same blocked-and-resume behavior.

## Test Results

Recorded in `tasks/agent-failure-parks-phase/handoff.md` (Validation Outcomes). QA did not re-run these checks.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 1489 passed, 0 failed, 1 skipped (the handoff does not identify the skipped test) |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| Red-first regressions (6 targeted tests) | Failed before the fix for the expected reasons, then passed (see handoff) |

## Human Verification Required

None.

The spec's Human Test Plan (the signed-out agent scenario in How to Test above) is not a validation check and was not run. Run it before merge if you want end-to-end confirmation.

## Proposed Changelog

- **An agent session failure now stops the run at a blocked phase instead of killing the orchestrator.** If Claude or Codex fails mid-phase (it won't start, stalls, is killed, or Claude exits with an error such as an exhausted budget or an expired login), `canon run` marks the phase blocked, records the reason in the task's escalations, prints the command to resume, and exits 2. Fix the cause and run `canon run <id>` again; the phase re-runs with no manual reset. In a bundle, every member is parked, and the re-run redoes the phase for the whole bundle. A run that is left running in the background no longer disappears with its phase stuck in progress.

## Decisions Made

- **Bundle parks reopen completed members.** When a bundle fails partway through a phase, members that already finished it are also set back to blocked, so the re-run can resume the bundle together. This is safe because no agent session runs after the routing writes. The cost is that a finished member redoes the phase, and a review member's earlier verdict still counts toward the loop cap. This is an accepted quirk (see spec Known Risks).
- **Cold-Codex unavailable is kind `exit_code` with no code.** The cold-review result exposes only success, so the spec's kind union was not widened.
- **Recovery hint depends on the agent.** Claude gets "raise `CLAUDE_BUDGET`"; Codex gets "credits or quota".
- **Crashed `spec_review` names the full bundle** in its warning and escalation (`canon run A B`).
- **Scope held:** no automatic retry, no new flags, env vars or exit codes; interactive exits and the Codex non-zero exit-code return path are unchanged.

## Open Questions

- A parked `implement` re-runs with a fresh prompt instead of resuming the stored Codex session. `implement.ts` (`wasImplementInProgress`) checks only for `in_progress`, and the spec did not list that file. Treating `blocked` like `in_progress` there is a possible follow-up task.
- Which test is the one skipped in the 1490-test run? The handoff does not say. If it is a `gitDirWritable`-gated worktree test, it is unverified rather than passing.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: spec_review changed_requested once (bundle-atomicity revision B1) before approving; code_review approved_with_nits (N3: neighbouring docs slightly imprecise).
