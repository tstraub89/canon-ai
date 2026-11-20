# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.
> Effort: the resolved effort passed to the agent (or a rejected value); `-` when no effort is passed, including Claude sub-agents. Older rows may have no Effort cell.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status | Effort |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-20T02:54:18.082Z | canon-prune-skill | spec_review | codex | gpt-6-luna | 0 | 85.5s | 443330 | ok | high |
| 2026-11-20T03:09:43.021Z | canon-prune-skill | plan | claude | opus | 0 | 366.5s | 4173184 | ok | medium |
| 2026-11-20T03:17:20.568Z | canon-prune-skill | implement | codex | gpt-6-luna | 0 | 455.0s | 2095624 | ok | high |
| 2026-11-20T03:18:54.508Z | canon-prune-skill | code_review | codex | gpt-6-luna | 0 | 91.2s | - | ok | high |
| 2026-11-20T03:23:26.260Z | canon-prune-skill | code_review | claude | opus | 0 | 271.7s | 1306192 | ok | medium |
| 2026-11-20T03:23:26.266Z | canon-prune-skill | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 101.4s | 1889897 | ok | - |
| 2026-11-20T03:23:26.270Z | canon-prune-skill | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 147.0s | 2905981 | ok | - |
| 2026-11-20T03:31:27.863Z | canon-prune-skill | implement | codex | gpt-6-luna | 1 | 481.1s | 4732207 | ok | high |
| 2026-11-20T03:32:25.370Z | canon-prune-skill | code_review | codex | gpt-6-luna | 1 | 54.5s | - | ok | high |
| 2026-11-20T03:35:01.036Z | canon-prune-skill | code_review | claude | opus | 1 | 155.7s | 1203442 | ok | medium |
| 2026-11-20T03:35:01.040Z | canon-prune-skill | code_review | claude:code-review-cold | claude-opus-5-5 | 1 | 72.0s | 1022481 | ok | - |
| 2026-11-20T03:35:01.043Z | canon-prune-skill | code_review | claude:code-review-anchored | claude-opus-5-5 | 1 | 82.8s | 1376687 | ok | - |
| 2026-11-20T03:38:50.714Z | canon-prune-skill | implement | codex | gpt-6-luna | 2 | 229.1s | 6503408 | ok | high |
| 2026-11-20T03:39:23.081Z | canon-prune-skill | code_review | codex | gpt-6-luna | 2 | 29.4s | - | ok | high |
| 2026-11-20T03:41:33.146Z | canon-prune-skill | code_review | claude | opus | 2 | 130.1s | 1165478 | ok | medium |
| 2026-11-20T03:41:33.150Z | canon-prune-skill | code_review | claude:code-review-anchored | claude-opus-5-5 | 2 | 48.7s | 796243 | ok | - |
| 2026-11-20T03:41:33.152Z | canon-prune-skill | code_review | claude:code-review-cold | claude-opus-5-5 | 2 | 60.5s | 762064 | ok | - |
| 2026-11-20T03:43:12.987Z | canon-prune-skill | qa | claude | claude-haiku-5-5 | 0 | 99.4s | 812994 | ok | medium |
