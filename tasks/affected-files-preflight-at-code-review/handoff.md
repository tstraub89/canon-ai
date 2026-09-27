# Implementation Handoff: affected-files-preflight-at-code-review

> Author: Codex | Spec: `tasks/affected-files-preflight-at-code-review/spec.md` | Plan: `tasks/affected-files-preflight-at-code-review/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/validation.ts` | Shared Affected Files allowlist builder and pure base-drift classifier; both gates use the existing scope matcher. |
| `src/orchestrator/phases/code-review.ts` | Scope pre-flight, normal-run block, full-send foreman handoff, and post-foreman enforcement. |
| `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/code-review-foreman.md` | Conditional full-send scope judgment prompt. |
| `src/orchestrator/main.ts` | Separate base-only drift from task-changed out-of-scope files in the abort message. |
| `src/orchestrator/prompts/templates/implement.md` | Name new helpers, fixtures, and tests in the scope cap. |
| `tests/run-task-validation.test.ts` | Builder, rename and prefix scope, managed-doc admission, and drift classification cases. |
| `tests/run-task-code-review.test.ts` | Halt, reset and Round 1 resume, full-send outcomes, and in-scope runner cases. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | New out-of-scope foreman golden and regenerated implement prompt golden. |
| `dist/orchestrator/run-task.js` | Rebuilt orchestrator bundle. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Document the early scope gate, full-send judgment, reset path, and base-advance message; synced mirror. |

## Canon Governance

The authoritative provenance stamp remains in `status.json.canon` for this task. No second provenance record was created.

## Intent & Rationale

The code-review gate checks the task's three-dot changed paths, including both sides of renames, against the same allowlist and scope matcher used by the later base-drift gate. It always admits pipeline-managed docs because QA may edit them after code review. Normal runs block before an agent call and leave review counters and review.md untouched. Full-send runs ask the foreman to judge each path and block if a path is neither amended into a member spec nor covered by `changes_requested`. The later two-dot `--pr` gate still blocks drift, but labels base-only advancement separately.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Did not edit `tests/run-task-safety.test.ts` for the suggested message assertion. | It is outside the spec's Affected Files cap. The authorized validation tests cover all-base-only, all-task, and mixed classification; existing safety tests still pass. | AC-8 classification and message implementation remain covered; no new direct message assertion. |
| Did not edit `src/orchestrator/git.ts` or `dist/cli/index.js`. | The existing rename-aware `getAffectedFiles` fits, and the build produced no CLI bundle delta. | None. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | One exported builder; both call sites use it; Design, Amendment, prefixes, telemetry, task dirs, managed-doc flag tested. |
| AC-2 | Met | Reused pure `verifyBaseDriftFromData`; rename post-image, prefix, and managed-doc cases tested. |
| AC-3 | Met | Runner test confirms block before either agent, actionable escalation, and unchanged counters. |
| AC-4 | Met | Runner test edits spec after reset and confirms Round 1. |
| AC-5 | Met | Full-send runner checks unchanged spec before foreman; prompt golden and conditional rendering checked. |
| AC-6 | Met | Runner cases cover amendment, `changes_requested`, and unjudged auto-block. |
| AC-7 | Met | Explicit in-scope runner case plus existing pre-flight suite. |
| AC-8 | Met | Pure classifier covers all-base, all-task, and mixed drift; abort text gives distinct guidance; existing base-drift runner tests pass. |
| AC-9 | Met | Scope rule updated; golden diff contains only the implement change and one new foreman key. |
| AC-10 | Met | Build, lint, type-check, full test suite, docs references, and mirror check pass. |

## Edge Cases Considered

- A bundle enables full-send only when every member has `full_send: true`.
- An unfilled review retries through the existing path before post-foreman scope enforcement.
- The pre-flight writes no review heading, preserving Round 1 after reset.
- Base-only and task-changed drift can appear together; both message sections render.
- The first full-suite run overlapped `tsup` cleaning `dist/`: two unrelated CLI fixtures could not load the temporary CLI bundle, and a signal timing test failed. A sequential rerun passed 1278 tests, with one pre-existing skip.

## Blockers

