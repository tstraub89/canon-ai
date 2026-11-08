## Summary

- Implement and implement-reroute prompts now inject only the pitfalls and lessons that bear on the spec's Affected Files, instead of the whole `## Known Pitfalls` section (about 51 KB in canon-ai).
- Selected entries are injected in full: pitfalls that cite a matching path, Trigger Table sections for matching key files, and lessons that cite a matching path. Everything else is a one-line title, and every index row stays visible as an area index.
- Split pitfall docs work: a Known Pitfalls index row whose path glob matches pulls that doc's matching entries in and points at the doc for the rest.
- The block has a fixed byte cap (about 24 KB) with demotion and truncation counts when it is exceeded.
- `buildKnownPitfalls` is removed. The new selector lives in `src/orchestrator/pitfalls.ts`.
- Docs, the adopter scaffold, the init write guide, and the README describe selection and the full-path citation convention.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (2,144 passed, 1 skipped: the linked-worktree `REPO_ROOT` write test, which this environment cannot run)
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt and committed `dist/orchestrator/run-task.js`)

## Notes

- Pitfall selection depends on full repository paths in pitfall entries. Entries that cite only basenames or symbols are not matched; they still appear as titles.
- The lessons channel ends its "Example" exclusion at the first unfenced `---` or the next H1/H2. The real lessons file places real lessons below `## Example entry`, so a literal reading would select nothing.
- Within the size cap, the largest entries are demoted first, with ties going to later document position.
- Known Pitfalls layouts with no H3 entries contribute no full entries. Only H3s count as entries.
- `npm run sync-templates:check` passes for the managed write-guide mirror and the pipeline guide mirror.
- Judgment calls not explicitly confirmed during spec review:
  - Every Known Pitfalls and Trigger Table row appears in the area index, with matched rows marked. Alternative: list only cross-cutting rows as pointers.
  - Lessons that match nothing are not listed. Alternative: a title index for lessons as well.
  - Bare file-name tokens such as `index.ts` never match. Alternative: match on basename, which would hit unrelated files in any repo.
  - Only the Trigger Table and tables under `## Known Pitfalls` count as index tables. Alternative: every table in `docs/patterns.md`.
  - The byte cap is a fixed constant with no env var. Alternative: a `MAX_PITFALLS_BYTES` override.
  - Tests use a test-only docs-root env override, following the `CANON_PATTERNS_MD_PATH` pattern. Alternative: thread a docs-root parameter through every prompt builder.
  - The scaffold's pitfall format changes to one H3 per pitfall citing full paths. Alternative: keep the blockquote-under-category format, which would make each category one entry.
  - Index tables after the first H3 are treated as entry content. Alternative: a content heuristic, which misclassified explanatory tables in review.
  - Target-cell detection uses header hints first, then a fixed content precedence. Alternative: content-only precedence.
