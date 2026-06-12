## Summary

- Add `canon task reset-code-review <TASK-ID>` to safely reset the `code_review` loop counters when the auto-block cap fires — archives the prior `review.md`, zeroes the current-loop counters, clears the stale verdict, and re-derives the top-level status pointer atomically
- Rewrite the single-task and bundle auto-block recovery messages to point at `canon task reset-code-review <id>` instead of the previous hand-edit-`status.json` guidance
- Refresh `docs/pipeline-orchestrator.md` (and its template mirror) to match

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`; both committed)

## Notes

The helper mirrors `taskResetSpecReview` in shape but handles the `code_review`-specific `preflight_rejections_current_loop` field that `spec_review` lacks. The lifetime `iterations` counter is intentionally preserved — only the current-loop counters are zeroed, keeping the durable auto-block audit signal intact.

`templates/docs/pipeline-orchestrator.md` is in the diff because the pre-commit hook auto-synced it when the root doc changed; the sync gate passes clean.