- [ambiguity] AC-4 says a spec edit followed by `canon run` resumes the blocked review. Current `autoBlockPhase` leaves `code_review` blocked, so the implementation follows the plan's interpretation: run `canon task reset-code-review <id>` after the spec edit, then rerun. The halt message and test both pin that required reset.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final rerun. |
| `npm run type-check` | Pass | Final rerun. |
| `npm test` | Pass | Sequential run after build: 1278 pass, 0 fail, 1 skip. |
| `npm run build` | Pass | Rebuilt after final prompt change; only declared orchestrator bundle changed. |
| `npm run docs-refs-check` | Pass | All refs OK before handoff; rerun after handoff below. |
| `npm run sync-templates:check` | Pass | Managed files in sync. |
| Golden regeneration (`UPDATE_GOLDENS=1 npm test`) | Pass | Sequential rerun: 1278 pass, 0 fail, 1 skip. Golden diff contains only the implement prompt change and new full-send foreman key. |
| Baseline regression repro | Pass | With the base version of code-review.ts temporarily loaded, the new runner test exited 1: “Missing expected rejection” and cold review ran. Restored current source, then the same test passed. The first classifier test also failed before its export existed. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/phases/code-review.ts` | Shared post-review scope classifier, directory-aware recheck, accurate no-reset recovery instructions, and verdict exemptions aligned with routing. |
| `src/orchestrator/main.ts` | Enforce scope after code-review recovery and classify `--pr` drift against `origin/<base>`. |
| `src/orchestrator/validation.ts` | Pure state-dependent base-drift abort message builder. |
| `tests/run-task-code-review.test.ts` | Plain re-run at Round 1 and Round 2, directory amendment, recovery-path, mixed bundle, and verdict tests. |
| `tests/run-task-validation.test.ts` | Base-only, task-only, and mixed abort-message assertions. |
| `src/orchestrator/prompts/templates/code-review-foreman.md`, `tests/run-task-prompts.golden.json` | Separate the full-send judgment block from the following heading; only the full-send golden changed. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Correct the no-reset resume path and describe recovery enforcement; synced mirror. |
| `dist/orchestrator/run-task.js` | Rebuilt orchestrator bundle. |

### Findings addressed

- Correctness 1: `checkAndRoute` now rechecks full-send scope after recovery can finish code review. A runner test starts with an unfilled review, simulates the resumed approved review without an amendment, and confirms the routing boundary blocks before QA.
- Correctness 2: The halt gives the actual task IDs and a direct `canon run` resume path. It no longer prescribes `reset-code-review` or assumes a worktree. Round 1 and Round 2 tests assert counters and prompt round survive a halt.
- Correctness 3: Direct post-foreman enforcement rebuilds the shared allowlist and uses the same prefix-aware matcher as pre-flight. The directory amendment case now passes.
- Correctness 4: The `--pr` classification compares against `origin/<base>` after fetch. The abort text is built by one pure function and checked across base-only, task-only, and mixed states.
- Guardrail 5: The shared verdict check treats `needs_re_review` like `changes_requested`; the comment explains why one bundle verdict exempts the bundle until its next review.
- Guardrail 6: `spec_gap` retains its own blocking and recovery banner.
- Guardrail 7: The abort-message builder preserves concrete fetch/rebase and stray-commit guidance, with tests asserting opposite wording for opposite states.
- Optional nit 8: The full-send prompt now leaves a blank line before Foreman Protocol.
- The first iteration's note saying an unfilled review retries *before* enforcement is superseded: recovery completion is now checked at `checkAndRoute` before QA. The first iteration's `[ambiguity]` reset interpretation is resolved by the Round 1 review and the direct re-run test.

### AC deltas

- AC-4: Partial → Met. A spec edit plus plain re-run resumes at the correct round without resetting review state.
- AC-6: Partial → Met. Both direct and recovery completion paths enforce the same directory-aware scope rule.
- AC-8: The task-changed input now uses `origin/<base>` as Decision 3 requires.
- AC-10: Build and affected source tests pass. The required docs-reference check and six full-suite PR-path tests are blocked by malformed references in the reviewer-authored review artifact (see Blockers).

### Red-first evidence

- Before the fixes, `node --test --test-name-pattern='scope pre-flight' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-code-review.test.ts` exited 1: the AC-4 escalation still prescribed `reset-code-review`, and the directory amendment case hit `process.exit(2)`.
- Before the recovery fix, `node --test --test-name-pattern='full-send scope is enforced after an unfilled review' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-code-review.test.ts` exited 1: `checkAndRoute` exited 0 instead of blocking after a resumed approved review with no amendment.
- Before extracting the message builder, its new focused test failed because `buildBaseDriftAbortMessage` was not exported. All three cases passed after the fix.

### Blockers

- [ambiguity] Round 1 identified a separate spec gap: a foreman-written `## Amendment` can satisfy the later human reroute amendment gate even if the human has written nothing. The spec expressly requires this heading, and a complete reroute-gate change would affect guidance outside the Affected Files cap. This iteration preserves the specified heading and leaves that product decision for the spec owner.
- [scope] Reviewer-authored `tasks/affected-files-preflight-at-code-review/review.md` lines 102 and 172 backtick three fixture paths that do not exist. `npm run docs-refs-check` fails on them. Six PR-path tests in `tests/run-task-safety.test.ts` fail because their subprocesses reach that same docs-reference gate. The review artifact and safety test file are outside the spec's Affected Files table; this iteration leaves them unchanged. Repro: `npm run docs-refs-check` or the full `npm test`.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | After final source and test edits. |
| `npm run type-check` | Pass | After final source and test edits. |
| Focused code-review and validation suites | Pass | Both affected test files passed in full. |
| Focused existing base-drift safety test | Pass | The existing out-of-scope abort-message assertion passes after preserving telemetry guidance. |
| `npm test` | Fail – unrelated | 1,278 pass, 6 fail, 1 skip. All six failures are PR-path tests in `tests/run-task-safety.test.ts` blocked by the reviewer-authored `review.md` broken references named above. |
| `npm run build` | Pass | Rebuilt after final source edit; only the declared orchestrator bundle changed. |
| `npm run docs-refs-check` | Fail – unrelated | Three broken fixture references in reviewer-authored `tasks/affected-files-preflight-at-code-review/review.md`:102,172. |
| `npm run sync-templates:check` | Pass | Root guide and mirror match. |
| Prompt golden regeneration | Pass | Scoped `UPDATE_GOLDENS=1` prompt test; existing foreman goldens remain unchanged. |
| `git diff --check` | Pass | No whitespace errors. |

