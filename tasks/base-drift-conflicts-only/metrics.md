# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-21T01:40:13.923Z | base-drift-conflicts-only | spec_review | codex | gpt-6-luna | 0 | 43.5s | 434622 | ok |
| 2026-10-21T01:41:38.531Z | base-drift-conflicts-only | spec | claude | opus | 0 | 84.5s | 574187 | ok |
| 2026-10-21T01:42:17.990Z | base-drift-conflicts-only | spec_review | codex | gpt-6-luna | 1 | 39.4s | 710872 | ok |
| 2026-10-21T01:43:37.546Z | base-drift-conflicts-only | spec | claude | opus | 0 | 79.5s | 557525 | ok |
| 2026-10-21T01:44:12.177Z | base-drift-conflicts-only | spec_review | codex | gpt-6-luna | 2 | 34.5s | 956442 | ok |
| 2026-10-21T01:48:22.071Z | base-drift-conflicts-only | plan | claude | opus | 0 | 249.8s | 2058399 | ok |
