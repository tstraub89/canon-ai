# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-31T15:04:54.501Z | provider-neutral-vendor-wording | spec_review | codex | gpt-6-luna | 0 | 56.5s | 764194 | ok |
| 2026-10-31T15:09:12.041Z | provider-neutral-vendor-wording | plan | claude | opus | 0 | 241.2s | 4190625 | ok |
| 2026-10-31T15:31:51.765Z | provider-neutral-vendor-wording | implement | codex | gpt-6-luna | 0 | 1358.9s | 12611284 | ok |
| 2026-10-31T15:32:18.802Z | provider-neutral-vendor-wording | code_review | codex | gpt-6-luna | 0 | 22.8s | - | ok |
| 2026-10-31T15:36:18.289Z | provider-neutral-vendor-wording | code_review | claude | opus | 0 | 239.4s | 1206513 | ok |
| 2026-10-31T15:36:18.295Z | provider-neutral-vendor-wording | code_review | claude:code-review-cold | claude-opus-5-5 | 0 | 102.0s | 2473883 | ok |
| 2026-10-31T15:36:18.300Z | provider-neutral-vendor-wording | code_review | claude:code-review-anchored | claude-opus-5-5 | 0 | 143.6s | 2465621 | ok |
| 2026-10-31T15:37:22.374Z | provider-neutral-vendor-wording | qa | claude | claude-haiku-5-5 | 0 | 64.1s | 912629 | ok |
