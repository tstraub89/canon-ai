## Summary

- `/canon-prune` now classifies every sentence in text it proposes to delete (superseded, obsolete, or stated elsewhere) and keeps any sentence that still states a live fact. The first real run deleted current guidance this way.
- Implement-prompt guard rows now name each live requirement they drop and the paths that still select it. A requirement with no remaining path becomes its own short pitfall, and rules guarding one failure stay in one H3.
- Before any delete, merge, relocate, or heading rename, the skill searches the repo (archives excluded) for references to the affected heading or claim and retargets them in the same apply step.
- The hand-back says the drafted prune record must be carried into the squash commit or PR body that merges the change, so the next run's `git log --grep` lookup can find it.
- `docs-audit` (canon-ai's local skill) states that its own root docs describe canon, so the "describes a canon mechanism" delete rule does not apply to them. The shipped skill stays adopter-neutral, and its template mirror is synced.
- Removed the stale `taskDirFromRoot()` incident aside from `docs/patterns.md` (the `taskDirFor()` rule stays) and the untracked "Backlogged" list from `docs/decisions.md`.

## Validation

- [ ] `npm run lint` — not run: no source file changed
- [ ] `npm run type-check` — not run: no source file changed
- [x] `npm test` — 2,248 passed, 0 failed, 1 skipped
- [x] `npm run docs-refs-check` — all refs OK
- [ ] `npm run build` (rebuild + commit `dist/` if `src/` changed) — not run: no `src/` change

## Notes

- `npm run sync-templates:check` passes; the shipped skill and its `templates/` mirror match.
- Only the carve-out in `docs-audit` is canon-ai-local. It is not in `CANON_OWNED`, so it is not shipped to adopters.
- The record is only findable by `git log --grep` if the merge commit message contains it. I left the PR-body route in place because the spec allowed it; a stricter rule is still open.

Judgment calls:

- I deleted the "Backlogged" list outright instead of filing its four ideas as backlog items. None has been picked up since June, and a backlog entry is the place to revive one if that changes.
- I chose prose in each guard row (requirement plus remaining paths) over a new `canon` command that diffs pitfall selection. A command would be a new subcommand, which this change does not add.
- I did not add a changelog bullet or bump the version, since `/canon-prune` is still under `[Unreleased]`.
