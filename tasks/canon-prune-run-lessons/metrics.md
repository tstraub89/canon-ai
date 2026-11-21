# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.
> Effort: the resolved effort passed to the agent (or a rejected value); `-` when no effort is passed, including Claude sub-agents. Older rows may have no Effort cell.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status | Effort |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-20T07:16:22.466Z | canon-prune-run-lessons | implement | codex | gpt-6-luna | 0 | 280.3s | 2311008 | ok | medium |
| 2026-11-20T07:17:49.043Z | canon-prune-run-lessons | code_review | codex | gpt-6-luna | 0 | 82.7s | - | ok | high |
| 2026-11-20T07:19:19.577Z | canon-prune-run-lessons | code_review | claude | sonnet | 0 | 90.5s | 642031 | ok | medium |
| 2026-11-20T07:19:19.581Z | canon-prune-run-lessons | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 20.2s | 313086 | ok | - |
| 2026-11-20T07:19:19.584Z | canon-prune-run-lessons | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 35.1s | 352141 | ok | - |
| 2026-11-20T07:26:29.065Z | canon-prune-run-lessons | implement | codex | gpt-6-luna | 1 | 428.7s | 7297978 | ok | medium |
| 2026-11-20T07:27:06.020Z | canon-prune-run-lessons | code_review | codex | gpt-6-luna | 1 | 32.5s | - | ok | high |
| 2026-11-20T07:28:03.676Z | canon-prune-run-lessons | code_review | claude | sonnet | 1 | 57.6s | 623721 | ok | medium |
| 2026-11-20T07:28:03.685Z | canon-prune-run-lessons | code_review | claude:code-review-cold | claude-sonnet-5-5 | 1 | 13.7s | 214373 | ok | - |
| 2026-11-20T07:28:03.690Z | canon-prune-run-lessons | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 1 | 18.9s | 238808 | ok | - |
| 2026-11-20T07:29:38.954Z | canon-prune-run-lessons | qa | claude | claude-haiku-5-5 | 0 | 92.5s | 702036 | ok | medium |
