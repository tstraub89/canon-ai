# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.
> Effort: the resolved effort passed to the agent (or a rejected value); `-` when no effort is passed, including Claude sub-agents. Older rows may have no Effort cell.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status | Effort |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-20T02:54:18.082Z | canon-prune-skill | spec_review | codex | gpt-6-luna | 0 | 85.5s | 443330 | ok | high |
| 2026-11-20T03:09:43.021Z | canon-prune-skill | plan | claude | opus | 0 | 366.5s | 4173184 | ok | medium |
