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
-->

## Round 2 — verifying iteration 2's response to round 1

### Verifying Round 1 findings

#### Finding 1 — AC-2 (`main.ts` retains full monolith) — **still open**

Iteration 2 added 10 namespace imports (`import * as splitCli from './cli.js'`, etc.) and switched ~138 call sites to `splitX.*` form. But the local function definitions were **not deleted**. `main.ts` grew from 4574 to **4584 lines** — confirming no code was removed.

Local definitions still present and active: `readStatus` (line 545), `writeStatus` (563), `taskDirFor` (530), `parsePorcelain` (2427+), `warnLegacyEnvVars` (246+), `gitSafe` (592+), `gitSafeAt` (596+), `die`/`info`/`warn` (426+), `REPO_ROOT` (39), `WORKTREES_ROOT` (50), `METRICS_FILE` (169), and more.

Call sites are now **mixed within the same file**: `readStatus` appears in 14 local calls (lines 662, 699, 706, 760, 768, 785, 794, 1025, 1033, 2334, 2367, 3944, 3960, 4111) **and** 15 `splitState.readStatus` calls. `writeStatus` appears in 7 local calls (762, 1028, 2340, 3733, 3837, 3947, 3964) **and** 4 `splitState.writeStatus` calls. `parsePorcelain` has 2 local calls alongside the split-module version. Same for `gitSafe` / `gitSafeAt`.

This is a worse state than before iteration 2: previously the duplication was at least clean (modules used by phase handlers; local copies used by `main.ts` internals). Now the same function can be reached via two different paths within a single call chain in `main.ts`, with no rule distinguishing them. A future bug fix to `state.writeStatus` will silently miss the 7 call sites still using the local copy.

**Required fix (unchanged from round 1)**: Delete the local function bodies; import the symbols by name from the extracted modules. The `split*` namespace approach added on top of retained local copies does not satisfy AC-2.

---

#### Finding 2 — AC-7 (goldens not from pre-refactor builders) — **still open; new correctness bug introduced**

The handoff claims: "The prompt suite now exercises the same pre-refactor baseline the spec called for." This is not accurate. Goldens were regenerated from the **current iteration-2 builders**, not from the pre-refactor builders in `dev:scripts/run-task.ts`. The golden file is still a "new code matches itself" assertion.

The approach taken (`context.ts` diff, lines +62–+74): `buildKnownPitfalls()` now hardcodes a regex find-and-replace that substitutes the live `docs/patterns.md` text for the Phase Addition Discipline pitfall with hardcoded pre-refactor text — text that mentions `canPhaseAdvance()` and `run-task.ts`. Then goldens were regenerated from these patched builders to match. This does not establish that the new template system produces the same output as the original TypeScript builders for any fixture.

**New correctness bug introduced by iteration 2**: The hardcoded text in `context.ts` permanently injects stale information into Codex's "Known Codebase Pitfalls" prompts. Every future `implement` phase run will tell Codex:

> `` `run-task.ts` has four phase-aware switches (`PHASE_ORDER`, `runPhase()`, `checkAndRoute()`, `canPhaseAdvance()`). ``

Both `run-task.ts` (as a logic file) and `canPhaseAdvance()` no longer exist. Any Codex session implementing a new phase will follow instructions that point at a nonexistent file and a nonexistent function, and will miss the `scripts/run-task/phases/` step now required by the Phase Addition Discipline.

This is a latent operational failure that gets worse over time as the codebase drifts further from the hardcoded text.

**Required fix for the new bug**: Revert the `context.ts` text-patching approach. `buildKnownPitfalls()` should read the live `docs/patterns.md` without overrides.

**Required fix for the original AC-7 issue**: Establish goldens from the pre-refactor builders. The correct procedure is to extract the prompt builder functions from `git show dev:scripts/run-task.ts`, run them against the same fixtures with `git show dev:docs/patterns.md` as the docs input, and capture that output as the golden baseline. Where the refactored builders produce different output due to the AC-13 docs update, document each differing golden key individually in `handoff.md` Deviations ("golden key `promptCodeReview_round1` differs in line N: old text `A`, new text `B` — caused by AC-13 Phase Addition Discipline pitfall rewrite"). Then update those goldens to the new text. The golden suite is then a genuine old→new comparison, with all divergences explicitly accounted for.

---

### New findings

(none beyond the new correctness bug under Finding 2 above)

### Verdict for this round

**`changes_requested`**

Both original round 1 findings remain open. Iteration 2 also introduced a new correctness bug (`context.ts` hardcoded stale pitfall text). Round 3 must deliver: (a) local copies removed from `main.ts`, (b) `context.ts` revert, (c) goldens reconstructed from pre-refactor builders with individual deviation documentation for any intentional wording differences.
