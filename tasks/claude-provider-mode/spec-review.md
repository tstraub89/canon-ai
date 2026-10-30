# Spec Review: claude-provider-mode

> Reviewer: Codex | Spec: `tasks/claude-provider-mode/spec.md`

## Shape Check

no concerns

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes.
- [x] Proposed patterns are consistent with existing conventions.
- [x] No blocking conflicts with existing functionality.

Re-read the current spec and traced provider routing, config resolution, session storage and clearing, phase resume selection, park/retry/fix-up paths, dependency checks, prompt surfaces, and numbered review archives against the current code. The scope parser recognizes 46 paths, with no malformed entries or missing files. Required completion metadata and status-template test updates are within the declared scope.

## Issues Found

### Correctness Issues

none

### Missing Edge Cases

none

### Type Safety / Interface Gaps

none

## Verdict

- [x] **Approved** — spec is implementable as written.
- [ ] **Approved with nits** — implementable, but noting observations for plan phase.
- [ ] **Changes requested** — spec must be revised before plan phase.

No findings. This was a static spec review, not implementation validation. Live provider switching and budget-park resumption remain to be verified by the specified implementation tests and Human Test Plan.

## Amendment Review

- [x] **Approved**

No findings.

Reviewed `## Amendment` and its integration with the approved spec. AC-16 supersedes the Claude-mode filename in original AC-10 and Decision 9 while retaining the round-header contract. The amendment defines independent numeric allocation, newest matching-round selection within each family, cross-provider lookup, conflicting-SHA fallback, and malformed-record handling. Mixed-mode output and existing delta triggers remain preserved.

Re-opened `src/orchestrator/review-archive.ts`, the code-review phase and its tests, the scope policy, and the foreman prompt builder/template. The existing Claude foreman wording describes a numbered round record without specifying its filename, so the prompt non-goal is compatible with the rename. The declared files cover the writer, lookup, phase integration, tests, and documentation changes.

This is a static amendment review; no implementation checks were run. Two-family lookup, conflicting records, and provider switches remain to be verified by the amendment's implementation tests.
