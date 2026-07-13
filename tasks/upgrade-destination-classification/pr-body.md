## Summary

- `canon upgrade` no longer silently overwrites a file at a canon-managed path that git can't restore afterward. Previously, an untracked (or gitignored) file at a managed target was treated as "clean" and clobbered outright, and if the underlying `git status` probe itself failed, the tool fell back to writing everything. It now classifies every write target — absent, byte-identical, tracked-and-clean, tracked-and-modified, untracked-but-present, or git-unverifiable — and only writes where the content is actually recoverable.
- Untracked-but-present, gitignored-but-present, and git-unverifiable destinations now refuse (unless `--force`), joining the existing tracked-and-modified refusal. Absent targets and byte-identical content are unaffected, so fresh scaffolds and no-op re-runs still work even when git can't be consulted.
- `--check` runs the identical classifier, so its preview can't drift from what a real run enforces. `--force` now covers all three refusal classes but still can't force through a malformed `.gitignore` canon block.
- Fixes #187.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

- **Behavior change on a routine command**: a tree scaffolded by `canon init` and never committed will now refuse a subsequent non-identical `canon upgrade` until the adopter commits or passes `--force`. That's the point of the fix — that content was never git-restorable in the first place — but it's worth flagging since it changes what `canon upgrade` does out of the box.
- One subtlety I want reviewers to know about: `scripts/docs-refs-config.mjs` keeps its existing "fully adopter-owned once present" behavior for tracked-clean content — I didn't route that case through the new refusal gate, since doing so on a literal reading of the AC would have silently overwritten committed adopter customizations to that file, which is the exact class of bug this PR is fixing (just for a different file). Absent/deleted/untracked/unverifiable states for that file do go through the shared gate.
- Caught a real bug in my own first pass during code review: a `git rm`'d (staged-deleted) tracked file was falling through to "absent" and getting silently recreated, because the classifier checked trackedness before it checked git's dirty status. Fixed by checking dirty/status first — both a working-tree `rm` and a staged `git rm` of a tracked file now correctly refuse.
- Every scenario in the spec's human test plan (untracked refuses, `--check` matches, `--force` overrides, unverifiable-git refuses, absent-in-non-git-dir still scaffolds) has automated fixture coverage in `tests/cli.test.ts`; still worth a manual pass before merge since this touches a data-safety boundary.
- `dist/cli/index.js` is included since it's the published bin and this touches `src/cli/commands/upgrade.ts`.
