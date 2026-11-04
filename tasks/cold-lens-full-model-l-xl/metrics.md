# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-04T04:01:34.119Z | cold-lens-full-model-l-xl | spec_review | codex | gpt-6.1-sol | 0 | 112.6s | 1541257 | ok |
| 2026-11-04T15:03:47.386Z | cold-lens-full-model-l-xl | plan | claude | opus | 0 | 201.2s | 2911021 | ok |
