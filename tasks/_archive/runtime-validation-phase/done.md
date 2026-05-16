# QA Summary: runtime-validation-phase

> **Superseded** by docs/decisions.md "Validation runs inside agent phases (supersedes orchestrator-run runtime_validation)" — 2026-05-15. The phase shipped in this task is retired by task retire-runtime-validation.

> Authored by: Claude | Phase: qa | Date: 2026-05-11

## What Changed

A new **`runtime_validation`** pipeline phase was added between `implement` and `code_review`. The orchestrator — not Codex — runs a registered list of shell checks against the worktree after every implement step, captures their output with full-fidelity disk logging and bounded in-memory summaries, writes results into a new `## Runtime Validation Outcomes` section in `handoff.md`, and routes failures back to `implement` with the same loop-cap semantics as `code_review`.

The motivation: Codex's sandbox cannot run browser-based e2e tests, dev servers, or anything requiring network access to live services. Before this change, projects (gallery_wall being the concrete example) had no clean path — marking required checks `Pass` without running them was a silent lie; marking `Fail` auto-blocked the pipeline. Now those checks run from the orchestrator's environment, which has full filesystem and network access.

**Key design decisions made during spec review:**

- Status stays `'done'` even on failure, mirroring `code_review` so `checkAndRoute`'s existing completion guard passes before examining the verdict.
- Two independent capture sinks per stream: an unbounded disk file (`stdout.log` / `stderr.log`) for artifacts and prompt content, and a 2KB head-bounded in-memory buffer for handoff excerpts. These are not in tension — the disk sink is authoritative; the buffer is display-only.
- Cleanup uses a pre/post `git status --porcelain` delta instead of blanket `git stash` to avoid erasing uncommitted task artifacts (`handoff.md`, `notes.md`) that live in the worktree between pipeline phases.
- Declared `artifactPaths` on a check bypasses git-status visibility entirely — required for e2e runners that write traces and screenshots to gitignored directories (`test-results/`, `playwright-report/`).
- `TaskContext.runtimeIterations` is a new separate counter from `code_review.iterations` so the implement-revision prompt is selected correctly on a first runtime-only failure (when `code_review.iterations` is still 0).

## Files Changed

21 files changed (1252 insertions, 69 deletions); 2 new files created:

| File | Change summary |
|---|---|
| `scripts/run-task/phases/runtime-validation.ts` | **NEW** — main phase dispatcher |
| `tests/run-task-runtime-validation.test.ts` | **NEW** — full test suite |
| `scripts/run-task/types.ts` | `runtime_validation` in `PHASE_ORDER`; `TaskContext.runtimeIterations` |
| `scripts/run-task/main.ts` | Dispatch wiring, `checkAndRoute` case, `getVerdict()` widening, `buildPipelineState()` |
| `scripts/run-task/phases/implement.ts` | `isRevision` uses both iteration counters; exports `shouldUseImplementRevision()` test seam |
| `scripts/run-task/prompts/index.ts` + `implement-revisions.md` | Three-shape conditional template (review-only / runtime-only / both) |
| `scripts/run-task/validation.ts` | `computeLatestRuntimeResults()` latest-wins parser |
| `scripts/run-task/state.ts` | Back-compat shim for status files missing the new phase block |
| `scripts/run-task/env.ts` | Repo root via `git rev-parse --show-toplevel` for linked worktrees |
| `scripts/run-task/context.ts` | Implement state text for runtime-only and combined revision modes |
| `scripts/pipeline-policy.ts` | `RuntimeCheck` type + `RUNTIME_CHECKS` export; `orchestrator-phase-smoke` example |
| `scripts/task.sh` | Recognizes `runtime_validation` in phase validation, derived status, verdicts, iteration handling |
| `tasks/_templates/status.json` | New `phases.runtime_validation` block |
| `tasks/_templates/handoff.md` | Hint comment for `### Re-run runtime validation` subsections |
| `AGENTS.md`, `CLAUDE.md`, `CODEX.md` | Document the new phase and authority boundary |
| `docs/pipeline-orchestrator.md` | Registration API, routing, artifact policy, timeout policy |
| `.gitignore` | `tasks/*/runtime-check-output/` excluded from git history |
| `tests/pipeline-policy.test.ts` | Pins canon-ai smoke check registration |

