# PR Body: adopter-bypass-guards - Ship a Claude Code hook that redirects agents away from pipeline bypasses

## Summary

- Adds a canon-managed Claude Code `PreToolUse` guard, `.claude/hooks/canon-guard.mjs`, that refuses three bypass classes with a reason that names the command to use instead:
  - direct edits to `tasks/<id>/status.json` through Edit, Write, MultiEdit, `sed -i`, redirects and `tee`;
  - `canon run` or `canon watch` piped into another command, and `tail -f` or sleep-loop polling of `.canon-run.log`;
  - `gh pr merge` on a `task/*` PR when the merge is a squash or the default. Rebase and merge-commit merges stay allowed.
- `canon init` and `canon upgrade` install the script. Registration is opt-in: canon never writes `.claude/settings.json`. `canon doctor` warns until the hook is registered for `Bash`, `Edit`, `Write` and `MultiEdit`, and the README carries the snippet. `/canon-init` offers the merge with the usual consent.
- Reworded canon's own messages that told agents to edit `status.json` or run `gh pr merge --squash`, so they now name `canon task set`, `canon run <id> --ship`, or ask the human to make the change.
- canon-ai registers the hook in its own `.claude/settings.json`, keeping the existing `SessionStart` entry.
- The shell rules cover Claude Code's Bash tool only. PowerShell sessions get the `status.json` edit rule and nothing else. The README and `docs/decisions.md` say so.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [ ] `npm run build` (rebuild + commit `dist/` if `src/` changed) — last run before the final hook-only edit; rerun before merge

## Notes

- The full `canon doctor` no-warning check is still open. It has to run from the main checkout, which picks up the hook only after this merges. Run `canon doctor` in canon-ai after merge; it should emit no hook warning.
- Accepted false allows are listed in the spec's command-parsing contract, item 9 (for example, `eval` and `python -c`). This is a habit guardrail, not a security boundary.
- Known gap: PowerShell-tool sessions on Windows are not covered by the shell rules.
- Review found two gaps, both fixed: Perl switches that take values (`-M`, `-F`, `-C`, `-D`) were misread as in-place edits, and `gh -R owner/repo pr merge` skipped the merge rule. Both now have allow and deny tests.
