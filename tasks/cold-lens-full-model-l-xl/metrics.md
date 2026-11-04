# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-04T04:01:34.119Z | cold-lens-full-model-l-xl | spec_review | codex | gpt-6.1-sol | 0 | 112.6s | 1541257 | ok |
| 2026-11-04T15:03:47.386Z | cold-lens-full-model-l-xl | plan | claude | opus | 0 | 201.2s | 2911021 | ok |
| 2026-11-04T15:09:50.564Z | cold-lens-full-model-l-xl | implement | codex | gpt-6.1-sol | 0 | 362.1s | 1878888 | ok |
| 2026-11-04T15:10:18.279Z | cold-lens-full-model-l-xl | code_review | codex | gpt-6-luna | 0 | 26.5s | - | ok |
| 2026-11-04T15:14:07.900Z | cold-lens-full-model-l-xl | code_review | claude | opus | 0 | 229.6s | 893520 | ok |
| 2026-11-04T15:14:07.906Z | cold-lens-full-model-l-xl | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 118.8s | 1960599 | ok |
| 2026-11-04T15:14:07.910Z | cold-lens-full-model-l-xl | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 147.3s | 2491342 | ok |
| 2026-11-04T15:15:27.063Z | cold-lens-full-model-l-xl | qa | claude | claude-haiku-5-5 | 0 | 79.1s | 951560 | ok |
