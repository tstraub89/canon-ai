# Plan: worktree-canonical-task-state — Worktree-canonical task state from implement onward

> Written by: Claude | Implements: `tasks/worktree-canonical-task-state/spec.md`

## Spec-review nit incorporated

The spec says `getActiveCwd(taskIds)` creates the worktree. The actual flow is: `ensureBranch(taskIds)` (implement.ts:46) calls `ensureWorktree` via `git.ts:173-214`, creating the worktree. `getActiveCwd` (line 66) then *finds* the existing one. The plan reflects the real flow. No behavior change needed — just don't reference the incorrect explanation in comments.

---

## Step 1 — `state.ts`: Add `taskDirForRepoRoot`, rewire `taskDirFor`, fix `resolveTaskCwd`

**Files**: `scripts/run-task/state.ts`

This is the foundational change. Do all three sub-steps atomically before touching any other file.

**1a.** Add `taskDirForRepoRoot` immediately before the current `taskDirFor` at line 34. Export it:

```ts
// REPO_ROOT-only resolver. Reserved for callers that intentionally need REPO_ROOT semantics
// regardless of worktree state — currently resolveTaskCwd (breaks the self-reference cycle),
// commitTaskArtifactsToBase (scaffold-to-base commit), and the post-teardownWorktree
// archive-move in shipTasks. Do not use for general task-state reads; use taskDirFor() instead.
export function taskDirForRepoRoot(taskId: string): string {
    return path.join(process.env.CANON_TASKS_DIR_OVERRIDE ?? TASKS_DIR, taskId);
}
```

**1b.** Rewire `taskDirFor` body (same line 34, now shifted):

```ts
export function taskDirFor(taskId: string): string {
    // CANON_TASKS_DIR_OVERRIDE is the test-harness escape hatch — when set,
    // it MUST win over worktree resolution. Tests set this to a temp directory
    // and expect both reads and writes to land there regardless of any
    // `dev-worktrees/<id>/` directory that happens to exist (test setup may
    // construct fake worktree dirs to exercise resolveTaskCwd elsewhere).
    // Without this fast-path, the rewire would route to the worktree and
    // ignore the override, breaking the CANON_TASKS_DIR_OVERRIDE guarantee.
    if (process.env.CANON_TASKS_DIR_OVERRIDE) {
        return path.join(process.env.CANON_TASKS_DIR_OVERRIDE, taskId);
    }
    return path.join(resolveTaskCwd(taskId), 'tasks', taskId);
}
```

**1c.** In `resolveTaskCwd`, change the status-read at line 45 from:
```ts
const statusPath = path.join(taskDirFor(taskId), 'status.json');
```
to:
```ts
const statusPath = path.join(taskDirForRepoRoot(taskId), 'status.json');
```
This breaks the infinite recursion that would otherwise result from 1b's rewire.

**Verify** (AC-1, AC-2, AC-3): `taskDirForRepoRoot` is exported, calls no `resolveTaskCwd`. `taskDirFor` has the override fast-path before `resolveTaskCwd`. `resolveTaskCwd` line 45 uses `taskDirForRepoRoot`.

---

## Step 2 — `git.ts`: Switch `commitTaskArtifactsToBase` to `taskDirForRepoRoot` + two-phase restructure

**Files**: `scripts/run-task/git.ts`

**2a.** Add `taskDirForRepoRoot` to the import from `./state.js` (alongside existing `taskDirFor`). Add `PIPELINE_TELEMETRY_FILES` to the import from `./worktree.js`.

**2b.** Restructure `commitTaskArtifactsToBase` (lines 83-93) per AC-4 + AC-22d. The new body has two strict phases. Use `--only` on every `git commit` so each commit contains only its intended paths (prevents pre-staged content from bleeding across commit boundaries):

