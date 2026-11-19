# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-19T05:34:53.158Z | codex-config-models-effort | spec_review | codex | gpt-6.1-sol | 0 | 155.1s | 1589328 | ok |
| 2026-11-19T05:35:34.179Z | codex-config-models-effort | spec | claude | opus | 0 | 40.8s | 829002 | ok |
| 2026-11-19T05:36:39.466Z | codex-config-models-effort | spec_review | codex | gpt-6.1-sol | 1 | 65.2s | 2634051 | ok |
| 2026-11-19T06:08:08.216Z | codex-config-models-effort | plan | claude | opus | 0 | 882.0s | 9553077 | ok |
| 2026-11-19T06:23:46.981Z | codex-config-models-effort | implement | codex | gpt-6.1-sol | 0 | 935.2s | 7786833 | ok |
| 2026-11-19T06:26:30.278Z | codex-config-models-effort | code_review | codex | gpt-6.1-sol | 0 | 161.3s | - | ok |
| 2026-11-19T06:40:50.983Z | codex-config-models-effort | code_review | claude | opus | 0 | 860.6s | 2522533 | ok |
| 2026-11-19T06:40:51.047Z | codex-config-models-effort | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 249.6s | 5592359 | ok |
| 2026-11-19T06:40:51.090Z | codex-config-models-effort | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 572.5s | 6422653 | ok |
| 2026-11-19T06:48:47.319Z | codex-config-models-effort | implement | codex | gpt-6.1-sol | 1 | 474.4s | 13952633 | ok |
| 2026-11-19T06:52:20.855Z | codex-config-models-effort | code_review | codex | gpt-6.1-sol | 1 | 208.9s | - | ok |
| 2026-11-19T07:03:03.850Z | codex-config-models-effort | code_review | claude | opus | 1 | 642.7s | 1847539 | ok |
| 2026-11-19T07:03:03.860Z | codex-config-models-effort | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 350.3s | 6178740 | ok |
| 2026-11-19T07:03:03.865Z | codex-config-models-effort | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 536.5s | 4895862 | ok |
| 2026-11-19T07:18:11.846Z | codex-config-models-effort | implement | codex | gpt-6.1-sol | 2 | 907.3s | 17531415 | ok |
| 2026-11-19T07:18:31.822Z | codex-config-models-effort | code_review | codex | gpt-6.1-sol | 2 | 18.4s | - | failed |
| 2026-11-19T13:08:18.330Z | codex-config-models-effort | code_review | codex | gpt-6.1-sol | 2 | 126.2s | - | ok |
| 2026-11-19T13:18:38.910Z | codex-config-models-effort | code_review | claude | opus | 2 | 620.5s | 1275097 | ok |
| 2026-11-19T13:18:38.916Z | codex-config-models-effort | code_review | claude:code-review-anchored | claude-opus-5-5 | 2 | 87.4s | 1301558 | ok |
| 2026-11-19T13:18:38.922Z | codex-config-models-effort | code_review | claude:code-review-cold | claude-opus-5-5 | 2 | 546.2s | 8272928 | ok |
| 2026-11-19T13:20:13.760Z | codex-config-models-effort | qa | claude | claude-haiku-5-5 | 0 | 94.3s | 1739636 | ok |
