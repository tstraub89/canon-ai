# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-01T03:45:39.588Z | spec-manifest-lint | spec_review | codex | gpt-6.1-sol | 0 | 163.3s | 1280176 | ok |
| 2026-11-01T03:47:16.569Z | spec-manifest-lint | spec | claude | opus | 0 | 96.6s | 1168317 | ok |
| 2026-11-01T03:48:25.213Z | spec-manifest-lint | spec_review | codex | gpt-6.1-sol | 1 | 68.1s | 2081155 | ok |
| 2026-11-01T03:57:55.177Z | spec-manifest-lint | plan | claude | opus | 0 | 481.2s | 7293340 | ok |
