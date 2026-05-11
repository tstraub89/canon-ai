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
| 2026-05-11T11:59:48.997Z | runtime-validation-phase | spec_review | codex | gpt-5.5 | 0 | 219.3s | 1289664 | ok |
| 2026-05-11T12:02:35.666Z | runtime-validation-phase | spec | claude | opus | - | 166.6s | 1033625 | ok |
| 2026-05-11T12:05:04.145Z | runtime-validation-phase | spec_review | codex | gpt-5.5 | 1 | 148.4s | 2990773 | ok |
| 2026-05-11T12:07:16.047Z | runtime-validation-phase | spec | claude | opus | - | 131.9s | 1059076 | ok |
| 2026-05-11T12:10:15.668Z | runtime-validation-phase | spec_review | codex | gpt-5.5 | 2 | 179.6s | 5864587 | ok |
| 2026-05-11T12:11:40.927Z | runtime-validation-phase | spec | claude | opus | - | 85.2s | 932983 | ok |
| 2026-05-11T12:17:07.556Z | runtime-validation-phase | spec_review | codex | gpt-5.5 | 3 | 72.3s | 7159825 | ok |
| 2026-05-11T12:18:35.534Z | runtime-validation-phase | spec | claude | opus | - | 87.9s | 1178283 | ok |
| 2026-05-11T12:20:41.617Z | runtime-validation-phase | spec_review | codex | gpt-5.5 | 4 | 126.0s | 7571802 | ok |
| 2026-05-11T12:36:23.725Z | runtime-validation-phase | plan | claude | sonnet | - | 520.9s | 1449400 | ok |
| 2026-05-11T12:36:46.156Z | prompt-fidelity-tests | implement | codex | gpt-5.4-mini | 0 | 264.1s | 2545749 | ok |
| 2026-05-11T12:48:15.319Z | prompt-fidelity-tests | code_review | claude | sonnet | 2 | 179.9s | 332751 | ok |
| 2026-05-11T13:01:04.132Z | prompt-fidelity-tests | qa | claude | sonnet | - | 139.0s | 556318 | ok |
| 2026-05-11T13:07:50.734Z | runtime-validation-phase | implement | codex | gpt-5.5 | 0 | 1886.9s | 29028864 | ok |
| 2026-05-11T13:17:28.082Z | runtime-validation-phase | code_review | claude | sonnet | 0 | 577.0s | 2012438 | ok |
| 2026-05-11T13:21:26.896Z | runtime-validation-phase | qa | claude | sonnet | - | 238.7s | 1110652 | ok |
| 2026-05-11T19:39:10.035Z | counter-schema-migration | spec_review | codex | gpt-5.4-mini | 0 | 154.7s | 903222 | ok |
| 2026-05-11T19:41:47.211Z | counter-schema-migration | spec | claude | opus | - | 157.1s | 1033974 | ok |
| 2026-05-11T19:43:56.140Z | counter-schema-migration | spec_review | codex | gpt-5.4-mini | 1 | 128.9s | 1909991 | ok |
| 2026-05-11T19:52:50.059Z | counter-schema-migration | plan | claude | sonnet | - | 376.1s | 1104356 | ok |
| 2026-05-11T20:04:45.674Z | counter-schema-migration | implement | codex | gpt-5.4-mini | 0 | 715.4s | 12689269 | ok |
| 2026-05-11T20:12:06.104Z | counter-schema-migration | implement | codex | gpt-5.4-mini | 1 | 439.9s | 17169664 | ok |
| 2026-05-11T20:14:08.881Z | counter-schema-migration | code_review | claude | sonnet | 1 | 122.3s | 264926 | ok |
| 2026-05-11T20:18:00.003Z | counter-schema-migration | qa | claude | sonnet | - | 231.1s | 1020591 | ok |
