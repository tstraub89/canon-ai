### Build a gate's test fixtures from the state its real writer produces

*(2026-10-25, source: reroute-from-implement)*

The predecessor's reroute admission test modeled the loop-cap auto-block as code_review `blocked` with verdict `changes_requested`. The implement-entry loop-cap path actually writes implement `pending`, code_review `blocked`, verdict empty. The fixture passed for a state the pipeline never writes, so the gate rejected the real state and no test failed. It surfaced only when this task traced the writer. Prevention: for any gate, find the function that writes each state the gate must admit or refuse, and build the fixture from that writer's output, not from a hand-written status object. Label each row with the writer that produced it, and keep a separate row for each writer that can reach the same phase. Canonical example: the implement-entry loop-cap and code-review-phase rows in `tests/run-task-reroute-preflight.test.ts`.

### A prompt that names a file must also tell the agent to open it

*(2026-10-25, source: reroute-from-implement)*

A reroute prompt pointed the agent at the archived review (`review-prior-<n>.md`) and said its unresolved findings "remain binding", but no instruction told the agent to read it. The sentence was true and still did not get the findings read, and a cold reviewer flagged it as P2. Prevention: when a prompt cites an artifact the agent must act on, pair the citation with an explicit read step, and grep the rendered prompt for the read verb near the path. A test that only checks the path appears in the prompt cannot catch this. Canonical example: the archive guidance built in `archivedReviewGuidance()` in `src/orchestrator/prompts/index.ts`, and the implement-reroute template's step list.
