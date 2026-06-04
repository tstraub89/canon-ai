## Summary

- Single-task `--pr` runs now open with a filled PR body instead of the raw template stub. The QA phase drafts `tasks/<id>/pr-body.md` — an outward-facing description of what shipped — and `canon run --pr` uses it when present. Missing or stub bodies fall back gracefully to the previous behavior with a logged explanation.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

- `pr-body.md` is a new canon-managed template artifact scaffolded by `canon task new` and synced by `canon upgrade`; existing tasks without it fall back cleanly to the prior behavior.
- Bundle PRs (`canon run id1 id2 --pr`) are unchanged — they continue using the repo template / `--fill` path. Per-task body synthesis for bundles is deferred.
- `CANON_PR_BODY` env still wins unconditionally; no existing override behavior changes.
- Body-resolution order for single-task runs: `CANON_PR_BODY` → populated `pr-body.md` → repo PR template → `--fill`.
