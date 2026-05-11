# Code Review: counter-schema-migration

## Validation Gate

**BLOCKED — pre-flight rejected handoff before full review:**

- Validation Required item did not pass in handoff.md: `npm test` (118 existing + new tests per AC-10) — Fail - unrelated (Runtime-validation tests fail on sandbox permissions when they try to write fixtures under the supervising checkout path; see Blockers.)

## Verdict

- [x] **Changes requested** — fix the above and resubmit handoff.

---

## Round 2 — verifying iteration 1's response to round 1

### Prior findings

**Finding R1-1 (Stage 1 block): `npm test` failing — runtime-validation regression creates fixture dirs under the supervising checkout, which is outside the writable sandbox.**

**Status: Addressed.**

Iteration 2 resolved this with two targeted changes:

1. `scripts/run-task/state.ts` — Added `effectiveWorktreesRoot()` that reads `CANON_WORKTREES_ROOT` at call time instead of using the import-time constant. `resolveTaskCwd()` now delegates to it, making the worktrees root injectable via env var.

2. `tests/run-task-runtime-validation.test.ts` — All four tests are now wrapped in `runRuntimeValidationTest()`, which calls `withTempTasks()`. That helper sets `CANON_TASKS_DIR_OVERRIDE` to the worktree's own `tasks/` dir (writable) and creates a temp worktrees root under `process.cwd()` (also writable) via `mkdtempSync`. It restores both env vars and rmSync-cleans the temp root in `finally`. `createTask()` now creates a symlink `worktreesRoot/taskId → process.cwd()` so `resolveTaskCwd()` resolves to the current worktree rather than the supervising checkout.

Verified: `npm test` — 125 pass, 0 fail.

### New findings from iteration 2's changes

**optional cleanup/nit** — `tests/run-task-runtime-validation.test.ts:296`: the `cwd: 'repo_root'` test case was replaced with a second `cwd: 'worktree'` case to avoid writing to `REPO_ROOT` in the sandbox. This narrows coverage — the `repo_root` resolution path is no longer exercised in the test suite. The behavior is correct and unchanged; this is an environmental concession, not a regression. Worth restoring as a separate follow-up test (e.g. via a mock or explicit env-swap) but not blocking.

### Verdict

- [x] **Approved with nits** — round 1 blocker resolved; nit is non-blocking and noted above.
