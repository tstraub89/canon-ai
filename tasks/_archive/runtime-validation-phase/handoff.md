# Implementation Handoff: runtime-validation-phase

> Author: Codex | Spec: `tasks/runtime-validation-phase/spec.md` | Plan: `tasks/runtime-validation-phase/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `.gitignore` | Ignores `tasks/*/runtime-check-output/` runtime artifacts. |
| `AGENTS.md` | Documents the runtime validation phase and the validation authority boundary. |
| `CLAUDE.md` | Updates code-review guidance to account for orchestrator-authored runtime results. |
| `CODEX.md` | Updates implement/revision guidance for runtime validation failures and artifacts. |
| `docs/pipeline-orchestrator.md` | Documents runtime validation registration, routing, artifacts, cleanup, and timeout policy. |
| `scripts/pipeline-policy.ts` | Adds `RuntimeCheck` and the `RUNTIME_CHECKS` smoke registry. |
| `scripts/run-task/context.ts` | Updates implement state text for runtime-only and combined revision modes. |
| `scripts/run-task/env.ts` | Resolves `REPO_ROOT` with `git rev-parse --show-toplevel` so linked worktrees run against their own root. |
| `scripts/run-task/main.ts` | Wires `runtime_validation` into dispatch, routing, dry-run text, and `TaskContext.runtimeIterations`. |
| `scripts/run-task/phases/implement.ts` | Treats runtime-validation reroutes as implement revisions and exports the tested selector helper. |
| `scripts/run-task/phases/runtime-validation.ts` | Adds the orchestrator-owned runtime validation phase implementation. |
| `scripts/run-task/prompts/index.ts` | Adds runtime-failure prompt entries sourced from latest handoff rows plus full stderr logs. |
| `scripts/run-task/prompts/templates/implement-revisions.md` | Makes revision prompts conditional for review-only, runtime-only, and combined feedback. |
| `scripts/run-task/state.ts` | Adds back-compat shim for status files missing `phases.runtime_validation`. |
| `scripts/run-task/types.ts` | Inserts `runtime_validation` into `PHASE_ORDER` and adds `TaskContext.runtimeIterations`. |
| `scripts/run-task/validation.ts` | Adds `computeLatestRuntimeResults` for latest-wins runtime result parsing. |
| `scripts/task.sh` | Recognizes `runtime_validation` in phase validation, derived status, verdicts, and iteration handling. |
| `tasks/_templates/handoff.md` | Notes that the orchestrator may append `### Re-run runtime validation` subsections. |
| `tasks/_templates/status.json` | Adds the default `runtime_validation` phase block. |
| `tests/pipeline-policy.test.ts` | Pins the canon-ai smoke runtime check registration. |
| `tests/run-task-runtime-validation.test.ts` | Adds runtime validation phase, artifact, cleanup, prompt, timeout, and streaming coverage. |

## Intent & Rationale

The implementation adds a dedicated orchestrator phase between implement and code review. Runtime checks are registered in `scripts/pipeline-policy.ts`, run with streaming subprocess output and bounded handoff summaries, and write an orchestrator-owned `## Runtime Validation Outcomes` section only when checks actually run.

The routing mirrors code review: pass advances to code review, Fail/Timeout marks `runtime_validation` done with `changes_requested`, increments its own iteration counter, and routes back to implement with runtime failure context in the next Codex prompt.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Runtime validation updates status with `readStatus()` / `writeStatus()` instead of shelling through `task.sh`. | The phase is orchestrator-owned and direct writes avoid shell-path coupling in tests and linked worktrees. `task.sh` still supports manual `runtime_validation` transitions. | None; AC-4/AC-6 require the phase module to set status/verdict, which it does. |
| `scripts/run-task/env.ts` now uses `git rev-parse --show-toplevel` for `REPO_ROOT`. | The old common-dir parent logic resolves to the supervising checkout in linked worktree tests, which makes worktree-local runtime checks and artifacts target the wrong root. | Supports AC-10 cwd/worktree tests and AC-11 artifact placement. |
| Added `shouldUseImplementRevision()` in `implement.ts`. | This keeps the runtime-iteration revision-mode decision directly testable without invoking Codex. | Supports AC-9b/AC-10; no behavior change beyond the required revision condition. |
| Added private `ORCHESTRATOR_CHECK_HEARTBEAT_MS` test seam. | The production heartbeat remains 30s; tests need a deterministic short interval without waiting 30s. | Supports AC-13 tests only. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `PHASE_ORDER`, `Phase`, `main.ts`, `task.sh`, and status derivation now include `runtime_validation` between implement and code review. |
| AC-2 | Met | New status template includes the orchestrator phase block; `readStatus()` treats missing blocks as done/approved without migrating existing tasks. |
| AC-3 | Met | `RuntimeCheck` and `RUNTIME_CHECKS` are exported from `scripts/pipeline-policy.ts`; canon-ai ships exactly the smoke registration. |
| AC-4 | Met | New `runRuntimeValidationPhase(taskIds, state, checks?)` filters by `when`, runs sequential `spawn` checks, captures output, writes handoff rows, and sets status/verdict. |
| AC-4b | Met | Empty/all-filtered registries mark runtime validation approved/done with zero iterations and do not write a handoff section. |
| AC-5 | Met | Baseline runtime outcomes insert before `## Ready for Review`; retry outcomes append under latest iteration; `computeLatestRuntimeResults()` implements latest-wins parsing. |
| AC-6 | Met | Fail/Timeout sets `changes_requested`, increments `runtime_validation.iterations`, leaves status `done`, and `checkAndRoute()` routes back to implement with max-loop auto-block. |
| AC-7 | Met | Per-check `timeoutMs` wins, `ORCHESTRATOR_CHECK_TIMEOUT_MS` provides the global fallback, timeout kills with SIGTERM then SIGKILL grace and records `Timeout`. |
| AC-8 | Met | Implement-revision prompts include latest failing runtime checks and prefer full `stderr.log` over the 512-byte handoff excerpt. |
| AC-9 | Met | Dispatch runs `runtime_validation` after implement; approved advances to code review, changes requested routes to implement; `getVerdict()` accepts the new phase. |
| AC-9b | Met | `TaskContext.runtimeIterations` is populated and implement revision selection uses code-review or runtime-validation iterations. |
| AC-10 | Met | New runtime validation test suite covers no-op, pass/fail/timeout, filtering, retries, cwd, cleanup, artifacts, prompts, streaming, and revision-mode selection. |
| AC-11 | Met | Failure artifacts are preserved under `tasks/<id>/runtime-check-output/<check>/iter-N/`; cleanup only touches check-induced delta paths outside `tasks/`; runtime artifacts are gitignored. |
| AC-12 | Met | Runtime failure prompts include check name, artifact path, stderr source-order fallback, registry hint, and the required discipline block. |
| AC-12b | Met | Revision template renders valid review-only, runtime-only, and combined prompts with shape-specific banners and append instructions. |
| AC-13 | Met | Checks stream stdout/stderr live, write full logs to disk, keep bounded head buffers for handoff/prompt use, print heartbeat lines, and print final summaries. |

## Edge Cases Considered

- Existing task status files without `runtime_validation` are treated as no-op done/approved.
- Empty registries and all-filtered registries avoid visual handoff noise.
- Runtime-only reroutes get revision prompts even when `code_review.iterations` is zero.
- Timeout, spawn failure, nonzero exit, and large stderr outputs are recorded without unbounded memory growth.
- Declared artifact paths copy gitignored outputs even when `git status` cannot see them.
- Scoped cleanup preserves pre-existing dirty task artifacts and pre-existing dirty source files.
- Missing `stderr.log` falls back to the handoff excerpt with an explicit annotation.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | `eslint scripts/ tests/` |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` |
| `npm test` | Pass | 103 tests passing, including `tests/run-task-runtime-validation.test.ts`. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Working tree inspected with `git status -sb`; no upstream tracking marker was available in this linked worktree

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |

The orchestrator may also append:

### Re-run runtime validation

| Check | Result | Elapsed | Notes |
|---|---|---|---|
| `<runtime check>` | Pass / Fail / Timeout | 0.0s | |
-->
