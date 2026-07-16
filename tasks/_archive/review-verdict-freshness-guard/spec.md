# Spec: review-verdict-freshness-guard — Reject stale review verdicts from crashed agent invocations

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

When a Codex `spec_review` invocation exits non-zero but the phase is still `in_progress` (the agent did not run its own `canon task phase` bookkeeping), the orchestrator's recovery path reads a verdict straight out of the on-disk artifact and advances the phase. It never checks whether the review actually completed. So when the reviewer crashes before producing a fresh verdict (out-of-credits, rate-limit, auth, MCP crash), the artifact still holds the **prior round's** verdict, and the orchestrator fabricates a review that never happened — and inflates the durable iteration counters in the process.

**Confirmed control flow** (verified by reading the source this session). The crash path is **not symmetric across the two review phases**:

1. Only a **Codex non-zero exit** returns to the dispatch loop and reaches recovery. `runCodex()` calls `process.exit(1)` on spawn-error / stall / signal ([`scripts/run-task/agents/codex.ts:110`–125](scripts/run-task/agents/codex.ts)) but on a **non-zero exit code it returns** with a `warn(...)` ([`codex.ts:127`–130](scripts/run-task/agents/codex.ts)). "Out of credits" is exactly this case: `codex exec` prints the error and exits status 1. The dispatch loop then records `lastCodexExitStatus = phaseResult.exitCode` for a Codex phase ([`scripts/run-task/main.ts:3454`](scripts/run-task/main.ts)).
2. `runClaude()`, by contrast, calls `process.exit(...)` on **every** failure mode — spawn-error, stall, non-zero exit code, and signal ([`scripts/run-task/agents/claude.ts:188`–208](scripts/run-task/agents/claude.ts)). A crashed Claude agent therefore **never reaches `checkAndRoute()`**. Additionally, the dispatch loop forces `lastCodexExitStatus = 0` for any Claude-owned phase ([`main.ts:3454`](scripts/run-task/main.ts)). Because `code_review` is a Claude phase, a `code_review` crash both (a) never returns to recovery and (b) could never set the Codex exit signal even if it did.
3. **Net:** among the two review phases, the only crash that reaches recovery with a non-zero exit signal is **Codex `spec_review`**. `code_review` reaches recovery only on a *clean* exit where the Claude foreman skipped its own bookkeeping — a completed review, so advancing on its artifact is correct, not a bug.

Given a `spec_review` that reached `checkAndRoute()` not-`done` after a non-zero exit:

4. `checkAndRoute()`'s not-`done` block calls `recoverPhaseForTask()` → `tryEvidenceAdvance()` ([`main.ts:3037`–3046](scripts/run-task/main.ts), [`:2980`](scripts/run-task/main.ts), [`:2825`](scripts/run-task/main.ts)) — it does **not** consult `lastCodexExitStatus` before trusting the artifact.
5. `tryEvidenceAdvance()` reads the artifact, calls `extractCheckedVerdict()` (or `checkRerouteEvidence()`), and — with **no completion check** — calls `taskPhase(taskId, 'spec_review', 'done', verdict)` with whatever verdict is on disk ([`main.ts:2841`–2862](scripts/run-task/main.ts)). `extractCheckedVerdict` reads file content only and returns any checked box in the latest `## Round` scope (or the whole file) ([`scripts/run-task/validation.ts:870`–881](scripts/run-task/validation.ts)) — it has no notion of which invocation produced the verdict.
6. `taskPhase(..., 'done', verdict)` routes through `updateReviewCounters()`, which **unconditionally** increments `iterations_current_loop`, `iterations_total`, and (for `changes_requested`/`needs_re_review`) `changes_requested_total` ([`src/task/index.ts:394`–415](src/task/index.ts)).
7. `checkAndRoute()` then logs `Phase '<phase>' completed despite Codex exit status N (likely MCP warnings). Continuing.` ([`main.ts:3053`–3056](scripts/run-task/main.ts)) — treating a crash as a benign exit-code-noise completion.
8. The inflated `iterations_current_loop` is what `autoBlockSpecReview` compares against `specReviewLoopCap` ([`scripts/run-task/phases/spec-review.ts:99`–111](scripts/run-task/phases/spec-review.ts)), so phantom rounds can trip a **false auto-block**.

