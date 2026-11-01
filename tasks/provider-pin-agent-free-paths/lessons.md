### Keep the other checks in a startup block when one step is skipped

*(2026-11-01, source: provider-pin-agent-free-paths)*

When a mode skips one step in a shared startup block, keep the rest of that block running. The provider-pin fix skipped provider resolution for `--ship`, and the status-file read and validation share the same `try` block. Skipping the whole block would have turned a malformed status file on `--ship` from a clean refusal into an uncaught stack trace. Before gating a block on mode, list each step in it and decide per step. Pin the clean-refusal case with a test. The canonical example is the startup block in `src/orchestrator/main.ts`.
