# PR Body: per-task-telemetry-fragments - Per-task telemetry fragments, folded on ship

## Summary

- Task runs stop writing `docs/pipeline-invocations.md`, `docs/task-quality-log.md` and `docs/lessons-learned.md`. Each task writes its metrics, quality-log row and QA lessons to `tasks/<id>/metrics.md`, `quality-log.md` and `lessons.md`.
- `canon run --ship` folds those fragments into the three shared logs after the merge proof and before the archive loop. The fold happens in the same `chore: archive` commit that already runs, so parallel task PRs no longer conflict in those files.
- The fold is compute-then-write. If it fails, `--ship` aborts with the shared docs and fragments unchanged and can be re-run.
- `--pr` warns when a task branch's diff touches any of the three shared logs. It is a warning, not a block, so legacy branches still open.
- Post-fold archive, commit or push failures print where the folded rows are and point to the "Failure after the telemetry fold" section of the pipeline reference.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Early-phase metrics (spec, spec_review, plan) now land in the task fragment, so the main checkout stays clean after those phases. Legacy safety nets are unchanged: `classifyAndPreserveSharedDocDirt`, the absorb-telemetry half of `commitTaskArtifactsToBase`, and the `PIPELINE_TELEMETRY_FILES` exemptions.
- A `worktree: false` ship can now sweep uncommitted old-engine rows in `docs/pipeline-invocations.md` into the archive commit. This is a transitional widening, and it only applies to legacy non-worktree ships.
- If the process is killed between the shared-doc writes and the fragment deletion, a re-run duplicates metrics rows and lessons entries. Delete the duplicates by hand before pushing. Quality rows are replace-by-task, so they are safe.
- The two-parallel-tasks walkthrough is not yet run by hand. The automated version is the parallel squash-merge test in `tests/run-task-ship.test.ts`.
