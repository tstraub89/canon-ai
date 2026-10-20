# Code Review: autocommit-retry-at-review-entry

> Reviewer: Claude | Spec: `tasks/autocommit-retry-at-review-entry/spec.md`

Synthesized by the foreman from three lenses: anchored Claude, cold-Claude, and pre-obtained cold-Codex.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (per handoff; the anchored lens did not re-run them)
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: red-first main-loop integration regression | Partial | Tests call the exported `retryImplementAutoCommitAtReviewEntry` helper directly. They never drive the main loop or pre-flight, so the `preflight_rejections_current_loop` and no-`handoff→diff` assertions are absent. No red run was observed. The handoff admits both gaps (Deviations, Blockers). |
| AC-2: clean worktree, no retry | Partial | Helper-level only; asserts no commit and no "Retrying" line. Does not assert code_review proceeds. |
| AC-3: persistent commit failure | Partial | Helper exits 1 with `Auto-commit failed:`. The `review.md` and counter assertions are vacuous (the helper never touches them) and would pass on pre-fix code. The "stops before the pre-flight" claim is untested. |
| AC-4: operator-accepted / stale accept | Met | Helper-level coverage of both cases is adequate for this AC. |
| AC-5: pipeline-owned dirt only | Met | |
| AC-6: foreman citation rule + golden | Met | |
| AC-7: docs sentence + mirror | Met | |
| AC-8: full validation | Met | Per handoff; not re-run by the reviewer. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Gaps: AC-1, AC-2 and AC-3 each require a main-loop integration test per the spec (reuse `makeAutoCommitFixture` / `runNodeInline`). The wiring at `src/orchestrator/main.ts:3771` (the `currentPhase === 'code_review'` branch before `buildPipelineState`/`runPhase`) has no test: deleting those three lines leaves every new test green. The red-first requirement for AC-1 is unmet. The handoff's "All spec ACs met" box is unchecked and its Blockers section lists these as unresolved. A narrower test scope is not a permitted deviation, because spec ACs are binding.

## Stage 2 — Code Quality (only if Stage 1 passed)

Not run — Stage 1 failed. Cold-lens findings are adjudicated below for the implementer's benefit.

### Findings

#### Correctness Bugs

1. **code-bug (test-integrity), flagged by anchored + cold-Claude, consistent with cold-Codex's note that only targeted tests were run** — `tests/run-task-safety.test.ts` (new retry tests, around lines 1395-1446): no test exercises the `main()` wiring, so the AC-1/AC-2/AC-3 integration assertions are missing or vacuous (see Stage 1). Fix: add a worktree-mode fixture that drives the main loop to `code_review` with review agents faked. Run it against the pre-fix code first and record the red failure in the handoff. Assert the file is in `git log base..HEAD`, `preflight_rejections_current_loop` is `0`, and no `handoff→diff` block is in `review.md`. For AC-3, assert `preflight_rejections_current_loop` and `iterations_current_loop` are unchanged after the failed retry. For AC-2, assert code_review proceeds.

#### Risk / Guardrails

(none surviving)

#### Optional Cleanup / Nit

- cold-Claude (low): `src/orchestrator/main.ts:395-398` matches `parsePorcelain` output against raw handoff paths. A handoff path written with unusual normalization, or one side of a rename, could miss, which only regresses to old behavior. Not blocking.
- cold-Claude (low): the retry runs on every `canon run` at code_review. An operator's manual edit to a handoff-listed file between runs gets committed under the implement message. This is the spec's own Known Risk (false retry on unrelated dirt) and not a defect.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): `parseHandoffChangesRows` can throw on a missing `handoff.md`, so `canon run` would crash before the pre-flight. Verified against `src/orchestrator/validation.ts:1041-1047`: the function catches the read error and returns `{ files: [], malformed: [] }`. The retry then returns false and the pre-flight reports the missing handoff as before.
- Dismissed (cold-Claude): the foreman citation rule in `code-review-foreman.md` is out of scope. It is spec Decision 4 and AC-6, and a runtime prompt change is intended.
- Dismissed (cold-Claude): the first test does not cover dirty non-handoff source alongside a dirty handoff file, so the retry could become a hard stop. This is per spec: Interaction Dependencies states that `autoCommitCode`'s guards apply unchanged to the retry, and dying on real uncommitted state is correct.
- Dismissed (cold-Codex): the injected output contained no findings, only a summary that the retry is limited to dirty handoff files and reuses the existing auto-commit validation, and that type-check and targeted tests passed. Nothing to adjudicate. This is consistent with the production code being sound while the integration tests are missing.

