# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[implement-reroute] `collectGitIgnoredTargets` can be poisoned by non-path backtick tokens like `--force` or `npm run lint`; the reroute fix needs a path-shape filter so one bad token does not disable the entire gitignore batch.
[implement-reroute] The poison filter needs to be candidate-only: source-file paths like `docs/generated report.md` must still flow through the gitignore source pass even though they contain spaces.
[implement-reroute] The only real `git check-ignore` 128-causers I observed were outside-repo paths and paths that cross a symlinked directory; the batch fix needs to isolate those instead of trying to predict token shapes.




