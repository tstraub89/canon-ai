# Spec Review: canon-watch

> Reviewer: Codex | Spec: `tasks/canon-watch/spec.md`

## Shape Check

no concerns

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] The shared resolution path is implementable without violating the command constraints
- [x] The decision core can emit the required summary lines with the inputs it is given
- [x] The proposed refactor does not introduce behavior the current code cannot support

## Issues Found

### Correctness Issues

(none)

### Missing Edge Cases

1. **Non-blocking:** AC-5 refers to `STOP_WAIT_*`, but `stop.ts` only exposes `STOP_WAIT_DEFAULT_MS` and `STOP_WAIT_POLL_INTERVAL_MS`. The spec already gives implementers the right shape, but this symbol name should be tightened so the plan does not have to guess whether to re-export the timeout value or reference the existing constant directly.

### Type Safety / Interface Gaps

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
