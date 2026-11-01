### Scope a parser's new exclusion rule to the consumer that needs it, not the shared helper

*(2026-11-01, source: spec-manifest-lint)*

Teaching a shared section extractor to skip fenced code and HTML comments would have changed its output for four non-manifest callers (handoff iterations, review rounds, the Quality Log section), which the spec forbids. The fix was a second, manifest-only scanner that the manifest parser and lint both consume, and the shared helper stayed as it was. Before changing a shared parser's output, grep every caller and check each one's test fixtures for the input the change will alter. Put the new behavior behind a new function when any caller's output would move. Also, when a comment or fence stripper runs before table splitting, protect inline code spans: a literal `<!--` in a Change cell hid a live table in an archived spec until calibration caught it. Canonical example: `scanSpecManifest` in `src/orchestrator/markdown-table.ts`.
