## Summary

- Fix inverted line-citation validation in `docs-refs-check`: backtick refs with a line-citation suffix (`:151`, `:10-20`, `#L10-L20`, `:151,254`, etc.) previously bypassed the missing-file check entirely — adding line numbers made a ref *less* validated. Now the suffix is stripped and the base path is checked normally. Comma-list citations (`:151,254`) that previously triggered false-positive "missing file" errors on legitimate handoff refs also pass correctly when the base file exists.
- Fix silent gitignore-skip disable: a path that causes `git check-ignore --stdin -z` to exit 128 (e.g., one traversing a symlinked directory) previously emptied the entire gitignore set, wrongly reporting every gitignored ref as missing for that run. The batch now uses bisection on exit 128, isolating the unprocessable path without poisoning its siblings.
- Findings preserve the full original ref text including line numbers, so a genuinely missing base path still shows the operator exactly what they wrote.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

- `npm run build` not required: `scripts/docs-refs-check.mjs` runs directly via `node` and is not bundled into `dist/`. No `dist/` delta.
- Both the gitignore-candidate collector and the missing-file check site strip the citation suffix so the gitignore-skip set keys on the same normalized path at both sites.
- `isLineCitationTarget` is unchanged — still gates the symbol-in-file, section `§`, and anchor-link handlers.
- The bisection approach was chosen over token-shape filtering after measuring the actual 128-causers: only outside-repo paths and symlink-traversal paths cause exit 128, not flag-like or whitespace-bearing tokens.
