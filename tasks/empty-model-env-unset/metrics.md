# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.
> Effort: the resolved effort passed to the agent (or a rejected value); `-` when no effort is passed, including Claude sub-agents. Older rows may have no Effort cell.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status | Effort |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-25T16:37:48.137Z | empty-model-env-unset | implement | codex | gpt-6-luna | 0 | 308.1s | 2417354 | ok | medium |
| 2026-11-25T16:41:19.572Z | empty-model-env-unset | implement | codex | gpt-6-luna | 0 | 210.0s | 4699810 | ok | medium |
| 2026-11-25T16:45:42.389Z | empty-model-env-unset | implement | codex | gpt-6-luna | 0 | 261.9s | 8497347 | ok | medium |
| 2026-11-25T16:46:06.043Z | empty-model-env-unset | code_review | codex | gpt-6-luna | 0 | 23.1s | - | ok | high |
| 2026-11-25T16:46:49.054Z | empty-model-env-unset | code_review | claude | sonnet | 0 | 43.0s | 260876 | ok | medium |
| 2026-11-25T16:46:49.056Z | empty-model-env-unset | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 8.2s | 158506 | ok | - |
| 2026-11-25T16:46:49.058Z | empty-model-env-unset | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 17.7s | 194786 | ok | - |
| 2026-11-25T16:51:17.818Z | empty-model-env-unset | implement | codex | gpt-6-luna | 1 | 268.4s | 13514204 | ok | medium |
| 2026-11-25T16:51:48.721Z | empty-model-env-unset | code_review | codex | gpt-6-luna | 1 | 30.0s | - | ok | high |
| 2026-11-25T16:52:17.073Z | empty-model-env-unset | code_review | claude | sonnet | 1 | 28.4s | 238961 | ok | medium |
| 2026-11-25T16:52:17.075Z | empty-model-env-unset | code_review | claude:code-review-cold | claude-sonnet-5-5 | 1 | 8.1s | 119806 | ok | - |
| 2026-11-25T16:52:17.076Z | empty-model-env-unset | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 1 | 13.7s | 202317 | ok | - |
| 2026-11-25T16:53:50.106Z | empty-model-env-unset | qa | claude | claude-haiku-5-5 | 0 | 92.6s | 730270 | ok | medium |
