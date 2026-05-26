# Spec: telemetry-discrimination-gate — Telemetry discrimination gate at scaffold-commit time

> Written by: Claude | Review by: Human (M, non-delicate — bumped from S after spec authorship surfaced the surface size)
> Status: **PARKED** as of 2026-05-26. Spec is complete; pipeline not invoked. Pick up when an actual misattribution incident in canon-ai or an adopter justifies shipping; until then, operator discipline (don't leave dirty telemetry across `canon run` invocations) remains the active mitigation. See `docs/BACKLOG.md` "Telemetry discrimination gate at scaffold-commit time" entry for the parked rationale.

## Problem

When `commitTaskArtifactsToBase` (`scripts/run-task/git.ts:83-110`) absorbs dirty `PIPELINE_TELEMETRY_FILES` (`docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md`) into the per-task scaffold commit, there is no check that the absorbed content actually belongs to the current invocation. The canonical failure trace:

1. Task A runs. `spec_review` and `plan` phases append rows to `REPO_ROOT/docs/pipeline-invocations.md` via `recordMetric` (`scripts/run-task/metrics.ts:30`). These rows are dirty in `git status --porcelain` on the base branch.
2. Task A is interrupted before `commitTaskArtifactsToBase` runs (operator Ctrl+C, SIGHUP, an earlier-phase die, or A is a non-worktree task that never reaches implement). A's rows sit dirty in `REPO_ROOT`, uncommitted.
3. Operator starts Task B. B's `spec_review` and `plan` append more rows on top of A's leftover dirt.
4. Task B's first-implement runs `commitTaskArtifactsToBase`. The absorb block at git.ts:99-110 unions all currently-dirty telemetry into one commit titled `chore: absorb pre-implement telemetry into scaffold for B`. **A's rows now commit under B's scaffold message — misattribution baked into git history.**

This is a real residual from `worktree-canonical-task-state` (PR #104 / 1.5.0): that task introduced the absorption commit as the closer for worktree-canonical telemetry handling, but explicitly punted the discrimination question. The interim mitigation has been operator discipline ("don't leave prior-task telemetry uncommitted across invocations"), documented in CLAUDE.md Quick Refs.

A prior parser-based design for this gate hit 5 spec_review rounds and was carved out (`docs/lessons-learned.md:164`). An intermediate two-layer design (clean-at-entry + size-trajectory) accumulated 2 rounds of new-bug-class findings in pre-pipeline review; layer 2 was carved out as its own BACKLOG entry. This spec is the minimal-viable gate: layer 1 only.

## Decision

At orchestrator entry — before any phase dispatches — record per-file `dirtyAtEntry: boolean` for each `PIPELINE_TELEMETRY_FILES` path. A file is "dirty at entry" if `git status --porcelain -- <relPath>` (run from `REPO_ROOT`) returns any non-empty output (modified-tracked, added, deleted, untracked all count). Empty output ⇒ clean.

At `commitTaskArtifactsToBase` time, before the absorb block at git.ts:99, iterate currently-dirty telemetry files. For each, look up its `dirtyAtEntry` flag. If `dirtyAtEntry === true` → die unless `--force`. The reason: any content uncommitted at orchestrator entry is, by definition, not from the current invocation.

With `--force`, the operator opts into absorbing the foreign / pre-existing content and gets a warning naming each file.

The gate is format-agnostic. It does not parse markdown tables, it does not understand row attribution, it does not track byte sizes or content. It depends only on "was this file in a dirty state at orchestrator entry."

**Explicitly excluded — layer 2 (carved out):** mid-run size/content trajectory checks (detecting a non-append writer that truncates or deletes a telemetry file *during* a pipeline run) are NOT in scope for this task. The earlier two-layer design accumulated review iterations on the layer-2 edges (ENOENT handling, equal-or-larger overwrites, declared-vs-executable scope). Layer 2 is filed as its own BACKLOG entry (`telemetry-size-trajectory-defense`) to ship — or not — separately. Operator discipline + `--force` cover the realistic operator-error class today; layer 2 would add defense against future non-append writer regressions in the canon codebase itself.

## Non-Goals

- Parser-based per-row discrimination (carved out from a 5-iteration spec round).
- Size-trajectory / mid-run shrinkage / non-append writer detection (layer 2 — see BACKLOG entry `telemetry-size-trajectory-defense`).
- Persisting the snapshot to disk to survive orchestrator restarts (in-memory only; `--force` is the escape).
- Discrimination at finer granularity than file-level (per-task attribution within a bundle). The gate answers "was this file dirty when the orchestrator started," not "which task within a bundle produced row N."
- Changing when `commitTaskArtifactsToBase` runs (still only on first-implement, per `phases/implement.ts:36` and the `!worktreeAlreadyCreated` guard there).
- Changing the set of files in `PIPELINE_TELEMETRY_FILES` (`scripts/run-task/worktree.ts:9-13`).
- Adding an env-var or config-file knob to control gate behavior (the only escape is `--force`).
- Gating non-telemetry files in the absorption commit (the task-artifact loop at git.ts:85-92 is unaffected — task artifacts are this-task's by construction and are scoped to `tasks/<id>/` paths).
- Auto-cleaning the dirty state at entry. The gate diagnoses; the operator decides whether to commit, reset, or `--force` the absorb.

## Acceptance Criteria

- [ ] AC-1: A new module `scripts/run-task/telemetry-snapshot.ts` exists and exports three functions: `captureTelemetrySnapshot(): void`, `verifyTelemetryIntegrity(force: boolean): void`, and `resetTelemetrySnapshotForTests(): void`. The module owns a module-level `Map<string, boolean>` keyed by the **relative** path of each `PIPELINE_TELEMETRY_FILES` entry, with the boolean being `dirtyAtEntry`. The map is private; tests reset it via the exported helper.

- [ ] AC-2: `captureTelemetrySnapshot()` is invoked from `scripts/run-task/main.ts` at orchestrator entry, after `cliArgs = splitCli.parseArgs(...)` (line 2433) but **before** `buildPipelineState(taskIds)` (line 2468). Concretely, the call sits between `refreshCanonSnapshotsAtPaths(...)` at line 2467 and `buildPipelineState(taskIds)` at line 2468.

- [ ] AC-3: `captureTelemetrySnapshot()` iterates `PIPELINE_TELEMETRY_FILES` (imported from `./worktree.js`). For each `relPath`, it runs `git status --porcelain -- <relPath>` from `REPO_ROOT` via `child_process.execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain', '--', relPath], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })`. The new module does **not** import `gitSafe` from `git.ts` — that would create an ESM cycle (`git.ts` imports `verifyTelemetryIntegrity` from this module). Inline the subprocess call in a small helper inside `telemetry-snapshot.ts`. If the trimmed stdout is non-empty, store `dirtyAtEntry: true` in the map for that relPath; if empty, store `false`. If `execFileSync` throws (git not installed, repo corruption, etc.), re-throw — capture-time errors must not silently degrade the gate.

- [ ] AC-4: `verifyTelemetryIntegrity(force)` is invoked from `commitTaskArtifactsToBase` in `scripts/run-task/git.ts`, **before** the absorb block currently at git.ts:99 (the `if (dirtyTelemetry.length > 0)` block). The function iterates `PIPELINE_TELEMETRY_FILES`, computing its own dirty-file list using the same `gitSafe('status', '--porcelain', '--', relPath)` predicate the existing absorb code uses. For each currently-dirty file:
  - Look up the snapshot map entry for that relPath.
  - **No entry** → append to `failed` with `reason: 'no snapshot recorded — captureTelemetrySnapshot did not run for this file (test bypass or future code path?)'`. Defensive — AC-3 records an entry for every `PIPELINE_TELEMETRY_FILES` path under the production path; this branch only fires when capture wasn't called (test fixtures, future entry points).
  - **`dirtyAtEntry === true`** → append to `failed` with `reason: 'uncommitted telemetry pre-existed at orchestrator entry — prior-invocation leftover or foreign edit'`.
  - **`dirtyAtEntry === false`** → pass (file is dirty NOW but was clean at entry; the new content is this-invocation appends by construction).

- [ ] AC-5: At the end of `verifyTelemetryIntegrity`, if `failed.length > 0`:
  - **If `force === false`**: call `die(...)` with a multi-line message. The first line is `commitTaskArtifactsToBase aborted: telemetry discrimination gate detected pre-existing content`. Each failed file is its own indented line of the form `  <file path>: <reason>`. The closing two lines name `--force` as the bypass (`Pass --force to absorb the flagged content into the scaffold commit anyway.`) and point at the decision entry (`See docs/decisions.md "Telemetry discrimination gate via dirty-at-entry check" for the invariant.`). If multiple files fail for different reasons (the rare "no snapshot" + "dirty-at-entry" mix), group per-reason in the message.
  - **If `force === true`**: emit a single `warn(...)` whose body starts with `--force override: telemetry discrimination gate bypassed; absorbing the following files:` followed by per-file `  <file path>: <reason>` lines. Return so the absorb proceeds.

- [ ] AC-6: `commitTaskArtifactsToBase`'s signature gains a third parameter: `options: { force: boolean }`. The function passes `options.force` to `verifyTelemetryIntegrity`. The existing single caller is at `scripts/run-task/phases/implement.ts:36` inside `runImplementPhase`. `cliArgs` is **not** importable from `main.ts` (it's declared as `let cliArgs`, not exported — confirmed via grep of `scripts/run-task/phases/*.ts` returning zero imports from `'../main'`), so `force` is threaded through `runImplementPhase`'s signature:
  1. `runImplementPhase`'s current signature is `(state: PipelineState, interactive: boolean, resumeId: string | null)`. Add `force: boolean` as a **fourth positional parameter**: the new signature is `(state, interactive, resumeId, force)`. Do not convert to an options object — the existing three-arg style is conventional in this file; adding a 4th positional keeps the diff small.
  2. Inside `runImplementPhase`, the call at line 36 becomes `commitTaskArtifactsToBase(taskIds, TASK_ARTIFACT_FILES, { force })`.
  3. The dispatch site in `main.ts` currently calls `runImplementPhase(state, cliArgs.interactive, codexSession)` (around main.ts:1955 — verify exact line at implement time). Update to `runImplementPhase(state, cliArgs.interactive, codexSession, cliArgs.force)`.

  After the change, `grep -nF 'commitTaskArtifactsToBase(' scripts/` returns exactly one call site with three arguments; `grep -nF 'runImplementPhase(' scripts/` returns the same call sites it does today (definition + one invocation in `main.ts`), each with the four-arg shape.

- [ ] AC-7: Tests in a **new** file `tests/run-task-telemetry-snapshot.test.ts` cover, at minimum, six cases. Tests reset module-level state via `resetTelemetrySnapshotForTests()` between cases:
  1. **Clean-at-entry + later dirty → silent pass**: in a git fixture, commit a telemetry file. Call `captureTelemetrySnapshot()` (snapshot records `dirtyAtEntry: false`). Modify the file (now dirty). Call `verifyTelemetryIntegrity(false)` — must not throw, must not warn.
  2. **Modified-tracked dirty-at-entry → die without --force**: in a git fixture, commit a telemetry file. Modify it (so `git status --porcelain` reports ` M <file>`). Call `captureTelemetrySnapshot()` — entry should record `dirtyAtEntry: true`. Call `verifyTelemetryIntegrity(false)` — must die with the "prior-invocation leftover" reason.
  3. **Modified-tracked dirty-at-entry + force → warn-and-proceed**: same setup as #2, call `verifyTelemetryIntegrity(true)` — must not throw, must emit a warn with the same reason.
  4. **Untracked dirty-at-entry → die without --force**: in a git fixture with NO telemetry file committed, manually create the file on disk so it shows as `?? <file>` in `git status --porcelain`. Call `captureTelemetrySnapshot()` — entry should record `dirtyAtEntry: true`. Call `verifyTelemetryIntegrity(false)` — must die with the same reason. **This is the load-bearing test for the untracked case** — without it, a future revert from `status --porcelain` to `diff --quiet HEAD --` would silently re-introduce the original BLOCKING bug.
  5. **File absent at capture + current invocation creates it → silent pass**: in a git fixture with NO telemetry file committed AND NO file on disk, call `captureTelemetrySnapshot()` (snapshot records `dirtyAtEntry: false` — `git status --porcelain` returns empty for a non-existent untracked path). Create the telemetry file with content. Call `verifyTelemetryIntegrity(false)` — must not throw.
  6. **No snapshot entry + dirty file → die without --force**: reset the snapshot map (do NOT call capture), make a telemetry file dirty in a git fixture, call `verifyTelemetryIntegrity(false)` — must die with the "no snapshot recorded" reason. Defensive coverage of the capture-bypassed case.

  Test harness: use `fs.mkdtempSync` for the git fixture root; initialize a git repo with a base branch; reset `REPO_ROOT` via the existing `CANON_*_OVERRIDE` env-var pattern if applicable (check `scripts/run-task/env.ts` for the canonical override variable) OR construct the fixture so `REPO_ROOT` naturally points there. Use the same `gitIn` / `makeGitFixture` helpers established in `tests/run-task-validation.test.ts`.

- [ ] AC-8: An additional integration-style test verifies AC-6's plumbing end-to-end: `commitTaskArtifactsToBase` accepts the third `options` parameter and forwards `force` correctly. Either spawn the orchestrator in a fixture and assert the warn message appears when `--force` is passed AND a telemetry file is dirty pre-implement, OR add a focused unit test that calls `commitTaskArtifactsToBase` directly with the third parameter and asserts the verify delegation. Pick whichever pattern fits the existing test conventions; `tests/run-task-safety.test.ts` is the canonical home for subprocess-style tests.

- [ ] AC-9: All existing tests pass. New tests pass. `npm run lint`, `npm run type-check`, `npm run docs-refs-check`, and `npm run build` are clean.

- [ ] AC-10: `docs/patterns.md` gains a new "Known Pitfalls" entry titled "`PIPELINE_TELEMETRY_FILES` cleanliness at orchestrator entry is operator-checked" describing the discipline: don't start a new `canon run` while telemetry files are dirty in `git status --porcelain` from a prior interrupted run. The gate is the enforcement; the pitfall entry is the declared canon. Per `docs/decisions.md` "Declared Canon vs Executable Canon as a recurring audit lens," declared + executable land in the same task.

- [ ] AC-11: `docs/decisions.md` gains a new decision entry titled "Telemetry discrimination gate via dirty-at-entry check" documenting: (a) the gate's contract (dirty at orchestrator entry ⇒ die unless `--force`), (b) the `--force` escape semantics, (c) why a single-layer check was chosen over the two-layer (clean-at-entry + size-trajectory) intermediate design — layer 2 carved out as `telemetry-size-trajectory-defense` BACKLOG entry to ship separately if/when non-append regressions appear, (d) the parser-based ancestor's 5-iteration history and the snapshot-based replacement.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/telemetry-snapshot.ts` | **New file**. Exports `captureTelemetrySnapshot()`, `verifyTelemetryIntegrity(force: boolean)`, `resetTelemetrySnapshotForTests()`. Holds a module-level `Map<string, boolean>` keyed by relPath. ~35 lines including comments and the `execFileSync` git-status helper. |
| `scripts/run-task/main.ts` | Add `import { captureTelemetrySnapshot } from './telemetry-snapshot.js'`. Add `captureTelemetrySnapshot()` call between line 2467 (`refreshCanonSnapshotsAtPaths(...)`) and line 2468 (`buildPipelineState(taskIds)`). Update the `runImplementPhase` invocation (around main.ts:1955; verify exact line) from `runImplementPhase(state, cliArgs.interactive, codexSession)` to `runImplementPhase(state, cliArgs.interactive, codexSession, cliArgs.force)`. |
| `scripts/run-task/git.ts` | Change `commitTaskArtifactsToBase`'s signature from `(taskIds, _artifactFiles)` to `(taskIds, _artifactFiles, options: { force: boolean })`. Add `import { verifyTelemetryIntegrity } from './telemetry-snapshot.js'`. Call `verifyTelemetryIntegrity(options.force)` immediately before the `if (dirtyTelemetry.length > 0)` block at line 99. After the change, the sole caller passes three arguments. |
| `scripts/run-task/phases/implement.ts` | Add `force: boolean` as a fourth positional parameter to `runImplementPhase` (current signature: `(state, interactive, resumeId)`). Update the call to `commitTaskArtifactsToBase` at line 36 to pass `{ force }` as the third argument. |
| `tests/run-task-telemetry-snapshot.test.ts` | **New file**. Six tests per AC-7 (clean-at-entry-pass, modified-tracked-die, modified-tracked-force, untracked-die, file-absent-then-created-pass, no-snapshot-die) plus AC-8 (plumbing). ~140 lines. |
| `tests/run-task-safety.test.ts` | Existing tests that invoke `commitTaskArtifactsToBase` or `runImplementPhase` directly need updates. Two edit classes: (a) **signature updates** — `commitTaskArtifactsToBase(taskIds, files)` becomes `commitTaskArtifactsToBase(taskIds, files, { force: false })`; `runImplementPhase(state, interactive, resumeId)` becomes `runImplementPhase(state, interactive, resumeId, false)`. (b) **gate accommodation** — tests with dirty telemetry in their fixtures that didn't previously call `captureTelemetrySnapshot()` will trip the "no snapshot recorded" branch. For each such test: (i) call `captureTelemetrySnapshot()` after fixture setup but before the function under test, OR (ii) pass `{ force: true }` and assert the warn appears, OR (iii) call `resetTelemetrySnapshotForTests()` then pass `{ force: true }` to verify the bypass path. Codex confirmed at least the `runImplementPhase writes metrics...` test (around line 905) and a sibling absorb test hit these shapes; audit every direct caller in this file. |
| `dist/cli/index.js` | Regenerated by `npm run build` from the source changes. |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` from the source changes. |
| `docs/patterns.md` | New Known Pitfalls entry per AC-10. Single section, ~10 lines. |
| `docs/decisions.md` | New decision entry per AC-11. Standard What/Why/Rule format, ~25 lines including the layer-2 carve-out reference. |
| `docs/codebase-map.md` | QA-time row addition for `scripts/run-task/telemetry-snapshot.ts` in the Pipeline Orchestration table. Auto-allowlisted via 1.5.0's QA-done managed-doc rule; listed here to flag the QA expectation. |
| `docs/BACKLOG.md` | The layer-2 carve-out entry (`telemetry-size-trajectory-defense`) lands BEFORE this task ships, in the same task scaffold commit. The BACKLOG edit is part of the spec phase, not the implementation — Codex doesn't need to touch BACKLOG. (Already filed by spec author before pipeline invocation.) |

### Interaction Dependencies

- **`worktree-canonical-task-state` (PR #104 / 1.5.0)**: This gate layers on top of that task's absorption commit at git.ts:99-110.
- **`canon-snapshot.ts`**: `refreshCanonSnapshotsAtPaths(...)` at `main.ts:2467` is the per-task canon provenance stamp — unrelated to this gate. The new capture call sits adjacent but is independent.
- **`cliArgs.force`**: Already used by `commitHumanReviewFiles` (main.ts:894-929) and the delicate-full-send check (main.ts:2463). This gate joins that semantic but does NOT import `cliArgs` — it threads `force` through the phase-dispatch signature.
- **Full-send mode**: A full-send run hits this gate the same way a normal run does. Orthogonal to `full_send` / `human_spec_gate`.
- **Reroute**: `--reroute` does not re-trigger `commitTaskArtifactsToBase` (it only fires on first implement). The snapshot captured at the reroute invocation's entry covers any telemetry appended during the reroute's phase dispatch.

### Data Model Changes

None. No `status.json` fields change. No persisted state. The snapshot is in-memory for the lifetime of one orchestrator invocation.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `build` (`npm run build`)
- [x] `docs-refs-check` (`npm run docs-refs-check`)

E2E: N/A (no UI surface).

## Docs Impact

- `docs/patterns.md` — new Known Pitfalls entry (AC-10).
- `docs/decisions.md` — new decision entry (AC-11).
- `docs/codebase-map.md` — add a row for `scripts/run-task/telemetry-snapshot.ts` at QA time.
- `docs/BACKLOG.md` — layer-2 carve-out entry filed by spec author before pipeline invocation.
- `CLAUDE.md` Quick refs — the interim mitigation note about "don't leave prior-task telemetry uncommitted across invocations" should be replaced with a pointer to the new gate. QA-time judgment call.

## Known Risks

- **Single-layer scope**: This gate catches "telemetry was dirty at orchestrator entry" only. It does NOT catch a non-append writer that mutates a telemetry file *during* a pipeline run (in-place overwrite, sed-style truncate, accidental `unlink` mid-flight). That is layer-2 territory, carved out as the `telemetry-size-trajectory-defense` BACKLOG entry. The realistic operator-error class (leftover dirty state from a prior `canon run`) is fully covered. The future-canon-bug-class (a non-append writer regression introduced into canon's own metrics or QA writers) depends on the declared discipline in AC-10 / `docs/patterns.md` for now.

- **`HEAD` doesn't exist (brand-new repo)**: `git status --porcelain` does not require `HEAD` to resolve, so a brand-new repo with no commits returns clean (empty) output. No special-case branch is needed.

- **Pre-implement phase telemetry race**: `spec_review` and `plan` phases append rows to telemetry files via `metrics.ts:30` after each agent invocation. The snapshot **must** be captured before those phases run; AC-2 places capture before `buildPipelineState(taskIds)` and the pipeline loop. After capture, the pre-implement appends make the file dirty in `status --porcelain` — but the snapshot recorded `dirtyAtEntry: false`, so verify passes.

- **File absent at capture, created mid-run**: `git status --porcelain` for a non-existent path returns empty (the file isn't tracked AND doesn't exist; nothing to report). Snapshot records `dirtyAtEntry: false`. When the current invocation later creates the file via `recordMetric` or QA writes, the file becomes dirty (untracked). Verify finds `dirtyAtEntry: false` and passes.

- **Cross-orchestrator-process discrimination**: If the operator restarts the orchestrator mid-pipeline (SIGHUP class, terminal close, network drop), the in-memory snapshot is gone. The next invocation calls `captureTelemetrySnapshot()` fresh. If the files are dirty against working tree (uncommitted from the previous interrupted run), `dirtyAtEntry: true` is recorded — the gate fires correctly on the next implement absorb. If they were committed before the restart, they're clean and the new run proceeds normally. `--force` is the escape.

- **Tests that exercise `die`**: Existing tests in `tests/run-task-validation.test.ts` (`verifyBaseDrift: malformed affected-file rows...`) and `tests/run-task-safety.test.ts` demonstrate the patterns. Either use `captureConsoleError` + the test-mode `die` seam (helper at `run-task-validation.test.ts:217`), or spawn a subprocess that lets `die` actually call `process.exit` (`run-task-safety.test.ts:260` is the canonical example).

- **Bundle mode**: `commitTaskArtifactsToBase` already iterates `taskIds` for the per-task scaffold commits, but the telemetry absorb at lines 99-110 is bundle-wide (one commit covering all dirty telemetry across all task IDs in the message). The new gate is also bundle-wide (one snapshot, one verify pass). No per-task gate semantics.

- **`resetTelemetrySnapshotForTests` is a new convention**: Grep for `ForTests` across `scripts/run-task/` returns zero matches; the helper is the first of its kind in this directory. The pattern is straightforward (export a function that calls `.clear()` on the private Map) and matches the spirit of canon's other "test seam" exports.

- **ESM import cycle topology**: `telemetry-snapshot.ts` imports `PIPELINE_TELEMETRY_FILES` from `worktree.ts`. `worktree.ts` imports `git, gitSafe` from `git.ts`. `git.ts` will import `verifyTelemetryIntegrity` from `telemetry-snapshot.ts`. This is a 3-module cycle. It is acceptable in ESM as long as no module's top-level code calls a function from another module in the cycle before all modules have finished loading. Audit `worktree.ts` and `git.ts` top-level before implementing: both should contain only `import` statements and `export const` / `export function` declarations — no top-level function calls. If a future change adds top-level execution in any of these modules that calls into the cycle, the cycle would break and require restructuring (most likely: extract `PIPELINE_TELEMETRY_FILES` to its own no-imports module).

## Human Test Plan

1. From a clean working tree on the task branch, create two task scaffolds: `canon task new task-alpha "Alpha"` and `canon task new task-beta "Beta"`. Both should appear under the tasks directory.
2. Open `docs/pipeline-invocations.md` in an editor (no actual pipeline run yet). Manually append a few rows to the bottom of the file. Save without committing. Confirm via `git status` that the file shows as modified.
3. Run `canon run task-beta`. The pipeline should reach the implement phase, hit `commitTaskArtifactsToBase`, and:
   - **Expected**: die with a clear message naming `docs/pipeline-invocations.md` and citing `uncommitted telemetry pre-existed at orchestrator entry — prior-invocation leftover or foreign edit`. The message should suggest `--force` if intentional.
4. Revert the manual edit: `git checkout HEAD -- docs/pipeline-invocations.md`. Re-run `canon run task-beta` — should proceed past the gate cleanly.
5. Repeat step 2's manual edit, then run `canon run task-beta --force`. Expected: warn message naming the file and the reason, then the run proceeds and the absorb commit includes the manually-appended rows.
6. Inspect the final task-beta scaffold commit: run `git log --oneline -5` and confirm the absorb commit's message is `chore: absorb pre-implement telemetry into scaffold for task-beta`.
7. (Negative control — clean state) Run a normal `canon run task-alpha` end-to-end with no prior dirty state. Expected: no warn, no die, no change in pipeline output relative to today's behavior beyond the absence of the misattribution risk.
8. (Negative control — untracked) From a state where `docs/pipeline-invocations.md` does NOT exist in `HEAD` (e.g., a fresh release branch that hasn't committed any telemetry, OR `git rm --cached docs/pipeline-invocations.md && git commit -m 'untrack for test'`), create the file on disk with `echo "manually written" > docs/pipeline-invocations.md`. Confirm `git status` shows `?? docs/pipeline-invocations.md`. Run `canon run task-beta`. Expected: die with the `prior-invocation leftover` reason — the file is dirty in `git status --porcelain` (untracked), so `dirtyAtEntry: true` is recorded at capture.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — to be written in `plan.md` after spec approval
- [x] Known Risks covers failure modes for the trickiest ACs (single-layer scope, ESM cycle, pre-implement race, restart-recovery)
- [x] Human Test Plan uses product language only (operator commands and expected behavior)
- [x] Validation Required has at least one entry marked `- [x]`
