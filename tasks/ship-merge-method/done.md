# Completion Summary: ship-merge-method — Let --ship merge with the repo's configured method

> For the human. This is what you need to know.

## What Changed

`canon run <id> --ship` used to squash-merge the task PR no matter what the repository allowed. It now merges with the method set in `.canon/config.json` under `ship.merge_method`: `squash` (the default, so nothing changes for existing projects), `rebase`, or `merge`. Before `--ship` changes anything locally, it asks GitHub whether the repo allows that method, but only when there is an open task PR to merge. If the listing of open PRs or the repo's merge settings can't be read, or the method isn't allowed, `--ship` stops with the configured method, the setting name, and the methods the repo allows, and the working tree is untouched. A merge that fails without merging now puts back any telemetry notes `--ship` had set aside before it exits, so those notes are no longer lost. Progress lines, recovery hints, the `--ship` help, and the docs name the configured method instead of "squash". The guard hook now denies every `gh pr merge` strategy on task PRs, and its deny message explains how to set `ship.merge_method`.

## Files Changed

- `src/orchestrator/docs-freshness.ts` — parses and validates `ship.merge_method`, independent of `docs_freshness`.
- `src/orchestrator/main.ts` — fail-closed pre-flight, configured merge flag, restore on failed merge, method-aware messages.
- `src/orchestrator/cli.ts` — `--ship` help text only; no new flag.
- `src/task/index.ts` — `post-merge-sync` wording.
- `.claude/hooks/canon-guard.mjs` and `templates/.claude/hooks/canon-guard.mjs` — PR-merge rule now denies every strategy (squash, rebase, merge commit) per the spec Amendment; deny reason explains `ship.merge_method`.
- `tests/canon-guard.test.ts` — reason-text assertions updated.
- `tests/docs-freshness.test.ts`, `tests/cli.test.ts` — config parsing and doctor cases.
- `tests/run-task-ship-docs-fold.test.ts`, `tests/run-task-ship-proof.test.ts`, `tests/run-task-ship-helpers.ts`, `tests/run-task-safety-helpers.ts` — per-method merge tests, pre-flight and restore tests, fake `gh` extended.
- `.canon/README.md` and `templates/.canon/README.md` — documents `ship.merge_method`.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — merge-strategy note replaced with the setting, pre-flight order, and method-specific behavior.
- `docs/decisions.md` — new entry: squash stays the default; other methods are a config key, not a flag.
- `docs/patterns.md` — historical `--squash` mention marked as historical.
- `docs/architecture.md`, `docs/codebase-map.md` — config description now covers `ship` (QA correction).
- `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-pipeline/recovery.md`, and their `templates/` mirrors — generalized merge wording.
- `README.md` — `--ship` descriptions and a `ship.merge_method` example.
- `dist/orchestrator/run-task.js`, `dist/cli/index.js` — rebuilt.

## How to Test

1. In a repo that allows only squash merges, ship a task with no merge setting. Expected: it merges and cleans up exactly as before.
2. Set `ship.merge_method` to `"rebase"` in a repo that allows rebase merging, then ship a task. Expected: the PR shows as rebased on GitHub, and canon finishes cleanup and archives the task.
3. Set `ship.merge_method` to `"merge"` in a repo that does not allow merge commits, leave an uncommitted telemetry note in the main checkout, and ship. Expected: canon stops before touching anything. It names the setting and the allowed methods, and the note and the current branch are unchanged.
4. Set `ship.merge_method` to an invalid value and run the doctor command. Expected: the config check fails and names the allowed values.
5. Merge a PR on GitHub yourself, then ship. Expected: canon skips the merge and the settings check and completes cleanup.

## Test Results

Recorded by the implementer's run in `tasks/ship-merge-method/handoff.md`. QA did not re-run these checks.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass (2,068 passed, 1 skipped, 0 failed) |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| E2E | deferred_by_spec — Spec: Validation Required, "N/A, no UI surface." |

Red-first: the AC-5 restore test failed on the pre-fix commit (`7c8e694`, backup still present after exit) and passes after the fix.

## Human Verification Required

None.

The five-step Human Test Plan above exercises live GitHub repo settings, which the local fake-`gh` tests do not. It has not been run. It is not a pending validation check, so it is not listed here, but it is the strongest evidence of the real behavior.

## Proposed Changelog

Scope check: the setting, the pre-flight stop, and the restored telemetry notes are all things a user would notice. Proposed entry text only; the version and tier are for the release step.

### Added

- **`ship.merge_method` picks how `--ship` merges a task PR.** Set the key in the repo's `.canon/config.json` to squash (the default), rebase, or merge. Before changing anything locally, `--ship` checks that GitHub allows that method, and it stops and names the allowed methods if the repo does not.

### Fixed

- **A failed merge in `--ship` no longer loses telemetry notes in your main checkout.** The notes `--ship` set aside are put back before the command exits.

## Decisions Made

- Squash stays the default, so repos without the setting behave as before, apart from one new read-only GitHub call before a ship that has an open PR.
- The method is a repo-level config key, not a `canon run` flag. Recorded in `docs/decisions.md`.
- The pre-flight fails closed. An unreadable PR listing or settings query stops `--ship`. A confirmed empty listing (PR merged outside canon) skips the check.
- The implementer moved the existing pushed-branch guard (it runs `git fetch`) to after the read-only pre-flight, so a rejected pre-flight doesn't touch local Git state. Recorded in the handoff's Deviations table.
- Spec verdict history: the first `spec_review` round returned `changes_requested` (one blocking finding, on the unreadable-listing case); round 2 approved.

## Open Questions

- **Hook follow-up (resolved).** After review, the human chose to deny direct `--rebase` and `--merge` as well, recorded in the spec Amendment. The `--ship` open-PR hint now says to merge in the GitHub UI.
- **Rebase-merge history.** Rebase-merge adds several commits per task to base, including canon's artifact commits. Documented in `docs/pipeline-orchestrator.md`; no action taken.
- **Human Test Plan.** Steps 1–5 above are unverified against live GitHub.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: First spec_review round was changes_requested (unreadable gh pr list treated as no-PR); the live GitHub Human Test Plan was not run.

Maintenance: lessons-learned.md plus this task’s fragment have 28 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Pre-merge checklist (not confirmed by QA)

- [ ] Version correct — not decided; the release step sets it.
- [ ] Changelog updated — proposed text above; not landed.
- [x] PR body current — `tasks/ship-merge-method/pr-body.md` written in this QA pass.
- [ ] Final CI/CD checks green — not verified by QA.
- [ ] Final diff matches spec intent — the code review found it matches; QA did not re-diff.
