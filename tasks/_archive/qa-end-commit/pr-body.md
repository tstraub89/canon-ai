## Summary

- Commits QA artifacts (review notes, done summary, pr-body draft, status, and any dirty managed docs) at the QA→`human_review` boundary so the worktree enters human review with a clean tree
- Fixes issue #152 both by timing (clean tree at reroute) and by invariant: `PIPELINE_MANAGED_DOCS` are now exempt from the implement-phase orphan-change detector so a managed doc can never abort an implement auto-commit regardless of when it was last committed
- `--pr` path unchanged — clean-tree idempotent push + PR, late post-QA edits still captured by the existing dirty-tree commit path

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/scripts/run-task.js` — `scripts/run-task/main.ts` + `validation.ts` changed)

## Notes

The helper is invoked from a single chokepoint in `checkAndRoute('qa', ...)` covering both the normal QA completion path and the `tryEvidenceAdvance` qa-done path — no second call site. The implementation adds a second-stage post-add staged-file check (mirroring `commitHumanReviewFiles`'s guard) to prevent a dirty allowed directory from sweeping out-of-scope files into the commit; this is a minor deviation from the plan, documented in the handoff.

The residual implement→first-QA uncommitted-progress window (before any QA-done fires) is intentionally out of scope per the spec's Non-Goals; the `PIPELINE_MANAGED_DOCS` reconciler exemption does close the #152-flavor managed-doc abort in that window even without a commit.
