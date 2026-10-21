# PR Body: full-send-tail-push-and-watch - Full-send tail pushes canon scaffold commits; watch reports a dead tail

## Summary

- `canon watch` now reports a `--full-send` run that dies in its final tail as a death (`reason=death`, exit 4), with the reason printed on stderr. Before, it looked like a clean stop for review. This applies only to full-send tasks at pending `human_review`. A tail that is still running keeps watch blocking, even when its heartbeat is stale during a slow git or `gh` call.
- The full-send tail pushes unpushed base commits before the base-divergence gate, but only when every one of them has an exact canon scaffold subject and changes only `tasks/` paths or pipeline telemetry files. Merge commits never qualify, and renames count as a delete plus an add. The push targets the checked tip SHA, so an operator commit made during the tail is not published.
- If any other base commit is unpushed, the tail pushes nothing and the divergence gate stops the run as before. A rejected push, or a failed fetch or probe, stops the tail with a clear message.
- The "Scaffold committed to local <base>" hint prints only when unpushed scaffold commits exist. Under `--full-send` it says what the tail will push.
- Plain `--pr`, `--push`, and `--ship` behavior is unchanged.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Issue #104, part 1. Part 2 (the `--ship` branch-delete ordering) is a separate fix. Issue #103 (base-drift relaxation) is also separate.
- Reviewers should know the guard is a content rule, not a provenance check. An operator-made commit that has only task files and telemetry, with the exact scaffold subject, will be pushed. That is accepted; the reasoning is in `tasks/full-send-tail-push-and-watch/spec.md`, Problem and Known Risks.
- Red-first runs for the watch classification ACs (AC-1, AC-2) were judged red against the old code by construction, not executed. Red runs were recorded for the push-target (AC-7), the full-send push (AC-4), and the scaffold hint (AC-8). The AC-5 and AC-6 negative-path tests were not run red.
- Manual check before merge: run a full-send task to the end, and separately run one with an unpushed unrelated base commit. Expected: the first opens the draft PR, and the second stops before the PR and leaves your commit unpushed.
