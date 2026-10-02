# Implementation Handoff: refactor-spec-correctness-audit-ac

> Author: Codex | Spec: `tasks/refactor-spec-correctness-audit-ac/spec.md` | Plan: `tasks/refactor-spec-correctness-audit-ac/plan.md`

## Changes

| File | What Changed |
|---|---|
| `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md` | Added the refactor correctness-audit rule and gated pre-presentation self-check. |
| `.canon/templates/spec.md`, `templates/.canon/templates/spec.md` | Added the refactor note and gated checklist line; mirror regenerated. |
| `.claude/skills/canon-spec-review/SKILL.md`, `templates/.claude/skills/canon-spec-review/SKILL.md` | Added review check (10), updated scope count to ten; mirror regenerated. |
| `src/orchestrator/prompts/templates/spec.md` | Added the refactor correctness-audit rule after structural caps. |
| `src/orchestrator/prompts/templates/spec-revision.md` | Added the identical refactor correctness-audit rule after structural caps. |
| `src/orchestrator/prompts/templates/spec-review.md` | Added the refactor audit evidence question beside the bug-fix evidence question. |
| `src/orchestrator/prompts/index.ts` | Added the refactor-gated correctness-audit self-check line. |
| `tests/run-task-prompts.test.ts` | Added structural assertions for phrase coverage, placement, equal prompt bullet text, no backticks, and golden rendering. |
| `tests/run-task-prompts.golden.json` | Regenerated spec, spec-revision, and spec-review prompt fixtures. |
| `dist/orchestrator/run-task.js` | Rebuilt bundled prompts. |
| `docs/BACKLOG.md` | Removed the shipped candidate line only. |

## Canon Governance

See authoritative provenance fields in `status.json.canon`.

## Intent & Rationale

Placed the author guidance beside existing refactor structural caps and the reviewer guidance beside bug-fix evidence. The author-side requirements name the three audit outcomes, while reviewer guidance preserves silence as the default and sets missing evidence to STRONG, never BLOCKING.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Build verification used consecutive bundle hash comparison instead of expecting `git diff --exit-code -- dist/` against the task baseline to pass. | The bundle is an intended generated change, so baseline diff must be non-empty. Two consecutive builds produced the same SHA-1 (`2cedcdf10af74cd9a7e134b575ce59b023a45115`); only `dist/orchestrator/run-task.js` changed. | AC-10 met: generated bundle is reproducible and the only changed `dist/` file is the expected artifact. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Skill rule follows structural-caps bullet and names fixed deliberately, split into a separate task, or kept as a named intentional quirk; gated self-check added. |
| AC-2 | Met | Added refactor note and checklist line; no headings changed. |
| AC-3 | Met | Identical bullet text follows the structural-caps bullet in both prompt templates; structural test asserts equality and adjacency. |
| AC-4 | Met | Builder self-check is refactor-gated and records outcomes; test verifies spec rendering and absence from spec-revision rendering/golden. |
| AC-5 | Met | Strategic-read question sits beside the bug-fix evidence question; existing silence-default wording is unchanged. |
| AC-6 | Met | Check (10) follows (9), states N/A scope and STRONG/never BLOCKING; scope says ten and no “nine” remains in skill or mirror. |
| AC-7 | Met | Structural test checks “correctness audit” in each carrier and the builder, plus distinctive golden text. |
| AC-8 | Met | Diff contains only Affected Files and Generated Artifacts (plus this task’s state/handoff artifacts); no excluded prompts or agents changed. |
| AC-9 | Met | Added shipped lines contain no canon-internal path references, BACKLOG/CHANGELOG citations, or backticks; docs reference check passes. |
| AC-10 | Met | Mirrors synchronized; all three prompt goldens regenerated and reviewed; build is reproducible and only expected bundle changed. |
| AC-11 | Met | Removed only the candidate inventory line. |

## Edge Cases Considered

- The review prompt asks a question and preserves the existing silence default, avoiding manufactured findings for trivially correct refactors.
- The refactor gate uses the existing author-judgment convention and marks features and bug fixes N/A.
- The spec-revision prompt receives only the shared rule bullet; its golden does not receive the author self-check line.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Initial run caught an unnecessary assertion in the new test; corrected and rerun successfully. |
| `npm run type-check` | Pass | Completed successfully. |
| `npm test` | Pass | 1,334 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Consecutive builds produced identical orchestrator bundle hashes; expected bundle is the only `dist/` diff. |
| E2E | deferred_by_spec | Spec: no UI surface. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| Prompt test targeted run | Pass | 47 passed; regenerated prompt goldens. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
