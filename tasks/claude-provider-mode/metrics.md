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
| 2026-10-30T17:54:57.273Z | claude-provider-mode | implement | codex | gpt-6.1-sol | 0 | 1282.6s | 13268844 | ok |
| 2026-10-30T17:56:13.961Z | claude-provider-mode | code_review | codex | gpt-6-luna | 0 | 75.0s | - | ok |
| 2026-10-30T18:17:14.481Z | claude-provider-mode | code_review | claude | opus | 0 | 1260.5s | 2374921 | ok |
| 2026-10-30T18:17:14.490Z | claude-provider-mode | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 423.7s | 9435472 | ok |
| 2026-10-30T18:17:14.500Z | claude-provider-mode | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 1043.3s | 12709074 | ok |
| 2026-10-30T18:27:02.655Z | claude-provider-mode | implement | codex | gpt-6.1-sol | 1 | 588.1s | 20644545 | ok |
| 2026-10-30T18:28:51.014Z | claude-provider-mode | code_review | codex | gpt-6-luna | 1 | 106.8s | - | ok |
| 2026-10-30T18:39:06.028Z | claude-provider-mode | code_review | claude | opus | 1 | 615.0s | 1364112 | ok |
| 2026-10-30T18:39:06.035Z | claude-provider-mode | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 317.3s | 4876441 | ok |
| 2026-10-30T18:39:06.039Z | claude-provider-mode | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 519.8s | 4276267 | ok |
| 2026-10-30T18:40:50.454Z | claude-provider-mode | qa | claude | claude-haiku-5-5 | 0 | 104.4s | 1195526 | ok |
| 2026-10-30T19:01:25.467Z | claude-provider-mode | spec_review | codex | gpt-6.1-sol | 0 | 98.3s | 985108 | ok |
| 2026-10-30T19:05:15.057Z | claude-provider-mode | plan | claude | opus | 0 | 229.6s | 2897762 | ok |
| 2026-10-30T19:19:09.788Z | claude-provider-mode | implement | codex | gpt-6.1-sol | 0 | 834.6s | 28770702 | ok |
