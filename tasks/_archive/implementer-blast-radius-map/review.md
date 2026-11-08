# Code Review: implementer-blast-radius-map

> Reviewer: Claude | Spec: `tasks/implementer-blast-radius-map/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored-Claude (returned, `STAGE_1: pass`, signal approve), cold-Claude (returned, signal changes_requested), cold-Codex (injected, one P2).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification (the one skipped test is the existing linked-worktree anchor check, which this diff doesn't touch)
- [x] Red-first evidence recorded for each red-first AC (none are red-first)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: self-check in fresh/park-resume/revisions/reroute, absent in resume | Pass | `implement.md` gates it with `{{#selfCheck}}`, which is set only for `mode === 'fresh'`. Reroute and revisions carry it inline. Order, placement and resume absence are tested. |
| AC-2: self-check and framing adopter- and role-neutral | Partial | The prompt-level test checks the rendered heading, framing and identifiers subheading under both providers. The unit test in `tests/blast-radius.test.ts:291-302` checks hand-typed literals, not rendered output (Finding 1). |
| AC-3: References part via `extractAffectedFiles` | Pass | Both specifier forms and the file-name mention are listed. The plain-word file and both Affected Files are excluded. |
| AC-4: identifiers part | Pass | Covers the `parseWidget(x)` call site, `--dry-run`, an amendment-only token, the directory-entry exclusion, and the path and lowercase filters. |
| AC-5: `tasks/` and `linguist-generated` exclusion | Pass | Fixture-tested: the marked file is absent and the unmarked file is present. |
| AC-6: bounds | Pass | `+N more`, the token cap keeping the amendment token, and the byte cap with its truncation line are all tested. The byte-cap assertion is weak (Finding 3). |
| AC-7: framing sentence in fresh golden | Pass | `tests/run-task-prompts.test.ts:452`. |
| AC-8: empty, non-git and failure cases return `''` | Pass | Fail-open behavior is confirmed. The mid-build throw path is untested (Finding 2). |
| AC-9: explicit root, `gitSafeAt*` only | Pass | Only `gitSafeAt` and `gitSafeAtRaw(root, …)` are used. The two-repo test proves the root argument controls the result. |
| AC-10: map in fresh and reroute, absent in revisions and resume | Pass | Covered by the goldens and the resume assertion. The fixture repo is created per test run. |
| AC-11: `.gitattributes` | Pass | Anchored lens re-ran `git check-attr`: `set` for `dist/cli/index.js` and `templates/.canon/templates/spec.md`, `unspecified` for `templates/docs/patterns.md`. |
| AC-12: doc note plus mirror | Pass | `docs/pipeline-orchestrator.md:306`. The mirror is in sync. Wording nit in Finding 5. |
| AC-13: goldens regenerated, suite passes | Pass | Per the handoff. The anchored lens re-ran both touched test files: 83/83 passed. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

AC-2 is marked Partial because of its test, not its behavior. The rendered text is neutral, and that is a test-integrity defect, so it is handled in Stage 2.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The builder is clean and fail-open, uses only root-scoped git helpers with `-z` output, and follows the spec closely. One new test is vacuous, and that drives the verdict. The rest are small hardening and wording items, best fixed in the same pass.

### Findings

#### Correctness Bugs

1. **[code-bug, test integrity] The AC-2 neutrality unit test never inspects rendered output.** `tests/blast-radius.test.ts:291-302`. Flagged by 2 lenses (anchored and cold-Claude).
   - The test asserts `block === ''`, then regex-checks a hand-built string of the heading constants and retyped copies of the `### Files referencing Affected Files` heading and the truncation line.
   - If `renderEntries` (`src/orchestrator/blast-radius.ts`) emitted a non-neutral references heading or truncation line, the test would still pass.
   - No golden renders those two strings. The golden fixture has no existing Affected File, and nothing exceeds the byte cap.
   - Fix: render a non-empty block in a fixture that produces both parts and the truncation line (the byte-cap fixture can be reused), then run the forbidden-term check against that output. Drop the hand-typed list.

#### Risk / Guardrails

2. **[code-bug, low] The fail-open test only exercises the early `rev-parse` return.** `tests/blast-radius.test.ts:231-253`. Flagged by 2 lenses.
   - The fake `git` exits 2 on every call, so the function returns before reaching the `throw` in `gitGrep` or in `generatedFiles`.
   - Nothing tests that the outer `catch` swallows those throws. AC-8's "a git command fails" covers that path.
   - Fix: add a case where `rev-parse` succeeds and `grep` or `check-attr` fails, for example a fake `git` that passes `rev-parse` through and fails the rest.
3. **[code-bug, low] The byte-cap test would pass if every entry were dropped.** `tests/blast-radius.test.ts:211-226`. Anchored lens.
   - It asserts only `<= BYTE_CAP` and that a truncation line exists.
   - Fix: also assert that at least one entry survives and that the omitted count matches what was dropped.
4. **[code-bug, low] Acronym-led PascalCase identifiers are never searched.** `src/orchestrator/blast-radius.ts:78` (the shaped test `/[a-z0-9][A-Z]/`). Anchored lens.
   - `URLParser`, `JSONValue` and `HTTPServer` fail the shape test.
   - The spec lists PascalCase as searchable. The handoff's `[ambiguity]` Blocker covers only single-hump names such as `Widget`, and that interpretation is accepted.
   - Fix: also accept an uppercase run followed by a lowercase letter (`/[A-Z]{2,}[a-z]/`) and add a test case.

#### Optional Cleanup / Nit

5. **The doc note understates where the map appears.** `docs/pipeline-orchestrator.md:306` and its mirror. Flagged by 2 lenses.
   - It says "Fresh and rerouted implement prompts". Park-resume prompts also get the map, because they render through the fresh prompt.
   - The note also sits inside the env-var section. Consider moving it next to the implement-prompt description.
6. **`CANON_BLAST_RADIUS_ROOT` is not marked test-only.** `src/orchestrator/blast-radius.ts:10,198-200`. Flagged by 2 lenses.
   - The spec sanctions it as a test-only override and rules out a new user-facing env var.
   - Fix: add a source comment saying it is test-only. Don't add a doc table row, which would make it user-facing.
7. **The three self-check blocks are byte-identical with no parity test.** They live in `implement.md`, `implement-reroute.md` and `implement-revisions.md`. Flagged by 2 lenses.
   - The spec chose one copy per template, so keep the copies.
   - A cheap test that extracts the numbered items from each rendered prompt and asserts they are equal would stop drift when `handoff-self-check-evidence` rewords them.
8. **`gitGrep` treats any non-zero exit with empty stderr as "no matches".** `src/orchestrator/blast-radius.ts:108`. Cold-Claude, low confidence.
   - `gitSafeAtRaw` does not expose the exit status, and real git errors print to stderr, so the practical risk is negligible.
   - Optional.
9. **Pipeline telemetry docs are not excluded.** Cold-Claude.
   - The telemetry docs (`PIPELINE_TELEMETRY_FILES` in `src/orchestrator/worktree.ts:9`) log past task file names and identifiers, so they can appear as noise entries.
   - The spec's exclusion list is exact (Affected Files, `tasks/`, `linguist-generated`), and each noise file costs at most one slot per entry. This is not a defect against the spec. Treat it as a candidate follow-up, and don't change it in this task.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex): The map skips references for Affected Files that don't exist yet (`src/orchestrator/blast-radius.ts:174`). Spec-intended. Decision §2 says "for each Affected File that **exists as a regular file in the active checkout**, the tracked files that reference it." Cold-Claude flagged the same behavior with a reroute-deletion angle. That is cross-model agreement, and this explicit spec text is why it's dismissed. Worth reconsidering in a follow-up spec, not in this task.
- Dismissed (cold-Claude): Reference search skips deleted or renamed Affected Files on reroute. This is the same spec-intended behavior as the item above, with the same citation.
- Dismissed (cold-Claude): `resolveBlastRadiusRoot` calls `getActiveCwd`, which can `die()` outside the fail-open try/catch. `getActiveCwd` already runs earlier in the implement phase (`src/orchestrator/phases/implement.ts:89`), so this call adds no new exit path. AC-9 explicitly requires `getActiveCwd` at the prompt builders.
- Dismissed (cold-Claude): Reference heuristics are noisy for common basenames and stems, and `--pr` word-matches `--pr-foo`. This is the matching rule the spec chose (file-name match plus stem specifier, text matching only, no import graph). Noise is an accepted Known Risk, bounded by the caps.
- Dismissed (cold-Claude): Greps scan `tasks/` and `dist/` and filter afterwards. This is a performance preference with no observed cost problem, and the token cap bounds the grep count, as the Known Risks entry on performance accepts.
- Dismissed (cold-Claude): Map assertions read `goldens.*` rather than `actual`. The golden harness compares every golden to its rendered prompt, and AC-13's second plain `npm test` run passed unchanged, so a stale golden would fail there.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Required: Findings 1–4. Recommended in the same pass: Findings 5–7. Optional: Finding 8. Finding 9 is a follow-up, not for this task.

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.
-->

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Delta — base `d6125199f530ce165b39329d8586b54c518c50a1` — reason: small fix within the files already under review

Lenses: anchored-Claude (returned, `STAGE_1: pass`, signal approve), cold-Claude (returned on the delta, signal changes_requested), cold-Codex (injected, delta, no findings; reports the full suite passed).

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Unchanged. The new parity test (`tests/run-task-prompts.test.ts:497`) pins the three numbered items as identical across fresh, reroute and revisions. |
| AC-2 | Met | The unit test (`tests/blast-radius.test.ts:327`) now renders a real block containing both subsections and the truncation line, and runs the forbidden-term check on that block. |
| AC-3 | Met (unchanged from round 1) | `tests/blast-radius.test.ts` references fixture. |
| AC-4 | Met | `URLParser`, `JSONValue` and `HTTPServer` are now extracted and searched (`tests/blast-radius.test.ts:134-167`). |
| AC-5 | Met (unchanged from round 1) | Exclusion fixture. |
| AC-6 | Met | The byte-cap test asserts that entries survive, that some are dropped, and that the omitted count is exact (`tests/blast-radius.test.ts:240-245`). |
| AC-7 | Met (unchanged from round 1) | Fresh golden framing assertion. |
| AC-8 | Met | The fake `git` shim fails `grep` and `check-attr` one at a time after a real `rev-parse`. The anchored and cold-Claude lenses each confirmed by hand that the same fixture renders a non-empty block (367 bytes) when nothing fails, so both throw paths reach the outer catch. |
| AC-9 | Met (unchanged from round 1) | Only root-scoped git helpers are used. |
| AC-10 | Met (unchanged from round 1) | Goldens pass with the new token regex. |
| AC-11 | Met (unchanged from round 1) | `.gitattributes` untouched this round. |
| AC-12 | Met | The note moved next to the implement-prompt guidance (`docs/pipeline-orchestrator.md:515`) and names park-resume. The mirror is identical. |
| AC-13 | Met | Iteration 1's handoff re-ran only the two touched test files. Cold-Codex reports the full suite passed on this head, and the anchored lens re-ran both touched files (84/84). |

### Verifying Round 1 findings

- _correctness bug:_ Finding 1, the vacuous AC-2 neutrality test → addressed (`tests/blast-radius.test.ts:327`) ✓
- _risk/guardrail:_ Finding 2, the untested fail-open throw path → addressed (`tests/blast-radius.test.ts:251-296`). Both Claude lenses verified the throw paths are exercised ✓
- _risk/guardrail:_ Finding 3, the weak byte-cap assertion → addressed (`tests/blast-radius.test.ts:240-245`) ✓
- _risk/guardrail:_ Finding 4, acronym-led PascalCase → addressed (`src/orchestrator/blast-radius.ts:36`) ✓
- _nit:_ Finding 5, the doc note wording and placement → addressed ✓
- _nit:_ Finding 6, the test-only comment → addressed (`src/orchestrator/blast-radius.ts:10`) ✓
- _nit:_ Finding 7, the self-check parity test → addressed ✓
- _nit:_ Finding 8, the `gitGrep` exit status → deferred with a rationale (optional) ✓
- _follow-up:_ Finding 9, the telemetry-doc exclusion → correctly left out of this task ✓

### New findings (only NEW issues introduced by Iteration 1's changes)

#### Optional Cleanup / Nit

1. **The fail-open test has no positive control.** `tests/blast-radius.test.ts:262-292`. Flagged by 2 lenses (anchored and cold-Claude).
   - Nothing asserts a non-empty block when the shim passes every call through. If the shim broke later (for example `realGit` not resolving, or `node` missing), the test would quietly turn vacuous again.
   - It is not vacuous today: both lenses ran it and got a non-empty pass-through result. The failure mode is hypothetical, so this is a hardening nit, not a test-integrity defect.
   - Suggested fix: one pass with an unused fail command, asserting `block.length > 0`.
2. **The new shape regex also accepts plural acronyms.** `src/orchestrator/blast-radius.ts:36`. Flagged by 2 lenses.
   - `/[A-Z]{2,}[a-z]/` accepts backticked `IDs`, `URLs`, `APIs` and `PRs`, and the cold-Claude lens confirmed this with `extractSpecTokens`.
   - This is noise under the spec's Known Risks entry on token over-extraction, and bounded by the token cap. It is not a correctness defect.
   - Suggested fix: `/[A-Z]{2,}[a-z]{2,}/`, which keeps `URLParser`, `JSONValue` and `HTTPServer`.
3. **The expected omitted count is computed from `TOKEN_CAP`.** `tests/blast-radius.test.ts:245`, anchored lens.
   - It uses `TOKEN_CAP` rather than the fixture's `tokens.length`. Both are 20 today; `tokens.length` states the intent.
4. **The iteration's re-run validation lists only the two touched test files**, not the full `npm test`. Anchored lens.
   - Cold-Codex reports the full suite passed on this head, so AC-13 is satisfied.
   - The iteration section heading reads "Iteration 2 — addressing review round 1", where the template expects Iteration 1. Cosmetic.

### Dismissed Cold Findings

- Dismissed (cold-Claude): `realGit` resolution accepts a directory or non-executable named `git` and misses `git.exe` on Windows (`tests/blast-radius.test.ts:268-270`). The suite already relies on a POSIX shell shim (`#!/usr/bin/env node`, PATH prepending), and resolving the wrong candidate is the scenario nit 1's positive control would catch. That makes it a portability preference, not a defect.
- Dismissed (cold-Claude): `CANON_BLAST_RADIUS_ROOT` is honored unconditionally despite the "test-only" comment. The spec sanctions it: Judgment Calls, "Test seam for prompt goldens", and Non-Goals, "The test-only override from Judgment Calls is the one exception". It is the same pattern as `CANON_PATTERNS_MD_PATH`. Not introduced by this delta, and the comment matches the spec's intent.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
