# Code Review: split-run-task

> Reviewer: Claude | Spec: `tasks/split-run-task/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

## Stage 1 — Spec Compliance

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results — all three checks Pass; N/A entries match spec.
- [x] All checks required by the spec's "Validation Required" section were run.
- [x] No required checks were skipped without justification.

Gate: **PASS**.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `scripts/run-task.ts` ≤ ~30 lines; CLI invocations unchanged | ✅ Pass | 6-line entry point, delegates to `main.ts`. |
| AC-2: Utility modules exist with described responsibilities; `main.ts` scoped to orchestration loop | ❌ **FAIL** | See Finding 1. |
| AC-3: Per-phase handlers under `phases/`; four switches coherent in `main.ts` | ✅ Pass | Phases dispatched via early-return `if`s + phase files. `canPhaseAdvance` absence documented in notes.md; `docs/patterns.md` updated to remove the reference. Acceptable deviation. |
| AC-4: Agent runners under `agents/`; `stream.ts` as typed shared primitive | ✅ Pass | `agents/stream.ts`, `claude.ts`, `codex.ts` wired through phase modules. |
| AC-5: Prompt builders/templates under `prompts/`; Mustache; `toResumePrompt` in `helpers.ts` | ✅ Pass | Builders render from `.md` templates via `renderTemplate()`. `toResumePrompt` lives in `prompts/helpers.ts`. |
| AC-6: `mustache` + `@types/mustache` added; no other new runtime deps | ✅ Pass | `package.json` and lock file updated. |
| AC-7: Goldens captured from pre-refactor builders BEFORE extraction; byte-identity asserted | ❌ **FAIL** | See Finding 2. |
| AC-8: Existing tests import from split modules | ✅ Pass | `run-task-parse-porcelain.test.ts` imports from `git.js`; `run-task-validation.test.ts` imports from `validation.js`. |
| AC-9: lint + type-check + test pass | ✅ Pass | All three reported passing in handoff; validation table confirms. |
| AC-10: Behavior changes recorded | ✅ Pass | Deviations table in handoff covers both items; `canPhaseAdvance` mismatch in `notes.md`. |
| AC-11: `docs/codebase-map.md` updated | ✅ Pass | Module layout described. |
| AC-12: `docs/architecture.md` updated | ✅ Pass | Parser references point at new module paths. |
| AC-13: `docs/patterns.md` file references updated | ✅ Pass | Trigger Table and pattern entries updated to new module paths. |
| AC-14: `AGENTS.md` and `CLAUDE.md` unchanged | ✅ Pass | Neither file was edited. |

### Dropped Sections Check

- [x] Non-goals respected — no behavior changes introduced, no new CLI agents, `pipeline-policy.ts` untouched.
- [x] Known Risks documented — all five risk items have visible handling in the implementation.
- [x] Human Test Plan satisfiable — smoke steps, diff stats check, and template readability steps are all achievable with the delivered artifact.

### Stage 1 findings

#### Finding 1 — `correctness bug` (AC-2) — `main.ts` is still the full monolith; extracted modules not imported by main orchestration path

`main.ts` is **4574 lines** — larger than the original `scripts/run-task.ts` (4545 lines). It imports from only `pipeline-policy.ts`, the six phase handlers (`phases/*.ts`), and `PhaseRunResult` from `types.ts`. It does **not** import from any of the other extracted modules. Instead it defines private local copies of every function those modules export:

| Extracted module | Functions duplicated locally in `main.ts` |
|---|---|
| `env.ts` | `REPO_ROOT`, `TASKS_DIR`, `TASK_SH`, `WORKTREES_ROOT`, `STALL_TIMEOUT_MS`, `warnLegacyEnvVars()`, `warnWorktreesRootMismatch()`, `resolveProjectName()` |
| `state.ts` | `taskDirFor()`, `resolveTaskCwd()`, `statusFileFor()`, `readStatus()`, `deriveTopLevelStatus()`, `writeStatus()`, `storeSessionId()`, `getStoredSessionId()` |
| `git.ts` | `runCommand()`, `git()`, `gitSafe()`, `gitSafeAt()`, `gitSafeAtRaw()`, `commitTaskArtifactsToBase()`, `getCurrentBranch()`, `branchExistsLocally()`, `getBaseBranch()`, `parsePorcelain()`, `parsePorcelainEntries()`, and more |
| `worktree.ts` | `worktreePath()`, `isWorktreeEnabled()`, `getActiveCwd()`, `TASK_ARTIFACT_FILES`, `PIPELINE_TELEMETRY_FILES`, and more |
| `metrics.ts` | `METRICS_FILE`, `recordMetric()` |
| `types.ts` | `PHASE_ORDER`, `Phase`, `PhaseStatus`, `Verdict`, `StatusJson`, `TaskContext`, `PipelineState`, `MetricEntry`, and more (as unexported local copies) |
| `cli.ts` | `die()`, `info()`, `warn()`, `printUsage()`, `parseArgs()`, `validateTaskId()` |
| `policy.ts` | `policyConfig()`, `toPolicyInputs()`, `getClaudeConfig()`, `getCodexConfig()`, `detectTier()`, `isPlanCombined()`, `getMaxReviewLoops()` |

Specific duplication confirmed:
- `parsePorcelain` / `parsePorcelainEntries` are `export`ed from both `main.ts` (lines 2406, 2427) AND `git.ts` (lines 181, 201).
- `writeStatus` / `readStatus` / `taskDirFor` appear in both `main.ts` (lines 553, 535, 520) and `state.ts`.

The handoff says "The legacy switch body remains below the early-return dispatch as dead fallback." That is accurate for the `runPhase` switch body. But the utility function duplicates listed above are **active code** — used by `checkAndRoute()`, `autoCommitCode()`, `shipTasks()`, `rerouteFromHumanReview()`, and all their callees, which are `main.ts`-internal functions that call the local copies, not the module exports.

**Net effect**: `main.ts` is still the effective monolith. A future change to (say) `writeStatus` must be made in both `main.ts` and `state.ts` to reach all callers. AC-2 explicitly scopes `main.ts` to "orchestration loop: phase dispatch, the four phase-aware switches, top-level error handling, termination logic" — none of the duplicated utility concerns fall under that description.

**Required fix**: `main.ts` must import the extracted symbols from the modules and delete the local copies. `checkAndRoute`, `autoCommitCode`, `shipTasks`, and their helpers must call `writeStatus` from `./state.js`, `parsePorcelain` from `./git.js`, `PIPELINE_TELEMETRY_FILES` from `./worktree.js`, etc. The `runPhase` dead-code switch body can be deleted in the same pass. After cleanup, `main.ts` should be substantially smaller — on the order of the orchestration loop + the routing functions that truly belong at the top level.

#### Finding 2 — `correctness bug` (AC-7) — Goldens not captured from pre-refactor builders

AC-7 requires: "Capture is step 1 of implementation, before any module extraction begins." The handoff documents the violation: goldens were regenerated after the `docs/patterns.md` edit changed the prompt text.

The spec's Known Risks section anticipated exactly this: "If goldens are captured *after* extraction, they only verify 'the new code matches itself' — useless." The golden suite passes, but it only verifies that the new template system is internally consistent — not that it is faithful to the original TypeScript builders. The transition guarantee is not established.

The `dev` branch retains the pre-refactor `scripts/run-task.ts`. The correct path is:

1. Extract the original prompt-builder functions from `dev:scripts/run-task.ts`.
2. Run them against the same fixtures the test uses.
3. Capture their output as the golden baseline.
4. Run the new template-based builders against the same fixtures.
5. Assert byte identity between steps 3 and 4.

If the `docs/patterns.md` wording change means the old and new builders necessarily produce different output for prompts that embed that content, those divergences must each be listed individually in `handoff.md` Deviations — per the spec's escape hatch ("If any are unavoidable... they must be documented in `handoff.md` Deviations with rationale, and the goldens updated to match"). A blanket "docs changed so goldens moved" statement in the deviations table does not meet this bar.

### Stage 1 Verdict

- [x] **Fail** — two AC failures (AC-2, AC-7).

---

## Stage 2 — Not run — Stage 1 failed

Stage 2 is skipped per protocol. Both failures are structural (not style): AC-2 requires removing ~4000 lines of duplicate function definitions from `main.ts`, and AC-7 requires reconstructing the golden baseline from the pre-refactor code. Stage 2 findings against code that is about to change substantially would not survive the iteration.

---

## Final Verdict

**`changes_requested`**

Two required changes before this can advance to Stage 2 review:

1. **`main.ts` must wire to the extracted modules** — delete the local duplicate implementations and import from `state.js`, `git.js`, `env.js`, `worktree.js`, `metrics.js`, `cli.js`, `policy.js`, and `types.js`. The `runPhase` dead-code switch body should be removed in the same pass. Target: `main.ts` shrinks to the orchestration loop described in AC-2.

2. **Goldens must be reconstructed from pre-refactor builders** — use the original TypeScript builders from `dev:scripts/run-task.ts` to produce the golden baseline for the same fixtures. Document any wording divergences caused by the `docs/patterns.md` change individually in `handoff.md` Deviations.

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
