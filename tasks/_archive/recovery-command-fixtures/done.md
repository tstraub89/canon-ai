# Completion Summary: recovery-command-fixtures — Pin every recovery-command hint to a test that runs it from the emitting state

> For the human. This is what you need to know.

## What Changed

canon's recovery messages often tell the operator to run one of four commands next: `--reroute`, `reset-code-review`, `reset-spec-review`, or `canon task accept`. Several of those messages named a command the current state would refuse. The clearest case: after a task's first reroute, the spec_gap fix message told the operator to add a bare `## Amendment` section, but the next `--reroute` requires `## Amendment Round 2`, so following the message exactly made the reroute abort. This task fixes that message in both its saved reason and its console copy, and it also fixes the full-send scope note in the same message, which had the same stale heading. It adds a registry of every source line that names one of the four commands, with each line marked either "actionable" (the operator is told to run it from the current state) or "exempt" (usage text, argv refusal, negative mention, or similar, with a reason). A test fails when a matching line has no registry entry, when an entry's snippet is gone, or when an actionable entry names a covering test that does not exist. The actionable entries now have fixtures that run the printed command from each state that emits it. The existing loop-cap and reviewer-block tests now take the command from the emitted text instead of hard-coding it. Hints that name other `canon` commands are still not covered, and `docs/BACKLOG.md` records that.

## Files Changed

- `tests/recovery-hints.test.ts` — new. Registry, registry self-checks, and chained fixtures for each actionable entry.
- `src/orchestrator/main.ts` — spec_gap fix and scope-note hints now name the heading the next `--reroute` requires, through a shared `rerouteAmendmentHeading` helper.
- `dist/orchestrator/run-task.js` — rebuilt for the hint change. `dist/cli/index.js` was not changed.
- `tests/run-task-safety.test.ts` — loop-cap tests take the reset command from the emitted escalation text and run it.
- `tests/run-task-code-review.test.ts` — reviewer-block test takes the reset command from the emitted text and runs it.
- `docs/BACKLOG.md` — the "Enforce the recovery-message and fail-closed pitfalls mechanically" entry is updated: part (a) records what the registry covers, part (b) stays open.

No `docs/pipeline-orchestrator.md` or `templates/docs/pipeline-orchestrator.md` change was needed. Their rule that round 1 takes a bare `## Amendment` and round 2+ takes `## Amendment Round N` already matches the fixed hint.

## How to Test

1. Run the full test suite (`npm test`). The recovery-hints tests should pass.
2. In the output for those tests, each case shows a halt message, then the command it printed being accepted (or refused, where the scope note's "refused" case is the expected result).
3. Optional tripwire check: add a new line to `src/` that tells the operator to run `--reroute`, without registering it in `tests/recovery-hints.test.ts`. Run the suite. It should fail, naming the new line and saying to register it with a covering test.

## Test Results

These are the results recorded in `tasks/recovery-command-fixtures/handoff.md` (iteration 3, the latest validation table). QA did not re-run them.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 1,574 passed, 0 failed, 1 skipped (the skip is the existing `.git/` write restriction). Before/after `git status --porcelain` identical. |
| `npm run build` | Pass |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| `tests/recovery-hints.test.ts` | Pass — 13 tests |

Red-first evidence (recorded in the handoff):
- AC-4: with the old `## Amendment` hint and the round-sensitive reroute check, the fixture fails because the printed `--reroute` aborts with "expected heading: ## Amendment Round 2". It passes after the fix.
- AC-5 (scope note): the fixture failed on the emitted `## Amendment Round 2` scope instruction, and passed after the change to `## Amendment (full-send scope)`.

## Human Verification Required

None.

Pre-merge checklist (not confirmed by QA):
- [ ] Version correct — the release step decides it, not this task
- [ ] Changelog updated — the release step, after the proposed entry below is finalized
- [x] PR body current — `tasks/recovery-command-fixtures/pr-body.md`
- [ ] Final CI/CD checks green — run on the PR head after `--pr`
- [ ] Final diff matches spec intent — for the reviewer

## Proposed Changelog

- **The spec_gap halt's fix hint names the amendment heading the next `--reroute` requires.** After a task's first reroute, the hint now says `## Amendment Round N` instead of a bare `## Amendment` that `--reroute` refuses. The full-send scope note in the same message names the full-send scope heading, so a scope-only section can no longer satisfy a later reroute.

## Decisions Made

- The new amendment-heading rule lives in one exported helper, `rerouteAmendmentHeading` in `src/orchestrator/main.ts`. The reroute pre-flight and the hint both call it, so they cannot drift apart. `validation.ts` was not in the spec's Affected Files, so the helper stays in `main.ts`.
- The full-send scope note now names `## Amendment (full-send scope)`, not a round heading. A round heading would let a BLESS (`canon task accept … --reason`) satisfy a later human `--reroute` without a new amendment. The fixture follows the emitted heading, runs BLESS, then runs the printed reroute and asserts it is still refused.
- Classified as exempt: the post-reroute `canon run <id> --reroute --step --expect …` line in `src/orchestrator/main.ts` (an alternate invocation of the reroute itself, not a next step) and the argv refusal in `src/orchestrator/cli.ts` (`--reroute` with `--full-send`). Round 2 review accepted the first classification.
- Classified as actionable: the `canon task phase … sanctioned` redirect in `src/task/index.ts`. Its fixture covers both emitting states, `code_review` and `spec_review`.
- Left as is: `specGateDoneNote` in `src/task/index.ts` says "add an amendment" with no round. It is not a wrong hint (the command it names is accepted), and the spec puts it outside this task.

## Open Questions

- Follow-up candidate: `specGateDoneNote` could name the round-specific heading, like the spec_gap hint. Not in this task's ACs; record it in `docs/BACKLOG.md` or a new task if wanted.
- The `spec_review` form of the sanctioned redirect accepts or refuses states according to `canon task accept`'s existing contract. This task did not change that contract.
- Non-blocking nits recorded in `tasks/recovery-command-fixtures/review.md`: the spec-gate fixture's `code_review` case pairs `status: 'pending'` with an inherited `verdict: 'approved'`, which an agent would not leave; and the registry checks covering-test titles, not whether a fixture is correct. The spec accepts the second as a tripwire.

Maintenance: lessons-learned.md plus this task's fragment have 23 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 2
- Validation gaps: 0
- Notes: Code review took three rounds (two changes_requested) for fixture integrity and the scope-note heading (AC-2 and AC-5); final verdict approved_with_nits.
