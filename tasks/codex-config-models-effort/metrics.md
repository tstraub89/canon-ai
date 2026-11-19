# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-19T05:34:53.158Z | codex-config-models-effort | spec_review | codex | gpt-6.1-sol | 0 | 155.1s | 1589328 | ok |
| 2026-11-19T05:35:34.179Z | codex-config-models-effort | spec | claude | opus | 0 | 40.8s | 829002 | ok |
| 2026-11-19T05:36:39.466Z | codex-config-models-effort | spec_review | codex | gpt-6.1-sol | 1 | 65.2s | 2634051 | ok |
| 2026-11-19T06:08:08.216Z | codex-config-models-effort | plan | claude | opus | 0 | 882.0s | 9553077 | ok |
