# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-28T23:42:01.424Z | agent-backend-role-routing | spec_review | codex | gpt-6.1-sol | 0 | 156.8s | 1524293 | ok |
| 2026-10-28T23:59:24.095Z | agent-backend-role-routing | plan | claude | opus | 0 | 484.6s | 5981694 | ok |
| 2026-10-29T00:16:16.946Z | agent-backend-role-routing | implement | codex | gpt-6.1-sol | 0 | 1011.7s | 9702755 | ok |
| 2026-10-29T00:17:51.809Z | agent-backend-role-routing | code_review | codex | gpt-6-luna | 0 | 62.2s | - | ok |
| 2026-10-29T00:25:21.635Z | agent-backend-role-routing | code_review | claude | opus | 0 | 449.8s | 963903 | ok |
| 2026-10-29T00:25:21.644Z | agent-backend-role-routing | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 304.5s | 5678766 | ok |
| 2026-10-29T00:25:21.649Z | agent-backend-role-routing | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 323.8s | 4134783 | ok |
| 2026-10-29T00:31:47.629Z | agent-backend-role-routing | implement | codex | gpt-6.1-sol | 1 | 385.9s | 13904266 | ok |
| 2026-10-29T00:33:10.800Z | agent-backend-role-routing | code_review | codex | gpt-6-luna | 1 | 81.7s | - | ok |
| 2026-10-29T00:39:26.621Z | agent-backend-role-routing | code_review | claude | opus | 1 | 375.8s | 1234464 | ok |
| 2026-10-29T00:39:26.627Z | agent-backend-role-routing | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 103.0s | 1461549 | ok |
| 2026-10-29T00:39:26.633Z | agent-backend-role-routing | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 285.4s | 6140351 | ok |
| 2026-10-29T00:40:31.219Z | agent-backend-role-routing | qa | claude | claude-haiku-5-5 | 0 | 64.6s | 1320812 | ok |
