# PR Body: pitfalls-coverage-gaps - Pitfall selection: prose-only Known Pitfalls and directory Affected Files

## Summary

- A `## Known Pitfalls` section with no `###` entries now goes into the implement prompt. Its prose is included in full, minus index tables and blockquotes, under a subsection labeled as included regardless of the task's files. Before, a prose-only section put nothing in the prompt.
- A directory in a spec's Affected Files (for example `src/orchestrator/`) now selects pitfalls, Trigger Table rows, Known Pitfalls index rows, and lessons that cite paths inside it. The matcher is shared, so every channel gets the same rule.
- Sections with `###` entries select exactly as before. Their preamble is not injected.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Red-first: the prose-fallback and directory-match tests fail on the pre-fix commit and pass after the change. `npx tsx --test tests/pitfalls.test.ts` passes 23/23. No golden fixtures were regenerated.
- Blockquotes and index tables are removed from the fallback body. Blockquotes are the scaffold's author guidance, so a fresh project does not get its TODO notes injected into every prompt. A project that writes its pitfalls entirely as blockquotes will still get none injected.
- Judgment calls not explicitly confirmed during spec review:
  - The prose-only fallback is injected in full, unconditionally, instead of as a title line that points at the doc.
  - The fallback applies only when the section has no `###` entries at all. A preamble before the first H3 is still not injected.
  - A glob at the directory's own depth (`src/*` against `src/a/`) does not match. I followed the spec's boundary over the plan's example.
  - Blockquotes are dropped from the prose fallback rather than injected.
  - The fallback renders in its own subsection, not under "cite your files", since that heading would be false for an unconditional entry.
- Follow-ups noted in review, not done here: a list or heading placed directly after a blockquote with no blank line is dropped from the fallback, and two test assertions are loose.
