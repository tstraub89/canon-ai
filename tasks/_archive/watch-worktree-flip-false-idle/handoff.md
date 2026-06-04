# Implementation Handoff: watch-worktree-flip-false-idle

> Author: Codex | Spec: `tasks/watch-worktree-flip-false-idle/spec.md` | Plan: `tasks/watch-worktree-flip-false-idle/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `scripts/run-task/heartbeat.ts` | Added `HeartbeatHandle.tick()` as a synchronous call to the existing heartbeat writer and exported `tickAllHeartbeats()` to sweep the active handle registry. |
| `tests/heartbeat.test.ts` | Added coverage for `handle.tick()` writing to the resolver's current dir and for `tickAllHeartbeats()` refreshing every active handle. |
| `tests/run-task-safety.test.ts` | Added the AC-3 causal integration case by seeding a live heartbeat in a subprocess and asserting worktree creation causes a fresh heartbeat in the new worktree task dir. |
| `tests/watch.test.ts` | Added the flip-window regression case that constructs a worktree-resolved heartbeat-only state and verifies watch keeps blocking instead of emitting `step_done`. |
| `tasks/watch-worktree-flip-false-idle/notes.md` | Appended an implement-phase note about the fake worktree-add harness needing to materialize nested task status for the causal heartbeat flip. |
| `tasks/watch-worktree-flip-false-idle/status.json` | Advanced the task artifact to `implement: done` / `code_review` phase via `canon task phase watch-worktree-flip-false-idle implement done`. |
| `dist/scripts/run-task.js` | Regenerated the tracked build output so the bundled runtime matches the source changes. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Expose a synchronous heartbeat tick on the existing handle, sweep all active handles when the worktree is created, and validate the flip-window behavior end to end so `canon watch` never false-idles while the runtime files move from the repo-root task dir to the worktree task dir.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| AC-3 uses a subprocess harness instead of a direct in-process call. | `ensureBranch()` resolves `WORKTREES_ROOT` at module load and the heartbeat registry is process-local, so the test must seed the heartbeat handle inside the same child process that runs worktree creation. | None |
| `dist/scripts/run-task.js` is included as regenerated output. | The repo tracks the built runtime bundle, and `npm run build` updates it when the source changes. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `HeartbeatHandle` exposes a force-tick operation that synchronously performs one heartbeat write, resolving the target dir dynamically at call time. | Met | `tick: writeOnce` in [`scripts/run-task/heartbeat.ts`](/Users/tstraub/canon-ai/dev-worktrees/watch-worktree-flip-false-idle/scripts/run-task/heartbeat.ts) reuses the same write path as the interval; [`tests/heartbeat.test.ts`](/Users/tstraub/canon-ai/dev-worktrees/watch-worktree-flip-false-idle/tests/heartbeat.test.ts) exercises the resolver flip and fresh timestamp/pid assertions. |
| AC-2: A module-level `tickAllHeartbeats()` is exported and fires the force-tick on every active handle. | Met | Export added in [`scripts/run-task/heartbeat.ts`](/Users/tstraub/canon-ai/dev-worktrees/watch-worktree-flip-false-idle/scripts/run-task/heartbeat.ts); [`tests/heartbeat.test.ts`](/Users/tstraub/canon-ai/dev-worktrees/watch-worktree-flip-false-idle/tests/heartbeat.test.ts) seeds two handles and verifies one sweep refreshes both. |
| AC-3: Successful worktree creation triggers a best-effort force-tick before the orchestrator proceeds. | Met | [`scripts/run-task/git.ts`](/Users/tstraub/canon-ai/dev-worktrees/watch-worktree-flip-false-idle/scripts/run-task/git.ts) calls the sweep after branch recording and wraps it so write failures stay non-fatal; [`tests/run-task-safety.test.ts`](/Users/tstraub/canon-ai/dev-worktrees/watch-worktree-flip-false-idle/tests/run-task-safety.test.ts) proves the tick lands causally on the creation path. |
| AC-4: In the flip-window scenario, `gatherRunContext` resolves a pid via heartbeat fallback and watch does not emit `step_done`. | Met | [`tests/watch.test.ts`](/Users/tstraub/canon-ai/dev-worktrees/watch-worktree-flip-false-idle/tests/watch.test.ts) constructs the worktree-resolved heartbeat-only state, verifies `resolvedPid` is non-null, and asserts watch times out instead of settling. |
| AC-5: No regression to the existing watch/heartbeat behavior. | Met | The existing `watch.test.ts`, `heartbeat.test.ts`, and `run-context.test.ts` cases still pass in the full suite; the new cases only add coverage. |

## Edge Cases Considered

- Best-effort tick failures must not abort worktree creation; the call site is wrapped, and `writeOnce` already swallows per-write filesystem errors.
- Existing worktree reuse should still refresh the heartbeat, because that path is a successful worktree resolution too and it is harmless to refresh.
- The flip-window regression needs the worktree task dir to become visible before the tick runs, so the integration harness materializes nested task status in the child process before asserting the fresh heartbeat.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Ran after the final test-only edits; passed. |
| `type-check` (`npm run type-check`) | Pass | Ran after the final test-only edits; passed. |
| `npm test` — full suite runs clean (`heartbeat.test.ts`, `run-task-safety.test.ts`, `watch.test.ts` extended) | Pass | Full suite passed with 702/702 tests after the final tree update. |
| `build` (`npm run build` / `tsup`) | Pass | Re-run after the final tree update; bundled `dist/scripts/run-task.js` was regenerated. |
| `E2E — N/A (no product UI; orchestrator-internal behavior covered by unit tests)` | deferred_by_spec | Spec: `Validation Required` explicitly marks E2E as N/A for this orchestrator-internal task. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->

## Iteration 2 — addressing review round 1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|
| `scripts/run-task/git.ts` | Moved the heartbeat sweep out of `ensureWorktree()` and into `ensureBranch()` after branch recording, so bundle members resolve the shared worktree before the tick runs. |
| `tests/run-task-safety.test.ts` | Added the AC-6 bundle regression that seeds a live heartbeat in the same subprocess as `ensureBranch()` and asserts both bundled task dirs get fresh worktree heartbeats after first worktree creation. |
| `tasks/watch-worktree-flip-false-idle/notes.md` | Appended a reroute note explaining why the bundle harness needed a child process with `CANON_WORKTREES_ROOT` set before import time. |
| `dist/scripts/run-task.js` | Regenerated the tracked bundle after the source changes moved the tick site. |

### Findings addressed

- _correctness bug:_ the heartbeat sweep was still running before bundled secondary tasks could resolve to the shared worktree → fixed by moving the sweep into `ensureBranch()` after the branch write loop and after the reused-worktree path returns.
- _spec gap:_ AC-6 required bundle coverage for every task in the shared worktree, not just the primary → added a bundle integration case that checks both primary and secondary worktree heartbeat files after first worktree creation.
- _risk/guardrail:_ the heartbeat refresh must stay best-effort and never abort worktree creation → preserved with the existing `try/catch` wrapper around the sweep call site.

### AC deltas (if any)

- AC-3: the tick now fires from `ensureBranch()` after branch recording instead of from inside `ensureWorktree()`; the single-task causal guarantee still holds.
- AC-6: added and met with the new bundle regression in [`tests/run-task-safety.test.ts`](/Users/tstraub/canon-ai/dev-worktrees/watch-worktree-flip-false-idle/tests/run-task-safety.test.ts).

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Re-ran after the reroute edits; passed. |
| `type-check` (`npm run type-check`) | Pass | Re-ran after the reroute edits; passed. |
| `npm test` — full suite runs clean | Pass | Re-ran after the reroute edits; passed with 706/706 tests and the new bundle case. |
| `build` (`npm run build` / `tsup`) | Pass | Re-ran after the final tree update; regenerated `dist/scripts/run-task.js`. |

## Iteration 1 — addressing pre-flight handoff rejection

### Findings addressed

- _bundle handoff mismatch:_ removed the stale `scripts/run-task/worktree.ts` entry from the handoff changes tables so every listed implementation file matches the current branch diff.
- _AC coverage drift:_ updated AC-3 to point at the actual call site in `scripts/run-task/git.ts`, which is where the worktree tick now lives.

### AC deltas (if any)

- None.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| none | not_configured | No source code changed in this handoff-only fix. |
