# Workflow Metrics

> Auto-logged by `scripts/run-task.ts`. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-05-07T20:45:34.763Z | handoff-verifier | spec_review | codex | gpt-5.4-mini | 0 | 72.8s | 537901 | ok |
| 2026-05-07T20:47:46.561Z | handoff-verifier | spec | claude | opus | - | 131.7s | 588989 | ok |
| 2026-05-07T20:49:08.187Z | handoff-verifier | spec_review | codex | gpt-5.4-mini | 1 | 81.5s | 1322902 | ok |
| 2026-05-07T23:27:22.789Z | handoff-verifier | plan | claude | sonnet | - | 293.2s | 823592 | ok |
| 2026-05-07T23:35:12.875Z | handoff-verifier | implement | codex | gpt-5.4-mini | 0 | 469.4s | 17719106 | ok |
| 2026-05-07T23:38:27.166Z | handoff-verifier | code_review | claude | sonnet | 0 | 193.2s | 598923 | ok |
| 2026-05-07T23:40:44.109Z | handoff-verifier | qa | claude | sonnet | - | 136.6s | 908876 | ok |
| 2026-05-08T03:22:35.127Z | handoff-verifier | implement | codex | gpt-5.4-mini | 0 | 98.3s | 18583065 | ok |
| 2026-05-08T04:09:20.055Z | handoff-verifier | code_review | claude | sonnet | 0 | 334.6s | 897304 | ok |
| 2026-05-08T04:12:48.050Z | handoff-verifier | qa | claude | sonnet | - | 207.7s | 787893 | ok |
| 2026-05-09T05:20:07.759Z | smoke-split-run-task | spec | claude | opus | - | 113.0s | 459995 | ok |
| 2026-05-09T05:22:41.068Z | smoke-split-run-task | spec_review | codex | gpt-5.4-mini | 0 | 64.0s | 194496 | ok |
| 2026-05-10T02:39:49.609Z | add-ci | spec_review | codex | gpt-5.4-mini | 0 | 88.7s | 560735 | ok |
| 2026-05-10T02:40:43.158Z | add-ci | spec | claude | opus | - | 53.5s | 413096 | ok |
| 2026-05-10T02:41:40.111Z | add-ci | spec_review | codex | gpt-5.4-mini | 1 | 56.9s | 989649 | ok |
| 2026-05-10T02:42:02.100Z | add-ci | spec | claude | opus | - | 21.9s | 298145 | ok |
| 2026-05-10T02:42:50.213Z | add-ci | spec_review | codex | gpt-5.4-mini | 2 | 48.1s | 1571974 | ok |
| 2026-05-10T02:57:25.825Z | add-ci | plan | claude | sonnet | - | 118.5s | 450212 | ok |
| 2026-05-10T03:00:33.492Z | add-ci | implement | codex | gpt-5.4-mini | 0 | 187.5s | 3798009 | ok |
| 2026-05-10T03:03:11.428Z | add-ci | code_review | claude | sonnet | 0 | 157.6s | 595863 | ok |
| 2026-05-10T03:05:03.859Z | add-ci | qa | claude | sonnet | - | 112.4s | 671280 | ok |
| 2026-05-11T03:33:27.479Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 0 | 241.7s | 1778053 | ok |
| 2026-05-11T03:34:19.018Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 1 | 51.2s | 2453605 | ok |
| 2026-05-11T03:34:52.026Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 2 | 32.7s | 3064056 | ok |
| 2026-05-11T03:35:17.343Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 3 | 23.9s | 3581481 | ok |
| 2026-05-11T04:07:44.955Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 1 | 85.1s | 5425986 | ok |
| 2026-05-11T04:08:16.836Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 2 | 31.4s | 6193827 | ok |
| 2026-05-11T04:08:41.913Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 3 | 24.4s | 6829034 | ok |
| 2026-05-11T04:27:47.535Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 1 | 78.0s | 8830426 | ok |
| 2026-05-11T04:28:16.081Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 2 | 28.1s | 9709841 | ok |
| 2026-05-11T04:28:40.043Z | markdown-table-parser | implement | codex | gpt-5.4-mini | 3 | 23.5s | 10617262 | ok |
