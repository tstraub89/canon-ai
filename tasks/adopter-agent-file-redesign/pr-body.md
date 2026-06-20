## Summary

- Canon stops claiming to generate or read `AGENTS.md` / `CLAUDE.md`; both files are now the output of the tool-native built-in `/init` (Claude Code `/init` → `CLAUDE.md`, Codex init → `AGENTS.md`). README and `/canon-init` now say so explicitly and document the optional `CLAUDE.md = @AGENTS.md` consolidation pattern. All canon docs, skills, and runtime banners that told agents to "read" the agent files or framed them as rule-homes are corrected.
- `canon doctor` gains a second warn branch: when neither agent file exists, it now advises running the built-in `/init` rather than defaulting silently. The existing warn branch (files exist but don't mention canon) is unchanged. Still warn-only; never `fail`.
- canon-ai dogfoods the audience-split: `AGENTS.md` holds the shared overview both agents need (what canon is, npm build/test commands, roles, cross-review norms, commands, conventions, doc-pointer map); `CLAUDE.md` is reduced to `@AGENTS.md` + the four conversational-operator norms Codex has no use for.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (CLI/banner changes in `src/cli/index.ts` and `scripts/run-task/cli.ts` bundled into `dist/`)

## Notes

The AC-1 grep sweep ran over the full tree (`src/`, `scripts/`, `.claude/skills/`, `docs/`, `README.md`, `AGENTS.md`, `CLAUDE.md`, and all `templates/` mirrors). Every surviving reference to `AGENTS.md` / `CLAUDE.md` maps to one of the allow-listed categories: operational code that detects the files (`init.ts`, `doctor.ts`, `docs-refs-check.mjs`), decision records, the README recommendation, test files, "adopter-owned, when present" descriptions, the `@AGENTS.md` import itself, and accurate CI/path-filter descriptions.

`tests/cli.test.ts`'s new root-file split test reads from `WORKTREE_ROOT` rather than `REPO_ROOT` — the linked-worktree run would otherwise read the supervising checkout's stale copy. The audience-split test asserts the four operator norm texts are absent from `AGENTS.md` (not just the retired section heading), so reintroducing a norm into the wrong file trips the test.

Human verification recommended before ship: run `canon doctor` in a fresh repo with no agent files (should warn → advise `/init`), again with a silent `CLAUDE.md` (should warn → advise nudge), and open a fresh Claude session to confirm `@AGENTS.md` import resolves and surfaces the overview + operator norms. Confirm a fresh Codex session sees the shared overview but none of the four operator norms.
