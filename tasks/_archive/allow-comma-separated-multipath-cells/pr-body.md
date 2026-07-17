## Summary

- Handoff `## Changes` and spec `### Affected Files` table cells now accept a comma-separated list of file paths (backtick paths or markdown links) instead of hard-rejecting any row with more than one path.
- Every extracted path still runs through the existing per-path checks (no wildcards, no placeholders, no absolute paths, no `..` traversal); a bad path among good ones still surfaces the good paths plus a precise error naming the bad one — no silent dropping of paths.
- Structurally ambiguous cells (prose between path references, tokens juxtaposed without a comma, a path reference hidden inside the trailing note, a dangling comma) are still rejected with an actionable message.
- Deleted the now-unused `extractHandoffPath` single-path helper and its tests; updated the handoff template to document the comma-list format as first-class, with a style nudge to group tightly-coupled files (e.g. a canon-managed file plus its `templates/` mirror) on one row.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` since `src/`/`scripts/run-task/` changed)

## Notes

- This closes a recurring source of pipeline friction: combined rows like `` `AGENTS.md`, `CLAUDE.md` `` kept getting bounced with "multiple paths in one cell", requiring a hand-split into separate rows to unblock the pipeline.
- The parser is a real sequential tokenizer, not a `split(',')` — a comma inside a single backtick path (`` `a,b.ts` ``) stays one literal path, and a comma inside the trailing note doesn't create a phantom extra path.
- `docs/BACKLOG.md`'s multi-table design note had three stale single-path phrasings; reworded them without touching the note's still-open core problem (that's a separate, unrelated issue).
- Went through three independent code-review lenses (anchored, cold, and a cross-model cold pass); no correctness bugs or spec gaps came out of it. A couple of cosmetic nits are open but non-blocking — noted in the task's `done.md` if you want to follow up.
