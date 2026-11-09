# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-09T06:05:32.742Z | spec-prompts-term-renames-rule | implement | codex | gpt-6-luna | 0 | 594.4s | 1860505 | ok |
| 2026-11-09T06:05:57.711Z | spec-prompts-term-renames-rule | implement_fixup | codex | gpt-6-luna | - | 24.4s | 2194519 | ok |
| 2026-11-09T06:06:29.160Z | spec-prompts-term-renames-rule | code_review | codex | gpt-6-luna | 0 | 30.7s | - | ok |
| 2026-11-09T06:07:08.443Z | spec-prompts-term-renames-rule | code_review | claude | sonnet | 0 | 39.3s | 442750 | ok |
| 2026-11-09T06:07:08.447Z | spec-prompts-term-renames-rule | code_review | claude:code-review-anchored | claude-sonnet-5-5 | 0 | 11.9s | 176810 | ok |
| 2026-11-09T06:07:08.449Z | spec-prompts-term-renames-rule | code_review | claude:code-review-cold | claude-sonnet-5-5 | 0 | 12.9s | 270176 | ok |
| 2026-11-09T06:07:57.785Z | spec-prompts-term-renames-rule | qa | claude | claude-haiku-5-5 | 0 | 49.3s | 888596 | ok |
