## Summary

- Fix the QA task-quality-log row so it upserts from task state at the `qa → done` transition instead of being blind-appended by the QA agent — the row now survives reroutes and always lands inside the Log table instead of drifting stale or landing below "Periodic Reviews."
- Add explicit per-cell reconciliation for any duplicate rows the old mechanism left behind, header-driven cell placement so an adopter's own added columns survive untouched, and a fail-soft write path so a corrupt or unwritable log can never block a task from finishing QA.
- Correct the doc prose that described the old append-only behavior and add `XS` to the documented Size column domain.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

- The five columns that can't be derived from `status.json` (spec verdict, human-reroute flag, dropped ACs, validation gaps, notes) now come from a new `## Quality Log` block in `done.md`; the QA prompt was rewritten to ask for that instead of a blind append.
- Row placement is entirely header-name-driven rather than positional, so a log an adopter has customized with an extra column stays intact across an update.
- This task's own row in `docs/task-quality-log.md` had to be added by hand this one time — the writer being shipped here isn't part of the currently-installed global canon that ran this task's own `qa → done` transition, so it can't apply to itself. It takes effect automatically starting with the next task once this releases.
- Code review ran all three lenses (anchored Claude, cold Claude, cold Codex) and found no correctness bugs or spec gaps. Six non-blocking robustness/coverage nits are open (see the code review artifact) — none reachable given canon's current sequential execution model.
