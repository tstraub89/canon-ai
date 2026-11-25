# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.
> Effort: the resolved effort passed to the agent (or a rejected value); `-` when no effort is passed, including Claude sub-agents. Older rows may have no Effort cell.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status | Effort |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-25T06:12:21.172Z | fix-codex-resume-sandbox | implement | codex | gpt-6-luna | 0 | 445.1s | 1716513 | ok | medium |
| 2026-11-25T06:25:51.410Z | fix-codex-resume-sandbox | code_review | codex | gpt-6-luna | 0 | 46.3s | - | ok | high |
| 2026-11-25T06:26:33.170Z | fix-codex-resume-sandbox | code_review | claude | sonnet | 0 | 41.7s | 327391 | ok | medium |
| 2026-11-25T06:26:33.173Z | fix-codex-resume-sandbox | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 9.4s | 197073 | ok | - |
| 2026-11-25T06:26:33.174Z | fix-codex-resume-sandbox | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 18.3s | 220791 | ok | - |
| 2026-11-25T06:27:32.412Z | fix-codex-resume-sandbox | qa | claude | claude-haiku-5-5 | 0 | 58.8s | 617217 | ok | medium |
