## Summary

- `code_review` re-rounds no longer re-review the whole task diff from scratch — on GalleryPlanner's telemetry, re-rounds were ~55% of all code_review time, the pipeline's biggest single cost. Cold-Codex and the cold-Claude lens now scope to the delta since the previous round's commit; the anchored lens still gets the full diff, spec, and handoff.
- A round still falls back to a full review when it's Round 1, the task is XL/delicate, the previous round's cold-Codex record is missing/unusable, the fix touched files outside the prior round's change set, or the delta exceeds a 400-line threshold. No lens is ever skipped.
- Each round that runs cold-Codex now writes its own numbered archive file (`review-cold-codex-run-N.md`) instead of overwriting the last one, so every round's findings survive; `review.md` states each round's scope, base, and reason.
- The cold-Claude lens's charter gains a standing sibling-site sweep: when a diff adds or changes a guard, check, or invariant, it now searches the repo for other sites needing the same fix.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

<!--
Anything reviewers should know that isn't obvious from the diff — behavior
changes that don't show up in tests, follow-up tasks already filed, risk
callouts, manual verification steps run. Optional.
-->

- Git's synchronous diff/numstat probes can fail on large output; probe failure and an empty successful result are now represented separately, and the scope resolver falls back to a full review whenever a required probe fails rather than silently narrowing scope.
- The reviewed HEAD SHA is pinned before cold-Codex starts (not read afterward), so a commit landing mid-review can't get attributed to a round that never saw it.
- One non-blocking follow-up surfaced in round 2 review: full-round foreman wording still tells the cold-Claude lens to stay within changed files for truncated-diff context, while its charter independently states the sibling-site sweep applies every round. The two read consistently as written and the lens did sweep in practice, but reconciling the wording is a one-line change for whoever next touches this template — filed as an open question, not fixed here.
- Per-lens timing and a `pipeline-invocations.md` column for it are called out as a follow-up issue, not part of this change.
