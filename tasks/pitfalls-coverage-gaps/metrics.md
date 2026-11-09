# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-09T02:19:37.319Z | pitfalls-coverage-gaps | spec_review | codex | gpt-6-luna | 0 | 81.4s | 540639 | ok |
| 2026-11-09T02:21:12.054Z | pitfalls-coverage-gaps | plan | claude | sonnet | 0 | 94.6s | 711721 | ok |
| 2026-11-09T02:34:49.108Z | pitfalls-coverage-gaps | implement | codex | gpt-6-luna | 0 | 816.2s | 3993743 | ok |
| 2026-11-09T02:35:40.899Z | pitfalls-coverage-gaps | code_review | codex | gpt-6-luna | 0 | 50.8s | - | ok |
| 2026-11-09T02:36:50.392Z | pitfalls-coverage-gaps | code_review | claude | sonnet | 0 | 69.5s | 321140 | ok |
| 2026-11-09T02:36:50.396Z | pitfalls-coverage-gaps | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 37.9s | 474527 | ok |
| 2026-11-09T02:36:50.399Z | pitfalls-coverage-gaps | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 36.3s | 177078 | ok |
| 2026-11-09T02:37:54.678Z | pitfalls-coverage-gaps | qa | claude | claude-haiku-5-5 | 0 | 64.3s | 804272 | ok |
