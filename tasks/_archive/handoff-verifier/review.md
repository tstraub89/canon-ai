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

## Round 2 — verifying iteration 2's response to round 1

### Verifying Round 1 findings

- _spec gap:_ `parseHandoffFiles()` described as accepting array of task IDs when it's single-ID → **addressed in spec** (`tasks/handoff-verifier/spec.md` now reads "called once per task ID and unioned"). No code delta — the implementation was already correct.
- _optional cleanup/nit:_ bundle-issue logging prints same issues twice per task in console → not addressed (no code changes in this iteration); nit stands, still non-blocking.
- _optional cleanup/nit:_ no test exercises `HANDOFF_DIFF_EXEMPT_PATHS` with nonempty set → not addressed (no code changes); nit stands, still acceptable to defer.

### New findings

(none — Iteration 2 made no source-code changes)

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

---

## Round 3 — external review (post-PR-creation Codex review)

> This round was triggered by external review feedback on the draft PR, not by Claude reviewing a new iteration. PR #1 received a P2 finding from `@codex review` (GitHub) identifying a real correctness bug in Iteration 1's diff command. Conversational Claude is rerouting the task back to implement; Codex iteration 3 should address the finding.

### New findings (correctness)

- **`correctness bug` — rename pair handling**: The diff command `git diff <baseRef>...HEAD --name-only -M` enables rename detection (`-M`) but only outputs the **post-image** path. When a task renames a file and the handoff lists the **pre-image** (old) path — which `autoCommitCode()` already accepts as valid for renames — the verifier emits a false-positive `handoff→diff` rejection because the old path never appears in the diff output. Spec has been updated (AC-2 / AC-2a / AC-3 / Known Risks) to require `--name-status -M` and symmetric rename-pair handling: `R<score>\told\tnew` lines parsed, both paths added to the diff path set, rename entries covered iff either side is in handoff. The fix touches `verifyHandoffAgainstDiff()` (runtime) and `verifyHandoffAgainstDiffFromData()` (test seam — diff input shape needs to express renames as pairs, not flat strings) plus tests for the new rename cases.

### Action for Iteration 3

Address the rename-pair finding per the updated AC-2 / AC-2a / AC-3 in `spec.md`. Add at least one positive test (rename with handoff listing pre-image path) and one negative test (rename with neither side in handoff) using the test seam.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] **Changes requested**
- [ ] Needs re-review

> Source of finding: [Codex review comment on PR #1](https://github.com/tstraub89/canon-ai/pull/1) on `scripts/run-task.ts:2534` — "Include rename preimage paths in diff set".

---

## Round 4 — verifying iteration 3's response to round 3

### Verifying Round 3 findings

- **`correctness bug` — rename pair handling**: Fixed. `verifyHandoffAgainstDiff()` uses `git diff --name-status -M` (line 2563); `parseDiffNameStatusEntries()` captures both columns for rename lines (`R<score>\told\tnew`) via `columns.slice(1)` (line 2499); both paths are added to `diffFiles` in the loop at lines 2528–2530 (`for (const filePath of entry.paths) diffFiles.add(filePath)`). Rename-pair coverage check uses `entry.paths.some(p => bundleHandoffFiles.has(p))` (line 2551) — either side covers the entry, consistent with `autoCommitCode()`'s contract. → **Addressed** ✓

  Two new test cases confirm the fix (both present in `tests/run-task-validation.test.ts`):
  - Line 197: "treats rename preimage paths as covered" — rename `R100\told\tnew` with handoff listing `old-name.ts` → passes ✓
  - Line 210: "rejects rename pairs with neither side in handoff" — rename with empty handoff → emits `diff→handoff` issue referencing both paths ✓

Note: The Iteration 3 auto-commit log (`notes.md`) shows only `status.json` was staged for that commit — the source code was unchanged from `0b3ba6c`, confirming the rename handling was already present in the initial implementation. The round-3 re-verification pass confirmed correctness without requiring a code delta.

### New findings

(none — no new code was introduced in Iteration 3)

### Verdict for this round

- [x] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review
