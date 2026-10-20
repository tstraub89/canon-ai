# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-20T04:28:32.334Z | watch-late-attach-crash | spec_review | codex | gpt-6-luna | 0 | 23.8s | 307895 | ok |
| 2026-10-20T04:29:47.068Z | watch-late-attach-crash | plan | claude | sonnet | 0 | 74.6s | 1060108 | ok |
