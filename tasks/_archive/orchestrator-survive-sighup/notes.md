# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement] `scripts/run-task.ts` needed an import guard (`import.meta.url` vs `process.argv[1]`) so the signal test could import the entrypoint without auto-running `main()`.
