# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-25T18:30:41.487Z | shared-tasks-root | spec_review | codex | gpt-6-luna | 0 | 70.8s | 808231 | ok |
| 2026-10-25T18:31:51.693Z | shared-tasks-root | spec | claude | opus | 0 | 70.1s | 634102 | ok |
| 2026-10-25T18:32:31.777Z | shared-tasks-root | spec_review | codex | gpt-6-luna | 1 | 40.0s | 1389839 | ok |
| 2026-10-25T20:38:44.546Z | shared-tasks-root | plan | claude | opus | 0 | 345.0s | 3688821 | ok |
| 2026-10-25T20:53:06.838Z | shared-tasks-root | implement | codex | gpt-6-luna | 0 | 861.6s | 10265165 | ok |
| 2026-10-25T21:14:51.216Z | shared-tasks-root | spec_review | codex | gpt-6-luna | 0 | 44.4s | 398749 | ok |
| 2026-10-25T21:16:18.370Z | shared-tasks-root | spec_review | codex | gpt-6-luna | 1 | 58.3s | 964902 | ok |
| 2026-10-25T21:17:22.275Z | shared-tasks-root | spec_review | codex | gpt-6-luna | 2 | 37.9s | 1338961 | ok |
| 2026-10-25T21:22:45.806Z | shared-tasks-root | spec_review | codex | gpt-6-luna | 3 | 68.1s | 2277011 | ok |
| 2026-10-25T21:25:45.603Z | shared-tasks-root | plan | claude | opus | 0 | 179.8s | 2516386 | ok |
| 2026-10-25T21:36:05.941Z | shared-tasks-root | implement | codex | gpt-6-luna | 0 | 620.3s | 19625661 | ok |
