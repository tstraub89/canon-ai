### A fail-open test must reach the throw path, not only the early return

*(date 2026-11-08, source: implementer-blast-radius-map)*

A fake `git` that fails every call returns from the first guard, so the test never reaches the `throw` inside the fail-open `try`. Three of the nine first-round findings on this task were test-integrity gaps: an assertion on a hand-typed string instead of rendered output, a byte-cap check that still passes if every entry is dropped, and a fail-open check that never reached the outer catch. Write the fake to pass early calls through and fail only the call under test, assert a non-empty result when nothing fails (a positive control, so the test cannot go vacuous), and assert exact omitted counts. Reference `buildBlastRadiusBlock` in `src/orchestrator/blast-radius.ts` and its fixtures in `tests/blast-radius.test.ts`.
