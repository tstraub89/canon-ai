# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-21T02:18:06.326Z | artifact-lint-agent-fixup | spec_review | codex | gpt-6-luna | 0 | 39.1s | 376466 | ok |
| 2026-10-21T02:18:30.711Z | artifact-lint-agent-fixup | spec | claude | opus | 0 | 24.3s | 384271 | ok |
| 2026-10-21T02:18:57.467Z | artifact-lint-agent-fixup | spec_review | codex | gpt-6-luna | 1 | 26.7s | 752577 | ok |
| 2026-10-21T02:25:38.571Z | artifact-lint-agent-fixup | plan | claude | opus | 0 | 401.0s | 4623847 | ok |