```ts
export function commitTaskArtifactsToBase(taskIds: string[], _artifactFiles: ReadonlySet<string>): void {
    void _artifactFiles;
    // Phase 1: per-task scaffold commits (--only prevents sweeping pre-staged telemetry)
    for (const taskId of taskIds) {
        const taskDir = path.relative(REPO_ROOT, taskDirForRepoRoot(taskId));
        const status = gitSafe('status', '--porcelain', '--', taskDir);
        if (!status.ok || status.stdout.trim().length === 0) continue;
        git('commit', '--only', '-m', `task(${taskId}): commit artifacts pre-pipeline`, '--', taskDir);
        info(`Committed task artifacts for ${taskId} to base branch.`);
    }
    // Phase 2: telemetry absorption (one commit covering all dirty PIPELINE_TELEMETRY_FILES)
    const dirtyTelemetry: string[] = [];
    for (const relPath of PIPELINE_TELEMETRY_FILES) {
        const status = gitSafe('status', '--porcelain', '--', relPath);
        if (status.ok && status.stdout.trim().length > 0) {
            dirtyTelemetry.push(relPath);
        }
    }
    if (dirtyTelemetry.length > 0) {
        git('commit', '--only', '-m',
            `chore: absorb pre-implement telemetry into scaffold for ${taskIds.join(', ')}`,
            '--', ...dirtyTelemetry);
        info(`Absorbed pre-implement telemetry into scaffold for ${taskIds.join(', ')}.`);
    }
}
```

Note on `git commit --only -- <pathspec>`: this takes the specified paths from the **working tree** (not the index), builds a temporary index with only those paths, and commits from that. The `--only` flag is what prevents an in-progress `git add` on telemetry files from bleeding into per-task scaffold commits.

**Verify** (AC-4, AC-22d): Line 86 equivalent uses `taskDirForRepoRoot`. Both commit calls use `--only`. Telemetry phase is a separate commit with a distinct message. No bare `git commit -m '...'` (without pathspec restriction) remains in this function.

---

## Step 3 — `main.ts`: Fix archive-move + import `taskDirForRepoRoot`

**Files**: `scripts/run-task/main.ts`

**3a.** Add `taskDirForRepoRoot` to the import/destructuring of `splitState` at the top of `main.ts` (around line 98 where `taskDirFor` is imported). The existing re-export `const taskDirFor = splitState.taskDirFor` at line 102 stays — it propagates the rewired function to all the other consumers in main.ts (lines 182, 1984, 2012, 2013, 2083) automatically.

