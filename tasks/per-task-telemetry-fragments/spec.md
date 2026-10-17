# Spec: per-task-telemetry-fragments — Per-task telemetry fragments, folded on ship

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon tasks that run in parallel almost always hit merge conflicts on three shared, append-only logs: `docs/pipeline-invocations.md`, `docs/task-quality-log.md` and `docs/lessons-learned.md` (the `PIPELINE_TELEMETRY_FILES` set in `src/orchestrator/worktree.ts`). Every task branch appends to the end of the same files, so when two task PRs merge one after the other, the second one conflicts in all three. In a busy adopter repo, these were three of the four most-committed files under `docs/` over 60 days (116, 77 and 75 commits).

Today's writers all write into the task's active checkout, so their edits land on the task branch:

- **Metrics.** `recordMetric` (`src/orchestrator/metrics.ts`) appends one row per agent invocation to `getMetricsFile(activeCwd)`. Every phase passes `metricsContext.taskId = taskIds.join('+')`, so a bundled run (several tasks in one run) records a joined label such as `a+b`.
  - spec, spec_review and plan run before the worktree exists, so their rows go to the main checkout. They reach base through the "absorb pre-implement telemetry" commit in `commitTaskArtifactsToBase` (`src/orchestrator/git.ts`). That dirt is also why `--ship` has `classifyAndPreserveSharedDocDirt`.
  - The write runs in the agent wrappers' `finally` blocks (`src/orchestrator/agents/claude.ts`, `codex.ts`) with no mkdir and no try/catch.
- **Quality log.** `writeQualityLogForTask` (`src/orchestrator/quality-log.ts`) upserts the task's row into `getQualityLogFile(activeCwd)` on the qa → done transition (`src/task/index.ts`). The upsert reconciles against the task's existing rows: `Spec verdict` is earliest-wins (`EARLIEST_WINS_HEADERS`), and stray rows outside the `## Log` table are removed.
- **Lessons.** The QA agent appends a lesson entry to `docs/lessons-learned.md`, as instructed by `src/orchestrator/prompts/templates/qa.md`.

A git `merge=union` attribute was considered and rejected. GitHub's merge button and `gh pr merge` ignore `.gitattributes` merge drivers, so PRs would still show as conflicting.

This is a behavior change, not a bug fix or refactor, so the mechanism and correctness-audit requirements don't apply.

## Decision

Task runs stop writing the three shared logs. Each task writes its telemetry to its own files inside its task folder. `canon run --ship` then folds those files into the shared logs on the base branch, inside the `chore: archive` commit it already makes and pushes (`commitArchiveChanges` in `src/orchestrator/main.ts`).

- **Fragment location.** Fragments live in the task's directory, resolved the same way other task artifacts are: `<activeCwd>/tasks/<id>/`, or under `CANON_TASKS_DIR_OVERRIDE` when that is set. Writers create the directory if it is missing.
  - Run-time fragment writes are **fail-soft**, like today's quality-log writer. A write error logs a warning and never replaces an agent's result or fails a phase.
- **Metrics fragment: `tasks/<id>/metrics.md`.** It uses today's table header and row format. Every agent invocation in every phase writes here, including spec, spec_review and plan in the main checkout.
  - For a bundled run, the row goes to the **first** member's fragment. The worktree is already named for that task. The row's Task cell keeps the joined label (`a+b`).
- **Quality-log fragment: `tasks/<id>/quality-log.md`.** It has the same `## Log` table shape as the shared doc, and the qa → done upsert targets it. A QA re-run after a reroute still reconciles against the task's earlier fragment row.
- **Lessons fragment: `tasks/<id>/lessons.md`.** The QA prompt tells QA to append its entry here, in today's entry format, and not to edit `docs/lessons-learned.md`. The "more than ~15 entries" buffer signal counts the shared doc's entries plus this task's fragment.
- **Fold on `--ship`.** For each shipped task, in argument order, the fold runs after the merge and the merge-proof gate, and **before** the archive loop (worktree teardown, the `human_review: done` write, the `tasks/<id>` → `tasks/_archive/<id>` rename).
  - Fragments are read from the main checkout's task directory.
  - All new shared-doc contents are computed first. Then the shared docs are written and the fragment files are deleted, in one step.
  - If computing or writing fails, `--ship` aborts with the shared docs unchanged and the fragments intact. No archive-state change has happened at that point, so `--ship` can be re-run.
  - Because the fragments are deleted before the archive loop, a later failure (archive, commit or push) cannot cause a second fold on re-run.
  - **Metrics:** the fragment's data rows are appended to the end of the shared metrics table. Its title, blockquote, header and separator lines are not copied.
  - **Quality:** the shared doc ends up exactly as today's upsert would leave it if the fragment's row were upserted into it. That means one row for the task, reconciled with any existing rows for that task in the shared doc (including legacy rows from an older engine, and stray rows), with `Spec verdict` earliest-wins. Cells are mapped by header name, so adopter-added columns survive.
  - **Lessons:** the fragment's entries are appended to the end of `docs/lessons-learned.md`. An empty or whitespace-only fragment is skipped.
  - All three shared docs are staged into the archive commit, now including `docs/pipeline-invocations.md`. Folded content then goes through the existing `tasks/<id>/` → `tasks/_archive/<id>/` rewrite.
