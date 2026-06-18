## Summary

- Added a warn-only `canon doctor` check that surfaces the recommended canon orientation line when neither `CLAUDE.md` nor `AGENTS.md` mentions canon (case-insensitive substring test, never exact-match). The check passes silently when either file mentions canon and never returns `fail`.
- Exported `RECOMMENDED_NUDGE` from `src/cli/commands/doctor.ts` as the single source for the recommended text, mirroring the existing `RECOMMENDED_ALLOW` pattern.
- Added a `Discovery nudge (recommended)` subsection to `README.md` and a drift test in `tests/cli.test.ts` that fails CI if the README text and constant diverge.

This is part of the "canon vacates adopter CLAUDE.md/AGENTS.md" program (Task B). The check is a near-no-op while the managed canon block exists in adopter files; it becomes the backstop once Task C strips the block.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js`; committed)

## Notes

- Canon does not write the nudge into any adopter file — `init`, `upgrade`, and all templates are untouched. The structural guard is AC-6: `git diff main...HEAD -- src/cli/commands/init.ts templates/CLAUDE.md templates/AGENTS.md` is empty.
- The `/canon/i` match accepts "canonical" as a false-pass; this is intentional (under-warning is the safe direction per the spec's Known Risks).
- Two optional test-coverage nits from code review: the "either file → pass" fixture only covers the AGENTS.md path; the neither-file-exists path is also untested. Neither is a correctness gap — deferred.
