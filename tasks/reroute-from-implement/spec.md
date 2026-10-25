# Spec: reroute-from-implement — Allow `--reroute` once implementation has begun

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`canon run <id> --reroute` admits a task only when `getCurrentPhase()` returns `code_review`, `qa`, or `human_review` (`REROUTE_ADMITTED_PHASES` in `src/orchestrator/main.ts`, consumed by `rerouteFromHumanReview()`). A current phase of `implement` is always rejected. That exclusion was a deliberate Non-Goal of the archived `relax-reroute-gate-post-implement` task, on the reasoning that a mid-implementation reroute "drops it into a half-written state."

In practice the exclusion protects nothing and blocks four real operator states, all of which have `getCurrentPhase() === 'implement'` (`deriveTopLevelStatus()` returns the first non-`done` phase, so implement `pending`, `in_progress`, and `blocked` are indistinguishable at the phase level):

1. **Implement `in_progress` after a stopped or crashed run.** The human realises mid-implementation that the spec is wrong, runs `canon stop`, and amends the spec. The only workaround is to hand-mark implement `done` and code_review `pending` so the gate admits the task — which fakes phase history and lands in exactly the same half-written worktree the Non-Goal was meant to avoid.
2. **Implement `blocked`.** An agent session failure, a no-diff revision round, or Codex's own `canon task phase … implement blocked` escalation parks implement at `blocked`. This is frequently the moment the spec is discovered to be wrong.
3. **Route-back after a code_review that requested changes.** When code_review returns `changes_requested` (or a pre-flight rejection), `routeBackTo(taskIds, 'implement')` in `src/orchestrator/main.ts` sets implement and every downstream phase to `pending` and clears the code_review verdict to `''`, while code_review's `iterations_current_loop` (incremented when the review round closes, `src/task/index.ts`) or `preflight_rejections_current_loop` is ≥ 1. Under `--step`, or after `canon stop` / a crash before implement flips to `in_progress`, the task rests at implement `pending` + code_review `pending` — implementation has demonstrably happened and been reviewed, yet the gate rejects it.
4. **The code_review loop-cap auto-block.** From state 3, the next run's implement-entry check (`evaluateCodeReviewLoop`, defined in `src/orchestrator/review-loop.ts` and called from `src/orchestrator/phases/implement.ts`) trips the cap and calls `autoBlockPhase(…, 'code_review', …)`. The task rests at **implement `pending` + code_review `blocked` + verdict `''`**. `reset-code-review`'s existing `blockedAtImplementEntry` special case in `src/task/index.ts` recognises the same state. The predecessor task named "code_review auto-blocked on the loop cap" as a motivating case, but its admission test row (`admittedStateRows` in `tests/run-task-reroute-preflight.test.ts`) models it as current phase code_review, `blocked`, verdict `changes_requested` — not the state the implement-entry loop-cap path writes. Today the real loop-cap state reaches `--reroute` only via a two-step detour (`canon task reset-code-review`, which archives `review.md`, clears loop counters, and marks implement `done`, then `--reroute`); that detour discards the review evidence the amendment is reacting to and resets counters for a round that is about to be reset anyway.

Confirmed by reading the deterministic code paths cited above (no runtime-dependent mechanism is involved).

Concurrent-run safety is already provided independently of the gate: `guardConcurrentRun()` runs before `--reroute` is processed in the CLI entry path and dies when a live orchestrator owns the task, so admitting implement `in_progress` only admits a dead or stopped run.

Several prompt and documentation surfaces assert that a reroute always follows "a completed implementation round" or that the prior work "shipped", and the reroute prompts instruct agents to implement or plan **only the amendment delta**. Once implement-entry reroutes are admitted, both become wrong for some reroutes: the prior round may be partial, and a delta-only instruction would silently drop the unfinished part of the original ACs or of the previous amendment round. The prompts cannot tell which case applies: the entry phase is not persisted, and the reroute reset sets every reset phase back to `pending` before prompts render.

## Decision

1. **Replace the phase-membership gate with one shared admission predicate** — "implementation has begun." A task is reroute-admitted when its current phase is:
   - `code_review`, `qa`, or `human_review` (any status or verdict, unchanged); or
   - `implement`, and at least one of: `phases.implement.status` is `in_progress` or `blocked`; `phases.code_review.status` is `blocked`; `phases.code_review.iterations_current_loop` > 0; `phases.code_review.preflight_rejections_current_loop` > 0.

   Implement `pending` with code_review `pending` and both current-loop counters at 0 (absent counts as 0) stays rejected: no implementation round of the current loop has begun — the request is a spec or plan revision. `spec`, `spec_review`, `plan`, and `complete` stay rejected. The bundle rule is unchanged: every named task must be admitted.

   The predicate is a single exported function in `src/orchestrator/state.ts`, imported by both the orchestrator gate and `canon task`'s spec-gate note. It **replaces** both `REROUTE_ADMITTED_PHASES` sets (in `src/orchestrator/main.ts` and `src/task/index.ts`); neither set, nor the `src/task/index.ts` comment saying it "Mirrors REROUTE_ADMITTED_PHASES", exists after.