- **Missing fragments are a no-op.** That covers legacy tasks that wrote the shared docs directly, and tasks with no lessons. If a fragment exists and its shared doc does not, the fold creates the doc with its standard skeleton.
- **Drift warning at `--pr`.** When the task branch's diff against base touches any of the three shared docs, `--pr` prints a warning naming them, saying that parallel tasks will conflict there. It is a warning, not a block, because legacy branches legitimately carry such edits.
- **Env overrides keep their meaning.** When `CANON_METRICS_FILE_OVERRIDE` or `CANON_QUALITY_LOG_FILE_OVERRIDE` is set, the run-time writer writes to the override path, not the fragment.

## Non-Goals

- No `.gitattributes` / union merge driver.
- No removal of the legacy safety nets. These stay because tasks started on an older engine can still produce shared-doc dirt; retiring them is a follow-up:
  - `classifyAndPreserveSharedDocDirt`
  - the absorb-telemetry half of `commitTaskArtifactsToBase`
  - the `PIPELINE_TELEMETRY_FILES` exemptions in validation, auto-commit and base-drift
- No migration of rows already committed on in-flight branches. They merge as they do today.
- No fold for tasks that never reach `--ship`. Their fragments stay in their task folder.
- No new stats or reporting command and no reader changes. Agents keep reading `docs/lessons-learned.md`, and `canon doctor` keeps checking the shared `docs/task-quality-log.md` through `getQualityLogFile`.
- No re-sorting of folded metrics rows by timestamp.
- No change to `canon upgrade`'s header-only sync of `docs/pipeline-invocations.md`.

## Acceptance Criteria

- [ ] **AC-1: Metrics go to the fragment.** With no overrides set, `recordMetric` for a single-task run writes the row to that task's `tasks/<id>/metrics.md` under `activeCwd`. It creates the file with the standard header if absent, and leaves `<activeCwd>/docs/pipeline-invocations.md` byte-identical (or absent).
  - A bundled run's row (`taskId: 'a+b'`) lands in `tasks/a/metrics.md` with Task cell `a+b`.
  - With `CANON_TASKS_DIR_OVERRIDE` set, the fragment lands under the override.
  - With `CANON_METRICS_FILE_OVERRIDE` set, the row goes to the override path.
  - With the task directory unwritable, `recordMetric` warns and returns without throwing.
  - Verified in the new `tests/metrics.test.ts`.
- [ ] **AC-2: The quality row goes to the fragment.** On qa → done, `writeQualityLogForTask` upserts into the task's `tasks/<id>/quality-log.md`, and `docs/task-quality-log.md` is not modified.
  - A second qa → done for the same task leaves exactly one row in the fragment, and its `Spec verdict` is the first run's value.
  - `canon doctor`'s quality-log check still reads the shared doc; its existing tests pass unchanged.
  - Verified in `tests/task-cli.test.ts` and `tests/run-task-quality-log.test.ts`.
- [ ] **AC-3: QA's prompt targets the lessons fragment.** In the rendered QA prompt, the lesson-append instruction names each task's own fragment path with the real id substituted, and the buffer-signal instruction counts the shared doc plus the fragment.
  - For a single task `example-task`, the append instruction contains `tasks/example-task/lessons.md`.
  - For a bundle, the prompt names each member's own `tasks/<member-id>/lessons.md` path, and QA is told to append a member's lesson to that member's fragment.
  - The rendered prompt contains no literal `tasks/<id>/lessons.md` and no empty-id `tasks//lessons.md`.
  - `promptQa()` supplies the per-task values the template needs; today it passes task identity only inside the formatted `taskLines` and `taskScope` strings.
  - Verified by the regenerated prompt golden file and positive assertions in `tests/run-task-prompts.test.ts` for a single task and a bundle.
