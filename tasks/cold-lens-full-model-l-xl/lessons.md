### Pin matrix expectations to literal values, not to the config they test

*(2026-11-04, source: cold-lens-full-model-l-xl)*

A test that reads its expected model from the same config it is checking cannot fail on a wrong cell, because the expected value moves with the bug. The existing review-invocation parity test and the `makeDeps` stub both did this, so they passed on the old mini cells for L and XL. Prevention: for any size, phase, or tier matrix, write the expected value as a literal next to the cell it pins, and pick distinct override values (for example `mini-x` and `full-x`) so a fallback to the wrong tier shows up as a wrong literal. If the matrix reads env vars at module load, put the test in a spawned process that sets them first. Confirm the test fails on the old cells before editing production code. Canonical example: the fresh-process literal `-m` assertions in `tests/run-task-code-review.test.ts` and the matrix table in `tests/pipeline-policy.test.ts`.
