# Implementation Handoff: implement-done-evidence-guard

> Author: Codex | Spec: `tasks/implement-done-evidence-guard/spec.md` | Plan: `tasks/implement-done-evidence-guard/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/main.ts` | Extracted the implement evidence gates into `checkImplementEvidence`, gated stale `implement: done` through existing recovery, re-checked evidence after retry success, and registered exit handlers before parse/dependency checks. |
| `scripts/run-task/cli.ts` | Added exit-reason state, the synchronous exit-marker writer, `die()` reason stamping, and parseArgs reason hints. |
| `scripts/run-task/agents/claude.ts` | Set exit reasons on the Claude failure ladder before each process exit. |
| `scripts/run-task/agents/codex.ts` | Set exit reasons on Codex spawn/stall/signal failure branches; left the non-zero warning path as a return. |
| `tests/run-task-safety.test.ts` | Added stale-done, retry, valid-evidence, and exit-marker subprocess coverage; extended the fake git stub so the new assertions can drive the real recovery and auto-commit branches. |
| `dist/cli/index.js` | Rebuilt bundle output from the source changes. |
| `dist/scripts/run-task.js` | Rebuilt bundle output from the source changes. |
| `tasks/implement-done-evidence-guard/notes.md` | Appended raw implementation observations for QA distillation. |
| `tasks/implement-done-evidence-guard/status.json` | Task phase bookkeeping was advanced to `code_review` by the phase-close command after the implement pass. |
| `tasks/implement-done-evidence-guard/handoff.md` | Filled this handoff artifact. |
| `tasks/orchestrator-exit-logging/notes.md` | Appended a raw cross-task observation about the exit marker behavior. |
| `tasks/orchestrator-exit-logging/status.json` | Cross-task artifact was advanced to `code_review` by the phase-close command after the bundle pass. |
| `tasks/orchestrator-exit-logging/handoff.md` | Filled the sibling task's handoff artifact. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `upstream_repo` in `tasks/implement-done-evidence-guard/status.json` |
| Upstream commit | `upstream_commit` in `tasks/implement-done-evidence-guard/status.json` |
| Orchestrator commit | `orchestrator_commit` in `tasks/implement-done-evidence-guard/status.json` |
| Codex CLI | `codex_cli` in `tasks/implement-done-evidence-guard/status.json` |
| Claude Code | `claude_code` in `tasks/implement-done-evidence-guard/status.json` |

## Intent & Rationale

The implement recovery path now treats a status-claimed `implement: done` as provisional until the handoff evidence passes the same four gates already used by `tryEvidenceAdvance`. That keeps a stale `done` from bypassing recovery, preserves the stored Codex session for the next retry, and still honors healthy handoffs unchanged. The same bundle also picked up the exit-marker hardening so every orchestrator death ends with a durable log line.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| None for this task. | The implement evidence gate followed the plan: shared helper, stale-done gate, retry recheck, no new gates on the healthy path. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: stale `implement: done` + empty handoff does not advance, runs recovery, exits 2 on failure, leaves `implement` in_progress, preserves sessions, and logs the evidence failure with a resume pointer | Met | Covered by `checkAndRoute revalidates implement done evidence before recovery and preserves sessions on a failed retry` in [`tests/run-task-safety.test.ts`](tests/run-task-safety.test.ts) and the `checkAndRoute` stale-done branch in [`scripts/run-task/main.ts`](scripts/run-task/main.ts). |
| AC-2: a fresh `canon run <id>` sees the same stale-done + empty-handoff behavior | Met | The same subprocess test exercises a fresh orchestrator invocation against pre-seeded stale state, not the original Codex process. |
| AC-3: valid handoff evidence is honored with no new healthy-path gates | Met | `checkImplementEvidence` is shared with `tryEvidenceAdvance`; the valid-evidence test proves the healthy path still proceeds. |
| AC-4: retry ending with done but still-bad evidence does not log "Retry succeeded", reverts to in_progress, and exits 2 | Met | Covered by the failed-retry subprocess case in [`tests/run-task-safety.test.ts`](tests/run-task-safety.test.ts). |
| AC-5: retry ending with done and valid evidence logs "Retry succeeded" and proceeds | Met | Covered by `checkAndRoute logs Retry succeeded when implement retry produces valid evidence` in [`tests/run-task-safety.test.ts`](tests/run-task-safety.test.ts). |
| AC-6: the implement evidence gate exists once, shared by `tryEvidenceAdvance` and both new call sites | Met | The gate lives in `checkImplementEvidence` in [`scripts/run-task/main.ts`](scripts/run-task/main.ts) and is called from the `tryEvidenceAdvance` path, the stale-done gate, and the retry-success recheck. |

## Edge Cases Considered

- Fresh invocation after a previous orchestrator death, where no Codex process is currently running.
- Session preservation when the stale-done rollback rewrites `status.json` back to `in_progress`.
- Healthy handoffs that are already valid and should continue through the existing auto-commit flow unchanged.
- Retry success that still fails evidence, which must not emit "Retry succeeded".

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
| `lint` (`npm run lint`) | Pass | Ran clean after removing unused test imports and the unnecessary exit shim assertions. |
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
