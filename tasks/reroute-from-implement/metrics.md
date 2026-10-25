# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-25T13:17:54.620Z | reroute-from-implement | spec_review | codex | gpt-6.1-sol | 0 | 182.8s | 1424501 | ok |
| 2026-10-25T13:26:41.473Z | reroute-from-implement | plan | claude | opus | 0 | 430.0s | 6865188 | ok |
| 2026-10-25T13:36:35.059Z | reroute-from-implement | implement | codex | gpt-6.1-sol | 0 | 592.6s | 6688080 | ok |
| 2026-10-25T13:37:33.210Z | reroute-from-implement | code_review | codex | gpt-6-luna | 0 | 57.2s | - | ok |
| 2026-10-25T13:49:14.230Z | reroute-from-implement | code_review | claude | opus | 0 | 701.0s | 1828884 | ok |
| 2026-10-25T13:49:14.236Z | reroute-from-implement | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 289.7s | 4965870 | ok |
| 2026-10-25T13:49:14.242Z | reroute-from-implement | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 544.1s | 6657333 | ok |
| 2026-10-25T13:50:18.727Z | reroute-from-implement | qa | claude | claude-haiku-5-5 | 0 | 64.5s | 601650 | ok |
| 2026-10-25T13:57:22.516Z | reroute-from-implement | spec_review | codex | gpt-6.1-sol | 0 | 199.7s | 821684 | ok |
| 2026-10-25T13:59:46.579Z | reroute-from-implement | spec_review | codex | gpt-6.1-sol | 1 | 108.5s | 1757954 | ok |
| 2026-10-25T14:03:08.044Z | reroute-from-implement | plan | claude | opus | 0 | 201.5s | 2972186 | ok |
| 2026-10-25T14:12:14.255Z | reroute-from-implement | implement | codex | gpt-6.1-sol | 0 | 546.2s | 13662169 | ok |
