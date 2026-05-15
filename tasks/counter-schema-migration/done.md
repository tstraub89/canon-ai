# QA Summary: counter-schema-migration

> Task: Status counter schema migration (iterations_current_loop + iterations_total + 3 sibling fields)
> Size: L | Review: 2 rounds | Final verdict: approved_with_nits

## What Changed

Each of the three iterative phase blocks (`spec_review`, `code_review`, `runtime_validation`) in `tasks/_templates/status.json` now carries four new fields:

| Field | Semantics |
|---|---|
| `iterations_current_loop` | Replaces the loop-local meaning of the old `iterations` field. Resets to 0 on `approved`/`approved_with_nits`. |
| `iterations_total` | Monotonic count of every verdict produced by the phase across all loops and reroutes. Never resets. |
| `changes_requested_total` | Count of `changes_requested`/`needs_re_review` verdicts across the task's lifetime. Never resets. |
| `auto_block_count` | Count of auto-blocks for this phase across the task's lifetime. Never resets. |

The legacy `iterations` field is kept as a write-through alias for `iterations_current_loop`, so existing in-flight tasks and tools reading the old field keep working at lower fidelity with no migration required.

**Bug fix included**: The PR #37 P2 deferred bug is closed. `runtime-validation.ts` used the loop counter (`iterations === 0`) to decide whether to write a new `## Runtime Validation Outcomes` h2 baseline or append a `### Re-run runtime validation` h3. After an approved pass followed by a reroute, the loop counter was back to 0, causing a second h2 baseline that shadowed the first. The fix switches that branch to `iterations_total === 0` (cumulative, never-resets), so re-runs always append under the existing baseline.

## Files Changed

