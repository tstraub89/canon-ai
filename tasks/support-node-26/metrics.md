# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-08T15:12:30.688Z | support-node-26 | spec_review | codex | gpt-6-luna | 0 | 72.7s | 454394 | ok |
| 2026-11-09T02:07:25.992Z | support-node-26 | plan | claude | sonnet | 0 | 59.5s | 664967 | ok |
| 2026-11-09T02:19:50.603Z | support-node-26 | implement | codex | gpt-6-luna | 0 | 743.8s | 4924511 | ok |
| 2026-11-09T02:20:25.700Z | support-node-26 | code_review | codex | gpt-6-luna | 0 | 33.7s | - | ok |
| 2026-11-09T02:21:40.365Z | support-node-26 | code_review | claude | sonnet | 0 | 74.6s | 435914 | ok |
| 2026-11-09T02:21:40.368Z | support-node-26 | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 22.6s | 234166 | ok |
| 2026-11-09T02:21:40.370Z | support-node-26 | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 34.3s | 438985 | ok |
| 2026-11-09T02:22:44.691Z | support-node-26 | qa | claude | claude-haiku-5-5 | 0 | 64.3s | 646053 | ok |