Out-of-scope files: none flagged. The changed files match the spec's Affected Files. `dist/cli/index.js` had no generated diff, per the handoff.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Delta — base `531448e99ea573463855a3cc186be5fcb05374d5` — reason: small fix within the files already under review

Note: the handoff section addressing round 1 is headed `Iteration 2`, not `Iteration 1` as the prompt said; the anchored lens read that section.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Main-loop worktree test asserts the retry line, file in `main..HEAD`, `preflight_rejections_current_loop` 0, and no `handoff→diff` block. Red-first run recorded in the handoff (command and observed rejection with counter 1); the reviewer did not re-run it. |
| AC-2 | Met | Main-loop clean-handoff test: no retry line, HEAD unchanged, review agent invoked. |
| AC-3 | Met | Main-loop failing pre-commit hook test: exit 1, `Auto-commit failed:`, HEAD unchanged, both counters 0, no agent invoked. |
| AC-4 | Met (unchanged from round 1) | Helper-level coverage of accepted-at-HEAD and stale accept. |
| AC-5 | Met | Covered in helper and main-loop clean tests. |
| AC-6 | Met (unchanged from round 1) | |
| AC-7 | Met (unchanged from round 1) | |
| AC-8 | Met | Per handoff; not re-run by the reviewer. |

### Verifying Round 1 findings

- _correctness bug (test-integrity):_ "no main-loop integration tests for AC-1/2/3" → addressed (`tests/run-task-safety.test.ts`, three `main` tests). The anchored lens judged the AC-1 and AC-3 tests non-vacuous: removing the `currentPhase === 'code_review'` wiring makes both fail. ✓

### New findings (only NEW issues introduced by Iteration 2's changes)

Nits only, none blocking:

- anchored (low): the baseline Deviations, AC Coverage (Partial), Blockers and unchecked "All spec ACs met" box in `handoff.md` are stale; the Iteration 2 section supersedes them.
- anchored (low): AC-4 is covered at helper level only, not through `main()`. The shared predicate is exercised, so the gap is minor.
- anchored (low): indentation is off in `prepareReviewEntryMainFixture` in `tests/run-task-safety.test.ts`; lint passes.
- cold-Claude (low): test 3 relies on hooks staying enabled while test 2 sets `core.hooksPath` only on the `commitSource` branch. The coupling is implicit.
- cold-Claude (low): test 2 asserts only HEAD unchanged, not that the pipeline artifacts stay unstaged.

### Dismissed Cold Findings

- Dismissed (cold-Claude): test 1's `git log main..HEAD -- initial-fixture.txt` could pass with a no-op retry. The file is committed on `main` before the worktree branches and test 1 uses `commitSource` false, so a commit touching it on `main..HEAD` can only come from the retry. With the required "Retrying" stdout line, the assertion is exact enough.
- Dismissed (cold-Claude): strict `=== 0` on the counters relies on the fixture seeding 0. The seeding is deliberate and a strict assertion is the stronger check.
- Dismissed (cold-Claude): the fake `codex` does not log invocations, so extra or missing codex calls go undetected. This matches existing review-loop tests and the spec does not require it.
- Dismissed (cold-Codex): no findings returned; the three targeted tests pass per its summary.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
