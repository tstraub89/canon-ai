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
| 2026-10-21T02:41:47.415Z | full-send-tail-push-and-watch | implement | codex | gpt-6-luna | 0 | 371.4s | 4451441 | ok |
| 2026-10-21T02:42:55.258Z | full-send-tail-push-and-watch | code_review | codex | gpt-6-luna | 0 | 67.4s | - | ok |
| 2026-10-21T02:47:25.009Z | full-send-tail-push-and-watch | code_review | claude | opus | 0 | 269.7s | 670088 | ok |
| 2026-10-21T03:02:25.982Z | full-send-tail-push-and-watch | implement | codex | gpt-6-luna | 1 | 900.9s | 15202297 | ok |
| 2026-10-21T03:03:23.945Z | full-send-tail-push-and-watch | code_review | codex | gpt-6-luna | 1 | 57.4s | - | ok |
| 2026-10-21T03:09:03.534Z | full-send-tail-push-and-watch | code_review | claude | opus | 1 | 339.6s | 1296438 | ok |
| 2026-10-21T03:14:26.531Z | full-send-tail-push-and-watch | implement | codex | gpt-6-luna | 2 | 323.0s | 17944173 | ok |
| 2026-10-21T03:15:27.939Z | full-send-tail-push-and-watch | code_review | codex | gpt-6-luna | 2 | 60.6s | - | ok |
| 2026-10-21T03:18:47.670Z | full-send-tail-push-and-watch | code_review | claude | opus | 2 | 199.7s | 689602 | ok |
| 2026-10-21T05:24:44.266Z | full-send-tail-push-and-watch | code_review | codex | gpt-6-luna | 0 | 161.9s | - | ok |
| 2026-10-21T05:29:18.957Z | full-send-tail-push-and-watch | code_review | claude | opus | 0 | 274.6s | 945086 | ok |
| 2026-10-21T05:40:09.989Z | full-send-tail-push-and-watch | implement | codex | gpt-6-luna | 1 | 651.0s | 26816239 | ok |
| 2026-10-21T05:40:25.884Z | full-send-tail-push-and-watch | code_review | codex | gpt-6-luna | 1 | 15.3s | - | ok |
| 2026-10-21T05:45:25.664Z | full-send-tail-push-and-watch | code_review | claude | opus | 1 | 299.8s | 711951 | ok |
| 2026-10-21T05:46:45.227Z | full-send-tail-push-and-watch | qa | claude | claude-haiku-5-5 | 0 | 79.5s | 725793 | ok |
