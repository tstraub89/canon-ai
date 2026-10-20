# Spec: autocommit-retry-at-review-entry — Retry a failed implement auto-commit at code_review entry

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

GitHub issue #84. If the post-implement auto-commit fails, the next `canon run` does not retry it. code_review's pre-flight then rejects the uncommitted work, and that rejection uses up a review loop. Observed on an adopter repo whose pre-commit hook runs canon's scaffolded `docs-refs-check`:

1. A review-fix implement round finished, and the implementer's changes were staged in the task worktree.
2. The auto-commit failed because the pre-commit hook rejected a `§"Heading"` citation in `tasks/<id>/review.md` that pointed at a bold-lead paragraph, not a real heading. The previous round's code_review foreman had written that citation. The orchestrator exited 1 with `Auto-commit failed: … heading not found`.
3. The operator fixed the citation and re-ran `canon run <id>`.
4. The run went straight to code_review. The pre-flight rejected the handoff with `handoff→diff: <file> listed in handoff but not in diff`, because the file was staged but never committed and the pre-flight diffs `base...HEAD`.
5. That rejection counted toward the loop cap, and the pipeline auto-blocked.

**Confirmed mechanism (deterministic, by code trace).**

- **Ordering.** The implementer runs `canon task phase <id> implement done` itself, as the last step of its prompt. The orchestrator's `checkAndRoute('implement')` in `src/orchestrator/main.ts` then calls `autoCommitCode(taskIds, getActiveCwd(taskIds))`.
- **Failure path.** When `git commit` fails, `autoCommitCode` calls `die("Auto-commit failed: …")` and exits 1, and the index stays staged. By then `implement` is persisted as `done`, so the derived phase is `code_review`.
- **Resume.** The next `canon run` derives `code_review` and calls `runCodeReviewPhase()` (`src/orchestrator/phases/code-review.ts`). Nothing on that path calls `autoCommitCode`.
- **Pre-flight.** `verifyHandoffAgainstDiff()` diffs committed history only, so the uncommitted handoff file fails `handoff→diff`. `determinePreflightRoute()` routes that to `implement`, and `taskPhasePreflightRejected()` bumps `preflight_rejections_current_loop`. `evaluateCodeReviewLoop()` counts that toward `MAX_REVIEW_LOOPS`.
- **Root cause (b).** The citation was written by the code_review foreman, whose prompt (`src/orchestrator/prompts/templates/code-review-foreman.md`, step 4 "Write `review.md`") says nothing about citation format. `docs-refs-check` validates a quoted `§"Heading"` against real ATX/setext headings only. An unquoted `§Name` is not validated.

**Why (c), loop accounting, needs no separate change.** If the retry described below runs before the pre-flight, a commit that now succeeds leaves nothing for the pre-flight to reject. A commit that fails again dies (exit 1) before any pre-flight runs, so it consumes no loop either way.

## Decision

1. **Retry at review entry.** When the main loop is about to run `code_review` (the derived current phase is `code_review`), first check the active task cwd (`getActiveCwd(taskIds)`) for uncommitted changes, staged or unstaged, to any path listed in the tasks' handoff Changes rows (`parseHandoffChangesRows`, the same source `autoCommitCode` uses). If there are any, log `Retrying the implement auto-commit that did not complete…` and call `autoCommitCode(taskIds, activeCwd)` before `runPhase('code_review')`. If there are none, do nothing. Today's path is unchanged.
2. **No retry when the operator accepted implement.** If implement is still operator-accepted for the whole bundle (`phases.implement.operator_accepted` is true on every task and the active cwd's HEAD equals each recorded `operator_accepted_sha`), the retry does nothing, whether or not handoff paths are dirty. The operator owns the commit in that state, and dirt after an accept is what `operatorAcceptedImplement`'s clean-source-tree condition (`src/orchestrator/main.ts`) exists to keep out of automation. Today's path is unchanged there: dirty handoff files reach the pre-flight as before. This is a pre-check in the retry, not a change to `autoCommitCode` or `operatorAcceptedImplement`. (Spec review round 1 found that the earlier wording, relying on `autoCommitCode`'s early return, could not hold: `operatorAcceptedImplement` returns false whenever source files are dirty, so `autoCommitCode` would have committed them.)
3. **Retry failure is a hard stop, as today.** If the retried commit fails, `autoCommitCode`'s existing `die` stops the run before the pre-flight. No review loop is consumed. The operator sees the same `Auto-commit failed: …` message and fixes the hook failure.
4. **Foreman citation rule.** Add one rule to step 4 of `code-review-foreman.md`: when citing a section of a Markdown doc with the quoted form `§"…"`, the quoted text must be an exact heading in that file. To point at a bold-lead paragraph or anything that isn't a heading, use `file:line` or the unquoted `§Name` form instead. Do not otherwise change the foreman prompt.

