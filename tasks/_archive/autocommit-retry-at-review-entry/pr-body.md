# PR Body: autocommit-retry-at-review-entry - Retry a failed implement auto-commit at code_review entry

## Summary

- When the implement auto-commit fails, the next `canon run` now retries it before code review starts. Before, code review's pre-flight rejected the uncommitted handoff files and that rejection used up a review loop (issue #84).
- If the retry fails again, the run stops with the same `Auto-commit failed:` message before the pre-flight, so no review loop is spent.
- If the operator has accepted implement and HEAD still matches the accepted commit, the retry does nothing.
- The code-review foreman now cites headings exactly: a quoted `§"Heading"` must match a real heading in the file. A citation to a bold-lead paragraph no longer fails the docs-refs check at commit time.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Validation results were recorded during implementation and were not re-run at QA. `npm test` reported one test skipped by the sandbox guard. I have not identified it, so treat it as unverified.
- The retry only looks at files listed in the handoff's Changes rows. Task artifacts and telemetry dirt do not trigger it.
- Tests: three main-loop tests cover retry success, a clean handoff with pipeline dirt, and retry failure. A red run of the retry-success test, with the retry call removed, reproduced the pre-flight rejection.
- Human test plan (not run here): on a scratch repo with a real pre-commit check, make the auto-commit after implement fail, fix the reference, and re-run. The run should commit first, then start code review with no pre-flight rejection.
