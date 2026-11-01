# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-31T19:11:28.423Z | provider-pin-agent-free-paths | spec_review | claude | sonnet | 0 | 30.7s | 567061 | ok |
| 2026-11-01T01:54:12.266Z | provider-pin-agent-free-paths | plan | claude | sonnet | 0 | 65.9s | 963873 | ok |
| 2026-11-01T02:01:47.437Z | provider-pin-agent-free-paths | implement | claude | sonnet | 0 | 454.4s | 2716467 | ok |
| 2026-11-01T02:02:47.590Z | provider-pin-agent-free-paths | code_review | claude | sonnet | 0 | 59.1s | 383446 | ok |
| 2026-11-01T02:02:47.593Z | provider-pin-agent-free-paths | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 20.6s | 295674 | ok |
| 2026-11-01T02:02:47.595Z | provider-pin-agent-free-paths | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 22.4s | 584533 | ok |
| 2026-11-01T02:03:31.783Z | provider-pin-agent-free-paths | qa | claude | claude-haiku-5-5 | 0 | 44.2s | 770989 | ok |
