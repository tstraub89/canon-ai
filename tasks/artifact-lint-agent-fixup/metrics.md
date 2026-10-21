# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-21T02:18:06.326Z | artifact-lint-agent-fixup | spec_review | codex | gpt-6-luna | 0 | 39.1s | 376466 | ok |
| 2026-10-21T02:18:30.711Z | artifact-lint-agent-fixup | spec | claude | opus | 0 | 24.3s | 384271 | ok |
| 2026-10-21T02:18:57.467Z | artifact-lint-agent-fixup | spec_review | codex | gpt-6-luna | 1 | 26.7s | 752577 | ok |
| 2026-10-21T02:25:38.571Z | artifact-lint-agent-fixup | plan | claude | opus | 0 | 401.0s | 4623847 | ok |
| 2026-10-21T02:39:49.281Z | artifact-lint-agent-fixup | implement | codex | gpt-6-luna | 0 | 850.2s | 17483398 | ok |
| 2026-10-21T02:41:26.020Z | artifact-lint-agent-fixup | code_review | codex | gpt-6-luna | 0 | 96.2s | - | ok |
| 2026-10-21T02:45:55.688Z | artifact-lint-agent-fixup | code_review | claude | opus | 0 | 269.6s | 777136 | ok |
| 2026-10-21T02:54:55.978Z | artifact-lint-agent-fixup | implement | codex | gpt-6-luna | 1 | 540.2s | 22045925 | ok |
| 2026-10-21T02:55:16.814Z | artifact-lint-agent-fixup | code_review | codex | gpt-6-luna | 1 | 20.2s | - | ok |
| 2026-10-21T02:58:01.544Z | artifact-lint-agent-fixup | code_review | claude | opus | 1 | 164.7s | 873558 | ok |
| 2026-10-21T03:08:37.067Z | artifact-lint-agent-fixup | implement | codex | gpt-6-luna | 2 | 635.5s | 29937662 | ok |
| 2026-10-21T03:09:01.804Z | artifact-lint-agent-fixup | code_review | codex | gpt-6-luna | 2 | 24.1s | - | ok |
| 2026-10-21T03:13:46.328Z | artifact-lint-agent-fixup | code_review | claude | opus | 2 | 284.5s | 925730 | ok |
| 2026-10-21T03:18:16.408Z | artifact-lint-agent-fixup | implement | codex | gpt-6-luna | 3 | 270.0s | 32623974 | ok |
| 2026-10-21T03:18:35.549Z | artifact-lint-agent-fixup | code_review | codex | gpt-6-luna | 3 | 18.6s | - | ok |
| 2026-10-21T03:18:58.657Z | artifact-lint-agent-fixup | code_review | claude | opus | 3 | 23.1s | 407482 | failed |
| 2026-10-21T05:23:14.871Z | artifact-lint-agent-fixup | code_review | codex | gpt-6-luna | 0 | 72.3s | - | ok |
| 2026-10-21T05:32:56.365Z | artifact-lint-agent-fixup | code_review | claude | opus | 0 | 581.5s | 1691357 | ok |
| 2026-10-21T05:37:19.280Z | artifact-lint-agent-fixup | implement | codex | gpt-6-luna | 1 | 262.9s | 36946710 | ok |
| 2026-10-21T05:37:48.002Z | artifact-lint-agent-fixup | code_review | codex | gpt-6-luna | 1 | 28.1s | - | ok |
| 2026-10-21T05:42:15.428Z | artifact-lint-agent-fixup | code_review | claude | opus | 1 | 267.4s | 647099 | ok |
| 2026-10-21T05:43:34.828Z | artifact-lint-agent-fixup | qa | claude | claude-haiku-5-5 | 0 | 79.4s | 946425 | ok |