| File | Change |
|---|---|
| `tasks/_templates/status.json` | Added 4 new fields + kept `iterations` alias on all 3 iterative phase blocks |
| `scripts/task.sh` | Rewrote `cmd_phase` jq filter to write all 4 fields per verdict; updated `cmd_reset_spec_review` to zero only `iterations_current_loop`, preserving cumulative counters |
| `scripts/run-task/types.ts` | Added optional new fields to `PhaseEntry`; added `iterations_current_loop`, `iterations_total` (and runtime equivalents) to `TaskContext` |
| `scripts/run-task/state.ts` | `autoBlockPhase` now increments `auto_block_count`; `effectiveWorktreesRoot()` reads `CANON_WORKTREES_ROOT` at call time (injectable) |
| `scripts/run-task/main.ts` | `getIterations` + `buildPipelineState` use new fields with back-compat `?? iterations ?? 0` fallback |
| `scripts/run-task/context.ts` | `maxCodeReviewIter` uses `iterations_current_loop` |
| `scripts/run-task/phases/spec-review.ts` | Loop-cap math + auto-block message + `autoBlockSpecReview` delegate to shared counter path |
| `scripts/run-task/phases/code-review.ts` | Loop-cap math and auto-block message use `iterations_current_loop` |
| `scripts/run-task/phases/runtime-validation.ts` | `setRuntimeValidationPhase` writes all 4 fields; `priorIterations` source switches to `iterations_total` (PR #37 P2 fix); artifact-directory numbering uses `iterations_current_loop` |
| `scripts/run-task/phases/implement.ts` | `shouldUseImplementRevision` and revision-display use `iterations_current_loop` |
| `scripts/run-task/phases/spec.ts`, `plan.ts`, `qa.ts` | Telemetry display reads `iterations_current_loop` with legacy fallback |
| `tests/run-task-counter-schema.test.ts` | New — jq counter transitions, auto-block helpers, legacy-iteration backfill, spec-review reset |
| `tests/run-task-runtime-validation.test.ts` | Updated to assert cumulative counter behavior and the h3 rerun path (PR #37 P2 regression test) |
| `tests/run-task-prompts.test.ts` | Fixture updated to populate and normalize new `TaskContext` counter fields |

## How to Test

Follow the Human Test Plan from the spec:

1. **Back-compat check**: Open any existing `tasks/_archive/*/status.json`. It should still parse as valid JSON and the pipeline reads `iterations_current_loop ?? iterations ?? 0` gracefully for all the old fields.

2. **New task fields**: Run a small task through the pipeline. After `spec_review` produces its first verdict, check `tasks/<id>/status.json` under `phases.spec_review` — you should see `iterations_current_loop`, `iterations_total`, `changes_requested_total`, and `auto_block_count` all present.

3. **Iteration semantics**: Force a `code_review` `changes_requested` round, then approve. After approval, verify: `iterations_current_loop = 0`, `iterations_total = 2` (incremented on both the `changes_requested` verdict and the `approved` verdict), `changes_requested_total = 1`.

4. **Auto-block counter**: Trigger a `MAX_REVIEW_LOOPS` auto-block. After the block, verify `phases.<phase>.auto_block_count = 1` and `escalations` has an entry. Raise the cap and approve — confirm `auto_block_count` stays at 1 (does not reset).

5. **PR #37 P2 regression**: Simulate an approved-then-rerouted `runtime_validation`. After the second runtime pass, the handoff should have a `### Re-run runtime validation` h3 appended inside the existing `## Runtime Validation Outcomes` section — not a second `## Runtime Validation Outcomes` h2 baseline.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | **125 pass, 0 fail** (118 pre-existing + 7 new counter-schema tests) |
| E2E | N/A |
| Build | N/A (no compile step) |

Round 1 failed Stage 1: `npm test` was failing because the runtime-validation regression fixture tried to write directories under the supervising checkout (outside the writable sandbox). Iteration 2 fixed this by making `resolveTaskCwd()` read `CANON_WORKTREES_ROOT` at call time and building the fixture mirror inside the current worktree.

## Decisions Made

- **Option B (full consumer migration)**: every call site in the Consumer migration table was updated to use the explicit `_current_loop` or `_total` field rather than relying on the alias. Aliases remain for any unlisted consumers.
- **`iterations_total` increments on approved too**: a first-pass approval must increment `iterations_total` to 1 so the subsequent-pass check (`iterations_total === 0` → new baseline) evaluates correctly. Counting only failures would leave `iterations_total = 0` after a clean first run and re-trigger the PR #37 shadowing bug.
- **`autoBlockSpecReview()` delegates to `autoBlockPhase()`** rather than duplicating the counter increment inline. Both paths are independently tested.
- **Shell-test workaround**: `task.sh` doesn't honor `CANON_TASKS_DIR_OVERRIDE`, so `tests/run-task-counter-schema.test.ts` runs from a temp cwd that contains a `tasks/` subtree mirrored from the worktree.

## Open Questions / Follow-ons

- **`cwd: 'repo_root'` test gap** (non-blocking nit from round 2): `resolveTaskCwd()`'s `repo_root` resolution path is no longer exercised in the test suite after the sandbox fix replaced that case with a second `cwd: 'worktree'` case. A follow-up test using an explicit env-swap mock would restore full path coverage.
- **Auto-block recovery message** still instructs "set `phases.<phase>.iterations = 0`" — the correct recovery is now `iterations_current_loop = 0` (preserving total). A one-line doc tweak in the orchestrator error text; explicitly out of scope per Non-Goals.
- **`verdict_source` field** (agent / human / auto_fast_tier) was dropped from this task's scope. Tracked in BACKLOG.

---

## Proposed Changelog

**Audience**: internal (canon-ai contributors). Format: Keep a Changelog.

**Proposed version**: `0.4.0` — minor bump. New observable fields added to every iterative phase; runtime-validation double-baseline bug fixed. No existing `status.json` files break; back-compat shim handles in-flight tasks without manual migration. New template fields seed automatically for tasks created after this lands.

```markdown
## [0.4.0] — 2026-05-11

### Added

- Five new fields on iterative phase blocks in `status.json` (`spec_review`, `code_review`, `runtime_validation`): `iterations_current_loop` (loop-local, resets on approval), `iterations_total` (monotonic across all loops and reroutes), `changes_requested_total`, and `auto_block_count`. The legacy `iterations` field stays as a write-through alias. All new fields seed at 0; in-flight tasks get them filled in on the next `task.sh phase` write — no manual migration needed.
- Template `tasks/_templates/status.json` updated to seed all four new fields on new-task creation.

### Fixed

- **Runtime-validation double-baseline** (PR #37 P2 deferred): after an approved runtime pass followed by a code-review reroute, a second `## Runtime Validation Outcomes` h2 was written, shadowing the original and silently hiding new failures. The write-path branch now uses `iterations_total` (never resets) instead of the loop counter, so re-runs always append a `### Re-run runtime validation` h3 under the existing baseline.
- `autoBlockSpecReview()` now increments `phases.spec_review.auto_block_count` consistently with the shared `autoBlockPhase()` path — spec_review auto-blocks were previously undercounted.
- `cmd_reset_spec_review` now zeros only `iterations_current_loop`, preserving `iterations_total`, `changes_requested_total`, and `auto_block_count` across spec-review resets.
```

> Human: review proposed copy and version bump before the changelog commit lands.