2. **Operator-facing text names the implement sub-state.** The reroute entry banner and the rejection message's per-task state summary show implement's status and code_review's status, so an operator can see why one implement-phase task was admitted and another rejected. The rejection message states the full admission rule. The code_review loop-cap auto-block message (`buildCodeReviewReason()` in `src/orchestrator/review-loop.ts`), which already says "the spec or approach may need revisiting", additionally names amending the spec and running `canon run <ids> --reroute` as the spec-change path, alongside the existing `reset-code-review` rescope path.

3. **Reroute prompts are truthful and complete for a complete or partial prior round.**
   - Every reroute prompt surface replaces "after a completed implementation round" / "after your implementation shipped" / "previously shipped" phrasing with phase-neutral wording built on **"after implementation began"**, keeping the human-decision framing.
   - The implement-reroute and plan-reroute prompts tell the agent the prior round may be complete or partial, and that the scope of this round is **the amendment plus any unfinished work from the original ACs and earlier amendment rounds** — the "ignore prior-round sections", "delta … already addressed by the previous implementation", and "plan only the delta" instructions are replaced with that scope (prior-round sections remain binding where not yet implemented; the newest amendment wins on conflict).
   - Both prompts direct the agent to establish current state from the worktree diff against the base branch, and to treat `handoff.md` as a record of prior work only when it has been filled in (it may still be the unfilled template after an aborted first pass).
   - The implement-reroute prompt directs that the rewritten handoff's Changes table cover every dirty file in the worktree.

4. **Docs and help restate the new rule with the full predicate**, phrased without canon-internal source paths (the restating docs ship to adopters), and drop the "back into the post-review fix path" tail in favour of phase-neutral wording. `docs/pipeline-orchestrator.md` §"Human Reroute" and `docs/patterns.md` note that an implement-entry reroute leaves the aborted round's uncommitted **source** edits in the worktree. A `docs/decisions.md` entry records that the predecessor's "No reroute from `implement`" Non-Goal is reversed and why.

## Non-Goals

