# Implementation Plan: per-task-telemetry-fragments

> Written by: Claude | Implements: `tasks/per-task-telemetry-fragments/spec.md`

## Approach

Move each run-time telemetry writer from a shared doc to a fragment in the task folder, and add one new module, `src/orchestrator/telemetry-fold.ts`, that `--ship` calls once, between the merge-proof gate and the archive loop. The fold works in three stages: plan (read and compute everything in memory), apply (write temp files, rename them over the shared docs, delete the fragments), and roll back if apply fails partway. It throws on failure, and `shipTasks` turns that into `die`, so `telemetry-fold.ts` never imports `main.ts`. The quality-log fold lives in `quality-log.ts`, because it reuses that module's private parser, reconciler and row placement. `--pr` gets a warning-only drift check built from `getAffectedFiles` plus a pure filter.

Spec review was `approved` with no nits.

### Feasibility check

- **Exists:** these were checked against the code:
  - `recordMetric` and `getMetricsFile` (`src/orchestrator/metrics.ts`)
  - `upsertQualityLogRow`, `writeQualityLogForTask`, `locateLogTable`, `parseLogRows`, `parseStrayRows`, `reconcileHistory`, `buildFinalRow`, `renderRowLine`, `writeFileAtomic`, `STANDARD_QUALITY_LOG_SKELETON`, `DERIVED_HEADERS` (`src/orchestrator/quality-log.ts`)
  - `shipTasks`, `rewriteArchivedTaskRefs`, `stageArchiveChanges`, `commitArchiveChanges`, `commitHumanReviewFiles`, and `reportOrCreatePR` (called at two sites) (`src/orchestrator/main.ts`)
  - `taskDirForRepoRoot` (`src/orchestrator/state.ts`), `getAffectedFiles` (`src/orchestrator/git.ts`), `PIPELINE_TELEMETRY_FILES` (`src/orchestrator/worktree.ts`)
  - `promptQa` (`src/orchestrator/prompts/index.ts`), the `UPDATE_GOLDENS=1` regen in `tests/run-task-prompts.test.ts`, and the `prepareShipFixture`, `simulateMergeOnOrigin` and `runCanon` helpers (`tests/run-task-ship.test.ts`)
  - `warn` (`src/orchestrator/cli.ts`, which has no orchestrator imports, so adding it to `metrics.ts` creates no cycle)
- **Real path:**
  - Every agent invocation runs through `recordMetric` in the `finally` blocks of `src/orchestrator/agents/claude.ts` and `src/orchestrator/agents/codex.ts`, plus the early-return and invalid-effort branches in codex.ts.
  - Every phase builds `metricsContext` with `taskId: taskIds.join('+')` and `activeCwd` (in `phases/spec.ts`, `spec-review.ts`, `plan.ts`, `implement.ts`, `code-review.ts` and `qa.ts`). That makes `recordMetric` the only choke point.
  - The quality row is written only at `src/task/index.ts:465`, as `writeQualityLogForTask(id, taskCwd, path.join(taskDirForCwd(taskCwd, id), 'done.md'), status)`. The `done.md` path there already resolves the task directory: the override root, or the worktree through `resolveTaskCwd`.
  - On `--ship`, the merge (`mergeOpenPRsAndPull`) brings the branch's `tasks/<id>/` into the main checkout before the proof gate. Fragments are therefore present at `taskDirForRepoRoot(id)` when the fold runs.
- **Callers:**
  - `getMetricsFile` is called only inside `metrics.ts`; no test imports it. The signature change is local.
  - `writeQualityLogForTask` has one caller, `src/task/index.ts`, which is **not** in Affected Files. The plan therefore keeps its signature: `activeCwd` is renamed `_activeCwd`, and the fragment path comes from `path.dirname(donePath)`.
  - `upsertQualityLogRow`'s contract is unchanged; it is only refactored internally.
  - `getQualityLogFile` is unchanged and still read by `canon doctor`.
  - `commitHumanReviewFiles` gains a warning call only; its error contract is unchanged.
- **Tests that can fail:** each new test, and what makes it fail on today's code:
  - AC-1 and AC-8 call `recordMetric` with a temp `activeCwd` and no overrides. Today that appends to `<activeCwd>/docs/pipeline-invocations.md`.
  - AC-2 drives qa → done with no `CANON_QUALITY_LOG_FILE_OVERRIDE`. Today that writes `<cwd>/docs/task-quality-log.md`.
  - AC-3 asserts the substituted fragment paths, which today's template does not render.
  - AC-4, AC-5 and AC-7 ship a fixture whose merge brings in fragments. Today those are archived verbatim and the shared docs are untouched.
  - AC-6 asserts an empty `git diff` for the three docs after real writer calls. That fails today because the writers target `docs/`.
  - AC-9 commits an edit to `docs/lessons-learned.md` on the branch. Today `--pr` prints nothing.
- **Predicates:**
  - **Bundle label split.** Task ids match `^[a-z0-9][a-z0-9._-]*$` (`validateTaskId`), so `'+'` never appears inside an id and `label.split('+')[0]` is safe. An empty first id (an empty label) warns and returns.
  - **Metrics fragment rows** are lines starting with `|`, excluding the `Timestamp` header and separator rows. A fragment with zero data rows is a no-op that still deletes the fragment.
  - **Lessons fragment.** An empty or whitespace-only fragment is a no-op and is still deleted.
  - **Quality fragment** has three cases: no well-formed `## Log` table throws (aborts the ship); a table with no row for the task is a no-op and is deleted; one or more rows are folded.
  - **Shared doc missing** (ENOENT): use the skeleton, but only if there is something to fold. Any other read error throws.
  - **Shared quality doc** without a well-formed table throws.
  - **Shared metrics doc** without a `| Timestamp |` header line throws.
  - **Override env vars**, set or unset, are covered in Step 1 and Step 2.
