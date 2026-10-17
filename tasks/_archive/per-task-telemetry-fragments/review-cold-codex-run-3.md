<!-- round=1 reviewed_sha=aa766e9945d16078e9c7a92bf92e38da78034470 scope=full base=main reason="Round 1 (initial review)" -->

An interruption between writing shared telemetry and consuming fragments can duplicate metrics and lessons on a subsequent `--ship` retry. The normal I/O-error rollback does not cover process termination in this window.

Review comment:

- [P2] Make fragment consumption crash-idempotent — /Users/tstraub/canon-ai/.canon/worktrees/per-task-telemetry-fragments/src/orchestrator/telemetry-fold.ts:96-101
  If `--ship` is interrupted after the shared docs are replaced but before the fragment unlink loop finishes, the fragments remain and a retry folds them again. Metrics rows and lesson entries are appended without deduplication, so they appear twice; make those folds idempotent or persist a recovery marker before replacing the docs.