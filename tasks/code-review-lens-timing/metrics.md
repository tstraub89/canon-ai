# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-23T01:47:33.615Z | code-review-lens-timing | spec_review | codex | gpt-6-luna | 0 | 30.3s | 292150 | ok |
| 2026-10-23T01:48:38.452Z | code-review-lens-timing | plan | claude | sonnet | 0 | 64.7s | 931350 | ok |
| 2026-10-23T01:55:26.609Z | code-review-lens-timing | implement | codex | gpt-6-luna | 0 | 407.5s | 6030303 | ok |
| 2026-10-23T01:56:31.452Z | code-review-lens-timing | code_review | codex | gpt-6-luna | 0 | 63.9s | - | ok |
| 2026-10-23T01:57:45.462Z | code-review-lens-timing | code_review | claude | sonnet | 0 | 74.0s | 751992 | ok |
| 2026-10-23T01:58:39.486Z | code-review-lens-timing | qa | claude | claude-haiku-5-5 | 0 | 54.0s | 575191 | ok |
