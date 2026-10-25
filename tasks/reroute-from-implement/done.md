# Completion Summary: reroute-from-implement — Allow --reroute once implementation has begun

> For the human. This is what you need to know.

## What Changed

`canon run <id> --reroute` used to refuse any task whose current phase was `implement`. That blocked the cases where the spec turns out to be wrong mid-implementation: a stopped or crashed implement run, an implement phase that is blocked, a code review sent back to implement, and a code review that hit its loop cap. The only workarounds were hand-editing `status.json` or running `reset-code-review`, which discards the review evidence.

Reroute now admits a task once implementation has begun. A task at `implement` is admitted when implement is `in_progress` or `blocked`, when code review is `blocked`, or when code review already ran in the current loop (a review round or a pre-flight rejection). A task at `implement` with no review activity in the current loop is still refused: no implementation round has started, so the change is really a spec or plan revision. Legacy statuses that carry only the old `iterations` counter fall back to it for the review-round count; an explicit current-loop value never falls back.

A bundle may also include an approved implement-pending sibling with zero counters, but only alongside a task that qualifies on its own and only when both share the same non-empty recorded task branch. This covers a route-back where code review approved one bundle member and sent the other back: the approved member's counters were zeroed, so it carried no evidence of its own.

One shared predicate now decides admission for both the reroute gate and the spec-gate advice. The banner and rejection message name implement's and code review's status, so an operator can see why one task was admitted and another refused. The loop-cap message now also names amending the spec and running `--reroute`, alongside the `reset-code-review` path. The reroute prompts no longer assume the prior implementation round finished: they treat it as complete or partial, cover unfinished original acceptance criteria and earlier amendment rounds, ground the work in the worktree diff, and use `handoff.md` only when it has been filled in.

## Files Changed

