# Code Review: reroute-from-implement

> Reviewer: Claude | Spec: `tasks/reroute-from-implement/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Reviewed HEAD: `531de25`. This is the first review of a fresh loop after the second human reroute (Amendment Round 2). Earlier loops are archived in `tasks/reroute-from-implement/review-prior-1.md` and `tasks/reroute-from-implement/review-prior-2.md`.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification (E2E is N/A per the spec)
- [x] Red-first evidence recorded for each red-first AC: AC-1 loop-cap and route-back at `d6c00c3`, AC-A6 at `f17a1d5`, and AC-B4 at `80b7023`, each run with test-only edits and with a failure excerpt matching the reason the spec gives.

Re-runs by the anchored lens: `npm run build` (dist/ stayed byte-clean), `npm run type-check`, `npm run lint`, `npm run sync-templates:check`, `npm run docs-refs-check`, and the targeted suites (`run-task-reroute-preflight`, `run-task-prompts`, `task-cli`, `recovery-hints`, `run-task-code-review`). All passed; the targeted suites ran 349/349.

**Not re-verified by any reviewer: the full `npm test`.** The anchored lens did not run it. Cold-Codex's run was interrupted: 1,341 tests passed and 2 were cancelled, so those 2 are unverified. The handoff reports 1,720 tests: 1,719 pass, 1 skipped, 0 fail.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Admission matrix | Pass | Every implement-entry admit row plus code_review/qa/human_review, for both tiers. Reject rows assert `status.json` is byte-unchanged. Red-first rows are recorded. |
| AC-2: Bundle rule | Pass | The reject fixture uses different branches, so AC-B1 doesn't admit it. Started-bundle admit and mixed spec_gap non-exempt rows are present. |
| AC-3: Single predicate | Pass | `isRerouteAdmitted` in `src/orchestrator/state.ts:451` is called from `main.ts` and `src/task/index.ts`. `REROUTE_ADMITTED_PHASES` has 0 hits. |
| AC-4: Real loop-cap fixture | Pass | Implement-entry loop-cap row added. The code_review-phase row is relabelled. |
| AC-5: Reset from implement entry | Pass | Reset assertions per admit row, both tiers. |
| AC-6: Operator text names sub-state | Pass | Banner and rejection summary show the sub-state. Full rule sentence. `buildCodeReviewReason` names `--reroute` (`src/orchestrator/review-loop.ts:109`). |
| AC-7: Spec-gate note | Pass | Opposite-outcome cases are in `tests/task-cli.test.ts`. |
| AC-8: Wording sweep | Pass | The anchored lens re-ran the four greps: 0 non-exempt hits. |
| AC-9: Prompt scope / partial round | Pass | Fresh and resumed implement-reroute and plan-reroute meet (a)–(d). |
| AC-10: Golden scoped | Pass | Against `main`: one key added (`promptImplementReroute_resumed`); only the 6 permitted keys changed. |
| AC-11: Docs and help | Pass | All listed surfaces updated. The recovery-hints test passes. |
| AC-12: Decision recorded | Pass | `docs/decisions.md` entry present. |
| AC-13: Mirrors and dist | Pass | `sync-templates:check` passes. A rebuild leaves `dist/` clean. |
| AC-A1: Auto-commit wording | Pass | Tracked and untracked omissions are distinguished, and obsolete leftovers are to be deleted. See nit N3 for an edge case. |
| AC-A2: Loop-cap recovery restatements | Pass | `--reroute` is offered only for a code_review block (recovery.md Path C, `docs/pipeline-orchestrator.md`). |
| AC-A3: Red-first partial rounds | Pass | Literal requirements met. Finding F1 concerns the order of the set-aside steps. |
| AC-A4: Prompt nits N1–N3 | Pass | Step 7 wording, session-scoped "not a resume", `### Round Scope`. Parsed headings unchanged. |
| AC-A5: Operator-text consistency | Pass | Qualifiers aligned, README clauses split, `code_review missing` tested. |
| AC-A6: Legacy counter fallback | Pass | Red-first row at `f17a1d5`. The all-absent reject row is kept. |
| AC-A7: Test robustness | Pass | Explicit `expectedPhase`; banner detail clauses asserted. |
| AC-A8: Whitespace | Pass | Verified. |
| AC-A9: Regression gates | Pass | Gates re-run (the full suite is the exception above). |
| AC-B1: Shared-branch sibling admission | Pass | `rerouteAdmissions` (`src/orchestrator/main.ts:2807`) requires a single-predicate anchor on the same non-blank branch, and siblings can't vouch for each other. The admit row and all reject rows are present, and the rejects assert unchanged status. The downstream test calls the real `verifyHandoffAgainstDiffFromData` / `buildAffectedFilesAllowlist` / `verifyBaseDriftFromData` with distinct A and B files. |
| AC-B2: Single-task next step | Pass | Branches on `implement.rerouted`. Tested both ways. |
| AC-B3: Rule documented | Pass | Docs, SKILL, and decisions updated. The rejection lists Qualifying / Not qualifying and is tested to contain no split advice. |
| AC-B4: Archived findings pointer | Pass | `archivedReviewGuidance` is on every non-exempt line in both builders, picks the highest-numbered archive, and adds nothing when there is no archive. Red-first recorded. |
| AC-B5: Untracked set-aside | Pass (literal) | Untracked leftovers are moved out, copies confirmed before the red run, everything restored after. Finding F1 concerns the order. |
| AC-B6: Single review-round source | Pass | The grep finds only the helper and the out-of-scope generic `phaseIterationCount`. Null and invalid inputs are tested. |
| AC-B7: Wording / cosmetic nits | Pass | Items (1), (2), (6), (7), (8) and (9) verified, and (8) is tested. `assert.doesNotMatch(... /or implement once implementation has begun/)` guards the old wording, which `80b7023` contained at `main.ts:2829`. |
| AC-B8: Bundle admit asserts state | Pass | Post-reroute fields and banners asserted for both tasks. |
| AC-B9: Regression gates | Pass | Against `80b7023`, only `promptImplementReroute` and `promptImplementReroute_resumed` changed. Other gates pass (full suite: see above). |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work): no reset-*, accept, autoCommit or schema changes, and no git operations added to `--reroute`.
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The Amendment Round 2 work is well built:
- The sibling clause is tightly bounded: an individually admitted anchor, exact non-blank branch match, and no mutual vouching.
- The shared review-round helper is used consistently.
- Tests exercise the real downstream gate functions rather than mocks.

