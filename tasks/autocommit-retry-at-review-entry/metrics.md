# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-20T03:48:40.330Z | autocommit-retry-at-review-entry | spec_review | codex | gpt-6-luna | 0 | 35.1s | 405582 | ok |
| 2026-10-20T03:49:26.754Z | autocommit-retry-at-review-entry | spec | claude | sonnet | 0 | 46.3s | 827823 | ok |
| 2026-10-20T03:49:54.611Z | autocommit-retry-at-review-entry | spec_review | codex | gpt-6-luna | 1 | 27.7s | 745788 | ok |
| 2026-10-20T03:51:13.759Z | autocommit-retry-at-review-entry | plan | claude | sonnet | 0 | 79.0s | 1368123 | ok |
