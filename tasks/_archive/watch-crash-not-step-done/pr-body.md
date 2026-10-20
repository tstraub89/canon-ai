# PR Body: watch-crash-not-step-done - Watch reports a crashed full-auto run as death, not step_done

## Summary

- `canon watch` no longer reports a crashed detached run as `reason=step_done` with exit 0. A run whose last exit line is non-zero, or whose runtime files survive a dead process, now reports `reason=death` and exits 4.
- The crash reason (for example the planning session's exit reason, or the termination reason for a signal) is printed to stderr as one `canon watch:` line with a resume hint. The stdout summary line keeps its existing shape.
- Clean `--step` finishes and clean stops at a human gate (exit 0) still report `step_done`.
- The exit-code table in `docs/pipeline-orchestrator.md` now says what `0` and `4` mean for crashes, and the template mirror is regenerated.

Fixes #76.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [ ] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- `dist/cli/index.js` is rebuilt and must be part of this PR. After it is committed, run `npm run build && git diff --exit-code -- dist/` to confirm the bundle is fresh. That check has not run yet.
- `npm run sync-templates:check` passes. The `templates/docs/pipeline-orchestrator.md` mirror is regenerated, not hand-edited.
- Behavior change to review: a run stopped by a signal (`canon stop`, Ctrl-C) during a phase now reports `death` with the termination reason, not `step_done`. This is intended.
- Known gap, out of scope: a `canon watch` started after a run has already died still reports `nothing_to_watch` (exit 2). The fix applies when watch is attached before the run exits. A follow-up is needed to cover the attach path.
- The `tests/run-task-signals.test.ts` SIGTERM test failed once during implementation and passed on re-run. It is not related to this change, but it is worth watching in CI.
