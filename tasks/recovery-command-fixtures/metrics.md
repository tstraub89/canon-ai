# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-23T01:59:30.237Z | recovery-command-fixtures | spec_review | codex | gpt-6-luna | 0 | 52.7s | 456949 | ok |
| 2026-10-23T02:08:10.067Z | recovery-command-fixtures | plan | claude | opus | 0 | 519.6s | 6202008 | ok |
| 2026-10-23T02:22:53.325Z | recovery-command-fixtures | implement | codex | gpt-6-luna | 0 | 882.6s | 7040352 | ok |
| 2026-10-23T02:41:45.085Z | recovery-command-fixtures | code_review | codex | gpt-6-luna | 0 | 55.7s | - | ok |
| 2026-10-23T02:46:07.366Z | recovery-command-fixtures | code_review | claude | opus | 0 | 262.2s | 769122 | ok |
| 2026-10-23T02:54:21.335Z | recovery-command-fixtures | implement | codex | gpt-6-luna | 1 | 493.9s | 29732167 | ok |
| 2026-10-23T02:54:49.964Z | recovery-command-fixtures | code_review | codex | gpt-6-luna | 1 | 27.6s | - | ok |
| 2026-10-23T02:58:09.194Z | recovery-command-fixtures | code_review | claude | opus | 1 | 199.2s | 1400561 | ok |
| 2026-10-23T03:04:19.940Z | recovery-command-fixtures | implement | codex | gpt-6-luna | 2 | 370.7s | 32236154 | ok |
| 2026-10-23T03:05:28.435Z | recovery-command-fixtures | code_review | codex | gpt-6-luna | 2 | 64.2s | - | ok |
| 2026-10-23T03:07:14.060Z | recovery-command-fixtures | code_review | claude | opus | 2 | 105.6s | 882014 | ok |
| 2026-10-23T03:08:29.232Z | recovery-command-fixtures | qa | claude | claude-haiku-5-5 | 0 | 75.1s | 917595 | ok |