All three lenses agree the routing logic is correct. One finding survives as a code bug. It is a safety-ordering defect in the new red-first set-aside instruction: the agent is told to overwrite the aborted round's uncommitted edits before confirming the backup exists. Everything else is either a nit, or a pre-existing or spec-literal observation to triage as a follow-up.

### Findings

#### Correctness Bugs

- **F1 (`code-bug`; cold-Claude; verified) — The red-first set-aside step confirms the backup only after the destructive restore.** At `src/orchestrator/prompts/templates/implement-reroute.md:28` the instruction says to "copy tracked leftovers to a temporary directory and restore their paths to committed contents, … Confirm every set-aside copy exists before the red run."
  - **The problem:** in that order the agent copies, then restores the paths (discarding the working-tree edits), and only then checks the copies. If a copy failed or went to the wrong place, the aborted round's uncommitted edits are already gone; they exist nowhere else. `docs/patterns.md` Safe-First rule 1 applies to data-affecting flows.
  - **Fix within AC-B5:** confirm each copy (tracked) and each moved file (untracked) exists before restoring or removing its worktree path. "Before the restore" is also before the red run, so AC-B5's wording is still met.
  - **Then:** regenerate the affected golden keys (`UPDATE_GOLDENS=1`) and rebuild `dist/`.

#### Risk / Guardrails

- **R1 (`risk/guardrail`, non-blocking, pre-existing class; cold-Claude; verified) — Rerouting a subset of a shared-branch bundle is not prevented.** `rerouteAdmissions` only looks at the named tasks. `canon run A --reroute` therefore admits A at implement `in_progress` or `blocked` even when unnamed bundle member B shares A's task branch. The reroute archives review.md, bumps `reroute_count` and resets status, and the run then fails later at the handoff-coverage and Affected Files checks.
  - **Not a bug in this diff:** the same gap exists on `main` for bundle members at code_review/qa/human_review. Amendment Round 2 deliberately chose to document this ("name every task of a shared-branch bundle in one reroute") rather than enforce it.
  - **What changed:** admitting implement-entry states makes it more reachable, because an interrupted bundle implement is exactly the shared-branch case.
  - **Recommendation:** open a follow-up issue for a pre-flight that rejects a reroute naming only part of a set of tasks sharing a branch. Enforcement is a new gate, and adding one is a design decision rather than a fix for this round.

#### Optional Cleanup / Nit

