# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-23T01:47:29.320Z | red-first-evidence-slot | spec_review | codex | gpt-6-luna | 0 | 26.5s | 301073 | ok |
| 2026-10-23T01:48:29.688Z | red-first-evidence-slot | plan | claude | sonnet | 0 | 60.2s | 826254 | ok |
