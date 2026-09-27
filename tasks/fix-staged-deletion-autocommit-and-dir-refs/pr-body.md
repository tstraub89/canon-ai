## Summary

- Fix auto-commit dying with `pathspec '<path>' did not match any files` when a handoff file was already removed with `git rm` or renamed with `git mv` — the removal is committed instead of blocking the run, and the same fix applies to the QA-end and human-review commit steps (#45).
- Fix the implement-phase gate that runs before auto-commit so it also recognizes a staged (not just unstaged) deletion as evidence of work, with `--no-renames` so Git doesn't hide a real deletion behind a coincidentally similar added path.
- Fix `docs-refs-check` reporting an existing directory as a missing file when it's backticked without a trailing slash (#58).

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)
- [x] `npm run sync-templates:check`

## Notes

- All new regression tests use real temporary git repositories (no mocked git), and every one of them was confirmed to fail for the stated reason before the fix and pass after.
- A second bug surfaced mid-review: the auto-commit fix alone wasn't sufficient, because the implement-phase evidence gate in front of it still rejected a staged-deletion-only handoff before auto-commit ever ran. That gate is fixed in the same PR (see the `--diff-filter=D` / `--no-renames` change in `src/orchestrator/main.ts`).
- Left out of scope, filed as follow-ups for later: a gitignored handoff path still reaching a failing `git add -A`; the same staged-deletion issue in the pre-pipeline task-artifact commit (`commitTaskArtifactsToBase`); stale wording in `.canon/templates/handoff.md` that still says a bare directory ref always fails the check; the stage-path filter not NFC-normalizing paths before comparison; the same rename-pairing gap in the committed-range deletion probe; and sparse-checkout awareness (canon has no sparse-checkout support today, so this is theoretical).