- **Scope:** every file below is in the spec's Affected Files. Not touched: `src/task/index.ts` (signature kept), `docs/patterns.md` (QA checks, per the spec's Docs Impact), and skills. Other `docs/*.md` lines inside the files AC-10 names are in scope because they are the same files.
- **Async/stateful:**
  - The fold is synchronous and single-process, inside `--ship`.
  - Ownership: only `--ship` deletes fragments, and only after the shared docs are written.
  - Re-entry: a re-run after a fold failure finds the fragments intact and the docs unchanged. A re-run after a later failure (archive, commit or push) finds no fragments, so the fold is a no-op.
  - The accepted kill-window double fold is the spec's Known Risk.
  - Worktree teardown happens after the fold. The fold reads only the main checkout, which holds the merged content, never the worktree.

### Judgment calls (recorded in `notes.md`)

1. **The fold ignores `CANON_METRICS_FILE_OVERRIDE` and `CANON_QUALITY_LOG_FILE_OVERRIDE` and always targets `REPO_ROOT/docs/…`.**
   - The overrides redirect run-time writers, which the spec describes as "the run-time writer".
   - The archive commit stages `REPO_ROOT/docs/…`.
   - `runCanon` in the ship tests always sets `CANON_METRICS_FILE_OVERRIDE`. If the fold honored it, the folded rows would never reach `docs/pipeline-invocations.md` (AC-4(a), (e)).
2. **A malformed fragment, or a shared doc the fold cannot parse, aborts `--ship`** with the recovery message. It is never skipped. The spec says compute failures abort, and skipping would silently drop telemetry or archive the fragment.
3. **AC-2's "Spec verdict is the first run's value" depends on the existing upsert semantics.** In those semantics a QA-supplied non-empty judgment cell wins, including `Spec verdict`, and earliest-wins applies only when QA omits the cell, which the QA prompt instructs on a re-run. The plan keeps that writer unchanged, and the AC-2 test's second pass omits `Spec verdict`.
   - The fold, by contrast, reconciles shared rows plus fragment rows with `reconcileHistory`, so the earliest `Spec verdict` across both wins, as AC-4(b) requires.
4. **The `--pr` drift warning fires only when `--pr` is passed** (`createPR`), not on `--push`, matching the spec.
5. **Lessons skeleton is a minimal constant in code** (title plus intro blockquote). The init scaffold under the canon-ai repo's `templates/` is not a runtime path an adopter has.

## Steps

### Step 1: Metrics writer → task fragment

Files: `src/orchestrator/metrics.ts`

- Extract today's header array into an exported constant `METRICS_SKELETON`, a string identical to what `recordMetric` writes now, ending with `'\n'`.
- Replace `getMetricsFile(activeCwd?)` with `getMetricsFile(taskLabel: string, activeCwd?: string)`:
  ```ts
  export function getMetricsFile(taskLabel: string, activeCwd?: string): string {
      if (process.env.CANON_METRICS_FILE_OVERRIDE) return path.resolve(process.env.CANON_METRICS_FILE_OVERRIDE);
      const taskId = taskLabel.split('+')[0] ?? '';
      const tasksRoot = process.env.CANON_TASKS_DIR_OVERRIDE ?? path.join(activeCwd ?? REPO_ROOT, 'tasks');
      return path.join(tasksRoot, taskId, 'metrics.md');
  }
  ```
  Keep the name `getMetricsFile`, because `docs/patterns.md` cites it as the override pattern's canonical example.
- Add `export function getSharedMetricsFile(repoRoot: string): string`, returning `path.join(repoRoot, 'docs/pipeline-invocations.md')` with no override. The fold uses it.
- `recordMetric`: wrap the whole body in `try/catch`, and on error call `warn(\`metrics: could not record ${entry.phase} row for '${entry.taskId}': ${message}\`)` and return.
  - Before the write, if the override is unset and `entry.taskId.split('+')[0]` is empty, warn and return.
  - When the override is **unset**, call `fs.mkdirSync(path.dirname(file), { recursive: true })`. Do **not** create the override's parent: today's override semantics do not create it, and existing override tests don't depend on that.
  - Then keep the existing exists → skeleton → `appendFileSync` logic. The row format is byte-identical, and the Task cell is still `entry.taskId` (the joined `a+b` label).
- Import `warn` from `./cli.js` (`quality-log.ts` does the same).

### Step 2: Quality writer → task fragment; add the quality fold

Files: `src/orchestrator/quality-log.ts`

1. **Factor out row placement.** Pull the body of `upsertQualityLogRow` from `taskRows` onward into a private helper:
   ```ts
   // Replaces every row for taskId (Log table + stray rows under Periodic Reviews)
   // with one rendered row at the end of the Log table. Shared by the qa → done
   // upsert and the --ship fold so both place and dedupe rows identically.
   function replaceTaskRow(
       lines: readonly string[],
       located: LocatedLogTable,
       taskId: string,
       buildRow: (taskRows: readonly TableRow[]) => Record<string, string>,
   ): string[]
   ```
   - The helper covers parsing log and stray rows, filtering by `Task === taskId`, calling `buildRow`, rendering with `renderRowLine`, and the `removeIndexes` / insert-at-`dataEnd` loop, including the `dataEnd >= lines.length` tail case.
   - `upsertQualityLogRow` then calls it with `taskRows => buildFinalRow(headerCells, derived, reconcileHistory(taskRows, headerCells), qaSupplied)`.
   - Behavior is unchanged, and the existing `tests/run-task-quality-log.test.ts` cases must pass untouched.