- [ ] **AC-4: `--ship` folds and removes the fragments.** After shipping a task with all three fragments, verified in `tests/run-task-ship.test.ts`:
  - (a) The shared metrics table ends with the fragment's data rows, in order, with no duplicated header or separator lines.
  - (b) The shared quality `## Log` table holds exactly one row for the task. A pre-existing shared row for the task, carrying an earlier `Spec verdict`, is reconciled: the earlier verdict survives and the rest comes from the fragment. Stray rows for the task are gone, an extra adopter column's cells are kept, and `tasks/<id>/` paths read `tasks/_archive/<id>/`.
  - (c) `docs/lessons-learned.md` ends with the fragment's entries, with paths rewritten the same way.
  - (d) `tasks/_archive/<id>/` contains no `metrics.md`, `quality-log.md` or `lessons.md`.
  - (e) The `chore: archive` commit contains the three shared docs. Compared with today, its only new path is `docs/pipeline-invocations.md`.
- [ ] **AC-5: A failed fold leaves `--ship` re-runnable.** A test forces the fold to fail, for example with an unwritable shared doc. `--ship` exits non-zero, all three shared docs are byte-identical to before, the fragments are still in place, `tasks/<id>/` has not moved to `_archive`, and its `status.json` `human_review` status is unchanged. Re-running `--ship` after the cause is removed succeeds. Verified in `tests/run-task-ship.test.ts`.
- [ ] **AC-6: The headline outcome, parallel tasks don't conflict.** In `tests/run-task-ship.test.ts`, two tasks branch from the same base. Each writes a metrics row, a quality upsert and a lessons fragment; the lessons file is faked, since QA is an agent.
  - `git diff <base>...<branch> -- <the three docs>` is empty for both branches.
  - After task A ships (fold plus archive commit on base), a real `git merge --squash` of task B's branch onto that base completes with no conflict.
  - Shipping B then leaves the base with both tasks' metrics rows, one quality row each, and both lessons entries.
