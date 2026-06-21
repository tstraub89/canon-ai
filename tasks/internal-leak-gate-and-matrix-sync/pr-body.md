## Summary

- Extended the sync-templates leak gate to flag bare backtick references to canon-internal prompt-template basenames (e.g. `` `qa.md` ``, `` `implement.md` ``). Previously only full-path refs starting with `scripts/run-task/` were caught; a bare filename with no path component slipped through. The internal-only set is derived at load time by subtracting `.canon/templates/` basenames from `scripts/run-task/prompts/templates/` basenames — no hand-maintained list that can drift.
- Fixed the live leak: `/canon-changelog`'s release-rules sentence referenced `` `qa.md` ``, an internal file adopters don't have, which would cause `docs-refs-check` failures in upgraded repos. Reframed to reference canon's QA phase instead.
- Added a drift-guard test (`tests/validation-matrix-sync.test.ts`) asserting the Validation Matrix table is byte-identical between `scripts/run-task/prompts/templates/implement.md` and `.canon/templates/spec.md`.
- Added a `docs/decisions.md` entry encoding the "shipped guidance must not reference orchestration internals" rule and pointing at the leak gate as enforcement.

## Validation

- [ ] `npm run lint`
- [ ] `npm run type-check`
- [ ] `npm test`
- [ ] `npm run docs-refs-check`
- [ ] `npm run sync-templates:check`
- [ ] `npm run build` (not required — no `src/` or `scripts/run-task/` changes)

## Notes

The `INTERNAL_ONLY_TEMPLATE_BASENAMES` set is computed at module load time from the real canon checkout (`CANON_AI_ROOT` via `import.meta.url`), not from any test fixture's temp directory. Leak tests only need to supply fixture markdown content — they do not need to create matching template directories in the temp root.

Three colliding names (`spec.md`, `plan.md`, `spec-review.md`) appear in both template directories and are intentionally not flagged — they also refer to shipped task artifacts and `.canon/templates/` files, so bare refs to them in adopter-facing prose are legitimate. Full-path refs to those internal templates remain caught by the existing prefix check regardless.
