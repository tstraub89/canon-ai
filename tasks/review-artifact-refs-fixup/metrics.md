# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-09T03:52:16.901Z | review-artifact-refs-fixup | spec_review | codex | gpt-6-luna | 0 | 130.9s | 745345 | ok |
| 2026-11-09T03:53:02.807Z | review-artifact-refs-fixup | spec | claude | sonnet | 0 | 45.8s | 740010 | ok |
| 2026-11-09T03:54:06.272Z | review-artifact-refs-fixup | spec_review | codex | gpt-6-luna | 1 | 63.4s | 1210036 | ok |
| 2026-11-09T03:54:32.130Z | review-artifact-refs-fixup | spec | claude | sonnet | 0 | 25.8s | 443258 | ok |
| 2026-11-09T03:55:37.591Z | review-artifact-refs-fixup | spec_review | codex | gpt-6-luna | 2 | 65.4s | 1869739 | ok |
| 2026-11-09T03:56:33.008Z | review-artifact-refs-fixup | spec | claude | sonnet | 0 | 30.4s | 453599 | ok |
| 2026-11-09T03:57:25.709Z | review-artifact-refs-fixup | spec_review | codex | gpt-6-luna | 3 | 52.6s | 2359828 | ok |
| 2026-11-09T03:59:17.785Z | review-artifact-refs-fixup | plan | claude | sonnet | 0 | 112.0s | 1284231 | ok |
