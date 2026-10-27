# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-27T19:21:39.384Z | codex-implement-effort-xhigh | spec_review | codex | gpt-6-luna | 0 | 26.7s | 323624 | ok |
| 2026-10-27T19:23:03.650Z | codex-implement-effort-xhigh | plan | claude | sonnet | 0 | 70.0s | 1070164 | ok |
| 2026-10-27T19:30:44.622Z | codex-implement-effort-xhigh | implement | codex | gpt-6-luna | 0 | 460.2s | 7371591 | ok |
| 2026-10-27T19:31:39.343Z | codex-implement-effort-xhigh | code_review | codex | gpt-6-luna | 0 | 53.7s | - | ok |
| 2026-10-27T19:32:38.822Z | codex-implement-effort-xhigh | code_review | claude | sonnet | 0 | 59.4s | 610172 | ok |
| 2026-10-27T19:32:38.826Z | codex-implement-effort-xhigh | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 21.0s | 432854 | ok |
| 2026-10-27T19:32:38.829Z | codex-implement-effort-xhigh | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 26.5s | 476935 | ok |
| 2026-10-27T19:33:43.866Z | codex-implement-effort-xhigh | qa | claude | claude-haiku-5-5 | 0 | 65.0s | 817964 | ok |