## Non-Goals

- Not moving `autoCommitCode` before the implementer's `implement done` transition, and not changing who writes that transition.
- Not changing the pre-flight's counting rules or `MAX_REVIEW_LOOPS` semantics.
- Not changing `docs-refs-check` or which citation forms it validates.
- Not adding a retry at other phase entries (QA, human_review). The observed failure, and the only one whose next phase reads committed history through a loop-counted gate, is implement → code_review.
- Not auto-fixing or rewriting the content that made a hook fail.
- Not the pipeline-owned-artifact auto-strip half of issue #86.

## Acceptance Criteria

- [ ] AC-1 (red-first regression, integration): in a worktree-mode fixture (reuse `makeAutoCommitFixture` / `runNodeInline` in `tests/run-task-safety.test.ts`), a task has implement `done`, code_review `pending`, and a handoff-listed source file with uncommitted changes in the task worktree. Running the main loop entry for `code_review`, with the review agents faked, commits that file before the pre-flight runs. Assert:
  - the file appears in `git log base..HEAD`;
  - `preflight_rejections_current_loop` stays `0`;
  - no `handoff→diff` rejection is written to `review.md`.
  
  It fails on pre-fix code (which records a pre-flight rejection).
- [ ] AC-2: same fixture with a clean worktree (all handoff files already committed). The retry does not call `git commit`, the output contains no "Retrying the implement auto-commit" line, and code_review proceeds as today. Unit or integration test.
- [ ] AC-3: same as AC-1, but with a commit that keeps failing (a fake `git` or a failing `pre-commit` hook in the fixture). The run exits 1 with `Auto-commit failed:` in the exit marker. No `review.md` pre-flight block is written, and `preflight_rejections_current_loop` and `iterations_current_loop` are unchanged.
- [ ] AC-4: with implement operator-accepted for the bundle (status as `canon task accept <id> implement` leaves it, HEAD equal to the recorded accepted SHA) and a handoff-listed file dirty, the retry makes no commit and the output has no "Retrying the implement auto-commit" line; the run proceeds to the pre-flight as today. Assert HEAD unchanged and the file still dirty. Companion case: same fixture but HEAD moved past the accepted SHA (stale accept) → the retry does run and commits, as in AC-1.
- [ ] AC-5: uncommitted changes only to pipeline-owned paths (`tasks/<id>/review.md`, telemetry files), with handoff paths clean, do not trigger the retry. Verified in the AC-2 test or a sibling.
- [ ] AC-6: `code-review-foreman.md` step 4 contains the citation rule from Decision 4. A test asserts the rendered foreman prompt includes the rule text, using an existing prompt-render test file such as `tests/run-task-prompts.test.ts`. Golden prompt files, if any cover the foreman, are regenerated.
- [ ] AC-7: `docs/pipeline-orchestrator.md` §"Auto-Branch + Auto-Commit" gets one sentence saying a failed auto-commit is retried on the next `canon run` before code_review's pre-flight, and that a retry failure stops before the pre-flight without consuming a review loop. The template mirror is regenerated and `npm run sync-templates:check` passes.
- [ ] AC-8: full validation suite passes (see Validation Required).

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/main.ts` | Before `runPhase(currentPhase, state)` in the main loop (the single `runPhase` call site), when `currentPhase` is `code_review`, a small helper skips if implement is still operator-accepted (Decision 2), otherwise detects dirty handoff-listed paths in the active cwd and calls `autoCommitCode` when any exist. The operator-accepted pre-check shares its accepted-flag + HEAD-SHA predicate with `operatorAcceptedImplement` rather than duplicating it. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Citation rule in step 4 (Decision 4). |
| `tests/run-task-safety.test.ts` | AC-1 to AC-5. |
| `tests/run-task-prompts.test.ts` | AC-6 rule-presence assertion. |
| `docs/pipeline-orchestrator.md` | AC-7 sentence. |
| `templates/docs/pipeline-orchestrator.md` | Mirror, regenerated by `npm run sync-templates` (never hand-edited). |
| `dist/cli/index.js` | Rebuilt bundle (`npm run build`); `dist/` is committed and CI checks freshness. Do not revert it. |
| `dist/orchestrator/run-task.js` | Rebuilt bundle (`npm run build`). Do not revert it. |

If prompt golden files cover the foreman template, list them in the handoff with the regeneration command used.

### Interaction Dependencies

- Control flow traced: `autoCommitCode` has one caller, `checkAndRoute('implement')` (orchestrator context, after the implementer's own `implement done`). The retry adds a second, also orchestrator-context, call at review entry. `runPhase` has one call site (the main loop), so the retry covers every route into `code_review`, including re-entry after a review round and reroute.
- `autoCommitCode`'s own guards (malformed rows, staged-outside-handoff, `verifyHandoffFilesCommitted`) apply unchanged to the retry. A retry can therefore die on a guard that a clean pre-flight would not have tripped. That is correct, since the guard reflects real uncommitted state.
- The concurrent task `agent-failure-parks-phase` (issue #17) wraps `runPhase` + `checkAndRoute` in the main loop in a `try/catch`. The retry should sit before `runPhase` in the same loop, outside that agent-failure handling (it is a git operation, not an agent session).
- Bundles: the retry uses the bundle's `taskIds` and the bundle's active cwd, exactly as `checkAndRoute('implement')` does.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`: run the full suite. A check means the suite runs clean, not just that new tests were added.
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/pipeline-orchestrator.md` (edited, AC-7). `docs/patterns.md` "only handoff files are committed; `tasks/<id>/` stays uncommitted until QA-end" stays true.

## Known Risks

- **False retry on unrelated dirt.** Only handoff-listed paths trigger it (AC-5). An operator's unrelated edit to a handoff-listed file between runs would be committed under the task's commit message. That is the same exposure `autoCommitCode` already has when it runs after implement.
- **Operator-accepted + dirty stays a pre-flight rejection.** Deliberate (Decision 2): the retry does not auto-commit after an operator accept, so that case still costs a pre-flight rejection as today. Widening the retry to cover it would require changing `operatorAcceptedImplement`'s safety guard, which this task does not do.
- **A retry that hides a real implementer mistake.** If the implementer left a handoff file dirty for a reason other than a failed commit, committing it at review entry is still right: the reviewer then sees the code the handoff claims.
- **Golden prompt drift.** The foreman template change may need golden regeneration; AC-6 makes that explicit.

## Human Test Plan

1. On a scratch project with a pre-commit check, run a task through implementation in a way that makes the automatic commit fail (for example, a broken doc reference that the check rejects).
2. Fix the broken reference and run the task again.
3. Expected: the run commits the pending work first and then starts code review normally. No pre-flight rejection appears, and no review round is used up.
4. Expected (if the check still fails): the run stops with the same commit-failure message, without starting the review.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed; *Acceptance Criteria* includes a red-first regression-test AC
- [x] (Refactors) N/A
