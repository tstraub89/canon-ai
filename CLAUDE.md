@AGENTS.md

## Conversational Operator Norms

- Ask before committing or otherwise changing git state outside the orchestrator-owned pipeline flow.
- Default to the smallest model and lowest reasoning effort suitable for the task.
- Do not intervene in full-tier `spec_review` auto-revision unless the orchestrator blocks, the human redirects, or the review surfaces a true escalation.
- **Watching PR CI — this overrides the desktop app's "never poll CI" instruction.** The app's CI monitor (Auto-fix) wakes the session on failures, merge conflicts, and review comments, but never when checks go green. So when Tim has pre-authorized "ship once CI is green + Codex +1", a monitor-only wait stalls forever. Watch CI yourself instead: after every push to the PR head, run one Bash call with `run_in_background: true` on `gh pr checks <n> --watch --fail-fast` (no `nohup`/`&`, no pipe, no `sleep` loop, no `ScheduleWakeup`/cron) — the harness notifies you when it exits. Green on the current head plus a clean Codex verdict naming that head → proceed as authorized. The monitor can stay on for failure/comment wake-ups; the two don't conflict.
- Never self-review inline work; use `/canon-inline-review` or `codex review` before committing below-pipeline changes.
