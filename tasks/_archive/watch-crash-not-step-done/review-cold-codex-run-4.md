<!-- round=1 reviewed_sha=525df1859b1fc0d8f0f8fd4affa7ca680e3e6650 scope=full base=main reason="Round 1 (initial review)" -->

A marker-shaped suffix in ordinary run output can be misclassified as an orchestrator crash, causing a false failure report. The added tests do not cover a marker substring embedded in a line that ends with a valid-looking timestamp.

Review comment:

- [P2] Anchor exit markers to the start of a log line — /Users/tstraub/canon-ai/.canon/worktrees/watch-crash-not-step-done/src/orchestrator/run-context.ts:29-29
  If task or agent output contains text ending with a marker-shaped string, this regex matches the marker substring even when it is embedded in ordinary output. `classifyIdle` can then report a crash and exit with code 4 for a run that did not emit an orchestrator exit marker. Require the marker to begin at the start of its line.