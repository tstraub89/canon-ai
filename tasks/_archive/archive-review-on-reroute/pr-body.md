## Summary

- Rerouting a task whose code review had already gone through multiple rounds left the old, multi-round `review.md` on disk. Our verdict reader deliberately looks only at the *last* `## Round N` section, so a fresh round-1 approval landing outside any round heading was invisible — the phase would wedge with a "verdict mismatch" error, or, worse, could silently advance on a stale approved verdict that had nothing to do with the new review.
- Reroute now archives each task's `review.md` to `review-prior-<n>.md` (numbered one above whatever's already there) before touching any other task state, so the post-reroute round 1 starts clean. A still-blank review file is left in place since there's nothing to preserve.
- It also drops the stored review session ID on reroute, so round 2 of the new review doesn't quietly resume a session that remembers every pre-reroute round.
- The two reroute prompt lines that point a sibling task at "its outstanding review findings in `review.md`" now look up the archived file at render time instead, since that path no longer holds those findings after a reroute.
- Archiving is fail-closed: it runs for every task in a reroute *before* any task's `status.json` is touched, and if any archive fails, the whole reroute aborts with nothing left half-mutated.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- New shared module `src/orchestrator/review-archive.ts` owns the archive-rename allocator and the "find the newest archive" lookup together, backed by one directory scan, so the two can't drift apart — that pairing was the trickiest part of this change to get right, since a mismatch between them would silently point an agent at stale findings.
- `canon task reset-code-review`'s archive numbering changed from "lowest free number" to "one above the highest," to share the new allocator. Everything else about that command (phase guard, counter resets, session drop, stdout wording) is unchanged, and its existing tests pass without modification.
- Filed to `docs/BACKLOG.md` rather than fixed here: (1) a stale `done.md` can similarly let QA get silently skipped after a reroute — same bug shape, different artifact; (2) the reused template-stub detector is a bare substring match and could in a narrow, currently-unreachable case misclassify a real review as an unfilled template.
- A small handful of non-blocking nits (an unguarded directory read on a prompt-render path, a couple of message-wording touch-ups) came out of code review and are recommended as a quick follow-up commit rather than blockers — see `tasks/archive-review-on-reroute/review.md` for specifics.
