# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-20T03:08:38.593Z | watch-crash-not-step-done | spec_review | codex | gpt-6-luna | 0 | 22.1s | 237696 | ok |
| 2026-10-20T03:09:23.843Z | watch-crash-not-step-done | spec | claude | sonnet | 0 | 45.1s | 1030696 | ok |
| 2026-10-20T03:09:40.932Z | watch-crash-not-step-done | spec_review | codex | gpt-6-luna | 1 | 17.0s | 521211 | ok |
| 2026-10-20T03:10:50.517Z | watch-crash-not-step-done | plan | claude | sonnet | 0 | 69.5s | 931301 | ok |
| 2026-10-20T03:14:05.562Z | watch-crash-not-step-done | implement | codex | gpt-6-luna | 0 | 194.4s | 2799691 | ok |
| 2026-10-20T03:14:36.787Z | watch-crash-not-step-done | code_review | codex | gpt-6-luna | 0 | 21.5s | - | ok |
| 2026-10-20T03:16:11.285Z | watch-crash-not-step-done | code_review | claude | sonnet | 0 | 94.5s | 616506 | ok |
| 2026-10-20T03:16:53.235Z | watch-crash-not-step-done | spec_review | codex | gpt-6-luna | 0 | 19.4s | 145088 | ok |
| 2026-10-20T03:17:33.602Z | watch-crash-not-step-done | plan | claude | sonnet | 0 | 40.4s | 577355 | ok |
| 2026-10-20T03:20:11.793Z | watch-crash-not-step-done | implement | codex | gpt-6-luna | 0 | 158.1s | 6870864 | ok |
| 2026-10-20T03:21:52.721Z | watch-crash-not-step-done | code_review | codex | gpt-6-luna | 0 | 70.6s | - | ok |
| 2026-10-20T03:23:06.756Z | watch-crash-not-step-done | code_review | claude | sonnet | 0 | 74.0s | 616101 | ok |
| 2026-10-20T03:23:55.552Z | watch-crash-not-step-done | spec_review | codex | gpt-6-luna | 0 | 21.0s | 159002 | ok |
| 2026-10-20T03:24:44.844Z | watch-crash-not-step-done | plan | claude | sonnet | 0 | 49.3s | 688958 | ok |
| 2026-10-20T03:28:18.860Z | watch-crash-not-step-done | implement | codex | gpt-6-luna | 0 | 214.0s | 13617502 | ok |
| 2026-10-20T03:29:24.218Z | watch-crash-not-step-done | code_review | codex | gpt-6-luna | 0 | 64.8s | - | ok |
| 2026-10-20T03:30:59.595Z | watch-crash-not-step-done | code_review | claude | sonnet | 0 | 95.4s | 863961 | ok |
| 2026-10-20T03:34:50.339Z | watch-crash-not-step-done | qa | claude | claude-haiku-5-5 | 0 | 204.4s | 749107 | ok |
