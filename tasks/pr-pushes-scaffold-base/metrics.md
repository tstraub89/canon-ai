# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-24T13:09:15.089Z | pr-pushes-scaffold-base | spec_review | codex | gpt-6.1-sol | 0 | 210.9s | 812341 | ok |
| 2026-10-24T13:10:46.396Z | pr-pushes-scaffold-base | spec | claude | opus | 0 | 91.2s | 682021 | ok |
| 2026-10-24T13:13:06.199Z | pr-pushes-scaffold-base | spec_review | codex | gpt-6.1-sol | 1 | 139.7s | 1633827 | ok |
| 2026-10-24T14:17:15.129Z | pr-pushes-scaffold-base | plan | claude | opus | 0 | 389.9s | 3072362 | ok |
