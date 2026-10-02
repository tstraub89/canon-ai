# Implementation Handoff: refactor-spec-correctness-audit-ac

> Author: Codex | Spec: `tasks/refactor-spec-correctness-audit-ac/spec.md` | Plan: `tasks/refactor-spec-correctness-audit-ac/plan.md`
>
> Complete implementation record through Amendment Round 2.

## Changes

| File | What Changed |
|---|---|
| `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md` | Added canonical author rule A and canonical outcomes O in the gated self-check; mirror regenerated. |
| `.canon/templates/spec.md`, `templates/.canon/templates/spec.md` | Added canonical author rule A and outcomes O in the checklist; mirror regenerated. |
| `.claude/skills/canon-spec-review/SKILL.md`, `templates/.claude/skills/canon-spec-review/SKILL.md` | Added canonical reviewer question R to check (10), retaining STRONG/never BLOCKING; mirror regenerated. |
| `src/orchestrator/prompts/templates/spec.md` | Added canonical author rule A after structural caps. |
| `src/orchestrator/prompts/templates/spec-revision.md` | Added the identical canonical author rule A after structural caps. |
| `src/orchestrator/prompts/templates/spec-review.md` | Added canonical reviewer question R, with Blocking severity for missing audit evidence. |
| `src/orchestrator/prompts/index.ts` | Added canonical outcomes O to the refactor-gated self-check. |
| `tests/run-task-prompts.test.ts` | Added structural and verbatim assertions for A/R/O, mirrors, placement, severity, and golden rendering. |
| `tests/run-task-prompts.golden.json` | Regenerated spec, spec-revision, and spec-review prompt fixtures. |
| `dist/orchestrator/run-task.js` | Rebuilt bundled prompt text. |
| `docs/BACKLOG.md` | Removed the shipped candidate line only. |

## Canon Governance

See authoritative provenance fields in `status.json.canon`.

## Intent & Rationale

Refactor authors must record whether each preserved behavior is correct today and select an explicit outcome. Canonical wording is now pinned by one structural test to prevent guidance drift. The pipeline review prompt treats missing audit evidence as Blocking; the advisory review skill retains STRONG, never BLOCKING.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Initial build verification compared consecutive bundle hashes rather than expecting the intended dist change to produce an empty baseline diff. | The generated bundle is part of the task. Consecutive builds produced identical bundle output. | AC-10 met. |
| Amendment Round 2 followed the later canonical reviewer wording R, which replaces Amendment Round 1's “audited, correct” sentence. | Round 2 explicitly replaces the prior paraphrase and defines a one-line record for behavior confirmed correct; its approved decision supersedes that prior wording. | AC-15 through AC-19 met. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Canon-spec rule follows structural caps and names all four canonical outcomes; gated checklist line added. |
| AC-2 | Met | Refactor note and gated checklist line added without changing headings. |
| AC-3 | Met | Identical rule A follows structural caps in both author prompts; test checks equality and adjacency. |
| AC-4 | Met | Builder self-check contains O and is rendered only by the spec prompt; test checks both goldens. |
| AC-5 | Met as amended | Review question is beside bug-fix evidence and silence-default text is unchanged; Round 1 makes missing evidence Blocking. |
| AC-6 | Met | Check (10) follows (9), uses R and keeps STRONG/never BLOCKING; scope says ten. |
| AC-7 | Met | Shared phrase remains present; canonical string assertions now supersede presence-only coverage. |
| AC-8 | Met | Source and generated edits stay within the spec’s Affected Files across rounds; no excluded prompt or agent changed. |
| AC-9 | Met | Added shipped text has no canon-internal path, BACKLOG/CHANGELOG citation, or backtick; docs-reference check passes. |
| AC-10 | Met | Mirrors, prompt goldens, and bundle regenerated; bundle output is reproducible. |
| AC-11 | Met | Removed only the shipped candidate line. |
| AC-12 | Met | Pipeline reviewer bullet’s missing-audit severity is Blocking; its wording is further canonicalized by R in Round 2. |
| AC-13 | Met | Advisory skill and mirror retain STRONG, never BLOCKING. |
| AC-14 | Met | Round 1 regenerated the spec-review golden and bundle; its diff was limited to its four files. |
| AC-15 | Met | A appears verbatim in the skill, spec template, spec prompt, and spec-revision prompt; previous paraphrases were replaced. |
| AC-16 | Met | R appears verbatim in both review surfaces; search of carriers and mirrors has no “is actually correct” hit. Severity remains split by surface. |
| AC-17 | Met | O appears verbatim in both checklist lines and the builder self-check. |
| AC-18 | Met | One test defines O/A/R once and asserts the appropriate canonical string in every listed carrier and mirror. Mutation check changed one word in the skill’s A; the test failed on the missing canonical author rule, then the original file was restored. |
| AC-19 | Met | Mirrors, goldens, and bundle regenerated; required tests, lint, type-check, and template check pass. |

## Edge Cases Considered

- “Correct as-is” now covers behavior confirmed correct; no behavior must be incorrectly assigned to one of the other outcomes.
- The pipeline reviewer and advisory skill intentionally retain different severity labels.
- The self-check remains rendered by the spec prompt only; the spec-revision prompt receives only A.

## Blockers

- None.
- [ambiguity] Amendment Round 1 said the “audited, correct” escape remains, while Round 2 replaces that paraphrase with R and defines “A behavior confirmed correct needs only a one-line record.” Applied the later canonical R wording as the superseding requirement.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Amendment Round 2 run passed. |
| `npm run type-check` | Pass | Amendment Round 2 run passed. |
| `npm test` | Pass | 1,334 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt the orchestrator bundle successfully. |
| E2E | deferred_by_spec | Spec: no UI surface. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| Prompt test targeted run | Pass | 47 passed; regenerated goldens. |
| Canonical wording mutation check | Pass | One-word mutation caused the expected assertion failure; file restored. |
| Advisory skill preservation / round scope | Pass | Skill and mirror still state STRONG/never BLOCKING; round source diff is limited to the 13 amended files. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