2. **Add `getQualityLogFragmentFile`:**
   ```ts
   export function getQualityLogFragmentFile(taskDir: string): string {
       return process.env.CANON_QUALITY_LOG_FILE_OVERRIDE
           ? path.resolve(process.env.CANON_QUALITY_LOG_FILE_OVERRIDE)
           : path.join(taskDir, 'quality-log.md');
   }
   ```
3. **`writeQualityLogForTask(taskId, _activeCwd, donePath, status)`.**
   - Keep the signature: the caller is `src/task/index.ts`, which is outside Affected Files. The `_` prefix satisfies the lint `argsIgnorePattern`.
   - Add a comment: the task dir comes from `donePath`, which the caller already resolved worktree- and override-aware.
   - Target `getQualityLogFragmentFile(path.dirname(donePath))`.
   - When the override is unset, `mkdirSync(path.dirname(target), { recursive: true })` inside the existing try. Do not create the override's parent: the existing "unwritable-log-task" case in `tests/task-cli.test.ts` relies on a missing override parent producing the `unexpected error writing row` warning.
   - `getQualityLogFile` stays as is, for doctor.
4. **Add the fold export:**
   ```ts
   /**
    * --ship fold: returns the shared quality log with the fragment's row for
    * taskId reconciled in, or null when the fragment holds no row for it.
    * Throws when either table is unparseable — the caller aborts the ship.
    */
   export function foldQualityLogFragment(
       sharedContent: string | null,
       fragmentContent: string,
       taskId: string,
   ): string | null
   ```
   - Parse the fragment with `locateLogTable` and `parseLogRows`, keeping rows whose `Task` cell is `taskId`. A null table throws `quality-log fragment for '<id>' has no well-formed '## Log' table`. Zero rows returns `null`.
   - Set `base = sharedContent ?? STANDARD_QUALITY_LOG_SKELETON` and locate its table. Null throws `docs/task-quality-log.md has no well-formed '## Log' table with all required columns`.
   - Call `replaceTaskRow(lines, located, taskId, taskRows => …)`, where the builder:
     - builds `history = [...taskRows sorted by lineIndex, ...fragmentRows.map((r, i) => ({ lineIndex: lines.length + i, cells: r.cells }))]`
     - computes `reconciled = reconcileHistory(history, located.headerCells)`. `Spec verdict` takes the earliest non-empty value; other non-derived columns, adopter columns included, take the latest non-empty. Fragment cells are keyed by the fragment's own header names, so a shared-only column reads `''` from the fragment and keeps the shared value.
     - for each shared header sets: `Task` → `taskId`; any other `DERIVED_HEADERS` member → the last fragment row's cell (`?? ''`); everything else → `reconciled[header] ?? ''`.
   - Return `updated.join('\n')`.
   - This is "today's upsert with the fragment row as the newest history entry": same placement, same stray-row removal, same earliest-wins. The difference is that the fragment's verdict does not override an earlier shared one (AC-4(b)).

### Step 3: New fold module

Files: `src/orchestrator/telemetry-fold.ts` (new)

Imports: `fs`, `path`, `METRICS_SKELETON` and `getSharedMetricsFile` from `./metrics.js`, `foldQualityLogFragment` from `./quality-log.js`, and `PIPELINE_TELEMETRY_FILES` from `./worktree.js`. It must not import `main.ts`.

1. **Constants.**
   - `const FRAGMENTS = { metrics: 'metrics.md', quality: 'quality-log.md', lessons: 'lessons.md' } as const;`
   - `LESSONS_SKELETON = '# Lessons Learned\n\n> Distilled cross-task insights. Entries arrive from each task\'s lessons fragment when `canon run --ship` folds it.\n'`.
2. **Pure folds (exported for tests).**
   - `foldMetricsFragment(shared: string | null, fragment: string): string | null`
     - Rows are fragment lines where `trimStart().startsWith('|')`, excluding `/^\|\s*Timestamp\s*\|/` and separator lines `/^\|(\s*:?-+:?\s*\|)+\s*$/`. No rows → `null`.
     - Set `base = shared ?? METRICS_SKELETON` and find the header index with the same `Timestamp` regex. Missing → throw `docs/pipeline-invocations.md has no '| Timestamp |' table header`.
     - Scan forward over contiguous `|` lines to `end`, splice the rows in at `end`, and ensure a trailing `\n`.
     - Copy rows verbatim: no title, blockquote, header or separator lines, no re-sort.
   - `foldLessonsFragment(shared: string | null, fragment: string): string | null`
     - Set `body = fragment.trim()`; if empty, return `null`.
     - Set `base = (shared ?? LESSONS_SKELETON).trimEnd()`.
     - Prefix the body with `\n\n---\n\n` unless `base` ends with `---` or `body` starts with `---`, in which case use `\n\n`.
     - Return `${base}${sep}${body}\n`.
   - `sharedTelemetryDocsTouched(paths: readonly string[]): string[]` returns the `PIPELINE_TELEMETRY_FILES` entries present in `paths`, in registry order.