**3b.** At line 1737, change:
```ts
const src = taskDirFor(taskId);
```
to:
```ts
const src = taskDirForRepoRoot(taskId);
```
This runs AFTER `teardownWorktree` at line 1729 — the worktree is gone. The rewired `taskDirFor` would either die (per `resolveTaskCwd`'s die path) or fall through incorrectly. Explicit REPO_ROOT resolution is required.

**Verify** (AC-5): Line 1737 equivalent uses `taskDirForRepoRoot`.

---

## Step 4 — `worktree.ts`: Delete `syncWorktreeArtifacts`, `syncWorktreeTelemetry`, `flushWorktreeTelemetry`

**Files**: `scripts/run-task/worktree.ts`

**4a.** Delete `syncWorktreeArtifacts` (lines 215-243). Remove its export.

**4b.** Delete `syncWorktreeTelemetry` (lines 245-352). Remove its export.

**4c.** Locate `flushWorktreeTelemetry` (grep for it; it ends just before line 215 based on the commit message at line 210). Delete the entire function declaration and its export. Zero callers confirmed post-d7c2dbc.

**4d.** Audit for private helpers used *only* by the deleted functions (check for any unlisted helpers inside those function bodies). Delete any such private-only helpers.

**Verify** (AC-6, AC-7, AC-8): After Step 5 removes call sites: `grep -rn "syncWorktreeArtifacts\|syncWorktreeTelemetry\|flushWorktreeTelemetry" scripts/ src/ tests/` returns zero matches.

---

## Step 5 — `main.ts`: Remove sync call sites + delete `mirrorHumanReviewDocsToCwd`

**Files**: `scripts/run-task/main.ts`

**5a.** Remove the two post-phase sync calls. The spec references them at lines 2404-2405, but after searching context (Step 4's location), locate and remove the `syncWorktreeArtifacts(taskIds)` and `syncWorktreeTelemetry(taskIds)` call sites. Remove any now-unused import references to those names from `splitWorktree`.

**5b.** Delete `mirrorHumanReviewDocsToCwd` (lines 651-667). Under SSOT past plan, the worktree's telemetry is already canonical; copying REPO_ROOT's partial telemetry over the worktree's would overwrite valid content.

**5c.** Remove the call to `mirrorHumanReviewDocsToCwd(cwd)` at line 909 in `commitHumanReviewFiles`.

**Verify** (AC-22c): `grep -rn "mirrorHumanReviewDocsToCwd" scripts/ src/ tests/` returns zero matches.

---

## Step 6 — `phases/implement.ts`: Delete REPO_ROOT → worktree copy loop

**Files**: `scripts/run-task/phases/implement.ts`

Delete lines 48-64 — the `if (isWorktreeEnabled(taskIds)) { ... }` block that copies spec.md, spec-review.md, plan.md, notes.md from REPO_ROOT to the worktree (including the `info('Synced task artifacts...')` line inside). The `ensureBranch(taskIds)` at line 46 and `const activeCwd = getActiveCwd(taskIds);` at line 66 remain.

Remove any now-unused imports (`isWorktreeEnabled` if no longer needed; audit before removing — it may have other uses in implement.ts's broader function body).

**Verify** (AC-9): Read the source. The function transitions from `worktreeAlreadyCreated` gate → `ensureBranch` → directly to `const activeCwd = getActiveCwd(taskIds)`. No copy loop between those calls.

**AC-11 verification**: Confirm no `taskDirFor` call exists between `ensureBranch` (line 46) and `getActiveCwd` (line 66). `ensureBranch` already creates the worktree via `ensureWorktree`, so `getActiveCwd` finds an existing worktree — no timing window. Read implement.ts after the deletion to verify.

---

## Step 7 — `phases/code-review.ts`: Delete REPO_ROOT → worktree copy loop

**Files**: `scripts/run-task/phases/code-review.ts`

Delete lines 92-107 — the `if (isWorktreeEnabled(taskIds)) { ... }` block that copies spec.md, spec-review.md, plan.md, notes.md from REPO_ROOT to the worktree (including the `info('Synced task artifacts...')` line).

Do **NOT** touch the BLOCKED-rejection write path at lines 80-86 — that writes `review.md` via `resolveTaskCwd(taskId)` directly (already worktree-aware), and must be preserved.

Remove any now-unused imports (audit `isWorktreeEnabled`, `taskDirFor` — check whether they have other uses in the file before removing).

**Verify** (AC-10): Read the source. The `if (isWorktreeEnabled(taskIds))` block at lines 92-107 is gone. The `resolveTaskCwd` write at line 84 is present.

After the rewire in Step 1, the stale comment at code-review.ts lines 119-123 ("taskDirFor would resolve to REPO_ROOT and read a stale copy") is now false. Leave it for Step 12 which handles all stale comments together.

---

## Step 8 — `types.ts` + `agents/claude.ts` + `agents/codex.ts`: Add `activeCwd` to metrics types

**Files**: `scripts/run-task/types.ts`, `scripts/run-task/agents/claude.ts`, `scripts/run-task/agents/codex.ts`

**8a.** In `types.ts`, add `activeCwd?: string` to `MetricEntry` at line 142 (after `tokens?: number`):
```ts
activeCwd?: string;
```
Optional for backward-compat with synthetic test callers.

**8b.** In `agents/claude.ts`, extend the inline `metricsContext` parameter type at line 63 to include `activeCwd?: string`:
```ts
metricsContext?: { taskId: string; phase: string; iteration?: number; activeCwd?: string },
```
The existing `recordMetric({ ...metricsContext, ... })` spread at line 225 automatically forwards `activeCwd` to `MetricEntry`.

**8c.** Same change in `agents/codex.ts` at line 15.

**Verify** (AC-22b — types and producers): `MetricEntry` has `activeCwd?: string`. Both agent function signatures include `activeCwd?: string` in the `metricsContext` type.

---

## Step 9 — `metrics.ts`: Accept `activeCwd` in `getMetricsFile`, use in `recordMetric`

**Files**: `scripts/run-task/metrics.ts`

**9a.** Update `getMetricsFile` signature and body (AC-22a):
```ts
export function getMetricsFile(activeCwd?: string): string {
    return process.env.CANON_METRICS_FILE_OVERRIDE
        ? path.resolve(process.env.CANON_METRICS_FILE_OVERRIDE)
        : path.join(activeCwd ?? REPO_ROOT, 'docs/pipeline-invocations.md');
}
```

**9b.** In `recordMetric` (line 14), change `const metricsFile = getMetricsFile();` to `const metricsFile = getMetricsFile(entry.activeCwd);`.

**Verify** (AC-22a, AC-22b — consumer): `getMetricsFile` has optional `activeCwd` param. `recordMetric` passes `entry.activeCwd`.

---

## Step 10 — Phase modules: Add `activeCwd` to `metricsContext`

**Files**: `scripts/run-task/phases/spec.ts`, `phases/spec-review.ts`, `phases/plan.ts`, `phases/implement.ts`, `phases/code-review.ts`, `phases/qa.ts`

For each phase module that calls `runClaude` or `runCodex` with a `metricsContext` object, add `activeCwd: getActiveCwd(taskIds)` to that object. Audit each file for the exact line numbers.

For `qa.ts` line 26: the existing `runClaude` call already passes `getActiveCwd(taskIds)` as the trailing `cwd` argument. Add `activeCwd: getActiveCwd(taskIds)` inside the `metricsContext` object literal (the 7th argument) before that `cwd` argument.

Pre-implement phases (spec, spec_review, plan): `getActiveCwd(taskIds)` returns REPO_ROOT when no worktree exists yet. No special-casing — the same call works for both.

**Verify** (AC-22b — callers): Every `metricsContext` literal in all six phase modules includes `activeCwd: getActiveCwd(taskIds)`.

---

## Step 11 — `src/task/index.ts`: Rewire `taskDirForCwd` + `taskList`

**Files**: `src/task/index.ts`

`resolveTaskCwd` is already imported at line 13.

**11a.** Update `taskDirForCwd` (lines 65-70) to apply worktree-resolution (AC-21b):

```ts
function taskDirForCwd(cwd: string, taskId: string): string {
    const root = tasksRoot();
    if (path.isAbsolute(root)) {
        // CANON_TASKS_DIR_OVERRIDE is set — absolute path wins over worktree resolution.
        return path.join(root, taskId);
    }
    // Use resolveTaskCwd to pick the canonical cwd: worktree past plan, REPO_ROOT otherwise.
    const canonicalCwd = resolveTaskCwd(taskId);
    return path.join(canonicalCwd, root, taskId);
}
```

The `cwd` parameter is unused in the non-override branch (replaced by `resolveTaskCwd`). Signature unchanged so all callers (`taskStatus`, `taskAccept`, `taskPhase`, `taskNew`) inherit automatically. `taskStatus` at line 299 already uses `resolveTaskCwd(id)` directly and is already worktree-aware — no change needed there.

**11b.** In `taskList()` (lines 247-297), change the per-entry status path read at line 260 from:
```ts
const statusPath = path.join(root, entry, 'status.json');
```
to:
```ts
const statusPath = path.join(taskDirForCwd(process.cwd(), entry), 'status.json');
```
The `fs.readdirSync(root)` directory enumeration stays REPO_ROOT-relative — "what tasks exist" is always read from REPO_ROOT because every task starts there pre-implement. Only the per-entry status-file read switches to the worktree-aware helper.

**Verify** (AC-21b, AC-21d): `taskDirForCwd` has the absolute-root branch and the `resolveTaskCwd` branch. `taskList` line 260 equivalent uses `taskDirForCwd(process.cwd(), entry)`.

---

## Step 12 — Fix stale comments

**Files**: `scripts/run-task/phases/qa.ts`, `scripts/run-task/phases/code-review.ts`, `scripts/run-task/main.ts`

**12a.** `qa.ts` lines 36-39: The comment says "taskDirFor() is not worktree-aware; a REPO_ROOT write would be clobbered milliseconds later by syncWorktreeArtifacts." Both halves are false post-rewire. Update to: the `getActiveCwd()` cwd arg is used here to match where Claude wrote, and `syncWorktreeArtifacts` no longer exists.

**12b.** `code-review.ts` lines 80-83: The comment says "taskDirFor is not worktree-aware and would land in REPO_ROOT, where main.ts's later worktree sync would clobber the BLOCKED reason." Update — `taskDirFor` is now worktree-aware and the sync is gone; `resolveTaskCwd` is still used directly here for historical clarity.

**12c.** `code-review.ts` lines 119-123: The comment says "taskDirFor would resolve to REPO_ROOT and read a stale (likely still-template) copy." False post-rewire. Update or delete.

**12d.** Audit `main.ts` around lines 1596 and 2398 for similar stale claims about `taskDirFor` being REPO_ROOT-only. Update where misleading.

**Verify** (AC-26): Read the three named comment blocks. None claim `taskDirFor` is REPO_ROOT-only.

---

## Step 13 — Tests: delete sync tests + add new coverage

**Files**: `tests/run-task-safety.test.ts`, `tests/run-task-state.test.ts` (or nearest unit test file for state.ts)

**13a.** Delete the four `syncWorktreeTelemetry` tests per AC-14:
- Line 736: `syncWorktreeTelemetry skips a telemetry file when destination has file-specific commits source lacks`
- Line 798: `syncWorktreeTelemetry copies telemetry docs even when the new content is the same length`
- Line 849: `syncWorktreeTelemetry preserves external dirty edits to managed docs in supervising`
- Line 2525: `syncWorktreeTelemetry mirrors managed docs to supervising and keeps worktree edits for autoCommit`

**13b.** **AC-12 unit test** — pre-implement REPO_ROOT correctness: create a task fixture with `worktree: true, branch: ""` using `CANON_TASKS_DIR_OVERRIDE`. Assert `taskDirFor(taskId)` returns the override-based path (REPO_ROOT equivalent when no worktree dir exists).

**13c.** **AC-13 unit test** — post-implement worktree resolution: create a fixture with `worktree: true, branch: "task/foo"` and a fake worktree directory at the conventional `dev-worktrees/foo/tasks/foo/` path (via `CANON_WORKTREES_ROOT` override or temp dir structure). Do NOT use `CANON_TASKS_DIR_OVERRIDE` — the override fast-path in `taskDirFor` would bypass `resolveTaskCwd`. Assert `resolveTaskCwd(taskId)` returns the worktree path.

**13d.** **AC-21 unit test** — `canon task new` stays REPO_ROOT-only: run `canon task new foo-ssot-test "Test"`, assert `tasks/foo-ssot-test/` exists at REPO_ROOT, assert `dev-worktrees/foo-ssot-test/` does NOT exist. Clean up the test task dir.

**13e.** **AC-21c integration test** — `canon task status <id>` reads worktree state: create a worktree-mode task fixture, write a distinguishing value to the worktree's `tasks/<id>/status.json`, run `canon task status <id>` from REPO_ROOT cwd, assert output reflects the worktree's status.json content.

**13f.** **AC-21d integration test** — `canon task list` reflects worktree phases: two tasks, one worktree-mode (worktree status.json has a different phase than REPO_ROOT scaffold), one REPO_ROOT-only. Assert the worktree-mode row shows the worktree phase; REPO_ROOT-only row shows the scaffold phase.

**13g.** **AC-21e integration test** — `canon task accept/phase` writes to worktree: create worktree-mode task at implement phase with a populated worktree, run `canon task accept implement`, assert the worktree's `status.json` was updated; assert REPO_ROOT's scaffold `status.json` was NOT modified.

**13h.** **AC-16 integration test** — parser-cwd bug regression closed: worktree-mode task at human_review; add a managed doc to worktree's `tasks/<id>/spec.md` Affected Files (not in REPO_ROOT's spec.md); make that doc dirty in the worktree; run `canon run <id> --pr`; assert the v2 gate reads the worktree's spec.md and permits the commit. Follow the existing real-git fixture pattern in `tests/run-task-safety.test.ts`.

**13i.** **AC-17 integration test** — `--ship` post-merge-pull clean: simulate full pipeline for a worktree-mode task; after pipeline completes, assert `git status --porcelain` in REPO_ROOT shows no uncommitted `tasks/<id>/{done,handoff,notes,review}.md` files (the sync that wrote them is deleted).

**13j.** **AC-22e integration test** — pre-implement telemetry absorbed: simulate a spec_review phase appending to REPO_ROOT's `docs/pipeline-invocations.md`, then call `commitTaskArtifactsToBase`; assert the file is committed (not dirty in `git status`).

**13k.** **AC-22f integration test** — post-implement telemetry lands in worktree: run the implement phase (which calls `recordMetric` with `activeCwd` = worktree path); assert the worktree's `docs/pipeline-invocations.md` received the append; assert REPO_ROOT's `docs/pipeline-invocations.md` was NOT modified post-scaffold-commit.

**13l.** **AC-15 audit**: Run `npm test` after all code changes. Audit any failures caused by tests that formerly read REPO_ROOT post-pipeline and now need to read from the worktree path. Fix each test to either write to the side under test or read from the correct path.

**Test pitfalls to avoid** (from `docs/patterns.md` test pitfalls):
- Fixture paths for porcelain-delta tests must NOT match `.gitignore` patterns — use `fixture-output.txt`, not `*.tmp`.
- Subprocess tests must use active worktree cwd, not supervising checkout root — derive from `import.meta.url` or pass `process.cwd()` when invoked from worktree root.
- `commitHumanReviewFiles()` tests that need flag behavior must route through `main()` via the subprocess pattern in `tests/run-task-safety.test.ts`.
- If any test exercises legacy schema keys being retired, construct them by concatenation (not literal strings) to avoid violating structural grep ACs.

---

## Step 14 — Docs and template updates

**Files**: `CLAUDE.md`, `scripts/run-task/prompts/templates/implement-reroute.md`, `docs/patterns.md`, `docs/architecture.md`, `docs/decisions.md`, `docs/codebase-map.md`

**14a. `CLAUDE.md`** (AC-18): Locate the "Reroute" section. Replace "edit in MAIN" / "edit in REPO_ROOT" wording with: "edit the worktree's spec.md if a worktree exists for this task; edit REPO_ROOT only when no worktree exists (pre-implement state)." Add to "Quick refs": "`canon task status <id>` (and `list`/`accept`/`phase`) run from REPO_ROOT now read the worktree's status.json when one exists past plan — mid-pipeline status reads show live worktree state, not the frozen scaffold." Do NOT add guidance telling operators to `cd dev-worktrees/<id>` for live state — that describes the pre-fix behavior and would mislead.

**14b. `scripts/run-task/prompts/templates/implement-reroute.md`** (AC-19): Add explicit note to the "Read tasks/<id>/spec.md" line: `"Read tasks/<id>/spec.md from your current working directory (the worktree). REPO_ROOT's copy is the pre-implement scaffold and does NOT contain operator amendments."`

**14c. `docs/patterns.md`** (AC-20): In the "Operator git surgery on a task branch between phases discards uncommitted pipeline state" pitfall, add at the end: "This task (worktree-canonical-task-state) closes the stale-mirror class of fragility — `--pr` gates and validation now read the worktree, not REPO_ROOT. The worktree-uncommitted class (operator `git reset --hard` discards uncommitted post-implement state) persists; the QA-end-commit BACKLOG entry is the structural fix for that remaining half."

**14d. `docs/architecture.md`** (AC-22h): Update Tech Stack "Worktree" section. Replace "REPO_ROOT and worktree are kept in sync via..." with: "worktree is canonical for task-scoped state (task artifacts AND per-task telemetry) during pipeline execution; REPO_ROOT is canonical for project-level resources (managed docs, scripts/, src/, root agent files) and for pre-implement task state."

**14e. `docs/decisions.md`** (AC-23): Add a new decision entry "Worktree-canonical task state from implement onward." Cover: (1) What was decided: worktree is the single source of truth for task-scoped state from implement-phase start; (2) Why: the dual-source model (worktree + REPO_ROOT kept in sync via `syncWorktreeArtifacts`/`syncWorktreeTelemetry`) produced the parser-cwd bug class and the --ship post-merge-pull conflict bug; (3) Rule: use `taskDirFor` for all runtime task-state reads — it resolves to the worktree when one exists, REPO_ROOT otherwise. Use `taskDirForRepoRoot` ONLY for: scaffold commits (`commitTaskArtifactsToBase`), and the post-teardown archive-move in `shipTasks`. Never reintroduce REPO_ROOT mirrors of task artifacts.

**14f. `docs/codebase-map.md`** (AC-24): Update `worktree.ts` row in the Pipeline Orchestration table. New description: lifecycle (create / cleanup / detect / `findExistingWorktreeForBranch`), `PIPELINE_TELEMETRY_FILES` + `PIPELINE_MANAGED_DOCS` constants. Remove references to `syncWorktreeArtifacts` and `syncWorktreeTelemetry`.

---

## Step 15 — Build + validation

**Files**: `dist/cli/index.js`, `dist/scripts/run-task.js`

Run in order:
1. `npm run lint` — zero errors (AC-25)
2. `npm run type-check` — zero errors (AC-25)
3. `npm test` — full suite, zero failures (after AC-15 audit from Step 13l) (AC-25)
4. `npm run build` — regenerates `dist/cli/index.js` and `dist/scripts/run-task.js`. Commit both to the task branch (AC-25).

If `tests/run-task-prompts.test.ts` has snapshot tests for the implement-reroute template, AC-19's text change triggers snapshot mismatches. Update snapshots during this step.

**Verify** (AC-25): CI's `git diff --exit-code -- dist/` gate passes (built dist matches committed dist).

---

## Ordering rationale and critical path

Steps 1-3 are the structural foundation and must complete first — `taskDirForRepoRoot` needs to be importable before Steps 2 and 3 can compile. Step 1 alone breaks the recursion. Steps 4-7 delete sync machinery — independent of each other once Step 1 is done. Steps 8-10 thread metrics — independent of deletion steps. Step 11 handles the CLI surface (also after Step 1 since it imports `resolveTaskCwd` which depends on `taskDirForRepoRoot`). Step 12 cleans comments. Step 13 tests all code changes at once (AC-15 audit is easiest when all changes are done). Step 14 updates docs. Step 15 validates.

**Never do Step 15 (build) before all of 1-14 are complete** — the dist diff must reflect all changes including docs that affect template snapshots.
