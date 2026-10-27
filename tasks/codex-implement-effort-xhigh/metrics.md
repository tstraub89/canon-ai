# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-27T19:21:39.384Z | codex-implement-effort-xhigh | spec_review | codex | gpt-6-luna | 0 | 26.7s | 323624 | ok |
| 2026-10-27T19:23:03.650Z | codex-implement-effort-xhigh | plan | claude | sonnet | 0 | 70.0s | 1070164 | ok |
