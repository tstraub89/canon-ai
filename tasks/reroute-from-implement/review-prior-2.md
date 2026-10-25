# Code Review: reroute-from-implement

> Reviewer: Claude | Spec: `tasks/reroute-from-implement/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

This is the first code review after the human reroute (amendment round 1). The pre-reroute review is archived at `tasks/reroute-from-implement/review-prior-1.md`. Reviewed HEAD `80b7023`; cumulative diff against `main` (`d6c00c3`). All original ACs (AC-1..AC-13) and amendment ACs (AC-A1..AC-A9) were checked.

Lens returns: anchored-Claude `STAGE_1: pass`, signal approve with nine low-severity items. Cold-Claude raised ten findings, signal changes_requested. Cold-Codex found no actionable regressions.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification (E2E is N/A per spec)
- [x] Red-first evidence recorded for each red-first AC (AC-1 loop-cap and route-back against `d6c00c3`; AC-A6 legacy alias against `f17a1d5`, test-only edits)

Independent re-verification by the anchored lens passed: `npm run lint`, `npm run type-check`, `npm run build` (left `dist/` byte-unchanged), `npm run sync-templates:check`, `npm run docs-refs-check`, five focused test files (324/324), the AC-8 wording greps, and golden key compares against `main` and the round-1 commit `e8c2d12`. The anchored lens also reproduced the AC-A6 and N9 red runs in a throwaway copy holding the `e8c2d12` `state.ts`/`main.ts`. Cold-Claude's run of the two reroute test files passed (192/192). No lens re-ran the full `npm test`; the handoff reports 1694 pass, 1 skipped, 0 fail.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Admission matrix | Pass | All five implement-entry admit rows plus code_review/qa/human_review, each for M and XS. Reject rows assert `status.json` byte-unchanged and `review.md` untouched. Red-first rows recorded. |
| AC-2: Bundle rule | Pass | Covers reject-unstarted, admit in_progress + human_review, and mixed spec_gap + loop-cap requiring amendments on both. A mixed-verdict route-back bundle is not admitted; see Spec Gaps. |
| AC-3: Single predicate | Pass | `isRerouteAdmitted` in `src/orchestrator/state.ts`, called from `src/orchestrator/main.ts` and `src/task/index.ts`. Zero `REROUTE_ADMITTED_PHASES` hits in `src/` and `dist/`. |
| AC-4: Real loop-cap fixture | Pass | Has an explicit implement pending / code_review blocked / verdict `''` row; the old row is relabelled as a code_review-phase auto-block. |
| AC-5: Reset from implement entry | Pass | Each admit row asserts implement pending/rerouted/count+1 and code_review pending, `''`, counters 0; next phase is spec_review for M, implement for XS. |
| AC-6: Operator text | Pass | Asserts banner sub-states, the rejected `implement pending (code_review pending)` summary, the full rule sentence, and the loop-cap reason at both entries. |
| AC-7: Spec-gate note | Pass | `tests/task-cli.test.ts` covers the five admit states and the opposite unstarted case. |
| AC-8: Wording sweep | Pass | All four prohibited greps return zero non-exempt hits. Every remaining phase-list hit carries the full predicate. |
| AC-9: Prompt scope | Pass | Golden implement-reroute (fresh/resumed) and plan-reroute carry complete-or-partial scope, unfinished earlier work, newest-wins, worktree grounding, conditional handoff use, and dirty-file coverage. Delta-only instructions are gone. |
| AC-10: Golden scoped | Pass | Against `main`: one key added (`promptImplementReroute_resumed`) and only the six permitted keys changed. |
| AC-11: Docs and help | Pass | Help, docs, SKILL §6, and both README surfaces state the predicate. The uncommitted-edit note is present and the recovery-hint registry passes. |
| AC-12: Decision recorded | Pass | `docs/decisions.md` entry names the reversed Non-Goal, the workaround, the real states, and `guardConcurrentRun`. |
| AC-13: Mirrors and dist | Pass | Sync check passes; a rebuild leaves `dist/` unchanged. |
| AC-A1: Auto-commit wording | Pass | The prompt and both docs distinguish modified-tracked omission (blocks auto-commit) from untracked (left out until the QA-end check), and say to delete obsolete leftovers. |
| AC-A2: Loop-cap recovery paths | Pass | `docs/pipeline-orchestrator.md` and `recovery.md` name `--reroute` only for a code_review block: A/B for spec_review, A/B/C for code_review. No internal paths. Mirrors synced. |
| AC-A3: Red-first partial rounds | Pass | Covers unfinished earlier red-first ACs, keeps satisfied rows, and requires an isolated committed-HEAD run with leftovers set aside and restored. Fallback is only the environment escape or a wrong-premise Blocker. See nit 3. |
| AC-A4: Prompt nits | Pass | Step 7 names unfinished earlier work, the preamble says "session", and the append shape uses `### Round Scope` with the parsed headings unchanged. See nit 1. |
| AC-A5: Operator text consistency | Pass | Help and note qualifiers match, the README cell is split, and `code_review missing` is tested in banner and rejection. |
| AC-A6: Legacy counter fallback | Pass | Red-first recorded; the shared `currentLoopReviewRounds` is used by the predicate and the banner; the all-absent reject row is kept. See nit 4. |
| AC-A7: Test robustness | Pass | Explicit `expectedPhase` per admitted row; singular/plural detail clauses asserted. |
| AC-A8: Whitespace | Pass | One blank line before the decisions heading; the HINT_SITES entry matches surrounding style. |
| AC-A9: Regression gates | Pass | Round-1 → HEAD golden changes only four reroute keys. Lint, type-check, build reproducibility, sync, and docs-refs pass. Full `npm test` taken from the handoff only. |

