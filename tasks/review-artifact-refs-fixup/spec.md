# Spec: review-artifact-refs-fixup — Citation rule and docs-refs fix-up for review.md

> Written by: Claude | Review by: spec reviewer
> Status: draft (revised after spec_review round 3)

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

`--pr` runs the shipped docs-refs checker and aborts on any broken reference in task artifacts that would be committed (`src/orchestrator/main.ts`, the "--pr aborted: docs-refs-check found broken refs" gate). The implement and QA phases are protected before that gate in two ways:

- Their prompts carry `ARTIFACT_CITATION_RULE` (`src/orchestrator/prompts/index.ts`): cite repository files by full path, and cite a file that does not exist in the markdown-link form instead of backticks.
- After each phase, `fixUpOwnArtifactRefs` (`src/orchestrator/main.ts`) runs the checker on that phase's own artifacts (`handoff.md`; `done.md` and `pr-body.md`) and resumes the phase's session for up to `ARTIFACT_FIXUP_MAX_ATTEMPTS` fix attempts, refusing any change outside those artifacts.

The code_review phase has neither. `promptCodeReview` does not include the citation rule, and no fix-up runs after the foreman writes `review.md`. `scripts/docs-refs-check.mjs` deliberately checks `review.md` as a record (its `isNoisySourceFile` comment). So when the foreman backticks a test-fixture or example path that is not a repository file, nothing catches it until `--pr`, which the operator then fixes by hand.

Confirmed mechanism, deterministic: in this repository, `--pr` aborted three times in one session on such paths in `review.md` (for example a backticked `src/a` fixture directory and `src/p/implement.md`). Each was fixed by hand-editing `review.md` and re-running `--pr`. In a fourth case the foreman noticed the checker failure itself and removed the backticks.

## Decision

1. **Prompt rule.** The code-review foreman template (`src/orchestrator/prompts/templates/code-review-foreman.md`) carries `ARTIFACT_CITATION_RULE` verbatim at the step that writes `review.md`, as `qa.md` and `implement.md` carry it next to their artifact steps.
2. **Fix-up after every session that can write `review.md`.** Two sessions can write it: the foreman session, and the one-shot recovery session `checkAndRoute` resumes (`recoverPhaseForTask` → `retryAgentForPhase`) when the foreman returns with code_review not `done`. After each, once code_review is `done` for the bundle and before any stop or routing that depends on the review (the full-send scope check and verdict routing, including `spec_gap` and the reroute to implement), canon runs `fixUpOwnArtifactRefs` for each bundle task's `review.md`, resuming the stored foreman (`reviewer`) session. A foreman return that leaves code_review not `done` gets no fix-up at that point: an unfilled review reset to `pending` is covered by the recovery path, and a `blocked` review stops at the existing reviewer-blocked stop with no fix-up (see Judgment Calls). The fix-up is gated on `done` only. At most one fix-up runs per bundle per `canon run` invocation of the phase (the recovery fix-up applies only if the post-foreman one did not run).
   - The fix session follows the implement fix-up's request pattern: it is not wrapped as a resume banner, and success is a zero exit code.
   - The attempt limit and the warn-and-continue cases are unchanged: no stored session (including interactive mode and pre-flight rejections, which start no foreman session), a failed session, or findings that remain. For code_review the warning names the reviewer and says to fix the references before `--pr`.
