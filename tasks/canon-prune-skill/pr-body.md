## Summary

- Adds `/canon-prune`, a human-invoked skill that reviews the project's permanent docs rule by rule and proposes delete, relocate, merge or keep for each rule. Rules stated in more than one place become one merge. Nothing is written until the human approves each row, and nothing is committed.
- The skill drafts a `docs: canon-prune` commit message that records removed and reviewed-and-kept rules. The next run reads that commit and skips kept rules unless their evidence has changed.
- `/canon-sweep` gets one clause: a lesson that was once a permanent rule removed by a prune counts as a prior occurrence.
- The local `docs-audit` skill gets a prune pass over canon-ai's own canon-managed files. It is not shipped to adopters.
- The skill is registered in `CANON_OWNED`, `canon doctor`'s skill check and recommended allowlist, the README, `canon-init`, and canon-ai's `.claude/settings.json`. `dist/` is rebuilt.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- Adopters see `canon doctor` warnings for the missing skill and the two missing allowlist entries. They clear after `canon upgrade` and after adding `Skill(canon-prune)` and `Skill(canon-prune:*)` to `.claude/settings.json`. canon never writes that file.
- The implement-prompt guard is prose that describes what `src/orchestrator/pitfalls.ts` selects. Review found selection paths the prose missed in three rounds. The remaining gaps are recorded as follow-ups and are not fixed in this PR. Each prune row carries a "removes from implement prompts" tag so a reviewer can see what it affects.
- The last two review rounds changed only Markdown. They re-ran `npm run sync-templates:check`, `npm run docs-refs-check`, `npm test` and `git diff --check`. Lint, type-check and build were last run before those rounds.

Judgment calls not explicitly confirmed during spec review:

- I put the workflow in a new skill rather than a mode of `/canon-sweep`. The cadence, the multi-agent shape and the inputs differ.
- The sweep change is one clause. It counts a match only when the removing commit is a `docs: canon-prune` commit or has a `Canon-Prune:` trailer.
- Delete criteria come from the skill's own list, not from canon-sweep's Stage A. A project duplicate is always a merge, never a delete.
- The implement-prompt guard flags every verdict that removes a pitfall-selection source, including pointer rows.
- The cheaper-carrier verdict is named "relocate", because "demote" already means a pitfall dropped by the size cap.
- The lessons buffer stays out of scope; it belongs to `/canon-sweep`.
- Inventory and apply agents run on a light model. Synthesis runs in the invoking session.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
