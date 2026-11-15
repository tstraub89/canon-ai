# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-15T05:41:14.747Z | ship-followup-capture | spec_review | codex | gpt-6-luna | 0 | 60.3s | 494278 | ok |
| 2026-11-15T05:42:04.347Z | ship-followup-capture | spec | claude | opus | 0 | 49.4s | 716391 | ok |
| 2026-11-15T05:42:58.333Z | ship-followup-capture | spec_review | codex | gpt-6-luna | 1 | 53.8s | 831435 | ok |
| 2026-11-15T06:31:39.911Z | ship-followup-capture | plan | claude | opus | 0 | 759.2s | 7912872 | ok |
| 2026-11-15T07:04:48.737Z | ship-followup-capture | implement | codex | gpt-6-luna | 0 | 1982.4s | 13994926 | ok |
| 2026-11-15T07:10:09.013Z | ship-followup-capture | implement | codex | gpt-6-luna | 0 | 313.8s | 16198044 | ok |
| 2026-11-15T07:11:45.702Z | ship-followup-capture | code_review | codex | gpt-6-luna | 0 | 95.3s | - | ok |
| 2026-11-15T07:17:20.251Z | ship-followup-capture | code_review | claude | opus | 0 | 334.5s | 1704009 | ok |
| 2026-11-15T07:17:20.255Z | ship-followup-capture | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 94.8s | 1777623 | ok |
| 2026-11-15T07:17:20.258Z | ship-followup-capture | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 220.2s | 2078631 | ok |
| 2026-11-15T07:29:06.702Z | ship-followup-capture | implement | codex | gpt-6-luna | 1 | 705.9s | 21992710 | ok |
| 2026-11-15T16:04:50.192Z | ship-followup-capture | spec_review | codex | gpt-6-luna | 0 | 90.1s | 531231 | ok |
| 2026-11-15T16:06:15.908Z | ship-followup-capture | spec_review | codex | gpt-6-luna | 1 | 67.3s | 925738 | ok |
| 2026-11-15T16:08:08.755Z | ship-followup-capture | spec_review | codex | gpt-6-luna | 2 | 82.3s | 1400780 | ok |
| 2026-11-15T16:11:10.349Z | ship-followup-capture | plan | claude | opus | 0 | 181.6s | 1783351 | ok |
| 2026-11-15T16:22:41.894Z | ship-followup-capture | implement | codex | gpt-6-luna | 0 | 689.3s | 26730300 | ok |
| 2026-11-15T16:24:14.311Z | ship-followup-capture | code_review | codex | gpt-6-luna | 0 | 91.1s | - | ok |
| 2026-11-15T16:29:44.416Z | ship-followup-capture | code_review | claude | opus | 0 | 330.0s | 1391573 | ok |
| 2026-11-15T16:29:44.422Z | ship-followup-capture | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 158.6s | 2598667 | ok |
| 2026-11-15T16:29:44.426Z | ship-followup-capture | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 225.8s | 2308347 | ok |
| 2026-11-15T16:31:18.968Z | ship-followup-capture | qa | claude | claude-haiku-5-5 | 0 | 94.1s | 999566 | ok |
| 2026-11-15T16:31:28.602Z | ship-followup-capture | qa_fixup | claude | claude-haiku-5-5 | - | 9.2s | 288895 | ok |