### Dropped Sections Check

- [x] Non-goals respected (no `status.json` field, no `autoCommitCode`/`reset-*` changes, no git ops added)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation follows the spec closely. One shared predicate is used at both call sites, the legacy fallback is shared with the banner, the test matrix pins both sides of every boundary, and the amendment's prompt and doc corrections landed as written. Cold-Codex found nothing. One cold-Claude finding holds against the code: a supported operator state the task set out to admit is still rejected for a mixed-verdict bundle. The implementation matches the spec's predicate and bundle rule exactly, so fixing it means changing the spec's definition. The verdict is `spec_gap`, not `changes_requested`. Everything else is non-blocking.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- **Archived review findings are not pointed at for non-exempt rerouted tasks** (cold-Claude, `src/orchestrator/prompts/templates/implement-reroute.md`; `docs/pipeline-orchestrator.md:497`). Reroute archives `review.md` to `review-prior-<n>.md` and zeroes counters, so the reroute prompt replaces the revision prompt. For non-exempt tasks, that prompt never mentions the archived findings. `docs/pipeline-orchestrator.md:497` says "Archived findings remain binding". An outstanding `changes_requested` finding is therefore dropped unless the amendment restates it. Baseline-checked: `main`'s implement-reroute template has no such pointer either, so this predates the task. This task widens exposure by admitting route-back and in-progress-revision entries. Not blocking. Recommend a follow-up, or fold it into the amendment if the human chooses FIX for the spec gap below.

#### Optional Cleanup / Nit

1. `src/orchestrator/prompts/index.ts:472` (anchored): "not a resume of your interrupted one" assumes an interruption. The non-resumed preamble is also chosen after the no-diff auto-block, which deletes `sessions.codex`, and after a completed round with no stored session. "not a resume of a prior session" would be accurate in every case.
2. `.claude/skills/canon-pipeline/recovery.md:27` and its mirror (anchored): Path B's trigger text ("phrases that no longer exist in the spec") now also fronts `reset-code-review`. For a code_review block the stale target is the code or handoff.
3. `src/orchestrator/prompts/templates/implement-reroute.md` red-first set-aside (anchored + cold-Claude, merged): "temporarily restore those paths to their committed contents" does not cover untracked non-test leftovers, which have no committed contents and must be moved aside. A leftover fix file left in place could make the red run pass. The text also does not say to confirm the copy before restoring. The set-aside itself is spec-mandated by AC-A3; see Dismissed for the "discard" framing.
4. `src/orchestrator/state.ts:448` (flagged by 2 lenses, anchored + cold-Claude): `??` falls back to legacy `iterations` when `iterations_current_loop` is `null`, not only when it is absent as `docs/decisions.md` says. The invalid-value test omits `null`. On the orchestrator path `readStatus` validation rejects null, so only the `canon task` spec-gate note can see it; the behavior matches `getIterations()`. Negligible impact. Align the docs or add `null` to the test row.
5. `src/orchestrator/state.ts:447` (cold-Claude): `currentLoopReviewRounds` duplicates the `iterations_current_loop ?? iterations` chain in `getIterations()` (`src/orchestrator/main.ts:158`), and only the new one validates. Two sources of truth for one count. Related: `'1'`-string counters are positive for `shouldUseImplementRevision` but 0 here; that only matters for corrupt data.
6. `src/orchestrator/main.ts:2828-2830` (anchored): the rejection sentence repeats itself ("requires implementation to have begun … or implement once implementation has begun").
7. `.claude/skills/canon-pipeline/SKILL.md:148` and its mirror (anchored): the heading "Reroute after review feedback" is now narrower than the rule beneath it.
8. `src/orchestrator/main.ts:2791` (anchored): a missing `implement` entry renders `implement pending` while a missing code_review renders `missing`. Only malformed input is affected, and N9 scoped only code_review.
9. `src/task/index.ts:15` (anchored): the `isRerouteAdmitted` import is out of alphabetical order. Lint passes.
10. `tests/run-task-reroute-preflight.test.ts:1229` (cold-Claude): the bundle `admit-started` scenario asserts only exit status, not post-reroute state or banner. Single-task rows cover the reset fields, so the test's claim (admission) is still tested. This is weak coverage, not compromised integrity.
11. `src/orchestrator/main.ts:2826-2831` (anchored, cold-Claude concurred on the state): the rejection for implement pending with zero counters gives no next step. For the fast-tier "rerouted then stopped before implement" case, a hint to revise the current amendment and run plain `canon run <id>` would help. The rejection itself is spec-intended; see Dismissed.

