# Completion Summary: claude-provider-mode — Claude-only provider mode

> For the human. This is what you need to know.

## What Changed

canon can now run its whole pipeline on Claude alone. Setting `CANON_PROVIDER=claude` gives every role to Claude, so the Codex CLI is not required, and `canon doctor` and `canon init` check only for `git` and `claude`. Each task pins its provider when it is created (`provider` in `status.json`), so a task keeps its provider across runs; tasks without a pin stay on the existing mixed Codex/Claude routing. `canon task set <id> provider claude|mixed` switches a task and clears any stored session that belongs to the other backend. Mixed-provider bundles are refused before any agent starts. Setting `codex` as the provider is refused, because Codex-only mode is not supported yet.

On Claude-provider tasks, a failed implement or spec-review run (budget, stall, or non-zero exit) keeps its session, so the next `canon run` resumes the unfinished work instead of starting over. Claude-provider code review runs two Claude reviewers (anchored and spec-blind) and no Codex cold review; the per-round record is still written so delta review works. Claude spec-review and implement get their own model, effort and budget defaults. Mixed-mode behavior, argv, prompts and goldens are unchanged.

## Files Changed

Source:
- `src/lib/pipeline-policy.ts` — provider type and parser, mixed and Claude role assignments, Claude spec-review and implement cells, pins and budgets.
- `src/orchestrator/policy.ts` — lazy `CANON_PROVIDER` resolution, task and bundle pin validation.
- `src/orchestrator/agents/backend.ts` — backend lookup requires an explicit role assignment.
- `src/orchestrator/agents/claude.ts` — Claude config for both new phases; per-attempt session capture; honors `wrapForResume` on both delivery paths; unattended completion sentence for implementer and spec-reviewer.
- `src/orchestrator/agents/errors.ts` — `AgentSessionError` carries an optional session id.
- `src/orchestrator/types.ts` — optional `provider` and backend-tag fields in `status.json`.
- `src/orchestrator/state.ts` — tagged session writes, paired clears, use-time compatibility check, provider-switch clearing.
- `src/orchestrator/main.ts` — provider pinned once per run, bundle refusal, dependency and recovery routing, session storage on Claude park, role-holder text in messages.
- `src/orchestrator/phases/spec.ts`, `plan.ts`, `qa.ts` — backend lookup with the run's assignment.
- `src/orchestrator/phases/spec-review.ts` — role routing; revised-spec preamble only after a prior changes-requested round on Claude tasks.
- `src/orchestrator/phases/implement.ts` — role routing; park-resume prompt selection; role-aware no-diff warnings.
- `src/orchestrator/phases/code-review.ts` — skips the orchestrator cold lens in Claude mode; always writes the numbered round record; removes a stale `review-cold-codex.md`.
- `src/orchestrator/prompts/index.ts`, `prompts/helpers.ts` — role-holder names, provider-aware startup text, park-resume prompt, two-lens foreman rendering.
- `src/orchestrator/prompts/templates/` — `spec-review.md`, `spec-review-reroute.md`, `plan.md`, `plan-reroute.md`, `qa.md`, `code-review-foreman.md` (mixed synthesis and two-Claude-lens synthesis).
- `src/task/index.ts` — provider stamped at task creation; `provider` settable with value checks; `session_backends` refused.
- `src/cli/deps.ts`, `src/cli/commands/doctor.ts` — required binaries computed from the selected provider; Codex trust check skipped under Claude.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt.

Tests and docs:
- `tests/pipeline-policy.test.ts`, `tests/agent-backend.test.ts`, `tests/task-cli.test.ts`, `tests/completion.test.ts`, `tests/completion.golden.json`, `tests/run-task-safety.test.ts`, `tests/run-task-validation.test.ts`, `tests/run-task-code-review.test.ts`, `tests/recovery-hints.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` (two new Claude entries; the 23 existing values unchanged), `tests/cli.test.ts`.
- `docs/decisions.md`, `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, `docs/codebase-map.md`, `docs/architecture.md`.
- QA edit: `docs/codebase-map.md` — the startup-constants row now says `CODEX_STARTUP` is not used for Claude-held implementer and spec-reviewer prompts.

## How to Test

1. In a project with only Claude Code installed, set `CANON_PROVIDER=claude` and run `canon doctor`. Expected: it passes without asking for Codex and says the provider came from `CANON_PROVIDER`.
2. With `CANON_PROVIDER=claude`, create a small task and run it through the pipeline. Expected: every phase runs on Claude, the run log never names Codex as the worker, code review finishes without a Codex review step, and the task reaches human review.
3. In a project with both tools, start a task in the default mode, stop it partway through implementation, switch it with `canon task set <id> provider claude`, and run it again. Expected: the switch prints which sessions it dropped, and a fresh Claude session continues the work.
4. On a Claude-provider task, run implementation with a very low `CLAUDE_BUDGET`. Expected: the run stops with a budget message. After raising the budget and re-running, implementation resumes the unfinished work and does not claim it is already complete.
5. Run a normal task in the default mode. Expected: nothing looks or behaves differently from before.

## Test Results

Results are from the latest `### Re-run validation` table in `tasks/claude-provider-mode/handoff.md` (iteration 2). QA did not re-run the full suite; QA re-ran `npm run docs-refs-check` after its one docs edit and it passed.