- [ ] **AC-7: Missing fragments are a no-op.** Shipping a task with no fragment files, where the legacy shared-doc rows were merged from the branch, completes with the shared docs as merged plus the existing ref rewrite. If a fragment exists and its shared doc is absent, the fold creates the doc from the standard skeleton and folds into it. Verified in `tests/run-task-ship.test.ts`.
- [ ] **AC-8: Early-phase metrics leave the main checkout clean.** After a spec, spec_review or plan agent invocation with no worktree, `git status --porcelain` in the main checkout shows no change to any `PIPELINE_TELEMETRY_FILES` entry, and the row is in `tasks/<id>/metrics.md`. Verified in `tests/metrics.test.ts` (or `tests/task-cli.test.ts`) with a real temp git repo.
- [ ] **AC-9: `--pr` warns on shared-doc drift.** When the task branch's diff against base touches any of the three shared docs, `--pr` prints a warning naming each touched doc and still proceeds. When none are touched, there is no warning. Verified in `tests/run-task-ship.test.ts` or the existing `--pr` test file the implementer finds hosts the `--pr` harness. If that is a different file, list it in the handoff.
- [ ] **AC-10: Docs and templates describe the new flow.** Each of these states that runs write fragments and `--ship` folds them:
  - `docs/architecture.md` (pipeline step 10 and §Telemetry)
  - `docs/pipeline-orchestrator.md` (auto-commit / telemetry section, plus the ordered `--ship` step list, which gains the fold step) and its `templates/` mirror
  - the intro blockquote and "How to use this doc" point 1 of `docs/lessons-learned.md` and `templates/docs/lessons-learned.md`
  - the header blockquote of `docs/task-quality-log.md` and `templates/docs/task-quality-log.md`
  - `.canon/templates/notes.md` line 3 and its mirror
  - `docs/codebase-map.md`'s rows for the three logs and its knowledge-flow note
  - the `docs/decisions.md` entry "Task quality-log row upserted at the qa → done transition", which also gains the rule that task runs never write the shared logs and `--ship` folds them

  Verified by `npm run sync-templates:check` and `npm run docs-refs-check` passing, and by a grep showing that none of these files still says QA appends to, or the transition upserts into, the shared docs directly.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/metrics.ts` | Run-time writer targets the task's metrics fragment: bundle rows go to the first member, the directory is created, the write is fail-soft, and the override is unchanged. Keep a shared-doc path helper for the fold. |
| `src/orchestrator/quality-log.ts` | `writeQualityLogForTask` upserts into the task fragment. Add a fold export that upserts a fragment row into the shared doc with today's reconcile semantics. `getQualityLogFile` keeps returning the shared doc. |
| `src/orchestrator/telemetry-fold.ts` | New. Folds all three fragments for each task into the shared docs: compute everything first, then write, then delete the fragments. |
| `src/orchestrator/main.ts` | `shipTasks`: call the fold after the merge-proof gate and before the archive loop; add `docs/pipeline-invocations.md` to the archive-commit staged paths. The `--pr` path gets the shared-doc drift warning. |
| `src/orchestrator/prompts/index.ts` | `promptQa()` passes the per-task lessons-fragment paths (a value or list per task, for bundles too) that `qa.md` renders for AC-3. |
| `src/orchestrator/prompts/templates/qa.md` | Lesson append target becomes `tasks/<id>/lessons.md`. The buffer-signal count covers the shared doc plus the fragment. The quality-log line names the fragment. |
| `dist/cli/index.js` | Rebuilt bundle (`npm run build`). |
| `dist/orchestrator/run-task.js` | Rebuilt bundle (`npm run build`). |
| `tests/metrics.test.ts` | New. AC-1, AC-8. |
| `tests/run-task-prompts.golden.json` | Regenerated for the QA prompt change. |
| `tests/run-task-prompts.test.ts` | AC-3 positive assertion. |
| `tests/run-task-ship.test.ts` | AC-4, AC-5, AC-6, AC-7, AC-9. |
| `tests/task-cli.test.ts` | AC-2: quality fragment upsert and reconcile on qa → done. Update existing assertions that expect the shared doc to change. |
| `tests/run-task-quality-log.test.ts` | Fold export: reconcile into the shared table, header-name mapping, stray-row removal. |
| `docs/architecture.md` | Step 10 and §Telemetry. Root-only. |
| `docs/pipeline-orchestrator.md` | Telemetry and auto-commit section, plus the ordered `--ship` step list. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror (`npm run sync-templates`). |
| `docs/lessons-learned.md` | Intro blockquote and "How to use this doc" point 1. Root-only. |
| `templates/docs/lessons-learned.md` | Same wording in the init scaffold. Not a sync mirror; edit by hand. |
| `docs/task-quality-log.md` | Header blockquote. Root-only. |
| `templates/docs/task-quality-log.md` | Same wording in the init scaffold. Not a sync mirror; edit by hand. |
| `.canon/templates/notes.md` | Line 3: lessons reach the shared doc on ship. |
| `templates/.canon/templates/notes.md` | Synced mirror (`npm run sync-templates`). |
| `docs/codebase-map.md` | Rows for the three logs and the knowledge-flow note. Root-only. |
| `docs/decisions.md` | Amend the qa → done quality-log entry and record the fragments-plus-fold rule. Root-only. |

### Implementation Notes (non-binding; owned by plan/implement)

- `parseLogRows`, `reconcileHistory`, `parseStrayRows` and `STANDARD_QUALITY_LOG_SKELETON` are module-private in `quality-log.ts`. Put the quality fold inside that module, or export what the fold needs. One path is to factor the body of `upsertQualityLogRow` so it can take a pre-rendered row, or to parse the fragment row back into derived and judgment cells.
- Fold fragment lookup uses the REPO_ROOT task-dir resolver (`taskDirForRepoRoot`), because the fold runs in the main checkout after the merge.
- Lessons fold: append each fragment body after a `---` separator, matching the existing entry layout.
- Avoid an import cycle between `telemetry-fold.ts` and `main.ts`.

### Interaction Dependencies

- `classifyAndPreserveSharedDocDirt` runs pre-merge for worktree-mode ships and reverts sibling dirt, so the fold writes onto clean shared docs. The re-append of preserved dirt after staging must stay unstaged; that is existing behavior.
- `rewriteArchivedTaskRefs` must see the folded content.
- Validation exemptions already cover `tasks/<id>/`: handoff-diff, base-drift, the human_review allow-list, the accept guard and the auto-commit bypass. No change is expected.
- `commitTaskArtifactsToBase` already commits `tasks/<id>/`. Early-phase metrics fragments ride the scaffold commit, and the worktree branches from it, so implement-phase rows append to the same fragment.
- `canon task post-merge-sync`'s telemetry-only reset regex already treats `tasks/` as telemetry. Unchanged.
- `scripts/docs-refs-check.mjs` skips `tasks/_archive`. Folded entries get `_archive` paths through the existing rewrite.

### Data Model Changes

New per-task files `tasks/<id>/metrics.md`, `tasks/<id>/quality-log.md` and `tasks/<id>/lessons.md`. They exist only from the first write until `--ship`. No change to `status.json` or the shared docs' formats.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite runs clean
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [ ] E2E — N/A (CLI; covered by the AC-6 integration test)

## Docs Impact

All the docs this change makes stale are edited here (AC-10). `docs/patterns.md` may carry a pitfall about telemetry conflicts or shared-doc dirt that should now note the fragments; QA checks.

## Known Risks

- **The fold runs in `--ship`, a delicate path that commits and pushes to the base branch.**
  - The compute-write-delete order, with the fold placed before the archive loop, means a fold failure aborts with nothing archived (AC-5).
  - The remaining gap: if the process is killed after the shared docs are written and before the fragments are deleted, a re-run folds the metrics rows and lessons entries twice. The quality row is replace-by-task, so it is safe. This window is a few filesystem calls, and the accepted recovery is to hand-delete the duplicates before committing.
- **Delayed visibility.** A task's lessons and metrics appear in the shared docs only at ship, and a task that never ships never contributes. That is accepted (see Non-Goals). Today, lessons are already invisible to other tasks until merge.
- **Legacy branch plus fragments in one ship.** A task resumed on the new engine may have metrics and lessons on its branch from the old engine, plus fragment rows. Metrics and lessons from both survive without duplication, because they cover different invocations. For the quality log, the fold reconciles the legacy shared row with the fragment row into one, keeping the earlier `Spec verdict` (AC-4(b)).
- **Bundle members shipped separately.** A bundle's rows live in the first member's fragment, so they reach the shared doc when that member ships, even if the other members ship earlier.
- **Non-worktree ships.** `classifyAndPreserveSharedDocDirt` runs only for worktree-mode ships. On a legacy `worktree: false` ship, uncommitted old-engine rows in `docs/pipeline-invocations.md` would now be swept into the archive commit, as can already happen today for the other two docs. This is a small, transitional widening.
- **This task's own PR** edits `docs/lessons-learned.md` and `docs/task-quality-log.md` (header wording), so the new drift warning will fire on it once the new engine runs. That is expected.
- **Golden drift.** The QA prompt change regenerates the golden file. Other prompts' sections must not change in that diff.
- **Bundle lesson paths.** If the template renders one shared path for a bundle, every member's lesson lands in one fragment and folds when that member ships. AC-3's bundle assertion catches this.

## Human Test Plan

1. Start two small canon tasks and run them in parallel until both reach human review.
2. Open both PRs. Expected: neither PR's file list includes the pipeline metrics log, the task quality log or the lessons buffer.
3. Ship the first task, then the second. Expected: both merge with no conflict and no manual resolution.
4. On main, open the three logs. Expected: both tasks' invocation rows, one quality row per task, and any lessons QA wrote, with archive paths.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A, feature
- [x] (Refactors) — N/A, feature

## Amendment 1 (code_review spec gap, round 2)

Human decisions on review findings S1–S3, 2026-10-17.

### Problem (amendment)

S3(a) fixes a diagnostic defect. The mechanism is deterministic, confirmed by tracing `shipTasks` and `commitArchiveChanges` in the task branch's `src/orchestrator/main.ts`. Once the fold has written the shared docs and deleted the fragments, a later failure exits without a recovery hint:

1. **Archive rename fails** (for example, `fs.renameSync(src, dest)` throws ENOTEMPTY when `tasks/_archive/<id>/` already exists). This is uncaught inside the archive loop, so the process dies with a raw stack. The shared docs are left with uncommitted folded edits.
2. **Commit fails.** `commitArchiveChanges` returns `stderr`, and `shipTasks` dies with `--ship aborted: failed to commit archive changes: <stderr>`, with no mention of the folded rows. The shared docs are left staged but uncommitted.
3. **Push fails.** `commitArchiveChanges` has already committed, then `git('push', 'origin', baseBranch)` throws, uncaught. The folded rows are in a local `chore: archive` commit that was never pushed.

In all three cases the output never says the shared logs hold rows whose fragments are gone. So an operator following the generic "reset and re-run" instinct loses them, in cases 1 and 2, or may reset the local base, in case 3. Trigger values are verified against the existing ship harness's fake commit and push failure seams. Those tests currently exercise preserved legacy dirt, not consumed fragments, which is why no test fails today.

- **S1:** `tests/run-task-safety.test.ts` has an assertion that metrics land in `docs/pipeline-invocations.md` for a worktree run. Move it to the task's `tasks/<id>/metrics.md` fragment in the worktree, and keep the check that `docs/pipeline-invocations.md` is unchanged. Do not drop the worktree-routing check.
- **S2:** `canon doctor`'s quality-log messages say the writer creates the log on the first qa → done transition, and refer to the writer's self-heal write. Reword them: the shared log is now created or updated when `--ship` folds a task's quality-log fragment.
- **S3, recovery after a post-fold failure: options (a) and (c).**
  - **(c)** Keep the "Failure after the telemetry fold" recovery paragraph in `docs/pipeline-orchestrator.md` and its mirror, and accept the gap as a Known Risk (below). A self-healing re-run, option (b), is out of scope.
  - **(a)** Any `--ship` failure that happens after the fold has written the shared docs, and before the archive commit is pushed, exits with a message that:
    - states where the folded rows are now:
      - for an archive or commit failure, uncommitted (possibly staged) edits to the three shared logs;
      - for a push failure, the local `chore: archive` commit that was not pushed;
    - says the fragments are already deleted;
    - says not to reset or check out those docs (or, for a push failure, not to reset the local base);
    - points to the "Failure after the telemetry fold" section of the pipeline reference doc.

    This covers the archive move, the commit and the push. Failures that today escape as uncaught throws, such as the archive `renameSync` and the push, must be caught so the hint is printed.

### Affected Files

| File | Change |
|---|---|
| `tests/run-task-safety.test.ts` | S1: move the worktree metrics-routing assertion to the task fragment; keep the shared-doc-unchanged check. |
| `src/cli/commands/doctor.ts` | S2: quality-log messages say the shared log is created or updated by the `--ship` fold. |
| `tests/cli.test.ts` | S2: update any doctor test asserting the old message wording (only if one exists). |
| `src/orchestrator/main.ts` | S3(a): post-fold archive, commit and push failures exit with the recovery hint. Already listed. |
| `tests/run-task-ship.test.ts` | AC-11 tests. Already listed. |

### Acceptance Criteria (amendment)

- [ ] **AC-11: Post-fold failures print the recovery hint, red-first.** In `tests/run-task-ship.test.ts`, three new tests ship a task that has fragments. Each uses the existing faked commit-failure and push-failure seams, plus a forced archive-rename failure (a pre-existing `tasks/_archive/<id>/`). In each case `--ship` exits non-zero and its output:
  - names the folded shared logs and where the rows are (uncommitted edits, or an unpushed local commit for the push case);
  - warns not to reset them;
  - references the "Failure after the telemetry fold" doc section.

  The tests must first be run against the pre-amendment implementation and fail because the hint text is absent. The handoff records that red run, with the failing assertion, before the fix makes them pass.
- [ ] **AC-12: Restatements updated.** `npm test` passes in full, including `tests/run-task-safety.test.ts`, and `canon doctor`'s quality-log messages no longer say the log is created on qa → done.

### Known Risks (amendment)

- **Failure after the fold is recovered by hand.** If the archive move or commit fails after the fold, the folded rows exist only as uncommitted or staged edits to the shared logs. If the push fails, they sit in an unpushed local `chore: archive` commit. In the uncommitted case, a plain re-run will refuse (quality-log dirt) or drop them (metrics and lessons appends). Resetting the docs loses the rows. Recovery is manual: the failure message points to the documented steps (S3, options (a) and (c)). A self-healing re-run was rejected as new logic on a delicate path for a rare failure.
