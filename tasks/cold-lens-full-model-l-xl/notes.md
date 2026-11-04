# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Spec AC-9 / Affected Files expect both `dist/cli/index.js` and `dist/orchestrator/run-task.js` to be rebuilt. Only `run-task.js` contains `codexMatrix`; `cli/index.js` carries just the policy env config, and tsup strips comments, so a fresh build likely leaves `cli/index.js` byte-identical. Interpretation: AC-9 = "`git diff --exit-code -- dist/` clean after rebuild"; list `cli/index.js` in handoff only if it actually changed (handoff coverage rejects listed paths absent from the diff). No scope change.
