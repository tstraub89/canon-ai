## Summary

- Add a Stage 2 instruction to the anchored code-review lens so it checks changed code against the project's own `docs/patterns.md` conventions, when the project keeps one — using the Trigger Table to find relevant sections and skipping unfilled `TODO[canon]` placeholder content.
- Violations report through the existing `risk/guardrail` / `correctness bug` categories; no new finding category, and the cold-Claude/cold-Codex lenses stay doc-blind.
- Add a structural regression test pinning the new charter text, the unchanged Return Format category line, and the cold charter's continued absence of `patterns.md`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` — N/A, agent charter files aren't bundled into `dist/`

## Notes

- Motivated by GalleryPlanner data: 27 of 60 recently merged PRs got Codex PR-bot comments after canon's three-lens code_review had already approved them, clustering on convention classes a patterns doc can state (theme tokens, accessibility, privacy, HMR safety, task-record accuracy). Re-running the same lenses wasn't going to catch these; a lens that actually reads the conventions will.
- Code review flagged two low-severity nits (Trigger Table staleness isn't explicitly handled; the new test pins substrings rather than full instruction semantics) — both checked against spec and left as-is, verdict `approved_with_nits`.
- Diff is intentionally narrow: only the anchored charter, its adopter mirror, and the test file. The foreman template and `review.md` template are untouched by design (a parallel in-flight task owns those).
