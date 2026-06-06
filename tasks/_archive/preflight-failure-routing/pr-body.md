## Summary

- Classify pre-flight rejections into three buckets (format / regression / infra-blocked) and emit targeted fix instructions instead of a uniform "resubmit handoff" message
- Close the laundering path: a `Fail – unrelated` row whose cited file is in the task's branch diff is now rejected deterministically at pre-flight — the implementer is told to fix the code, not relabel the row
- Infrastructure failures (`blocked`-only handoffs) now halt for human triage instead of sending the work back for another implementation pass that can't fix infra

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/scripts/run-task.js`; `dist/cli/index.js` byte-identical)

## Notes

The core change is in `scripts/run-task/validation.ts` (`classifyPreflightBlockersFromData`) and `scripts/run-task/phases/code-review.ts` (`determinePreflightRoute` / `buildPreflightReviewBlock`). The classifier is a pure function that takes the aggregated blockers plus the changed-files set and returns per-blocker bucket assignments; the route and message are derived from that single result, so the logic has one tested source.

The changed-files set is the bundle-wide three-dot diff (`getAffectedFiles`), so in bundle runs no task can call a file changed by a peer "unrelated."

The implement-revision prompt (`implement-revisions.md`, `{{#hasPreflightFindings}}` branch) is bucket-neutral — the bucket is not persisted between phases (by design), so the prompt defers to the `review.md` pre-flight block for the actual fix instruction. Direct prompt assertions in `tests/run-task-prompts.test.ts` verify the retired phrases are gone.

Discovered during GalleryPlanner's `smartfill-decode-failure-persist` task: Codex broke an E2E test in a file it changed, the pre-flight said "fix your handoff," Codex relabeled the row, and the run burned the entire review cap before auto-blocking. This closes that path.