3. **Plan (reads and computes; throws on any compute or read failure other than ENOENT).**
   ```ts
   export type TelemetryFoldPlan = {
       writes: Array<{ target: string; before: string | null; after: string }>;
       fragments: Array<{ path: string; content: string }>;
   };
   export function planTelemetryFold(
       repoRoot: string,
       taskIds: readonly string[],
       taskDirFor: (taskId: string) => string,
   ): TelemetryFoldPlan
   ```
   - Read the shared docs once into a `Map<target, string | null>`:
     - `getSharedMetricsFile(repoRoot)`
     - `path.join(repoRoot, 'docs/task-quality-log.md')`
     - `path.join(repoRoot, 'docs/lessons-learned.md')`
   - For each `taskId` in argument order, and for each fragment kind, read `path.join(taskDirFor(taskId), name)`. ENOENT means skip.
     - Push every existing fragment into `fragments`, including no-op ones, so they are deleted and stay out of `_archive` (AC-4(d)).
     - Apply its fold to the current in-memory content. On a non-null result, update the map.
     - A thrown fold error is re-thrown with the fragment path prefixed.
   - `writes` holds only the targets whose final content differs from `before`.
4. **Apply (transactional apart from a process kill).**
   ```ts
   export function applyTelemetryFold(plan: TelemetryFoldPlan): void
   ```
   1. For each write, `mkdirSync(dirname, { recursive: true })` and write `${target}.canon-fold.tmp`. On failure, remove every temp created so far and rethrow. No shared doc has changed at this point.
   2. `renameSync` each temp over its target, recording what was committed. On failure, restore each committed target: write `before`, or `rmSync(target, { force: true })` when `before === null`. Remove the remaining temps and rethrow.
   3. `rmSync` each fragment, recording what was deleted. On failure, restore every write as in (2), rewrite the deleted fragments from `content`, and rethrow.
   - Rollback steps are best-effort: wrap each in its own try. A `docs/` directory created in (1) is left behind (harmless).
5. **Entry point.**
   ```ts
   export function foldTelemetryFragments(repoRoot: string, taskIds: readonly string[], taskDirFor: (taskId: string) => string): string[]
   ```
   It runs plan, then apply, and returns `path.relative(repoRoot, target)` for each write so the caller can log it.

### Step 4: Wire the fold and drift warning into `main.ts`

Files: `src/orchestrator/main.ts`

1. Add `import { foldTelemetryFragments, sharedTelemetryDocsTouched } from './telemetry-fold.js';`.
2. **`shipTasks`.** Insert the fold immediately after the `proofFailures` `die` block and **before** `const archiveDir = …`:
   ```ts
   // Fold per-task telemetry fragments into the shared logs before any
   // archive-state change: a failure here leaves docs, fragments, and
   // human_review untouched, so --ship can simply be re-run.
   try {
       for (const relPath of foldTelemetryFragments(REPO_ROOT, taskIds, taskDirForRepoRoot)) {
           info(`Folded task telemetry into ${relPath}.`);
       }
   } catch (error) {
       const message = error instanceof Error ? error.message : String(error);
       splitCli.die(
           `--ship aborted: could not fold task telemetry fragments into the shared logs: ${message}\n` +
           `The shared logs and each task's fragment files are unchanged and no task was archived. ` +
           `Fix the cause and re-run --ship.`,
       );
   }
   ```
   - `taskDirForRepoRoot` is the main-checkout resolver (it honors `CANON_TASKS_DIR_OVERRIDE`) and is the same `src` the archive loop renames.
3. **`stagedPaths`.** Add `path.join(REPO_ROOT, 'docs', 'pipeline-invocations.md')` beside the lessons and quality entries.
   - Leave `rewriteArchivedTaskRefs` unchanged. It still runs after the archive loop, on the folded content.
   - The preserved-dirt re-append still runs after staging, so sibling suffixes stay unstaged. The existing test `--ship preserves appended pipeline invocation dirt…` still expects ` M` because no fragment exists there.
4. **`--pr` drift warning.** Add a helper beside `commitHumanReviewFiles`:
   ```ts
   function warnSharedTelemetryDocDrift(baseBranch: string, cwd: string): void {
       const changed = splitGit.getAffectedFiles(`origin/${baseBranch}`, cwd);
       if (!changed.ok) {
           warn(`Could not check this branch for shared telemetry log edits: ${changed.stderr || 'unknown error'}`);
           return;
       }
       const touched = sharedTelemetryDocsTouched(changed.files);
       if (touched.length === 0) return;
       warn(
           `This branch edits shared telemetry logs that parallel tasks also change, so their PRs will conflict here:\n` +
           touched.map(p => `  ${p}`).join('\n') + '\n' +
           `Current canon writes task telemetry to files in tasks/<id>/ and folds them in at --ship; ` +
           `these edits come from an older canon engine or a manual change.`,
       );
   }
   ```
   - Call it at both `reportOrCreatePR` sites in `commitHumanReviewFiles`: the clean-tree retry branch and the final dirty-path call. Change each to `if (createPR) { warnSharedTelemetryDocDrift(baseBranch, cwd); reportOrCreatePR(taskIds, branchName); }`.
   - Running it after the commit and push means the diff includes anything this `--pr` just committed.
   - It is a warning only, and it never changes the exit code.

### Step 5: QA prompt → per-task lessons fragments

Files: `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/qa.md`

1. In `promptQa`, add a view field built like `taskLines`:
   ```ts
   const lessonsFragments = tasks.map(t =>
       `  - \`${t.taskId}\` → \`tasks/${t.taskId}/lessons.md\``
   ).join('\n');
   ```
   Pass it as `lessonsFragments` to `render('qa.md', …)`.
2. In `qa.md`, replace the line-46 bullet:
   ```markdown
   - Read tasks/<id>/notes.md for each task. For each insight, ask: "would this have changed how a *different* task was approached?" If yes, **append** one new entry for that task to that task's own lessons fragment, creating it if needed, in the entry format described in docs/lessons-learned.md:
   {{{lessonsFragments}}}
     A task's lesson goes only in its own fragment. Do **not** edit docs/lessons-learned.md — `canon run --ship` appends each fragment to it when the task ships. If no, the detail stays in notes.md only. Append-only: never edit, prune, promote, reorganize, or delete existing entries — in a fragment or in docs/lessons-learned.md. Promoting entries into permanent docs (patterns.md / decisions.md) and pruning the buffer is a **human-initiated, human-approved** action — never perform it during QA, and no entry count ever triggers it. (See docs/lessons-learned.md → "How to use this doc".)
   ```
3. Replace the quality-log sentence on line 47 with: `Do **not** edit docs/task-quality-log.md directly — the qa → done transition upserts this task's row into the quality-log fragment in its task folder from status.json plus this section, and \`canon run --ship\` folds that row into docs/task-quality-log.md.`
4. Replace the buffer-signal bullet on line 86: `after appending, if docs/lessons-learned.md plus this task's lessons fragment now hold more than ~15 entries in total, add one line to this task's done.md — \`Maintenance: lessons-learned.md has N entries (including this task's unshipped fragment); a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").\` Do not perform the sweep yourself.`
5. Check the result:
   - The rendered prompt contains no literal `tasks/<id>/lessons.md` and no `tasks//lessons.md`.
   - Other `tasks/<id>/…` literals (`done.md`, `notes.md`, `handoff.md`, `pr-body.md`) are out of AC-3's scope and stay.

