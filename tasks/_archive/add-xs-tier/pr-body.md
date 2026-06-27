## Summary

- Adds `XS` as the new fast-tier task size (spec+plan combined, Codex `spec_review` skipped) — the smallest way into the pipeline. XS clones S's current `mini/medium` effort rows; the fast-tier cross-review direction (Codex implements against written ACs, Claude reviews) and all pipeline properties come with it.
- Graduates `S` to full tier: S tasks now get a separate plan and a Codex `spec_review` pass at S's existing medium-effort row, making `spec_review` the formal XS→S dividing line.
- Sweeps all live guidance surfaces (runtime prompt templates, skills, docs, CLI help, README) across four label families so no surface still calls the fast tier "S" or calls inline/below-pipeline work "XS".

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (896 pass, 1 skipped, 0 fail)
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`; `dist/` committed)
- [x] `UPDATE_GOLDENS=1 npm test` (regenerated `tests/run-task-prompts.golden.json`; plain `npm test` passes)
- [x] `npm run sync-templates` + `npm run sync-templates:check` (seven canon-managed mirrors synced)
- [x] Guidance-consistency gate (AC-18) — Family A, B, D `rg` sweeps each returned zero matches; Family C verified positively by targeted ACs

## Notes

- **S behavior change is intentional.** Any existing `task_size: S` task routes full tier on its next `canon run` after this merges — it will get `spec_review` + a separate plan. This is the point of the task, not a regression; it's documented in the spec's Non-Goals.
- **Six `task_size: 'S'` test fixtures were intentionally left unchanged.** Only the three fixtures whose assertions encode the fast-tier contract (spec_review skip, plan-combined, fast-tier reroute) were moved to XS. The other six use S as an arbitrary valid size; their assertions are tier-agnostic.
- **`docs/pipeline-invocations.md`** accumulated telemetry rows during this task's pipeline runs and will appear staged at commit time — expected behavior for the auto-logged orchestrator metrics file.
- **The `--pr` base-drift gate requires the seven generated/synced mirror files** (`dist/**`, `tests/run-task-prompts.golden.json`, six `templates/` mirrors) to be declared in the Affected Files allowlist; they are.
