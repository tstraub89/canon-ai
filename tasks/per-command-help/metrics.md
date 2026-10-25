# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-24T14:52:21.527Z | per-command-help | spec_review | codex | gpt-6-luna | 0 | 54.3s | 490069 | ok |
| 2026-10-24T16:50:13.920Z | per-command-help | plan | claude | opus | 0 | 379.9s | 3862086 | ok |
| 2026-10-24T17:10:03.305Z | per-command-help | implement | codex | gpt-6-luna | 0 | 1188.8s | 22274930 | ok |
| 2026-10-24T17:11:07.387Z | per-command-help | code_review | codex | gpt-6-luna | 0 | 63.2s | - | ok |
| 2026-10-24T17:15:53.083Z | per-command-help | code_review | claude | opus | 0 | 285.7s | 896241 | ok |
| 2026-10-24T17:15:53.086Z | per-command-help | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 110.3s | 735656 | ok |
| 2026-10-24T17:15:53.089Z | per-command-help | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 203.1s | 2145955 | ok |
| 2026-10-24T17:21:22.447Z | per-command-help | implement | codex | gpt-6-luna | 1 | 329.3s | 26129608 | ok |
| 2026-10-24T17:22:07.379Z | per-command-help | code_review | codex | gpt-6-luna | 1 | 43.9s | - | ok |
| 2026-10-24T17:25:12.090Z | per-command-help | code_review | claude | opus | 1 | 184.7s | 785811 | ok |
| 2026-10-24T17:25:12.092Z | per-command-help | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 79.4s | 636536 | ok |
| 2026-10-24T17:25:12.093Z | per-command-help | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 123.4s | 1176339 | ok |
| 2026-10-24T17:26:45.186Z | per-command-help | implement | codex | gpt-6-luna | 2 | 93.1s | 28009858 | ok |
| 2026-10-24T17:27:07.298Z | per-command-help | code_review | codex | gpt-6-luna | 2 | 21.2s | - | ok |
| 2026-10-24T17:31:26.993Z | per-command-help | code_review | claude | opus | 2 | 259.7s | 586274 | ok |
| 2026-10-24T17:31:26.997Z | per-command-help | code_review | claude:code-review-cold | claude-opus-5-5 | 2 | 38.5s | 384915 | ok |
| 2026-10-24T17:31:27.000Z | per-command-help | code_review | claude:code-review-anchored | claude-opus-5-5 | 2 | 222.0s | 454253 | ok |
| 2026-10-24T17:32:36.567Z | per-command-help | qa | claude | claude-haiku-5-5 | 0 | 69.5s | 632734 | ok |
