# Spec Review: reroute-from-implement

> Reviewer: Codex | Spec: `tasks/reroute-from-implement/spec.md`

## Shape Check

no concerns

The deterministic rejection mechanism is confirmed by the current admission gate, route-back reset, implement-entry loop-cap check, and phase derivation. Direct probes of the loop-cap and review route-back states both derived `implement`, hit the current phase-gate error, and left status bytes unchanged. AC-1 requires red-first coverage of those states. The prompt changes account for unfinished work when admitting partial implementation rounds.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

Traced both proposed predicate call sites, reroute amendment pre-flight and bundle exemption, reset counters and routing, prompt selection, concurrent-run guard, and operator text surfaces. The existing reset already supports the proposed implement-entry states; the spec pins that behavior without expanding the evidence-advance or recovery contracts it explicitly excludes.

Targeted verification against the current code:

- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='rerouteFromHumanReview (admits|rejects|accepts and normalizes)' tests/run-task-reroute-preflight.test.ts` — 15 passed.
- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='review-loop evaluators|review-loop recovery reasons|retains the capped-loop' tests/run-task-code-review.test.ts` — 3 passed.
- Temporary subprocess probes exercised the current reroute gate with implement pending / code review blocked / empty verdict, and implement pending / code review pending / one current-loop review iteration. Both were rejected before status mutation, confirming the stated base behavior.
- `npm run lint` and `npm run docs-refs-check` — passed.

## Issues Found

### Correctness Issues

none

### Missing Edge Cases

none

### Type Safety / Interface Gaps

none

## Verdict

- [x] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

No findings. Partial-round agent execution remains untested at spec review; the implementation phase must supply the new admission/reset tests and regenerated prompt evidence. The explicitly accepted stale-handoff evidence-advance risk remains outside this task.
