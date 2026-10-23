# PR Body: red-first-evidence-slot - Red-first evidence section in the handoff, checked by the anchored lens

## Summary

- Adds a Red-First Evidence section to the handoff template, between Blockers and Validation Outcomes. It has one row per red-first AC: the test command, the pre-fix commit it ran against, the observed failure, and the post-fix result. A `[wrong-premise]` blocker is now named next to `[ambiguity]`.
- The three implement prompts name that section and the pre-fix state (the task's base commit for a fresh implement, the branch HEAD before the round's edits for revisions and reroutes). Revisions get a recovery step for missing evidence, and reroutes carry existing rows forward.
- The anchored code-review lens gets a Stage 1 item. A red-first AC with no pre-fix run and no allowed alternative is a Stage 1 gap. Evidence recorded later, against the pre-fix commit, closes it, so a revision round can clear the gap without redoing the fix.
- Guidance only. No orchestrator code reads the new section or the label. The check stays in review, not in the pre-flight gate.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- `dist/orchestrator/run-task.js` is rebuilt; the prompt changes and goldens are in the same commit.
- Mirrors under `templates/` match their roots (`npm run sync-templates:check` passes).
- Known nit, not blocking: the reroute prompt asks the implementer to rewrite `handoff.md` wholesale and also to record new rows in "this round's Iteration subsection." A rewritten handoff may not have one yet. Worth tightening if a real reroute trips on it.
- The charter test checks for keywords separately rather than the late-evidence clause as one phrase, so it would not catch that clause being removed. Left as a follow-up.
