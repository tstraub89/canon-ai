# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-08T14:13:54.841Z | handoff-self-check-evidence | spec_review | codex | gpt-6.1-sol | 0 | 147.4s | 1190381 | ok |
| 2026-11-08T14:15:50.909Z | handoff-self-check-evidence | spec | claude | opus | 0 | 115.9s | 822057 | ok |
| 2026-11-08T14:16:50.240Z | handoff-self-check-evidence | spec_review | codex | gpt-6.1-sol | 1 | 59.3s | 1862309 | ok |
| 2026-11-08T14:23:05.731Z | handoff-self-check-evidence | plan | claude | opus | 0 | 375.4s | 5389821 | ok |
