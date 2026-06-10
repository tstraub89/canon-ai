# Code Review: operator-review-recovery

> Reviewer: Claude | Spec: `tasks/operator-review-recovery/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All six required checks (`lint`, `type-check`, `test`, `build`, `sync-templates:check`, `docs-refs-check`) recorded `Pass`. The anchored lens independently re-ran the suite and got 812 passed / 0 failed (handoff recorded "811 passed, 1 skipped" — same 812 total, the one difference is whether a single conditionally-skipped test ran; immaterial since neither shows a failure). `dist/` diff is empty against a fresh build.

### Acceptance Criteria Check

Cross-reference **every** AC from the spec. Missing an AC from this table is itself a Stage 1 failure.

| AC | Status | Notes |
|---|---|---|
| AC-1 (relaxed, bundle-aware reroute precondition) | Pass | `rerouteFromHumanReview` (`main.ts:2097-2117`): `allAtHumanReview` (`.every`) OR (`allCodeReviewBlocked` `.every` + `someSpecGap` `.some`). Quantifiers match spec (every-blocked floor, ≥1 spec_gap trigger). `getCurrentPhase` returns `code_review` for a blocked entry (`state.ts` `deriveTopLevelStatus`), so the phase guard is sound. Tested in `run-task-reroute-preflight.test.ts`. |
| AC-2 (full machinery runs) | Pass | Reset loop (`main.ts:2171-2242`) increments `reroute_count`, sets `implement.rerouted=true`, resets implement/code_review/qa/human_review; full tier resets spec_review/plan + clears `sessions.codex_spec_review`. Shared with the `human_review` path. |
| AC-3 (desync closed) | Pass | `verifyRerouteAmendment` (`validation.ts`) unchanged; round-N requires `## Amendment Round N`; stale bare heading can't satisfy a later round. Closed structurally by the `reroute_count` bump in AC-2. Test drives round 1 → round 2. |
| AC-4 (recovery message rewrite — both surfaces) | Pass | Printed block (`main.ts:2821-2840`) and persisted `reason` (`main.ts:2815-2820`) both present FIX (`canon run <ids> --reroute`) and BLESS (`canon task accept <ids> code_review --reason`), both naming the full `taskIds`. The old `canon task phase <id> code_review pending` / `done approved` recommendation is gone from both. Test asserts presence + absence + full-bundle IDs. |
| AC-5 (phase set + mandatory reason, bundle-aware) | Pass | `taskAccept` (`src/task/index.ts:559-570`) accepts `{implement, spec_review, code_review}` and multi-ID; review phases require non-empty `--reason` (`:652-658`); implement reason stays optional. |
| AC-6 (sanction + advance, no `checkPhaseGate`) | Pass | Review branch writes status directly via `writeStatusAtomic` (→ `deriveTopLevelStatus` re-points to next phase); never calls `checkPhaseGate`. `code_review` → `qa`, `spec_review` → `plan`. |
| AC-7 (durable paper trail) | Pass | Sets `operator_accepted`/`_at`/`_sha` (`:712-715`); appends verbatim `--reason` to `notes.md` (`:756-765`); prior `escalations[]` left intact (tested). |
| AC-8 (distinct verdict, mint-by-accept-only) | Pass | `sanctioned` added to `_VERDICT_VALUES` (`types.ts:14`), `VALID_VERDICTS` + `assertValidVerdict` error string (`index.ts:19,344`), CLI help (`cli/index.ts:56`), status template `_verdict_values` + mirror. `canon task phase … done sanctioned` rejected with accept-redirect (`index.ts:355-360`). `extractCheckedVerdict` correctly untouched. |
| AC-9 (routing treats `sanctioned` as advance) | Pass | `sanctioned` is not in the spec_gap/changes_requested/needs_re_review branches, so it falls through to advance; spec_gap block does not fire. Tested. |
| AC-10 (invariant holds) | Pass | Review-accept path makes no `spec.md` edit and never touches `reroute_count`; tested with before/after snapshots. |
| AC-11 (stale sanction cleared on reopen) | Pass | Reroute reset clears review `operator_accepted*` via generalized `clearPhaseOperatorAcceptance` (`main.ts:2211,2229`) + verdict reset; `taskPhase` reopen-clear generalized to review phases (`index.ts:451-460`). Code correct; test coverage of the *review-phase* reopen-clear path is thin — see Nit. |
| AC-12 (docs + BACKLOG) | Pass | `AGENTS.md`, `CLAUDE.md`, `docs/pipeline-orchestrator.md` updated; BACKLOG entry marked `[x]` resolved; `sync-templates:check` + `docs-refs-check` pass. |
| AC-13 (clean spec_gap-entry-state reset) | Pass | Post-reroute `code_review`: `status='pending'`, `verdict=''`, zeroed `iterations_current_loop`/`preflight_rejections_current_loop` (`main.ts:2197-2213`). Tested; one dispatch step routes into `spec_review` (full tier), not back into `code_review`. |
| AC-14 (mixed-bundle FIX path) | Pass | `autoBlockPhase(taskIds, …)` stays full-bundle (`main.ts:2845` + explanatory comment); reset loop clears every member including a blocked non-gap sibling; off-phase sibling bundle rejected without mutation. Both sub-cases tested. |
| AC-15 (mixed-bundle BLESS path) | Pass | `advancingVerdicts = {approved, approved_with_nits}`: non-advancing → `sanctioned` + `operator_accepted*`; advancing → verdict preserved, `operator_accepted*` deleted; both → `status='done'` → `qa`. Partial bless leaves un-named sibling blocked (intended). 2-task fixture tested. |

