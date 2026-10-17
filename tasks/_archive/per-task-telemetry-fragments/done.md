# Completion Summary: per-task-telemetry-fragments — Per-task telemetry fragments, folded on ship

> For the human. This is what you need to know.

## What Changed

Parallel canon tasks kept conflicting in the same three shared logs (metrics, quality log, lessons buffer) because every task appended to the end of them. Now a task writes those entries to its own files inside its task folder while it runs. When the task ships with `canon run --ship`, the fold step copies its entries into the shared logs on the base branch, in the same archive commit that already runs. Two task branches no longer touch the same lines, so their PRs no longer conflict there. The fold runs after the merge proof and before any archive-state change. If it fails, nothing is archived and the command can be re-run. The new `--pr` path also warns when a task branch edits a shared log directly, since that edit will conflict with parallel tasks. Failures after the fold now print where the folded rows are and say not to reset those docs; recovery stays manual by design.

## Files Changed

- `src/orchestrator/metrics.ts` — run-time metrics go to `tasks/<id>/metrics.md`; bundle rows go to the first member; writes are fail-soft.
- `src/orchestrator/quality-log.ts` — QA's quality row goes to `tasks/<id>/quality-log.md`; new fold reconciles fragment rows into the shared table (earliest `Spec verdict` wins, adopter columns kept); backslash decoding fixed.
- `src/orchestrator/telemetry-fold.ts` — new. Computes all shared-doc contents, writes them, then deletes fragments; rolls back on ordinary I/O failure; builds the post-fold recovery hint.
- `src/orchestrator/main.ts` — fold call in `--ship` after merge proof and before the archive loop; `docs/pipeline-invocations.md` added to the archive commit; `--pr` drift warning; post-fold failure hints.
- `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/qa.md` — QA appends lessons to its task's fragment; buffer signal counts shared plus fragment.
- `src/cli/commands/doctor.ts` — quality-log messages describe the ship fold.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt.
- `docs/architecture.md`, `docs/pipeline-orchestrator.md` (+ `templates/docs/` mirror), `docs/lessons-learned.md` (+ template), `docs/task-quality-log.md` (+ template), `.canon/templates/notes.md` (+ mirror), `docs/codebase-map.md`, `docs/decisions.md` — describe the fragment flow and fold.
- Tests: `tests/metrics.test.ts` (new), `tests/run-task-ship.test.ts`, `tests/run-task-prompts.test.ts` and its golden file, `tests/task-cli.test.ts`, `tests/run-task-quality-log.test.ts`, `tests/run-task-safety.test.ts`.

## How to Test

1. Start two small canon tasks and run them in parallel until both reach human review.
2. Open both PRs. Expected: neither PR's file list includes the metrics log, the task quality log or the lessons buffer.
3. Ship the first task, then the second. Expected: both merge with no conflict and no manual resolution.
4. On `main`, open the three shared logs. Expected: both tasks' invocation rows, one quality row per task, and any lessons QA wrote, with `tasks/_archive/<id>/` paths.

Step 1–4 is the spec's Human Test Plan. It has not been run. The automated equivalent is the parallel squash-merge test in `tests/run-task-ship.test.ts` (AC-6).

## Test Results

These results come from the implement-phase handoff and the code review. QA did not re-run them.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm run build` | Pass |
| `npm test` | Pass (1,481 tests: 1,480 pass, 0 fail, 1 skip) |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| AC-11 red-first regression | Pass (all three cases failed before the fix; the reviewer re-ran this red-first) |
| E2E | deferred_by_spec — spec Validation Required marks E2E N/A; AC-6 real-git integration test covers it |

## Human Verification Required

- None.

Pre-merge checklist items QA cannot confirm:

- [ ] Version correct — the release step decides the version; QA does not.
- [ ] Changelog updated — happens at the release step, after human review.
- [ ] PR body current — drafted in `tasks/per-task-telemetry-fragments/pr-body.md`; re-check at `--pr`.
- [ ] Final CI/CD checks green — not visible from this session.
- [ ] Final diff matches spec intent — QA read the handoff and code review but did not diff the branch against the spec.

## Proposed Changelog

- **Parallel tasks no longer conflict on the shared telemetry logs.** Each task writes its metrics, quality-log row and QA lessons to its own files under `tasks/<id>/`. `canon run --ship` folds them into `docs/pipeline-invocations.md`, `docs/task-quality-log.md` and `docs/lessons-learned.md` on the base branch, in the archive commit. Two task PRs no longer conflict in those three files.
- **`--pr` warns when a task branch edits a shared telemetry log.** The warning names each file and does not block the PR.
- **A `--ship` failure after the fold says where the folded rows are.** The message names the affected logs, says the task's fragments are already gone, and says not to reset those docs. It points to the "Failure after the telemetry fold" section of the pipeline reference.

## Decisions Made

- Bundle metrics rows go to the first member's fragment and keep the joined task label. Lessons stay per member.
- The fold always targets the repo's shared docs and ignores `CANON_METRICS_FILE_OVERRIDE` and `CANON_QUALITY_LOG_FILE_OVERRIDE`. Those overrides still redirect the run-time writers.
- A malformed fragment, or an unparseable shared log, aborts `--ship` rather than being skipped. This is fail-closed.
- The `--pr` drift warning fires on `--pr` only, not `--push`, as the spec's wording says.
- Spec-review finding F1 (`promptQa()` passed only formatted strings) was accepted, and the builder was added to Affected Files.
- Amendment 1 (post-fold failure hint) takes spec review options (a) and (c): the hint is printed, and recovery is manual. No automatic retry was added.
- Backslash decoding collapses paired backslashes, so repeated QA writes and folds are byte-stable. This fixed code-review C1.
- `Spec verdict` for the quality log: the first spec_review verdict was `changes_requested` (inferred from `changes_requested_total: 2` in `status.json` and the round-1 F1 notes; `status.json` keeps only the latest, `approved_with_nits`).

## Open Questions

- **Manual recovery after a post-fold failure.** If archive or commit fails after the fold, the folded rows exist only as uncommitted or staged edits. If push fails, they sit in an unpushed local `chore: archive` commit. Re-running `--ship` alone will not restore them. Accepted by the human in the amendment; confirm you're comfortable with it, or open a follow-up for a self-healing re-run.
- **Double-fold window.** If the process is killed after the shared docs are written and before fragments are deleted, a re-run duplicates metrics rows and lessons entries. The quality row is safe, since it is replace-by-task. The accepted recovery is to hand-delete the duplicates.
- **Non-worktree ships.** `classifyAndPreserveSharedDocDirt` runs only for worktree ships. On a `worktree: false` ship, uncommitted old-engine rows in `docs/pipeline-invocations.md` would now go into the archive commit. This is a small, transitional widening.
- **Older-engine ships.** An older engine can archive a task's new fragments without folding them. Those fragments need manual recovery.
- **Pitfall for `docs/patterns.md`.** The spec's Docs Impact asked QA to check whether `docs/patterns.md` should note the fragment-based telemetry. QA only corrects stale references, so it added nothing there. Do you want a pitfall entry about shared-log dirt and fragments?
- **Lessons buffer.** QA appended three lessons (see `docs/lessons-learned.md`). The buffer has 12 entries, below the ~15 threshold, so no maintenance signal is raised.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 1
- Validation gaps: 0
- Notes: Spec gaps surfaced in spec_review (promptQa builder) and code_review (stale worktree test, doctor wording, post-fold recovery amendment); C2 was a stale AC-10 doc line caught in code review.
