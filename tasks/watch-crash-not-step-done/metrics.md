# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-20T03:08:38.593Z | watch-crash-not-step-done | spec_review | codex | gpt-6-luna | 0 | 22.1s | 237696 | ok |
| 2026-10-20T03:09:23.843Z | watch-crash-not-step-done | spec | claude | sonnet | 0 | 45.1s | 1030696 | ok |
| 2026-10-20T03:09:40.932Z | watch-crash-not-step-done | spec_review | codex | gpt-6-luna | 1 | 17.0s | 521211 | ok |
| 2026-10-20T03:10:50.517Z | watch-crash-not-step-done | plan | claude | sonnet | 0 | 69.5s | 931301 | ok |
