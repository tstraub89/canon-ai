# Spec: split-run-task — Split run-task.ts monolith into modules

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`scripts/run-task.ts` has grown to **4545 lines and 152 top-level declarations** in a single file. It has crossed the threshold where structure helps more than it costs:

- Reading is scroll-and-search, not navigation. New contributors (and agents) cannot orient quickly.
- Editing one concern routinely requires touching unrelated declarations to find a stable insertion point.
- The phase-prompt builders (~700 lines) interleave durable prose with conditional composition logic. Editing a prompt's wording requires reading TypeScript control flow rather than reading the prompt as a document.
- The file mixes orthogonal concerns: phase-prompt construction, git plumbing, worktree management, agent process I/O, validation parsing, status I/O, metrics, CLI parsing, and the orchestration loop itself.
- Anticipated growth (additional CLI agent runners — Gemini, others) would extend the monolith further along an axis where per-runner files are the natural shape.

The file is harness code — every pipeline run depends on it — so the refactor must be mechanical, type-driven, and free of behavior changes. The goal is to land the new structure with the pipeline behaving identically, then let later tasks evolve the code under the cleaner shape.

## Decision

Split `scripts/run-task.ts` into a directory of focused modules under `scripts/run-task/`, with `scripts/run-task.ts` retained as a **thin entry point** (parses args, calls `main()` from `scripts/run-task/main.ts`) so the user-facing invocation `npx tsx scripts/run-task.ts <id>` and the npm script `run-task` continue to work unchanged.

Phase prompts move from inline TypeScript builder functions to **Mustache templates** (`.md` files under `scripts/run-task/prompts/templates/`) rendered through a thin `renderTemplate(template, view)` adapter. Builder functions in `scripts/run-task/prompts/index.ts` shrink to data preparation + template selection + render — no embedded prose. Variant prompts (round 1 vs round N, fresh vs resume) become **separate template files** picked by the dispatcher rather than super-conditional templates.

Mustache is logic-less by design. That is the point: it forces "complex conditional → split into a separate template file" as the path of least resistance, which is exactly the discipline we want.

The behavior of every code path stays identical. The output of every prompt stays byte-identical to the current TypeScript implementation, verified by a golden-output test suite that captures the current rendering **before** the refactor begins.

## Non-Goals

- **No behavior changes.** Every code path produces identical output to today, with the narrow exceptions in the Behavior-Change Policy section of the Acceptance Criteria.
- **No bug fixes opportunistically rolled in.** Bugs spotted during the work are noted in `notes.md` for follow-up tasks unless they genuinely block the new structure from working.
- **No public-API broadening.** Re-exports from `scripts/run-task.ts` (barrel pattern) are explicitly rejected. Tests update their import paths to the new modules.
- **No template engine other than Mustache.** Handlebars, Eta, or hand-rolled engines are out of scope.
- **No changes to `scripts/pipeline-policy.ts`.** It already lives at the right level of decomposition. The refactored code imports from it as it does today.
- **No changes to `scripts/task.sh`** beyond what is required if any of its inlined references to `scripts/run-task.ts` internals change (none expected — `task.sh` invokes the script as a subprocess).
- **No changes to `tasks/_templates/status.json` schema** or any prompt's *content*. Prose moves verbatim.
- **No new CLI agents.** Adding Gemini etc. is the *motivation* for splitting agents into per-runner files, but actually adding those runners is out of scope.

## Acceptance Criteria

### Structure

