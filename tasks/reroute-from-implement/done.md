# Completion Summary: reroute-from-implement — Allow --reroute once implementation has begun

> For the human. This is what you need to know.

## What Changed

`canon run <id> --reroute` used to refuse any task whose current phase was `implement`, which blocked the cases where the spec turns out to be wrong mid-implementation: a stopped or crashed implement run, an implement phase that is blocked, a code review that was sent back to implement, and a code review that hit its loop cap. The only workaround was hand-editing `status.json` or running `reset-code-review`, which discarded the review evidence. Reroute now admits a task once implementation has begun. A task at implement is admitted when implement is in progress or blocked, when code review is blocked, or when code review already ran in the current loop (a review round or a pre-flight rejection). An implement task with no review activity in the current loop is still refused, since no implementation round has started and the request is really a spec or plan change. One shared predicate now decides admission for both the reroute gate and the spec-gate advice. The banner and the rejection message show implement's and code review's status, so an operator can see why one task was admitted and another refused. The loop-cap message now also names amending the spec and running `--reroute`. The reroute prompts no longer assume the prior implementation round finished: they treat it as complete or partial, cover unfinished original acceptance criteria and earlier amendment rounds, and ground the work in the worktree diff.

## Files Changed

- `src/orchestrator/state.ts` — shared admission predicate and counter reader
- `src/orchestrator/main.ts` — gate uses the predicate; banner and rejection name the sub-state and full rule
- `src/task/index.ts` — spec-gate note uses the predicate; "will not fire" text updated
- `src/orchestrator/review-loop.ts` — loop-cap reason names the amend-and-`--reroute` path
- `src/orchestrator/cli.ts` — `--reroute` help text
- `src/orchestrator/context.ts` — reroute state header wording
- `src/orchestrator/prompts/index.ts` — reroute banners, preambles (resumed and non-resumed), handoff grounding
- `src/orchestrator/prompts/templates/implement-reroute.md` — partial-round scope, worktree grounding, dirty-file handoff coverage
- `src/orchestrator/prompts/templates/plan-reroute.md` — partial-round scope; delta-only instruction removed
- `src/orchestrator/prompts/templates/spec-review-reroute.md` — phase-neutral framing
- `tests/run-task-reroute-preflight.test.ts` — admission matrix, predicate boundaries, bundle cases, reset assertions, banner/rejection text
- `tests/run-task-code-review.test.ts` — loop-cap message assertions
- `tests/task-cli.test.ts` — spec-gate note cases
- `tests/recovery-hints.test.ts` — updated snippets, registry entries, chained implement-entry recovery test
- `tests/run-task-prompts.test.ts` and `tests/run-task-prompts.golden.json` — resumed implement-reroute golden added; six existing reroute keys regenerated
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — flags row, Human Reroute sections, uncommitted source-edit note
- `.claude/skills/canon-pipeline/SKILL.md` and `templates/.claude/skills/canon-pipeline/SKILL.md` — admission sentence
- `docs/patterns.md` — aborted-round source edits remain dirty after reroute
- `docs/decisions.md` — decision recording the reversal of the "No reroute from implement" Non-Goal
- `README.md` — flags prose and command-reference row
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles

## How to Test

1. Stop a run partway through implementation, add an `## Amendment` section to the spec, and run `canon run <id> --reroute`. Expected: accepted; the banner says implement is in progress; a full-tier task goes back to spec review, a fast-tier task goes to implement.
2. Let a task's code review hit its loop limit so it blocks. Read the block message: it should mention amending the spec and rerouting as well as the `reset-code-review` path. Add an amendment and reroute. Expected: accepted; the banner mentions the blocked code review.
3. Step a task through one code review that requests changes, and stop before it re-implements. Add an amendment and reroute. Expected: accepted.
4. Take a task that has a plan but has not started implementing, and try to reroute. Expected: refused, with the task's state shown and an explanation that reroute needs implementation to have begun.
5. Run `canon run --help`. Expected: the reroute description lists the full set of states it accepts.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass per handoff: 1686 tests, 1685 pass, 1 skipped, 0 failures. The skip is probably the worktree-gated `.git/` write test in `tests/run-task-safety.test.ts` (inferred, not confirmed). The anchored review lens saw two load-sensitive `--ship` failures on its full run that passed in isolation; not baseline-checked against `main`. |
| `npm run build` | Pass; second build byte-identical |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| E2E | N/A — no UI surface (spec Validation Required) |
| Red-first (AC-1 loop-cap and route-back rows) | Reproduced on base `d6c00c3` before the fix: both rejected at the old phase gate |
| Golden key comparison (AC-10) | Pass — only the resumed implement-reroute key added; six permitted reroute keys changed |