| Check | Result | Notes |
|---|---|---|
| Lint (`npm run lint`) | Pass | Current source and regression tests. |
| Type-check (`npm run type-check`) | Pass | Required assignment parameters compile. |
| Unit tests (`npm test`) | Pass | 1,840 tests: 1,839 passed, 1 skipped, 0 failed. Run with `CANON_PROVIDER=claude`, `CLAUDE_MODEL_SPEC_REVIEW` and `CLAUDE_MODEL_IMPLEMENT` exported. The handoff does not name the skipped test; see Open Questions. |
| Scoped backend, prompt and recovery tests | Pass | 81 + 9 tests, including the 15-site argv parity test and the 23 original prompt goldens. |
| Build (`npm run build`) | Pass | Both declared `dist/` artifacts rebuilt; `dist/` changes are on the branch. |
| docs-refs-check (`npm run docs-refs-check`) | Pass | Re-run by QA after the `docs/codebase-map.md` edit. |
| sync-templates:check (`npm run sync-templates:check`) | Pass | Managed root and mirror agree (handoff). |
| E2E | deferred_by_spec | spec.md "Validation Required" marks E2E N/A: there is no UI surface. |

## Human Verification Required

None.

Handoff Validation pre-merge checklist (items QA cannot confirm stay open):
- [ ] Version correct (per project policy; the release step decides the bump, not QA)
- [ ] Changelog updated if needed (per project policy; the release step, not QA)
- [x] PR body current (`tasks/claude-provider-mode/pr-body.md`, written this QA pass)
- [ ] Final CI/CD checks green (not checked from QA)
- [ ] Final diff matches spec intent (code review approved with nits; the spec's live Claude test plan has not been run)

## Proposed Changelog

### Added

- **Claude-only provider mode.** Set `CANON_PROVIDER=claude` and canon runs every phase on the Claude CLI. Codex is not required, and `canon doctor` and `canon init` check only for `git` and `claude`. Each task pins its provider when it is created; `canon task set <id> provider claude|mixed` switches a task and clears any session the other backend holds. Mixed-provider bundles are refused before any phase runs. `codex` is refused as a provider for now, since Codex-only mode is not supported yet.
- **Claude sessions survive a park.** On Claude-provider tasks, an implement or spec-review run that fails (budget, stall, or exit error) keeps its session, so the next `canon run` resumes the unfinished work instead of starting over.
- **Claude-only code review.** Claude-provider tasks run an anchored and a spec-blind Claude reviewer in place of the Codex cold review. Delta review still works across rounds.

### Changed

- **Claude defaults for spec review and implement.** Claude-provider spec review and implement use Sonnet for extra-small and small tasks and Opus from medium up, with per-phase budgets for each size. `CLAUDE_BUDGET` still overrides both. Mixed-provider tasks are unaffected.

## Decisions Made

- **Switch clearing compares recorded backends.** `canon task set ... provider` clears each stored session whose recorded backend differs from the new assignment's backend for that role. The spec words this as old versus new assignment; comparing recorded backends gives the same result for every state canon writes and still works when a stored pin is invalid (handoff Blockers, `[ambiguity]`).
- **Revised-spec preamble.** On Claude-provider tasks, the "spec has been revised since your last review" preamble shows only after a prior changes-requested round. Mixed tasks keep the old rule, because changing it would alter mixed-mode prompts (`[plan]` note 3; AC-14).
- **Fix-ups and reroutes keep their own prompts.** Reroutes keep the Claude implementer startup. Artifact fix-ups keep their purpose-built prompt and no-commit instruction (handoff iteration 2).
- **Unattended completion rule goes at the backend.** The "always end by writing the artifact and running the phase command, even with Blockers" sentence is added only on unattended Claude calls for implementer and spec-reviewer roles, so interactive sessions get no false headless instructions (review Round 1 finding 2).
- **Provider is read once per run.** `canon run` reads each task's pin at start. A `canon task set ... provider` during a run takes effect on the next run (spec §3).
- **Dependency checks follow the setting.** `canon doctor` and `canon init` read `CANON_PROVIDER`, not task pins, and doctor says so. Because they now load the policy module, an existing malformed `MAX_REVIEW_LOOPS` warning also appears from them (`[plan]` note 6).
- **Check ordering.** `canon run` checks that each task's `status.json` exists and resolves its provider before the agent-binary check, so a missing status file is reported before a missing binary (`[plan]` note 5).

## Open Questions

- **Live Claude runs are not done.** The spec's Human Test Plan items 1–4 need a real Claude subscription and budget exhaustion. The tests use fake executables. Real budget-park and resume behavior is unverified.
- **Skipped test.** The full run reports 1 skipped test, and the handoff does not name it. The environment-gated candidate is the `.git/`-writes test at `tests/run-task-safety.test.ts:3590`. Confirm it runs in CI, since a skip is unverified rather than passing.
- **Implement budget curve ($10–$60) is a guess.** Calibrate from the first Claude-mode runs.
- **Claude commit ownership is prompt-only.** A Claude implementer runs unsandboxed and could commit (spec Known Risks). No detection was added.
- **Optional review nits left open** (review Round 2 "Approved with nits"): `--ship` and `--dry-run` refuse a task with an invalid pin; the park-resume prompt pastes the raw escalation reason; the spec Known Risk "Resuming a confused session" says the no-diff guard catches a park-resumed session, but the guard runs only on revision; `session_backends` is left as `{}` after clears; the decisions entry restates the implement budgets inline, which can drift; a stray blank line in `src/orchestrator/phases/code-review.ts`.
- **Codex wording sweep** (README, skills, `.canon/templates/*`, CLI help) is deferred to the follow-up task, per the spec's Non-Goals.
- **Version and changelog** are for the release step to decide. This draft does not propose a version.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 1
- Validation gaps: 0
- Notes: Code review round 1 found two bugs on the new Claude-only prompt and backend paths that no mixed caller exercises (ignored `wrapForResume`; unconditional headless block); both fixed in round 2 with tests, and AC-12 was Partial until then.

Maintenance: lessons-learned.md plus this task’s fragment have 22 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
