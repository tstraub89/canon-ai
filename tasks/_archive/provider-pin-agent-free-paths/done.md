# Completion Summary: provider-pin-agent-free-paths — Don't let an invalid provider pin block agent-free paths

> For the human. This is what you need to know.

## What Changed

Two commands refused to work over a provider setting they never use. `canon run <id> --ship` now merges and archives a task even when its saved provider value is invalid or when a bundle's task pins disagree, because shipping starts no agent. Every other run mode still refuses those pins at startup with the same message, including `--dry-run` and `--ship --dry-run`. A malformed task status file still refuses cleanly on `--ship`. Separately, `canon doctor` with an invalid `CANON_PROVIDER` no longer runs the Codex checks. The provider line still fails, and the Claude Code check still runs.

## Files Changed

- `src/orchestrator/main.ts` — startup still reads and validates each task's status file for every mode; provider resolution is skipped only for `--ship` without `--dry-run`.
- `src/cli/commands/doctor.ts` — with an invalid setting, required agent checks come from what every supported provider needs, so the Codex binary and project-trust checks drop out.
- `tests/run-task-ship.test.ts` — new ship tests for an invalid pin, a disagreeing bundle, and a malformed status file; fixture helpers accept a provider pin.
- `tests/run-task-safety.test.ts` — new dry-run and ship-dry-run tests for invalid pins.
- `tests/cli.test.ts` — new doctor test for an invalid setting.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — states that `--ship` without `--dry-run` skips provider resolution, and that doctor skips Codex checks on an invalid setting.
- `docs/architecture.md` — `--ship` clause on the `provider` bullet.
- `docs/decisions.md` — `--ship` clause in the per-task provider pins decision.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt output.

## How to Test

1. Take a finished task whose PR is ready to merge, change its saved provider to a made-up value, and ship it. Expected: it merges and archives normally, with no complaint about the provider.
2. On that same kind of task, ask for a dry run instead, with and without the ship option. Expected: it refuses with the invalid-provider message, as before, and nothing is archived.
3. Set the provider environment setting to a made-up value and run the environment check. Expected: the provider line fails, the Claude Code line still appears, and nothing about Codex is listed.
4. Unset the provider setting and run the environment check again. Expected: Codex lines are back, as before.

## Test Results

Recorded in `tasks/provider-pin-agent-free-paths/handoff.md` during implementation. QA did not re-run them.

| Check | Result |
|---|---|
| Lint (`npm run lint`) | Pass |
| Type-check (`npm run type-check`) | Pass |
| Build (`npm run build`) | Pass |
| Unit tests (`npm test`, 1868 tests) | Pass, with one timing flake: `shutdown waits for resistant descendant after leader exit before cleanup` failed once and passed on rerun (37/37 in that pattern run) |
| Template sync (`npm run sync-templates:check`) | Pass |
| Docs refs (`npm run docs-refs-check`) | Pass |
| Red-first AC-1 (ship with invalid pin) | Failed pre-fix with `Invalid provider 'bogus'`; passes post-fix |
| Red-first AC-2 (ship with disagreeing bundle) | Failed pre-fix with the mixed-bundle refusal; passes post-fix |
| Red-first AC-7 (doctor with invalid setting) | Failed pre-fix (Codex lines present); passes after rebuild |

## Human Verification Required

None.

Pre-merge checklist (items QA could not confirm):

- [ ] Version correct — release step decides; no bump in this task
- [ ] Changelog updated — the proposed entry below still needs your approval and the release step
- [x] PR body current — `tasks/provider-pin-agent-free-paths/pr-body.md`
- [ ] Final CI/CD checks green — not checked by QA
- [ ] Final diff matches spec intent — code review (round 1) approved with nits; QA did not re-read the diff

## Proposed Changelog

- **`canon run --ship` no longer refuses a task because its saved provider value is invalid.** Shipping starts no agent, so a hand-edited provider value, or a bundle whose tasks pin different providers, no longer blocks merge and archive. `--dry-run` and `--ship --dry-run` still refuse those pins at startup, and a malformed task status file still refuses cleanly on `--ship`.
- **`canon doctor` with an invalid `CANON_PROVIDER` no longer runs the Codex checks.** The provider line still fails, and the Claude Code check still runs. The Codex binary and Codex project-trust checks are left out, so a machine without Codex no longer gets a second, misleading failure.

## Decisions Made

- `--ship` skips provider resolution only when `--dry-run` is absent. Dry runs keep the startup refusal, because a dry-run preview of an invalid pin should refuse where the real run would.
- The startup status-file read and validation still run for every mode, so `--ship` keeps refusing a malformed status file cleanly instead of with a stack trace.
- Doctor derives the required agent backends from every supported provider rather than hard-coding Claude. Claude Code is the only backend both providers need, so Claude's checks still run.
- Code review nits were left unchanged, as they were non-blocking. One is a naming nit in the `main.ts` gate (`!cliArgs.ship || cliArgs.dryRun` is not the negation of `skipAgentDeps`). Another is a loose `branch` regex in the AC-6 test.
- Implementation deviation: the AC-6 fixture uses `branch: 'bad branch'`, because the status validator does not reject a bad `task_size`.

## Open Questions

- Should the `--ship` skip be named as a helper instead of an inline condition? This is a cleanup, not a blocker. Raise it as a follow-up if you want it.
- Nothing else is open. The changelog wording and version tier are yours at the release step.

Maintenance: lessons-learned.md plus this task's fragment have 26 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Clean run: one spec-review pass, one code-review pass; timing-flake rerun in the full suite only.