Product code (27 files cumulative, per the handoff's Changes tables):

- `src/orchestrator/state.ts` — shared admission predicate and review-round reader
- `src/orchestrator/main.ts` — gate uses the predicate; shared-branch sibling clause; banner and rejection name the sub-state and rule
- `src/task/index.ts` — spec-gate note uses the predicate; "will not fire" text updated
- `src/orchestrator/review-loop.ts` — loop-cap reason names the amend-and-`--reroute` path
- `src/orchestrator/cli.ts` — `canon run --help` reroute text
- `src/orchestrator/context.ts` — reroute state header wording
- `src/orchestrator/prompts/index.ts` — reroute banners, preambles (resumed and non-resumed), archive pointer for non-exempt tasks
- `src/orchestrator/prompts/templates/implement-reroute.md` — partial-round scope, worktree grounding, leftover handling, red-first isolation, dirty-file handoff coverage
- `src/orchestrator/prompts/templates/plan-reroute.md` — partial-round scope; delta-only instruction removed
- `src/orchestrator/prompts/templates/spec-review-reroute.md` — phase-neutral framing
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles

Tests and fixtures:

- `tests/run-task-reroute-preflight.test.ts` — admission matrix, predicate boundaries, bundle cases, reset and banner assertions
- `tests/run-task-code-review.test.ts` — loop-cap recovery text
- `tests/task-cli.test.ts` — spec-gate note cases
- `tests/recovery-hints.test.ts` — registry entries; chained implement-entry loop-cap recovery test
- `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` — resumed implement-reroute golden; archive-pointer cases

Docs and mirrors:

- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` — flags row, Human Reroute sections, shared-branch rule, loop-cap recovery by phase
- `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` — admission sentence
- `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` — loop-cap paths per block type
- `docs/patterns.md` — aborted-round source edits remain dirty after an implement-entry reroute
- `docs/decisions.md` — decision reversing the predecessor's "No reroute from implement" Non-Goal
- `README.md` — flags prose and command-reference row

## How to Test

1. Stop a run partway through implementation, add an `## Amendment` section to the spec, and run `canon run <id> --reroute`. Expected: accepted. The banner says implement is in progress. A full-tier task goes back to spec review; a fast-tier task goes straight to implement.
2. Let a task's code review hit its loop limit so it blocks. Read the block message: it names amending the spec and rerouting, as well as the `reset-code-review` path. Add an amendment and reroute. Expected: accepted, and the banner mentions the blocked code review.
3. Step a task through one code review that requests changes, and stop before it re-implements. Add an amendment and reroute. Expected: accepted.
4. Take a task that has a plan but has not started implementing, and try to reroute. Expected: refused. The message shows the task's state and says reroute needs implementation to have begun.
5. Bundle case: reroute a bundle that contains one approved member and one sent-back member on the same branch, naming both tasks. Expected: accepted. Naming only the sent-back member is refused, and the message tells you to name the whole bundle.
6. Run `canon run --help`. Expected: the reroute text lists the states it accepts, including the review and pre-flight qualifier.

## Test Results

Results below come from the handoff's validation tables and the code-review artifacts. QA did not re-run any check in this pass.

| Check | Result |
|---|---|
| `npm run lint` | Pass (handoff, after revision) |
| `npm run type-check` | Pass (handoff, after revision) |
| `npm test` | Pass (handoff round 2): 1720 tests, 1719 pass, 1 skipped, 0 failures. This run came before the last prompt-only revision; that revision re-ran the prompt suite (62/62), not the full suite. The code-review foreman's own run reports 1722 pass, 0 skipped. The two counts differ and were not reconciled. |
| Skipped test | 1 skipped in the full run. The handoff and notes attribute it to a worktree-gated `.git/` write test in `tests/run-task-safety.test.ts`. That attribution is inferred, not confirmed. |
| `npm run build` | Pass; second build byte-identical (handoff) |
| `npm run sync-templates:check` | Pass (handoff, after revision) |
| `npm run docs-refs-check` | Pass (handoff, after revision) |
| Prompt golden regeneration and comparison | Pass. Against the pre-task base `d6c00c3`, only `promptImplementReroute`, `promptImplementReroute_resumed`, and the reroute spec-review and plan keys changed; no keys were added or removed beyond the resumed variant. |
| Red-first evidence | Recorded in the handoff for AC-1 (loop-cap and route-back, `d6c00c3`), AC-A6 (legacy counter, `f17a1d5`), AC-B4 (archive pointers, `80b7023`), and AC-B1 (shared-branch admit, `80b7023`). Each showed the expected failure before the fix. The F1 prompt-ordering fix has its own red run at `531de25`. |
| E2E | N/A — no UI surface (spec Validation Required) |

Two `--ship` tests in `tests/run-task-ship.test.ts` failed once under load in a code-review run and passed in isolation. Not yet checked against `main`.

## Human Verification Required

None.

The latest validation tables in `tasks/reroute-from-implement/handoff.md` have no `human_pending` rows. The spec's Human Test Plan above is manual confirmation, not a pending check.

Pre-merge checklist (not confirmable from QA):
- [ ] Version correct — the release step decides; QA does not propose one
- [ ] Changelog updated — the proposed entry below is not yet applied
- [x] PR body current — `tasks/reroute-from-implement/pr-body.md` rewritten in this QA pass
- [ ] Final CI/CD checks green — no PR exists yet
- [x] Final diff matches spec intent — code review verdict is approved with nits; Stage 1 passes on all acceptance criteria

## Proposed Changelog

- **`canon run --reroute` works once implementation has begun.** A task can now be rerouted while its implement phase is in progress or blocked, while its code review is blocked at the loop limit, or after a code review round or pre-flight rejection in the current loop. Tasks in those states were refused before. A task at implement with no review activity is still refused. A bundle may include an approved sibling on the same task branch alongside a qualifying task. The reroute prompts treat the prior round as possibly partial and pick up unfinished original work along with the amendment. The loop-cap message names the amend-and-reroute path.

## Decisions Made

- Implement `in_progress` or `blocked` is admitted without requiring a crash. A first pass that fails on an auth or quota error can therefore use up a reroute round. The spec names this as intended.
- Review-round count: the admission predicate and banner read `iterations_current_loop`, falling back to the legacy `iterations` only when the current-loop field is absent. Explicit zero or invalid current-loop values do not fall back. One exported helper does this for every production reader.
- Shared-branch sibling (amendment round 2): an implement-pending task with zero counters is admitted only alongside a task that qualifies on its own, and only when both carry the same non-empty `status.json.branch`. Declined alternatives: writing a marker on the approved member at route-back (it would change counter semantics), and admitting a sibling on branch evidence alone (an unstarted task could ride along).
- Mixed bundles: a bundle that mixes a spec_gap-blocked task with an implement-entry task loses the spec_gap exemption, so each task needs its own Amendment section. The spec pins this.
- Non-exempt implement and plan prompts name the highest-numbered archived review and say its unresolved findings stay binding unless the amendment supersedes them. When no archive exists, they say nothing about one.

## Open Questions

Nothing blocks the change. These are follow-ups for the human.

- **Partial shared-branch reroute is not blocked.** Admission checks only the named tasks. A run that names just the sent-back member can reset it before the downstream handoff and scope gates reject the run. The docs say to name the whole bundle, but nothing enforces it. Code review recommended a follow-up gate; enforcing it needs its own design.
- **Archived findings are named, not opened.** Cold-Codex review at `b46d23c` (`tasks/reroute-from-implement/review-cold-codex-run-4.md`) rated this P2: the implement and plan reroute prompts name `review-prior-<n>.md` but never tell the agent to read it, so it can miss unresolved findings. I confirmed by reading the templates and `src/orchestrator/prompts/index.ts` that no instruction directs opening the archive. The foreman's review ranked it non-blocking (N9/N4). Decide whether to add an explicit read step before merge or as a follow-up.
- **"Approved sibling" wording is narrower than the code.** Docs, help, and the rejection message say "approved sibling". The predicate does not check the verdict: any implement-pending, zero-activity task on the anchor's branch qualifies. The rejection also lists sibling-clause tasks under "Qualifying:". Code review suggested renaming these in a follow-up.
- **Test-count discrepancy.** The handoff reports 1720 tests with 1 skipped; the code-review run reports 1722 with none skipped. Neither was reconciled.
- **Skipped test is unverified.** The skip is inferred to be a worktree-gated `.git/` write test. It was not confirmed to run elsewhere.
- **`--ship` flakes.** Two `tests/run-task-ship.test.ts` failures under load are unconfirmed on `main`.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 1
- Notes: one worktree-gated `.git/` write test in tests/run-task-safety.test.ts was skipped in the handoff run and is unverified; full-suite counts differ between handoff (1720) and code-review (1722) runs; two load-sensitive --ship failures not baseline-checked.
