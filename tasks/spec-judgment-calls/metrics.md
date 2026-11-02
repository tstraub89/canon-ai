# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-02T04:32:02.756Z | spec-judgment-calls | spec_review | codex | gpt-6-luna | 0 | 54.5s | 921241 | ok |
| 2026-11-02T04:36:15.820Z | spec-judgment-calls | plan | claude | opus | 0 | 189.6s | 2347998 | ok |
| 2026-11-02T04:45:54.175Z | spec-judgment-calls | implement | codex | gpt-6-luna | 0 | 577.6s | 11177604 | ok |
| 2026-11-02T04:46:20.503Z | spec-judgment-calls | code_review | codex | gpt-6-luna | 0 | 25.2s | - | ok |
| 2026-11-02T04:48:51.304Z | spec-judgment-calls | code_review | claude | opus | 0 | 150.8s | 879130 | ok |
| 2026-11-02T04:48:51.308Z | spec-judgment-calls | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 69.2s | 986033 | ok |
| 2026-11-02T04:48:51.310Z | spec-judgment-calls | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 71.0s | 1028106 | ok |
| 2026-11-02T04:53:50.234Z | spec-judgment-calls | implement | codex | gpt-6-luna | 1 | 298.9s | 14283145 | ok |
| 2026-11-02T04:54:20.151Z | spec-judgment-calls | code_review | codex | gpt-6-luna | 1 | 28.6s | - | ok |
| 2026-11-02T04:55:39.834Z | spec-judgment-calls | code_review | claude | opus | 1 | 79.7s | 538439 | ok |
| 2026-11-02T04:55:39.838Z | spec-judgment-calls | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 34.4s | 353727 | ok |
| 2026-11-02T04:55:39.840Z | spec-judgment-calls | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 34.6s | 446875 | ok |
| 2026-11-02T04:56:35.594Z | spec-judgment-calls | qa | claude | claude-haiku-5-5 | 0 | 55.7s | 621055 | ok |
