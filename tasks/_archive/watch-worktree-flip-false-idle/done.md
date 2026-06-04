# QA Summary: watch-worktree-flip-false-idle

**Status**: Approved — ship as-is  
**Code review verdict**: Approved (no findings, Stage 2 clean)

---

## What Changed

`canon watch` could falsely report a healthy run as settled (exit 0 / `step_done`) during the plan→implement transition, while the orchestrator was in fact still running. The failure window was up to ~30 seconds: when the task worktree is created, the heartbeat resolver flips from the repo-root task dir to the worktree task dir, but the worktree dir starts empty of runtime files. With no heartbeat and no pid file visible in the new location, watch concluded the run was idle and emitted a false healthy-stop signal.

The fix seeds the worktree dir with a fresh heartbeat immediately on creation, before the orchestrator advances to `implement`. The existing liveness gate — which already kept watch blocking when the heartbeat was merely stale but the pid was alive — then covers the new state with no changes needed in watch logic itself.

A reroute (round 1) moved the tick site from `ensureWorktree` to `ensureBranch` (after the branch-recording loop) to fix bundle mode: in a bundle, secondary tasks can't resolve to the shared worktree dir until their `branch` field is written, so ticking inside `ensureWorktree` was writing secondary heartbeats to the wrong directory. Moving to `ensureBranch` after branch recording covers primary and all secondary tasks with a single call site.

## Files Changed

- `scripts/run-task/heartbeat.ts` — Added `HeartbeatHandle.tick()` for a synchronous single write reusing the interval's write path; added exported `tickAllHeartbeats()` to sweep every active handle in the registry.
- `scripts/run-task/git.ts` — Calls `tickAllHeartbeats()` in `ensureBranch` after branch recording on both worktree paths (new creation and existing-branch reuse), wrapped best-effort so a write failure never aborts the run.
- `tests/heartbeat.test.ts` — AC-1 coverage (resolver-flip tick) and AC-2 coverage (registry sweep).
- `tests/run-task-safety.test.ts` — AC-3 causal integration case (single-task) and AC-6 bundle regression case: both seed a live heartbeat handle inside a subprocess, run `ensureBranch` through first worktree creation, and assert a fresh `.heartbeat.json` lands in the worktree task dir for every bundled task.
- `tests/watch.test.ts` — AC-4 flip-window regression case: constructs worktree-resolved, heartbeat-only, no-`.canon-pid` state; asserts `resolvedPid` is non-null and watch exits with timeout rather than `step_done`.
- `dist/scripts/run-task.js` — Regenerated build artifact.

## How to Test

1. Start a full-tier task (M or larger) with `canon run <id>` so it runs detached.
2. As soon as the run advances past plan, begin watching with `canon watch <id>`.
3. Observe the output as the orchestrator creates the task worktree and starts the implementer.
4. **Expected**: watch stays attached and keeps reporting the run as live across the worktree-creation moment — it must not announce the run as finished while the implementer is still working.
5. Let the run continue to its real stopping point (human-review checkpoint or a blocked state). **Expected**: watch reports a stop only when the run has genuinely reached one, and what it reports agrees with what `canon task list` shows.
6. Sanity-check the negative case: if the orchestrator actually stops while a phase is mid-flight, watch should still report the run as ended within about a minute (a true stop is not masked).

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-ran after reroute edits; passed. |
| `npm run type-check` | Pass | Re-ran after reroute edits; passed. |
| `npm test` (full suite) | Pass | 706/706 tests pass, including new AC-1–AC-6 cases. |
| `npm run build` (tsup) | Pass | `dist/scripts/run-task.js` regenerated after reroute source changes. |
| E2E | deferred_by_spec | Spec `Validation Required` explicitly marks E2E as N/A — orchestrator-internal behavior covered by unit tests. |

## Human Verification Required

None.

## Decisions Made

- **Tick site: `ensureBranch`, not `ensureWorktree`** (reroute round 1): secondary tasks in a bundle resolve to the shared worktree dir only after their `branch` field is written. Moving the tick to `ensureBranch` after the branch-recording loop ensures every bundled task's resolved worktree dir has a fresh heartbeat before `implement` begins.
- **AC-3/AC-6 use a subprocess harness**: `activeHandles` is process-local and `WORKTREES_ROOT` is captured at module load time (`scripts/run-task/env.ts`). The bundle test sets the env override before any import, and both seeding the registry and running `ensureBranch` happen inside the same child process. An in-process test would exercise an empty registry.
- **Best-effort tick**: a write failure degrades to the pre-fix ~30s gap, not a run abort. Worktree creation succeeding is more important than the heartbeat refresh.
- **Tick fires on existing-worktree reuse path too**: refreshing a worktree heartbeat on resume is harmless and prevents the gap from reappearing on re-runs.

## Open Questions

None. Clean implementation, all ACs met, no review findings.

---

## Proposed Changelog

This is a correctness fix to `canon watch` — users running it on a full-tier task would see a false exit 0 / `step_done` at the plan→implement transition while the implementer was still running.

Proposed entry under **[Unreleased] → Fixed**:

> **`canon watch` no longer false-idles during the worktree-flip runtime-file gap.** On full-tier tasks, the orchestrator creates a task worktree at the plan→implement transition; the heartbeat resolver immediately flips to the new worktree dir, which starts empty of runtime files. `gatherRunContext` would find no pid file and no heartbeat, resolve `resolvedPid` as null, and emit a false `step_done` (exit 0) for up to ~30 seconds while the orchestrator was still running. The fix writes a fresh heartbeat into the worktree dir for every bundled task immediately after `ensureBranch` records branch assignments — best-effort, never fatal — so the existing liveness gate keeps watch blocking with no logic changes to watch itself.

**Proposed version bump**: patch (1.9.x) — correctness fix to observable `canon watch` behavior; no new features or breaking changes. The human finalizes.
