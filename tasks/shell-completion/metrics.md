# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-25T12:37:08.815Z | shell-completion | spec_review | codex | gpt-6-luna | 0 | 39.6s | 380361 | ok |
| 2026-10-25T12:46:06.439Z | shell-completion | plan | claude | opus | 0 | 435.5s | 2064317 | ok |
| 2026-10-25T13:16:26.919Z | shell-completion | implement | codex | gpt-6-luna | 0 | 1819.4s | 38852867 | ok |
| 2026-10-25T13:18:05.501Z | shell-completion | code_review | codex | gpt-6-luna | 0 | 97.4s | - | ok |
| 2026-10-25T13:22:15.487Z | shell-completion | code_review | claude | opus | 0 | 250.0s | 723355 | ok |
| 2026-10-25T13:22:15.491Z | shell-completion | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 166.9s | 1524192 | ok |
| 2026-10-25T13:22:15.494Z | shell-completion | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 172.5s | 1328895 | ok |
| 2026-10-25T13:33:35.412Z | shell-completion | implement | codex | gpt-6-luna | 1 | 679.9s | 47794969 | ok |
| 2026-10-25T13:35:14.245Z | shell-completion | code_review | codex | gpt-6-luna | 1 | 97.8s | - | ok |
| 2026-10-25T13:40:06.077Z | shell-completion | code_review | claude | opus | 1 | 291.8s | 761513 | ok |
| 2026-10-25T13:40:06.081Z | shell-completion | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 189.6s | 1609366 | ok |
| 2026-10-25T13:40:06.084Z | shell-completion | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 229.7s | 2420485 | ok |
| 2026-10-25T13:48:06.450Z | shell-completion | implement | codex | gpt-6-luna | 2 | 480.3s | 52334806 | ok |
| 2026-10-25T13:48:43.472Z | shell-completion | code_review | codex | gpt-6-luna | 2 | 35.6s | - | ok |
| 2026-10-25T13:52:44.232Z | shell-completion | code_review | claude | opus | 2 | 240.8s | 1381734 | ok |
| 2026-10-25T13:52:44.238Z | shell-completion | code_review | claude:code-review-anchored | claude-opus-5-5 | 2 | 138.4s | 1436668 | ok |
| 2026-10-25T13:52:44.242Z | shell-completion | code_review | claude:code-review-cold | claude-opus-5-5 | 2 | 168.0s | 1095466 | ok |
| 2026-10-25T13:58:04.066Z | shell-completion | implement | codex | gpt-6-luna | 3 | 247.1s | 54582000 | ok |
| 2026-10-25T13:58:48.662Z | shell-completion | code_review | codex | gpt-6-luna | 3 | 43.5s | - | ok |
| 2026-10-25T14:02:09.160Z | shell-completion | code_review | claude | opus | 3 | 200.5s | 2276158 | ok |
| 2026-10-25T14:02:09.164Z | shell-completion | code_review | claude:code-review-cold | claude-opus-5-5 | 3 | 64.4s | 308850 | ok |
| 2026-10-25T14:02:09.168Z | shell-completion | code_review | claude:code-review-anchored | claude-opus-5-5 | 3 | 128.3s | 623785 | ok |
| 2026-10-25T14:03:13.660Z | shell-completion | qa | claude | claude-haiku-5-5 | 0 | 64.5s | 1038704 | ok |
