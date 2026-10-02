# Spec: refactor-spec-correctness-audit-ac — Refactor specs require a correctness audit before preserve-behavior

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

A refactor spec that says "preserve behavior" faithfully reproduces whatever latent bugs today's code has: the implementer and every reviewer treat current behavior as the oracle, so a wrong behavior is protected by the spec itself. `docs/lessons-learned.md` history and the operator-memory inventory (BACKLOG entry "Port distilled operator-memory lessons into active canon mechanisms", strong candidate "Refactor specs require a correctness audit AC") record this as a lesson that was already written down and still got missed, which is the signal that a passive note does not hold and the rule needs an enforced home.

Today the spec-authoring and spec-review surfaces say only that refactor specs need hard structural caps (size cap, per-symbol deletion expectations, grep AC for disappeared symbols). None says to audit whether the behavior being preserved is actually correct. Nothing in canon types a task as a refactor (no task type, status field, or template section), so identification stays author judgment, exactly as the bug-fix gate works today.

## Decision

Refactor specs must audit, before any "preserve it" AC, whether each behavior they declare preserved is actually correct today. Every audited behavior ends in one of three explicit outcomes: fixed deliberately (with its own AC), split into a separate task, or kept as a named intentional quirk. The audit result is recorded in the spec's *Problem* section (what was audited, what was found); any "fixed deliberately" outcome gets its own AC, and the "preserve" AC comes after and may rely on the audit. A refactor spec that says "preserve" with no audit evidence is a spec_review finding of STRONG severity, never BLOCKING: a trivially correct refactor (a pure rename) is satisfied by a one-line "audited, correct" record, and a missed audit should cost a review round, not halt the pipeline.

The rule is carried on every surface that carries the sibling refactor-caps rule and the bug-fix evidence rule, so it has an author-side home in each tier and a reviewer-side home in each review path:

- Author side: the canon-spec skill, the spec task template, the spec and spec-revision phase prompts, and the spec-author self-check list.
- Reviewer side: the spec_review phase prompt and the canon-spec-review skill (a new check; the check count in that skill goes from nine to ten).

The rule is behavior-level: it names what the audit must establish, not counts, formats, or section layouts. It adds guidance only — no new task type, template section, gate, status field, or phase — so it is a patch-eligible guidance refinement under the versioning decision.

## Non-Goals

- No `refactor` task type, `status.json` field, template section, detector, or orchestrator gate; identification of a refactor stays author judgment.
- No change to plan, implement, QA, code-review, or reroute prompts or to the code-review agents and foreman; the audit belongs at spec time, and existing tests assert that certain spec-rule phrases are absent from the code-review agents.
- No change to the bug/flake-fix rules, the structural-caps rule wording, or the Validation Matrix table.
- No canon-internal path in any shipped text (adopter scope): the rule is prose only, with no backtick file paths.
- No version bump, release cut, or CHANGELOG entry in this task; release mechanics follow the release process after merge.
- No reflow of the other rules of thumb; the new rule is added beside the refactor-caps rule and nothing else is reordered.

## Acceptance Criteria

