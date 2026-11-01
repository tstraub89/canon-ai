# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-01T05:51:42.012Z | ship-merge-method | spec_review | codex | gpt-6-luna | 0 | 42.1s | 550943 | ok |
| 2026-11-01T05:52:47.099Z | ship-merge-method | spec | claude | sonnet | 0 | 45.6s | 554180 | ok |
| 2026-11-01T05:53:09.944Z | ship-merge-method | spec_review | codex | gpt-6-luna | 1 | 22.7s | 1057360 | ok |
| 2026-11-01T20:00:05.088Z | ship-merge-method | plan | claude | sonnet | 0 | 145.6s | 1324144 | ok |
| 2026-11-01T21:13:39.834Z | ship-merge-method | implement | codex | gpt-6-luna | 0 | 1601.7s | 17354395 | ok |
| 2026-11-01T22:46:45.802Z | ship-merge-method | code_review | codex | gpt-6-luna | 0 | 56.0s | - | ok |
| 2026-11-01T22:48:16.212Z | ship-merge-method | code_review | claude | sonnet | 0 | 90.4s | 614604 | ok |
| 2026-11-01T22:48:16.215Z | ship-merge-method | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 30.1s | 365616 | ok |
| 2026-11-01T22:48:16.218Z | ship-merge-method | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 52.1s | 575437 | ok |
| 2026-11-01T22:49:26.991Z | ship-merge-method | qa | claude | claude-haiku-5-5 | 0 | 70.8s | 986790 | ok |
| 2026-11-01T22:49:38.436Z | ship-merge-method | qa_fixup | claude | claude-haiku-5-5 | - | 11.0s | 343285 | ok |
