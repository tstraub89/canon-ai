### Check the legitimate values of a shape before replacing an exact-text placeholder match

*(date 2026-11-08, source: post-ship-cleanup)*

The Self-Check placeholder check moved from matching the template's exact `_(` prefix to rejecting any Evidence cell that is entirely parenthesized. That also rejects real evidence written the same way, such as `(verified both entry points against the diff)`. Two cold reviewers flagged it. The spec had accepted the shape rule as a Known Risk, so it shipped with the cost. Rule of thumb: when a check moves from exact-text matching to shape matching, list the real values that share the shape (parenthesized prose, a bare `(N/A)`) in the spec, and either accept each one or keep the exact match. Canonical example: `checkSelfCheckEvidence` in `src/orchestrator/validation.ts`, with its tests in `tests/run-task-validation.test.ts`.
