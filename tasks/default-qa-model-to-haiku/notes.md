# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

- [plan] The task dir already held untracked handoff.md, review.md, done.md, pr-body.md and metrics.md while status.json says plan is in progress and implement is pending. I left them untouched; the plan does not rely on them. Worth checking whether they are stale leftovers.
- [plan] No spec contradictions or gaps found. Design choice (spec left open): add a `qa` value to the unexported ClaudeTier with a QA_DEFAULT_MODEL constant.