- **N1 (anchored + cold-Claude) — The "approved sibling" wording is narrower than the code.** Help, README, SKILL, docs and the rejection text all say "approved sibling". `rerouteAdmissions` (`src/orchestrator/main.ts:2809-2818`) checks no verdict, which matches AC-B1's criteria, so any implement-pending, zero-activity task on the anchor's branch qualifies. The rejection also lists sibling-clause tasks under "Qualifying:", right after a sentence that separates siblings from "a task that qualifies". Consider rendering them as "Admitted as sibling:" and dropping "approved", or saying "an implement-pending sibling".
- **N2 (anchored) — `some()` without a justifying comment.** The anchor check uses `entries.some(...)` (`src/orchestrator/main.ts:2816`). `docs/patterns.md` (bundle gates use `every()`, not `some()`) asks that any `some()` be justified. `some()` is correct here per AC-B1; add a one-line comment.
- **N3 (cold-Claude; verified; spec-literal per AC-A1) — "Blocks auto-commit" is not true in every case.** In `autoCommitCode`, the early returns when no handoff-listed file is dirty skip `findUncoveredTrackedChanges` (`src/orchestrator/main.ts:671-675` and the `toStage.length === 0` return). An omitted dirty tracked leftover therefore stays uncommitted until the QA-end check instead of blocking. Consider qualifying the sentence ("blocks the auto-commit when there are changes to commit").
- **N4 (anchored + cold-Claude) — The archive pointer can carry stale or optional findings.** `archivedReviewGuidance` (`src/orchestrator/prompts/index.ts:513`) always names the newest archive. On a first-pass implement-entry reroute, review.md is still the unfilled template and is not archived, so the pointer can name an earlier loop's archive. An archived `approved_with_nits` review's nits also read as "binding". This matches AC-B4's wording, and "unresolved" softens it. Consider "unresolved blocking findings" in a later pass.
- **N5 (anchored) — Malformed status: no `implement` entry but code_review `blocked`.** This state is now admitted, but the reset loop skips the missing entry, so `rerouted` and `reroute_count` are never written. It can only be reached by hand-editing `status.json`. Consider requiring an `implement` entry when the predicate admits via `code_review.status === 'blocked'`.
- **N6 (anchored + cold-Claude) — Other counter readers still use raw `?? 0`.** `shouldUseImplementRevision` (`src/orchestrator/phases/implement.ts:29`), `review-loop.ts`, `code-review.ts`, and `codeReviewTotal` don't go through the normalizing `currentLoopCount`. This is harmless today because `validateStatus` rejects non-integer counters, and AC-B6 scopes these readers out. The same `validateStatus` guard makes the helper's null and NaN branches, and the matching `docs/decisions.md` sentence, defensive-only.
- **N7 (anchored) — `docs/architecture.md` doesn't list the new loop-cap recovery path.** Its "Auto-block / reroute" bullet lists only raising the cap and reset-*, not the code_review `--reroute` path. `docs/codebase-map.md` still places reroute only in `main.ts`. Neither file is in Affected Files; the spec's Docs Impact hands codebase-map to QA. Flagged for QA's docs pass.
- **N8 (cold-Claude) — Small text gaps:**
  - The loop-cap reason (`src/orchestrator/review-loop.ts:109`) doesn't say to amend the active task directory's (worktree) copy of `spec.md`.
  - The README row says "an `## Amendment` section", which omits `## Amendment Round N` and spec_gap-exempt siblings. This is pre-existing wording.
  - The spec-gate note offers `--reroute` for implement `in_progress`, which `guardConcurrentRun` refuses while the run is live. AC-7 requires the note.
  - The AC-B2 mid-reroute hint resumes implement, so a revised amendment skips spec_review. This is spec-literal.

#### Spec Gaps

(none blocking)

Low-severity observation, not verdict-driving: a task admitted through the sibling clause is a non-exempt reroute, so it needs its own Amendment section. Neither the sibling-clause docs nor the rejection message say so; the operator first learns it from the amendment pre-flight abort, which is loud and recoverable. Consider one sentence in §"Human Reroute" in a follow-up.

### Dismissed Cold Findings

- Dismissed (cold-Claude): Red-first against committed HEAD gives a spurious `[wrong-premise]` after route-back rounds have already committed the fix — the trigger in the prompt is a red-first AC "unfinished because the prior round was partial". A fix that is already committed is not unfinished work, and carried-forward rows that satisfy their AC are kept without a re-run. Low confidence, and it doesn't hold against the prompt text.
- Dismissed (cold-Claude): `assert.doesNotMatch(result.stderr, /or implement once implementation has begun/)` can never fail — wrong. That text was in the rejection message at `80b7023` (`src/orchestrator/main.ts:2829`), and AC-B7(6) removed it, so the assertion is a valid regression guard.
- Dismissed (cold-Claude): The shared-branch sibling test "records the gap instead of testing a guard" — AC-B1 asks this test to confirm that the whole-bundle recovery passes the downstream gates, and it does so by calling the real gate functions. The partial-bundle gap it shows is tracked as R1.
- Dismissed (cold-Claude): The sibling predicate rejects a sibling with a missing `implement` or `code_review` entry even though its derived phase is implement — it only affects malformed status, and failing closed is the safe direction for an admission gate.
- Cold-Codex: no actionable defects reported, so nothing to dismiss. Its interrupted test run (2 tests cancelled) is recorded in the Validation Gate above as unverified, not as a pass.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Blocking: **F1** only. R1 and N1–N8 are non-blocking. R1 should become a follow-up issue rather than more scope in this round.

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->

