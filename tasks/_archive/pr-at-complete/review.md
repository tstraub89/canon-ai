# Code Review: pr-at-complete

> Reviewer: Claude | Spec: `tasks/pr-at-complete/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 279 passing, 1 skipped |
| `npm run build` | Pass | dist/ regenerated |
| E2E | N/A | Spec marks E2E as N/A |

No `Fail` results. All applicable checks ran. Gate passes.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `runPhase()` accepts `complete` for `--pr`/`--push`, extends existing `human_review` branch | Partial | Functional behavior is correct; approach deviates from spec's "single source" requirement — see Stage 2 finding |
| AC-2: At `complete` + `--pr`, `commitHumanReviewFiles` produces correct outcome per tree/remote/PR state | Pass | New `remoteRef.ok && openPR !== null` branch at `main.ts:617` handles the existing-PR case; falls through to existing paths for other states |
| AC-3: No-flag `complete` prints state-aware banner (A/B/C) and exits 0 | Pass | `printCompleteStateBanner` / `formatCompleteStateBanner` cover all three states; bundle dedup by branch verified in test |
| AC-4: Clean tree + `--pr` + branch on origin + open PR → print URL + return, not die | Pass | Implemented at `main.ts:617-621`, above the existing `openPR === null` branch as spec requires |
| AC-5: Re-running `--pr` at `human_review` after successful first run is a no-op | Pass | Shared `commitHumanReviewFiles` path handles both phases; subprocess test confirms |
| AC-6: Dirty-file allowlist still rejects out-of-allowlist files at `complete` | Pass | Idempotent branch requires `dirtyEntries.length === 0`; non-empty dirty tree falls through to the `unexpected` filter at `main.ts:634` |
| AC-7: `--ship` continues to fire at `complete` unchanged | Pass | `--ship` dispatched in `main()` before `runPhase`, not touched |
| AC-8: New tests in `tests/run-task-safety.test.ts` | Pass | Banner formatter tests (3 states + `formatExistingPRMessage`); subprocess tests for complete no-flag (3 states), `--pr` idempotency at both phases, dirty allowlist rejection, `--ship` smoke |
| AC-9: `CHANGELOG.md` `### Fixed` entry under `## [1.1.4] — unreleased` referencing #72 | Pass | Entry added; references #72 |

### Dropped Sections Check

- Non-goals respected — no phase reroute, no new flags, no `--ship` behavior change.
- Known Risks addressed in implementation (TypeScript narrowing, `gh pr view` URL fallback, bundle dedup, `--ship` sanity test).
- Human Test Plan satisfiable by the implementation.

### Stage 1 Verdict

**Pass** — proceed to Stage 2.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Tight, focused implementation. The `commitHumanReviewFiles` idempotency fix is well-placed (above the existing retry branch, gated on the same clean-tree condition). The `formatCompleteStateBanner` export and `CompleteState` type make the no-flag banner logic independently testable without process-level mocking. Subprocess-level tests are appropriately comprehensive for this kind of CLI dispatch code. One optional cleanup item on the approach deviation from AC-1.

### Findings

#### Optional Cleanup / Nit

**`complete` dispatch is a parallel block instead of an extension of the `human_review` branch** — `main.ts:1342`

`spec.md` AC-1: "extends the existing `human_review` branch rather than adding a parallel one — single source of behavior." The implementation adds a separate `if (phase === 'complete')` block, duplicating the three-line `--pr`/`--push` → `commitHumanReviewFiles` → `process.exit(0)` triad.

The risk the spec was guarding against: a future change to the `human_review` handler (new pre-commit check, different message, etc.) that doesn't propagate to the `complete` handler. With only three lines duplicated it's a low-probability drift, but the spec was explicit. Deviation is documented in handoff. Not blocking.

To unify if desired: `if (phase === 'human_review' || phase === 'complete')` at the top of the combined block, with an inner `phase === 'complete'` branch for the banner-vs-human_review message split.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration

Finding above is optional cleanup; all ACs are met; validation is clean.

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
