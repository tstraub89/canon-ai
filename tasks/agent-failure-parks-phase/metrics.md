# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-20T03:12:25.602Z | agent-failure-parks-phase | spec_review | codex | gpt-6.1-sol | 0 | 149.5s | 1290910 | ok |
| 2026-10-20T03:14:36.989Z | agent-failure-parks-phase | spec | claude | opus | 0 | 131.2s | 1724440 | ok |
| 2026-10-20T03:15:40.518Z | agent-failure-parks-phase | spec_review | codex | gpt-6.1-sol | 1 | 63.4s | 2230065 | ok |
| 2026-10-20T03:24:21.648Z | agent-failure-parks-phase | plan | claude | opus | 0 | 505.6s | 8646016 | ok |
| 2026-10-20T03:31:38.128Z | agent-failure-parks-phase | implement | codex | gpt-6.1-sol | 0 | 435.0s | 3384562 | ok |
| 2026-10-20T03:32:50.286Z | agent-failure-parks-phase | code_review | codex | gpt-6-luna | 0 | 70.8s | - | ok |
| 2026-10-20T03:43:20.054Z | agent-failure-parks-phase | code_review | claude | opus | 0 | 629.7s | 1206255 | ok |
| 2026-10-20T03:44:25.556Z | agent-failure-parks-phase | qa | claude | claude-haiku-5-5 | 0 | 65.5s | 619982 | ok |
