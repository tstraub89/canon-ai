# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-08T14:49:51.394Z | path-scoped-pitfalls | spec_review | codex | gpt-6-luna | 0 | 88.6s | 574175 | ok |
| 2026-11-08T14:53:03.298Z | path-scoped-pitfalls | plan | claude | opus | 0 | 191.8s | 1627763 | ok |
| 2026-11-08T15:38:15.767Z | path-scoped-pitfalls | implement | codex | gpt-6-luna | 0 | 2711.7s | 13380047 | ok |
| 2026-11-08T15:40:03.669Z | path-scoped-pitfalls | code_review | codex | gpt-6-luna | 0 | 106.7s | - | ok |
| 2026-11-08T15:44:43.502Z | path-scoped-pitfalls | code_review | claude | opus | 0 | 279.8s | 595249 | ok |
| 2026-11-08T15:44:43.507Z | path-scoped-pitfalls | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 120.1s | 596322 | ok |
| 2026-11-08T15:44:43.513Z | path-scoped-pitfalls | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 179.6s | 1467718 | ok |
| 2026-11-08T16:02:57.221Z | path-scoped-pitfalls | implement | codex | gpt-6-luna | 1 | 1093.7s | 21290891 | ok |
| 2026-11-08T16:04:44.430Z | path-scoped-pitfalls | code_review | codex | gpt-6-luna | 1 | 106.1s | - | ok |
| 2026-11-08T16:08:45.685Z | path-scoped-pitfalls | code_review | claude | opus | 1 | 241.3s | 865473 | ok |
| 2026-11-08T16:08:45.690Z | path-scoped-pitfalls | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 92.8s | 607158 | ok |
| 2026-11-08T16:08:45.694Z | path-scoped-pitfalls | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 173.5s | 2100754 | ok |
| 2026-11-08T16:28:08.196Z | path-scoped-pitfalls | implement | codex | gpt-6-luna | 2 | 1162.5s | 27991344 | ok |
| 2026-11-08T16:29:31.239Z | path-scoped-pitfalls | code_review | codex | gpt-6-luna | 2 | 82.0s | - | ok |
| 2026-11-08T16:33:35.851Z | path-scoped-pitfalls | code_review | claude | opus | 2 | 244.6s | 1100534 | ok |
| 2026-11-08T16:33:35.857Z | path-scoped-pitfalls | code_review | claude:code-review-cold | claude-opus-5-5 | 2 | 99.1s | 527564 | ok |
| 2026-11-08T16:33:35.861Z | path-scoped-pitfalls | code_review | claude:code-review-anchored | claude-opus-5-5 | 2 | 157.3s | 1341873 | ok |
| 2026-11-08T16:36:09.971Z | path-scoped-pitfalls | spec_review | codex | gpt-6-luna | 0 | 79.7s | 267448 | ok |
| 2026-11-08T16:38:39.632Z | path-scoped-pitfalls | plan | claude | opus | 0 | 149.7s | 1358844 | ok |
| 2026-11-08T16:59:41.576Z | path-scoped-pitfalls | implement | codex | gpt-6-luna | 0 | 1261.9s | 37063737 | ok |
| 2026-11-08T17:01:48.793Z | path-scoped-pitfalls | code_review | codex | gpt-6-luna | 0 | 126.1s | - | ok |
| 2026-11-08T17:08:33.655Z | path-scoped-pitfalls | code_review | claude | opus | 0 | 404.8s | 1289051 | ok |
| 2026-11-08T17:08:33.660Z | path-scoped-pitfalls | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 203.1s | 1281328 | ok |
| 2026-11-08T17:08:33.663Z | path-scoped-pitfalls | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 260.8s | 3016384 | ok |
| 2026-11-08T17:09:53.112Z | path-scoped-pitfalls | qa | claude | claude-haiku-5-5 | 0 | 79.4s | 1254136 | ok |