### Dropped Sections Check

- [x] Non-goals respected — no auto-classification, no new top-level command, `implement`-accept semantics unchanged, `canon task phase` escape retained, full-send auto-amend not added.
- [x] Known Risks addressed or documented — review-accept is a distinct path that skips the implement-only diff/handoff/SHA-pin guards (verified); accept-from-blocked bypasses `checkPhaseGate` and leaves escalations intact (verified); reason parsing handles spaces (preserved verbatim); mixed-bundle quantifiers wired as specified.
- [x] Human Test Plan satisfiable — all eleven steps map to implemented behavior.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-scoped implementation of a delicate routing change. The two recovery paths reuse the existing `rerouteFromHumanReview` and `taskAccept` surfaces rather than forking parallel ones (per the "route it through the existing safety queue" pattern). The review-accept branch is correctly positioned ahead of the implement-only git guards, so a `spec_review` sanction on an empty diff is not wrongly rejected. The bundled write uses a snapshot + tmp-file-rename rollback for atomicity. Both lenses found **no correctness bugs and no spec gaps**; all surviving findings are low-severity nits. Tests assert correct behavior (notably the AC-15 verdict-preservation case and the AC-14 off-phase-rejection-without-mutation case) — no test was changed to accommodate broken behavior.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

(none)

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- **`notes.md` append sits outside the rollback transaction** (`src/task/index.ts:751-769`, flagged by **both lenses**). The status writes are snapshot/rollback-protected; the `notes.md` append is not, so a notes I/O failure leaves the sanction committed in `status.json` (with `operator_accepted*` set) but with no `notes.md` audit line — only a `console.error` warning. This is the *correct* tradeoff (authoritative status correctness > best-effort audit log; AC-7's status-level trail still records the sanction), but it's load-bearing enough to deserve a one-line comment marking the ordering as deliberate.
- **AC-11 review-phase reopen-clear is not directly tested** (`tests/task-cli.test.ts`, anchored lens). The code path is correct, but no test seeds a *sanctioned* review phase carrying `operator_accepted*` and asserts those fields are cleared on `canon task phase <id> code_review pending` or on reroute. The implement-equivalent is tested; the review-phase generalization rides on shared code but lacks its own assertion. AC-11's Verify clause names this test explicitly — worth adding when convenient.
- **`routeBackTo` top-level implement clear is now redundant** (`scripts/run-task/main.ts:2273`, cold lens — confirmed). With the new `clearPhaseOperatorAcceptance(phaseEntry)` inside the `for (i=targetIdx…)` loop (`:2294`), when `targetIdx <= indexOf('implement')` the implement entry is already cleared by the loop, making the special-case call at `:2273` a harmless double-delete. Dead-ish code; safe to drop.
- **`--reason` parser can swallow the next token with a confusing diagnostic** (`src/task/index.ts:1349-1357`, cold lens). `canon task accept TASK-A --reason code_review` (value omitted, phase placed next) consumes `code_review` as the reason, then fails with the generic `usage` error rather than "reason value missing". No incorrect accept occurs — it fails closed — but the diagnostic is unhelpful. Optional hardening.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong.

(none)

### Dismissed Cold Findings

> Cold-lens findings dropped because the spec shows the behavior is intended. Include the spec reason.

- **Dismissed (cold): empty-string verdict (`''`) is treated as non-advancing → sanctioned, so accepting a never-reviewed review phase silently sanctions it** (`src/task/index.ts:710-720`) — Intended. AC-6 explicitly enumerates the overridable verdicts as "`spec_gap`/`changes_requested`/`needs_re_review`/**empty**", and AC-15 lists empty among the non-advancing verdicts that become `sanctioned`. The `priorIncompletePhases` guard still ensures upstream phases are done, and the override is operator-initiated with a mandatory audited `--reason`. Spec-aligned.
- **Dismissed (cold/anchored): review-accept records `operator_accepted_sha = HEAD` without a clean-working-tree check, and even for `spec_review` where HEAD existence is incidental** (`src/task/index.ts:682-720`) — Intended. Known Risks states the review-phase SHA is a "record-only HEAD pin (no demote-on-rerun meaning, since there is no auto-commit to skip)" and that the review-accept path *must not* reuse the implement-only guards (including the clean-tree guard) because a `spec_review` accept can legitimately run before any implementation exists. No gate reads review-phase `operator_accepted_sha`, so this is an audit-accuracy nuance, not a routing bug, and the spec deliberately accepts it.
- **Dismissed (anchored): a pre-implement `spec_review` accept on a `worktree:true` task could hit a `die()` in `resolveTaskCwd` if the worktree doesn't exist yet** — Not realized today. The worktree is created at `implement`, and a `spec_review` accept resolves to REPO_ROOT in current ordering; flagged as a latent ordering dependency, not a present defect. Out of scope for this task.
- **Dismissed (cold): `isSpecGapReroute` is brittle to hand-edited state** (`main.ts:2099-2104`) — fails closed. If an operator manually flips a member's `code_review.status` off `blocked`, the spec_gap reroute path rejects rather than wrongly accepts. The low-level `canon task phase` escape is explicitly retained-but-unhardened per Non-Goals; this is the documented behavior of that escape, not a defect in the sanctioned path.
- **Dismissed (cold): rollback restores files on disk but does not reset in-memory `ctx.status`** (`src/task/index.ts:726-749`) — currently correct. Every catch path re-throws before any subsequent read of `ctx.status`, so the mutated-but-rolled-back-on-disk state is never observed. Flagged as a latent trap for future code added after the catch; no present bug.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N-1's response to round N-1

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
- [ ] Needs re-review
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
