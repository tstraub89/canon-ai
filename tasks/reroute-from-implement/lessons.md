### Build a gate's test fixtures from the state its real writer produces

*(2026-10-25, source: reroute-from-implement)*

The predecessor's reroute admission test modeled the loop-cap auto-block as code_review `blocked` with verdict `changes_requested`. The implement-entry loop-cap path actually writes implement `pending`, code_review `blocked`, verdict empty. The fixture passed for a state the pipeline never writes, so the gate rejected the real state and no test failed. It surfaced only when this task traced the writer. Prevention: for any gate, find the function that writes each state the gate must admit or refuse, and build the fixture from that writer's output, not from a hand-written status object. Label each row with the writer that produced it, and keep a separate row for each writer that can reach the same phase. Canonical example: the implement-entry loop-cap and code-review-phase rows in `tests/run-task-reroute-preflight.test.ts`.
