# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.
> Effort: the resolved effort passed to the agent (or a rejected value); `-` when no effort is passed, including Claude sub-agents. Older rows may have no Effort cell.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status | Effort |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-25T06:47:26.485Z | rest-forge-pr-calls | spec_review | codex | gpt-6-luna | 0 | 66.8s | 370873 | ok | high |
| 2026-11-25T06:53:01.503Z | rest-forge-pr-calls | plan | claude | opus | 0 | 335.0s | 3592642 | ok | medium |