## Human Verification Required

None.

The handoff's Validation Outcomes table has no `human_pending` rows. The spec's Human Test Plan above is manual confirmation, not a pending check.

Pre-merge checklist (not confirmable from QA):
- [ ] Version correct — release step decides; QA does not propose one
- [ ] Changelog updated — the proposed entry below is not yet applied
- [x] PR body current — `tasks/reroute-from-implement/pr-body.md` drafted in this QA pass
- [ ] Final CI/CD checks green — no PR exists yet
- [x] Final diff matches spec intent — code review Stage 1 passed on all 13 ACs

## Proposed Changelog

- **`canon run --reroute` works once implementation has begun.** A task can now be rerouted while its implement phase is in progress or blocked, while its code review is blocked (the loop limit was reached), or after a code review round or pre-flight rejection in the current loop. Those tasks were refused before. A task still at implement with no review activity is still refused. The reroute prompts treat the prior round as possibly partial and pick up unfinished original work along with the amendment. The loop-cap message now names the amend-and-reroute path.

## Decisions Made

- Implement in progress or blocked is admitted unconditionally, not only after a crash. A first pass that failed on an auth or quota error can therefore use up a reroute round. The spec names this case as intended.
- Absent, non-numeric, or non-finite current-loop counters count as zero. The predicate does not fall back to the legacy `iterations` alias that `getIterations()` reads. A pre-migration status with only `iterations` at implement pending is refused. Every current writer sets `iterations_current_loop`.
- A bundle that mixes a spec_gap-blocked task with an implement-entry task loses the spec_gap exemption, so each task needs its own amendment. The spec pins this.
- Predicate-admitted states are tested for both M and XS tiers, including the derived next phase after reroute.

## Open Questions

Nothing blocks the change. These are follow-ups from code review (verdict: approved with nits; no revision round was run in QA):

- **Untracked leftovers from an aborted round.** Auto-commit skips untracked-only files, so an omitted untracked file is caught only at the QA-end check. The prompts already tell the agent to list every dirty file. Consider saying that leftovers the amendment makes obsolete should be deleted.
- **Stale restatements outside this task's file list.** `docs/pipeline-orchestrator.md` (rescope paragraph near line 417) and `.claude/skills/canon-pipeline/recovery.md` (the "Two paths" list) still list only the bump and reset paths for the loop cap. They are incomplete, not contradictory. `recovery.md` is not in the spec's Affected Files, so I left both unchanged.
- **Red-first checkpoint after an implement-entry reroute.** `implement-reroute.md` does not tell the agent how to record Red-First Evidence for an original red-first AC that an aborted first pass left unfinished.
- **Cosmetic nits**, not applied: the `### Delta` label in `plan-reroute.md`; "not a resume of an interrupted session" wording in `src/orchestrator/prompts/index.ts`; a missing "(review round or pre-flight rejection)" qualifier in the `--help` and spec-gate text; banner detail clauses without test pins.
- **Remaining `--ship` test flakes.** Confirm on `main` whether the two `tests/run-task-ship.test.ts` failures seen under load are pre-existing.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 1
- Notes: one worktree-gated `.git/` write test in tests/run-task-safety.test.ts was skipped in the handoff run and likely did not execute; full-suite run also showed two load-sensitive --ship failures not baseline-checked.
