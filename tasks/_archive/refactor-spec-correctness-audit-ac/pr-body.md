## Summary

- Add a correctness-audit rule for refactor specs: before a spec says "preserve behavior," the author checks whether the behavior being kept is actually correct and records one outcome (correct as-is, fixed on purpose, split into a separate task, or kept as a named quirk). Added to the `/canon-spec` skill, the spec template, and the pipeline's spec and spec-revision prompts, with a refactor-gated builder self-check.
- Add the matching reviewer side: the pipeline spec-review prompt asks for audit evidence on refactor specs and treats a missing audit as Blocking (silent when evidence exists, and a one-line record for behavior confirmed correct is enough), while `/canon-spec-review` gets a tenth check that stays advisory (STRONG, never BLOCKING).
- The author rule, review question, and outcome list are single canonical strings asserted verbatim in every carrier and mirror by one test, so paraphrases can't drift. Features and bug fixes are N/A, using the same author-judgment gate as the bug-fix evidence rule.
- Add structural prompt tests, regenerate the three affected prompt goldens, rebuild `dist/`, and drop the shipped candidate line from the backlog.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (1,334 passed, 1 skipped, 0 failed)
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Prose-only change to guidance and prompts; no runtime logic changes. The only `dist/` diff is the bundled prompt text in `run-task.js`, and two consecutive builds produced an identical bundle.
- The spec-revision golden gets only the shared rule, not the builder self-check line; the test asserts this.
- Manual check: draft a refactor spec and a feature spec, and confirm only the refactor spec shows the audit requirement.
- Code review left a few low-severity test-robustness nits; none affect behavior.
