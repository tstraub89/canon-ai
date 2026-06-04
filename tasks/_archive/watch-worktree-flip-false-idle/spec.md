# Spec: watch-worktree-flip-false-idle — Watch must not false-idle during the worktree-flip runtime-file gap

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`canon watch` falsely reports a healthy run as settled (`step_done`, exit 0) during the **plan→implement transition**, when the orchestrator creates the task worktree.

Mechanism (observed on `reroute-spec-review-symmetry`, 2026-05-31; reproduced from the live filesystem):

1. The runtime files `.canon-pid` and `.heartbeat.json` are gitignored (`.gitignore:23-25`). `.canon-pid` is written **once at detach** (`detachAndExit` in `scripts/run-task/detach.ts:200-204`) into whatever dir `resolveTaskDir` returns *then* — at run start that's the **repo-root** task dir — and is **never relocated**. `.heartbeat.json` is written by a `.unref()`'d 30s-interval timer (`startHeartbeat` in `scripts/run-task/heartbeat.ts:62`); its `writeOnce` resolves the target dir dynamically per tick.
2. `ensureWorktree` (`scripts/run-task/worktree.ts:90`, called from `ensureBranch` at `scripts/run-task/git.ts:263` and `:284`) runs `git worktree add`, checking out the task branch. Because task artifacts are committed pre-pipeline, `<worktree>/tasks/<id>/status.json` exists the instant the branch is checked out.
3. `resolveTaskCwd` (`scripts/run-task/state.ts:83`) returns the worktree the moment that nested `status.json` exists. Both watch (via `tolerantTaskDir` → `gatherRunContext`) and the heartbeat writer resolve dynamically, so both flip to the worktree dir.
4. But the worktree dir has **neither** runtime file yet: `.canon-pid` lives only in the repo-root dir, and the worktree's `.heartbeat.json` does not appear until the heartbeat timer's next tick (up to 30s later).
5. So for up to ~30s after worktree creation, `gatherRunContext` (`scripts/run-task/run-context.ts:87`) reads the worktree dir, finds `canonPid = null` and `heartbeatResult = missing`, and computes `resolvedPid = null` (run-context.ts:116-129). `launchWindow` is also false (it requires `canonPid != null && canonAlive && heartbeatResult.kind === 'missing'`, and `canonPid` is null here). The `orchestratorStillProgressing` gate (`src/cli/commands/watch.ts:407`) returns false on its first guard (`resolvedPid == null`), watch falls through to the idle path, and `classifyIdle` (`src/cli/commands/watch.ts`) sees `implement` `in_progress` with `plan` `done` → emits a false `step_done` (exit 0).

Live filesystem confirmation while the run was healthy and ongoing: the repo-root task dir held `.canon-pid` and a frozen `.heartbeat.json`; the worktree task dir held a fresh `.heartbeat.json` but **no** `.canon-pid`.

This is **distinct from commit `03985fc`**, which fixed the synchronous-window stale-heartbeat case where `resolvedPid` stays *alive* (the gate holds). Here the directory flip makes `resolvedPid` go *null*, which bails the gate out before it can help.

## Decision

Eliminate the gap at the source: write a fresh heartbeat into the newly-created worktree dir **immediately after the worktree is created, before the orchestrator advances to `implement`**.

Expose a force-tick on the heartbeat (the heartbeat writer already resolves its target dir dynamically, so a tick after worktree creation lands in the worktree dir). With a fresh worktree heartbeat present:

- `watch` / `doctor` (which read via `gatherRunContext`): `resolvedPid` resolves via the heartbeat-pid fallback (`run-context.ts:123-124`), `classifyAttach` returns `live`, and watch keeps blocking.
- `canon stop` (which reads `readCanonPid`/`readHeartbeatStatus` directly, *not* `gatherRunContext`): finds the fresh worktree heartbeat and falls back to its pid.

This is the root-cause fix — it puts the runtime file where the resolver now looks — and it covers every runtime-file consumer with a single mechanism. No `watch.ts` or `gatherRunContext` logic changes: once a heartbeat is present in the resolved dir, the existing `03985fc` gate already keeps watch blocking.

(Mechanics — exact method name, signature, and whether the tick lives in `ensureWorktree` vs. a wrapper — deferred to plan. The behavioral contract is: a fresh heartbeat exists in the worktree task dir before the orchestrator proceeds past worktree creation.)

## Non-Goals

