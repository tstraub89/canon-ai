# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-23T01:59:30.237Z | recovery-command-fixtures | spec_review | codex | gpt-6-luna | 0 | 52.7s | 456949 | ok |
| 2026-10-23T02:08:10.067Z | recovery-command-fixtures | plan | claude | opus | 0 | 519.6s | 6202008 | ok |
