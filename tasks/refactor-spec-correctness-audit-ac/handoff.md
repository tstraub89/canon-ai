# Implementation Handoff: refactor-spec-correctness-audit-ac

> Author: Codex | Spec: `tasks/refactor-spec-correctness-audit-ac/spec.md` | Plan: `tasks/refactor-spec-correctness-audit-ac/plan.md`
>
> This handoff records the complete implementation, including the initial pass and Amendment Round 1.

## Changes

| File | What Changed |
|---|---|
| `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md` | Added the refactor correctness-audit rule and gated pre-presentation self-check. |
| `.canon/templates/spec.md`, `templates/.canon/templates/spec.md` | Added the refactor note and gated checklist line; mirror regenerated. |
| `.claude/skills/canon-spec-review/SKILL.md`, `templates/.claude/skills/canon-spec-review/SKILL.md` | Added review check (10), updated scope count to ten; mirror regenerated. |
| `src/orchestrator/prompts/templates/spec.md` | Added the refactor correctness-audit rule after structural caps. |
| `src/orchestrator/prompts/templates/spec-revision.md` | Added the identical refactor correctness-audit rule after structural caps. |
| `src/orchestrator/prompts/templates/spec-review.md` | Added refactor audit evidence question; amended missing-audit severity to Blocking in Amendment Round 1. |
| `src/orchestrator/prompts/index.ts` | Added the refactor-gated correctness-audit self-check line. |
| `tests/run-task-prompts.test.ts` | Added structural assertions for carrier coverage, placement, equal bullet text, no backticks, golden rendering, and amended severity wording. |
| `tests/run-task-prompts.golden.json` | Regenerated spec, spec-revision, and spec-review prompt fixtures; Amendment Round 1 changes the spec-review golden only. |
| `dist/orchestrator/run-task.js` | Rebuilt bundled prompts; Amendment Round 1 rebuild includes the updated severity wording. |
| `docs/BACKLOG.md` | Removed the shipped candidate line only. |

## Canon Governance

See authoritative provenance fields in `status.json.canon`.

## Intent & Rationale

Author guidance requires a correctness audit before preserving refactor behavior and records one of three outcomes. Reviewer guidance keeps the advisory skill at STRONG/never BLOCKING, while the pipeline spec_review prompt now treats missing audit evidence as Blocking so the orchestrator requests a spec revision. A one-line audited-correct record remains sufficient for trivially correct refactors.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Initial build verification used consecutive bundle hash comparison rather than expecting `git diff --exit-code -- dist/` against the task baseline to pass. | The bundle is an intended generated change, so baseline diff must be non-empty. Consecutive builds produced identical output; only the expected orchestrator bundle changed. | AC-10 met: generated bundle is reproducible. |
| Amendment Round 1 changed only the final severity sentence of the spec_review bullet, as directed by the amendment. | The pipeline prompt uses Blocking to trigger `changes_requested`; the advisory skill retains STRONG/never BLOCKING per AC-13. | AC-12 through AC-14 met. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Skill rule follows structural-caps bullet and names fixed deliberately, split into a separate task, or kept as a named intentional quirk; gated self-check added. |
| AC-2 | Met | Added refactor note and checklist line; no headings changed. |
| AC-3 | Met | Identical bullet follows the structural-caps bullet in both prompt templates; test asserts equality and adjacency. |
| AC-4 | Met | Builder self-check is refactor-gated; test verifies spec rendering and absence from spec-revision rendering/golden. |
| AC-5 | Met as amended | Strategic-read question sits beside bug-fix evidence; silence-default text is unchanged. Amendment Round 1 makes missing audit evidence Blocking. |
| AC-6 | Met | Check (10) follows (9), states N/A scope and STRONG/never BLOCKING; scope says ten and no “nine” remains in skill or mirror. |
| AC-7 | Met | Structural test checks “correctness audit” in each carrier and the builder, plus distinctive golden text. |
| AC-8 | Met | Implementation diff is limited to Affected Files and Generated Artifacts; excluded prompts, agents, and foreman are untouched. |
| AC-9 | Met | Added shipped lines contain no canon-internal path references, BACKLOG/CHANGELOG citations, or backticks; docs reference check passes. |
| AC-10 | Met | Mirrors synchronized; prompt goldens regenerated and reviewed; bundle reproducible. |
| AC-11 | Met | Removed only the candidate inventory line. |
| AC-12 | Met | Pipeline prompt says missing audit is a Blocking Shape Check concern requiring a changes_requested verdict; it has no STRONG or never-BLOCKING wording. Test pins severity, question, outcomes, and audited-correct escape. |
| AC-13 | Met | Advisory skill check (10) and its mirror were not changed in this amendment and still state STRONG, never BLOCKING. |
| AC-14 | Met | Spec-review golden and orchestrator bundle regenerated; full required checks pass. The round's implementation diff contains only the four amended files. |

## Edge Cases Considered

- The review prompt asks a question and preserves the existing silence default, avoiding manufactured findings for trivially correct refactors.
- The refactor gate uses the existing author-judgment convention and marks features and bug fixes N/A.
- The spec-revision prompt receives the shared rule bullet but not the author self-check line.
- The advisory skill remains unchanged by Amendment Round 1; only pipeline spec_review severity changed.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Amendment Round 1 run passed. |
| `npm run type-check` | Pass | Amendment Round 1 run passed. |
| `npm test` | Pass | 1,334 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Amendment Round 1 bundle built successfully; only `dist/orchestrator/run-task.js` changed in the round. |
| E2E | deferred_by_spec | Spec: no UI surface. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync; amendment did not change managed files. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| Prompt test targeted run | Pass | 47 passed; regenerated the prompt goldens. |
| Amendment scope and skill-preservation check | Pass | Round diff limited to the four amendment files; advisory skill and mirror have no worktree diff. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
