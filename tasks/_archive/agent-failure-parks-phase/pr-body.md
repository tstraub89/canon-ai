# PR Body: agent-failure-parks-phase - Agent session failures park the phase blocked instead of killing the orchestrator

## Summary

- An agent session that fails during a phase (spawn error, stall, signal, or a non-zero Claude exit such as budget exhaustion or an expired login) no longer calls `process.exit()` inside the agent wrapper. The wrapper throws `AgentSessionError`, and the main loop catches it at one point.
- The main loop marks the phase `blocked` on every bundle member, writes an escalation with the reason and the `canon run <id>` recovery step, prints a stop banner, and exits `2`. Before, the detached orchestrator died with the phase left `in_progress`.
- Crashed Codex `spec_review` now writes the same blocked state and escalation. Cold-Codex `code_review` failures park too.
- Bundles park as a unit: a member that finished the phase before the failure is reopened, so the re-run redoes the phase for the whole bundle.
- Interactive sessions, non-agent errors and the Codex non-zero exit-code return path are unchanged. Failed Claude sessions now record a `failed` metrics row. Partial output from a failed session never reaches phase post-processing, so QA cannot salvage a `done.md` from it.

Fixes #17.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Results above come from the implement phase's run, recorded in `tasks/agent-failure-parks-phase/handoff.md`. The full suite reported 1489 passed, 0 failed, 1 skipped. The skipped test is not identified in the handoff.
- Six regression tests were written first and failed on the old behavior before the fix. They cover the Claude failure ladder, a plan park, a stalled implement, a signaled bundle, a returning bundle, and the cold-Codex failure.
- Bundle parks reopen completed members. A finished review member keeps the counters from its first verdict, so a `changes_requested` recorded before the crash counts twice toward the loop cap. This is accepted.
- A parked `implement` re-runs with a fresh prompt rather than resuming the stored Codex session, because the resume check only looks at `in_progress`. Treating `blocked` the same way is a possible follow-up.
- Still to do before merge: a manual run with a deliberately broken agent login, to confirm the stop banner and the re-run.
