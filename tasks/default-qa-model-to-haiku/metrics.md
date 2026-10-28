# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-27T23:25:59.880Z | default-qa-model-to-haiku | spec_review | codex | gpt-6-luna | 0 | 20.6s | 266337 | ok |
| 2026-10-27T23:28:56.502Z | default-qa-model-to-haiku | plan | claude | sonnet | 0 | 69.7s | 1141821 | ok |
| 2026-10-27T23:40:35.205Z | default-qa-model-to-haiku | implement | codex | gpt-6-luna | 0 | 697.9s | 4978054 | ok |
| 2026-10-27T23:42:18.322Z | default-qa-model-to-haiku | code_review | codex | gpt-6-luna | 0 | 46.6s | - | ok |
| 2026-10-27T23:43:12.811Z | default-qa-model-to-haiku | code_review | claude | sonnet | 0 | 54.5s | 731892 | ok |
| 2026-10-27T23:43:12.815Z | default-qa-model-to-haiku | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 15.7s | 343307 | ok |
| 2026-10-27T23:43:12.820Z | default-qa-model-to-haiku | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 25.7s | 492245 | ok |
| 2026-10-27T23:44:11.960Z | default-qa-model-to-haiku | qa | claude | claude-haiku-5-5 | 0 | 59.1s | 726693 | ok |
| 2026-10-27T23:44:26.609Z | default-qa-model-to-haiku | qa_fixup | claude | claude-haiku-5-5 | - | 14.3s | 350326 | ok |