3. **Stops park the bundle.** code_review is already `done` with its verdict recorded when the fix-up runs, so a plain exit would let the next `canon run` go straight to QA. Every stop the fix-up causes for code_review (the existing outside-artifact scope check, and the verdict guard below) instead auto-blocks code_review for the whole bundle, as the full-send scope block does, with a reason naming the cause and the recovery (`canon task reset-code-review <id>`, then `canon run`). Implement and QA fix-up stops are unchanged.
4. **Verdict guard.** After each fix session, whatever its outcome (success, non-zero exit, or a thrown `AgentSessionError`) and on every return path of the fix-up, each task's checked verdict in `review.md` (read with `extractCheckedVerdict`) must equal its recorded code_review verdict in `status.json`. If any differs, canon auto-blocks per item 3, naming the task and both verdicts, even when the session failed. The guard does not depend on the citation re-check running.
5. **Fix-up prompt.** `promptArtifactFixup` accepts the code_review phase. For code_review it does not say canon commits after the turn (nothing commits at this point; `review.md` is committed later). It says canon checks the references before acting on the review, and adds: edit only references, and do not change any verdict checkbox or finding.
6. **Superseded and raw copies.** `scripts/docs-refs-check.mjs` additionally exempts (a) the unsuffixed `tasks/<id>/review-cold-codex.md`, as it already exempts `review-cold-codex-run-N.md` (both hold the same raw lens output; the foreman's `review.md` is the reviewed record), and (b) the archived `tasks/<id>/review-prior-N.md` that `canon task reset-code-review` writes (an archived, superseded review; `review.md` is the live record). Without (b), a blocked review whose broken references were deliberately left unfixed (item 2) survives as a scanned `review-prior-N.md` after reset and still aborts `--pr`.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| How to stop review.md breaking `--pr` | Prompt rule plus fix-up, as for implement and QA | Exempt `review.md` in `isNoisySourceFile` | The checker treats `review.md` as a record on purpose; one mechanism across phases | `Human` |
| Verdict mismatch after fix-up | Auto-block code_review | Warn and continue | `review.md` and the recorded verdict would disagree, and a human reading the review would see a different outcome from the one routed | `Author` |
| Where the fix-up runs | Right after the foreman session, before the full-send scope check and verdict routing | In the post-phase `code_review` case only | Earlier stops (full-send scope, `spec_gap`) also leave `review.md` for a later `--pr` | `Author` |
| Reviewer-blocked reviews | No fix-up; existing stop unchanged | Run the fix-up on a `blocked` review before the stop | A blocked review is not a finished record and the operator must reset code_review, after which the foreman rewrites `review.md` and that pass gets its own fix-up; `--pr` cannot be reached with code_review blocked | `Author` |
| Stop behavior | Auto-block code_review | Plain exit, as for implement and QA | A plain exit with code_review `done` sends the next run to QA and skips the verdict | `Author` |
| Fix-up coverage of recovery sessions | Fix-up also after the recovery session, when it completes code_review | Fix-up only after the foreman session | The recovery session can write the final `review.md`; skipping it leaves the same `--pr` abort | `Author` |
| Cold-Codex `review-cold-codex.md` | Exempt it in the checker, like its run-N siblings | Include it in the fix-up | It is raw lens output that the foreman did not write; the run-N copies are already exempt for that reason | `Author` |
| Archived `review-prior-N.md` after reset | Exempt it in the checker as a superseded record | Fix-up the blocked review before reset, or rewrite refs inside the archive at reset time | The archive is not the live record; exempting it needs no extra session or reset-time rewriting and covers every archive source, at the cost of unchecked refs in an archive | `Author` |

## Non-Goals

- No change to `scripts/docs-refs-check.mjs` beyond the two exemptions in Decision item 6 (`review-cold-codex.md`, `review-prior-N.md`); `review.md` itself stays checked.
- No change to `canon task reset-code-review` or its archiving.
- No change to the `--pr` gate.
- No change to the implement or QA fix-ups beyond widening the shared helper's phase type.
- No change to `ARTIFACT_CITATION_RULE`'s text.

## Acceptance Criteria

- [ ] AC-1: Prompt rule. `promptCodeReview` output contains `ARTIFACT_CITATION_RULE` for a first round and a round-N state. Verify by extending the existing "task artifact prompts carry the canonical file citation rule" test in `tests/run-task-prompts.test.ts`, and by regenerating the code-review goldens (a second plain `npm test` after `UPDATE_GOLDENS=1` passes).
- [ ] AC-2: Fix-up runs and fixes. In an orchestrator test modeled on the existing QA fix-up test in `tests/run-task-safety-scaffold-push.test.ts`, a foreman session that writes `review.md` with a backticked missing path and a checked `changes_requested` verdict triggers "Artifact fix-up (attempt 1/2)", resumes the reviewer session, and then routes to implement as before. Verify with that test; it fails on current `main`.
- [ ] AC-3: Verdict guard. A fix session that changes the checked verdict in `review.md` leaves code_review auto-blocked (verify the status after the stop), names the task and both verdicts, and routes nothing. Verify with two tests: one where the fix session exits zero, and one where it changes the checkbox and then exits non-zero (or throws `AgentSessionError`), which must also auto-block rather than warn and continue.
- [ ] AC-4: Scope guard. A fix session that edits a file other than `review.md` leaves code_review auto-blocked (verify the status after the stop). Verify with a test.
- [ ] AC-5: No session. With no stored reviewer session, canon warns with the findings, telling the operator to fix them before `--pr`, and continues. Verify with a test.
- [ ] AC-10: Recovery path. When the foreman returns with code_review not `done` and the one-shot recovery session then writes a `review.md` containing a backticked missing path and marks code_review done, canon runs the fix-up (resuming the stored reviewer session) before routing, and the broken reference is gone afterward; a verdict change or outside-artifact edit in that fix session auto-blocks as in AC-3/AC-4. Verify with a test in `tests/run-task-safety-scaffold-push.test.ts` that fails on current `main`. Also assert no fix-up ran at the earlier foreman return (code_review was not `done`).
- [ ] AC-6: Early stop. A `spec_gap` verdict gets the fix-up before its stop. Verify with a variant of the AC-2 test. A reviewer-blocked review runs no fix-up: in a test where the foreman leaves code_review `blocked` with a backticked missing path in `review.md`, no "Artifact fix-up" line is logged, no fix session starts, and the existing reviewer-blocked stop runs unchanged.
- [ ] AC-7: Fix-up prompt. `promptArtifactFixup` for code_review does not say canon commits after the turn, and says not to change verdict checkboxes or findings. Verify with a `tests/run-task-prompts.test.ts` case and its golden.
- [ ] AC-8: Checker exemptions. `tasks/<id>/review-cold-codex.md` and `tasks/<id>/review-prior-1.md` (and a multi-digit N) with a backticked missing path pass `docs-refs-check`, and `tasks/<id>/review.md` with the same content still fails. Verify with cases in `tests/docs-refs-check.test.ts` next to the run-N case.
- [ ] AC-11: Blocked-review recovery. In a fixture task dir, a `review.md` with a backticked missing path is archived by the real `archivePriorReview` (`src/orchestrator/review-archive.ts`) to `review-prior-N.md` and a clean `review.md` is written; `docs-refs-check` on that dir then reports no findings. Verify with a case in `tests/docs-refs-check.test.ts` that archives via `archivePriorReview` rather than hand-naming the file, so it fails if the archive naming and the exemption diverge.
- [ ] AC-9: Docs. `docs/pipeline-orchestrator.md` and its mirror describe the code_review fix-up, its auto-block stops and the verdict guard in the fix-up paragraph, and the session-resumption passage notes that the reviewer session can be resumed in-process for the fix-up. Verify by reading, plus `npm run docs-refs-check` and `npm run sync-templates:check`.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/main.ts` | Fix-up right after the code_review session; widened phase type; auto-block stops and verdict guard for code_review; reviewer backend for the fix session |
| `src/orchestrator/prompts/index.ts` | `promptArtifactFixup` code_review wording |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | `ARTIFACT_CITATION_RULE` at the write-review.md step |
| `scripts/docs-refs-check.mjs`, `templates/scripts/docs-refs-check.mjs` | Exempt unsuffixed `review-cold-codex.md` and archived `review-prior-N.md` |
| `tests/docs-refs-check.test.ts` | AC-8 and AC-11 |
| `tests/run-task-prompts.test.ts` | AC-1 and AC-7 |
| `tests/run-task-prompts.golden.json` | Regenerated code-review and fix-up snapshots |
| `tests/run-task-safety-scaffold-push.test.ts` | AC-2 to AC-6 and AC-10 orchestrator tests |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Fix-up paragraph and session-resumption passage |
| `dist/` | Rebuilt bundle (tracked) |

### Implementation Notes (non-binding)

- Resume the stored reviewer session (`splitState.usableSessionId(taskIds, <reviewer slot from splitPolicy.phaseSessionSlot('code_review')>, assignmentForTasks(taskIds))`), as `retryAgentForPhase` does, rather than `lastSessionId`: it is the same id for the foreman and the recovery session, and `lastSessionId` is not updated by recovery.
- Placement: a shared helper called once right after `runPhase` returns (only if code_review is `done` for every task) and once inside `checkAndRoute` after the recovery loop (only if the first did not run), before the full-send scope check. `fixUpOwnArtifactRefs` has early `return`s (no session, failed session, re-check error); the verdict guard must wrap those, e.g. run it in a `finally`-style step in the code_review caller after `fixUpOwnArtifactRefs` returns or throws.
- `fixUpOwnArtifactRefs` currently `die`s on a scope violation; code_review needs that path to auto-block instead (for example a stop callback the caller supplies).
- `fixUpOwnArtifactRefs` picks the agent name for its warning with `phase === 'implement' ? 'implementer' : 'qa'`; map `code_review` to `reviewer`.
- Read verdicts with `extractCheckedVerdict` on each task's `review.md` before and after each fix session.

### Interaction Dependencies

None in flight.

### Data Model Changes

None. The fix-up's metrics context uses a `code_review_fixup` phase label, like `qa_fixup`.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite runs clean
- [x] `npm run build`
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`

## Docs Impact

The docs in Affected Files.

## Known Risks

- **The fix session rewrites findings.** Its prompt says to edit references only. The verdict guard catches the one change that alters routing; prose edits are visible in the diff.
- **Verdict change on a failed fix session.** `fixUpOwnArtifactRefs` returns early on a failed session; the guard must run regardless (AC-3 second case).
- **Exempting archives hides refs.** `review-prior-N.md` refs go unchecked; accepted because the archive is superseded and `review.md` stays checked (AC-8). AC-11 ties the exemption to the real archive name.
- **Two writers of `review.md`.** The recovery session is the second writer; AC-10 pins it. A blocked review is the deliberate exception (AC-6). A third writer would reopen the gap, so the sweep is: every `runSession`/`backend.run` call for role reviewer in code_review (`runPhase`, `retryAgentForPhase`) must be followed by the fix-up.
- **Resuming a large foreman session.** The fix turn is short. The attempt cap bounds cost.
- **No session to resume.** Interactive mode and pre-flight rejections have no foreman session; AC-5 covers the warning path, and the `--pr` gate stays the backstop.
- **Round-1 continuity.** Resuming the reviewer for a fix-up does not change which session the next round resumes; the stored session id is the same one.

## Human Test Plan

1. Run a task whose code review is likely to mention example paths that are not real files.
2. Expected: the run log shows a fix-up pass after code review when such a path was cited, and opening the draft PR no longer stops on broken references in the review notes.
3. Expected: the review's verdict is the same before and after the fix-up.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row
- [x] Plan steps (fast tier): N/A, full tier
- [x] Replacement framing: N/A, additive
- [x] Non-Goals rules out the tempting expansions
- [x] Symbols named exist (`fixUpOwnArtifactRefs`, `promptArtifactFixup`, `promptCodeReview`, `ARTIFACT_CITATION_RULE`, `ARTIFACT_FIXUP_MAX_ATTEMPTS`, `extractCheckedVerdict`, `isNoisySourceFile`, `archivePriorReview`, `runCodeReviewPhase`, `lastSessionId`)
- [x] Known Risks covers the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has a checked entry
- [x] (Bug fixes) Problem states the confirmed mechanism (observed three times this session); AC-2 is red-first in substance (no fix-up exists today)
- [x] (Refactors) N/A
- [x] *Judgment Calls* lists every judgment call
