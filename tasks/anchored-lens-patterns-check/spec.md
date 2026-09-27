# Spec: anchored-lens-patterns-check — Anchored code-review lens checks changed code against docs/patterns.md

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

No code_review lens checks a diff against the project's own conventions in `docs/patterns.md`. The foreman's startup line tells the foreman to read `docs/patterns.md`, but sub-agents do not inherit that. `.claude/agents/code-review-anchored.md` names no docs, and the cold lenses are doc-blind by design. The adopter scaffold (`templates/docs/patterns.md`) even says agents "still need this file open for spec authorship and code review", but no reviewer charter acts on it.

Evidence: on GalleryPlanner, 27 of 60 recently merged PRs received Codex PR-bot comments after canon's three-lens code_review approved them. They cluster on project-convention classes a `patterns.md` rule can state: theme tokens instead of hardcoded colors, accessibility (hit targets, focus management), privacy (session replay, identifiers in telemetry), HMR-safe module exports, and task records matching what actually ran. These escaped every review round, so re-running the same lenses doesn't catch them; a lens that reads the conventions would.

## Decision

Add a Stage 2 instruction to the anchored lens charter. If the project keeps `docs/patterns.md`, the lens reads its Trigger Table (or skims the file if there is none) to find the sections relevant to the files the diff changes. It then checks the changed code against those rules and reports each violation. It skips unfilled placeholder content (`TODO[canon]` markers and `_example_` rows). A violation is reported as a `risk/guardrail` finding that quotes or names the rule it breaks, or as a `correctness bug` when it causes incorrect behavior. The lens stays high-recall: it reports and the foreman filters. The instruction applies in every round, scoped to code the diff changes.

## Non-Goals

- No new finding category. Violations use the existing `risk/guardrail` / `correctness bug` categories (AC-2).
- No change to the foreman template, `review.md` template, cold-Claude charter, or cold-Codex invocation (AC-4). The cold lenses stay doc-blind.
- No change to any `docs/patterns.md` content, canon's or the scaffold's.

## Acceptance Criteria

- [ ] AC-1: `.claude/agents/code-review-anchored.md` Stage 2 instructs checking changed code against `docs/patterns.md` when the project keeps one: use the Trigger Table to find relevant sections, skip unfilled `TODO[canon]` placeholder content, and report violations while quoting or naming the rule. Verify: a new test in `tests/run-task-prompts.test.ts` asserts the anchored charter contains `docs/patterns.md`, `Trigger Table`, and `TODO[canon]`.
- [ ] AC-2: The instruction maps violations to the existing categories (`risk/guardrail`, or `correctness bug` when behavior is wrong), and the Return Format's category list is unchanged. Verify: the same test asserts the STAGE_2_FINDINGS category list line is byte-identical to its pre-change text.
- [ ] AC-3: The instruction is conditional on the file existing ("if the project keeps one" or equivalent), so the string makes sense in any adopter repo. Verify: reviewer reads the added text.
- [ ] AC-4: `.claude/agents/code-review-cold.md` does not mention `patterns.md`, and the diff does not touch `src/orchestrator/prompts/templates/code-review-foreman.md` or `.canon/templates/review.md`. Verify: the new test asserts the cold charter does not match `/patterns\.md/`; `git diff --name-only` of the task excludes the two templates.
- [ ] AC-5: `templates/.claude/agents/code-review-anchored.md` is byte-identical to the root file. Verify: `npm run sync-templates:check` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `.claude/agents/code-review-anchored.md` | Add the patterns.md check to Stage 2. |
| `templates/.claude/agents/code-review-anchored.md` | Mirror (sync-templates). |
| `tests/run-task-prompts.test.ts` | New structural test (AC-1, AC-2, AC-4). |

### Interaction Dependencies

The in-flight task `code-review-delta-rerounds` edits the foreman template, the cold charter, and `.canon/templates/review.md`, and is barred from editing the anchored charter. The two tasks touch disjoint files except `tests/run-task-prompts.test.ts`, where both add tests; expect a trivial merge.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- [ ] `npm run build` — N/A: agent files are not bundled into `dist/`
- [ ] E2E — N/A

## Docs Impact

None expected. `docs/product-context.md` and `docs/pipeline-orchestrator.md` describe the anchored lens at a level this does not change.

## Known Risks

- **Review cost:** the anchored lens reads another doc each round. The Trigger Table plus a changed-code-only scope bounds it.
- **Noise:** a large `patterns.md` could produce many low-value convention findings. The foreman already ranks `risk/guardrail`, and the round-3+ discipline keeps these from driving the verdict.
- **Canon-on-canon:** canon-ai's own `patterns.md` is long and orchestration-specific. The anchored lens will now apply it to canon's own tasks too, which is intended.

## Human Test Plan

1. Run a task in a project whose conventions doc says, for example, "use theme colors, never hardcoded colors", with a change that hardcodes a color.
2. Expected: the written code review lists the hardcoded color as a finding that names the convention it breaks.
3. Run a task in a project whose conventions doc is still the unfilled starter version. Expected: no findings about the placeholder examples.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A
