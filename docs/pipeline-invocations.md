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
