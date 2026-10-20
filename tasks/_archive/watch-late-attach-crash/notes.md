# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

[plan] Gate the attach-time crash check to exclude a `human_review`-pending current phase (the checkpoint state); spec non-goal says attach human_review handling is unchanged. Interpreting that as exclusion; not a spec contradiction.

[implement] AC-1 red-first regression reproduced the late-attach miss before production changes: expected death, got nothing_to_watch. After sharing crash evidence across attach and idle paths, the watcher tests passed.