#### Spec Gaps

- **Route-back state 3 is still rejected for a mixed-verdict bundle** (cold-Claude, verified by the foreman; `src/orchestrator/state.ts:451`, `src/task/index.ts:425-431`, `src/orchestrator/main.ts:3861`). Altitude: `spec-gap`.
  - **How the state arises.** In a bundle `A B` where code review records `approved` (or `approved_with_nits`) for A and `changes_requested` for B, `updateReviewCounters` zeroes A's `iterations_current_loop`, `iterations`, and `preflight_rejections_current_loop`. `routeBackTo(taskIds, 'implement')` then resets every bundle member to implement `pending` with code_review `pending`. That is the resting state under `--step`, after `canon stop`, or after a crash before implement starts.
  - **Why it is rejected.** A matches none of the predicate's implement-entry conditions. The unchanged bundle rule requires every named task to be admitted, so `canon run A B --reroute` dies with "requires implementation to have begun".
  - **Why it matters.** Implementation demonstrably happened and was reviewed. The spec's Problem §3 names this exact state as one the task must admit. Pre-flight route-back does not hit the gap, because `src/orchestrator/phases/code-review.ts:354-363` bumps every sibling's pre-flight counter. Loop-cap and spec_gap blocks do not hit it either, because they block the whole bundle. Only real-review mixed verdicts leave the approved sibling with no evidence. No test covers it. On `main` the state was already rejected, so this is incomplete admission, not a regression.
  - **Why it is a spec gap.** The code implements the spec's Decision 1 literally: the predicate fields, "both current-loop counters at 0 stays rejected", and "The bundle rule is unchanged: every named task must be admitted" (`tasks/reroute-from-implement/spec.md:29`). Closing the gap needs a spec decision, so the implementer could not fix it from the written spec. Two candidate fixes:
    - Evaluate route-back bundle admission at bundle level, admitting an approved sibling when another member is admitted at implement entry.
    - Record review-round evidence on approved siblings at route-back time.
  - **Operator choice.** Amend and `--reroute` to close it, or `canon task accept … code_review` to sanction it as a known limitation, since the window is narrow and the failure is loud.

### Dismissed Cold Findings

- Dismissed (cold-Claude): a second `--reroute` is refused when a fast-tier task rests at implement pending with `rerouted: true` and zero counters (also raised by the anchored lens as a spec gap). The spec explicitly rejects this state: "Implement `pending` with code_review `pending` and both current-loop counters at 0 … stays rejected: no implementation round of the current loop has begun — the request is a spec or plan revision" (`tasks/reroute-from-implement/spec.md:29`). The operator revises the pending amendment and runs plain `canon run`. The missing next-step hint is kept as nit 11.
- Dismissed (cold-Claude): the red-first set-aside is an agent-driven discard that contradicts the docs' discard warnings. AC-A3(b) mandates exactly this isolation ("committed HEAD with non-test leftovers set aside, restored after the run"). The prompt says to copy the leftovers out first and forbids bare `git stash`. The doc warning at `docs/pipeline-orchestrator.md:495` covers manual discard operations such as `reset --hard`, `checkout HEAD~N`, and `stash drop`, not a copy-then-restore. The untracked-file and copy-verification gaps are kept as nit 3.
- Dismissed (cold-Claude): the red-first paragraph contradicts itself ("difficulty … not grounds for skipping" vs "if no isolated pre-fix run is possible … Blocker"). Difficulty and impossibility are different conditions, and both clauses are verbatim requirements of AC-A3. The committed-HEAD pre-fix definition is also AC-A3's explicit replacement for the old wording (handoff Deviations). The partial-fix-already-committed edge would surface as a recorded `[wrong-premise]` Blocker, which is the intended loud outcome.
- Dismissed (cold-Claude): admitting implement `in_progress` relies on `guardConcurrentRun`'s race window. The spec's Problem explicitly accepts this: "Concurrent-run safety is already provided independently of the gate: `guardConcurrentRun()` runs before `--reroute` … so admitting implement `in_progress` only admits a dead or stopped run." The spec-gate note pointing at `--reroute` during a live run is advisory, and the guard refuses the command loudly.
- Dismissed (cold-Claude): recovery.md Path C gives no hint about the round-numbered heading. Path C says "Append the next `## Amendment` (round 1) or `## Amendment Round N` (round 2+) section", and the reroute pre-flight names the exact heading.
- Dismissed (cold-Codex): none. Cold-Codex reported no actionable findings.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [x] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

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
