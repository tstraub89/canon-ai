# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-01T04:33:36.228Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 0 | 62.3s | 840783 | ok |
| 2026-11-01T04:34:30.460Z | adopter-bypass-guards | spec | claude | opus | 0 | 54.1s | 721620 | ok |
| 2026-11-01T04:35:04.654Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 1 | 34.1s | 1530684 | ok |
| 2026-11-01T04:36:13.929Z | adopter-bypass-guards | spec | claude | opus | 0 | 69.2s | 717447 | ok |
| 2026-11-01T04:37:22.859Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 2 | 68.8s | 3544562 | ok |
| 2026-11-01T04:43:53.662Z | adopter-bypass-guards | spec | claude | opus | 0 | 34.3s | 682329 | ok |
| 2026-11-01T04:44:19.050Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 3 | 25.3s | 4698344 | ok |
| 2026-11-01T05:01:18.177Z | adopter-bypass-guards | spec | claude | opus | 0 | 25.5s | 507799 | ok |
| 2026-11-01T05:01:35.898Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 4 | 17.6s | 5578116 | ok |
| 2026-11-01T17:17:56.844Z | adopter-bypass-guards | plan | claude | opus | 0 | 340.4s | 4608420 | ok |
| 2026-11-01T17:52:29.629Z | adopter-bypass-guards | implement | codex | gpt-6-luna | 0 | 2071.7s | 22111946 | ok |
| 2026-11-01T17:53:45.856Z | adopter-bypass-guards | code_review | codex | gpt-6-luna | 0 | 73.7s | - | ok |
| 2026-11-01T18:00:46.323Z | adopter-bypass-guards | code_review | claude | opus | 0 | 420.4s | 1005391 | ok |
| 2026-11-01T18:00:46.329Z | adopter-bypass-guards | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 152.3s | 1305011 | ok |
| 2026-11-01T18:00:46.334Z | adopter-bypass-guards | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 309.9s | 4314574 | ok |
| 2026-11-01T18:08:22.772Z | adopter-bypass-guards | implement | codex | gpt-6-luna | 1 | 456.4s | 26216661 | ok |
| 2026-11-01T18:09:18.653Z | adopter-bypass-guards | code_review | codex | gpt-6-luna | 1 | 54.5s | - | ok |
| 2026-11-01T18:11:59.194Z | adopter-bypass-guards | code_review | claude | opus | 1 | 160.5s | 985628 | ok |
| 2026-11-01T18:11:59.198Z | adopter-bypass-guards | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 63.5s | 347191 | ok |
| 2026-11-01T18:11:59.202Z | adopter-bypass-guards | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 96.6s | 918370 | ok |
| 2026-11-01T18:29:50.492Z | adopter-bypass-guards | implement | codex | gpt-6-luna | 2 | 1071.3s | 39243943 | ok |
| 2026-11-01T18:31:11.766Z | adopter-bypass-guards | code_review | codex | gpt-6-luna | 2 | 79.8s | - | ok |
| 2026-11-01T18:34:22.092Z | adopter-bypass-guards | code_review | claude | opus | 2 | 190.3s | 821493 | ok |
| 2026-11-01T18:34:22.095Z | adopter-bypass-guards | code_review | claude:code-review-cold | claude-opus-5-5 | 2 | 118.0s | 460665 | ok |
| 2026-11-01T18:34:22.098Z | adopter-bypass-guards | code_review | claude:code-review-anchored | claude-opus-5-5 | 2 | 134.5s | 1119310 | ok |
| 2026-11-01T18:47:14.869Z | adopter-bypass-guards | implement | codex | gpt-6-luna | 3 | 522.4s | 43053825 | ok |
| 2026-11-01T18:47:51.399Z | adopter-bypass-guards | code_review | codex | gpt-6-luna | 3 | 35.1s | - | ok |
| 2026-11-01T18:49:27.894Z | adopter-bypass-guards | code_review | claude | opus | 3 | 96.5s | 904056 | ok |
| 2026-11-01T18:49:27.898Z | adopter-bypass-guards | code_review | claude:code-review-anchored | claude-opus-5-5 | 3 | 53.8s | 500342 | ok |
| 2026-11-01T18:49:27.901Z | adopter-bypass-guards | code_review | claude:code-review-cold | claude-opus-5-5 | 3 | 52.9s | 343276 | ok |
| 2026-11-01T18:50:42.895Z | adopter-bypass-guards | qa | claude | claude-haiku-5-5 | 0 | 75.0s | 1073909 | ok |
