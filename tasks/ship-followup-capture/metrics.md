# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.
> Sub-agent rows: a Claude session that spawns sub-agents also logs one row per top-level sub-agent, Agent `claude:<agent type>`. Their Tokens are that sub-agent's own cumulative usage and are separate from (not included in) the session row.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-11-15T05:41:14.747Z | ship-followup-capture | spec_review | codex | gpt-6-luna | 0 | 60.3s | 494278 | ok |
| 2026-11-15T05:42:04.347Z | ship-followup-capture | spec | claude | opus | 0 | 49.4s | 716391 | ok |
| 2026-11-15T05:42:58.333Z | ship-followup-capture | spec_review | codex | gpt-6-luna | 1 | 53.8s | 831435 | ok |
| 2026-11-15T06:31:39.911Z | ship-followup-capture | plan | claude | opus | 0 | 759.2s | 7912872 | ok |