- **No cross-dir / repo-root fallback in `gatherRunContext`.** An earlier draft proposed making readers dual-path (read repo-root runtime files when the resolved dir lacks them). Cut: it imposes permanent reader-side complexity, doesn't cover `canon stop` (which bypasses `gatherRunContext`), and is never exercised once the worktree heartbeat is always present.
- **No `.canon-pid` mirror into the worktree** — neither symlink, copy, nor re-write. The heartbeat-pid fallback already resolves the pid for `gatherRunContext` consumers, and `stop` falls back to the heartbeat pid; a second pid file adds cleanup-asymmetry and pid-reuse surface for zero benefit.
- **No change to the 30s heartbeat interval** (`HEARTBEAT_INTERVAL_MS`) or the 60s stale threshold (`HEARTBEAT_STALE_AFTER_MS`).
- **No change to `resolveTaskCwd` flip semantics** — the dynamic flip to the worktree is correct; we make the worktree dir self-consistent at creation, not the flip itself.
- **No change to the `03985fc` `orchestratorStillProgressing` gate**, to `classifyIdle`/`classifyAttach`, or to watch's exit-code taxonomy (0/2/3/4/5) and `--timeout`/`--until`/`-f` flags.

## Acceptance Criteria

- [ ] AC-1: `HeartbeatHandle` (`scripts/run-task/heartbeat.ts:49`) exposes a force-tick operation that synchronously performs one heartbeat write — the same write the interval performs — resolving the target dir dynamically at call time (so a tick after a dir change lands in the new dir). **Verify**: a `heartbeat.test.ts` case starts a handle against a resolver, advances the resolver to a second dir, calls the force-tick, and asserts a fresh `.heartbeat.json` (current timestamp, correct pid) now exists in the second dir.
- [ ] AC-2: A module-level `tickAllHeartbeats()` is exported, mirroring the existing `stopAllHeartbeats()` (`heartbeat.ts:137`) over the `activeHandles` registry: it fires the force-tick on every active handle. **Verify**: `heartbeat.test.ts` registers two handles and asserts one `tickAllHeartbeats()` call writes fresh heartbeats for both. (Rationale: `main.ts` discards `startHeartbeat`'s return value at main.ts:2496/2622, so the registry — not a threaded handle — is the only available trigger surface.)
- [ ] AC-3: A successful worktree creation triggers a force-tick of the active heartbeat(s) before the orchestrator proceeds, so the worktree task dir has a fresh `.heartbeat.json` before `implement` begins. The tick is best-effort: a write failure must never propagate out of worktree creation or abort the run. **Verify**: a worktree-creation integration case in `tests/run-task-safety.test.ts` (the existing `ensureBranch` first-worktree harness) seeds an active heartbeat handle, runs `ensureBranch` through first worktree creation, and asserts a fresh `.heartbeat.json` now exists in the worktree task dir — proving the tick fires *causally* on the creation path, not merely that the API exists. (An empty `activeHandles` registry would no-op, so the seeded handle is what makes the assertion load-bearing.) Reviewer confirms the trigger is on the success path and wrapped so a write failure cannot abort the run.
- [ ] AC-4: In the flip-window scenario — the worktree task dir has `status.json` (`implement` `in_progress`, `plan` `done`) and a fresh `.heartbeat.json` (from AC-3) but no `.canon-pid` — `gatherRunContext` returns a non-null `resolvedPid` (via the heartbeat-pid fallback) and the watch poll loop does **not** emit `step_done`; it keeps blocking via the existing gate. **Verify**: a `watch.test.ts` case constructs this state and asserts the poll loop continues rather than emitting `step_done`/exit 0.
- [ ] AC-5: No regression to existing watch/heartbeat behavior: the `03985fc` synchronous-window gate, death detection (exit 4), auto-block (exit 3), ambiguous-pid (exit 2), and clean settle (`human_review`/`complete`) classifications are unchanged. **Verify**: the existing `watch.test.ts`, `heartbeat.test.ts`, and `run-context.test.ts` suites pass unmodified except for additions.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/heartbeat.ts` | Add a force-tick to `HeartbeatHandle` (synchronous single write, dynamic dir resolution — reuse the existing `writeOnce`); add exported `tickAllHeartbeats()` mirroring `stopAllHeartbeats()` over the `activeHandles` registry. |
| `scripts/run-task/git.ts` | **(superseded by Amendment — bundle fix)** Fire `tickAllHeartbeats()` in `ensureBranch` *after* the shared branch is recorded for all bundled tasks — on both worktree paths (after `ensureWorktree` in the existing-branch path, and after the branch-recording loop in the first-creation path), best-effort wrapped. Round 0 put the tick inside `ensureWorktree` (`worktree.ts`); that left secondary bundled tasks resolving to REPO_ROOT at tick time. `worktree.ts` is net-unchanged. (`heartbeat.ts` imports nothing internal, so `git.ts → heartbeat.ts` introduces no cycle.) |
| `dist/` | Regenerated build artifact (`tsup`): the `scripts/run-task/` source changes recompile into `dist/scripts/run-task.js`, which is committed. Directory-form entry so the `--pr` base-drift allow-list covers the bundle. |
| `tests/heartbeat.test.ts` | Cases for AC-1 (force-tick writes to the current resolved dir) and AC-2 (`tickAllHeartbeats` fires all active handles). |
| `tests/run-task-safety.test.ts` | Case for AC-3 (causal): seed an active heartbeat handle, run `ensureBranch` through first worktree creation (existing fake-git harness), assert a fresh `.heartbeat.json` lands in the worktree task dir. |
| `tests/watch.test.ts` | Case for AC-4 (flip-window with a fresh worktree heartbeat but no `.canon-pid`: live run keeps blocking, no false `step_done`). |

### Interaction Dependencies

- Runtime-file consumers split into two access paths: `watch` and `doctor` read via `gatherRunContext` (`src/cli/commands/watch.ts`, `src/cli/commands/doctor.ts`); `canon stop` reads `readCanonPid`/`readHeartbeatStatus`/`tolerantTaskDir`/`probePidAlive` directly (`src/cli/commands/stop.ts`). The force-tick fixes all three because it makes the worktree heartbeat present — the one signal both paths consult.
- The force-tick fires regardless of whether `ensureWorktree` created a new worktree or found an existing one (resume); refreshing the heartbeat in the resume case is harmless.

### Data Model Changes

None. No change to `HeartbeatRecord`, `status.json`, or any persisted shape. `HeartbeatHandle` gains a method (in-memory interface only).

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite runs clean (`heartbeat.test.ts`, `run-task-safety.test.ts`, `watch.test.ts` extended)
- [x] `npm run build` (`tsup`)
- [ ] E2E — N/A (no product UI; orchestrator-internal behavior covered by unit tests)

## Docs Impact

None required. This is a bug fix to internal liveness detection; no protected doc describes the flip-gap behavior. A `lessons-learned.md` entry on the runtime-file/resolver-flip split (and on the worktree-dir self-consistency-at-creation invariant) is appropriate at QA (append-only), but no permanent-doc edit is in scope.

## Known Risks

- **Tick placement relative to post-creation synchronous work**: the force-tick must fire on the worktree-creation success path *before* any long synchronous between-phase work (scaffold commit, telemetry absorption, node_modules symlink). If placed after that work, a watch poll could still land in a gap. Placement inside/after `ensureWorktree` (before `ensureBranch` returns) satisfies this. Covered by AC-3.
- **Best-effort tick must not abort the run**: if the heartbeat write throws (transient fs error), it must be swallowed — worktree creation succeeding is more important than the heartbeat refresh. The existing `writeOnce` is already wrapped best-effort internally; the new call site must preserve that (AC-3).
- **No new pid-reuse surface**: this change writes only a heartbeat (never a `.canon-pid`) into the worktree, and changes no resolution logic — so the existing pid-reuse and ambiguous-pid guards are untouched.
- **Failure mode if the fix regresses**: a bug in the tick degrades to *today's* behavior (worktree heartbeat lags up to 30s) — it cannot corrupt git state or task state. Low blast radius; this is why the task is not flagged `delicate` despite touching the worktree-creation path.

## Human Test Plan

1. Start a full-tier task that creates a worktree (any M+ task), and run it detached so the orchestrator backgrounds itself.
2. As soon as the run advances past plan, begin watching the run and observe the output as the task creates its worktree and starts the implementer.
3. Expected: watch stays attached and keeps reporting the run as live/progressing across the worktree-creation moment. It must **not** announce that the run has finished or stopped while the implementer is in fact still working.
4. Let the run continue to its real stopping point (the human-review checkpoint, or a blocked state). Expected: watch only reports a stop when the run has genuinely reached one, and what it reports agrees with what the task itself shows.
5. Sanity check the opposite direction: if the orchestrator is actually stopped while a phase is mid-flight, watch should still report the run as ended within about a minute (a true stop is not masked).

---

## Amendment

> **Reroute round 1** — addresses a P2 from Codex's PR-level review on #127. The round-0 fix (force-tick fired *inside* `ensureWorktree`) closes the false-idle gap for single-task runs but **not for secondary tasks in a bundle**.

### Problem (bundle-mode gap)

`tickAllHeartbeats()` fires inside `ensureWorktree` (`scripts/run-task/worktree.ts`), which `ensureBranch` (`scripts/run-task/git.ts:284`) calls **before** it writes the shared branch name into each bundled task's `status.json` (the loop at git.ts:285-289). In bundle mode the first worktree is created for the primary task; at tick time the secondary tasks still have blank `branch` fields, so `resolveTaskCwd(<secondary>)` cannot discover the shared worktree and falls back to REPO_ROOT. The tick therefore writes each secondary heartbeat to `REPO_ROOT/tasks/<secondary>/.heartbeat.json`, not to the shared `dev-worktrees/<primary>/tasks/<secondary>/`. Once the branch fields are recorded, `canon watch <secondary>` and `canon stop` resolve to the shared worktree dir — which has no heartbeat until the next 30s tick — recreating the exact false-idle / false-death gap for every secondary bundled task.

### Decision (amended)

Fire the tick **after every bundled task's shared branch is recorded**, so all tasks resolve to the shared worktree dir before the heartbeat is written:

- **Remove** the `tickAllHeartbeats()` calls from `ensureWorktree` (`worktree.ts`) — all three return paths (new creation + the two reuse early-returns).
- **Add** `tickAllHeartbeats()` in `ensureBranch` (`git.ts`) on the worktree paths: after the branch-recording loop in the first-creation path (after git.ts:289), and after `ensureWorktree(...)` in the existing-branch worktree path (git.ts:263, where branches are already recorded from a prior run). Best-effort wrapped (a write failure must never abort `ensureBranch`), as in round 0. (`heartbeat.ts` imports nothing internal, so `git.ts → heartbeat.ts` introduces no cycle.)

Mechanics (exact placement, whether the two sites share a small helper) deferred to plan; the contract is: **after `ensureBranch` returns in worktree mode, every bundled task's resolved worktree dir holds a fresh heartbeat.**

### Amended Acceptance Criteria

- [ ] AC-6 (bundle): For a bundle run (≥2 task IDs, worktree mode), after first worktree creation the shared worktree task dir for **every** bundled task — primary *and* secondary — holds a fresh `.heartbeat.json` before the orchestrator advances to `implement`. **Verify**: a bundle integration case in `tests/run-task-safety.test.ts` seeds an active heartbeat handle, runs `ensureBranch` with a 2-task bundle through first worktree creation, and asserts a fresh `.heartbeat.json` exists in the shared worktree dir for both the primary and the secondary task.
- [ ] AC-3 (revised): the tick fires from `ensureBranch` after branch recording, not from inside `ensureWorktree`; the existing single-task causal assertion still holds.

### Amended Affected Files

- `scripts/run-task/git.ts` — fire `tickAllHeartbeats()` after branch recording on both worktree paths (round 0 left `git.ts` unchanged).
- `scripts/run-task/worktree.ts` — remove the three `tickAllHeartbeats()` calls added in round 0 (the import may drop with them).
- `tests/run-task-safety.test.ts` — add the bundle AC-6 case alongside the existing single-task AC-3 case.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; ACs reference real symbols)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] Symbols named in ACs actually exist in the codebase — grep-verified: `HeartbeatHandle`/`stopAllHeartbeats`/`activeHandles`/`startHeartbeat`/`writeOnce` (`scripts/run-task/heartbeat.ts`); `gatherRunContext`/`resolvedPid` (`scripts/run-task/run-context.ts`); `ensureWorktree` (`scripts/run-task/worktree.ts:90`, called `git.ts:263/284`); `resolveTaskCwd`/`taskDirForRepoRoot` (`scripts/run-task/state.ts`); `orchestratorStillProgressing`/`classifyAttach`/`classifyIdle`/`launchWindow` (`src/cli/commands/watch.ts`); `detachAndExit` (`scripts/run-task/detach.ts`); `readCanonPid`/`readHeartbeatStatus` consumed by `src/cli/commands/stop.ts`
