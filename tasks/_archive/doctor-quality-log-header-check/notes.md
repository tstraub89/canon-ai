# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] `npm test -- tests/cli.test.ts tests/run-task-quality-log.test.ts` runs the repository's full test suite because the npm script hard-codes `tests/*.test.ts`; the full suite still passed.
[implement] `npm run build` regenerated only `dist/cli/index.js`; `dist/scripts/run-task.js` remained unchanged after the export-only source edit.
