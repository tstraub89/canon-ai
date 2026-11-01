# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-01T03:45:39.588Z | spec-manifest-lint | spec_review | codex | gpt-6.1-sol | 0 | 163.3s | 1280176 | ok |
| 2026-11-01T03:47:16.569Z | spec-manifest-lint | spec | claude | opus | 0 | 96.6s | 1168317 | ok |
| 2026-11-01T03:48:25.213Z | spec-manifest-lint | spec_review | codex | gpt-6.1-sol | 1 | 68.1s | 2081155 | ok |
| 2026-11-01T03:57:55.177Z | spec-manifest-lint | plan | claude | opus | 0 | 481.2s | 7293340 | ok |
| 2026-11-01T04:20:35.236Z | spec-manifest-lint | implement | codex | gpt-6.1-sol | 0 | 1359.1s | 5684974 | ok |
| 2026-11-01T04:21:40.560Z | spec-manifest-lint | code_review | codex | gpt-6-luna | 0 | 63.9s | - | ok |
| 2026-11-01T04:35:36.232Z | spec-manifest-lint | code_review | claude | opus | 0 | 835.6s | 1855586 | ok |
| 2026-11-01T04:35:36.241Z | spec-manifest-lint | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 445.6s | 6793008 | ok |
| 2026-11-01T04:35:36.248Z | spec-manifest-lint | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 635.8s | 6512179 | ok |
| 2026-11-01T04:44:32.925Z | spec-manifest-lint | implement | codex | gpt-6.1-sol | 1 | 536.6s | 10121561 | ok |
| 2026-11-01T04:45:46.634Z | spec-manifest-lint | code_review | codex | gpt-6-luna | 1 | 72.0s | - | ok |
| 2026-11-01T04:55:27.510Z | spec-manifest-lint | code_review | claude | opus | 1 | 580.8s | 1341358 | ok |
| 2026-11-01T04:55:27.515Z | spec-manifest-lint | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 345.3s | 4757863 | ok |
| 2026-11-01T04:55:27.520Z | spec-manifest-lint | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 457.4s | 2585140 | ok |
| 2026-11-01T05:02:53.683Z | spec-manifest-lint | implement | codex | gpt-6.1-sol | 2 | 446.1s | 14651941 | ok |
| 2026-11-01T05:03:59.140Z | spec-manifest-lint | code_review | codex | gpt-6-luna | 2 | 63.9s | - | ok |
| 2026-11-01T05:12:50.473Z | spec-manifest-lint | code_review | claude | opus | 2 | 531.3s | 1438050 | ok |
| 2026-11-01T05:12:50.477Z | spec-manifest-lint | code_review | claude:code-review-anchored | claude-opus-5-5 | 2 | 396.8s | 1361256 | ok |
| 2026-11-01T05:12:50.481Z | spec-manifest-lint | code_review | claude:code-review-cold | claude-opus-5-5 | 2 | 430.4s | 4745256 | ok |
| 2026-11-01T05:14:04.495Z | spec-manifest-lint | qa | claude | claude-haiku-5-5 | 0 | 74.0s | 902008 | ok |
| 2026-11-01T05:39:59.204Z | spec-manifest-lint | spec_review | codex | gpt-6.1-sol | 0 | 137.3s | 683180 | ok |
| 2026-11-01T05:41:12.497Z | spec-manifest-lint | spec_review | codex | gpt-6.1-sol | 1 | 49.1s | 1179237 | ok |
| 2026-11-01T05:51:23.155Z | spec-manifest-lint | plan | claude | opus | 0 | 610.7s | 1030625 | ok |
| 2026-11-01T06:07:16.157Z | spec-manifest-lint | implement | codex | gpt-6.1-sol | 0 | 952.9s | 22681347 | ok |
| 2026-11-01T06:16:10.086Z | spec-manifest-lint | implement | codex | gpt-6.1-sol | 0 | 370.9s | 28436760 | ok |
