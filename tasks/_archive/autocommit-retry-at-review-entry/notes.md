# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
[plan] Task dir already held handoff.md, review.md, done.md, pr-body.md, metrics.md while status.json was at `plan`; treated as stale, left untouched.
[plan] Judgment call: `git status` probe failure in the retry pre-check skips the retry (falls to today's pre-flight path) rather than dying; spec is silent.
[plan] Golden: both promptCodeReview_round1 and promptCodeReview_roundN embed the foreman template and need UPDATE_GOLDENS regen.
[plan] `agent-failure-parks-phase` (not yet on main) wraps runPhase in try/catch; retry call must stay outside it. Textual conflict is possible; later lander reconciles.
[implement] The retry helper is exported so fixture tests can exercise the actual commit and stop behavior in isolated git repos; the coverage does not yet drive the full main-loop pre-flight path.
[implement-revision] A real worktree main-loop fixture needs the handoff source to be absent from the task branch's base diff; otherwise the pre-flight cannot reproduce the missing `base...HEAD` path that the retry fixes.
