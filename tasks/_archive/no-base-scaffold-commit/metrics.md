# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-24T04:54:28.857Z | no-base-scaffold-commit | spec_review | codex | gpt-6.1-sol | 0 | 120.4s | 1152294 | ok |
| 2026-10-24T05:11:08.293Z | no-base-scaffold-commit | plan | claude | opus | 0 | 560.0s | 9391486 | ok |