## How to Test

**1. Confirm the registration exists**

```
grep -n "orchestrator-phase-smoke" scripts/pipeline-policy.ts
```

Expect: a `RUNTIME_CHECKS` export containing `{ name: 'orchestrator-phase-smoke', command: "echo orchestrator-phase-smoke-ok" }`.

**2. Run the test suite**

```
npm test
```

Expect: 103 tests pass, including `tests/run-task-runtime-validation.test.ts`.

**3. Live end-to-end — passing check**

Run any small canon-ai task through the pipeline. Watch the log for:

```
[runtime_validation] Running orchestrator-phase-smoke...
orchestrator-phase-smoke-ok
[orchestrator-phase-smoke finished in X.Xs with exit code 0]
```

Then check the task's `handoff.md` for a `## Runtime Validation Outcomes` section with one Pass row. Confirm the pipeline advances to `code_review`.

**4. Live end-to-end — failing check (forced)**

Temporarily change the smoke check command to `false` in `scripts/pipeline-policy.ts`, then run a task. Expect: `runtime_validation` writes a Fail row, increments `runtime_validation.iterations`, and routes back to `implement`. Codex's iteration 2 prompt should contain a `## Runtime check failures to address` section. Restore the command after testing.

**5. Back-compat — existing task status files**

Open any existing `tasks/*/status.json` that does not have a `phases.runtime_validation` block. Confirm the orchestrator treats it as `done/approved` and does not corrupt the file.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (103 tests) | Pass |
| E2E | N/A (no browser tests in canon-ai) |
| Build | N/A (no compile step) |

## Decisions Made

- **`changes_requested` reused (not a new verdict variant)**: Keeps `Verdict` type strict; `checkAndRoute` already handles it.
- **Empty registry → silent no-op**: no `## Runtime Validation Outcomes` section is written, avoiding visual noise on projects that haven't registered any checks.
- **`task.sh` still the CLI surface**: `runtime_validation` was added to all relevant `task.sh` case statements so manual transitions remain supported, even though the phase module uses direct `readStatus`/`writeStatus` calls at runtime.
- **`env.ts` uses `git rev-parse --show-toplevel`**: the previous common-dir approach resolved to the supervising checkout root in linked worktrees, breaking worktree-local artifact placement.

## Open Questions

None — all spec ACs met, no blockers.

---

## Proposed Changelog

**Proposed version bump: `0.3.0 → 0.4.0` (minor)**

Rationale: new pipeline phase, new `pipeline-policy.ts` registration API, new `TaskContext.runtimeIterations` field, new `tasks/_templates/status.json` shape. All new features, no breaking changes to existing usage. Existing status files without `phases.runtime_validation` are handled by a back-compat shim.

### Proposed entry for `## [0.4.0]`

#### Added

- New **`runtime_validation`** pipeline phase between `implement` and `code_review`. The orchestrator runs registered shell checks (e2e suites, deploy smoke tests, anything requiring a browser or live service) and writes results to a `## Runtime Validation Outcomes` section in `handoff.md`. Failures route back to `implement` with captured output in the revision prompt, using the same loop-cap semantics as `code_review`.
- `RUNTIME_CHECKS: RuntimeCheck[]` registry in `scripts/pipeline-policy.ts`. Projects register project-specific runtime checks there; canon-ai ships an `orchestrator-phase-smoke` example. `RuntimeCheck` supports per-check `timeoutMs`, `cwd`, `when()` predicate, declared `artifactPaths`, and `artifactReadingHint`.
- Full-fidelity check output captured to `tasks/<id>/runtime-check-output/<check>/iter-N/` on failure. Codex's revision prompt includes the first 2KB of stderr; the full log is on disk for direct inspection.
- Back-compat shim: status files missing `phases.runtime_validation` are treated as `done/approved` — no migration of existing tasks required.