- [ ] **AC-1**: `scripts/run-task.ts` is a thin entry point (≤ ~30 lines) that imports from `scripts/run-task/main.ts` and invokes the orchestration entrypoint. `npx tsx scripts/run-task.ts <id>` and `npm run run-task` work as before.
- [ ] **AC-2**: The directory `scripts/run-task/` contains the following code modules, each with the responsibilities described:
    - `main.ts` — orchestration loop: phase dispatch, the four phase-aware switches, top-level error handling, termination logic.
    - `types.ts` — shared types: `StatusJson`, `PipelineState`, `TaskContext`, `MetricEntry`, `StreamResult`, type guards (`isPhaseStatus`, `isVerdict`).
    - `cli.ts` — `parseArgs`, `printUsage`, `validateTaskId`, `die`, `info`, `warn`.
    - `state.ts` — `readStatus`, `writeStatus`, `deriveTopLevelStatus`, `taskDirFor`, `statusFileFor`, `resolveTaskCwd`, session-id storage helpers (`storeSessionId`, `getStoredSessionId`). **Note**: `toResumePrompt` does NOT live here — it's a prompt-formatting utility, owned by `prompts/helpers.ts` (see AC-5). This keeps the dependency graph a DAG: `prompts/helpers.ts` depends on `state.ts` for `resolveTaskCwd`; `state.ts` does not depend on `prompts/`.
    - `policy.ts` — `policyConfig`, `toPolicyInputs`, `getClaudeConfig`, `getCodexConfig`, `detectTier`, `isPlanCombined`, `getMaxReviewLoops`, `getNominalSize`, `getEffectiveSize`.
    - `metrics.ts` — `recordMetric`, `METRICS_FILE` const.
    - `env.ts` — `warnLegacyEnvVars`, `warnWorktreesRootMismatch`, `resolveProjectName`, env constants (`STALL_TIMEOUT_MS`, `WORKTREES_ROOT`, etc.).
    - `git.ts` — `runCommand`, `runCommandOrDie`, `git`, `gitSafe`, `gitSafeAt`, `gitSafeAtRaw`, `commitTaskArtifactsToBase`, `getCurrentBranch`, `branchExistsLocally`, `getBaseBranch`, `getDefaultBaseBranch`, `commitsAheadOfBase`, `isCommandAvailable`, `ensureBranch`, `verifyBranch`, `parsePorcelain`, `parsePorcelainEntries` (the porcelain parsers exported and tested by `tests/run-task-parse-porcelain.test.ts`).
    - `worktree.ts` — `worktreePath`, `isWorktreeEnabled`, `getActiveCwd`, `findExistingWorktreeForBranch`, `ensureWorktree`, `teardownWorktree`, `flushWorktreeTelemetry`, `syncWorktreeArtifacts`, `syncWorktreeTelemetry`, `TASK_ARTIFACT_FILES`, `PIPELINE_TELEMETRY_FILES` (sibling to `TASK_ARTIFACT_FILES`; both list pipeline-managed files).
    - `validation.ts` — `validateHandoff`, `validateHandoffAgainstSpec`, `verifyHandoffAgainstDiff`, `verifyHandoffAgainstDiffFromData`, `findStagedFilesOutsideHandoff`, `findUncoveredTrackedChanges`, `isDoneMdTemplate`, `extractDoneMdFromStdout`, `parseValidationRequiredChecks`, `parseValidationOutcomeRows`, `canonicalizeValidationCheck`, `isPassResult`, `isNAResult`, `escapeRegExp`. The done.md helpers (`isDoneMdTemplate`, `extractDoneMdFromStdout`) live here rather than in `phases/qa.ts` because they're called across phases (`autoCommit*` and the QA salvage path), and they validate/parse output rather than orchestrate the QA phase.
    - `context.ts` — `extractAffectedFiles`, `buildContextBlock`, `buildKnownPitfalls`, `buildKnownRisks`, `summarizePreloadStatus`, `extractValidationChecks`, `extractAcSummary`, `buildImplementStateHeader`.
    - `task-sh.ts` — `runTaskShFor` (thin wrapper around `scripts/task.sh`).
- [ ] **AC-3**: Per-phase handlers live under `scripts/run-task/phases/`, one file per phase: `spec.ts`, `spec-review.ts`, `plan.ts`, `implement.ts`, `code-review.ts`, `qa.ts`. Each exports the function(s) `main.ts`'s dispatcher invokes for that phase. The four phase-aware switches in `main.ts` (`PHASE_ORDER`, `runPhase`, `checkAndRoute`, `canPhaseAdvance` — see Phase Addition Discipline in [`docs/patterns.md`](docs/patterns.md)) remain coherent and cover every phase.
- [ ] **AC-4**: Per-agent runners live under `scripts/run-task/agents/`: `stream.ts` (`streamProcess`, `formatLiveTick`, `StreamResult`), `claude.ts` (`runClaude`, `CLAUDE_RESUME_NOT_FOUND_RE`), `codex.ts` (`runCodex`). `stream.ts`'s exports are typed and documented as the shared primitive that future agent runners (Gemini, etc.) will reuse.
- [ ] **AC-5**: Phase prompts live under `scripts/run-task/prompts/`:
    - `index.ts` — exports the prompt builder functions (`promptSpec`, `promptSpecRevision`, `promptSpecReview`, `promptPlan`, `promptImplement`, `promptImplementRevisions`, `promptImplementReroute`, `promptCodeReview`, `promptQa`). Each builder does data prep, picks the correct template file, and calls `renderTemplate`.
    - `render.ts` — exports `renderTemplate(template: string, view: object): string`, a thin adapter over the `mustache` package. The adapter is the **only** module that imports `mustache` directly.
    - `helpers.ts` — `taskList`, `phaseCommands`, `CLAUDE_STARTUP`, `CODEX_STARTUP`, `QA_STARTUP`, **and `toResumePrompt`** (relocated from `state.ts` to break the would-be import cycle: `phaseCommands` here needs `resolveTaskCwd` from `state.ts`, and `toResumePrompt` here needs the startup constants. Both directions of imports terminate inside this module and `state.ts` does not depend on `prompts/` — DAG preserved). Agent runners under `agents/` import `toResumePrompt` from this module.
    - `templates/` — one `.md` file per logical prompt:
        - `spec.md`, `spec-revision.md`, `spec-review.md`, `plan.md`
        - `implement.md`, `implement-revisions.md`, `implement-reroute.md`
        - `code-review-round-1.md`, `code-review-round-n.md` (the round-1 vs round-N split corresponds to the `if (maxIter > 0)` branch in the current `promptCodeReview`)
        - `qa.md`
