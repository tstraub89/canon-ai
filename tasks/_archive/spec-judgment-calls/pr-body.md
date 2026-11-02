# PR Body: spec-judgment-calls - Surface judgment calls in specs

## Summary

- Spec template gets a `## Judgment Calls` table after Decision. Each row names the call, the chosen option, the strongest alternative, why it fits, and whether you or the author decided it (`Human` or `Author`).
- Spec-writing guidance (the `canon-spec` skill, the spec and revision prompts) asks the author to list every real judgment call. Grill mode now asks for the runner-up's strongest case and what would flip the call.
- `spec_review` raises a Blocking finding for an unlisted call only when the reviewer can name the call, a defensible alternative the spec does not record, and the AC or behavior that would differ. A missing section alone is not a finding.
- QA lists the `Author` rows in `done.md` and here, so calls you did not explicitly make are visible before merge.
- Canonical definitions are pinned by a parity test in `tests/run-task-prompts.test.ts` across every carrier file. The test was shown to fail when one carrier drops its sentence.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Judgment calls not explicitly confirmed during spec review (the author's leans):
  - QA output goes to `done.md` for every task and to the PR body for single tasks. The alternative was PR body only.
  - Bulk approval of a spec does not confirm `Author` rows. Only an explicit choice makes a row `Human`.
  - A spec without the section that makes a call still draws the Blocking review; the fix is to add the section. The alternative was to skip the check when the section is absent.
  - Code review does not check that the implementation honors each chosen option. The alternative was an anchored-lens check.
  - Amendment (reroute) spec_review is unchanged. The alternative was applying the same check to amendments.
  - There is no parser, lint, or required heading for the section. The alternative was a heading lint at `spec done`.
  - `/canon-spec-review` reports the check at STRONG, while the pipeline reports it as Blocking. The alternative was matching the pipeline.
- Known follow-up: track `spec_review` iteration counts over the next ~10 S+ tasks, and downgrade the check if rounds inflate. Also a `docs/decisions.md` entry for the new Blocking category, which is a human step after merge.
- Manual verification: the spec's seven-step Human Test Plan is not run as part of this PR. It needs a live spec session.
