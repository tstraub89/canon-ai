# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-01T04:33:36.228Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 0 | 62.3s | 840783 | ok |
| 2026-11-01T04:34:30.460Z | adopter-bypass-guards | spec | claude | opus | 0 | 54.1s | 721620 | ok |
| 2026-11-01T04:35:04.654Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 1 | 34.1s | 1530684 | ok |
| 2026-11-01T04:36:13.929Z | adopter-bypass-guards | spec | claude | opus | 0 | 69.2s | 717447 | ok |
| 2026-11-01T04:37:22.859Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 2 | 68.8s | 3544562 | ok |
| 2026-11-01T04:43:53.662Z | adopter-bypass-guards | spec | claude | opus | 0 | 34.3s | 682329 | ok |
| 2026-11-01T04:44:19.050Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 3 | 25.3s | 4698344 | ok |
| 2026-11-01T05:01:18.177Z | adopter-bypass-guards | spec | claude | opus | 0 | 25.5s | 507799 | ok |
| 2026-11-01T05:01:35.898Z | adopter-bypass-guards | spec_review | codex | gpt-6-luna | 4 | 17.6s | 5578116 | ok |
| 2026-11-01T17:17:56.844Z | adopter-bypass-guards | plan | claude | opus | 0 | 340.4s | 4608420 | ok |
