# Implementation Handoff: orchestrator-survive-sighup

> Author: Codex | Spec: `tasks/orchestrator-survive-sighup/spec.md` | Plan: `tasks/orchestrator-survive-sighup/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `scripts/run-task.ts` | Installed a top-level `process.on('SIGHUP', ...)` handler that logs through `warn()` and continues; added an `import.meta.url` guard so the entrypoint still runs directly but can also be imported by the focused signal harness. |
| `scripts/run-task/agents/stream.ts` | Changed child stdin from `inherit` to `ignore` and left the rest of the stream plumbing untouched. |
| `tests/run-task-signals.test.ts` | Added a focused self-signal harness that imports `scripts/run-task.ts`, proves SIGHUP survival after a short delay, and verifies SIGINT still terminates the process. |
| `docs/patterns.md` | Added the new "Orchestrator survives supervising-shell death; the stall timer still detects hangs" pitfall entry. |
| `docs/BACKLOG.md` | Annotated the harness-bugs entry with the shipped survival fix while leaving detach mode and heartbeat detection open. |
| `dist/scripts/run-task.js` | Rebuilt the published bundle so the compiled entrypoint includes the SIGHUP handler, import guard, and stdin change. |

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

Make the orchestrator survive SIGHUP from a dying supervising shell without changing foreground SIGINT behavior or any other stream-handling logic. The entrypoint installs the signal handler at module top-level, the child-agent stdin is severed from the supervising tty, and the docs now describe the fix plus the remaining detach/heartbeat work. The test is deliberately focused on the signal contract itself so it proves the handler behavior without dragging unrelated pipeline phases into the assertion.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Added an `import.meta.url` guard around the direct `main()` invocation in `scripts/run-task.ts`. | The focused signal harness imports the entry module as a module; without the guard, import-time testing would auto-run the pipeline. The handler still installs at module top-level before any phase work begins. | None |
| Implemented AC-2/AC-4 with a focused self-signal harness rather than a full pipeline run. | The spec explicitly allows "a focused harness that loads the same SIGHUP-handler module." This keeps the test narrow and stable while still exercising the same entry module. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `scripts/run-task.ts` installs `process.on('SIGHUP', ...)` at module top-level (before any phase work begins). The handler writes one line to stderr via the existing `warn()` helper (so it lands in the log) and returns; it does NOT call `process.exit`. | Met | `scripts/run-task.ts` installs the handler before the direct-run guard, and the handler only calls `warn(...)`. |
| AC-2: After the SIGHUP handler is installed, sending SIGHUP to the Node process does not terminate it. Verified by a test that spawns `scripts/run-task.ts` (or a focused harness that loads the same SIGHUP-handler module), sends SIGHUP to the child via `process.kill(pid, 'SIGHUP')`, waits, and asserts `child.exitCode === null` after a short delay. | Met | `tests/run-task-signals.test.ts` imports `scripts/run-task.ts`, self-sends SIGHUP after load, waits 200ms, checks the child is still alive, and then lets it exit cleanly. |
| AC-3: `streamProcess` at `scripts/run-task/agents/stream.ts:30` spawns children with `stdio: ['ignore', 'pipe', 'pipe']` (was `['inherit', 'pipe', 'pipe']`). No other stream-handling logic changes. | Met | Only the stdin slot changed; stdout/stderr capture and stall handling are unchanged. |
| AC-4: SIGINT (Ctrl-C) behavior is unchanged. The orchestrator still terminates on SIGINT. Verified by a test analogous to AC-2 that sends SIGINT and asserts the process exits. | Met | The second case in `tests/run-task-signals.test.ts` self-sends SIGINT and asserts the process exits via `SIGINT`. |
| AC-5: `docs/patterns.md` "Known Pitfalls" gains a one-paragraph entry referencing this fix: pre-fix failure mode (silent death on supervising-shell exit), post-fix behavior (orchestrator survives; stall timer remains the detection layer for hung agents), and a pointer to the BACKLOG entry for the deferred detach/heartbeat work. | Met | Added the new pitfall paragraph under the existing test-writing pitfalls section. |
| AC-6: The BACKLOG entry "Orchestrator dies with supervising bash..." in `docs/BACKLOG.md` § "🐛 Harness Bugs" is updated to mark the survival fix shipped (checkbox `[x]` is NOT flipped — the entry covers detach + heartbeat too, which remain open; instead, add a parenthetical "survival fix shipped <date>; detach mode and heartbeat-detection layer remain open" at the top of the entry). | Met | The entry now starts with the shipped-fix parenthetical and leaves the checkbox open. |

## Edge Cases Considered

- Kept the SIGHUP handler at module top-level so it is installed before any async phase work begins.
- Left SIGINT untouched so foreground Ctrl-C behavior remains the default Node behavior.
- Used a focused self-signal harness so the signal contract is exercised without depending on a long-running pipeline phase or a fake agent subprocess.
- Rebuilt `dist/scripts/run-task.js` so the packaged entrypoint matches the source changes.

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
| `lint` (`npm run lint`) | Pass | `eslint scripts/ tests/ src/` completed cleanly. |
| `type-check` (`npm run type-check`) | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `unit tests` (`npm test`) | Pass | Full suite passed; includes `tests/run-task-signals.test.ts`. |
| `build` (`npm run build`) | Pass | Rebuilt `dist/scripts/run-task.js` to match the source changes. |
| `docs-refs-check` (`npm run docs-refs-check`) | Pass | Docs refs stayed clean after the `docs/patterns.md` and `docs/BACKLOG.md` updates. |

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

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g., trailing newline): add it here as "Reverted to original (describe residual diff)".

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
