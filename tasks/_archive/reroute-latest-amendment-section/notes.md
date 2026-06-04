# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement] `npm run build` regenerated both `dist/scripts/run-task.js` and `dist/cli/index.js` because the shared validator is bundled into both entrypoints. Keep both bundle artifacts in the handoff diff.

