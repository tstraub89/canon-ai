# Implementation Handoff: review-artifact-refs-fixup

> Author: implementer | Spec: `tasks/review-artifact-refs-fixup/spec.md` | Plan: `tasks/review-artifact-refs-fixup/plan.md`
>
> Initial implementation. The source, tests, and generated bundle listed below are the implementation changes for this iteration.

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts`, `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/code-review-foreman.md`, `dist/orchestrator/run-task.js` | Add the citation rule to code-review prompts; run a bounded `review.md` fix-up after completed foreman and recovery sessions; guard verdict and file scope; auto-block code review on unsafe fix-up stops. Rebuild the tracked orchestrator bundle. |
| `scripts/docs-refs-check.mjs`, `templates/scripts/docs-refs-check.mjs` | Exempt raw cold-Codex output and numbered superseded review archives while leaving the live review checked. |
| `tests/docs-refs-check.test.ts` | Cover the raw and archived review exemptions and the real archive helper. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Cover first-round and round-N citation rules and the code-review fix-up prompt; regenerate snapshots. |
| `tests/run-task-safety-scaffold-push.test.ts` | Cover code-review fix-up, verdict and scope guards, no-session behavior, early stops, and the recovery writer. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Document the reviewer fix-up, auto-block conditions, and in-process reviewer-session resumption. |

## Canon Governance

Refer to the provenance fields in `tasks/review-artifact-refs-fixup/status.json`.

## Intent & Rationale

Code review now follows implement and QA artifact hygiene: canon checks each completed review artifact, resumes the stored reviewer session for up to two reference-fix attempts, and checks the artifact before acting on the verdict. A changed verdict or any edit outside the review artifact parks the whole code-review bundle. Raw lens output and superseded archives are exempt because the live review is the checked record.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Placed the exact `ARTIFACT_CITATION_RULE` text in the foreman template instead of adding a template variable in `src/orchestrator/prompts/index.ts`. | The existing code-review prompt renderer had no citation-rule variable to pass through. The rendered prompt test compares the output with the canonical constant, so drift remains covered without adding renderer plumbing. | None; AC-1 is met. |
| Reused one code-review reset-command builder for the existing reviewer-block stop and the new fix-up stop. | The recovery-hint registry requires each actionable reset-command source site to be unique. Sharing the builder preserves the existing recovery text and supports the new stop without widening the affected-file scope. | None; AC-3 and AC-4 are met. |
| Ran the verdict guard in a `finally` around each reviewer fix session. | This checks every attempt, including non-zero exits and thrown session errors, before the helper can retry or warn and continue. | None; AC-3 is met. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `promptCodeReview` contains the canonical rule in first-round and round-N renders; `tests/run-task-prompts.test.ts` covers both and the golden snapshots were regenerated. |
| AC-2 | Met | `tests/run-task-safety-scaffold-push.test.ts` confirms a broken review reference triggers a reviewer resume, is fixed, and routes `changes_requested` to implement. |
| AC-3 | Met | Zero-exit and failed-exit verdict flips both leave code review blocked, record the task and both verdicts, and route nothing. |
| AC-4 | Met | An outside-artifact edit is reported and code review is auto-blocked. |
| AC-5 | Met | Missing reviewer session warns with findings and the `--pr` recovery instruction, then continues. |
| AC-6 | Met | `spec_gap` receives fix-up before stopping; a reviewer-blocked review starts no fix session and uses the existing stop. |
| AC-7 | Met | The code-review fix-up prompt avoids commit-after-turn wording and forbids changes to verdict checkboxes and findings; its golden is covered. |
| AC-8 | Met | Raw cold-Codex output and one- and multi-digit prior-review archives pass; the live review remains a negative control that fails. |
| AC-9 | Met | Both documentation copies describe the fix-up, auto-block guard, and reviewer-session resumption. |
| AC-10 | Met | The recovery test confirms the incomplete foreman return gets no fix-up, the recovery session writes the review, then one reviewer fix-up runs before routing. A recovery-session verdict change auto-blocks. |
| AC-11 | Met | `tests/docs-refs-check.test.ts` archives a broken review through `archivePriorReview`, writes a clean live review, and verifies no findings remain. |

## Edge Cases Considered

- Round 1 and round-N prompts carry the citation rule.
- A blocked review skips fix-up; `spec_gap` receives fix-up before its stop.
- No stored session warns and continues; a failed fix session still runs the verdict guard.
- Verdict changes and edits outside the review artifact auto-block the whole bundle.
- Both review-artifact writers are covered: the foreman and the one-shot recovery session.
- Interactive runs and missing session IDs do not resume a stale stored reviewer session.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-2 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='code-review docs-refs fix-up resumes' tests/run-task-safety-scaffold-push.test.ts` | `bbaa053` | Failed because no `Artifact fix-up (attempt 1/2)` line appeared; the run routed directly to implement with the broken reference still present. | Targeted test passes; full `npm test` passes. |
| AC-10 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='review recovery fix-up runs only after the one-shot reviewer recovery' tests/run-task-safety-scaffold-push.test.ts` | `bbaa053` (`src/orchestrator/main.ts` loaded from base) | Failed because the expected one fix-up log entry was absent (`0 !== 1`) after recovery completed. | Recovery test passes; full `npm test` passes. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | AC-2 and AC-10 pre-fix failures are recorded above. Added safety cases pin verdict changes after successful and failed sessions, outside-file edits, no-session continuation, `spec_gap`, reviewer-blocked, recovery fix-up, and recovery verdict blocking. Checker tests include the live-review negative control. Full suite passed after snapshot regeneration. |
| Restatement sweep | Searched `ARTIFACT_CITATION_RULE`, `promptArtifactFixup`, review archive names, and fix-up/session call sites across prompt sources, orchestrator, checker, docs, and tests. Updated the foreman template, both checker and documentation copies, and prompt goldens. The recovery-hint registry in `tests/recovery-hints.test.ts` is outside the affected-file list; the shared reset builder keeps its registered source site unique, and the registry test passes. |
| Sibling parity | Confirmed implement and QA retain their default stop behavior. Both code-review writers (the normal phase and `retryAgentForPhase` recovery) reach the same fix-up helper; blocked reviews return before the recovery path. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `UPDATE_GOLDENS=1 npm test` | Pass | 2,173 passed, 1 skipped, 0 failed. |
| `npm test` | Pass | 2,173 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Tracked orchestrator bundle rebuilt. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | Canon-managed files are synchronized. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
