# PR Body: spec-prompts-term-renames-rule - Carry the term-renames rule in the spec phase prompts

## Summary

- Adds the "Codebase-wide term renames: gate per string family, not per enumerated hit" rule to the spec-writing rules of thumb in both `src/orchestrator/prompts/templates/spec.md` and `src/orchestrator/prompts/templates/spec-revision.md`. The skill already had it; the headless spec and spec-revision sessions never saw it.
- The bullet is a condensed paraphrase of the skill text, identical in both templates, placed after the refactor correctness-audit bullet.
- Adds a parity test in `tests/run-task-prompts.test.ts` that pins the title phrase across both skill copies, both prompt templates, and both rendered prompt outputs. It also checks that the full bullet is identical in the two templates.
- Regenerates the four spec-prompt goldens (`promptSpec`, `promptSpecRevision`, and their `withDocsMap` variants). No other golden entry changes.
- Rebuilds `dist/orchestrator/run-task.js`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [ ] `npm run docs-refs-check` — not run for this PR
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- The new test was red on the base commit for the missing prompt-template phrase, then green after the bullet landed.
- I kept the skill's longer text unchanged and pinned only the title in the skill copies. Making the skill and the templates share one sentence would have widened this change for no behavior gain.
- Judgment call: the spec-review prompt and the canon-spec-review checklist do not get a matching question. Only the author and reviser prompts change. If hand-listed rename ACs still pass review, a review-side check is the follow-up.
- Judgment call: the bullet sits after "Refactor specs need a correctness audit" to match the skill's ordering, not directly after "Enumerate every caller".
