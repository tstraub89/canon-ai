## Summary

- The `canon-changelog` skill now detects and matches the project's existing CHANGELOG format (title, version headings, category names including emoji headers) instead of imposing canon-ai's bracketed style. Projects like GalleryPlanner that use a different format (`# What's New`, `## vX.Y - unreleased`, `### 🚀 Improvements`) can run the skill unchanged.
- `canon-pipeline` §5 keeps the release-branch flow but frames it as an optional pattern. The hardcoded CHANGELOG format, `auto-release` reference, and `docs/release-process.md` pointers are removed; changelog mechanics defer to `canon-changelog`.
- `AGENTS.md` and `docs/pipeline-orchestrator.md` reconcile four spots that treated changelog/version-bump steps as universal, conditioning them on project policy instead.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [ ] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

No TypeScript or `src/` changes — `npm run build` and `dist/` rebuild do not apply. The `sync-templates` pre-commit hook regenerated all four `templates/` mirrors automatically; `npm run sync-templates:check` confirms they match.

Four implementation iterations total: code review round 1 found that Phase 5 write instructions still used canon-ai's headings instead of the project-detected ones (AC-1/2/4 partial); fixed in Iteration 2. Codex's PR-level review on the merged commit surfaced two further gaps — Phase 3 (Synthesize) silently ignored a present `docs/decisions.md` Versioning policy doc, and the `Let's start vX.Y` init enumeration in §5 read as a universal npm requirement rather than canon-ai's example. A third PR review found that the version-less `## [Unreleased]` greenfield heading dropped the proposed version on finalize. Iterations 3 and 4 addressed those as Amendment rounds, including a full operative-step sweep to close the class rather than iterate per-finding.

No TypeScript or `src/` changes — `npm run build` and `dist/` rebuild do not apply. The `sync-templates` pre-commit hook regenerated all four `templates/` mirrors automatically; `npm run sync-templates:check` confirms they match.

Canon-ai's own bracketed CHANGELOG workflow is unaffected — it continues to work as before, now described as one example among others rather than the mandated form.
