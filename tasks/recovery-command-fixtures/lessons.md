### When a message restates one contract value on several lines, change every line and check what the new value admits

*(2026-10-22, source: recovery-command-fixtures)*

A halt message that names the same heading on two lines (the fix line and a scope note) can be half-fixed: correcting the fix line left the scope note naming the bare heading, and code review caught it. The corrected round-numbered heading then created a second problem, because a blessed section with that heading satisfied the next human reroute gate with no new amendment. Rule of thumb: when a fix changes a value in an emitted message, grep the emitter for every line that names that value and change them together, then ask whether the replacement lets a bypass path (here, BLESS) satisfy a gate the operator is supposed to pass by hand. Test the replacement by following the printed instruction, then running the next command it implies. Canonical example: the spec_gap halt in `src/orchestrator/main.ts`, with the chained scope-BLESS-reroute fixture in `tests/recovery-hints.test.ts`.

### Derive a fixture's phase from phase statuses before testing a state-specific message

*(2026-10-22, source: recovery-command-fixtures)*

A chained fixture that sets a top-level `status` field, or sets one phase's status to a value that conflicts with the phase it names, does not reach the state it claims. Phase identity comes from `status.phases`, so the derived phase can be a later one: a `code_review` case left `code_review` as done and landed at `qa`, and the `qa` case landed at `human_review`. The registry's coverage claim was false until review caught it. Rule of thumb: build the fixture's state from phase statuses the way an agent would leave them, assert the phase the state derives to before running the command under test, and fail the test if the derived phase is not the one it names.
