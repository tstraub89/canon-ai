# Spec Review: canon-inline-review-skill

> Reviewer: Codex | Spec: `tasks/canon-inline-review-skill/spec.md`

## Shape Check

No concerns.

## Feasibility Check

- [ ] Affected files exist and contain what the spec assumes
- [ ] Proposed patterns are consistent with existing conventions
- [ ] No conflicts with existing functionality

## Issues Found

### Correctness Issues

(none)

### Missing Edge Cases

1. The human test plan still reads like an implementation checklist instead of product-language validation. Steps 4 and 5 mention `CLAUDE.md`, `canon doctor`, and the test suite, which violates the spec-writing rule called out in the task prompt and makes the human-facing acceptance flow less clear. This is not blocking, but it should be rewritten before implementation so the handoff reads like an end-user exercise rather than a code audit. Citation: `tasks/canon-inline-review-skill/spec.md:94-100`.

2. AC-3 documents the selector forms (`--commit <SHA>`, `--base <branch>`, selector XOR prompt) but never states the user-facing input contract for choosing those modes. If the skill is meant to accept explicit commit/branch targets as arguments or prompt text, the plan needs to pin that down; otherwise the implementer has to infer where the SHA or branch name comes from. Citation: `tasks/canon-inline-review-skill/spec.md:14, 32-37, 47-57`.

### Type Safety / Interface Gaps

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)

## Amendment Review

- [x] **Approved**

> Findings: no new blocking issues. The amendment makes AC-3 explicit about operator-intent-driven target selection, removes git-state inference as an intent source, and preserves the prior scope bound and flag-source-of-truth constraints without contradiction.
