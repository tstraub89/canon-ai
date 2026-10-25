# Code Review: reroute-from-implement

> Reviewer: Claude | Spec: `tasks/reroute-from-implement/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored-Claude `STAGE_1: pass`, `OVERALL_SIGNAL: approve` (12 Stage 2 items, all low/medium); cold-Claude `COLD_OVERALL_SIGNAL: changes_requested` (10 items); cold-Codex no actionable defects. All three lenses returned valid output.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification (E2E is N/A per spec)
- [x] Red-first evidence recorded for each red-first AC (AC-1 loop-cap and route-back rows, run against base `d6c00c3` with test-only edits)

Independent re-verification by the anchored lens: lint, type-check, the five changed test files (315/315), `npm run build` reproducing `dist/` with no git diff, `npm run sync-templates:check`, golden key-level compare against `d6c00c3`, and the AC-8 greps. Its full `npm test` run showed 2/1686 failures in `tests/run-task-ship.test.ts` (`--ship legacy fallback proves merged PR by ancestor-or-equal head`, `--ship creates absent shared docs from fragments…`) that pass when re-run in isolation; the diff does not touch `--ship` code. Treated as load-sensitive flakes, not a finding; not baseline-checked against `main`. The handoff's own full-suite run was clean.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Admission matrix | Pass | `isRerouteAdmitted` (`src/orchestrator/state.ts:446`) called from `src/orchestrator/main.ts:2816`. All five implement-entry admit rows plus code_review/qa/human_review rows, each for M and XS; reject rows (zero counters, absent counters, plan, spec_review, spec, complete) assert `status.json`/`review.md` byte-unchanged. Red-first rows recorded. |
| AC-2: Bundle rule | Pass | Reject-unstarted, admit in_progress+human_review, and mixed spec_gap + loop-cap requiring amendments on both, in `tests/run-task-reroute-preflight.test.ts`. |
| AC-3: Single predicate | Pass | `grep -rn REROUTE_ADMITTED_PHASES src/` → zero hits; `src/task/index.ts` imports the predicate; direct predicate unit rows cover each implement sub-state. |
| AC-4: Real loop-cap fixture | Pass | New "implement-entry loop-cap auto-block (implement pending, code_review blocked, verdict empty)" row; old row relabelled "code_review-phase auto-block (blocked changes_requested)". |
| AC-5: Reset from implement entry | Pass | Admit rows assert implement pending/rerouted/count+1, code_review pending/'' verdict/both counters 0, derived next phase spec_review (M) vs implement (XS). |
| AC-6: Operator text | Pass | Banner sub-state prefix asserted per admit row; rejected implement-pending text and full rule sentence asserted; loop-cap reason asserted in `tests/run-task-code-review.test.ts` and a chained recovery-hints test. |
| AC-7: Spec-gate note | Pass | `tests/task-cli.test.ts` covers five admit states and the unstarted opposite-outcome case; existing assertion updated. |
| AC-8: Wording sweep | Pass | Four prohibited greps return zero hits over the required paths; remaining phase-list hits classified in handoff and all carry the full predicate. |
| AC-9: Prompt scope | Pass | Golden `promptImplementReroute`, `promptImplementReroute_resumed`, `promptPlan_reroute_round1` carry complete-or-partial, amendment + unfinished earlier work, newest-wins, worktree grounding, conditional handoff use, dirty-file coverage (implement); the three forbidden instructions are gone; human-decision framing kept. |
| AC-10: Golden scoped | Pass | Only `promptImplementReroute_resumed` added; exactly the six permitted reroute keys changed; no removals. |
| AC-11: Docs and help | Pass | Help, flags row, Human Reroute opening and full-tier paragraphs, SKILL §6, README prose and table row state the full predicate; uncommitted-source-edit note in `docs/pipeline-orchestrator.md` and `docs/patterns.md`; recovery-hint registry passes. |
| AC-12: Decision recorded | Pass | `docs/decisions.md:494` names the reversed Non-Goal, fake-phase-history workaround, route-back/loop-cap states, and `guardConcurrentRun`. |
| AC-13: Mirrors and dist | Pass | `sync-templates:check` in sync; rebuild leaves `dist/` unchanged. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work; no `status.json` field, no `autoCommitCode`/`reset-*` changes, no git ops added)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The core change is small and correct: one predicate in `state.ts`, two call sites, no residual phase set, and a test matrix that pins both sides of the boundary (including absent counters) with mutation-free rejection and both-tier reset assertions. Cold-Codex found nothing; neither Claude lens found a defect in the admission logic or reset path. Surviving findings are all in the new prompt/doc guidance for the aborted-round case or are cosmetic — none rises to a code-bug, so the verdict is approved with nits.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

> Non-blocking; recommended as follow-up polish.

- **R1 — Untracked aborted-round leftovers are not "refused" by auto-commit; they surface only at QA-end.** (cold-Claude; verified) `src/orchestrator/prompts/templates/implement-reroute.md:22` says "canon's auto-commit refuses to commit a dirty file the table omits", and `docs/pipeline-orchestrator.md:493` says the Changes table must cover leftovers "so auto-commit can account for every dirty source file". `findUncoveredTrackedChanges` (`src/orchestrator/validation.ts:787-788`) skips untracked-only (`??`) entries, so an omitted untracked file is silently left out of the auto-commit, never seen by code review, and dies at the QA-end check (`src/orchestrator/main.ts:1114`). The spec's own Known Risk ("autoCommitCode fails loudly") has the same inaccuracy, and the step-7 instruction (list every file from `git status --porcelain`) does cover `??` entries, so the agent is told the right action; the failure remains loud, just one phase late. Not a code-bug (spec Non-Goal forbids touching `autoCommitCode`; untracked-skip is pre-existing). Suggested polish: say untracked leftovers are committed only if listed, and that leftovers the amendment makes obsolete should be deleted rather than listed.
- **R2 — Loop-cap recovery restatements still list only the cap bump and reset paths.** (anchored) `buildCodeReviewReason()` now offers amend + `--reroute`, but `docs/pipeline-orchestrator.md:417` (rescope paragraph) and `.claude/skills/canon-pipeline/recovery.md:20` ("Two paths") were not updated. These are incomplete enumerations, not contradictions — SKILL §6 and the block message itself both state the reroute path — and neither file is in Affected Files (`recovery.md` is outside the spec entirely), so fixing them is a scope extension. Recommend a follow-up (or a human-approved scope add) rather than a revision round.
- **R3 — Reroute red-first checkpoint does not account for aborted-round dirty edits or an unfinished original red-first AC.** (anchored) `implement-reroute.md:28` (unchanged text) defines the pre-fix state as "HEAD before this round's edits" and fires only when the amendment adds/modifies a red-first AC. After an implement-entry reroute the worktree may already hold dirty non-test fix edits, and an original red-first AC left unfinished by an aborted first pass gets no direction to record its Red-First Evidence row. AC-9 did not require this; a future reroute's Stage 1 could stumble on it. Follow-up candidate.

#### Optional Cleanup / Nit

- **N1** — `implement-reroute.md:22` step 7 still says "the round-1 work that still applies plus the new amendment work"; with partial rounds it should also name unfinished original-AC work, matching steps 3–5. (anchored)
- **N2** — `src/orchestrator/prompts/index.ts:472`: "This is **not** a resume of an interrupted session" sits right before "The prior implementation round may be complete or partial", which reads oddly for the aborted-first-pass case (it means *session* resume, not *round*). (anchored, low confidence)
- **N3** — `plan-reroute.md` append shape and the feasibility pointer still label the section `### Delta` while the body now defines scope as amendment + unfinished work. (anchored, low)
- **N4** — `src/orchestrator/cli.ts:52-54` help and `src/task/index.ts` spec-gate note omit the "(a review round or a pre-flight rejection)" qualifier the docs/README/SKILL/rejection message carry. Matches AC-6(b)'s operator phrasing, so spec-conformant; consistency only. (anchored, low)
- **N5** — `README.md:278`: the command-reference cell runs the admission clause straight into "after appending an `## Amendment` section", reading as if it modifies the pre-flight rejection. Flagged by 2 lenses (anchored, cold-Claude).
- **N6** — Legacy `code_review.iterations` without `iterations_current_loop` is not consulted by the predicate or `describeRerouteEntryPhase`, unlike `getIterations()` (`src/orchestrator/main.ts:160`). Spec AC-1/Implementation Notes define the predicate on the current-loop field with absent = 0, and every increment since the field's introduction writes both (`src/task/index.ts:412,421`), so only pre-migration files are affected. Flagged by 2 Claude lenses.
- **N7** — `tests/run-task-reroute-preflight.test.ts:1013` derives the expected entry phase from row-name prefixes; correct for every current row but brittle — an explicit `expectedPhase` field (as `rejectedStateRows` uses) would be sturdier. (cold-Claude)
- **N8** — Banner detail clauses ("N review round(s) this loop", "N pre-flight rejection(s) this loop") in `describeRerouteEntryPhase` are not pinned; tests assert only the prefix. (anchored)
- **N9** — Malformed status with no `code_review` entry renders as `code_review pending` for implement-phase rows (`describeRerouteEntryPhase` `?? 'pending'`) but `code_review missing` for other phases in the rejection summary. Cosmetic, malformed input only. (cold-Claude)
- **N10** — Whitespace: double blank line before the new `docs/decisions.md` heading (anchored); stray double blank line and single-quoted keys in the new `tests/recovery-hints.test.ts` HINT_SITES entry (cold-Claude).

