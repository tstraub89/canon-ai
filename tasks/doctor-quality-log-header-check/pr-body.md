## Summary

- Add a `canon doctor` check that flags a stale or malformed `docs/task-quality-log.md` header before it causes silent data loss. The QA-phase writer that appends a row to that file on every `qa → done` transition has always been fail-soft — a header missing a required column makes it warn and skip the row rather than block the phase — but nothing checked for this proactively. That gap was real: an adopter repo kept a pre-2.4.0 header shape after upgrading, and two tasks lost their quality-log rows with no trace beyond a `console.error` in a detached background run.
- The new check delegates entirely to the writer's own table-detection function (now exported instead of reimplemented), so it can't drift out of sync with what the writer actually requires. A missing file still passes — the writer creates one fresh on first write — and only a malformed header or unreadable file warns, naming the file and pointing at the reference template shape.
- `canon upgrade` is untouched; it still doesn't read or write this file in any mode.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` — `dist/cli/index.js` changed since `doctor.ts` now imports the quality-log module)

## Notes

- `sync-templates:check` and E2E are deferred by spec — no canon-managed template files or UI surface are touched by this change.
- The check follows `doctor`'s existing plain-`cwd` convention rather than the writer's worktree-routed `activeCwd` — it's checking the supervising checkout's health, not any single in-flight task, consistent with every other doctor check.
- Two follow-ups are deliberately out of scope: this check can't help an adopter on an older, not-yet-upgraded canon install, and there's no durable surfacing of skipped-row warnings in `canon status`/`canon watch` after the fact — both noted in the spec's Known Risks rather than filed as blocking work here.
