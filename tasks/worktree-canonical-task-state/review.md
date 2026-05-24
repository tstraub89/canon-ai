# Code Review: worktree-canonical-task-state

> Reviewer: Claude | Spec: `tasks/worktree-canonical-task-state/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [ ] Validation Outcomes table has no `Fail` results
- [ ] All checks required by the spec's "Validation Required" section were run
- [ ] No required checks were skipped without justification

### Acceptance Criteria Check

Cross-reference **every** AC from the spec. Missing an AC from this table is itself a Stage 1 failure.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Pass / Fail / Partial | ... |
| AC-2: ... | Pass / Fail / Partial | ... |

### Dropped Sections Check

- [ ] Non-goals respected (no out-of-scope work)
- [ ] Known Risks addressed or documented as accepted
- [ ] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

> If Stage 1 fails: summarize the gaps above, mark Stage 2 as "Not run — Stage 1 failed," and stop. Codex will re-implement; re-review runs both stages from scratch.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

One paragraph: overall code quality of the implementation.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none / list items)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

(none / list items)

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

(none / list items)

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous or silent. Not a code bug — a signal to improve the spec template or spec authorship. Not blocking unless the guess was wrong (in which case reclassify as correctness bug).

(none / list items)

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
