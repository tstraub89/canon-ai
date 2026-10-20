# Code Review: agent-failure-parks-phase

> Reviewer: Claude | Spec: `tasks/agent-failure-parks-phase/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

This review was synthesized by a foreman from three lenses: an anchored Claude lens (Stage 1 / Stage 2 charter), a cold-Claude lens that saw only the diff, and a cold-Codex lens that the orchestrator ran beforehand. All three lenses returned valid results.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens re-ran `npm test` in the worktree: 1490 tests, 1490 pass, 0 fail. It also confirmed that a scratch `npm run build` reproduces `dist/orchestrator/run-task.js` and `dist/cli/index.js` byte for byte. For AC-2, AC-3, AC-4 and AC-13, it checked the red-first claims against a scratch copy of the pre-fix source.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: no `process.exit` in non-interactive failure ladders | Pass | The only `process.exit` left in `claude.ts` is the interactive branch (line 94). `codex.ts` has none; its interactive path goes through `runCommandOrDie`. The cold-Codex failure throws (`code-review.ts:437`). |
| AC-2: failure-ladder unit test throws `AgentSessionError` | Pass | Covers Claude `exit_code` and Codex `spawn_error`/`stalled`/`signal`, checking kind and reason. The Codex non-zero-exit case still prints `after-runCodex`. Red on pre-fix. |
| AC-3: end-to-end plan park | Pass | Exit 2, `plan: blocked`, one escalation matching `/claude session exited 1/` and `/canon run/`, `auto_block_count` 1, exit marker and banner. Red on pre-fix. |
| AC-4: Codex implement stall park | Pass | Exit 2, `implement: blocked`, escalation written. Red on pre-fix. |
| AC-5: plain re-run recovers | Pass | The same fixture swaps in a succeeding fake. With no reset, `plan` reaches `done`. |
| AC-6: QA salvage not reached | Pass | The real `runQaPhase` rejects and `done.md` is not written. The test is not vacuous: the stdout matches the salvage regex, and the missing file counts as a template. |
| AC-7: cold-Codex failure throws | Pass | Rejects with `AgentSessionError` (agent `codex`) and the foreman never runs. The main-loop park relies on the shared catch, which AC-3 and AC-4 exercise. |
| AC-8: crashed spec_review park is durable | Pass | Asserts `blocked`, `auto_block_count` 1, one escalation with iteration_count 1 and a `canon run` reason. The self-bookkept and clean-exit tests still pass. |
| AC-9: non-agent errors not parked | Pass | A plain Error exits 1 with no escalation and no banner; a typed positive control parks (see nit N5 on the path this test takes). |
| AC-10: failed metric row | Pass | The `CANON_METRICS_FILE_OVERRIDE` file gets a `failed` claude/plan row. |
| AC-11: docs | Pass | `patterns.md`, `pipeline-orchestrator.md` (+ mirror), `architecture.md` and `recovery.md` (+ mirror) are all updated as listed. A few neighbouring surfaces are slightly imprecise (nit N3); none says an agent failure kills the orchestrator. |
| AC-12: full validation | Pass | All six checks pass (see the Validation Gate above). |
| AC-13: bundle partial completion | Pass | The signal case (new boundary) and the returning exit-1 case (Decision 5) both reopen A and B as `blocked` at spec_review with escalations. The bundle re-run then advances both to `plan`. Red on pre-fix. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is tight and matches the spec's design. The typed error is narrow, there is a single catch point in `main()` that rethrows anything that is not an `AgentSessionError`, and no phase runner catches the error locally. Every `runClaude`/`runCodex` call site sits inside the boundary: the phase runners and `retryAgentForPhase`, which runs from `checkAndRoute`'s per-member completion loop before any routing write. The tests are real and red-first. No code-bug survived adjudication.

One design consequence is real and should be seen at human_review; it is recorded under Risk / Guardrails (R1). The spec covers it (Decisions 4 and 7 plus an accepted Known Risk), but it is broader than the bundle framing those sections use.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- **R1 — A phase the agent already marked `done` is reopened even for a single task. Flagged by 2 lenses (anchored, cold-Claude). Classified as spec-intended; worth a human look.**
  - **Location:** `src/orchestrator/main.ts:3215-3233`.
  - **Scenario:** the code_review foreman runs `canon task phase <id> code_review done approved`, then exits non-zero (for example on the `--max-budget-usd` cap during its last turn). Or a Codex implement session marks `done` and is then stalled or signalled at teardown.
  - **Before this change:** the process died with the phase `done`, and the next run continued from there.
  - **Now:** the phase becomes `blocked` and is redone in full: cold-Codex, both lenses and the foreman. The counters from the first verdict are kept, so a `changes_requested` round counts twice toward the loop cap.
  - **Inconsistency:** a Codex `spec_review` with a self-bookkept `done` and a non-zero *exit code* still continues (`pipeline-orchestrator.md`, the "Crashed Codex `spec_review`" paragraph).
  - **Spec evidence that this is intended:**
    - Decision 4 applies `autoBlockPhase` over the full bundle on every caught `AgentSessionError`, with no done-check.
    - Decision 7 reopens "members whose status was `done`".
    - Known Risk "Bundle reopen redoes completed work (accepted)" names exactly these costs: the extra session, a possibly different verdict, and the double-counted round.
  - **Why it still matters:** the spec frames all of this as a bundle concern. The single-task, all-members-done case was not discussed, and that is the budget-exhaustion-in-foreman scenario the issue cites.
  - **Possible follow-up (not required here):** if every member already has `phases.<phase>.status === 'done'` when the error is caught, skip the park and continue to `checkAndRoute`. That keeps Decision 7 for split bundles and honors a self-bookkept completion the same way the Codex rule does.
  - **Status:** not routed back, because the implementation does what the spec decided.
- **R2 — Parked `implement` re-runs fresh instead of resuming (cold-Claude).**
  - **Location:** `src/orchestrator/phases/implement.ts:81`.
  - **Mechanism:** `wasImplementInProgress` keys off `in_progress`. A crash-parked `implement` is now `blocked`, so a non-revision, non-reroute re-run uses the fresh prompt and does not resume a stored `codex` session.
  - **Accepted:** plan.md documents this as a known consequence, along with the reasons it is not a misroute. The failed session's ID is never stored (a spec Non-Goal), partial edits stay on disk, and `implement.ts` is outside the Affected Files. Possible follow-up item.

#### Optional Cleanup / Nit

- **N1 — Missing end-to-end `code_review` re-entry test (anchored).**
  - **Location:** `tests/run-task-safety.test.ts`.
  - **Why it matters:** `checkAndRoute` turns any `code_review: blocked` into `stopForReviewerBlock()` (`main.ts:3265`). A crash-parked review re-enters correctly only because `runCodeReviewPhase` writes `in_progress` (`code-review.ts:392`) before the cold-Codex and foreman sessions.
  - **Current state:** plan.md argues the path does not differ, so the spec's conditional test was skipped. That holds by trace today.
  - **Recommendation:** add a cheap test that parks `code_review` and re-runs it. A future reorder that runs the cold review before the `in_progress` write would otherwise send crash-parks to the reviewer-block banner, which advises `reset-code-review` (archiving review.md).
- **N2 — Double period in the cold-Codex reason (anchored).**
  - **Location:** `src/orchestrator/phases/code-review.ts:443` with `main.ts:3216`.
  - The reason ends "…has not advanced.", and `parkAgentSessionFailure` appends `. ${recovery}`, so the escalation and banner read "…has not advanced.. Fix the cause…".
  - The reason also says "Re-run when Codex is available" right before a recovery line about auth and credits. Drop the trailing period or the redundant sentence.
- **N3 — Neighbouring docs are slightly imprecise; none contradicts the new behavior.**
  - `docs/architecture.md:174` still says `autoBlockPhase()` "sets the review phase's status" and lists only loop-cap recovery. It now also parks plan, implement, qa and spec (cold-Claude).
  - `docs/product-context.md:76` (Flow 3) still says to reset the phase to `pending` after an "unexpected error". That is harmless but now unnecessary for agent failures (anchored).
  - `recovery.md` covers only "Agent auth 401". An operator who sees `blocked` from budget, stall or Codex quota may land on the loop-cap or reviewer-block sections first. A generic "Agent session failed (`AGENT SESSION FAILED` banner)" heading would help, though the banner and escalation already name the recovery command (anchored).
  - `pipeline-orchestrator.md:442`'s cold-Codex paragraph doesn't mention the park; line 387 covers it (anchored).
- **N4 — The recovery clause is built in two places (anchored).**
  - **Location:** `main.ts:3212` and `main.ts:3294-3299`.
  - The "Fix the cause (…), then re-run `canon run <ids>`" wording is written independently in each, and the cause lists already differ.
  - The agent-dependent clause (Claude → `CLAUDE_BUDGET`, Codex → credits/quota) is not pinned by a match/doesNotMatch pair. See patterns.md "Build a state-dependent operator message from one parameterized clause builder".
- **N5 — Two tests assert on less than they could (anchored).**
  - The AC-9 test drives `void withAgentSessionPark(...)`, so a plain error goes through cli.ts's `unhandledRejection` handler. Production goes through run-task.ts `main().catch`. The core claim (no park, exit 1) holds on both paths.
  - `assert.equal(done.status, 'implement')` (`run-task-safety.test.ts:8771`, and the `'plan'` checks in AC-13) asserts the pointer the fake completer writes, not anything production derives. Asserting `getCurrentPhase(...)` would be stronger.
- **N6 — Park I/O runs before `setExitReason` (cold-Claude).**
  - **Location:** `main.ts:3203-3223`.
  - `parkAgentSessionFailure` reads and writes status before it sets the exit reason. If `readStatus` or `autoBlockPhase` throws (corrupt status.json), the original agent-failure reason is lost from the exit marker.
  - Setting the exit reason first is a one-line hardening.

#### Spec Gaps

(none blocking — see R1 for the single-task case that the spec's bundle framing did not discuss explicitly; the spec's Decision 4 + accepted Known Risk cover it as written)

### Dismissed Cold Findings

- Dismissed (cold-Claude): A reopened bundle member's re-run could advance from a stale artifact through `tryEvidenceAdvance` if the re-run Codex exits 0 and skips bookkeeping.
  - The verdict it would read is the genuine verdict from the crashed run's completed review of that member, not a fabricated one. Evidence recovery on a clean exit is pre-existing and unchanged behavior.
  - The counter double-count is the cost the spec's Known Risk "Bundle reopen redoes completed work (accepted)" names.
- Dismissed (cold-Claude): Agent-failure parks share `auto_block_count` and escalations with loop-cap blocks, so `canon watch`/`canon-status` can't tell them apart.
  - The spec chose `autoBlockPhase` deliberately (Decision 4) and accepted the counter inflation (Known Risk "`auto_block_count` inflation").
  - `canon-status` SKILL.md:39 already reads "Loop cap hit **or blocked**", and watch's `auto_block` classification is the intended Decision 6 behavior.
- Dismissed (cold-Claude): `--step` contract comment (`main.ts:3827`) says a failed sub-agent exits 1.
  - That comment describes the phase-didn't-advance check ("sub-agent failed without calling canon task"), which still exits 1.
  - A thrown session failure is a different path, and exit 2 is the existing auto-block code the spec chose (Decision 4).
- Dismissed (cold-Claude): The `pipeline-orchestrator.md:389` paragraph is self-contradictory.
  - The same paragraph says a completed bundle member is reopened. "Self-bookkept `done` continues" still holds when every member is done.
  - "`code_review` cannot trigger this Codex-specific park" refers to the `shouldParkCrashedReview` path, which is still true; the cold-Codex park has its own paragraph at line 387. Covered by N3 at most.
- Dismissed (cold-Claude): The cold-Codex failure uses `kind: 'exit_code'` with `exitCode: null`.
  - The spec mandates `AgentSessionError` with agent `codex` but no kind (Decision 3). The handoff records the interpretation under Blockers [ambiguity].
  - No consumer branches on `kind` today. The "legitimately empty findings re-parks" scenario is pre-existing hard-fail behavior (decisions.md: cold-Codex lens hard-fails).
- Dismissed (cold-Claude): The `exit_code` variant of the AC-13 bundle test doesn't reach the new boundary.
  - That is by design: AC-13's second case explicitly targets the Decision 5 `shouldParkCrashedReview` park, and the `signal` variant covers the new boundary.
- Dismissed (cold-Claude): The shared fake completer change (`plan` → `implement`) may affect other tests.
  - It corrects a stale top-level pointer to match what real `canon task phase` derives through `writeStatus`. The anchored lens confirmed that production derives the phase from `phases`.
  - The full suite passes (1490/1490).
- Dismissed (cold-Claude): `human_review` could be parked as `blocked`.
  - No agent session runs in `human_review` today, so this is unreachable.
  - The `phase === 'complete'` rethrow is likewise unreachable and exists for type narrowing.
- Dismissed (cold-Codex): none to dismiss. Cold-Codex reported no actionable regressions.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

Human attention at human_review: R1 (single-task self-bookkept `done` is reopened and redone on a later agent failure) is spec-sanctioned but broader than the spec's bundle framing; consider a follow-up issue.

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
