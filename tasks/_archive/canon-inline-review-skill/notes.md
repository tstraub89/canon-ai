# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `.claude/settings.json` is not in `CANON_OWNED`, and `scripts/sync-canon-templates.mjs` only syncs `CANON_OWNED` + `DELIMITED`, so the spec's `templates/.claude/settings.json` mirror claim is impossible as written.
[spec_review] `tests/cli.test.ts` deep-compares `README.md`'s permission allowlist block to `RECOMMENDED_ALLOW`, so any new skill grant in `doctor.ts` needs a matching README permissions update even if the skill catalog row is the visible feature change.
[implement] README drift tests in `tests/cli.test.ts` had to read `WORKTREE_ROOT` instead of `REPO_ROOT`; in this linked worktree, `REPO_ROOT` pointed at the supervising checkout and missed the edited README.
[implement-reroute] `codex review --uncommitted --sandbox read-only` is not accepted by the installed CLI; `codex exec review --help` is the live source of truth and the wrapper form rejects the extra flag.

