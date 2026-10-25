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

## Amendment Review

- [x] **Changes requested**

### Findings

1. **[P2] Keep the red-first escape conditional on the spec's named alternative — tasks/reroute-from-implement/spec.md:192 (AC-A3).** For an unfinished original regression-test AC with aborted-round edits in the worktree, this requirement allows the agent to record that testing committed HEAD is impractical without requiring the spec's environment-bound escape or a named deterministic alternative. That weakens the existing checkpoint: difficulty isolating edits is not evidence that the bug mechanism is environment-bound, and an explanation alone does not confirm the premise. Require a safe isolated pre-fix run, or the explicit spec-authorized escape and its named alternative; otherwise require a Blocker and preserve the prohibition on implementing an unconfirmed fix. Preserve earlier-round evidence when it already satisfies the AC. This follows the checkpoint in this phase's instructions and the current implement-reroute prompt's final paragraph.

2. **[P2] Require red-first evidence for the newly added legacy-counter fix — tasks/reroute-from-implement/spec.md:195 (AC-A6).** With implement pending, code_review pending, legacy `iterations: 1`, and no current-loop field, the current predicate returns false while `getIterations()` returns 1. The amendment requires the corrected admit-row test but never requires running it before the fix or recording the observed rejection. The original AC-1 red-first requirement covers the loop-cap and current-field route-back rows, not this new legacy fixture; AC-A9 therefore does not supply the missing checkpoint. State the confirmed deterministic mechanism in the amendment's Problem and explicitly make the legacy fixture red-first, recording rejection before the amendment fix and admission afterward. This is a new bug-fix requirement, not a reconsideration of the approved admission rule.

3. **[P2] Limit the new reroute recovery advice to admitted implementation states — tasks/reroute-from-implement/spec.md:191 (AC-A2).** The targeted recovery section covers both spec_review and code_review loop-cap blocks, and the targeted docs paragraph likewise presents both reset commands. Adding amend-and-`--reroute` as a shared third path would advertise a command that rejects the spec-review cases: the normal spec-review cap leaves current phase spec, and a direct review block leaves spec_review; neither is admitted. This conflicts with the approved Non-Goal retaining those exclusions. Require the new path to be explicitly conditional on implementation having begun, and retain normal spec revision/resume or reset-spec-review guidance for the earlier states. Verify both outcomes when reading the revised recovery text.

### Shape and integration

The amendment otherwise stays within the task's routing, prompt, recovery-text, and test scope. It preserves the parsed Reroute Plan headings and declares the newly edited recovery-file mirror and both dist outputs. AC-A1 explicitly supersedes the earlier Known Risks statement; the implementation should also read its tracked/untracked distinction as correcting the same overstatement in the original Non-Goals and Interaction Dependencies.

The blocking shape concern is the missing red-first requirement for AC-A6. AC-A3 must preserve the existing confirmation contract, and AC-A2 needs the recovery predicate above. No prior approved finding is reopened.

### Verification

- Read the amendment and prior spec review, required project guidance, relevant decisions and lessons, and the current predicate, phase derivation, iteration reader, reroute gate, prompt templates, auto-commit helper, and recovery surfaces. Did not read handoff.md, review.md, or done.md.
- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='isRerouteAdmitted' tests/run-task-reroute-preflight.test.ts` — 26 passed.
- Direct read-only predicate probes: the AC-A6 legacy fixture derives implement and is rejected; a spec-review cap fixture at spec entry derives spec and is rejected; a spec_review-blocked fixture derives spec_review and is rejected.
- `npm run docs-refs-check` — passed after appending this review and the phase note.
- These checks establish the current amendment premises; they do not constitute implementation or validation of the requested fixes.

## Amendment Review

- [x] **Approved**

No findings.

### Shape Check

The amendment is implementable and its acceptance criteria are verifiable. AC-A6 states a deterministic rejection mechanism with concrete trigger values and explicitly requires a failing pre-fix admission test, a passing post-fix run, and recorded evidence. Re-reading the predicate and iteration reader and executing the fixture confirms that the current implementation ignores the positive legacy count. No runtime-dependent mechanism needs additional confirmation.

### Integration and feasibility

The amendment keeps the original admission boundaries, bundle behavior, and reroute evidence headings, with an explicit compatibility extension for legacy review counters. Its recovery guidance distinguishes code-review blocks from the excluded spec/spec-review states. The partial-round checkpoint retains satisfied prior evidence, requires an isolated pre-fix run for unfinished red-first work, and preserves the spec-authorized alternative and unconfirmed-premise block. The tracked/untracked correction explicitly supersedes the older overstatements without changing auto-commit behavior.

The affected-file union covers the prompt and operator-text changes, test assertions, recovery mirror, golden entries, and both generated dist artifacts. The golden restriction is compatible with the named reroute prompt changes; non-reroute prompts need no change. The amendment remains within the approved task's scope.

### Verification and remaining risk

- Re-read the current spec and cumulative spec review, inspected the working tree, and reopened the relevant predicate, iteration reader, reroute gate/banner, prompt templates/builders, admission tests, auto-commit checks, QA-end check, and recovery text. No implementation handoff, code-review artifact, or QA summary was read.
- `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='isRerouteAdmitted' tests/run-task-reroute-preflight.test.ts` — 26 passed in this review session.
- Current-code probes confirmed that the legacy-only fixture derives implement and is rejected, and that spec and spec_review block fixtures remain rejected.
- `npm run docs-refs-check` — passed after appending this fresh review and the phase note.

The amended behavior has not been implemented or exercised by this review. Safe preservation/restoration of interrupted edits, the new legacy admission test, and regenerated prompt evidence remain implementation-phase validation obligations.
