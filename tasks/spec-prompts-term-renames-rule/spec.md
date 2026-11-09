# Spec: spec-prompts-term-renames-rule — Carry the term-renames rule in the spec phase prompts

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

The canon-spec skill's "Spec-writing rules of thumb" list ends with **Codebase-wide term renames: gate per string family, not per enumerated hit** (`.claude/skills/canon-spec/SKILL.md`). The rule targets a failure that happens mostly *inside the pipeline*: a rename spec whose grep ACs enumerate hits by hand grows a new label family every `spec_review` round, and the session that revises the spec in response runs headless from `src/orchestrator/prompts/templates/spec-revision.md`, where the skill is not loaded. The spec phase prompt (`src/orchestrator/prompts/templates/spec.md`), which also drives the fast-tier combined spec+plan session, does not carry it either.

The neighbouring skill rule "Enumerate every caller and classify its execution context" is already carried in both prompt templates, so carrying canon-spec rules of thumb in the spec prompts is the established pattern; the renames rule is the one that was left out. The lessons sweep recorded this gap as an unresolved follow-up in two consecutive sweeps (`docs/lessons-learned.md` sweep comment).

Grep evidence (2026-11-09): the phrase "string famil" has no hit in `src/orchestrator/prompts/templates/`, `tests/run-task-prompts.golden.json` or `dist/orchestrator/run-task.js`; outside archived task files and the changelog, only the skill and its `templates/` mirror carry it.

## Decision

Add one bullet, a condensed form of the skill rule, to the **Spec-writing rules of thumb** list in both `src/orchestrator/prompts/templates/spec.md` and `src/orchestrator/prompts/templates/spec-revision.md`, placed immediately after the "Refactor specs need a correctness audit" bullet and before "UI spatial / gesture tasks". The bullet text is identical in both templates and is exactly:

```text
- **Codebase-wide term renames: gate per string family, not per enumerated hit** — a hand-enumerated list of grep hits grows every review round, because each round surfaces a new label *family* rather than a missed instance. Before writing ACs, sweep the codebase once to split the old term into its distinct string families, and gate each family with a zero-result grep AC whose word-bounded pattern catches every separator variant and cannot match the new term. Where the old string is a substring of the new one, a zero-result grep cannot work: verify those surfaces with positive targeted ACs and say so in the spec, so reviewers don't read it as a gap. Before finalizing a zero-result AC, read each affected prose file for paraphrases of the retired claim, and fold hits the spec already tolerates elsewhere (historical docs, test fixtures) into a permitted-to-remain list inside the same AC.
```

A parity test pins the rule's title phrase `Codebase-wide term renames: gate per string family, not per enumerated hit` across every carrier, so a later edit to one carrier that drops or renames the rule fails a test.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Rule wording in the prompts | Condensed paraphrase (one paragraph) | Copy the skill's full text verbatim | The prompt is read on every spec and revision session; the condensed form keeps every instruction (family decomposition, word-bounded zero-result gate, substring asymmetry, paraphrase read, permitted-to-remain bucket) at about two-thirds the length. Tim chose the condensed form when the follow-up was proposed. | `Human` |
| What the parity test pins | The shared title phrase across both templates and both skill copies, plus the full bullet in both templates being byte-identical | Make the skill and templates share one canonical sentence and pin it | The skill's longer text is a deliberate per-carrier difference; editing the shipped skill widens scope and the mirror for no behavior change. Pinning the title phrase catches a dropped or renamed rule on any carrier. | `Author` |
| Review side | Author and reviser prompts only; spec-review prompt and canon-spec-review checklist unchanged | Add a matching review question, as the refactor correctness-audit rule has | The author and reviser write the grep ACs, so the rule acts where the failure is created; keeping the reviewer unchanged keeps this task XS. A review-side check is a clean follow-up if rename specs still pass review with hand-listed hits. | `Author` |
| Placement in the list | After "Refactor specs need a correctness audit", before "UI spatial / gesture tasks" | Directly after "Enumerate every caller" | Matches the skill's ordering, where the renames rule follows the refactor rules, so the two lists read in the same order. | `Author` |

## Non-Goals

- No edit to `.claude/skills/canon-spec/SKILL.md` or its `templates/` mirror.
- No edit to `.canon/templates/spec.md`, the `promptSpec` self-check list, or any other phase's prompt template (spec-review, plan, implement, code-review, QA). The rule is a spec-authoring rule and stays scoped to the two spec-authoring prompts.
- No review-side counterpart: the spec-review prompt template and the canon-spec-review skill's checklist are unchanged. The fix targets the author and reviser, who write the grep ACs; the reviewer already blocks on AC decomposition, and a review-side check can follow as its own task if hand-enumerated rename ACs still pass review.
- No rewording of any existing bullet in either template.
- The lessons-buffer sweep comment that lists this gap as an unresolved follow-up is left for the next sweep to update.