- [ ] **AC-6**: `mustache` and `@types/mustache` are added as dependencies in `package.json`. No other new runtime dependencies are introduced.

### Behavior identity

- [ ] **AC-7**: Golden-output prompt tests are added at `tests/run-task-prompts.test.ts`. **Capture is step 1 of implementation, before any module extraction begins.** The tests:
    - Build a representative `PipelineState` fixture for each prompt builder (covering at minimum: solo task and bundle for prompts that branch on `isBundle`; round-1 and round-N for `promptCodeReview`; fresh and resume modes for `promptImplement`; fast-tier `combined` and full-tier for `promptSpec`).
    - For each fixture, capture the output of the **current TypeScript builder** as a golden string (committed alongside the test).
    - After the refactor, assert byte-identity between the golden string and the output of the new (template-driven) builder.
    - **Whitespace-only differences are not permitted by default.** If any are unavoidable (e.g., a trailing-newline detail Mustache normalizes), they must be documented in `handoff.md` Deviations with rationale, and the goldens updated to match.
- [ ] **AC-8**: Existing tests pass after their imports are updated to the new module paths:
    - `tests/run-task-parse-porcelain.test.ts` imports git porcelain helpers from `scripts/run-task/git.ts`.
    - `tests/run-task-validation.test.ts` imports validation parsers from `scripts/run-task/validation.ts`.
    - `tests/pipeline-policy.test.ts` is unchanged (`pipeline-policy.ts` is not split).
- [ ] **AC-9**: `npm run lint` passes. `npm run type-check` passes. `npm test` passes (including the new `tests/run-task-prompts.test.ts` golden suite).

> **Real-pipeline smoke is human-driven, not an AC.** The end-to-end "does the refactored harness actually drive a real spec + spec_review pass?" check is a step in *Human Test Plan* (below), not an Acceptance Criterion. Reasons: (a) Codex during implement runs under `--sandbox workspace-write`, which blocks the `.git` writes the inner orchestrator performs (`commitTaskArtifactsToBase`, worktree add/remove, `autoCommitArtifacts`), so Codex cannot run the smoke from inside its phase; (b) putting the smoke on Claude during code review burns 2 LLM calls per review iteration for non-deterministic verification, which is more cost than signal; (c) the human runs verification at `human_review` anyway, so adding the smoke as a Human Test Plan step is the cheapest place it can live. The next real task on the refactored pipeline is the ultimate end-to-end check.

### Behavior-change policy

- [ ] **AC-10**: The refactor is **strict identity** with three buckets for things spotted during the work:
    - **Blocks the new structure from working** — fixed during the task, documented under `handoff.md` § Deviations with file:line and rationale.
    - **Pre-existing bug that does not block the refactor** — deferred. One-line entry in `tasks/split-run-task/notes.md` (file:line + repro hint) for follow-up.
    - **Nit / cleanup** — `notes.md`, no follow-up unless promoted by the human.

### Documentation

