# Code Review: recovery-command-fixtures

> Reviewer: Claude | Spec: `tasks/recovery-command-fixtures/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored (STAGE_1 pass, OVERALL_SIGNAL changes_requested), cold-Claude (COLD_OVERALL_SIGNAL approve, six low-severity findings), cold-Codex (no findings; reported that the focused tests and type check pass).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: registry covers every matching `src/` line | Pass | 56 entries (11 actionable, 45 exempt); real-tree registry test passes (anchored lens re-ran the file: 11/11 pass). |
| AC-2: chained fixture per emitting state | Partial | New fixtures exist for spec_gap FIX/BLESS, pre-flight auto-block, sanctioned redirect, spec-gate note; existing loop-cap and reviewer-block tests now extract the command from emitted text. Gaps: findings 1–3 below (spec-gate note never reaches code_review; new loop-cap entry fixtures bypass the emitter; sanctioned redirect `spec_review` form has no fixture). |
| AC-3: three injected red checks | Pass | `tests/recovery-hints.test.ts:465` asserts unregistered / stale / missing-title messages. |
| AC-4: round-sensitive amendment heading, red-first | Pass | `rerouteAmendmentHeading` (`src/orchestrator/main.ts:2714`) shared by the reroute pre-flight, the status reason and the console copy; per task in a bundle. Anchored lens independently reproduced the red-first failure against `main` ("expected `## Amendment Round 2`"). |
| AC-5: other wrong hints fixed red-first | Pass | Handoff states none other found; but see finding 4 (same message's scope note still names the bare heading). |
| AC-6: tests write only to temp fixtures | Pass | Before/after `git status --porcelain` identical per handoff; fixtures use `mkdtemp` + cleanup. |
| AC-7: BACKLOG entry updated | Pass | Parts (a) and (b) rewritten as specified. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

AC-2 is Partial on fixture-correctness grounds that are better expressed as Stage 2 test-integrity bugs; the anchored lens passed Stage 1 and I concur.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The production change is small and correct: one helper now computes the reroute amendment heading for both the gate and the hint, which is the right shape (patterns.md parameterized clause builder). The registry and its self-checks work. The problems are in fixture integrity: two fixtures claim emitting states they don't reach or don't exercise through the real emitter, one emitting form is uncovered, and the same spec_gap message still contradicts the corrected heading in its scope note. The new test file is also written as multi-thousand-character single lines, which is how finding 1 slipped through.

### Findings

#### Correctness Bugs

1. **[code-bug, test integrity] Spec-gate note fixture never reaches its `code_review` state, and its `qa` case runs from `human_review`** — `tests/recovery-hints.test.ts:474` (registry entry for `src/task/index.ts` `specGateDoneNote`). Source: anchored lens; foreman verified. `statusFor` creates `code_review.status: 'done'`; the `code_review` case leaves it done, so `deriveTopLevelStatus` (`src/orchestrator/state.ts:427`) puts the task at qa. The `qa` case sets `qa.status='done'`, landing at human_review. The hand-set `s.status=phase` is overwritten on write. So the registry's claimed coverage (code_review, qa, human_review) is really qa, human_review, human_review. Fix: for the `code_review` case set `code_review.status` to a non-done value (and verdict as an agent would leave it); for the `qa` case leave `qa` pending; assert the derived phase before running the note.
2. **[code-bug, test integrity] New loop-cap entry fixtures bypass the emitter** — `tests/recovery-hints.test.ts:476` ("spec loop cap at spec_review entry") and `:478` ("code loop cap at code_review entry"). Source: anchored lens; foreman verified. They hand-write a capped `status.json`, call `evaluateSpecReviewLoop` / `evaluateCodeReviewLoop` directly, and take the command from the evaluator's return value. The real entry-point emitters (`src/orchestrator/phases/spec-review.ts` / `phases/code-review.ts` cap checks) never run, no escalation is persisted and no console text is captured. Decision 3 requires capturing the emitted text from a state reached through canon's code; the handoff documents only the T6 deviation. Fix: drive these like the existing `run-task-safety` loop-cap tests — run `main()` (or the phase runner) at the capped state, read the command from the persisted escalation / console output, then run it.
3. **[code-bug] Sanctioned-redirect hint's `spec_review` form has no fixture** — `src/task/index.ts:374` (registry `tests/recovery-hints.test.ts:329-338`). Source: anchored lens; also the handoff's own `[ambiguity]` blocker. The hint interpolates `${phase}` and is emitted for both `spec_review` and `code_review`; AC-2 requires one covering test per emitting state. Fix: add a fixture that triggers `canon task phase <id> spec_review done sanctioned`, extracts the printed `canon task accept <id> spec_review --reason …`, runs it from that state, and asserts acceptance and outcome; list it in the entry's `covers`.
4. **[code-bug, stale restatement] The spec_gap message still names a bare `## Amendment` in its scope note** — `src/orchestrator/main.ts:3721` (status reason) and `:3745` (console). Source: cold-Claude; foreman verified. At `reroute_count >= 1` the FIX line now says `## Amendment Round N`, while the full-send scope note in the same message still says "add them to the spec's Affected Files (as an ## Amendment)". An operator following the scope note and then FIX gets `--reroute aborted … expected ## Amendment Round N`. This is a restatement of the contract AC-4 changed (AGENTS.md Code Review Rules). Fix: render the scope note from `amendHeadings` too, and rebuild `dist/`. (Note: these lines don't match the registry pattern, so no registry update is needed unless wording adds a matched command.)

#### Risk / Guardrails

- **`--reroute --step --expect` line exempted with a mismatched reason** — `src/orchestrator/main.ts:2968` (registry `tests/recovery-hints.test.ts:110-114`). Source: anchored lens. It prints after a reroute has already moved the task to spec_review/implement, where `--reroute` is refused; the handoff reads it as "how to invoke a reroute next time". I accept the exempt classification for this round (it is advice about invocation form, and Non-Goals bar rewording help-like text without a failing fixture), but the registered reason ("descriptive state, audit, or pointer text") should state the handoff's actual rationale. Non-blocking.
- **Exemption reasons are five boilerplate category strings** — `tests/recovery-hints.test.ts:12-436`. Source: anchored lens. Known Risks relies on "a reason the reviewer can check against the line"; consider a line-specific reason at least where the category is non-obvious (e.g. the item above). Non-blocking.
- **Minified test style** — `tests/recovery-hints.test.ts:438-479`. Source: anchored lens. Checker, helpers and fixtures are single lines up to several thousand characters, unlike the rest of `tests/`. Since findings 1–2 require editing these fixtures anyway, reformat the file to the repo's normal multi-line style in the same iteration. Non-blocking on its own.

#### Optional Cleanup / Nit

- Regex escape for covering-test titles omits `$` — `tests/recovery-hints.test.ts:441`. Flagged by 2 lenses (anchored, cold-Claude).
- Spec-loop-cap fixture's `assert.equal(runPrinted(...).status,0)` passes no diagnostic message (cold-Claude).
- rc1 FIX fixture checks only `spec_review.status`; also assert `reroute_count` became 2 and `review-prior-*.md` archived like the rc0 sibling (anchored).
- Pre-flight fixture runs reset before editing the handoff row, opposite of the hint's order; the follow-up is a direct `runCodeReviewPhase` with stubbed deps (documented T6 deviation; acceptable) (anchored).

#### Spec Gaps

(none) — the anchored lens tagged findings 2 and 3 as spec gaps; Decision 3 and AC-2 state the requirement plainly, so they are implementation gaps (code-bug).

### Dismissed Cold Findings

- Dismissed (cold-Claude): `runPrinted` adds `--step --expect <phase>` and `CANON_NO_DETACH=1`, so the printed bare `--reroute` is not what runs - spec Decision 3 explicitly permits bounding a run "by adding `--step --expect <phase>`"; the detach path is a transport concern, not part of the hint's acceptance.
- Dismissed (cold-Claude): coverage is checked by test title only, and the scan is line-literal over `src/` only - by design: Decision 2 calls the registry "a tripwire … not proof that a fixture is correct", and Known Risks "Literal-only scan" accepts the fragment gap; AC-7's BACKLOG text records it.
- Dismissed (cold-Claude): `amendHeadings` uses `taskIds.indexOf(id)` and would resolve duplicate ids to the first occurrence - duplicate ids carry identical state, so output is unchanged; no failure scenario.
- Cold-Codex: no findings to adjudicate.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

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

**Scope:** Full — base `main` — reason: delta line count 693 exceeds 400

Lens returns: anchored (STAGE_1 pass, OVERALL_SIGNAL approve, four nits), cold-Claude (COLD_OVERALL_SIGNAL changes_requested, one medium finding and six low ones), cold-Codex (no findings; reported that the targeted recovery-hints suite passes).

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the handoff's Iteration 2 Validation Outcomes table has no Fail results, and all six required checks were run (build, type-check, lint, full `npm test` with 1,574 passing and 1 pre-existing skip, docs-refs-check, sync-templates:check).

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | 56 entries (11 actionable, 45 exempt). The sanctioned-redirect entry covers both forms, and the alternate-invocation exemption now has a line-specific reason. |
| AC-2 | Met | Round 1 findings 1–3 are fixed in code (see below). The anchored lens re-ran 13/13 recovery-hints tests. |
| AC-3 | Met | The three injected red checks are at `tests/recovery-hints.test.ts:762`. The title escape now covers `$`. |
| AC-4 | Met (unchanged from round 1) | rc0/rc1 fixtures pass. Red-first was reproduced in round 1. |
| AC-5 | Partial | The scope-note heading defect from round 1 was fixed red-first. The anchored lens confirmed this by running HEAD's tests against the 1df6303 source. However, the replacement heading is wrong for the BLESS path (finding 1 below). |
| AC-6 | Met | Before/after porcelain is empty per the handoff. The anchored lens's own run left the tree clean. |
| AC-7 | Met (unchanged from round 1) | |

### Verifying Round 1 findings

- _code-bug 1:_ "Spec-gate note fixture never reaches code_review, and the qa case runs from human_review" → addressed. Each case sets phase statuses so that the derived phase is code_review, qa or human_review, and asserts `derive(...) === phase` before emitting (`tests/recovery-hints.test.ts:1001-1028`). ✓
- _code-bug 2:_ "Loop-cap entry fixtures bypass the emitter" → addressed. `runLoopCap` drives `main()` with `--step --expect <phase>` and `MAX_REVIEW_LOOPS=3`. The fixtures extract the command from the persisted escalation, assert the console copy, and run it (`:1030`, `:1059`). ✓
- _code-bug 3:_ "Sanctioned redirect `spec_review` form has no fixture" → addressed. The new fixture at `:899` extracts the command from stderr, runs it, and asserts sanctioned + `operator_accepted` + derived phase `plan`. It is listed in the registry `covers`. ✓
- _code-bug 4:_ "Scope note still names a bare `## Amendment`" → the stated defect (contradiction with the FIX line) is addressed, with a fixture at `:819`. But the fix introduced finding 1 below. Round 1's fix suggestion ("render the scope note from `amendHeadings` too") pointed at the wrong heading; the implementation followed it.
- Non-blocking round 1 items (exemption reason, minified style, `$` escape, missing diagnostic message, rc1 assertions, pre-flight order): all addressed per the Iteration 2 "Additional review cleanup" list. Spot-checked by the anchored lens. ✓

### New findings

#### Correctness Bugs

1. **[code-bug] The BLESS-path scope note now names the next human reroute heading, which pre-satisfies a later `--reroute`.** `src/orchestrator/main.ts:3721` (status reason), `:3745` (console) and the `dist/orchestrator/run-task.js` mirror. Source: cold-Claude. Foreman verified against `src/orchestrator/validation.ts`:
   - The Affected Files parser reads every `^## Amendment\b` section (`validation.ts:1128`), so any `## Amendment…` heading admits the files.
   - `verifyRerouteAmendment` deliberately excludes `FULL_SEND_SCOPE_AMENDMENT_HEADING = '## Amendment (full-send scope)'` (`validation.ts:330-331`, comment at `:354-356`: scope sections "are not human reroute amendments and must not satisfy this gate").
   - The note now tells the operator to add the files "under `## Amendment Round N`" (the `rerouteAmendmentHeading` value) before blessing.
   - Scenario at `reroute_count: 1`: the operator adds `## Amendment Round 2` for scope, then BLESSes. BLESS does not bump `reroute_count`. Later, `--reroute` from human_review requires Round 2, finds the scope-only section and passes with no new amendment. spec_review then treats the scope list as the round-2 amendment.
   - At round 1 the old bare `## Amendment` text had the same flaw. The new wording makes the hint exact at every round, so operators are more likely to follow it.
   - **Fix:** have the scope note (both copies) name `## Amendment (full-send scope)` (import `FULL_SEND_SCOPE_AMENDMENT_HEADING`) instead of `amendHeadings`. Keep the per-task `tasks/<id>/spec.md` pointer if useful. Update the `:819` fixture to assert that heading, and assert that the reroute heading does not appear in the scope note.
   - **Strengthen the fixture:** after writing the named section and running BLESS, assert that `verifyRerouteAmendment` (or a later printed `--reroute`) still requires a fresh amendment.
   - Rebuild `dist/`.

#### Optional Cleanup / Nit

- The scope-note map expression is duplicated verbatim in the reason and console copies (`main.ts:3721`, `:3745`). Hoist it into one local `const` while applying the fix above (anchored).
- The scope note attributes headings only to the spec_gap tasks, while `specGapScopeFiles` is bundle-wide (anchored). This is moot once the note names the fixed full-send-scope heading. If the per-task pointer is kept, it may point at the wrong spec for a sibling's file. The old text named no spec at all.
- Spec-gate fixture `code_review` case: `status: 'pending'` with an inherited `verdict: 'approved'` is a pairing no agent leaves (`tests/recovery-hints.test.ts:1009-1012`). It does not affect the result (anchored).
- In `emitSpecGap`, the escalation reason is read only from `statuses[0]`. The bundle test doesn't check `ok-b`'s escalation (cold-Claude).
- In the existing reset-command extraction (`tests/run-task-code-review.test.ts:1099`, `tests/run-task-safety.test.ts:8045`), the subcommand name is captured from a literal group, so only the id is truly derived. Harmless (cold-Claude).

### Dismissed Cold Findings

- Dismissed (cold-Claude): the spec-gate "already done" note in `src/task/index.ts` says "add an amendment" with no round-specific heading. The spec's Problem section judges `specGateDoneNote` "not wrong but gives no round", and AC-4 scopes the heading fix to the spec_gap FIX hint only. The command it names is accepted. This could be a follow-up, but it is outside this task's ACs and not a wrong hint.
- Dismissed (cold-Claude): `checkHintRegistry` checks coverage by test title only. Same as round 1: Decision 2 makes the registry "a tripwire … not proof that a fixture is correct".
- Dismissed (cold-Claude): `runPrinted` appends `--step --expect` and sets `CANON_NO_DETACH`. Same as round 1: Decision 3 explicitly permits bounding a run "by adding `--step --expect <phase>`".
- Dismissed (cold-Claude): the line scan misses fragment-built hints and other commands, and the test name overstates this. Known Risks "Literal-only scan" and Non-Goals accept it, and AC-7's BACKLOG text records it.
- Cold-Codex: no findings to adjudicate.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

## Round 3 — verifying iteration 2's response to round 2

**Scope:** Delta — base `37ddaa285942b8e6878a1137ef7a7a27fb244f3e` — reason: small fix within the files already under review

Lens returns: anchored (STAGE_1 pass, OVERALL_SIGNAL approve, three nits), cold-Claude (COLD_OVERALL_SIGNAL changes_requested; two medium findings, three low ones), cold-Codex (no findings; type-check and build pass).

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: the handoff "Iteration 3 — addressing review round 2" section records passing checks. The anchored lens re-ran the recovery-hints suite: 13/13 pass.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 2) | 56 entries: 11 actionable, 45 exempt. |
| AC-2 | Met | 13/13 recovery-hints tests pass on HEAD (anchored lens run). |
| AC-3 | Met (unchanged from round 2) | |
| AC-4 | Met (unchanged from round 2) | |
| AC-5 | Met | The scope note's reason (`src/orchestrator/main.ts:3723`) and console copy (`:3747`) both use `fullSendScopeAction`, which is built from `splitValidation.FULL_SEND_SCOPE_AMENDMENT_HEADING`. `dist/` was rebuilt. The fixture at `tests/recovery-hints.test.ts:819` writes the emitted heading, runs the printed BLESS, then runs the printed `--reroute` and asserts that it is refused with "expected heading: ## Amendment Round 2". Red-first evidence is in Iteration 3. |
| AC-6 | Met | Empty before/after porcelain per the handoff. The anchored lens run added no paths. |
| AC-7 | Met (unchanged from round 2) | |

### Verifying Round 2 findings

- _code-bug 1:_ "BLESS-path scope note names the next human reroute heading, which pre-satisfies a later `--reroute`" → addressed (`main.ts:3718-3723`, `:3747`; fixture `:819`). ✓

### New findings

No correctness bugs or spec gaps survive. Round 3 discipline applies, so nits don't drive the verdict.

#### Non-blocking (follow-up recommended)

- **The scope note doesn't say the files go in a `### Affected Files` table inside the amendment section.** `src/orchestrator/main.ts:3718`. Source: cold-Claude (medium/high). Foreman verified that `validation.ts:1127-1135` reads `## Amendment\b` bodies through `parseAllTablesH3(body, 'Affected Files')`, so a bare table directly under `## Amendment (full-send scope)` is not admitted. The claim holds against the code, but it is not a regression from this task:
  - The pre-task hint on `main` ("add them to the spec's Affected Files (as an ## Amendment)") was equally silent on the H3.
  - The new text, "add them to Affected Files under ## Amendment (full-send scope)", names the Affected Files table and is no less clear.
  - The line is not one of the four registry commands.
  
  This is a cheap clarity improvement: "…in a `### Affected Files` table under `## Amendment (full-send scope)`". Take it in a follow-up or alongside the nits. It does not block this task.
- **Related fixture realism.** `tests/recovery-hints.test.ts:836` appends a table without the `### Affected Files` H3. Source: cold-Claude, which tagged it test integrity (medium). Not adjudicated as test integrity: the test's title and assertions claim only that the scope heading "does not satisfy a later reroute", and that holds whatever form the table takes. It doesn't claim that the hint clears scope. Using the H3 form would make the fixture realistic, and an added scope-clear assertion would cover the other half of the hint's promise (anchored lens raised the same coverage gap as a nit). Flagged by 2 lenses as a coverage gap.

#### Optional Cleanup / Nit (folded)

- The scope note no longer names the target `tasks/<id>/spec.md`. The allowlist is bundle-wide, so any member's spec works. Flagged by 2 lenses (anchored, cold-Claude).
- Move the `includes(scopeHeading)` / `doesNotMatch(Round 2)` assertions ahead of the BLESS/reroute runs for clearer failures. Flagged by 2 lenses (anchored, cold-Claude).

### Dismissed Cold Findings

- Dismissed (cold-Claude): the scope and FIX advice point at two different `## Amendment…` headings in one block, which may confuse operators. This is intended: the reroute gate (`validation.ts:331`) and the scope parser (`:1128`) deliberately treat the two headings differently, and both parse correctly. Wording preference only.
- Cold-Codex: no findings to adjudicate.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