AC-4 backs the scope bound.

## Acceptance Criteria

- [ ] AC-1: `src/orchestrator/prompts/templates/spec.md` and `src/orchestrator/prompts/templates/spec-revision.md` each contain the bullet given in *Decision*, byte-for-byte, as the line immediately after the line starting `- **Refactor specs need a correctness audit**` and immediately before the line starting `- **UI spatial / gesture tasks**`. Verify by reading both files.
- [ ] AC-2: The rendered prompts carry the rule: in `tests/run-task-prompts.golden.json`, the `promptSpec`, `promptSpecRevision`, `promptSpec_withDocsMap` and `promptSpecRevision_withDocsMap` entries each contain the title phrase `Codebase-wide term renames: gate per string family, not per enumerated hit`, regenerated with `UPDATE_GOLDENS=1 npm test`. No other golden entry changes, and the other golden file the same command rewrites (`tests/completion.golden.json`) is byte-identical. Verify with `git diff tests/run-task-prompts.golden.json` showing changes only in those four keys and `git diff --exit-code tests/completion.golden.json`.
- [ ] AC-3: A new test in `tests/run-task-prompts.test.ts`, modelled on the existing "judgment-call guidance stays aligned across spec surfaces" test, asserts: (a) the title phrase is present in `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md`, `src/orchestrator/prompts/templates/spec.md` and `src/orchestrator/prompts/templates/spec-revision.md`; (b) the full bullet line containing the title phrase is identical in the two prompt templates; (c) the outputs of `promptSpec` and `promptSpecRevision` both contain the title phrase. The test fails on the base commit (the templates lack the phrase); record that red run in the handoff.
- [ ] AC-4: Scope bound: `git diff --name-only <base>...HEAD`, excluding this task's own `tasks/spec-prompts-term-renames-rule/` artifacts and pipeline telemetry files, lists only the files in *Affected Files*, and `grep -rl "gate per string family" src/orchestrator/prompts/templates/` lists exactly `spec.md` and `spec-revision.md`.
- [ ] AC-5: `dist/orchestrator/run-task.js` is rebuilt with `npm run build` and contains the title phrase; the committed `dist/` matches a fresh build (`npm run build && git diff --exit-code -- dist/` after the rebuilt bundle is committed).

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/prompts/templates/spec.md` | Add the term-renames bullet after the refactor correctness-audit bullet |
| `src/orchestrator/prompts/templates/spec-revision.md` | Add the identical bullet at the same position |
| `tests/run-task-prompts.test.ts` | New parity test (AC-3) |
| `tests/run-task-prompts.golden.json` | Regenerated for the four spec-prompt keys |
| `dist/orchestrator/run-task.js` | Rebuilt bundle carrying both templates |

### Interaction Dependencies

`promptSpec` and `promptSpecRevision` in `src/orchestrator/prompts/index.ts` are the only builders that render these templates; they serve full and fast tier, single tasks and bundles. Both templates are internal (not in `CANON_OWNED`) and not mirrored under `templates/`, so `sync-templates` is unaffected. The bullet reaches adopter pipelines through the bundled prompt, so its text must make sense in an arbitrary repo; it names no canon-ai path.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`
- [ ] `<E2E>`

## Docs Impact

None. No protected doc describes the rules-of-thumb list's contents, and no docs-freshness mapping matches `src/orchestrator/prompts/`.

## Known Risks

- **Golden churn beyond the four keys.** If the regeneration rewrites other entries, something else in the tree changed rendering; AC-2 makes that a visible failure rather than a silent fixture update.
- **Prompt length.** The bullet adds roughly 150 words to every spec and spec-revision prompt. Accepted; the condensed wording is the mitigation.
- **Adopter readability.** The text must not cite a canon-ai-only path or concept; the wording in *Decision* uses only generic terms (prose files, historical docs, test fixtures).

## Human Test Plan

1. Start a new spec in the pipeline for a task that renames a term used across the codebase.
2. Read the prompt the spec session received (or the spec it produced).
3. Expected: the spec-writing guidance includes the rule about gating renames per string family, and a rename spec's grep ACs are organised by string family rather than as a hand-listed set of hits.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row, each with a specific change description.
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] If this spec replaces existing behavior: N/A — additive
- [x] Non-Goals rules out the most tempting scope expansions; backed by AC-4
- [x] Symbols named in ACs actually exist in the codebase (grep-verified: `promptSpec`, `promptSpecRevision`, golden keys, `UPDATE_GOLDENS`)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A — feature
