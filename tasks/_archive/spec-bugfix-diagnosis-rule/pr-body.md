## Summary

- Re-home the bug/flake-fix diagnosis rule onto every surface a spec writer actually reads: the `/canon-spec` skill, the spec template, and both runtime prompts (`spec.md` and `spec-revision.md`). The rule previously existed only in the `spec_review` checkpoint prompt, which fast-tier (S, non-delicate) bug fixes skip entirely — so it reached nobody on that tier.
- The additions are bug/flake-fix-scoped and cover three author obligations: confirm the mechanism in *Problem* (not just assert a cause); include a red-first regression-test AC; use the within-reason escape when the mechanism is environment-bound (the full two-part predicate — "environment-bound AND a faithful repro is impractical" — is required in every occurrence). Feature and refactor authoring is unchanged.
- A spec amendment (driven by code review spec_gap findings) also reframed the `spec_review` reference as a self-enforcing author obligation with an explicit fast-tier callout, so the exact audience most at risk isn't told a reviewer will catch the gap.
- All four `templates/` mirrors regenerated, the `selfCheck` constant in `scripts/run-task/prompts/index.ts` updated, the prompt golden refreshed, and `dist/` rebuilt.

## Validation

- [ ] `npm run lint`
- [ ] `npm run type-check`
- [ ] `npm test`
- [ ] `npm run docs-refs-check`
- [ ] `npm run build` (rebuilt after `scripts/run-task/prompts/` and `index.ts` changes — `dist/scripts/run-task.js` committed)

## Notes

- `npm run sync-templates:check` is the load-bearing check for this task; it verified root↔`templates/` mirror alignment after regeneration.
- The existing `spec_review` reviewer-side rule is unchanged — this task adds the author-side checkpoint the reviewer rule already names, making the two homes concept-linked without path-linking to orchestration internals.
- Code review round 1 found two spec_gaps: (1) the escape predicate used only the impracticality half, silently widening the escape; (2) referencing `spec_review` as the enforcement backstop misleads fast-tier authors. Both drove spec amendments before Iteration 2.
- Cold Codex passes during code review also found that the runtime prompts and the `selfCheck` constant were missing the rule — Amendment Round 2 added those surfaces.