### Step 6: Tests

Files: `tests/metrics.test.ts` (new), `tests/run-task-quality-log.test.ts`, `tests/task-cli.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`, `tests/run-task-ship.test.ts`

Use a local `withEnv` helper that sets or deletes env vars **after** import and restores them afterwards (the env-override pitfall in `docs/patterns.md`). Always `delete` `CANON_METRICS_FILE_OVERRIDE`, `CANON_QUALITY_LOG_FILE_OVERRIDE` and `CANON_TASKS_DIR_OVERRIDE` unless the test sets them. Always pass a temp `activeCwd`; a missing one falls back to the canon-ai checkout.

**`tests/metrics.test.ts` (new): AC-1 and AC-8**

- Single task: commit `docs/pipeline-invocations.md` in the temp dir and snapshot its bytes. Then `recordMetric({ taskId: 'metrics-single', activeCwd: tmp, … })`:
  - `tasks/metrics-single/metrics.md` exists and starts with `METRICS_SKELETON`
  - it has exactly one data row with Task `metrics-single`
  - the shared doc is byte-identical
  - Repeat with no shared doc and assert that it stays absent.
- Bundle: `taskId: 'metrics-a+metrics-b'` produces a row in `tasks/metrics-a/metrics.md` with Task cell `metrics-a+metrics-b`, and `tasks/metrics-b` does not exist.
- `CANON_TASKS_DIR_OVERRIDE=<tmp>/override-tasks` writes the fragment under the override, and `<activeCwd>/tasks` is untouched.
- `CANON_METRICS_FILE_OVERRIDE=<tmp>/override.md` puts the row in the override, with no fragment.
- Unwritable target:
  - Create a **regular file** at `<tmp>/tasks/metrics-blocked`. This makes `mkdirSync` fail with EEXIST/ENOTDIR, and it is root-safe, unlike chmod.
  - Capture `console.error` and assert that `recordMetric` does not throw and a `metrics: could not record` warning was emitted.
- AC-8, in a real temp git repo:
  - Commit all three `PIPELINE_TELEMETRY_FILES` plus `tasks/metrics-early/status.json`.
  - For phases `spec`, `spec_review` and `plan`, call `recordMetric({ phase, activeCwd: repo, taskId: 'metrics-early', … })`.
  - `git status --porcelain=v1 -uall -- docs/pipeline-invocations.md docs/task-quality-log.md docs/lessons-learned.md` is empty.
  - `tasks/metrics-early/metrics.md` has three rows.

**`tests/run-task-quality-log.test.ts`: AC-2 unit and the fold export**

- `writeQualityLogForTask(id, '/unused', path.join(taskDir, 'done.md'), status)` with no override writes `taskDir/quality-log.md`, and a sibling `docs/task-quality-log.md` written by the test is unchanged.
- `foldQualityLogFragment` cases:
  1. **No shared row.** Shared is `tableDocument([sibling])`; the fragment has one row. The result has the sibling plus one task row, placed at Log end and not under Periodic Reviews.
  2. **Reconcile, verifying AC-4(b) at unit level.** Shared headers are `[...HEADERS, 'Owner']`, with a task row carrying `Spec verdict` = `changes_requested`, `Owner` = `alice` and `Notes` = `legacy`, plus a stray task row under Periodic Reviews. The fragment row has `Spec verdict` = `approved`, `Notes` = `fragment`, `Spec iter` = `4`. The result has exactly one task row: `Spec verdict` = `changes_requested`, `Notes` = `fragment`, `Spec iter` = `4`, `Owner` = `alice`, and no stray copy.
  3. **Null shared** creates from the standard skeleton, and `locateLogTable` succeeds on the result.
  4. **A fragment with a table but no task row** returns `null`.
  5. **A malformed fragment throws, and so does a malformed shared doc.**
