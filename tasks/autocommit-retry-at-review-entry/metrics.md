# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-20T03:48:40.330Z | autocommit-retry-at-review-entry | spec_review | codex | gpt-6-luna | 0 | 35.1s | 405582 | ok |
| 2026-10-20T03:49:26.754Z | autocommit-retry-at-review-entry | spec | claude | sonnet | 0 | 46.3s | 827823 | ok |
| 2026-10-20T03:49:54.611Z | autocommit-retry-at-review-entry | spec_review | codex | gpt-6-luna | 1 | 27.7s | 745788 | ok |
| 2026-10-20T03:51:13.759Z | autocommit-retry-at-review-entry | plan | claude | sonnet | 0 | 79.0s | 1368123 | ok |
| 2026-10-20T03:56:38.939Z | autocommit-retry-at-review-entry | implement | codex | gpt-6-luna | 0 | 324.5s | 3699506 | ok |
| 2026-10-20T03:58:00.700Z | autocommit-retry-at-review-entry | code_review | codex | gpt-6-luna | 0 | 62.7s | - | ok |
| 2026-10-20T03:59:03.027Z | autocommit-retry-at-review-entry | code_review | claude | sonnet | 0 | 62.3s | 747485 | ok |
| 2026-10-20T04:04:22.162Z | autocommit-retry-at-review-entry | implement | codex | gpt-6-luna | 1 | 319.1s | 12953669 | ok |
| 2026-10-20T04:04:47.711Z | autocommit-retry-at-review-entry | code_review | codex | gpt-6-luna | 1 | 24.9s | - | ok |
| 2026-10-20T04:05:48.346Z | autocommit-retry-at-review-entry | code_review | claude | sonnet | 1 | 60.6s | 646008 | ok |
| 2026-10-20T04:07:07.445Z | autocommit-retry-at-review-entry | qa | claude | claude-haiku-5-5 | 0 | 79.1s | 987192 | ok |
