# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Spec AC-9 / Affected Files expect both `dist/cli/index.js` and `dist/orchestrator/run-task.js` to be rebuilt. Only `run-task.js` contains `codexMatrix`; `cli/index.js` carries just the policy env config, and tsup strips comments, so a fresh build likely leaves `cli/index.js` byte-identical. Interpretation: AC-9 = "`git diff --exit-code -- dist/` clean after rebuild"; list `cli/index.js` in handoff only if it actually changed (handoff coverage rejects listed paths absent from the diff). No scope change.

- [implement] Before changing production code at base e8e520f42b7a9393097fc6a578e55ce75401403b, the new/updated focused tests produced six expected failures: five policy/promotion checks returned mini instead of full, and the real-backend subprocess emitted the literal mini override for L. After the two-cell fix, all 22 focused tests passed.
- [implement] A fresh build rebuilt both entry points but left `dist/cli/index.js` byte-identical to HEAD; only `dist/orchestrator/run-task.js` contains changed policy cells. The handoff will list only the changed generated artifact, with AC-9 interpretation recorded because commits belong to the orchestrator.
