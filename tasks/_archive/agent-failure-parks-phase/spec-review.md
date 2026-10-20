# Spec Review: agent-failure-parks-phase

> Reviewer: Codex | Spec: `tasks/agent-failure-parks-phase/spec.md`

## Shape Check

no concerns

The current wrapper failure ladders and existing fake-agent test support the stated deterministic mechanism. The proposed typed-error boundary prevents failed sessions from reaching normal phase post-processing, and AC-2 requires red-first verification.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes; the error module is intentionally new.
- [x] Proposed patterns are consistent with existing conventions.
- [x] No conflicts with existing functionality within the specified scope.

The full-bundle park matches `autoBlockPhase()` and phase derivation. Agent calls in the phase runners and completion-recovery loop precede bundle routing. Decision 7 consistently defines reopening completed members, and AC-13 covers both throwing failures and the returning non-zero Codex path. The retained review-counter behavior is explicitly accepted in Known Risks.

## Issues Found

### Correctness Issues

None.

### Missing Edge Cases

None.

### Type Safety / Interface Gaps

None.

## Verification

Re-read the current spec and traced wrapper failures, cold-Codex failure handling, QA salvage, the main-loop boundary, completion recovery, phase re-entry, durable blocking, and watcher classification.

Three scoped existing safety tests passed in this review: agent failure ladders, crashed spec-review parking, and self-bookkept spec-review acceptance despite a trailing non-zero exit. These verify the current baseline; the proposed failure/park/recovery implementation and new regressions remain to be validated during implementation.

`npm run docs-refs-check` passed after writing this review.

## Verdict

- [x] **Approved** — spec is implementable as written; no findings.
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase
