## Summary

- Fixed a bundle atomicity gap in the code-review pre-flight rejection path: when any task in a bundle fails handoff validation, all sibling tasks now land at the same terminal state instead of leaving clean siblings stuck at `pending`
- On the fixable route (format/regression blocker), all bundle tasks get `changes_requested` and reroute to implement together — previously clean siblings triggered phantom solo Claude review retries and accumulated divergent loop counters
- On the blocked-only route (infrastructure unavailable), all bundle tasks now receive a halt stub `review.md`; previously clean siblings were auto-blocked with no artifact and an incomplete audit trail

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/scripts/run-task.js`; `dist/cli/index.js` stayed byte-identical)

## Notes

- The `docs-refs-check` failure is pre-existing: `docs/decisions.md` lines 242–244 reference archived `tasks/codex-code-review-phase/` files that were removed in a prior task. These are outside this PR's diff and can be cleaned up independently.
- The clean-task stub uses a non-`## Round` heading and omits its verdict checkbox when appended over a prior real review, so `extractCheckedVerdict` continues to return the prior verdict rather than the stub's content. This is intentional — it mirrors the existing failing-task BLOCKED-block append and preserves the `canon task phase code_review done <prior-verdict>` recovery path.
- Single-task pipelines are unaffected (the artifact loop is a no-op when `preflightFailed` covers the entire `tasks` array or when no pre-flight failures occur).
