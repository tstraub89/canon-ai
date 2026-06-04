# Code Review: watch-worktree-flip-false-idle

> Reviewer: Claude | Spec: `tasks/watch-worktree-flip-false-idle/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, npm test, build; E2E `deferred_by_spec` with valid spec citation)
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `HeartbeatHandle` exposes a force-tick that synchronously performs one heartbeat write, resolving the target dir dynamically at call time. | Met | `tick: writeOnce` assigned in `heartbeat.ts:108`. `heartbeat.test.ts` case advances resolver to a second dir, calls `handle.tick()`, asserts fresh `.heartbeat.json` with current timestamp and correct pid in the second dir. |
| AC-2: `tickAllHeartbeats()` exported, mirrors `stopAllHeartbeats()` over `activeHandles`, fires force-tick on every active handle. | Met | Exported at `heartbeat.ts:150`. `heartbeat.test.ts` case seeds two handles, deletes both heartbeat files, calls `tickAllHeartbeats()`, asserts both files exist with current timestamps and correct pids. |
| AC-3: Successful worktree creation triggers a best-effort force-tick before the orchestrator proceeds; a write failure must never abort the run. | Met | `worktree.ts:159-163` calls `tickAllHeartbeats()` wrapped in try/catch on the new-creation path. Tick also fires on both reuse early-returns (existing wt dir: lines 98-103; branch already has a worktree: lines 108-113). `run-task-safety.test.ts` integration case seeds an active handle in a subprocess with a resolver that flips on `worktreeStatusFile` existence, runs `ensureBranch`, and asserts `.heartbeat.json` lands in the worktree task dir — proving causal tick, not merely API presence. |
| AC-4: In the flip-window scenario (worktree has `status.json` + fresh heartbeat but no `.canon-pid`), `gatherRunContext` returns non-null `resolvedPid` and watch does not emit `step_done`. | Met | `watch.test.ts:705-744` constructs the exact state. Asserts `ctx.canonPid === null`, `ctx.resolvedPid === process.pid`, `ctx.launchWindow === false`. Runs watch with 1s timeout and asserts exit 5 (timeout), stdout does not match `step_done`. |
| AC-5: No regression to existing watch/heartbeat behavior. | Met | 703/703 tests pass (verified by reviewer). No existing test bodies modified — only additions. |

### Dropped Sections Check

- [x] Non-goals respected: no cross-dir fallback in `gatherRunContext`, no `.canon-pid` mirror, no interval/threshold changes, no `resolveTaskCwd` flip changes, no `watch.ts` or `gatherRunContext` logic changes — all confirmed absent from diff.
- [x] Known Risks addressed: tick placement fires after `git worktree add` and before `ensureWorktree` returns (satisfies spec's "before `ensureBranch` returns" criterion); best-effort wrap present at all three call sites; no new pid-reuse surface.
- [x] Human Test Plan satisfiable: fix is internally validated; plan describes live runtime behavior, which is post-ship verification.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, minimal implementation. `tick: writeOnce` reuses the exact same closure the interval fires — no duplication, no behavioral divergence between periodic and forced ticks. The three-site tick pattern in `ensureWorktree` (new creation + both reuse paths) correctly covers every return from the function. The integration test's `suppressFlip = true` pattern ensures `handle.stop()` cleanup targets the source dir rather than the worktree, leaving the worktree heartbeat assertion load-bearing.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

(none)

## Final Verdict

- [x] **Approved** — ship as-is

---

## Round 2 — post-reroute review (spec Amendment, Iteration 2)

Iteration 2 addressed the bundle-mode gap surfaced by Codex's PR-level review (spec Amendment, AC-3 revised + AC-6 added). The tick was moved out of `ensureWorktree` (`worktree.ts`) and into `ensureBranch` (`git.ts`) so it fires after all bundled tasks' branch fields are recorded.

### Stage 1 — Spec Compliance

**Validation gate**: Iteration 2 re-ran all checks; 706/706 tests, lint, type-check, build all pass. No Fail rows. ✓

**AC coverage (amended ACs only — ACs 1, 2, 4, 5 unchanged from Round 1):**

| AC | Status | Notes |
|---|---|---|
| AC-3 (revised): tick fires from `ensureBranch` after branch recording, not from inside `ensureWorktree`; single-task causal guarantee still holds. | Met | `git.ts:296-300`: tick fires after the loop that writes `s.branch = branchName` for every taskId in the bundle. `git.ts:264-269`: tick fires on the existing-branch reuse path after `ensureWorktree` returns. `worktree.ts` grep confirms zero `tickAllHeartbeats` calls. `run-task-safety.test.ts:691` single-task subprocess causal case still present and passing. |
| AC-6: for a bundle run, every bundled task's shared worktree dir has a fresh `.heartbeat.json` after first worktree creation. | Met | `run-task-safety.test.ts:771` seeds primary + secondary with a live heartbeat handle in a subprocess, runs `ensureBranch([primaryTaskId, secondaryTaskId])`, asserts `.heartbeat.json` exists in the shared worktree task dir for both tasks. Secondary task branch field verified written. |

**Non-goals and Known Risks check**: no change from Round 1 — the amendment adds no new scope and introduces no new risk.

**Stage 1 Verdict**: Pass — proceed to Stage 2.

### Stage 2 — Code Quality

**`git.ts` tick placement**: both call sites are correct. First-creation path (lines 291–300) fires after the full branch-recording loop so all secondary task dirs are resolvable before the tick. Reuse path (lines 264–269) fires after `ensureWorktree` returns; branches were already recorded on a prior run so secondary resolvers are already valid.

**Best-effort wrapping**: both sites use try/catch. ✓

**Nit**: Handoff's main AC Coverage table (Iteration 1 baseline) lists only ACs 1–5 and references `worktree.ts` for the tick sites; neither is updated in Iteration 2's changes table. The correct AC-6 and AC-3 revised state is documented in the Iteration 2 section, so this is a cosmetic gap in the handoff, not a correctness issue.

**Findings**: none.

### Round 2 Verdict

- [x] **Approved** — ship as-is.

---

## Pre-Flight Rejection — handoff rejected before review (no Claude session ran)

## Validation Gate

**BLOCKED — pre-flight rejected handoff before full review:**


### Bundle-Level Handoff Verification

- [watch-worktree-flip-false-idle] handoff→diff: scripts/run-task/worktree.ts listed in handoff but not in diff

## Verdict

- [x] **Changes requested** — fix the above and resubmit handoff.