## Round 2 — verifying iteration 2's response to round 1

**Scope:** Full — base `main` — reason: delicate

Reviewed HEAD: `b46d23c` (round 1 reviewed `531de25`). The handoff section is `## Iteration 2 — addressing review round 1`.

### Stage 1 — Acceptance Criteria Re-Check

Validation gate: Iteration 2's re-run table has no `Fail` rows. Red-first evidence was read across the whole handoff:
- baseline rows for AC-1 (`d6c00c3`), AC-A6 (`f17a1d5`) and AC-B4 (`80b7023`);
- the Iteration 2 row for F1/AC-B5 against `531de25`. The anchored lens reproduced it: both new ordering tests fail on a `531de25` snapshot with only the test applied.

Checks the anchored lens re-ran this round, all passing:
- the full `npm test`: 1722/1722 pass, 0 skipped, 0 cancelled. This closes round 1's "full suite not re-verified" gap.
- `npm run lint`, `npm run type-check`, `npm run sync-templates:check`, `npm run docs-refs-check`.
- `npm run build`: `dist/` stays clean.
- golden key compares. Against `531de25`, only `promptImplementReroute` and `promptImplementReroute_resumed` changed. Against `main`, one key was added and only the 6 permitted keys changed.

Cold-Codex also reports type-check, tests, template sync and build as completing successfully.

| AC | Status | Notes |
|---|---|---|
| AC-1 – AC-8 | Met (unchanged from round 1) | The routing, predicate, tests, operator text and wording sweep are untouched by this iteration. The full suite passes. |
| AC-9 | Met | Only the red-first paragraph changed. (a)–(d) still hold in the fresh and resumed goldens. |
| AC-10 | Met | Against `main`: one key added, and only the 6 permitted keys changed. |
| AC-11, AC-12 | Met (unchanged from round 1) | Docs, help, recovery hints and the decision entry are unchanged. |
| AC-13 | Met | `sync-templates:check` passes, and a rebuild leaves `dist/` clean. |
| AC-A1, AC-A2 | Met (unchanged from round 1) | |
| AC-A3 | Met | Partial-round coverage, the rule to keep carried-forward rows, the isolated pre-fix run, the escape clause and the `[wrong-premise]` clause are all intact. The F1 ordering is fixed. |
| AC-A4 – AC-A8 | Met (unchanged from round 1) | |
| AC-A9 | Met | The golden diff against the round-1 implementation commit touches only reroute keys. All gates pass. |
| AC-B1 – AC-B3 | Met (unchanged from round 1) | B1 logic is unchanged; only a comment was added at `src/orchestrator/main.ts:2816`. |
| AC-B4 | Met (unchanged from round 1) | The pointer is on every non-exempt line in both builders (`src/orchestrator/prompts/index.ts:288`, `:467`). See nit N9. |
| AC-B5 | Met | `src/orchestrator/prompts/templates/implement-reroute.md:28` now orders the steps: copy every leftover, verify each copy exists and matches, only then restore tracked paths and move untracked files, confirm before the red run, restore everything after. Pinned for both variants at `tests/run-task-prompts.test.ts:447-462`. |
| AC-B6 – AC-B8 | Met (unchanged from round 1) | |
| AC-B9 | Met | Golden changes against `531de25` are limited to the two implement-reroute keys. All gates pass. |

### Verifying Round 1 findings

- _correctness bug:_ "F1 — the red-first set-aside step confirmed the backup only after the destructive restore" → addressed. `src/orchestrator/prompts/templates/implement-reroute.md:28` now verifies every copy before changing any worktree path. The fix is red-first tested on both prompt variants, and `dist/` is rebuilt. ✓ (anchored lens; cold-Claude raised no ordering issue this round)
- _optional cleanup/nit:_ "N2 — `some()` without a justifying comment" → addressed at `src/orchestrator/main.ts:2816`. ✓
- _risk/guardrail (non-blocking):_ "R1 — no guard against rerouting part of a shared-branch bundle" → still open as designed, and recorded in the handoff and notes as a follow-up. Cold-Claude flagged it again (medium/high). It stays non-blocking for the round 1 reasons:
  - the same gap exists on `main` for code_review/qa/human_review members;
  - Amendment Round 2 deliberately chose to document it rather than enforce it;
  - enforcing it is a new gate, which is a design decision.

  **Recommend opening a follow-up issue.**
