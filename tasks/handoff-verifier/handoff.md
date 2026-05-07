# Implementation Handoff: handoff-verifier

> Author: Codex | Spec: `tasks/handoff-verifier/spec.md` | Plan: `tasks/handoff-verifier/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `<path>` | ... |

## Intent & Rationale

Brief explanation of the approach taken and why.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none / describe what changed from the plan and why)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not met | |
| AC-2: ... | Met / Partial / Not met | |

## Edge Cases Considered

- ...

## Blockers

- (none / list blockers — if an AC is infeasible, note it here rather than silently skipping)
- Label ambiguous ACs with `[ambiguity]` and document the interpretation you chose

## Validation Outcomes

> All applicable checks must pass before submitting for review. If a check appears in spec.md's Validation Required section, it must be recorded as Pass or Fail here — do not mark a required check N/A. Use N/A only for checks that the spec did not require, and explain why in Notes. Failed checks must be fixed — do not submit with failures. Move unresolved failures to Blockers.

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass / Fail / N/A | |
| `<type-check>` | Pass / Fail / N/A | |
| `<unit tests>` | Pass / Fail / N/A | |
| `<E2E>` | Pass / Fail / N/A | |
| `<build>` | Pass / Fail / N/A | |

## Ready for Review

- [ ] All spec ACs met (see AC Coverage table above)
- [ ] All applicable validation checks pass (no failures)
- [ ] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
