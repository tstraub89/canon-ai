# Implementation Handoff: orchestrator-exit-logging

> Author: Codex | Spec: `tasks/orchestrator-exit-logging/spec.md` | Plan: `tasks/orchestrator-exit-logging/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/main.ts` | Registered the exit handlers at boot, set exit reasons on deliberate exits, and wired the shared exit marker into the orchestrator's existing exit paths. |
| `scripts/run-task/cli.ts` | Added the durable exit-marker writer, exit-reason state, `die()` stamping, and parseArgs reason hints. |
| `scripts/run-task/agents/claude.ts` | Set exit reasons on each Claude failure branch before process exit. |
| `scripts/run-task/agents/codex.ts` | Set exit reasons on Codex spawn/stall/signal failures while preserving the warn-and-return non-zero branch. |
| `tests/run-task-safety.test.ts` | Added exit-marker subprocess coverage for healthy runs, die paths, agent failures, and crash handlers. |
| `dist/cli/index.js` | Rebuilt bundle output from the source changes. |
| `dist/scripts/run-task.js` | Rebuilt bundle output from the source changes. |
| `tasks/implement-done-evidence-guard/notes.md` | Appended raw implementation observations for QA distillation. |
| `tasks/implement-done-evidence-guard/status.json` | Shared bundle artifact was advanced to `code_review` by the phase-close command after the implement pass. |
| `tasks/implement-done-evidence-guard/handoff.md` | Filled the sibling task's handoff artifact. |
| `tasks/orchestrator-exit-logging/notes.md` | Appended a raw observation about the synchronous exit marker. |
| `tasks/orchestrator-exit-logging/status.json` | Task phase bookkeeping was advanced to `code_review` by the phase-close command after the bundle pass. |
| `tasks/orchestrator-exit-logging/handoff.md` | Filled this handoff artifact. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `upstream_repo` in `tasks/orchestrator-exit-logging/status.json` |
| Upstream commit | `upstream_commit` in `tasks/orchestrator-exit-logging/status.json` |
| Orchestrator commit | `orchestrator_commit` in `tasks/orchestrator-exit-logging/status.json` |
| Codex CLI | `codex_cli` in `tasks/orchestrator-exit-logging/status.json` |
| Claude Code | `claude_code` in `tasks/orchestrator-exit-logging/status.json` |

## Intent & Rationale

Every orchestrator exit now leaves behind one synchronous, grep-able line with the code, reason, and timestamp. The implementation keeps the marker logic in the shared CLI helper so all existing exit sites can stamp reasons without adding a second marker writer or creating a new import cycle. The result is a durable tail on normal exits, die paths, agent failure ladders, and crash handlers.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Implemented the marker/handler state in [`scripts/run-task/cli.ts`](scripts/run-task/cli.ts) instead of a new `exit-marker.ts` module. | The shared CLI helper already sits on the critical path for `die()` and is imported by the agent wrappers, so keeping the state there avoided an extra module and import cycle while preserving the same behavior. | None |
| Did not add explicit `setExitReason(...)` calls to the phase auto-block files. | The exit wrapper already stamps a generic reason for any bare `process.exit`, and the spec only requires the marker line, exit code invariants, and crash coverage. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: healthy single-phase run ends with `code=0` and an ISO timestamp | Met | Covered by `main writes one exit marker with code=0 and an ISO timestamp on a successful single-phase run` in [`tests/run-task-safety.test.ts`](tests/run-task-safety.test.ts). |
| AC-2: Claude non-zero exits and Codex spawn/stall/signal exits emit named reasons; Codex non-zero by itself does not exit | Met | Covered by the agent-failure ladder test in [`tests/run-task-safety.test.ts`](tests/run-task-safety.test.ts) and the reason-setting branches in [`scripts/run-task/agents/claude.ts`](scripts/run-task/agents/claude.ts) and [`scripts/run-task/agents/codex.ts`](scripts/run-task/agents/codex.ts). |
| AC-3: die() exits, including parse/dependency failures, carry the die message in the marker reason | Met | `die()` stamps its message in [`scripts/run-task/cli.ts`](scripts/run-task/cli.ts); the invalid-task-ID test covers an early parse-time die. |
| AC-4: uncaught exception and unhandled rejection both produce a marker plus stack and exit 1 | Met | Covered by the crash-handler test in [`tests/run-task-safety.test.ts`](tests/run-task-safety.test.ts) and the synchronous handlers in [`scripts/run-task/cli.ts`](scripts/run-task/cli.ts). |
| AC-5: the marker survives `process.exit` from any depth | Met | The exit write lives in the `process.on('exit')` hook, and `main()` installs it before any phase work; the healthy path test confirms the marker is present on a natural exit. |
| AC-6: exactly one marker line per process exit | Met | The marker is written only from the `exit` handler; the crash-path tests assert exactly one marker line. |
| AC-7: existing exit codes remain unchanged and the new crash handlers pin theirs | Met | The suite covers success exit 0, unrecovered phase exit 2, agent non-zero passthrough, and uncaught/unhandled exit 1. |

## Edge Cases Considered

- `die()` during argument parsing or dependency checks, before any phase work has started.
- Crash handlers firing and then falling through to the `exit` hook, which must still yield one coherent marker.
- Natural process exit after a non-zero Codex result that does not itself exit the orchestrator.
- Synchronous-only constraints inside Node's `exit` hook.

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
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Ran clean after the source updates. |
| `type-check` (`npm run type-check`) | Pass | `tsc -p tsconfig.json --noEmit` passed. |
| `unit tests` (`npm test`) | Pass | Full suite passed: 830 passed, 1 skipped, 0 failed. |
| `build` (`npm run build`) | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js` successfully. |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | Reported `All canon-managed files in sync`. |

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

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

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