**Why "trust the artifact after a non-zero exit" is unsound at the root.** On a non-zero exit the orchestrator cannot distinguish two states that produce the *same* on-disk artifact: (a) the review completed and then the process emitted a non-zero MCP warning on shutdown (verdict is real), versus (b) the review crashed and never touched the artifact, leaving the prior round's verdict extractable (verdict is stale). The current code optimistically assumes (a) — the "(likely MCP warnings). Continuing." message *is* that assumption — which is precisely why it fabricates a review in case (b). No purely in-band signal recovers this distinction as long as `extractCheckedVerdict` recognizes a verdict checkbox anywhere in its scope (see Non-Goals / deferred alternative); a non-zero exit therefore has to be treated as "the review did not complete."

**How it was confirmed**: reproduced live this session. During a `spec_review` (reroute amendment review) for the `task-metadata-helpers` + `canon-snapshot-robustness` bundle, the Codex workspace ran out of credits. `codex exec` printed `ERROR: Your workspace is out of credits` and exited status 1 on two consecutive runs — the non-zero-exit-returns path in step 1, and it wrote nothing to the artifact before exiting. Each crashed run recorded a phantom `changes_requested` (the prior real round's verdict). Combined with one genuine `changes_requested`, `iterations_current_loop` reached 3 = the default cap and the pipeline auto-blocked — even though the revised amendment had never been reviewed. After credits were restored and the counter was reset, the real review ran and approved on the first try, confirming the two intervening verdicts were pure crash artifacts. The reroute `## Amendment Review` round check (`checkRerouteEvidence`, [`validation.ts:279`–287](scripts/run-task/validation.ts)) did not catch it: the crashed re-review was a revision iteration *within the same reroute round*, so the prior iteration's round-N section — with its checked verdict — still satisfied the round-scoped slice. Round granularity is coarser than invocation granularity.

This corrupts the durable iteration counters — the exact signal the operator rule *"never reset iteration counters; the counter is durable signal"* is meant to protect.

> **Design-history note (why the mechanism changed at round 3).** Two prior `spec_review` rounds rejected in-band verdict-freshness mechanisms (round 1: whole-file mtime/size fingerprint cannot prove the *verdict* is fresh; round 2: verdict-scope *invalidation* is structurally impossible because `extractCheckedVerdict` has no `## Verdict`-section locator, and invalidating the latest scope destroys completed-round history). Both rejections share one root: any mechanism that makes the shared, cumulative artifact self-describe freshness fights the parser's loose grammar and the artifact's append-only-history role. This revision stops chasing in-band freshness and takes the smaller, fully **fail-closed** fix — park on the crash — deferring general freshness to a follow-up (see *Non-Goals*).

## Decision

The recovery path must not treat a **non-zero-exit Codex `spec_review` invocation** as a completed review. When the reviewer's process exited non-zero and the phase did not reach `done` via the agent's own bookkeeping, the orchestrator **parks for human action** instead of reading a verdict from the artifact.

Behavior changes:

1. **Park on a crashed Codex `spec_review` (core, fail-closed).** In `checkAndRoute()`'s `phaseStatus !== 'done'` block ([`main.ts:3037`](scripts/run-task/main.ts)), **before** `recoverPhaseForTask()`, when the phase is `spec_review` **and** `lastCodexExitStatus !== 0`, the orchestrator emits an actionable error and `process.exit(2)` — the same halt mechanism as the existing "Stopping for human review" path. It does **not** call `recoverPhaseForTask()` (so no verdict is extracted, `taskPhase` is never called, and the counters are untouched), does **not** run the one-shot agent retry (futile for out-of-credits/auth), and does **not** print the misleading "completed despite Codex exit status N (likely MCP warnings). Continuing." line. This single change fixes all three symptoms (phantom verdict, counter inflation, false auto-block), because each rides the `taskPhase` call the park now precedes.
2. **The branch is Codex-`spec_review`-only by construction.** `lastCodexExitStatus` is non-zero only for a returning Codex phase; `code_review` is a Claude phase forced to `0`, and `runClaude` `process.exit`s on crash so a crashed Claude never reaches recovery. Gating on `phase === 'spec_review' && lastCodexExitStatus !== 0` therefore cannot fire for any other phase.
3. **Actionable, recoverable-condition messaging.** The park error names the operator-fixable nature of the failure: e.g. "Codex spec review exited with status N and did not complete — no verdict was recorded this round. This is typically out-of-credits, auth, network, or an MCP crash. Fix the cause, then re-run `canon run <id>`."
4. **Benign paths are unchanged.** (a) A `spec_review` that reached `done` via the agent's own bookkeeping continues even when the Codex exit was non-zero — the park branch is nested inside the `phaseStatus !== 'done'` block, so it never fires for a `done` phase; the "completed despite exit status" note may still print there (the review genuinely ran). (b) A `spec_review` that exited **cleanly** (`lastCodexExitStatus === 0`) but skipped `canon task` bookkeeping is still auto-advanced from its freshly written verdict by `recoverPhaseForTask()`, with counters incremented exactly as today. (c) `code_review`, `plan`, `implement`, and `qa` recovery are untouched.

## Non-Goals

- **In-band per-invocation verdict freshness is explicitly deferred, not attempted here.** Preserving auto-advance for the one benign sub-case that this fix now parks (a genuine verdict produced *and then* a non-zero exit *and* skipped self-bookkeeping) would require the orchestrator to distinguish a newly produced verdict from a stale prior one inside the shared cumulative artifact. Because `extractCheckedVerdict` recognizes a verdict checkbox **anywhere** in its scope (there is no structural `## Verdict`-section locator), no artifact-fingerprint or artifact-mutation scheme can prove verdict freshness without first tightening that parser — a change to a load-bearing symbol also used by `checkPhaseGate` and reroute evidence extraction ([`validation.ts:279`–287](scripts/run-task/validation.ts), [`:870`–881](scripts/run-task/validation.ts)). That grammar-tightening plus a freshness engine is a distinct, larger task and is left as a documented follow-up in `docs/BACKLOG.md`.
- **No park branch for `code_review`.** A crashed Claude `code_review` `process.exit`s before recovery, and a clean-exit `code_review` that skipped bookkeeping is a *completed* review whose artifact verdict is genuine — advancing it is correct. There is no confirmed `code_review` stale-verdict bug; adding a guard there would require the agent-wrapper refactor below.
- **Not** changing the agent-wrapper `process.exit` behavior. The adjacent backlog bug — a non-zero agent-CLI exit can kill the whole orchestrator via the `process.exit` ladders in `agents/claude.ts` / `agents/codex.ts` ([`docs/BACKLOG.md`](docs/BACKLOG.md), the deferred "Bug 2" whose scope note reads *"no agent CLI exit may `process.exit` the orchestrator"*) — is a distinct failure mode. This task adds a cross-reference under a shared "agent-failure ≠ phase success" theme; it does not change `process.exit` behavior.
- **No captured-output unavailability-signature classifier.** The park message names the likely recoverable causes generically; parsing Codex stdout/stderr to name the *specific* condition (out-of-credits vs. auth vs. rate-limit) is possible future polish and is out of scope (it would also force `PhaseRunResult` to carry captured output, which this fix does not need).
- **No** automatic retry/backoff for transient agent failures.
- **No** change to any exit-0 routing, the genuine agent-self-bookkeeping path, the verdict semantics, `extractCheckedVerdict`/`checkRerouteEvidence`, or the `updateReviewCounters` increment rules.

## Acceptance Criteria

> This is a bug fix. The repro is deterministic and constructed entirely from on-disk task state (a stale `spec-review.md` + `status.json`) plus a simulated non-zero Codex exit; no live agent or network is required, so the environment-bound-repro escape clause does not apply. AC-1 is the red-first regression: it fails on pre-fix code (which advances on the stale verdict and inflates the counters) and passes after the fix.

- [ ] **AC-1 (park + counters protected + no phantom advance — red-first regression):** An integration test seeds `tasks/<id>/status.json` with known counter values, `spec_review` `in_progress`, and a stale `spec-review.md` holding a checked `changes_requested`, then drives the production dispatch→`checkAndRoute` sequence such that the Codex `spec_review` invocation exits non-zero (`lastCodexExitStatus !== 0`). It asserts: the process exits `2`; the phase stays not-`done`; no verdict is written to `status.json` for this round; and `iterations_current_loop`, `iterations_total`, `changes_requested_total` are byte-for-byte unchanged. Reverting the fix (removing the park branch) makes the test fail because recovery advances on the stale verdict and inflates the counters. Verify: this test is red on pre-fix `main.ts`, green after. (Test-seam mechanics — subprocess with a stubbed non-zero-exit Codex, or a pure `shouldParkCrashedReview(phase, phaseStatus, codexExitStatus)` predicate plus an exit-2 integration case — are the implementer's call; the subprocess/real-git integration pattern lives in `tests/run-task-safety.test.ts`.)
- [ ] **AC-2 (actionable park message):** The park emits an error naming (a) the non-zero exit code, (b) that no verdict was recorded this round, (c) the likely recoverable causes (out-of-credits / auth / network / MCP crash), and (d) the re-run instruction. Verify: the AC-1 test (or a sibling) asserts these substrings appear before exit `2`.
- [ ] **AC-3 (benign done-phase + non-zero exit does NOT park):** With `spec_review` already `done` (agent self-bookkept) and `lastCodexExitStatus !== 0`, `checkAndRoute` continues without exiting `2` and without invoking the retry — this is the path the new branch (also keyed on non-zero exit) is most at risk of regressing. Verify: a done-phase + non-zero-exit test asserts the run proceeds past the not-`done` block (the existing "(likely MCP warnings). Continuing." note may still print).
- [ ] **AC-4 (benign clean-exit skipped-bookkeeping still advances):** With `spec_review` `in_progress`, `lastCodexExitStatus === 0`, and a freshly written checked verdict on disk, `recoverPhaseForTask` auto-advances the phase from that verdict with `iterations_current_loop`/`iterations_total` incremented exactly as today. Verify: a clean-exit fresh-verdict test asserts `advanced: true`, the correct recorded verdict, and the counter increment — confirming the fix is scoped to the non-zero-exit crash and does not touch clean-exit recovery.
- [ ] **AC-5 (branch is `spec_review`-only — no over-broadening):** The park branch does not fire for `code_review`, `plan`, `implement`, or `qa`. Verify: a `code_review` not-`done` recovery test (Claude phase, `lastCodexExitStatus` forced `0`) behaves exactly as today (recovers via `tryEvidenceAdvance` / retry, no exit `2`); plus a structural assertion that the park condition names `spec_review` and `lastCodexExitStatus !== 0`.
- [ ] **AC-6 (recovery docs updated):** [`docs/pipeline-orchestrator.md`](docs/pipeline-orchestrator.md)'s recovery/auto-advance section documents that a crashed Codex `spec_review` (non-zero exit, phase not `done`) parks for operator action rather than advancing, states the fail-closed rationale (a non-zero exit is not a completed review), and names the benign-sub-case tradeoff (a genuine verdict + non-zero exit + skipped bookkeeping now parks and must be re-run). Verify: the section names the park-and-re-run behavior and the rationale.
- [ ] **AC-7 (patterns pitfall):** [`docs/patterns.md`](docs/patterns.md) gains a Known Pitfall: a non-zero agent exit is not a completed review; the recovery path must not read a verdict from the artifact after a non-zero Codex `spec_review` exit — it must park. Verify: grep finds the pitfall.
- [ ] **AC-8 (backlog cross-reference + deferred-freshness follow-up):** [`docs/BACKLOG.md`](docs/BACKLOG.md)'s deferred agent-CLI-exit "Bug 2" entry (the *"no agent CLI exit may `process.exit` the orchestrator"* item) cross-references this fix under a shared "agent-failure ≠ phase success" note, and a backlog item records the deferred in-band verdict-freshness work (tighten `extractCheckedVerdict` to a structural verdict-section locator, then add per-invocation freshness so the parked benign sub-case can auto-advance again). Verify: grep finds both the shared-theme cross-reference and the deferred-freshness item.
- [ ] **AC-9 (build determinism):** After `npm run build`, every regenerated `dist/` bundle is committed and `git diff --exit-code -- dist/` is clean. `dist/scripts/run-task.js` changes (it bundles `main.ts`). This task touches only `main.ts` (plus docs/tests) — not `validation.ts` — so `dist/cli/index.js` is not expected to change; commit and declare it in the handoff **only if** `npm run build` actually touches it. Verify: CI's `npm run build && git diff --exit-code -- dist/`.

## Design

### Approach

- **Park site & timing.** The park lives in `checkAndRoute()`'s `phaseStatus !== 'done'` block ([`main.ts:3037`–3046](scripts/run-task/main.ts)), evaluated **before** `recoverPhaseForTask()` is called. Condition: `phase === 'spec_review' && lastCodexExitStatus !== 0`. On match: log the actionable error and `process.exit(2)`. On no match: fall through to the existing `recoverPhaseForTask()` path unchanged.
- **Why before `recoverPhaseForTask`.** `recoverPhaseForTask` runs `tryEvidenceAdvance` (which reads the stale verdict and calls `taskPhase`, inflating counters) *and then* a one-shot retry. Parking first skips both: no counter mutation, no futile retry.
- **No artifact write.** The fix reads only the in-memory `lastCodexExitStatus` and the phase name; it does **not** read, write, or mutate `spec-review.md`. This is why every round-2 concern (verdict-section grammar, cumulative-history destruction, worktree dual-copy correctness) is out of scope by construction — there is no artifact mutation to get wrong.
- **Bundle mode.** The park is `process.exit(2)`, which stops the whole run (intended — same as the existing "Stopping for human review" path). The check is evaluated inside the per-task loop; the first crashed `spec_review` member triggers the halt. Siblings whose reviews completed keep their state on disk and resume on the next `canon run`.
- **Suppressing the misleading note.** The "(likely MCP warnings). Continuing." message at [`main.ts:3053`–3056](scripts/run-task/main.ts) is only reached for a `done` phase after the not-`done` block (or a clean exit). Because the park exits `2` for the crashed-`spec_review` case, that note is never reached for it — no code change to the note itself is required beyond confirming the park precedes it.

### Affected Files

> No generated `templates/` mirror rows are needed for source files; `docs/pipeline-orchestrator.md` is canon-managed and its mirror is listed explicitly.

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Add the Codex-`spec_review` crashed-review park branch (actionable error, `process.exit(2)`, no retry) in `checkAndRoute()`'s `phaseStatus !== 'done'` block, before `recoverPhaseForTask`, gated on `phase === 'spec_review' && lastCodexExitStatus !== 0`. Optionally extract the condition into a small pure predicate for unit-testability. |
| `tests/run-task-safety.test.ts` | Integration/park tests: red-first counter/no-advance regression via the dispatch→`checkAndRoute` sequence with a non-zero Codex exit (AC-1); park message + no-retry + exit 2 (AC-2); benign done-phase + non-zero-exit no-park (AC-3); benign clean-exit fresh-verdict advance + counter increment (AC-4); `code_review` not-`done` recovery unchanged + `spec_review`-only structural assertion (AC-5). *(Final placement is the implementer's call; the subprocess/real-git integration pattern lives here.)* |
| `docs/pipeline-orchestrator.md` | Document the crashed-Codex-`spec_review` park behavior, the fail-closed rationale, and the benign-sub-case tradeoff in the recovery/auto-advance section (AC-6). |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror of `docs/pipeline-orchestrator.md` (auto-regenerated by the pre-commit sync hook; canon-managed — declared per the "declare templates/ mirrors" pitfall). |
| `docs/patterns.md` | Add a Known Pitfall: a non-zero agent exit is not a completed review; recovery must park a crashed Codex `spec_review` rather than read a verdict from the artifact (AC-7). |
| `docs/BACKLOG.md` | Cross-reference this fix from the deferred agent-CLI-exit "Bug 2" entry (*"no agent CLI exit may `process.exit` the orchestrator"*) under a shared "agent-failure ≠ phase success" note, and record the deferred in-band verdict-freshness follow-up (AC-8). |
| `dist/scripts/run-task.js` | Generated build artifact — regenerated (bundles `main.ts`); CI diff-checks `dist/`. |

### Interaction Dependencies

- **Reroute `spec_review`**: the live repro was a reroute amendment re-review. The park fires on the reroute path too (it keys only on phase + exit status, not on reroute state), closing the within-round revision-iteration hole `checkRerouteEvidence`'s round granularity left open. `checkRerouteEvidence` is otherwise unchanged.
- **Reroute-rejection routing** ([`main.ts:3066`](scripts/run-task/main.ts), `isRerouteInProgress && anyChangesRequested`): runs in the post-recovery `switch`, which the park (exit 2) never reaches on a crash — correct, because there is no fresh verdict to route on. A successful reroute re-review (exit 0 or `done`) does not park and reaches the switch as today.
- **`autoBlockSpecReview`**: unchanged. Parking prevents the *phantom* increment, so no false auto-block; a genuine series of `changes_requested` still increments and can legitimately auto-block.
- **`checkPhaseGate`**: unchanged. The park is orthogonal to the verdict-matches-artifact gate.

### Data Model Changes

None. No `status.json` or persisted-schema change, no new file, no new cross-phase state. The fix reads the existing in-memory `lastCodexExitStatus` (single-dispatch-cycle orchestrator state, mirroring today's usage) and the phase name.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — required: `scripts/run-task/main.ts` edits rebuild `dist/scripts/run-task.js`; CI runs `npm run build && git diff --exit-code -- dist/`
- [x] `npm run docs-refs-check` — docs edits (`docs/pipeline-orchestrator.md`, `docs/patterns.md`, `docs/BACKLOG.md`) and their references

## Docs Impact

- `docs/pipeline-orchestrator.md` — recovery/auto-advance section gains the crashed-Codex-`spec_review` park behavior + rationale + tradeoff (AC-6; also updates its `templates/` mirror).
- `docs/patterns.md` — new Known Pitfall on agent-failure ≠ phase success (AC-7).
- Other protected docs (`architecture.md`, `codebase-map.md`, `decisions.md`, `product-context.md`): no change required. This is a hardening of an existing recovery path, not a new phase, schema, or settled-decision change.

## Known Risks

- **Hot-path / delicate.** This changes the orchestrator's recovery routing — an undetected bug corrupts every task that runs after it lands. `delicate: true`; the human spec gate is where this stops for review.
- **Park-branch placement.** If the park is placed *after* `recoverPhaseForTask`, the futile retry and the stale-verdict advance still run; it must precede `recoverPhaseForTask` in the `phaseStatus !== 'done'` block. If it is not nested inside that block, it fires for a `done` phase and breaks the benign self-bookkept path. Covered by AC-1 (no advance/retry), AC-3 (done + non-zero does not park), and AC-5 (scoped to `spec_review`).
- **Deliberate benign-sub-case regression (product tradeoff — flagged for the human gate).** A genuine `spec_review` verdict produced *and then* a non-zero exit (MCP shutdown noise) *and* skipped self-bookkeeping now **parks** (operator re-runs) instead of auto-advancing. The old auto-advance for this sub-case was never sound (the orchestrator cannot tell it apart from a crash that left a stale verdict — that is the bug), so parking is the fail-closed correction; the cost is a manual re-run in the rare benign case. If the human wants that sub-case to keep auto-advancing, that requires the deferred in-band freshness work (tighten `extractCheckedVerdict` first) — a larger, separate task. **This fork is the decision the human spec gate should confirm.**
- **Resume soundness.** On a re-run after a park, `canon run` re-dispatches the still-`in_progress` `spec_review` (fresh Codex invocation) before `checkAndRoute` evaluates it, so the exit status seen is the new invocation's — the live repro confirmed this resume-then-re-dispatch order. The park does not change resume behavior; it only fails closed on the crash within a dispatch cycle.
- **Over-broadening.** The change must not touch `implement`, `code_review`, or any exit-0 path. Scoped to `spec_review` + non-zero Codex exit; covered by AC-4, AC-5, and the `code_review` Non-Goal.

## Human Test Plan

1. Start a task and let it reach a spec review step that has already gone one round (so a verdict from the prior round is on record).
2. Simulate the review tool being unavailable for the next round — for example, exhaust the reviewer's credits — and let the pipeline run that review step.
3. Expected (after the fix): the pipeline stops with a clear message saying the review did not actually run, names the likely cause (out of credits / auth / network), and tells you to fix it and re-run. It must **not** report a review result, must **not** advance to the next step, and must **not** count that round against the review limit.
4. Restore the reviewer (e.g. add credits) and re-run. Expected: the review now runs for real and produces a genuine result; the round count reflects only real review rounds, not the outage.
5. Confirm the round counter shown for the task did not increase during the outage.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names — N/A (full tier); Design references real symbols (`checkAndRoute`, `recoverPhaseForTask`, `tryEvidenceAdvance`, `updateReviewCounters`, `lastCodexExitStatus`, `extractCheckedVerdict`, `checkRerouteEvidence`, `autoBlockSpecReview`, `runCodex`, `runClaude`)
- [x] Known Risks covers failure modes for the trickiest ACs (park placement, benign-sub-case tradeoff, resume, over-broadening)
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has entries marked `- [x]`
- [x] (Bug fix) *Problem* states the confirmed mechanism (non-zero Codex exit → recovery trusts a stale artifact) and how it was confirmed (live out-of-credits repro); *Acceptance Criteria* includes a red-first regression AC (AC-1) built deterministically from on-disk state + a simulated non-zero exit, so the environment-bound escape does not apply
