# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[plan] No spec gaps. tasks/provider-pin-agent-free-paths/ already contained handoff.md/done.md/review.md/pr-body.md/metrics.md at plan time (untracked, not created by this phase); left untouched. Step 3 AC-6 invalid-branch value to be confirmed against validateBranchField at implement time.

[implement] validateStatus only checks branch/base_branch/numeric counters; a bad task_size does not fail --ship startup. Full-suite run had one timing flake (shutdown waits for resistant descendant) that passed on rerun.
