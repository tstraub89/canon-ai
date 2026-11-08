# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-08T04:35:45.010Z | implementer-blast-radius-map | spec_review | codex | gpt-6-luna | 0 | 56.5s | 270614 | ok |
| 2026-11-08T04:39:29.955Z | implementer-blast-radius-map | plan | claude | opus | 0 | 224.8s | 1611540 | ok |
