# Implementation Handoff: prompt-fidelity-tests

> Author: Codex | Spec: `tasks/prompt-fidelity-tests/spec.md` | Plan: `tasks/prompt-fidelity-tests/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/state.ts` | `taskDirFor()` and `statusFileFor()` now honor `CANON_TASKS_DIR_OVERRIDE` at call time so temp fixture tasks resolve correctly. |
| `scripts/run-task/context.ts` | `buildKnownPitfalls()` now honors `CANON_PATTERNS_MD_PATH` so the test suite can read a fixed stub instead of live `docs/patterns.md`. |
| `tests/fixtures/patterns.stub.md` | Added deterministic `## Known Pitfalls` content for the prompt-fidelity snapshots. |
| `tests/run-task-prompts.test.ts` | Added the 10-case prompt-builder regression suite, temp fixture setup/teardown, normalization, and `UPDATE_GOLDENS` regeneration support. |
| `tests/run-task-prompts.golden.json` | Added committed normalized snapshots for every builder/variant the spec requires. |
| `tasks/prompt-fidelity-tests/notes.md` | Recorded the worktree-path portability note discovered while wiring the suite. |
| `tasks/prompt-fidelity-tests/status.json` | Task-phase bookkeeping is already advanced in the worktree and will be finalized by the orchestrator's phase transition. |
| `tasks/prompt-fidelity-tests/handoff.md` | Corrected Validation Outcomes check names to match spec format (inline fix by reviewer). |
| `tasks/prompt-fidelity-tests/review.md` | Added Stage 1 inline-fix documentation and round 1 review. |

## Intent & Rationale

This rebuild restores regression coverage for the prompt builders without baking machine-specific paths or live-doc content into the snapshots. The test suite creates a temp task fixture, swaps the task-dir and patterns-doc reads to that fixture, normalizes the repo root placeholder, and compares all prompt-builder variants against committed goldens. When a prompt template or helper changes intentionally, `UPDATE_GOLDENS=1 npm test` refreshes the baseline.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| The fixture `spec.md` used for prompt snapshots includes a real `## Validation Required` section instead of omitting it. | That makes the `promptImplement*` snapshots exercise `extractValidationChecks()` and keeps the prompt output representative of a real task. | None; it only makes the coverage stricter. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `taskDirFor()` and `statusFileFor()` read `CANON_TASKS_DIR_OVERRIDE` at call time | Met | `scripts/run-task/state.ts:7-21` now routes temp fixture tasks through the override before falling back to the normal worktree-aware path. |
| AC-2: `buildKnownPitfalls()` reads `CANON_PATTERNS_MD_PATH` when set | Met | `scripts/run-task/context.ts:56-65` now reads the stub file path from the env var and keeps the regex/format unchanged. |
| AC-3: `tests/run-task-prompts.test.ts` covers all 10 builder calls | Met | The suite exercises `promptSpec`, `promptSpecRevision`, `promptSpecReview`, `promptPlan`, `promptImplement` fresh, `promptImplementRevisions`, `promptImplementReroute`, `promptCodeReview` round 1, `promptCodeReview` round N, and `promptQa`. |
| AC-4: fixture setup uses `mkdtempSync`, env overrides, normalization, and cleanup | Met | The test creates all fixture files in a temp dir, sets both env vars before any prompt builder runs, replaces the live repo root with `<REPO_ROOT>`, and removes the temp dir in `after()`. |
| AC-5: committed goldens use builder+variant keys and no absolute paths | Met | `tests/run-task-prompts.golden.json` contains one key per case and the snapshots are normalized to `<REPO_ROOT>`. |
| AC-6: `UPDATE_GOLDENS=1` regenerates goldens and skips assertions | Met | The suite records normalized output into the golden map and writes it back on teardown when `UPDATE_GOLDENS=1`; the file comment in the test explains the regeneration workflow. |
| AC-7: `npm test` passes on a clean checkout | Met | Final clean rerun passed after the goldens were regenerated. |

## Edge Cases Considered

- The snapshot file path itself must be worktree-relative, because `REPO_ROOT` resolves to the canonical checkout root in this environment.
- The temp task fixture uses an empty `Affected Files` table, but a real `Validation Required` section, so prompt output stays deterministic while still exercising the implement prompt's validation summary.
- `promptCodeReview` round N only needs `status.json` and the task-context `iterations` field to switch templates; the handoff/review stubs are present for realism, but the builder output does not depend on their full contents.

## Blockers

- (none)

## Validation Outcomes

> All applicable checks must pass before submitting for review. If a check appears in spec.md's Validation Required section, it must be recorded as Pass or Fail here — do not mark a required check N/A. Use N/A only for checks that the spec did not require, and explain why in Notes. Failed checks must be fixed — do not submit with failures. Move unresolved failures to Blockers.

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Clean run after the prompt-suite and harness patches. |
| `type-check` (`npm run type-check`) | Pass | Clean run after the prompt-suite and harness patches. |
| `test` (`npm test`) | Pass | Final clean rerun passed after the `UPDATE_GOLDENS=1` bootstrap regenerated `tests/run-task-prompts.golden.json`. |
| `E2E` | N/A | Not required by the spec. |
| `build` | N/A | Not required by the spec. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`
