# Implementation Plan: spec-prompts-term-renames-rule

> Written by: Claude | Implements: `tasks/spec-prompts-term-renames-rule/spec.md`

## Approach

Insert the bullet from the spec's *Decision* into both spec-authoring prompt templates, add one parity test, regenerate the goldens, and rebuild `dist/`.

Feasibility check:
- **Exists:** both templates carry `- **Refactor specs need a correctness audit**` immediately followed by `- **UI spatial / gesture tasks**` (`spec.md` lines 26–27, `spec-revision.md` lines 27–28). `promptSpec` (`src/orchestrator/prompts/index.ts:148`) and `promptSpecRevision` (`:190`) render them; the four golden keys exist; `UPDATE_GOLDENS` is handled in `tests/run-task-prompts.test.ts`.
- **Real path:** templates are imported as strings in `src/orchestrator/prompts/index.ts` and bundled into `dist/orchestrator/run-task.js` only.
- **Callers:** N/A — no function behavior or error contract changes.
- **Tests that can fail:** the new parity test reads the templates and the builder outputs; on the base commit neither template contains the title phrase, so assertions (a)–(c) fail.
- **Predicates:** N/A.
- **Scope:** every file below is in Affected Files.
- **Async/stateful:** N/A.

The existing correctness-audit parity test pins only the line *before* the refactor correctness-audit bullet, and no test pins the line after it, so the insertion does not disturb existing assertions.

## Steps

### Step 1: Add the bullet to both templates

Files: `src/orchestrator/prompts/templates/spec.md`, `src/orchestrator/prompts/templates/spec-revision.md`

Insert the exact bullet text from the spec's *Decision* as a new line directly after the `- **Refactor specs need a correctness audit**` line in each file. Copy it once and paste it into both so the two lines are byte-identical.

### Step 2: Parity test

Files: `tests/run-task-prompts.test.ts`

Add a test named "term-renames guidance stays aligned across spec surfaces" next to "judgment-call guidance stays aligned across spec surfaces", reusing its `readRepoFile` shape. Define `const T = 'Codebase-wide term renames: gate per string family, not per enumerated hit';` and assert:
- (a) `T` is present in `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md`, and both prompt templates;
- (b) the line containing `T` in `spec.md` equals the line containing `T` in `spec-revision.md`;
- (c) `promptSpec(baseState)` and `promptSpecRevision(specRevisionState)` both contain `T`.

Run it against the base commit first (before Step 1, or with Step 1 stashed) and record the red run in the handoff.

### Step 3: Regenerate goldens and rebuild

Files: `tests/run-task-prompts.golden.json`, `dist/orchestrator/run-task.js`

Run `UPDATE_GOLDENS=1 npm test`, confirm only the four spec-prompt keys changed and `tests/completion.golden.json` is untouched. Run `npm run build` and confirm the bundle contains `T`.

## Testing Plan

- **Unit**: the new parity test; the full `npm test` suite.
- **E2E**: N/A.
- **Manual**: N/A.

## Rollback Plan

Revert the commit. Prompt text only; no state or data migration.