The cumulative `git diff main...HEAD --name-only` paths remain covered by the baseline Changes table. Every new source, test, docs, and dist edit in this iteration is listed above.

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/phases/code-review.ts` | Removed the premature in-phase scope block; changed the router block reason to name recorded verdicts and give a viable reroute path. |
| `src/orchestrator/main.ts` | Kept post-review scope enforcement at the recovery boundary and listed unamended files in the spec-gap escalation and banner. |
| `src/orchestrator/prompts/templates/code-review-foreman.md`, `tests/run-task-prompts.golden.json` | Aligned full-send instructions with the actual verdict routing; regenerated the affected foreman golden. |
| `tests/run-task-code-review.test.ts` | Added the partial-review regression and router cases for approved-unamended, amended, changes-requested, and spec-gap outcomes. |
| `dist/orchestrator/run-task.js` | Rebuilt the orchestrator bundle after source and prompt changes. |

### Findings addressed

- R2-1: Removed the in-phase post-foreman block. A partial review without a checked verdict now returns to the existing recovery path, which can retain the Claude session and retry. The router remains the single post-review enforcement site. Router tests confirm an unamended approved review blocks with the path named, an amendment proceeds, and `changes_requested` routes to implement.
- R2-2: The post-review block now offers a spec edit followed by `canon run`, or rerouting with a note to remove the files. It no longer suggests an unavailable operator action.
- R2-3: The block reason names the recorded verdict so a stale approval is visible before the operator resumes.
- R2-4: A `spec_gap` escalation and banner name files still outside Affected Files and warn that BLESS does not amend the spec. The foreman prompt explains the same routing.
- R2-5 and optional nits were not changed; Round 2 classified them as non-blocking.

### AC deltas and deviation

- AC-6: Enforcement now runs once, after code-review recovery. Tests exercise the three specified outcomes at that routing boundary and confirm partial evidence does not block prematurely.
- AC-10: Build and every required check pass after this iteration.
- Deviation from AC-6(c): The prior round's `spec_gap` exemption remains. The written AC exempts only `changes_requested`, but Round 1 review requested preservation of spec-gap human triage. The new file list makes a BLESS decision informed; it does not itself amend Affected Files. This remains a human spec decision.

### Red-first evidence

- Before the fix, `node --test --test-name-pattern='partial full-send review without a verdict' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-code-review.test.ts` exited 1. The in-phase scope check called `process.exit(2)` on the extra-helper fixture path even though `review.md` had partial content and no checked verdict. The focused code-review suite passed after removing that check.

### Blockers

- [ambiguity] AC-6(c) permits only a `changes_requested` verdict for an unamended file, while Round 1 review requested that `spec_gap` keep its human triage route. This iteration preserves the reviewed behavior and lists the unamended files in the escalation and banner. The spec owner should decide whether a future change must block `spec_gap` under AC-6(c). The separate foreman `## Amendment`/reroute-gate question remains recorded in Iteration 2.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | After final source and test edits. |
| `npm run type-check` | Pass | After final source and test edits. |
| Focused code-review suite | Pass | 43 tests, including the red-first regression and router outcomes. |
| Prompt golden regeneration | Pass | Scoped `UPDATE_GOLDENS=1` prompt suite; only `promptCodeReview_fullSendOutOfScope` changed. |
| `npm run build` | Pass | Rebuilt the declared orchestrator bundle; CLI bundle did not change. |
| `npm test` | Pass | 1,288 passed, 1 skipped, 0 failed. |
| `npm run docs-refs-check` | Pass | All refs OK after the reviewer repaired its own artifact. |
| `npm run sync-templates:check` | Pass | All managed files in sync. |
| `git diff --check` | Pass | No whitespace errors. |

The cumulative `git diff main...HEAD --name-only` paths are all present in prior or current Changes tables.
