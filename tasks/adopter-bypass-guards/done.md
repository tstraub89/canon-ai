# Completion Summary: adopter-bypass-guards — Ship a Claude Code hook that redirects agents away from pipeline bypasses

> For the human. This is what you need to know.

## What Changed

canon now ships a Claude Code `PreToolUse` guard script that refuses four habits agents keep falling into, and each refusal names the canon command to use instead. It blocks hand edits to a task's status file (`tasks/<id>/status.json`), including through `sed -i`, redirects, and `tee`, in the main checkout and in every task worktree. It blocks piping `canon run` or `canon watch` into another command, and blocks `tail -f` or sleep-loop polling of the run log. It blocks `gh pr merge` on a `task/*` PR when the merge is a squash or the default, and leaves rebase and merge-commit merges alone. Reads, quoted text, heredoc bodies, comments, and other `canon` subcommands all still pass. The hook fails open on any error. `canon init` and `canon upgrade` install the script, but canon never writes your Claude settings: you register it yourself, and `canon doctor` warns until you do. The `/canon-init` skill offers the merge with your consent. Canon's own error and recovery messages that used to say "edit status.json" or "gh pr merge --squash" now name canon commands, so agents are not told to do the thing the hook denies. Canon-ai registers the hook in its own `.claude/settings.json`, keeping the existing `SessionStart` entry.

Coverage is limited to Claude Code's Bash and Edit/Write/MultiEdit tools. Sessions using the PowerShell tool get only the `status.json` file-edit rule, and Codex sessions get nothing. The README and the decision entry say so.

## Files Changed

- `.claude/hooks/canon-guard.mjs` — new guard script: the three rules, fail-open handling, mode-specific deny reasons.
- `templates/.claude/hooks/canon-guard.mjs` — generated adopter mirror of the script.
- `src/lib/canon-owned.ts` — adds the script to the canon-managed set.
- `src/cli/commands/doctor.ts` — exported settings snippet; registration and file-presence warning (never a failure).
- `src/cli/commands/upgrade.ts` — one-line not-registered notice after upgrade.
- `README.md` — hooks section with the snippet and coverage scope; corrected "Current scope" settings claim.
- `.claude/skills/canon-init/SKILL.md` and `templates/.claude/skills/canon-init/SKILL.md` — consent-gated hook merge in the settings phase.
- `.claude/settings.json` — canon-ai registers the guard; `SessionStart` preserved.
- `src/orchestrator/state.ts`, `src/orchestrator/git.ts`, `src/orchestrator/main.ts` — reworded status-edit, bundle `base_branch`, and `--ship` recovery messages.
- `src/orchestrator/detach.ts` — header comment no longer recommends `tail -f` on the run log.
- `src/task/index.ts` — topology-lock and malformed-status errors direct the human to repair the file.
- `src/orchestrator/prompts/templates/spec.md`, `src/orchestrator/prompts/templates/spec-revision.md` — `delicate` line names `canon task set`.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — task-field and worktree wording names canon commands; short guard-hook note under `canon watch`.
- `docs/decisions.md` — new decision entry for canon-managed guard hooks with recommend-only registration.
- `docs/BACKLOG.md` — "NOT porting" clause updated: the pipe guard is ported.
- `docs/codebase-map.md` — hooks row names the guard script.
- `.canon/hooks/README.md` — distinguishes orchestrator shell hooks from the Claude Code guard.
- `tests/canon-guard.test.ts` — new subprocess tests for every rule, the parser contract, fail-open, the snippet no-op, and deny reasons.
- `tests/cli.test.ts` — init/upgrade install, leak-scan list, README drift, doctor and upgrade notices, no-settings-write checks.
- `tests/run-task-prompts.golden.json` — regenerated prompt snapshots.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles.

## How to Test

1. In a fresh test repo, run `canon init`. Expected: `.claude/hooks/canon-guard.mjs` appears and no `.claude/settings.json` is created. `canon doctor` warns that the hook is not registered and prints the snippet.
2. Add the snippet to the project's Claude settings and run `canon doctor` again. Expected: no hook warning.
3. In a Claude Code session in that repo, ask the agent to change a task's size by editing its `status.json` directly. Expected: the edit is refused and the reason names `canon task set`. Asking the agent to *read* the file still works.
4. Ask the agent to start a pipeline run and follow it by piping output into `tail`. Expected: refused, with directions to run `canon run <id>` bare and then `canon watch <id>` without a pipe.
5. On a task with an open PR, ask the agent to squash-merge it with the GitHub CLI. Expected: refused, pointing to `canon run <id> --ship`. A rebase merge of that PR, or a merge of a non-task (release) PR, is not refused.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass (final run after iteration 4) |
| `npm run type-check` | Pass (final run after iteration 4) |
| `npm test` | Pass — 2,041 passed, 1 skipped, 0 failed (2,042 total), iteration 4 |
| Focused guard suite `tests/canon-guard.test.ts` | Pass — 105 passed, 0 failed, iteration 4 |
| `npm run sync-templates:check` | Pass (after iteration 4 mirror sync) |
| `npm run docs-refs-check` | Pass — "All refs OK", iteration 4 |
| `git diff --check` | Pass, iteration 4 |
| `npm run build` | Pass in iteration 3. Not re-run after the iteration 4 edit, which touched only the hook script and its mirror. Rerun before merge. |
| AC-10 zero-match pattern and literal sweeps | Pass — zero matches; remaining prompt hits are mentions or prohibitions, classified in `tasks/adopter-bypass-guards/handoff.md` |
| E2E | deferred_by_spec — `tasks/adopter-bypass-guards/spec.md`, Validation Required: CLI task, no UI |
| `node dist/cli/index.js doctor` (full AC-11 smoke) | human_pending — see below |

