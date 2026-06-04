## Summary

- Add `pr-body.md` to `EXPECTED_TEMPLATES` in `canon doctor` so a stale install missing the scaffold template gets a warning instead of a silent pass.
- Add a drift-guard test that derives the expected template set from `CANON_OWNED` — a future template addition that misses the doctor list now fails CI immediately.
- Fix `isPrBodyTemplate()` to treat empty and whitespace-only content as unfilled, so a blank `pr-body.md` (from a truncated or partial QA write) falls back to the repo PR template at `--pr` instead of opening a PR with an empty body.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`)

## Notes

Both changes are in the graceful-degradation path of the `qa-drafts-pr-body` feature (1.9.0). Neither touches the core PR-body resolution order or the bundle-mode fallback — only the predicate (`isPrBodyTemplate`) and the doctor template list.

`EXPECTED_TEMPLATES` is now exported so the drift-guard test can import it directly rather than maintaining a parallel copy.
