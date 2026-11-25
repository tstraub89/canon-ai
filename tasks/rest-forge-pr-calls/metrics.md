# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.
> Effort: the resolved effort passed to the agent (or a rejected value); `-` when no effort is passed, including Claude sub-agents. Older rows may have no Effort cell.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status | Effort |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-25T06:47:26.485Z | rest-forge-pr-calls | spec_review | codex | gpt-6-luna | 0 | 66.8s | 370873 | ok | high |
| 2026-11-25T06:53:01.503Z | rest-forge-pr-calls | plan | claude | opus | 0 | 335.0s | 3592642 | ok | medium |
| 2026-11-25T07:24:59.697Z | rest-forge-pr-calls | implement | codex | gpt-6-luna | 0 | 1916.1s | 18231745 | ok | high |
| 2026-11-25T07:27:03.019Z | rest-forge-pr-calls | code_review | codex | gpt-6-luna | 0 | 122.0s | - | ok | high |
| 2026-11-25T07:31:09.624Z | rest-forge-pr-calls | code_review | claude | opus | 0 | 246.6s | 1190086 | ok | medium |
| 2026-11-25T07:31:09.628Z | rest-forge-pr-calls | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 104.6s | 367299 | ok | - |
| 2026-11-25T07:42:24.584Z | rest-forge-pr-calls | implement | codex | gpt-6-luna | 1 | 674.5s | 23700283 | ok | high |
| 2026-11-25T07:43:24.079Z | rest-forge-pr-calls | code_review | codex | gpt-6-luna | 1 | 58.0s | - | ok | high |
| 2026-11-25T07:49:24.802Z | rest-forge-pr-calls | code_review | claude | opus | 1 | 360.7s | 850898 | ok | medium |
| 2026-11-25T07:51:44.373Z | rest-forge-pr-calls | spec_review | codex | gpt-6-luna | 0 | 78.3s | 278790 | ok | high |
| 2026-11-25T07:53:26.785Z | rest-forge-pr-calls | spec_review | codex | gpt-6-luna | 1 | 70.1s | 609024 | ok | high |
| 2026-11-25T07:54:13.615Z | rest-forge-pr-calls | spec_review | codex | gpt-6-luna | 2 | 36.3s | 932876 | ok | high |
| 2026-11-25T07:55:29.847Z | rest-forge-pr-calls | spec_review | codex | gpt-6-luna | 3 | 44.1s | 1310105 | ok | high |
| 2026-11-25T07:58:11.167Z | rest-forge-pr-calls | plan | claude | opus | 0 | 161.3s | 1313900 | ok | medium |
| 2026-11-25T08:10:31.624Z | rest-forge-pr-calls | implement | codex | gpt-6-luna | 0 | 738.8s | 32616912 | ok | high |
| 2026-11-25T08:12:19.539Z | rest-forge-pr-calls | implement | codex | gpt-6-luna | 0 | 106.1s | 34810643 | ok | high |
| 2026-11-25T08:13:57.605Z | rest-forge-pr-calls | code_review | codex | gpt-6-luna | 0 | 97.3s | - | ok | high |
| 2026-11-25T08:21:13.130Z | rest-forge-pr-calls | code_review | claude | opus | 0 | 435.5s | 1782453 | ok | medium |
| 2026-11-25T08:21:13.136Z | rest-forge-pr-calls | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 115.3s | 769633 | ok | - |
| 2026-11-25T08:32:18.300Z | rest-forge-pr-calls | implement | codex | gpt-6-luna | 1 | 664.6s | 40068597 | ok | high |
| 2026-11-25T08:33:07.160Z | rest-forge-pr-calls | code_review | codex | gpt-6-luna | 1 | 47.5s | - | ok | high |
| 2026-11-25T08:38:50.540Z | rest-forge-pr-calls | code_review | claude | opus | 1 | 343.4s | 1591221 | ok | medium |
| 2026-11-25T08:41:09.021Z | rest-forge-pr-calls | spec_review | codex | gpt-6-luna | 0 | 82.4s | 215880 | ok | high |
| 2026-11-25T08:41:11.266Z | rest-forge-pr-calls | plan | claude | opus | 0 | 2.2s | - | failed | medium |
| 2026-11-25T10:54:42.857Z | rest-forge-pr-calls | plan | claude | opus | 0 | 164.9s | 1438692 | ok | medium |
| 2026-11-25T11:06:43.393Z | rest-forge-pr-calls | implement | codex | gpt-6-luna | 0 | 718.4s | 49109693 | ok | high |
| 2026-11-25T11:08:11.299Z | rest-forge-pr-calls | code_review | codex | gpt-6-luna | 0 | 86.0s | - | ok | high |
| 2026-11-25T11:14:14.675Z | rest-forge-pr-calls | code_review | claude | opus | 0 | 353.6s | 437857 | ok | medium |
| 2026-11-25T11:14:14.679Z | rest-forge-pr-calls | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 118.9s | 656339 | ok | - |
| 2026-11-25T11:18:43.630Z | rest-forge-pr-calls | implement | codex | gpt-6-luna | 1 | 268.3s | 53160021 | ok | high |
| 2026-11-25T11:19:44.569Z | rest-forge-pr-calls | code_review | codex | gpt-6-luna | 1 | 59.4s | - | ok | high |
| 2026-11-25T11:27:34.656Z | rest-forge-pr-calls | code_review | claude | opus | 1 | 470.1s | 258051 | ok | medium |
| 2026-11-25T11:27:34.658Z | rest-forge-pr-calls | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 32.7s | 214739 | ok | - |
| 2026-11-25T11:30:23.981Z | rest-forge-pr-calls | qa | claude | claude-haiku-5-5 | 0 | 168.6s | 936190 | ok | medium |
