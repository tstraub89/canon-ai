# Implementation Plan: anchored-lens-patterns-check

> Written by: Claude | Implements: `tasks/anchored-lens-patterns-check/spec.md`

## Approach

One charter edit plus a structural test. The instruction goes in Stage 2 of the anchored lens so it runs only after Stage 1 passes, and reuses existing finding categories so no downstream template needs to change.

## Steps

### Step 1: Add the patterns.md check to the anchored charter

Files: `.claude/agents/code-review-anchored.md`

In `## Stage 2 - Code Quality`, after the "Find correctness bugs…" paragraph, add a paragraph: if the project keeps `docs/patterns.md`, use its Trigger Table (or skim the file if it has none) to find the sections relevant to the files this diff changes; check the changed code against those rules; skip unfilled placeholder content (`TODO[canon]` markers and `_example_` rows); report each violation as a `risk/guardrail` finding that quotes or names the rule, or as a `correctness bug` when the violation makes behavior wrong. Keep the Return Format block unchanged.

### Step 2: Sync the mirror

Files: `templates/.claude/agents/code-review-anchored.md`

Run `npm run sync-templates`, then `npm run sync-templates:check`.

### Step 3: Structural test

Files: `tests/run-task-prompts.test.ts`

Add a test next to the existing charter structural assertions (the block that reads `.claude/agents/code-review-anchored.md` via `readRepoFile`):
- the anchored charter matches `/docs\/patterns\.md/`, `/Trigger Table/`, and `/TODO\[canon\]/`;
- the anchored charter still contains the unchanged `STAGE_2_FINDINGS` category line `- [correctness bug | risk/guardrail | optional cleanup/nit | spec gap]`;
- `.claude/agents/code-review-cold.md` does not match `/patterns\.md/`.

## Testing Plan

- **Unit**: the structural test above; full `npm test`.
- **E2E**: N/A.
- **Manual**: `npm run sync-templates:check`, `npm run docs-refs-check`, `npm run lint`, `npm run type-check`.

## Rollback Plan

Revert the charter paragraph and the test. No state or data impact.