- **No new `status.json` field and no persisted entry phase.** Prompts stay phase-neutral; they do not branch on whether the prior round finished.
- **No reroute evidence check on `implement`.** `checkRerouteEvidence()` keeps gating only `spec_review` and `plan`. A complete handoff from a prior round can still evidence-advance a rerouted implement via `tryEvidenceAdvance` — already true for every existing reroute; code_review remains the backstop.
- **No reroute from implement `pending` with no current-loop review activity and no blocked code_review, nor from `spec`, `spec_review`, `plan`, or `complete`.** A full-tier task mid-reroute (at `spec_review` or `plan` of a reroute round) stays rejected.
- **No change to spec_gap reroute-exempt semantics.** Exemption still requires every named task at current phase code_review `blocked` with at least one `spec_gap` verdict. Consequence, accepted and pinned by AC-2: a bundle mixing a spec_gap-blocked task with a newly admitted implement-phase task (e.g. loop-cap) is a non-exempt reroute, so every task in it needs its own Amendment section.
- **No change to the `Human reroute?` quality-log metric** (its label, parser, definition, or the QA prompt's answer guidance), nor to `reroute_count` semantics.
- **No change to `autoCommitCode()`.** It keeps refusing to commit a dirty file the handoff omits; the mitigation for an aborted round's leftover edits is prompt guidance (Decision 3), not loosening the commit boundary.
- **No git operations added to `--reroute`.** It still commits, stashes, and resets nothing.
- **No change to `reset-code-review`, `reset-spec-review`, `canon task accept`, or the reroute amendment-heading contract (`verifyRerouteAmendment()`).**
- **No rewrite of dated records** (`CHANGELOG.md`, `docs/BACKLOG.md`, `tasks/_archive/**`) and no hand edit to existing lines of telemetry docs (`docs/task-quality-log.md`, `docs/lessons-learned.md`, `docs/pipeline-invocations.md`).
- **No rename of the `## Human Reroute` heading** in `docs/pipeline-orchestrator.md` (shipped code cites it by name).

## Acceptance Criteria

- [ ] **AC-1: Admission matrix.** `rerouteFromHumanReview()` admits (proceeds past the phase gate to the amendment pre-flight) a single task in each of these states, and rejects with the phase-gate error — before any `status.json` or `review.md` mutation, asserting `status.json` byte-unchanged — each rejected state:
  - Admit: implement `in_progress`; implement `blocked`; implement `pending` + code_review `blocked` + verdict `''` (loop-cap); implement `pending` + code_review `pending` + `iterations_current_loop: 1` (route-back after changes_requested); implement `pending` + code_review `pending` + `preflight_rejections_current_loop: 1`, `iterations_current_loop: 0`; and every previously admitted state (`code_review`, `qa`, `human_review`).
  - Reject: implement `pending` + code_review `pending` with both current-loop counters 0; the same with the counter fields absent; `plan`; `spec_review`; `spec`; `complete`.

  Verify with table-driven rows in `tests/run-task-reroute-preflight.test.ts`. The loop-cap and route-back admit rows are red-first: they are rejected on the base gate and admitted after (record the base-run observation in the handoff's Red-First Evidence).
- [ ] **AC-2: Bundle rule.** In `tests/run-task-reroute-preflight.test.ts`: (a) a bundle of one implement `blocked` task and one implement `pending` task with zero counters is rejected as a whole; (b) a bundle of one implement `in_progress` task and one `human_review` task is admitted; (c) a bundle of one code_review `blocked` `spec_gap` task and one loop-cap implement-entry task is a non-exempt reroute — the pre-flight requires an Amendment section on both tasks.
- [ ] **AC-3: Single predicate.** The admission rule is one exported function in `src/orchestrator/state.ts`, called by `rerouteFromHumanReview()` and `specGateDoneNote()`. Verify: `grep -rn "REROUTE_ADMITTED_PHASES" src/` returns zero hits (identifier and the "Mirrors…" comment both gone), and the predicate has direct unit tests in `tests/run-task-reroute-preflight.test.ts` covering each AC-1 implement sub-state.
- [ ] **AC-4: Real loop-cap fixture.** `tests/run-task-reroute-preflight.test.ts` contains an admit row labelled as the implement-entry loop-cap auto-block whose fixture is implement `pending`, code_review `blocked`, code_review verdict `''`. The existing row modelling a code_review-phase block with verdict `changes_requested` stays as an admit row (code_review-phase auto-blocks do write that shape) but is relabelled so it no longer claims to be the implement-entry loop-cap case. Verify by reading the rows.
- [ ] **AC-5: Reset from implement entry routes correctly.** After an admitted reroute from each of the implement-phase admit states in AC-1, `status.json` has implement `pending` with `rerouted: true` and `reroute_count` incremented by one, code_review `pending` with verdict `''`, `iterations_current_loop: 0` and `preflight_rejections_current_loop: 0`, and the derived next phase is `spec_review` for a full-tier task and `implement` for a fast-tier (XS non-delicate) task. Verify with tests asserting the written `status.json`.
- [ ] **AC-6: Operator text names the sub-state.** (a) The reroute banner for an implement-phase task includes implement's status and, when code_review is `blocked`, says so. (b) The phase-gate rejection message's per-task summary includes implement's status, and its rule sentence states the full predicate in operator terms (code_review, qa, or human_review; or implement once implementation has begun — implement in progress or blocked, a blocked code review, or a code review already run in the current loop). (c) `buildCodeReviewReason()`'s loop-cap message names amending the spec and `canon run <ids> --reroute` as the spec-change path while keeping the `reset-code-review` path. Verify with tests asserting an admitted and a rejected implement-phase case render distinct, correct text (opposite-outcome pair), and a test on the loop-cap message.
- [ ] **AC-7: Spec-gate note follows the predicate.** `canon task set <id> human_spec_gate true` on a full-tier task whose spec_review is `done` emits the "add an amendment and run `--reroute`" branch for each AC-1 implement-phase admit state, and the "will not fire on this pass" branch for implement `pending` with zero counters and no blocked code_review; the latter's text states the new rule. Verify in `tests/task-cli.test.ts` (update the existing `code_review, qa, or human_review` assertion; add opposite-outcome cases).
- [ ] **AC-8: Wording sweep.** After the change, these case-insensitive extended-regex greps across `src/`, `docs/`, `.claude/`, `templates/`, `README.md`, and `dist/` return zero hits:
  - `completed .?implement` (catches the backticked "completed `implement` round" form)
  - `previously shipped|implementation shipped|complete and shipped`
  - `post-review fix path`
  - `admitted phase \(.?code_review.?, .?qa.?, or .?human_review.?\)`

  Permitted to remain: `CHANGELOG.md`, `docs/BACKLOG.md`, `tasks/**`, and pre-existing lines of `docs/task-quality-log.md`, `docs/lessons-learned.md`, `docs/pipeline-invocations.md`. Additionally, every remaining hit for `code_review.?, .?qa.?, or .?human_review` in a reroute context across the same paths is classified in the handoff as either updated to the full predicate or not an admission-rule statement. Verify by running the greps and recording results in the handoff.
- [ ] **AC-9: Prompt scope and partial-round guidance.** The rendered implement-reroute prompt (both the resumed and non-resumed preamble variants) and plan-reroute prompt:
  (a) state that the prior implementation round may be complete or partial;
  (b) define this round's scope as the amendment plus any unfinished work from the original ACs and earlier amendment rounds, with the newest amendment winning on conflict — and no longer contain the "ignore prior-round sections when implementing this one", "already addressed by the previous implementation", or "Plan only the delta from the amendment" instructions;
  (c) direct establishing current state from the worktree diff, treating `handoff.md` as prior-work evidence only when filled in;
  (d) (implement only) direct that the rewritten handoff's Changes table cover every dirty file in the worktree.
  The human-decision framing ("a human decided …" / "a human amended …") remains in every reroute prompt. Verify by reading the regenerated golden entries, including a new golden entry for the resumed implement-reroute variant.
- [ ] **AC-10: Golden regenerated, scoped.** `tests/run-task-prompts.test.ts` gains a golden case rendering the implement-reroute prompt with `isResumedSession = true`. `tests/run-task-prompts.golden.json` is regenerated with `UPDATE_GOLDENS=1`; the only added key is that resumed-variant key, the only changed keys are existing reroute-prompt keys (implement reroute; spec_review reroute round-1, round-2, and bundle; plan reroute round-1 and bundle), and every other key is byte-identical to the base. Verify with a key-level compare against the base ref recorded in the handoff.
- [ ] **AC-11: Docs and help restate the full predicate.** Each of these states the new rule with the full implement sub-state predicate (not bare "implement") and no "post-review fix path" tail: `canon run --help` (`printUsage()` in `src/orchestrator/cli.ts`); `docs/pipeline-orchestrator.md` flags-table `--reroute` row, §"Human Reroute" opening paragraph, and §"Human Reroute" full-tier re-entry paragraph (the "regardless of which admitted phase …" sentence); `.claude/skills/canon-pipeline/SKILL.md` §6 admission sentence; `README.md` flags prose and command-reference `--reroute` row. The two canon-managed files describe the predicate in operator terms without naming canon-internal source paths. `docs/pipeline-orchestrator.md` §"Human Reroute"'s uncommitted-state paragraph and `docs/patterns.md` §"Operator git surgery before first QA…" both note that an implement-entry reroute leaves the aborted round's uncommitted source edits in the worktree. In `tests/recovery-hints.test.ts`, pinned snippets for the old message/help text are updated and every new or changed `src/` line containing `--reroute` has a registry entry, so the hint-registry check passes. Verify by reading each surface and running the test suite.
- [ ] **AC-12: Decision recorded.** `docs/decisions.md` gains an entry stating that `--reroute` is admitted once implementation has begun (the implement sub-state predicate), that this reverses the `relax-reroute-gate-post-implement` Non-Goal, and why (the workaround fakes phase history into the same half-written state; route-back and loop-cap states rest at implement entry; `guardConcurrentRun` already prevents rerouting a live run). Verify by reading.
- [ ] **AC-13: Mirrors and dist in sync.** `npm run sync-templates:check` passes (the `templates/` mirrors of `docs/pipeline-orchestrator.md` and `.claude/skills/canon-pipeline/SKILL.md` match their roots, with no canon-internal path leaks), and `npm run build` reproduces committed `dist/` byte-identically.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/state.ts` | Add the exported reroute admission predicate |
| `src/orchestrator/main.ts` | Gate calls the shared predicate; remove local `REROUTE_ADMITTED_PHASES`; banner (`describeRerouteEntryPhase`) and rejection summary/message name implement and code_review sub-state and the full rule |
| `src/orchestrator/review-loop.ts` | `buildCodeReviewReason()` names the amend-and-`--reroute` path |
| `src/task/index.ts` | `specGateDoneNote()` calls the shared predicate; remove local set and its "Mirrors…" comment; update "will not fire" text |
| `src/orchestrator/cli.ts` | `--reroute` help text in `printUsage()` |
| `src/orchestrator/context.ts` | `modeExplain.reroute` wording |
| `src/orchestrator/prompts/index.ts` | Reroute banners, bundle per-task line, resumed and non-resumed preamble wording; partial-round scope guidance |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Opening/steps: partial-round scope, worktree-diff current state, conditional handoff use, dirty-file handoff coverage; remove delta-only instructions |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Opening line wording; partial-round scope; handoff step; replace "Plan only the delta" |
| `src/orchestrator/prompts/templates/spec-review-reroute.md` | Opening line wording |
| `tests/run-task-reroute-preflight.test.ts` | Predicate unit tests; admit/reject rows, bundle cases, real loop-cap fixture and relabel, reset assertions, banner/message text |
| `tests/run-task-code-review.test.ts` | Loop-cap message names `--reroute` |
| `tests/task-cli.test.ts` | Spec-gate note cases |
| `tests/recovery-hints.test.ts` | Update pinned snippets; register new `--reroute` src lines |
| `tests/run-task-prompts.test.ts` | Add resumed implement-reroute golden case |
| `tests/run-task-prompts.golden.json` | Regenerate reroute keys; add resumed key |
| `docs/pipeline-orchestrator.md` | `--reroute` flags row; §Human Reroute opening, full-tier re-entry, and uncommitted-state paragraphs |
| `templates/docs/pipeline-orchestrator.md` | Mirror (via `npm run sync-templates`) |
| `.claude/skills/canon-pipeline/SKILL.md` | §6 admission sentence |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Mirror (via `npm run sync-templates`) |
| `docs/patterns.md` | §"Operator git surgery before first QA…" reroute-entry sentence |
| `docs/decisions.md` | New decision entry (AC-12) |
| `README.md` | Flags prose and command-reference `--reroute` row |
| `dist/cli/index.js` | Rebuild |
| `dist/orchestrator/run-task.js` | Rebuild |

#### Implementation Notes (non-binding; plan/implement own these)

- `getCurrentPhase()` / `deriveTopLevelStatus()` return `implement` for all implement statuses, so the predicate reads `status.phases.implement.status`, `status.phases.code_review.status`, and the two code_review current-loop counters directly; treat absent or non-numeric counters as 0.
- The reset loop already zeroes code_review `iterations_current_loop` (and the pre-flight counterpart), which keeps `shouldUseImplementRevision` from preferring the revision prompt over the reroute prompt after rerouting a mid-revision implement; AC-5 pins it.
- `archivePriorReview(..., { skipUnfilledTemplate: true })` already leaves an unfilled `review.md` in place; first-pass implement-entry reroutes hit that path. Route-back and loop-cap reroutes archive a filled `review.md` as today.
- The non-resumed implement-reroute preamble is the common case for a first-pass implement-entry reroute: Codex session ids are stored only after `runPhase` returns, so an aborted first pass has no `sessions.codex`.
- `scripts/sync-canon-templates.mjs` rejects backticked canon-internal source paths in canon-managed files; `tests/recovery-hints.test.ts`'s registry check fails on unregistered `src/` lines matching `--reroute`.

### Interaction Dependencies

- `guardConcurrentRun()` must keep running before `--reroute` handling; this task relies on it to exclude live runs.
- `reset-code-review`'s `blockedAtImplementEntry` recognises the loop-cap state; the predicate admits a superset of it (no change to `reset-code-review` itself).
- `autoCommitCode()` will refuse to commit if a dirty file is missing from the rewritten handoff — AC-9(d) exists to make that the rare case.
- `--full-send` is still cleared by `--reroute` (unchanged).
- The spec_gap exemption (`isSpecGapReroute`) is unchanged; mixed bundles become non-exempt (AC-2c).

### Data Model Changes

None. No `status.json` field is added or reinterpreted; the predicate only reads existing fields.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite
- [x] `npm run build` — committed `dist/` must match
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [ ] E2E — N/A (no UI surface)

## Docs Impact

`docs/pipeline-orchestrator.md`, `docs/patterns.md`, and `docs/decisions.md` are edited (Affected Files). `docs/codebase-map.md` may describe the reroute gate's location; QA should check it now that the predicate lives in `state.ts`. `docs/product-context.md` and `docs/architecture.md` are not expected to change.

## Known Risks

- **Delicate surface.** The gate lives on the orchestrator's routing path. An over-admitting predicate (e.g. implement `pending` with no review activity) would let a reroute reset a task whose current loop never implemented; AC-1's reject rows, including the absent-counter row, pin the boundary.
- **Counter semantics drift.** The route-back admit relies on code_review's current-loop counters being non-zero after a review round and zeroed by `reset-code-review` and reroute. If a future change zeroes them at route-back time, the route-back state silently becomes unreroutable again; AC-1's route-back row catches that.
- **Partial-round scope.** If the prompt rewrite keeps any delta-only instruction, Codex can silently skip unfinished original-AC work after a first-pass implement-entry reroute, and code_review would have to catch it. AC-9(b) names the instructions that must go.
- **Uncommitted source edits.** An implement-entry reroute leaves the aborted round's dirty source edits in the worktree; if the next handoff omits one, `autoCommitCode` fails loudly. Accepted; mitigated by AC-9(d) and documented per AC-11.
- **Stale-handoff evidence advance.** A complete handoff from a prior round can let `tryEvidenceAdvance` mark a rerouted implement done if Codex exits without marking it. Pre-existing for all reroutes; out of scope; code_review is the backstop.
- **Mixed-bundle exemption loss.** Bundling a spec_gap task with a newly admitted implement-phase task drops the exemption; operators get an amendment-required abort naming each task, which is loud and recoverable. Pinned by AC-2(c) and documented as a Non-Goal.
- **Text-surface drift.** Admission prose lives in many independently authored places; AC-8's backtick-tolerant greps and AC-11's list are the sweep.

## Human Test Plan

1. Start a task, let implementation begin, then stop the run mid-implementation. Add an amendment to the spec and reroute the task. Expected: canon accepts the reroute, the banner says it's rerouting from implement in progress, and the task goes back to spec review (or straight to implementation for an extra-small task).
2. Take a task whose code review hit its loop limit and is blocked. Read the block message: it mentions amending the spec and rerouting as an option. Add an amendment and reroute. Expected: accepted, and the banner mentions the blocked code review.
3. Step a task through one code review that asks for changes, so it stops before re-implementing. Add an amendment and reroute. Expected: accepted.
4. Take a task that has a plan but hasn't started implementing. Try to reroute. Expected: canon refuses, shows the task's state, and explains that reroute needs implementation to have begun.
5. Read the help for `canon run`. Expected: the reroute description says it works once implementation has begun.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) Partly applicable: the loop-cap and route-back rejections are deterministic code paths confirmed by reading; AC-1 makes their rows red-first
- [x] (Refactors) N/A

## Amendment

Code review (round 1, approved with nits) surfaced three guidance gaps and ten nits. The human chose to fix all of them in this task rather than defer them.

### Amendment Acceptance Criteria

- [ ] **AC-A1: Accurate auto-commit wording for leftovers (R1).** The implement-reroute prompt, `docs/pipeline-orchestrator.md` §"Human Reroute", and `docs/patterns.md` no longer claim auto-commit *refuses* every dirty file the handoff omits. They state the real behavior: a tracked file that is modified but missing from the Changes table blocks the auto-commit, while an untracked file is committed only if listed, and otherwise is left out until the QA-end check catches it. The implement-reroute prompt also tells the agent to delete aborted-round leftovers that the amendment makes obsolete rather than list them. The same tracked/untracked correction supersedes the overstatements in this spec's Known Risks ("Uncommitted source edits"), Non-Goals (`autoCommitCode()` bullet), and Interaction Dependencies (`autoCommitCode()` bullet). Verify by reading the regenerated golden entry and the two docs.
- [ ] **AC-A2: Loop-cap recovery restatements name the reroute path where it applies (R2).** The rescope paragraph after the loop-cap block in `docs/pipeline-orchestrator.md` and the "Auto-block on `spec_review` or `code_review` (loop cap hit)" section of `.claude/skills/canon-pipeline/recovery.md` name amending the spec and running `canon run <id> --reroute` as a spec-change path **only for a code_review loop-cap block** (implementation has begun, so reroute is admitted). For a spec_review loop-cap block, the text keeps the existing guidance (cap bump, normal spec revision/resume, or `reset-spec-review`) and does not suggest `--reroute`, because that state is not admitted. Any count of paths in recovery.md matches the per-block options. Both files describe this in operator terms with no canon-internal source paths. Verify by reading both files and confirming each block type lists only commands that state admits. Run `npm run sync-templates:check`.
- [ ] **AC-A3: Red-first checkpoint handles partial rounds (R3).** The implement-reroute prompt's red-first checkpoint (a) covers an original red-first AC left unfinished by a partial prior round, as well as one added or modified by the amendment, and keeps any earlier-round Red-First Evidence row that already satisfies its AC. (b) When the worktree already holds aborted-round edits, it requires the red run to happen against an isolated pre-fix state: the task branch's committed HEAD with non-test leftovers set aside, restored after the run. The confirmation contract is unchanged. If no isolated pre-fix run is possible, the agent may use only the spec's own environment-bound escape with its named deterministic alternative. Otherwise it records a `[wrong-premise]`-style Blocker and does not implement the fix on an unconfirmed premise. Difficulty isolating edits is not grounds for skipping the red run. Verify by reading the regenerated golden entries.
- [ ] **AC-A4: Prompt nits (N1–N3).** (N1) Implement-reroute step 7's handoff rewrite names unfinished original-AC and earlier-round work, not only "round-1 work that still applies". (N2) The non-resumed preamble's "not a resume" sentence makes clear it refers to the agent *session*, not to whether the prior implementation round finished. (N3) The plan-reroute append shape and feasibility pointer no longer label the section `### Delta`; they use a heading matching the amendment-plus-unfinished-work scope. The `## Reroute Plan` / `## Reroute Plan Round N` headings themselves are unchanged, because the reroute evidence gate parses them. Verify by reading the regenerated golden entries.
- [ ] **AC-A5: Operator-text consistency (N4, N5, N9).** (N4) The `canon run --help` reroute text and the spec-gate "will not fire" note carry the same "(a review round or a pre-flight rejection)" qualifier as the docs and rejection message. (N5) The `README.md` command-reference `--reroute` cell separates the admission clause from the amendment pre-flight clause so neither reads as modifying the other. (N9) When `code_review` is missing from `status.json`, an implement-phase task renders `code_review missing` in both the banner and the rejection summary, consistent with other phases. Verify with a test for N9 and by reading the rest.
- [ ] **AC-A6: Legacy counter fallback (N6), red-first.** Mechanism, confirmed by read-only probe in amendment spec_review: with implement `pending`, code_review `pending`, legacy `iterations: 1`, and `iterations_current_loop` absent, `getIterations()` in `src/orchestrator/main.ts` returns 1, but the admission predicate reads only `iterations_current_loop` and so returns false. The task is rejected even though a review round ran. Fix: the predicate and `describeRerouteEntryPhase` read the review-round count as `iterations_current_loop`, falling back to `iterations` when the current-loop field is absent. Red-first: add the admit-row test for that fixture, run it before the fix, confirm it fails because the task is rejected, apply the fix, confirm it passes, and record both runs in the handoff's Red-First Evidence. The existing all-absent reject row stays and still rejects.
- [ ] **AC-A7: Test robustness (N7, N8).** The admitted-state rows in `tests/run-task-reroute-preflight.test.ts` carry an explicit expected entry phase rather than deriving it from the row-name prefix. The banner's review-round and pre-flight-rejection detail clauses are asserted, not just the prefix. Verify by reading the tests.
- [ ] **AC-A8: Whitespace (N10).** No double blank line before the new `docs/decisions.md` heading. The new `tests/recovery-hints.test.ts` HINT_SITES entry matches surrounding formatting (no stray blank line, same key quoting style). Verify by reading.
- [ ] **AC-A9: Regression gates.** All original ACs remain met. The golden diff against the round-1 implementation commit changes only reroute-prompt keys. `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (committed `dist/` matches), `npm run sync-templates:check`, and `npm run docs-refs-check` pass.

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/prompts/templates/implement-reroute.md` | R1 auto-commit wording and obsolete-leftover guidance; R3 red-first checkpoint; N1 step 7 |
| `src/orchestrator/prompts/templates/plan-reroute.md` | N3 append-shape and feasibility heading |
| `src/orchestrator/prompts/index.ts` | N2 non-resumed preamble wording |
| `src/orchestrator/state.ts` | N6 legacy `iterations` fallback in the predicate |
| `src/orchestrator/main.ts` | N6 fallback and N9 `missing` rendering in `describeRerouteEntryPhase` |
| `src/orchestrator/cli.ts` | N4 help qualifier |
| `src/task/index.ts` | N4 spec-gate note qualifier |
| `tests/run-task-reroute-preflight.test.ts` | N6 row, N7 explicit expected phase, N8 banner detail assertions, N9 test |
| `tests/task-cli.test.ts` | N4 note-text assertion, if one pins the old text |
| `tests/recovery-hints.test.ts` | N10 formatting; snippet updates for changed `--reroute` lines |
| `tests/run-task-prompts.golden.json` | Regenerate reroute keys |
| `docs/pipeline-orchestrator.md` | R1 Human Reroute wording; R2 loop-cap rescope paragraph |
| `templates/docs/pipeline-orchestrator.md` | Mirror (via `npm run sync-templates`) |
| `.claude/skills/canon-pipeline/recovery.md` | R2 loop-cap paths |
| `templates/.claude/skills/canon-pipeline/recovery.md` | Mirror (via `npm run sync-templates`) |
| `docs/patterns.md` | R1 wording |
| `docs/decisions.md` | N10 whitespace |
| `README.md` | N5 command-reference cell |
| `dist/cli/index.js` | Rebuild |
| `dist/orchestrator/run-task.js` | Rebuild |

## Amendment Round 2

Code review of amendment round 1 halted with one spec gap, one pre-existing guardrail gap, and eleven nits. The human chose to resolve all of them here.

**Spec-gap decision: shared-branch bundle admission.** In a bundle where code review approves task A and requests changes on task B, approving A zeroes A's current-loop counters, then the route-back resets both to implement `pending` + code_review `pending`. If the run stops there, A alone carries no counter evidence, so `canon run A B --reroute` is rejected. Splitting the reroute does not work: bundled tasks share one task branch and worktree, so rerouting B alone (or resuming A alone) fails the handoff-coverage and Affected Files gates on the other task's files. Amendment review round 2 confirmed this by probe. The existing evidence that A implemented together with B is `status.json.branch`: on a bundle's first implement entry, `ensureBranch()` in `src/orchestrator/git.ts` writes the same non-empty `task/<leader>` branch into every member. The bundle admission rule therefore gains one clause, and nothing changes for counters or the schema. Writing a marker on A at route-back is still declined (it would change loop-counter semantics). Admitting a sibling without shared-branch evidence is still declined (an unstarted task could ride along).

### Amendment Round 2 Acceptance Criteria

- [ ] **AC-B1: Shared-branch sibling admission.** In a multi-task `--reroute`, a task at current phase `implement` with implement `pending`, code_review `pending`, and zero current-loop counters is admitted when (a) at least one other named task is admitted by the single-task predicate (Decision 1, unchanged), and (b) both tasks have the same non-empty `status.json.branch`. Every other task must still be admitted, either by the single-task predicate or by this clause. A task never qualifies through this clause alone. A bundle where no member passes the single-task predicate is rejected. The single-task predicate (used by `specGateDoneNote()` and the single-task gate) is unchanged. Verify in `tests/run-task-reroute-preflight.test.ts` with these rows:
  - A (approved sibling, zero counters, `branch: task/A`) + B (`iterations_current_loop: 1`, `branch: task/A`): admitted, and both tasks are reset per AC-5.
  - The same pair with A's `branch` empty: rejected.
  - The same pair with A's `branch` set to a different branch: rejected.
  - Two tasks at implement `pending` with zero counters and the same branch (both freshly rerouted): rejected.
  - A single task with zero counters and a non-empty branch: rejected.

  Each rejected row asserts `status.json` is unchanged. For the admitted row, a test drives the rerouted A+B pair to code_review entry, or calls the downstream handoff-coverage and Affected Files checks directly, with distinct A and B source files. It asserts that neither check reports the other task's file, confirming the recovery passes the gates that the split-run advice failed.
- [ ] **AC-B2: Single-task next step (nit 11).** When a single implement `pending` task with zero counters and no blocked code_review is rejected, the message tells the operator how to proceed. If the task is mid-reroute (`implement.rerouted` true), revise the current amendment and run plain `canon run <id>`. Otherwise, revise the spec or plan and run plain `canon run <id>`. Verify with tests for both variants.
- [ ] **AC-B3: Rule documented.** `docs/pipeline-orchestrator.md` §"Human Reroute" and the canon-pipeline skill's reroute section state the shared-branch sibling clause in operator terms ("an approved bundle sibling is admitted alongside a task that qualifies, when both belong to the same task branch"). `docs/decisions.md`'s reroute-from-implement entry records the clause and the two declined alternatives in one or two sentences. Neither doc advises rerouting a subset of a shared-branch bundle. The rejection message for a partially admitted bundle lists which tasks qualify and which do not, and does not suggest splitting the bundle. Verify by reading, plus a rejection-text test.
- [ ] **AC-B4: Archived findings pointer (red-first).** Mechanism, confirmed by a fixture probe in amendment review round 2: reroute archives `review.md` to `review-prior-<n>.md`, and the archive lookup finds it. But `priorReviewReference()` in `src/orchestrator/prompts/index.ts` is reached only for an exempt failing sibling, so the non-exempt branches of `promptImplementReroute()` and `promptPlan()` never name the archive. Meanwhile `docs/pipeline-orchestrator.md` says "Archived findings remain binding". Fix: for every non-exempt rerouted task with an archived `review-prior-<n>.md`, both prompts point at the highest-numbered archive and state that its unresolved findings remain binding unless the amendment supersedes them. When no archive exists, they say nothing about one. Red-first: write the with-archive prompt assertions for both builders, run them before the fix, confirm they fail because the pointer is absent, apply the fix, confirm they pass, and record both runs in the handoff's Red-First Evidence. The no-archive assertions are the negative case and pass both before and after the fix.
- [ ] **AC-B5: Red-first set-aside covers untracked files (nit 3).** The implement-reroute red-first step directs moving untracked non-test leftovers out of the worktree, not only restoring tracked paths to their committed contents. It directs confirming the set-aside copies exist before the red run, and restoring every set-aside file afterwards. Verify by reading the regenerated golden entry.
- [ ] **AC-B6: Single source for the review-round count (nits 4, 5).** One exported helper computes the code_review current-loop review-round count, `iterations_current_loop` falling back to `iterations`. `getIterations()` in `src/orchestrator/main.ts`, the admission predicate, and `describeRerouteEntryPhase` all use it. Its handling of `null` and other invalid values is tested, and `docs/decisions.md` describes the same behavior. Verify by grep over `src/orchestrator/main.ts`, `src/orchestrator/state.ts`, and `src/task/index.ts`: no production code_review consumer (including `getIterations()` and `buildPipelineState()`) re-implements the `iterations_current_loop ?? iterations` chain outside the helper. The generic `phaseIterationCount()` contract and test-fixture builders are out of scope. Also verify the test rows.
- [ ] **AC-B7: Wording and cosmetic nits (1, 2, 6, 7, 8, 9).** (1) The non-resumed preamble says "not a resume of a prior session" rather than assuming an interruption. (2) recovery.md Path B's trigger text distinguishes a spec_review block (the stale target is spec text) from a code_review block (the stale target is code or handoff), in both root and mirror. (6) The rejection rule sentence no longer repeats "implementation has begun". (7) The canon-pipeline SKILL.md §6 heading matches the broadened rule, keeps the `### 6.` ordinal, and stays consistent in the mirror. (8) A missing `implement` entry renders `implement missing`, consistent with `code_review missing`. (9) The `isRerouteAdmitted` import in `src/task/index.ts` is in sorted position. Verify by reading. Add a test for (8).
- [ ] **AC-B8: Bundle admission test asserts state (nit 10).** The bundle admit scenario in `tests/run-task-reroute-preflight.test.ts` asserts post-reroute `status.json` fields and the banner for both tasks, not just exit status. Verify by reading.
- [ ] **AC-B9: Regression gates.** All earlier ACs (original and round 1) remain met. Golden changes are limited to reroute-prompt keys plus any new archive-pointer keys. `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (committed `dist/` matches), `npm run sync-templates:check`, and `npm run docs-refs-check` all pass.

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/main.ts` | AC-B1 shared-branch bundle clause and B3 rejection listing; B2 rejection message; B6 `getIterations()` uses the shared helper; B7(6,8) rejection wording and `implement missing` |
| `src/orchestrator/state.ts` | B6 shared review-round helper |
| `src/task/index.ts` | B7(9) import order |
| `src/orchestrator/prompts/index.ts` | B4 archive pointer plumbing; B7(1) preamble wording |
| `src/orchestrator/prompts/templates/implement-reroute.md` | B4 archive pointer; B5 untracked set-aside |
| `src/orchestrator/prompts/templates/plan-reroute.md` | B4 archive pointer |
| `src/orchestrator/prompts/templates/qa.md` | Post-QA inline fix (human-approved): `Human reroute?` counts a human reroute at any phase |
| `tests/run-task-reroute-preflight.test.ts` | B1, B2, B6, B7(8), B8 tests |
| `tests/run-task-prompts.test.ts` | B4 with-archive and no-archive prompt cases |
| `tests/run-task-prompts.golden.json` | Regenerate reroute keys; add archive-pointer keys |
| `tests/recovery-hints.test.ts` | Register new or changed `--reroute` source lines |
| `docs/pipeline-orchestrator.md` | B3 limitation and path |
| `templates/docs/pipeline-orchestrator.md` | Mirror (via `npm run sync-templates`) |
| `.claude/skills/canon-pipeline/SKILL.md` | B3 limitation; B7(7) heading |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Mirror (via `npm run sync-templates`) |
| `.claude/skills/canon-pipeline/recovery.md` | B7(2) Path B trigger |
| `templates/.claude/skills/canon-pipeline/recovery.md` | Mirror (via `npm run sync-templates`) |
| `docs/decisions.md` | B3 decision note; B6 null-handling wording |
| `dist/cli/index.js` | Rebuild |
| `dist/orchestrator/run-task.js` | Rebuild |
