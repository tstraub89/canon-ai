# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-09T03:11:28.813Z | post-ship-cleanup | implement | codex | gpt-6-luna | 0 | 914.3s | 9194301 | ok |
| 2026-11-09T03:12:39.426Z | post-ship-cleanup | code_review | codex | gpt-6-luna | 0 | 69.6s | - | ok |
| 2026-11-09T03:13:39.961Z | post-ship-cleanup | code_review | claude | sonnet | 0 | 60.5s | 442547 | ok |
| 2026-11-09T03:13:39.966Z | post-ship-cleanup | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 25.3s | 405660 | ok |
| 2026-11-09T03:13:39.968Z | post-ship-cleanup | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 23.8s | 294196 | ok |
| 2026-11-09T03:15:15.929Z | post-ship-cleanup | qa | claude | claude-haiku-5-5 | 0 | 95.9s | 1078150 | ok |