## Human Verification Required

- `node dist/cli/index.js doctor` (AC-11 full-doctor smoke): run from the task worktree, `doctor` resolves to the supervising checkout (`src/lib/project-root.ts`), which predates this task, so it reports the hook as missing. `checkGuardHook(process.cwd())` passes against the worktree. After merge, run `canon doctor` in canon-ai and confirm it emits no hook warning.
- Acknowledged: AC-11 full `canon doctor` smoke deferred to post-merge — `doctor` resolves to the supervising checkout, so it cannot see the hook until the task reaches main. The worktree-scoped `checkGuardHook` check passes; the operator runs `canon doctor` on main immediately after `--ship`.

Pre-merge checklist (not confirmable from here):
- [ ] Version correct — release step decides the bump tier (see Proposed Changelog).
- [ ] Changelog updated — pending the release step.
- [ ] PR body current — drafted in `tasks/adopter-bypass-guards/pr-body.md`; confirm before `--pr`.
- [ ] Final CI/CD checks green — not observed from this session.
- [ ] Final diff matches spec intent — spec ACs were reviewed across four code-review rounds; confirm on the diff.

## Proposed Changelog

Scope check: the guard is user-facing (new managed file, new doctor and upgrade output, changed error text agents and humans read), so it qualifies. The bump tier is the release step's call.

### Added

- **A Claude Code guard hook ships with canon, and you opt in to it.** `canon init` installs `.claude/hooks/canon-guard.mjs`, and `canon upgrade` keeps it current. Once you register it in your Claude settings, it refuses four habits: editing a task's `status.json` directly, piping `canon run` or `canon watch` into another command, polling the run log with `tail -f` or a sleep loop, and squash-merging a task PR with `gh pr merge`. Each refusal names the canon command to use instead. Canon never writes your settings file.

### Changed

- **`canon doctor` warns when the guard is installed but not registered for `Bash`, `Edit`, `Write` and `MultiEdit`.** The warning includes the snippet to add. `canon upgrade` prints a one-line pointer to it. Neither command fails.
- **Error and recovery messages no longer tell you to hand-edit `status.json` or run `gh pr merge --squash`.** They name `canon task set`, `canon run <id> --ship`, or ask you to make the edit yourself.

## Decisions Made

- **Status-file rule anchors on the file's own git working tree, not `CANON_WORKTREES_ROOT`.** The hook looks for a `.canon/` directory at the root of the tree that holds the file, so the main checkout, default worktrees, custom worktree roots, and pre-layout worktrees are all covered without the hook reading that variable.
- **Shell rules use a self-contained command parser written to the spec's contract.** It is not ported from the maintainer's private guard. Accepted false allows are listed in the spec (contract item 9).
- **PowerShell sessions are not covered by the shell rules.** The human scoped this out. Only the Edit/Write/MultiEdit `status.json` rule applies there, and the README and decision entry say so.
- **No agent-usable override for the status-file rule.** An env-var bypass cannot reach Edit and Write calls, and would teach agents to prefix it. The human makes those edits.
- **Perl and `gh` flag parsing follow the flags' real grammar.** Value-taking Perl switches (`-M`, `-F`, `-C`, `-D`, and others) stop the in-place scan, so reads with those flags pass and `-pi.bak` is still denied. `gh` repo flags (`-R`, `--repo`) are recognized before `pr` and inside merge arguments. Both were review-found fixes (see Quality Log).
- **Registration stays recommend-only.** `canon init`, `upgrade` and `doctor` never write settings. Only the consent-gated `/canon-init` step does, as it already does for permissions.

## Open Questions

- Round-4 review nits were fixed inline at human_review (Codex-reviewed): the merge-strategy scan now skips flag values (`-t -dr`), treats a squash-mixed cluster (`-sr`) as squash, allows a strategy cluster ending in a value flag (`-rt subject`), and accepts `--rebase=true` / `--merge=true`.
- Windows adopters on the PowerShell tool have no shell-rule coverage. Adding it is a follow-up if they ask.
- The maintainer's user-level guards overlap with this hook. Retiring them is a separate local step, not part of this change.
- Follow-up audit candidates from the spec's Non-Goals (a `--ship` dirty-worktree guard, post-implement spec-edit detection, and others) are not yet filed.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 2
- Validation gaps: 1
- Notes: Round 1 review found AC-2 (Perl in-place scanner denied reads) and AC-4 (gh global `-R` before `pr` skipped the merge rule); the round 2 Perl fix then regressed `-lpi`, caught in round 3.

Maintenance: lessons-learned.md plus this task's fragment have 26 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
