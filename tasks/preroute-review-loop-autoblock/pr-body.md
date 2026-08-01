## Summary

- The `spec_review` and `code_review` loop-cap auto-blocks used to fire only when the review phase was re-entered — which is always *after* a `changes_requested` verdict had already routed back to a fresh spec-writing or re-implementation session. So the round that hit the cap always burned one more full revision cycle before anyone got a chance to intervene. This moves the check to the entry of the revision phase itself (`spec` / `implement`), before any agent is spawned, and keeps the old review-entry check as a backstop.
- Both checkpoints now share one evaluator per loop, so they can't disagree on the threshold, the counter formula, or the recovery wording — including the resume-order clause, which is genuinely state-dependent (a block at the new checkpoint means the deferred revision runs first on resume; a block at the backstop means the review runs directly), so it's derived from persisted state rather than hard-coded.
- Along the way, three related gaps got closed: `canon task accept --force` now correctly completes the deferred predecessor phase instead of leaving it pending; `canon watch` no longer misreports a live cap-raised resume as blocked (or a genuine block as settled) — it's now gated on orchestrator process liveness instead of phase identity; and a malformed `MAX_REVIEW_LOOPS` value now warns and falls back to the default instead of silently disabling the guard.
- `canon task reset-spec-review`/`reset-code-review` now both disclose that resetting accepts the current work as-is for a fresh review rather than requesting another revision pass, and `reset-code-review` now works directly from the new blocked-at-`implement` state it needed to accept.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

<!--
Anything reviewers should know that isn't obvious from the diff — behavior
changes that don't show up in tests, follow-up tasks already filed, risk
callouts, manual verification steps run. Optional.
-->

- This is a `delicate: true` change to the orchestrator's own phase-dispatch hot path. The diff went through 3 code-review rounds (`tasks/preroute-review-loop-autoblock/review.md`): round 1 flagged a `spec_gap` on three consumer-side gaps (`accept --force`, `canon watch`, `MAX_REVIEW_LOOPS` parsing) that became a spec Amendment; rounds 2–3 found and closed a class of undisclosed-state-write / state-independent-promise bugs in the recovery-text builders. Final verdict: **Approved with nits**, all 24 ACs met, full validation gate independently re-run and green three separate times.
- A known, pre-existing, human-approved-deferred bug (`promptSpecRevision` selection unreachable on resume — `docs/BACKLOG.md`) means a cap-raised *spec*-loop resume currently re-authors the spec from scratch instead of resuming a revision session. It's out of scope here (separate defect class, needs its own red-first test), but this PR increases exposure to it since it's now this feature's advertised recovery path — flagged in `done.md` Open Questions for a priority bump.
- `docs/pipeline-invocations.md` has telemetry rows from this task's own pipeline runs that need to land or be reverted before merge — it's the only dirty file outside this diff's scope.
- One doc nit is intentionally left open: `docs/pipeline-orchestrator.md`'s `reset-code-review` row doesn't yet mention the `implement → done` write this PR adds to that command. Noted in `done.md`; a one-line follow-up.