- [ ] **AC-11**: `docs/codebase-map.md` is updated to reflect the new file layout. References to `scripts/run-task.ts` as a single 4500-line file are replaced with a description of the directory structure and a guide to which file owns which concern.
- [ ] **AC-12**: `docs/architecture.md` "Validation" section is updated where it currently says "parsers in `run-task.ts`" to point at `scripts/run-task/validation.ts` and `scripts/run-task/git.ts`.
- [ ] **AC-13**: `docs/patterns.md` is updated where its "Files:" lines under existing patterns reference `scripts/run-task.ts` — replace with the appropriate new module path(s). The Phase Addition Discipline pattern's reference list expands to enumerate the four switches' new home (`scripts/run-task/main.ts`).
- [ ] **AC-14**: `CLAUDE.md` and `AGENTS.md` are not updated — they reference `scripts/run-task.ts` only as the user-invoked entrypoint, which is preserved.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task.ts` | Gut to thin entry: import `main` from `./run-task/main.js`, parse argv, invoke. |
| `scripts/run-task/main.ts` | New. Orchestration loop, phase dispatcher, the four phase-aware switches. |
| `scripts/run-task/types.ts` | New. Shared types and type guards extracted from `run-task.ts`. |
| `scripts/run-task/cli.ts` | New. Argument parsing, usage banner, ID validation, log helpers. |
| `scripts/run-task/state.ts` | New. Status I/O, top-level status derivation, path helpers, session storage. |
| `scripts/run-task/policy.ts` | New. Wraps `pipeline-policy.ts`: tier detection, model config selection. |
| `scripts/run-task/metrics.ts` | New. `recordMetric`, metrics file constant. |
| `scripts/run-task/env.ts` | New. Env-var warnings, project-name resolution, env constants. |
| `scripts/run-task/git.ts` | New. Git plumbing, branch helpers, base-branch resolution. |
| `scripts/run-task/worktree.ts` | New. Worktree provisioning, artifact and telemetry sync. |
| `scripts/run-task/validation.ts` | New. Handoff and spec validation parsers. |
| `scripts/run-task/context.ts` | New. Context-block builders consumed by prompts. |
| `scripts/run-task/task-sh.ts` | New. `runTaskShFor` wrapper. |
| `scripts/run-task/agents/stream.ts` | New. `streamProcess`, `formatLiveTick`, `StreamResult`. |
| `scripts/run-task/agents/claude.ts` | New. `runClaude` and Claude-specific patterns. |
| `scripts/run-task/agents/codex.ts` | New. `runCodex` and Codex-specific patterns. |
| `scripts/run-task/phases/spec.ts` | New. `spec` phase handler. |
| `scripts/run-task/phases/spec-review.ts` | New. `spec_review` phase handler. |
| `scripts/run-task/phases/plan.ts` | New. `plan` phase handler. |
| `scripts/run-task/phases/implement.ts` | New. `implement` phase handler. |
| `scripts/run-task/phases/code-review.ts` | New. `code_review` phase handler. |
| `scripts/run-task/phases/qa.ts` | New. `qa` phase handler. |
| `scripts/run-task/prompts/index.ts` | New. Prompt builder functions. |
| `scripts/run-task/prompts/render.ts` | New. `renderTemplate` adapter over Mustache. |
| `scripts/run-task/prompts/helpers.ts` | New. `taskList`, `phaseCommands`, `*_STARTUP` constants. |
| `scripts/run-task/prompts/templates/spec.md` | New. Template for `promptSpec`. |
| `scripts/run-task/prompts/templates/spec-revision.md` | New. Template for `promptSpecRevision`. |
| `scripts/run-task/prompts/templates/spec-review.md` | New. Template for `promptSpecReview`. |
| `scripts/run-task/prompts/templates/plan.md` | New. Template for `promptPlan`. |
| `scripts/run-task/prompts/templates/implement.md` | New. Template for `promptImplement` (used for both fresh and resume modes; the state-header difference is parameterized in the view). |
| `scripts/run-task/prompts/templates/implement-revisions.md` | New. Template for `promptImplementRevisions`. |
| `scripts/run-task/prompts/templates/implement-reroute.md` | New. Template for `promptImplementReroute`. |
| `scripts/run-task/prompts/templates/code-review-round-1.md` | New. Round-1 review prompt. |
| `scripts/run-task/prompts/templates/code-review-round-n.md` | New. Round-N (resumed re-review) prompt. |
| `scripts/run-task/prompts/templates/qa.md` | New. Template for `promptQa`. |
| `tests/run-task-prompts.test.ts` | New. Golden-output tests for all prompt builders. Goldens captured BEFORE extraction. |
| `tests/run-task-parse-porcelain.test.ts` | Update imports to `scripts/run-task/git.ts`. |
| `tests/run-task-validation.test.ts` | Update imports to `scripts/run-task/validation.ts`. |
| `package.json` | Add `mustache` and `@types/mustache` dependencies. |
| `docs/codebase-map.md` | Update file-layout description for `scripts/run-task/`. |
| `docs/architecture.md` | Update Validation section's reference to "parsers in `run-task.ts`". |
| `docs/patterns.md` | Update "Files:" lines referencing `run-task.ts` to point at the new module paths. |

### Interaction Dependencies

- **`scripts/pipeline-policy.ts`** is consumed by `scripts/run-task/policy.ts`. No changes to `pipeline-policy.ts`. The existing `tests/pipeline-policy.test.ts` continues unchanged.
- **`scripts/task.sh`** invokes `scripts/run-task.ts` as a subprocess via `npx tsx`. Preserving the entry-point path is what keeps this working.
- **`tasks/_templates/spec.md`** is referenced by spec prompts. Move the prose verbatim into the new templates without changing the references.
- **Worktree machinery**: `scripts/run-task/worktree.ts` is read from both REPO_ROOT and from inside an active worktree. The implementation must not assume `__dirname` resolves to a particular tree — `REPO_ROOT` is computed from `__dirname` upward and that resolution must continue to work when imported from any depth in the new tree.

### Data Model Changes

None. `tasks/<id>/status.json` schema, the artifact files, and the prompt-input fixtures are unchanged.

## Validation Required

- [x] **Linting** — `npm run lint`. Required.
- [x] **Type checking** — `npm run type-check`. Required. ESM module resolution must continue to work; relative imports in the new tree use the `.js` extension on relative imports as the project's TS config requires.
- [x] **Unit tests** — `npm test`. Required. Includes the new `tests/run-task-prompts.test.ts` golden suite.
- [ ] **Full build** — N/A. `tsx` runs scripts directly; no compile step.
- [ ] **End-to-end tests** — N/A. No UI surface. The human-driven smoke step in *Human Test Plan* stands in for runtime exercise.
- [ ] **Migration runner** — N/A. No `status.json` schema change.

## Docs Impact

- `docs/codebase-map.md` — updated to reflect the new structure (AC-12).
- `docs/architecture.md` — reference to "parsers in `run-task.ts`" updated (AC-13).
- `docs/patterns.md` — file-path references in pattern entries updated (AC-14).
- `CLAUDE.md`, `AGENTS.md`, `CODEX.md`, `docs/decisions.md`, `docs/product-context.md`, `docs/lessons-learned.md` — no change expected.

## Known Risks

- **This surface is "delicate" by `docs/patterns.md`'s definition** (modifies orchestrator hot path: phase routing, validation gates, worktree machinery). Operating as `task_size: L, delicate: false` is an explicit choice by the human to test mini-tier Codex's limits at high effort. Mitigations: strict no-behavior-change policy (AC-10), golden-output prompt tests captured before extraction (AC-7), existing parser tests held as the tripwire (AC-8), human-driven smoke at `human_review` (Human Test Plan). If mini cannot land this cleanly, the result is data we want — and the spec is structured so a re-run at XL/full-tier requires no spec changes, only a `delicate: true` flip.
- **Golden-output capture must precede extraction.** If goldens are captured *after* extraction, they only verify "the new code matches itself" — useless. The plan must place capture as step 1 with a dedicated commit (or at minimum a separate diff) so reviewers can confirm the goldens are pre-refactor.
- **Whitespace fidelity through Mustache.** Mustache normalizes some whitespace patterns (notably trailing newlines after `{{#section}}` blocks). The current TypeScript builders splice strings together with explicit `\n` characters; minor whitespace divergence after templating is plausible. The byte-identity AC catches this; the resolution is to either adjust the templates (preferred) or document the divergence and update goldens (escape hatch — must be in `handoff.md` Deviations).
- **ESM relative-import extensions.** This project's TS uses NodeNext-style module resolution and requires `.js` extensions on relative imports. The split adds many new relative imports — every new import needs the `.js` suffix. Type-check failures from missing extensions are noisy but not subtle.
- **Phase-addition discipline must survive.** The four phase-aware switches (`PHASE_ORDER`, `runPhase`, `checkAndRoute`, `canPhaseAdvance`) currently sit in one file where their coherence is visually obvious. After extraction they remain in `main.ts`, but per-phase handlers live in `scripts/run-task/phases/`. The dispatcher's switch statements must continue to enumerate every phase. Reviewer should grep for each phase name across `main.ts` and confirm all four switches cover it.
- **Bundle mode and worktree paths.** Bundle invocations (`run-task.ts <id1> <id2> ...`) and worktree-routed invocations exercise more code paths than a solo, REPO_ROOT-only run. The human-driven smoke covers a solo-task case; bundle and bundle-in-worktree are not exercised by automation. Reviewer should at minimum read `worktree.ts` and `main.ts`'s bundle dispatch and confirm no path resolution depends on `run-task.ts` being a single file.
- **Circular imports.** `state.ts` is imported by nearly every other module. `metrics.ts` is imported by `worktree.ts` (telemetry flush). `policy.ts` is imported by `main.ts` and `prompts/index.ts`. The dependency graph must be a DAG — no module reaches back through `scripts/run-task.ts`. The barrel re-export pattern is explicitly rejected (Non-Goals) for this reason.
  - **Specifically resolved**: the would-be `state.ts ↔ prompts/helpers.ts` cycle (Codex spec_review nit) is broken by relocating `toResumePrompt` from `state.ts` to `prompts/helpers.ts`. After the move, the only remaining edge is `prompts/helpers.ts → state.ts` (via `phaseCommands` calling `resolveTaskCwd`), which is fine. `state.ts` must NOT import anything from `prompts/`. Codex enforces this by reading the spec; reviewer enforces by grepping for `prompts/` imports inside `state.ts` during code review.
- **Codex over-decomposition or under-decomposition.** The module list in AC-2 through AC-5 is **binding, not advisory**. Codex must not introduce additional modules to "clean up" or merge listed modules to "reduce indirection." If the spec is wrong about a boundary, Codex notes it in `handoff.md` and ships the spec'd shape; the human iterates the spec separately.

## Human Test Plan

Run these in the task's worktree at the `human_review` boundary, before approving the merge.

1. Pull the branch. Run `npm install` (the new `mustache` dependency must install cleanly).
2. Run `npm run lint && npm run type-check && npm test`. All three pass. The new prompt-goldens test reports a passing suite.
3. Open `scripts/run-task.ts`. It is now a short file (≤ ~30 lines) that delegates to a function imported from `./run-task/main.js`.
4. Open one of the prompt template files (e.g., `scripts/run-task/prompts/templates/spec.md`). Read it as a document. The prose matches what the current pipeline emits for that phase, with `{{ }}` placeholders where dynamic data is substituted.
5. Pick any other template file. Same expectation: readable as prose, placeholders for dynamic data only, no embedded conditional logic beyond simple `{{#var}}…{{/var}}` sections.
6. **Real-pipeline smoke** (exercises both runners end-to-end against the refactored harness):
   - Create a throwaway task: `./scripts/task.sh new smoke-split-run-task "Harness smoke — verify the refactored pipeline drives spec and spec_review end-to-end. Spec a one-line, no-op change; do not advance past spec_review."`
   - In `tasks/smoke-split-run-task/status.json`, set `task_size: "S"`, `delicate: false`, `human_spec_gate: false` so the pipeline can advance freely.
   - **Spec phase (Claude runner)**: `npx tsx scripts/run-task.ts smoke-split-run-task --step --expect spec`. Verify exit 0, `tasks/smoke-split-run-task/spec.md` is non-empty, `status.json` shows `phases.spec.status: done`.
   - **Spec_review phase (Codex runner)**: `npx tsx scripts/run-task.ts smoke-split-run-task --step --expect spec_review`. Verify exit 0, `tasks/smoke-split-run-task/spec-review.md` is non-empty, `status.json` shows `phases.spec_review.status: done` with **any** terminal verdict (verdict value doesn't matter — pass criterion is harness-level).
   - **Cleanup**: delete `tasks/smoke-split-run-task/`. The smoke isn't permanent; it's a single confidence check.
   - **Do not advance past spec_review.** Implement / code_review / qa is the next real task's job.
   - If a step fails, retry once before concluding the harness is broken (transient API failures happen). Two consecutive failures of the same step is a real regression — reject the human_review and reroute.
7. Inspect the diff statistics: `git diff dev...HEAD --stat`. Confirm the bulk of the change is **moves** (lines removed from `scripts/run-task.ts`, lines added under `scripts/run-task/`), not net-new logic.
8. Confirm `docs/codebase-map.md` accurately describes where to find each concern in the new tree.

Expected: identical pipeline behavior to before, with a structurally clearer codebase that the next round of changes (including bug fixes the harness has queued up) becomes materially easier to apply.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names) — partial: this is a developer-facing refactor; the human test plan necessarily references file paths, but each step describes observable behavior
- [x] Validation Required has at least one entry checked (or "None" with justification)
