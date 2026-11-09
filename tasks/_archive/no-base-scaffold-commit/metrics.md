# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-24T04:54:28.857Z | no-base-scaffold-commit | spec_review | codex | gpt-6.1-sol | 0 | 120.4s | 1152294 | ok |
| 2026-10-24T05:11:08.293Z | no-base-scaffold-commit | plan | claude | opus | 0 | 560.0s | 9391486 | ok |
| 2026-10-24T05:24:21.578Z | no-base-scaffold-commit | implement | codex | gpt-6.1-sol | 0 | 792.6s | 7621975 | ok |
| 2026-10-24T05:25:41.531Z | no-base-scaffold-commit | code_review | codex | gpt-6-luna | 0 | 79.0s | - | ok |
| 2026-10-24T05:41:37.528Z | no-base-scaffold-commit | code_review | claude | opus | 0 | 955.9s | 2367503 | ok |
| 2026-10-24T05:41:37.536Z | no-base-scaffold-commit | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 506.3s | 5566075 | ok |
| 2026-10-24T05:41:37.543Z | no-base-scaffold-commit | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 631.4s | 9107416 | ok |
| 2026-10-24T05:55:35.490Z | no-base-scaffold-commit | implement | codex | gpt-6.1-sol | 1 | 837.9s | 14310240 | ok |
| 2026-10-24T05:56:45.461Z | no-base-scaffold-commit | code_review | codex | gpt-6-luna | 1 | 69.0s | - | ok |
| 2026-10-24T06:08:06.122Z | no-base-scaffold-commit | code_review | claude | opus | 1 | 680.6s | 1679195 | ok |
| 2026-10-24T06:08:06.131Z | no-base-scaffold-commit | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 428.4s | 6300660 | ok |
| 2026-10-24T06:08:06.138Z | no-base-scaffold-commit | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 553.7s | 5620094 | ok |
| 2026-10-24T06:15:35.101Z | no-base-scaffold-commit | implement | codex | gpt-6.1-sol | 2 | 448.9s | 19531716 | ok |
| 2026-10-24T06:16:01.649Z | no-base-scaffold-commit | code_review | codex | gpt-6-luna | 2 | 25.5s | - | ok |
| 2026-10-24T06:28:32.553Z | no-base-scaffold-commit | code_review | claude | opus | 2 | 750.9s | 2112697 | ok |
| 2026-10-24T06:28:32.559Z | no-base-scaffold-commit | code_review | claude:code-review-anchored | claude-opus-5-5 | 2 | 210.4s | 1773722 | ok |
| 2026-10-24T06:28:32.565Z | no-base-scaffold-commit | code_review | claude:code-review-cold | claude-opus-5-5 | 2 | 603.3s | 5239319 | ok |
