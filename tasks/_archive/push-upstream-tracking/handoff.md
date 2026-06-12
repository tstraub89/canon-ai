# Implementation Handoff: push-upstream-tracking

> Author: Codex | Spec: `tasks/push-upstream-tracking/spec.md` | Plan: `tasks/push-upstream-tracking/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/main.ts` | Added `-u` / `--set-upstream` to both human_review `git push` call sites. |
| `dist/scripts/run-task.js` | Rebuilt from `scripts/run-task/main.ts` so the bundled CLI carries the same upstream-tracking push flag. |
| `tests/run-task-safety.test.ts` | Updated the fake-git harness for upstream-aware pushes, added command-vector assertions for both push paths, and added a push-failure regression for the preserved `die(...)` message. |
| `tests/run-task-ship.test.ts` | Expanded the real-git human_review integration test to assert upstream tracking, `status -sb` output, and rerun idempotence. |
| `tasks/push-upstream-tracking/notes.md` | Appended implementation notes about the fake-gh state file and the dirty-tree prerequisite for the push-failure test. |
| `tasks/push-upstream-tracking/status.json` | Advanced the task phase bookkeeping from `implement` to `done` at the end of the implementation pass. |
| `tasks/push-upstream-tracking/handoff.md` | Wrote the implementation handoff itself. |

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

Keep the implementation narrow: both human_review push sites now invoke `git push -u origin <branch>` so the first push establishes `origin/<branch>` as the tracking ref and repeated pushes stay idempotent. I kept the failure path unchanged and expanded the existing safety and ship fixtures to prove the command vector, the tracking ref, the `git status -sb` header, rerun behavior, and the existing push-failure message.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Added/updated test coverage in `tests/run-task-safety.test.ts` and `tests/run-task-ship.test.ts` | The spec required verification of both the push argv and the resulting tracking ref. The existing tests already covered the human_review paths, so extending them was the smallest way to satisfy AC-1 through AC-6. | None; it only strengthens the proof. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: The push at the clean-tree `human_review` path (`main.ts:1117`) sets upstream tracking (`-u` / `--set-upstream`). Verify by inspecting the `git push` argument vector in a unit/integration test or by post-push tracking-ref assertion. | Met | `scripts/run-task/main.ts:1117` now uses `gitSafeAt(cwd, 'push', '-u', 'origin', branchName)`, and `tests/run-task-safety.test.ts:1844-1849` asserts the clean-tree path logs `push -u origin task/task-a`. |
| AC-2: The push at the dirty-tree commit-then-push path (`main.ts:1215`) sets upstream tracking. Same verification. | Met | `scripts/run-task/main.ts:1215` now uses `gitSafeAt(cwd, 'push', '-u', 'origin', branchName)`, and `tests/run-task-safety.test.ts:2041-2045` asserts the dirty-tree path logs `push -u origin task/task-a`. |
| AC-3: After `canon run <id> --pr` (or `--push`), `git -C <worktree> rev-parse --abbrev-ref <branch>@{upstream}` resolves to `origin/<branch>` — the tracking ref is established. | Met | `tests/run-task-ship.test.ts:510-523` runs `--pr` on a real git fixture and asserts `rev-parse --abbrev-ref task/...@{upstream}` returns `origin/task/...`. |
| AC-4: After the push, `git -C <worktree> status -sb` shows the branch tracking origin (header line of the form `## <branch>...origin/<branch>`). | Met | `tests/run-task-ship.test.ts:520-523` and `:531-534` assert the `status -sb` header contains the `## task/...origin/task/...` tracking line. |
| AC-5: Idempotent — re-running `--pr` when the branch is already pushed and already tracking origin succeeds with no error (the `-u` flag is a safe no-op on an already-tracking branch). Verify by running `--pr` twice in a row. | Met | `tests/run-task-ship.test.ts:510-535` runs `--pr` twice in the same real-git fixture; both invocations exit 0 and the tracking ref remains intact. |
| AC-6: No regression to push-failure handling — a failed push still triggers the existing `die(...)` path with its message intact. | Met | `tests/run-task-safety.test.ts:2479-2494` forces `git push` to fail and asserts the stderr still contains `Human review push failed: simulated push failure`. |

## Edge Cases Considered

- `-u` is safe to repeat on an already-tracking branch, so the retry path stays idempotent.
- The dirty-tree push-failure test needs an allowed dirty task artifact to reach the `git push` branch; a clean tree exits earlier.
- The real-git `--pr` rerun test uses the fake gh state file so the second invocation sees the PR created by the first run.
- `git status -sb` is asserted directly so the tracking ref proof is visible in the branch header, not just in `rev-parse`.

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
| `npm run lint` | Pass | Reran on the final tree after the test edits. |
| `npm run type-check` | Pass | Reran on the final tree after the test edits. |
| `npm test` | Pass | Full suite passed after the push-flag and tracking-ref coverage was added. |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js` after the source change. |
| `npm run sync-templates:check` | not_configured | Spec marked this N/A; no canon-managed root/template pair changed. |
| `npm run docs-refs-check` | not_configured | Spec marked this N/A; no docs reference update was required. |
| `E2E` | not_configured | Spec marked this N/A; there is no UI surface for this change. |

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
