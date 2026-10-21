# Workflow Metrics

> Auto-logged by canon's orchestrator. One row per agent invocation.
> Tokens: per-invocation total (input + cache + output). Parsed from the agent's structured output — `claude -p --output-format stream-json` for Claude, `codex exec --json` for Codex. Interactive-mode invocations are not tracked.

| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |
|---|---|---|---|---|---|---|---|---|
| 2026-10-21T01:41:52.276Z | full-send-tail-push-and-watch | spec_review | codex | gpt-6-luna | 0 | 40.9s | 199761 | ok |
| 2026-10-21T02:17:24.214Z | full-send-tail-push-and-watch | spec_review | codex | gpt-6-luna | 0 | 40.0s | 531990 | ok |
| 2026-10-21T02:19:29.186Z | full-send-tail-push-and-watch | spec | claude | opus | 0 | 124.9s | 961521 | ok |
| 2026-10-21T02:20:23.992Z | full-send-tail-push-and-watch | spec_review | codex | gpt-6-luna | 1 | 54.7s | 883724 | ok |
| 2026-10-21T02:21:38.590Z | full-send-tail-push-and-watch | spec | claude | opus | 0 | 74.5s | 491747 | ok |
| 2026-10-21T02:22:53.484Z | full-send-tail-push-and-watch | spec_review | codex | gpt-6-luna | 2 | 74.8s | 1434622 | ok |
| 2026-10-21T02:25:23.528Z | full-send-tail-push-and-watch | spec_review | codex | gpt-6-luna | 0 | 78.7s | 2240497 | ok |
| 2026-10-21T02:26:08.184Z | full-send-tail-push-and-watch | spec | claude | opus | 0 | 44.5s | 691367 | ok |
| 2026-10-21T02:27:11.224Z | full-send-tail-push-and-watch | spec_review | codex | gpt-6-luna | 1 | 63.0s | 2869269 | ok |
| 2026-10-21T02:28:07.490Z | full-send-tail-push-and-watch | spec | claude | opus | 0 | 56.2s | 472243 | ok |
| 2026-10-21T02:28:59.446Z | full-send-tail-push-and-watch | spec_review | codex | gpt-6-luna | 2 | 51.9s | 3256369 | ok |
| 2026-10-21T02:35:35.479Z | full-send-tail-push-and-watch | plan | claude | opus | 0 | 395.9s | 3897866 | ok |
