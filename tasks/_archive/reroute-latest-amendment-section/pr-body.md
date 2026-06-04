## Summary

- Fix `sliceRerouteRoundSection` to return the **last** same-round amendment section instead of the first, so the rejected-amendment recovery path reads the fresh revised verdict rather than the stale rejection.
- Add unit tests covering duplicate same-round selection, single-match/no-match cases, round-1 bare-label duplicates, fenced fake headings, earlier-section fence carry, and `checkRerouteEvidence` end-to-end fresh-verdict.
- Rebuild `dist/` bundles — `validation.ts` bundles into both `dist/scripts/run-task.js` and `dist/cli/index.js`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

The root cause was a set-once guard (`if (start === -1) { start = i }`) that picked the first matching heading and never updated it. On the rejected-amendment recovery path, `canon run` (not `--reroute`) re-runs spec_review and appends a second `## Amendment Review Round N` section — the new verdict below the old one. The fix overwrites the candidate on every same-round heading match in a single pass, so the last appended section wins. Fence/comment state is carried continuously from the start of the file so a fence opened inside an earlier same-round section doesn't corrupt selection of the real last heading.

A live example of the precondition exists in `tasks/_archive/release-agnostic-surface/spec-review.md` (two `## Amendment Review Round 2` sections). That run was unharmed only because both sections happened to be approvals; the harmful ordering (first = `changes_requested`, second = `approved`) is the normal shape of a revised reroute.