#### Spec Gaps

(none blocking) — R1 traces partly to the spec's Known Risk wording ("fails loudly"), and R2 to Affected Files omitting the loop-cap recovery restatements; both are minor enough to handle as follow-ups rather than halting for a spec revision.

### Dismissed Cold Findings

- Dismissed (cold-Claude): Affected-files block uses the committed diff only, so dirty aborted-round edits could let Codex skip a predicate-gated check - the block's committed-diff semantics already exclude the current round's own uncommitted edits in every implement and revision round, so leftovers are not a new class; and a first-pass abort with no commits gets the empty-set branch, which runs the full matrix (`src/orchestrator/prompts/index.ts:82-89`).
- Dismissed (cold-Claude): Admitting any implement `blocked` / `in_progress` admits a first pass that failed on auth/quota before writing code, spending reroute round 1 - spec-intended: Decision 1 and AC-1 admit implement `in_progress` and `blocked` unconditionally, and Problem item 2 names "an agent session failure" as a motivating blocked case (`tasks/reroute-from-implement/spec.md:13,27,59`).
- Dismissed (cold-Claude): Spec-gate note advises `--reroute` for implement `in_progress`, which usually means a live run - `guardConcurrentRun()` refuses a live run loudly before reroute handling, and the intended in_progress case is a stopped/crashed run (`tasks/reroute-from-implement/spec.md:12,19`); the note is accurate for that case.
- Dismissed (cold-Claude): Invalid-counter predicate tests (`'1'`, `-1`, `NaN`, `Infinity`) exercise unreachable inputs - harmless defensive coverage; the spec's Implementation Notes ask the predicate to treat absent or non-numeric counters as 0, and the tests pin that. Not a test-integrity defect (nothing is weakened).
- Cold-Codex: no findings to adjudicate.

Anchored-lens item not adopted: `guardConcurrentRun` does not detect an orphaned Codex child whose orchestrator died alone - pre-existing residual of the guard the spec explicitly relies on (`tasks/reroute-from-implement/spec.md:19`, Interaction Dependencies); out of scope for this task.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
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
