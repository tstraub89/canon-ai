### Fixture-encoded stream shapes prove the parser, not the harness

*(date 2026-10-22, source: code-review-lens-timing)*

A parser for a CLI's output stream (Claude Code's `stream-json`, Codex's `--json`) written against fixtures passes its tests even when the field paths are wrong, because the fixtures encode the same assumption the parser makes. This task's plan noted that the `tool_use_id` path was not re-verified against a real capture, and that a mismatch would only degrade to `-` values. Before the feature ships, capture one real run of the harness and check each field path the parser reads, then confirm the output in a live run. When a field can only be verified by a live run, say so in the spec's Human Test Plan and in the PR body, not only in the test names. Rule of thumb: for any new read of harness output, grep the captured stream for each key path before writing the fixture, and make the fixture a copy of the capture, not a new hand-written shape.
