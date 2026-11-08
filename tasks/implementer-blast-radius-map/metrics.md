# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-08T04:35:45.010Z | implementer-blast-radius-map | spec_review | codex | gpt-6-luna | 0 | 56.5s | 270614 | ok |
| 2026-11-08T04:39:29.955Z | implementer-blast-radius-map | plan | claude | opus | 0 | 224.8s | 1611540 | ok |
| 2026-11-08T05:01:06.360Z | implementer-blast-radius-map | implement | codex | gpt-6-luna | 0 | 1295.6s | 11561067 | ok |
| 2026-11-08T05:02:32.643Z | implementer-blast-radius-map | code_review | codex | gpt-6-luna | 0 | 85.3s | - | ok |
| 2026-11-08T05:07:12.744Z | implementer-blast-radius-map | code_review | claude | opus | 0 | 280.1s | 717996 | ok |
| 2026-11-08T05:07:12.748Z | implementer-blast-radius-map | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 117.5s | 1122802 | ok |
| 2026-11-08T05:07:12.751Z | implementer-blast-radius-map | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 195.3s | 2246187 | ok |
| 2026-11-08T05:17:26.274Z | implementer-blast-radius-map | implement | codex | gpt-6-luna | 1 | 613.5s | 14846589 | ok |
| 2026-11-08T05:18:26.985Z | implementer-blast-radius-map | code_review | codex | gpt-6-luna | 1 | 59.7s | - | ok |
| 2026-11-08T05:20:41.713Z | implementer-blast-radius-map | code_review | claude | opus | 1 | 134.7s | 539108 | ok |
| 2026-11-08T05:20:41.720Z | implementer-blast-radius-map | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 80.2s | 678261 | ok |
| 2026-11-08T05:20:41.723Z | implementer-blast-radius-map | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 84.6s | 991277 | ok |
| 2026-11-08T05:22:17.000Z | implementer-blast-radius-map | qa | claude | claude-haiku-5-5 | 0 | 95.3s | 850638 | ok |
