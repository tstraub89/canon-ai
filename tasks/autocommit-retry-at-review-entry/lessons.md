### A helper-level test does not prove the call site that wires it in

*(2026-10-20, source: autocommit-retry-at-review-entry)*

The retry was added to the main loop, but its first tests called only the exported helper. They passed while the loop's call site was never exercised, and the spec's integration ACs (pre-flight counter stays 0, no `handoff→diff` block) stayed unmet until code review flagged them. The fix was a fixture that drives `main()` to code_review. Rule of thumb: for any gate or retry placed in a router or loop, write at least one test that drives the entry point, then delete the wiring line and confirm that test fails. For a pre-flight gate, the fixture must keep the checked file out of the base diff, or the gate cannot reproduce the failure it guards.
