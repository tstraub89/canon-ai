## Summary

- `--ship` now stops before merging when a shared telemetry or config doc has an uncommitted file-mode change, or when its mode can't be read. Before this, a `chmod` alone passed the dirty-doc check and was swept into the `chore: archive` commit on base. The abort message names the file and the mode change. Nothing is discarded on this path.
- Per-task `metrics.md` tables created before the Effort column was added now get their header widened when the next row is recorded. Old rows are left byte-for-byte unchanged, and fragments without a table are untouched.
- The header-only merge helper moved to `src/lib/markdown-table.ts` so the orchestrator can use it without importing from the CLI. `canon upgrade` behaves as before.
- The "Shared-doc dirt at `--ship`" paragraph in `docs/pipeline-orchestrator.md` and its template mirror now describes the mode-change abort.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Shipping-path check: a file-mode change on a shared doc is now treated as a blocker, not as dirt to preserve, so the operator has to commit or revert it before `--ship` runs again. This is a deliberate choice; the preserve path re-checks out HEAD, which would drop the mode.
- Judgment calls, not explicitly confirmed during spec review:
  - A mode change plus a pure append also aborts, rather than preserving the append and warning. Preserving would silently discard the mode, so I chose to abort and let the operator resolve it once.
  - If the mode probe fails or its output can't be parsed, every dirty shared doc aborts. Treating an unknown mode as unchanged would reopen the hole this change closes.
  - When both the mode and the content changed, the abort reason names the mode first. The content checks wouldn't reveal the mode problem, so it is the one the operator needs to see.
  - The stale metrics header is widened, but old 9-cell rows are not padded with an empty Effort cell. The skeleton's note already says older rows may have no Effort cell.