- [ ] AC-1: The canon-spec skill carries a rules-of-thumb bullet, placed immediately after the refactor structural-caps bullet, requiring a pre-"preserve" correctness audit with the three outcomes (fixed deliberately, split out, kept as a named quirk), and a checklist line gated to refactors in the pre-presentation self-check. Verify: read both additions; the bullet names all three outcomes.
- [ ] AC-2: The spec task template carries the same requirement as a refactor-specific note under the Acceptance Criteria heading (matching the existing bug-fix note convention) and a refactor-gated line in its Spec Quality Checklist. No new section is added. Verify: the template's section headings are unchanged from before the task; the note and checklist line are present.
- [ ] AC-3: The spec phase prompt and the spec-revision phase prompt each carry the rule as a bullet immediately after their existing refactor structural-caps bullet, with identical bullet text in both (em-dash prompt convention). Verify: both files contain the bullet adjacent to the caps bullet and a test asserts the two bullet texts are equal.
- [ ] AC-4: The spec-author self-check list in the prompt builder gains a refactor-gated line (mirroring the existing bug/flake-gated line's convention) that contains the phrase "correctness audit" and confirms the audit outcomes are recorded. The self-check list is rendered by the spec prompt only (the spec-revision prompt does not render it and is not changed to), so the line reaches the regenerated spec golden alone. Verify: the spec golden contains the line; the spec-revision golden does not.
- [ ] AC-5: The spec_review phase prompt's strategic read gains a refactor-shape bullet beside the bug-fix evidence bullet: for a refactor spec, does the spec show audit evidence that the preserved behavior is correct, with each audited behavior's outcome stated? Silence remains the default; the bullet adds a question, not an obligation to produce a finding, and a missing audit is a STRONG finding, never BLOCKING. Verify: the bullet is present in the strategic-read list; the surrounding "silence is the default" text is unchanged.
- [ ] AC-6: The canon-spec-review skill gains check (10) for refactor-audit evidence (N/A for features and bug fixes), after check (9), with severity stated as STRONG, never BLOCKING (unlike check (9)), and its scope line states ten items. Verify: the skill contains checks (1) through (10), the scope line says "ten", and no other count reference in the skill or its mirror says "nine".
- [ ] AC-7: Every carrier in AC-1 through AC-6 uses the shared rule name phrase "correctness audit" so one structural check can find them all. Verify: a test asserts the phrase appears in each of the six carrier files (skill, spec template, spec prompt, spec-revision prompt, spec-review prompt, canon-spec-review skill) and in the prompt builder's self-check line, and that the self-check line's distinctive text is present in the regenerated spec golden. The test proves presence; placement and refactor-gating are reviewed under AC-1 through AC-6.
- [ ] AC-8: The change touches only the files in Affected Files (scope bound). Verify: `git diff --name-only <base>...HEAD`, excluding this task's own `tasks/<id>/` artifacts and pipeline telemetry files, is a subset of the Affected Files table; in particular none of the plan, implement, QA, code-review, or reroute prompts, and neither code-review agent nor the foreman, appear in the diff.
- [ ] AC-9: Shipped text contains no canon-internal path reference and no BACKLOG or CHANGELOG citation. Verify: the sync-templates leak gate passes (`npm run sync-templates:check`, which covers the skills and the spec template but not the prompt templates or the prompt builder), and a test asserts the added rule lines in the prompt templates and the prompt builder contain no backtick.
- [ ] AC-10: Generated and derived artifacts are regenerated, not hand-edited: the three template mirrors (skill, spec template, canon-spec-review skill) are byte-identical to their roots; the three golden prompt fixtures (spec, spec-revision, spec-review) are regenerated and their diff reviewed (spec changes from the rule bullet and the self-check line, spec-revision from the rule bullet only, spec-review from the strategic-read bullet); the committed `dist/` equals a fresh build, where only the orchestrator bundle is expected to change because the prompt text is bundled there alone. Verify: `npm run sync-templates:check`, the prompts test suite, and `npm run build` followed by `git diff --exit-code -- dist/` all pass.
- [ ] AC-11: The BACKLOG inventory's candidate line for this rule is deleted, following the file's convention of dropping shipped entries (a single removal; the rest of the inventory is untouched). Verify: the line is gone and every other line of the inventory is byte-unchanged.

## Design

Prose edits to existing guidance carriers plus one structural test extension and regenerated fixtures. The new rule sits next to the refactor structural-caps rule in each place that carries it, and next to the bug-fix evidence rule in the reviewer and checklist surfaces, matching the conventions already in each file (skill bullets use a bold lead and colon; prompt bullets use a bold lead and an em dash; gated checklist lines use a parenthesized applicability prefix).

### Affected Files

| File | Change |
|---|---|
| `.claude/skills/canon-spec/SKILL.md` | Add the correctness-audit rule-of-thumb bullet after the refactor structural-caps bullet; add a refactor-gated self-check line |
| `.canon/templates/spec.md` | Add a refactor note under Acceptance Criteria and a refactor-gated Spec Quality Checklist line; no new section |
| `.claude/skills/canon-spec-review/SKILL.md` | Add check (10) refactor-audit evidence; change the scope line count from nine to ten |
| `src/orchestrator/prompts/templates/spec.md` | Add the rule bullet after the refactor structural-caps bullet |
| `src/orchestrator/prompts/templates/spec-revision.md` | Add the rule bullet after the refactor structural-caps bullet |
| `src/orchestrator/prompts/templates/spec-review.md` | Add the refactor-shape bullet to the strategic read beside the bug-fix evidence bullet |
| `src/orchestrator/prompts/index.ts` | Add a refactor-gated line to the spec-author self-check list |
| `tests/run-task-prompts.test.ts` | Add structural assertions: the "correctness audit" phrase appears in each of the six carriers and the self-check line; the two prompt bullets are identical; added prompt-side lines contain no backtick |
| `tests/run-task-prompts.golden.json` | Regenerated: spec, spec-revision, and spec-review prompt entries change (spec-revision from the rule bullet only) |
| `docs/BACKLOG.md` | Delete the "Refactor specs require a correctness audit AC" candidate line (shipped) |

Generated Artifacts (declare in handoff Changes as well):

| File | Change |
|---|---|
| `templates/.claude/skills/canon-spec/SKILL.md` | Regenerated mirror by sync-templates |
| `templates/.canon/templates/spec.md` | Regenerated mirror by sync-templates |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Regenerated mirror by sync-templates |
| `dist/orchestrator/run-task.js` | Rebuilt: prompt text is bundled into this artifact only |

### Interaction Dependencies

- The existing prompts test asserts the DELETE and positive-assertion rule phrases are present in the canon-spec skills and absent from the foreman and code-review agents; the new phrase must not collide with those regexes, and the new assertion should follow the same file-reading style.
- The Validation Matrix table in the spec template must stay byte-identical to the implement prompt's copy (separate test); do not touch it.
- The docs-refs check validates backtick refs in managed docs; added prose must not introduce backtick file paths.
- Bundled prompts reach adopters through the build, so the adopter-scope rule applies to every added line.

### Data Model Changes

None.

## Validation Required

Universal change-type → check-category matrix (project command bindings are in `docs/architecture.md` §Validation):

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |
| UI / interaction changes | End-to-end tests |
| Content / SEO / metadata | Prerender / sitemap / feed regeneration |
| Schema / migration | Migration runner + manual review |
| Cross-platform | Subset of the above on each platform |

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — prompt text is bundled into dist; committed dist must match a fresh build
- [ ] E2E — N/A, no UI surface
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

None of the five protected docs should go stale: the spec-authoring rule lives in skills and prompts, not in `docs/patterns.md` or `docs/decisions.md`. QA may judge whether the pitfall merits a patterns entry; that is a promotion decision, not part of this task.

## Known Risks

- **Golden churn is wider than expected.** The spec-review prompt change reaches a third golden beyond the spec and spec-revision ones, and each golden changes for a different reason (AC-10); a missed regeneration fails `npm test`. Mitigation: AC-10 requires regenerating and reviewing the diff, and AC-8 bounds scope.
- **Count drift in the review skill.** Changing "nine" to "ten" in the scope line while a stray count elsewhere still says nine would leave the skill inconsistent. A repo-wide search for the count phrase found only the scope line today; AC-6 requires it to stay so after the change.
- **Over-triggering on non-refactors.** A rule gated by author judgment could be applied to feature work, or skipped by calling a refactor a "cleanup." Mitigation: the applicability gate is stated the same way as the existing bug-fix gate ("N/A for features/bug fixes"), and the reviewer bullet asks a question rather than mandating a finding, so a misclassified spec costs at most one review question.
- **Reviewer rigidity.** If the spec_review bullet reads as an obligation, reviewers will manufacture findings on refactors that have a trivially correct behavior (a pure rename). Mitigation: the bullet keeps silence as the default, and "kept as a named quirk" or a one-line "audited, correct" outcome satisfies it.
- **Prompt-test regex collisions.** Existing tests assert absence of certain phrases from code-review surfaces; the new phrase "correctness audit" is not among them, but the new assertion must not be written so broadly that it matches the foreman or agents.

## Human Test Plan

1. Ask Claude to draft a spec for a behavior-preserving refactor of something small. Expected: before any "keep behavior the same" criterion, the spec states for each behavior kept whether today's behavior was checked for correctness, and says what happens to anything found wrong (fixed on purpose, split into its own task, or kept as a named quirk).
2. Ask Claude to draft a spec for an ordinary new feature. Expected: no audit requirement appears.
3. Run the spec review on a refactor spec that says "preserve behavior" with no mention of whether that behavior is correct. Expected: the review raises the missing check; on a refactor spec that does show the check, it stays silent about this.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes; N/A for features/refactors) — N/A, guidance feature
