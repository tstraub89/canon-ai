# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-30T14:56:24.015Z | claude-provider-mode | spec_review | codex | gpt-6.1-sol | 0 | 225.1s | 1739674 | ok |
| 2026-10-30T14:57:19.386Z | claude-provider-mode | spec | claude | opus | 0 | 55.2s | 1046359 | ok |
| 2026-10-30T14:58:54.351Z | claude-provider-mode | spec_review | codex | gpt-6.1-sol | 1 | 94.7s | 3216459 | ok |
| 2026-10-30T17:33:33.842Z | claude-provider-mode | plan | claude | opus | 0 | 639.7s | 9921652 | ok |
