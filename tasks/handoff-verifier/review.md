# Code Review: handoff-verifier

> Reviewer: Claude | Spec: `tasks/handoff-verifier/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (`npm run type-check` Pass, `npm test` Pass)
- [x] No required checks were skipped without justification (`lint` and `build` N/A: no linter configured, scripts run via `tsx`)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `verifyHandoffAgainstDiff(taskIds: string[], baseRef: string): string[]` exported with exact signature; delegates to `verifyHandoffAgainstDiffFromData` internally. |
| AC-2 | Met | `parseHandoffFiles(taskId)` called per task; issues emit `[task-id] handoff→diff: <file> listed in handoff but not in diff`. |
| AC-3 | Met | Bundle union compared against diff; non-exempt missing files emit `diff→handoff: <file> in diff but not in any bundle handoff`. |
| AC-4 | Met | Called once after the per-task `validateHandoff()` loop; bundle issues merged into every bundle member's `preflightFailed` entry; routes via existing `runTaskShFor(..., 'changes_requested')` per task. |
| AC-5 | Met | `HANDOFF_DIFF_EXEMPT_PATHS` is the single constant, currently empty. `autoCommitArtifacts()` paths confirmed out-of-scope; `handoff.md` confirmed not committed pre-review (auto-commit debug in `notes.md`). |
| AC-6 | Met | 5 test rows: positive match, handoff→diff negative, diff→handoff negative, bundle union, empty diff+handoff. Exceeds the minimum 3. |
| AC-7 | Met | `validateHandoff(taskId: string)` is untouched; no existing caller modified. |
| AC-8 | Met | Direction markers in all issue strings; bundle failures render under `### Bundle-Level Handoff Verification` header in `review.md`, distinct from per-task issues. |

### Dropped Sections Check

- [x] Non-goals respected (no auto-correction, no new phase, no content verification, `autoCommitCode()` unchanged, no iteration accounting)
- [x] Known Risks all addressed (exemption set confirmed empirically empty, same baseRef and cwd helpers as `autoCommitCode()`, `-M` flag present)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, tight implementation. The two-function split (`verifyHandoffAgainstDiff` for runtime, `verifyHandoffAgainstDiffFromData` for testability) is the right call — it keeps the public API exact while making synthetic-data tests practical. The integration into `runPhase('code_review')` follows the existing preflight pattern without disrupting it. No correctness bugs.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

**optional cleanup/nit** — `scripts/run-task.ts`, bundle-issue logging: when bundle issues exist but no per-task issues, the log shows two separate "FAILED" banners sequentially ("Bundle-wide handoff verification FAILED" then "Validation pre-flight FAILED"), and bundle issues are logged twice (once in the bundle block, again per-task under `[bundle:taskId]`). No behavior impact; `review.md` output is correct.

**optional cleanup/nit** — `tests/run-task-validation.test.ts`: no test exercises `HANDOFF_DIFF_EXEMPT_PATHS` with a nonempty set. Acceptable to defer since the set is currently empty.

#### Spec Gaps

**spec gap** (non-blocking, for template improvement) — AC-5 and Known Risks both describe `parseHandoffFiles()` as "already accepts an array of task IDs." The actual signature is `parseHandoffFiles(taskId: string): string[]` (single ID). Codex handled this correctly by calling per-task and unioning manually. Worth fixing in the spec so future tasks have accurate expectations about the helper.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
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
