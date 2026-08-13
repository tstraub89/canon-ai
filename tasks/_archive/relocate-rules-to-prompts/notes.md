# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[implement] The AC-11 structural test reads edited repo files from `process.cwd()` instead of `REPO_ROOT`; in linked worktree runs, `REPO_ROOT` can point at the supervising checkout and miss the active worktree edits.