- All existing upsert tests stay green. They pin the `replaceTaskRow` refactor.

**`tests/task-cli.test.ts`: AC-2 integration**

- Add a test with `CANON_TASKS_DIR_OVERRIDE=<tmp>/tasks` and `CANON_SKIP_PHASE_GATE=1`, and **no** quality override:
  1. `done.md` has a `## Quality Log` block with `Spec verdict: approved_with_nits`. Run `taskCmd(['phase', id, 'qa', 'done'])`.
  2. Reopen with `taskCmd(['phase', id, 'qa', 'in_progress'])`, rewrite `done.md` with a Quality Log block that **omits** `Spec verdict` and sets `Notes: second pass`, and mark qa done again.
  3. `parseTable(<tmp>/tasks/<id>/quality-log.md, 'Log')` has exactly one row for the id, with `Spec verdict` = `approved_with_nits` and `Notes` = `second pass`.
  4. `WORKSPACE_ROOT/docs/task-quality-log.md` bytes and mtime are unchanged (copy the existing isolation test's assertions).
- Existing tests use `CANON_QUALITY_LOG_FILE_OVERRIDE` and stay unchanged. If any test outside those breaks because it expected the shared doc to change, update it to read the fragment, and list that in the handoff.

**`tests/run-task-prompts.test.ts` and the golden: AC-3**

- Regenerate with `UPDATE_GOLDENS=1 npm test`.
- Confirm that the `git diff tests/run-task-prompts.golden.json` touches only the `promptQa*` keys.
- Add assertions:
  - Single task: `promptQa(baseState)` includes `` `tasks/${TASK_ID}/lessons.md` ``.
  - Bundle (`bundle-qa-a` and `bundle-qa-b`): the prompt includes ``- `bundle-qa-a` → `tasks/bundle-qa-a/lessons.md` `` and ``- `bundle-qa-b` → `tasks/bundle-qa-b/lessons.md` ``.
  - Both cases `doesNotMatch` `/tasks\/<id>\/lessons\.md/` and `/tasks\/\/lessons\.md/`.
  - Both cases match the buffer-signal text `docs/lessons-learned.md plus this task's lessons fragment`.

**`tests/run-task-ship.test.ts`: AC-4, AC-5, AC-6, AC-7, AC-9**

- **Fixture extension.** Add `branchFiles?: Record<string, string>` (repo-relative path → content) to `prepareShipFixture`.
  - Write the files on the task branch before the `add tasks` commit (stage with `git add -A`, not only `tasks`).
  - Pass them to `simulateMergeOnOrigin`, which gets an optional fourth parameter, so the simulated squash-merge carries them too.
  - Fragments are expressed as `branchFiles['tasks/<id>/metrics.md']`, and so on.
- **AC-4, happy fold** (`ship-fold`, PR 401).
  - `initialFiles`:
    - a shared metrics doc (`METRICS_SKELETON` plus one row)
    - a shared quality doc with an extra `Owner` column, a pre-existing `ship-fold` row (`changes_requested`, Owner `alice`), a sibling row, and a stray `ship-fold` row under `## Periodic Reviews`
    - `docs/lessons-learned.md` with one entry
  - `branchFiles`: three fragments.
    - metrics: skeleton plus two rows
    - quality: a skeleton row with `Spec verdict` `approved` and Notes `see tasks/ship-fold/review.md`
    - lessons: one entry mentioning `tasks/ship-fold/notes.md`
  - Assert (a) through (e) per the spec:
    - (a) the metrics doc ends with the two rows in order, and `| Timestamp |` appears once
    - (b) via `parseTable`: one `ship-fold` row; `Spec verdict` = `changes_requested`; `Owner` = `alice`; Notes contains `tasks/_archive/ship-fold/review.md`; the sibling row is intact; no stray row
    - (c) lessons ends with the entry, with `tasks/_archive/ship-fold/notes.md`
    - (d) no fragment files under `tasks/_archive/ship-fold/`
    - (e) `git show --name-only --format= HEAD` (subject `chore: archive ship-fold`): its `docs/` paths are exactly the three shared docs
- **AC-5, failed fold.** Mark it `{ skip: process.platform === 'win32' || process.getuid?.() === 0 }`.
  - Use a fixture like AC-4 and snapshot the three docs, plus the bytes of `tasks/<id>/status.json`.
  - `fs.chmodSync(path.join(localDir, 'docs'), 0o555)`, run `--ship`, then restore `0o755` in a `finally`.
  - Assert:
    - non-zero status
    - stderr matches `/could not fold task telemetry/`
    - the docs are byte-identical
    - the three fragments exist in `tasks/<id>/`
    - `tasks/_archive/<id>` is absent
    - `status.json` is byte-identical
  - Re-run `--ship` with the same env and assert exit 0, an archive, and folded docs.
  - Nothing in `--ship` writes to `docs/` before the fold on a non-worktree fixture: the merge adds only `tasks/`, and there is no post-merge hook.
- **AC-5 rollback (unit, no git).**
  - Import `foldTelemetryFragments` directly. Build a temp root with shared docs and the fragments.
  - Make **only the task directory** read-only (`chmod 0o555`, same skip guard), so the renames succeed and the fragment delete fails.
  - Assert that it throws, the shared docs are byte-identical to before, and the fragments are still present.
  - This covers the step-3 rollback in `applyTelemetryFold`.
- **AC-6, parallel tasks.**
  - From `main`, create `task/par-a` and `task/par-b`. In each checkout of its branch, with overrides deleted:
    - call `recordMetric({ taskId, activeCwd: localDir, phase: 'implement', … })`
    - call `upsertQualityLogRow(path.join(localDir, 'tasks', id, 'quality-log.md'), { taskId: id }, { Notes: id })`, or `writeQualityLogForTask`
    - write `tasks/<id>/lessons.md` by hand
    - write `writeTaskFiles` with `makeStatus` and a `.pr-number` sidecar
    - commit and push
  - Shared docs exist on `main` from `initialFiles`.
  - Assert that `git diff main...task/par-X -- docs/pipeline-invocations.md docs/task-quality-log.md docs/lessons-learned.md` is empty for both.
  - Merge A on origin with a real squash: clone origin, `git merge --squash origin/task/par-a`, commit, push. Delete the remote branch. Ship A with `FAKE_GH_HEAD_REF_OID` = A's tip.
  - Then, in `localDir` on `main`, run `git merge --squash task/par-b`. It must exit 0, and `git diff --name-only --diff-filter=U` must be empty. Commit, push to origin, and delete `origin/task/par-b`. Ship B.
  - Final `main` has:
    - both metrics rows (Task cells `par-a` and `par-b`)
    - one quality row each
    - both lessons entries
- **AC-7, missing fragments.**
  - (i) The branch carries legacy rows directly in the three docs (through `branchFiles` on `docs/…`, with `tasks/<id>/…` refs). No fragments. After ship, each doc equals the merged content with `tasks/<id>/` replaced by `tasks/_archive/<id>/` in lessons and quality only.
  - (ii) No shared docs in `initialFiles`, while `branchFiles` has all three fragments. After ship, each doc exists:
    - metrics starts with `# Workflow Metrics` and holds the fragment rows
    - quality has a parseable `Log` with the row
    - lessons starts with `# Lessons Learned` and ends with the entry
- **AC-9, `--pr` drift.**
  - On a branch whose commit edits `docs/lessons-learned.md` (seeded on `main` through `initialFiles`), run `--pr` and expect exit 0.
  - stderr matches `/shared telemetry logs/` and `/docs\/lessons-learned\.md/`, and does not mention the other two docs.
  - Add `assert.doesNotMatch(result.stderr, /shared telemetry logs/)` to the existing `--pr writes the sidecar on create path…` test as the negative case.

### Step 7: Docs and templates (AC-10)

Files:
- `docs/architecture.md`
- `docs/pipeline-orchestrator.md`, then `npm run sync-templates` (its mirror `templates/docs/pipeline-orchestrator.md`)
- `docs/lessons-learned.md`, `templates/docs/lessons-learned.md`
- `docs/task-quality-log.md`, `templates/docs/task-quality-log.md`
- `.canon/templates/notes.md`, then sync (its mirror `templates/.canon/templates/notes.md`)
- `docs/codebase-map.md`
- `docs/decisions.md`

Only `docs/pipeline-orchestrator.md` and `.canon/templates/notes.md` are in `CANON_OWNED`. The two hand-edited `templates/docs/*` files are init scaffolds, not mirrors, so edit them by hand with the same wording.

- **`docs/architecture.md`**
  - **Step 10:** `Claude writes done.md (including judgment cells for the task-quality-log row) and distills notes.md into entries in the task's own tasks/<id>/lessons.md. The qa → done transition upserts the task's row into tasks/<id>/quality-log.md from status.json plus those judgment cells.`
  - **§Telemetry:** state that task runs never write the shared logs.
    - Each agent invocation appends a row to `tasks/<id>/metrics.md`; a bundle's rows go to its first member.
    - qa → done upserts `tasks/<id>/quality-log.md`.
    - QA appends lessons to `tasks/<id>/lessons.md`.
    - `canon run --ship` folds all three into `docs/pipeline-invocations.md`, `docs/task-quality-log.md` and `docs/lessons-learned.md` in its archive commit, then deletes them, so parallel branches never touch the same shared file.
    - `docs/pipeline-invocations.md` stays append-only.
- **`docs/pipeline-orchestrator.md`**
  - **§Auto-Branch + Auto-Commit, the `PIPELINE_TELEMETRY_FILES` bullet:** append "Current runs no longer write these during a task — each task writes `metrics.md`, `quality-log.md` and `lessons.md` in `tasks/<id>/`, and `--ship` folds them in; the exemption remains for branches started on an older engine."
  - **§Worktree Isolation, the scaffold paragraph:** in the absorb-telemetry sentence, add "(left by an older engine; current runs put pre-implement metrics rows in `tasks/<id>/metrics.md`, which rides the scaffold commit)".
  - **The shared-doc-dirt paragraph:** change "most commonly a sibling task's pre-implement telemetry rows" to "most commonly telemetry rows an older engine appended".
  - **The ordered `--ship` list:** insert a new step (7), after "(6) prove the task's merge…": "fold each task's telemetry fragments (`metrics.md`, `quality-log.md`, `lessons.md` in its task folder) into the three shared logs, then delete the fragments — if computing or writing fails, `--ship` aborts with the shared logs and fragments unchanged and nothing archived, so it can be re-run".
    - Renumber the later steps (worktree remove becomes 8, archive 9, stage/commit/push 10).
    - The stage step names the three shared logs.
  - **Shipping section:** add one sentence: "`--pr` warns, without blocking, when the branch's diff against `origin/<base>` touches any of the three shared logs, because parallel tasks will conflict there."
- **`docs/lessons-learned.md` and its template**
  - Intro blockquote: "The QA phase appends entries to its task's `tasks/<id>/lessons.md` when a task surfaces a reusable insight that would have changed how a *different* task was approached; `canon run --ship` appends that fragment here."
  - "How to use this doc" point 1: QA **appends** one entry to the task's own `tasks/<id>/lessons.md`, and `canon run --ship` appends the fragment's entries to the end of this file when the task ships. QA never edits this file directly, and never edits, prunes, promotes or reorganizes existing entries.
- **`docs/task-quality-log.md` and its template**
  - Header blockquote: "One row per task, keyed by Task id. The qa → done phase transition upserts the row into the task's own `tasks/<id>/quality-log.md`; `canon run --ship` folds it into this table, reconciling with any existing row for the task. QA supplies five judgment cells via done.md; the remaining cells are derived from status.json."
  - "How to use" line "The qa → done transition writes or updates this task's row in place." becomes "The qa → done transition writes this task's row to its fragment; `--ship` folds it in here, replacing any earlier row for the task." The AC-10 grep would otherwise still find a direct-upsert claim.
- **`.canon/templates/notes.md` line 3:** "Raw observations from any phase. Prefix with phase name. QA distills reusable ones into this task's `lessons.md`, which reaches `docs/lessons-learned.md` when the task ships."
- **`docs/codebase-map.md`**
  - Lessons row: "QA appends to `tasks/<id>/lessons.md`; folded here by `--ship`".
  - Quality row: append "; qa → done upserts `tasks/<id>/quality-log.md`, folded here by `--ship`".
  - Invocations row: "`src/orchestrator/metrics.ts` appends to `tasks/<id>/metrics.md` (duration + tokens); folded here by `--ship`".
  - The `quality-log.ts` row gains "fragment writer and `foldQualityLogFragment`".
  - Add a new row: `| Telemetry fold | \`src/orchestrator/telemetry-fold.ts\` | \`--ship\` fold of per-task metrics/quality/lessons fragments into the shared logs (plan → write → delete, rollback on failure) and the \`--pr\` shared-log drift filter |`.
  - Knowledge-flow note: `tasks/<id>/notes.md` (raw) → `tasks/<id>/lessons.md` (distilled & appended during QA) → `docs/lessons-learned.md` (folded in by `--ship`) → eventually …
- **`docs/decisions.md`**, entry "Task quality-log row upserted at the qa → done transition"
  - Keep the heading, so anchors stay stable.
  - In **Decision**, say the upsert targets the task's `tasks/<id>/quality-log.md` and `--ship` folds it into the shared log with the same reconcile rules.
  - Append:
    > **Amendment (2026-10, per-task telemetry fragments)**: Task runs never write the shared logs (`docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md`). Metrics rows, the quality row and QA lessons go to `metrics.md`, `quality-log.md` and `lessons.md` in the task folder (a bundle's metrics go to its first member). `canon run --ship` folds them in inside the archive commit, before any archive-state change, and deletes them. **Why**: every task branch appended to the same three files, so parallel PRs conflicted there, and GitHub's merge ignores `.gitattributes` merge drivers. **Rule**: no task-phase writer targets a shared log; new per-task telemetry gets a fragment folded at ship. The fold computes everything before writing and leaves logs and fragments unchanged on failure.
- **Verify:**
  ```
  grep -nE "appends? (one )?(new )?entr(y|ies) (for this task )?(to|here)|upserts.*task-quality-log\.md row|writes or updates this task's row in place|Auto-appended by" docs/architecture.md docs/pipeline-orchestrator.md docs/lessons-learned.md templates/docs/lessons-learned.md docs/task-quality-log.md templates/docs/task-quality-log.md .canon/templates/notes.md docs/codebase-map.md docs/decisions.md
  ```
  Every hit must describe the fragment or the fold, not a direct shared-doc write.

### Step 8: Build and validate

Run `npm run build` (this rebuilds `dist/cli/index.js` and `dist/orchestrator/run-task.js`), then `npm run lint`, `npm run type-check`, `npm test`, `npm run sync-templates:check` and `npm run docs-refs-check`. The order matters in two places:
- **Goldens:** regenerate `UPDATE_GOLDENS=1 npm test` once before the final plain `npm test`.
- **Template mirrors:** run `npm run sync-templates` before the check.

## Testing Plan

- **Unit:**
  - metrics writer: AC-1, AC-8
  - quality writer and fold: AC-2, AC-4(b) logic
  - pure metrics and lessons folds, and apply rollback: AC-5
  - prompt rendering: AC-3
- **Integration (subprocess `--ship` / `--pr` with real git fixtures):** AC-4, AC-5, AC-6, AC-7 and AC-9 in `tests/run-task-ship.test.ts`.
- **E2E:** N/A (CLI; AC-6 is the headline integration).
- **Manual:** the spec's Human Test Plan (two parallel tasks, two PRs with no shared-log files, sequential ships with no conflicts).

## Rollback Plan

- Reverting restores direct shared-doc writes.
- Fragments already written in in-flight tasks would then be archived as plain files by an old-engine `--ship`. No data is lost; they just are not folded, and an operator can append them by hand.
- No status.json or shared-doc format change, so there is nothing to migrate.

## Open Questions (unattended session — interpretations chosen)

- The fold ignores the run-time file overrides (judgment call 1).
- A malformed fragment or shared log aborts `--ship` (judgment call 2).
- AC-2's earliest-wins holds under the prompt contract, and the writer is unchanged (judgment call 3).
- The warning fires only on `--pr` (judgment call 4).
- The lessons skeleton is in code (judgment call 5).

All of these are recorded in `notes.md` with a `[plan]` prefix.