- _optional:_ N1 and N3–N8 → deferred as optional. Cold-Claude raised N1 (the "approved" sibling wording), N3 (auto-commit "blocks" wording), N4 (archive staleness) and N6 (the `validateStatus`-unreachable null handling, and raw `?? 0` readers) again. None got worse this iteration.

### New findings (only NEW issues introduced by Iteration 2's changes)

No blocking findings. Non-blocking nits:

- **N9 (cold-Codex P2; anchored assessed; verified; non-blocking) — the archive pointer has no "read it" step.** The per-task line from `archivedReviewGuidance` (`src/orchestrator/prompts/index.ts:513`, rendered at `:467` and `:288`) names `review-prior-<n>.md` and says its unresolved findings remain binding.
  - **What's missing:** no numbered step tells the agent to open that file. The scope definitions (implement-reroute steps 4 and 7, plan-reroute step 6) list only the amendment plus unfinished original or earlier-amendment work. The exempt-sibling line, by contrast, does say "read that file and address ALL findings".
  - **Why non-blocking:**
    - AC-B4 requires the prompt to point at the archive and state that it is binding, and the implementation does that.
    - Implement-reroute step 1 tells the agent to work from the task's entry line, where the pointer sits.
    - The next code review sees the archive.
    - The code is unchanged since `531de25`, which round 1 passed for AC-B4.
  - **Suggested fix, together with N4 (archive staleness):** add a read verb to `archivedReviewGuidance`, and fold "unresolved findings in the archived review named in its entry" into implement step 4 and plan step 6. Scope it to an archive this reroute created, or to blocking findings only, so stale archives and nits-only archives don't add noise.
- **N10 (anchored + cold-Claude) — the set-aside doesn't cover tracked files the aborted round deleted or renamed.** There is nothing to copy, so restoring to HEAD brings the file back, and "restore every set-aside file" never re-applies the deletion. No content is lost; HEAD's copy comes back. This was already true at `531de25` and is a rare edge case, but it could be stated explicitly.
- **N11 (anchored) — two rough edges from this iteration's fix:**
  - Untracked leftovers are now copied and then also "moved out" to unnamed destinations. Once the copy is verified, the second step only needs to remove the file from the worktree.
  - The new ordering test pins verify-before-clear, but not confirm-before-red-run or restore-after. Only the golden pins those two.
- **N12 (cold-Claude) — the mid-reroute hint can be wrong for a past reroute.** The AC-B2 hint chooses its wording from `implement.rerouted === true`. A task that was rerouted in the past and later rejected alone as a sibling could get the "mid-reroute" variant. The hint's trailing "name every bundle task in one reroute" sentence covers the realistic case, and AC-B2's own wording uses that flag.
- **N13 (cold-Claude) — the QA "Human reroute?" definition is stale.** `src/orchestrator/prompts/templates/qa.md:58` still defines it as a rejection at human_review. This was already inaccurate before the task, because reroute was admitted from code_review and qa. The spec explicitly kept it unchanged (Non-Goals: "No change to the `Human reroute?` quality-log metric … or the QA prompt's answer guidance"). It's a candidate for a follow-up together with R1.

### Dismissed Cold Findings

- Dismissed (cold-Claude): "`isRerouteAdmitted` admits implement `in_progress`/`blocked` even when a session failed before any edits" — this is the behaviour the spec chose.
  - Spec Decision 1 and the AC-1 admit rows list implement `in_progress` and `blocked` unconditionally.
  - The spec Problem item 2 names agent-session-failure blocks as a motivating case.
  - Rerouting such a task is a human decision, and the result is a clean re-entry at spec_review or implement.
- Dismissed (cold-Claude): "Sibling branch comparison trims for emptiness but compares untrimmed" — it fails closed (it rejects), and in practice it can't happen: `ensureBranch()` writes the identical branch string into every bundle member.
- Cold-Codex's single finding is kept as N9 (verified, ranked non-blocking), not dismissed.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

F1 is fixed with red-first evidence, and the full suite passes (1722/1722). The remaining items are non-blocking:
- **Follow-up issues recommended:** R1 (guard against rerouting part of a shared-branch bundle), N9 together with N4 (the archive pointer), and N13 (the QA metric definition).
- **Optional:** the rest of the nits.
