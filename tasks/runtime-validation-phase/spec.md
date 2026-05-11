# Spec: runtime-validation-phase — Orchestrator-run runtime checks between implement and code_review

> Written by: Claude | Review by: Codex (full tier — M delicate)
> Status: draft

## Problem

Today's validation matrix assumes Codex can run every required check from its sandboxed session. This breaks for any check that needs resources Codex's sandbox restricts: browser drivers (e2e tests), live dev servers, deployed preview URLs (deploy smoke), filesystem writes outside the worktree, network access to live services. Surfaced concretely 2026-05-11 in two ways:

1. **The unportable `tests/run-task-prompts.test.ts` golden suite** failed in Codex's sandbox because it tried to mkdir outside the worktree (EPERM). The implementation was correct but the test was unrunnable from Codex's environment.
2. **gallery_wall canon port** has an `npm run test:e2e` suite that Codex genuinely cannot execute (no browser). Currently the adopter has three bad options:
   - Mark the e2e check `Pass` without running it (silent lie; defeats the gate's purpose)
   - Mark it `Fail` (auto-blocks the pipeline)
   - Mark it `N/A` (validator rejects — required checks can't be N/A)

The right separation: **static checks Codex can run (lint, type-check, unit tests against mocked deps) stay in Codex's reports. Runtime-dependent checks (e2e, deploy smoke, anything requiring a browser or live service) run from the orchestrator's environment**, which has full filesystem and network access and can spin up a dev server.

## Decision

Add a new pipeline phase **`runtime_validation`** that runs between `implement` and `code_review`. The orchestrator invokes a registered list of runtime checks (project-customizable via `scripts/pipeline-policy.ts`), captures their output, and writes results to a new `## Runtime Validation Outcomes` section in `handoff.md`. Failures route back to `implement` with the same loop-cap and auto-block semantics as `code_review` changes_requested.

**Trust model for this task**: orchestrator authors only the new `## Runtime Validation Outcomes` section. Codex still authors `## Validation Outcomes` for the static checks it runs (lint, type-check, unit tests). Cross-checking Codex's static reports against an orchestrator re-run is **out of scope** — a separate design question worth its own task.

**Empty registry → no-op phase**: if a project hasn't registered any runtime checks (or none match the task), the phase advances immediately to `code_review` without writing to the handoff. This is canon-ai's default state — canon has no runtime e2e of its own.

**Concrete example check shipped on canon-ai**: a single dummy registration in `scripts/pipeline-policy.ts` (`{ name: 'orchestrator-phase-smoke', command: 'echo orchestrator-phase-smoke-ok' }`) so the phase dispatch loop fires on every canon-ai task and we can observe the wiring works. Projects override `RUNTIME_CHECKS` with their real commands (gallery_wall replaces with `npm run test:e2e`, etc.).

## Non-Goals

- **Cross-checking Codex's static-check reports.** Orchestrator does not re-run lint/type-check/unit tests to verify Codex's testimony. That's a separate trust-model question. Filed as follow-on `orchestrator-static-check-cross-verify`.
- **A general "register an arbitrary phase" plugin system.** This task adds *one* new phase with *one* category of work. The scoped-audits BACKLOG entry is the eventual generalization; we're not building that here.
- **Sandbox-escape for Codex.** This task doesn't try to expand Codex's environment — it moves the check to a place that already has the needed access.
- **Per-project config files.** Registration lives in `scripts/pipeline-policy.ts` (the existing project-shipped policy module). Migration to `.canon/config.json` is a future task once `.canon/` lands.
- **Parallel check execution.** Checks run sequentially. Parallel execution is a possible later optimization; not worth the complexity in v1.
- (none — streaming is required, see AC-13)
- **Modifying Codex's `## Validation Outcomes` section.** Orchestrator only writes its own section. Codex's authority over static checks is unchanged.

## Acceptance Criteria

- [ ] AC-1: `Phase` type and `PHASE_ORDER` in `scripts/run-task/types.ts` extended with `runtime_validation` inserted between `implement` and `code_review`. Existing PHASE_ORDER consumers (status.json schema, dispatcher, task.sh) updated to recognize the new phase as a valid value.
- [ ] AC-2: `tasks/_templates/status.json` template includes a `phases.runtime_validation` block with shape `{ status: "pending", agent: "orchestrator", verdict: "", iterations: 0 }`. Existing tasks (`tasks/*/status.json` files) are NOT migrated — the dispatcher treats missing `phases.runtime_validation` as a no-op (phase advances immediately).
- [ ] AC-3: `scripts/pipeline-policy.ts` exports a typed `RUNTIME_CHECKS: RuntimeCheck[]` registry. The `RuntimeCheck` type is:
  ```ts
  export type RuntimeCheck = {
      name: string;                                     // Display name; appears in handoff
      command: string;                                  // Shell command
      timeoutMs?: number;                               // Default: 10 * 60 * 1000 (10min)
      cwd?: 'worktree' | 'repo_root';                   // Default: 'worktree'
      when?: (status: PolicyInput, affectedFiles: readonly string[]) => boolean; // Default: always-run
      artifactPaths?: readonly string[];                // Paths within cwd to preserve on Fail; default: any worktree path modified during check run
      artifactReadingHint?: string;                     // Project-specific guidance appended to Codex's reroute prompt when this check fails (e.g. "Playwright traces are at test-results/<test>/trace.zip; open the HTML index for visible failure cause")
  };
  ```
  Canon-ai ships exactly one example registration: `{ name: 'orchestrator-phase-smoke', command: "echo orchestrator-phase-smoke-ok" }`. No `when` predicate; runs on every task. This validates the dispatch end-to-end on canon-ai's own pipeline.
- [ ] AC-4: New module `scripts/run-task/phases/runtime-validation.ts` exports `runRuntimeValidationPhase(taskIds, ctx, checks?)` mirroring the existing phase-module pattern (`scripts/run-task/phases/code-review.ts` as the closest reference). It:
  1. Reads `RUNTIME_CHECKS` from `pipeline-policy.ts` when the `checks` parameter is omitted; uses the passed-in registry otherwise. The optional `checks` parameter is the **test seam** — production callers in `main.ts` omit it, tests pass an explicit `RuntimeCheck[]` so they don't have to mutate an ESM-imported const (which is read-only at runtime). Type: `checks?: readonly RuntimeCheck[]`.
  2. For each task in the bundle, filters checks by `when()` predicate against the task's `status` and parsed-from-handoff affected files (using `parseHandoffFiles` from `validation.ts`).
  3. Runs filtered checks sequentially via `spawn` with real-time output streaming + heartbeat (see AC-13).
  4. Captures stdout, stderr, exit code, and elapsed time per check.
  5. Writes results to `handoff.md` (see AC-5).
  6. Sets `phases.runtime_validation.status = 'done'` always when the phase completes (matching the existing `code_review` convention so the `checkAndRoute` "phase must be done" guard at `scripts/run-task/main.ts:1404–1416` is satisfied). Sets `phases.runtime_validation.verdict` to `'approved'` (all checks Pass) or `'changes_requested'` (any Fail/Timeout). **Verdict reuses the existing shared `Verdict` type** — no widening required, no new variant. Routing decisions in `checkAndRoute` examine the verdict, not the status (see AC-6, AC-9).
- [ ] AC-4b: Empty-registry / all-filtered-out case: dispatcher writes nothing to the handoff, sets `phases.runtime_validation` to `{ status: "done", verdict: "approved", iterations: 0 }`, and routes to `code_review` immediately. No `## Runtime Validation Outcomes` section is added in this case (avoids visual noise on every handoff).
- [ ] AC-5: Results land in a new section `## Runtime Validation Outcomes` appended to the handoff (positioned after `## Validation Outcomes`, before `## Ready for Review`). Format:
  ```markdown
  ## Runtime Validation Outcomes

  > Authored by the orchestrator after Codex's implement phase. Codex did not run these checks.

  | Check | Result | Elapsed | Notes |
  |---|---|---|---|
  | `<name>` | Pass / Fail / Timeout | 12.4s | exit code 0; first 512 chars of stderr (full log: tasks/<id>/runtime-check-output/<check>/iter-N/) |
  ```
  On iteration N (revision): orchestrator appends a `### Re-run runtime validation` h3 inside the latest `## Iteration N` handoff section, mirroring Codex's `### Re-run validation` convention. This composes with the cumulative-handoff fix from commit be516a5 — `computeLatestValidationResults` does not include orchestrator-section checks, but a sibling function `computeLatestRuntimeResults` MUST do the same latest-wins logic over `## Runtime Validation Outcomes` + iteration `### Re-run runtime validation` subsections.
- [ ] AC-6: Failure routing follows the existing `code_review` convention. If any check in the final per-check map has result `Fail` or `Timeout`, the phase module sets `phases.runtime_validation.status = 'done'` and `phases.runtime_validation.verdict = 'changes_requested'`, and increments `iterations`. Then `checkAndRoute` (see AC-9) reads the verdict in its `runtime_validation` switch case and routes back to `implement`. Same auto-block semantics as `code_review`: when `iterations` exceeds `MAX_REVIEW_LOOPS` (resolved from `pipeline-policy.ts`), halt with an explicit message and require manual reset to resume. **Status stays `done` even on failure** — this is what lets the existing completion guard in `checkAndRoute` pass and reach the routing switch, exactly mirroring how `code_review` handles `changes_requested`.
- [ ] AC-7: Timeout behavior: a check exceeding its `timeoutMs` is killed and recorded as `Timeout` with the elapsed time recorded as the timeout value. Timeout is treated as Fail for routing purposes. Default 10min; env-var `ORCHESTRATOR_CHECK_TIMEOUT_MS` (singular global override; per-check `timeoutMs` in the registry wins over env-var).
- [ ] AC-8: Codex's implement-revision prompt is updated to read `## Runtime Validation Outcomes` (latest iteration's `### Re-run runtime validation` if present, otherwise the baseline section) and include the failing checks' names + captured stderr in the prompt context. Codex iteration 2+ knows what runtime checks failed and why. Existing prompt-build infrastructure in `scripts/run-task/prompts/` is the reference; reuse `parseTable` + `parseTableH3` + `extractSectionBodies` from `markdown-table.ts`.
- [ ] AC-9: Dispatch routing in `scripts/run-task/main.ts` (`PHASE_ORDER` walk, `checkAndRoute` logic) routes:
  - `implement.status = done` → `runtime_validation` (driven by the new PHASE_ORDER entry from AC-1)
  - In `checkAndRoute`, add a new `case 'runtime_validation':` immediately after the existing `case 'code_review':` block (`scripts/run-task/main.ts:1466–1477`). Logic mirrors that block: read `getVerdict(s, 'runtime_validation')`; if any task's verdict is `'changes_requested'`, route back to `implement`; otherwise fall through (advance to `code_review`).
  - `runtime_validation.verdict = 'approved'` → fall-through advance to `code_review`.
  - `runtime_validation.verdict = 'changes_requested'` → `implement` (reroute, same as code_review).
  - `getVerdict()` (`scripts/run-task/main.ts:127–130`) currently accepts only `'spec_review' | 'code_review'`. Widen the phase parameter union to include `'runtime_validation'` so the new switch case compiles.
  - All existing routing rules preserved.

- [ ] AC-9b: **Iteration counting must include runtime_validation reroutes so implement-mode selection works.** Currently `getIterations()` reads only `status.phases.code_review?.iterations` (`scripts/run-task/main.ts:132–134`), `buildPipelineState()` writes that single number into `TaskContext.iterations` (`scripts/run-task/main.ts:142–153`), and `runImplementPhase()` selects the revision-mode prompt only when `tasks.some(t => t.iterations > 0)` (`scripts/run-task/phases/implement.ts:43, 52–53`). Without a change, a first runtime_validation failure routes back to `implement` with `TaskContext.iterations === 0` and Codex receives the **fresh** implement prompt — losing the runtime-failure context required by AC-8/AC-12.
  
  Required change: extend `TaskContext` with a new field `runtimeIterations: number` populated from `status.phases.runtime_validation?.iterations ?? 0`. Update `runImplementPhase()` so the `isRevision` condition is `tasks.some(t => t.iterations > 0 || t.runtimeIterations > 0)`. The two counters stay independent (Known Risks already documents that — `runtime_validation.iterations` and `code_review.iterations` each have their own auto-block cap).
  
  AC-10 tests must cover: a task with `runtime_validation.iterations = 1` and `code_review.iterations = 0` selects the revision prompt path (not the fresh prompt path).
- [ ] AC-10: New test file `tests/run-task-runtime-validation.test.ts` covers:
  - Empty registry → phase becomes no-op (no handoff write, verdict=`approved`, status=`done`)
  - Single passing check → handoff section appended with Pass row, verdict=`approved`, status=`done`
  - Single failing check → handoff section appended with Fail row + captured stderr, status=`done`, verdict=`changes_requested` (matches existing `code_review` failure convention)
  - Timeout → recorded as Timeout, verdict=`changes_requested`
  - `when()` predicate filters: a check whose `when` returns false is not run and not recorded
  - Iteration 2 re-run: latest result wins for each check (composes with the cumulative-handoff convention)
  - `cwd: 'worktree'` vs `cwd: 'repo_root'`: command runs from the correct directory
  - On Pass: only check-induced delta paths outside `tasks/` are cleaned; `git status --porcelain` returns to its pre-check state for those paths
  - On Fail: artifacts copied to `tasks/<id>/runtime-check-output/<check>/iter-<N>/`, then delta cleaned (still excluding `tasks/`)
  - **Declared `artifactPaths` preserves gitignored paths (AC-11 step 4)**: configure a test check with `artifactPaths: ['fixtures/ignored-output/']` where that directory is gitignored. The check writes a report file there at runtime. Assert (a) `git status --porcelain` does NOT surface the file (sanity check that it really is gitignored), (b) the file is nevertheless copied into `tasks/<id>/runtime-check-output/<check>/iter-1/fixtures/ignored-output/<file>`, and (c) the prompt builder finds and includes the contents per AC-12's stderr-source-order rule. A second sub-case covers the missing-path log: declare an `artifactPaths` entry that doesn't exist on disk and assert the stderr log line is emitted without aborting the phase.
  - **Stderr source order (AC-12)**: render the reroute prompt twice for the same failed check. Case (1): `stderr.log` exists with 3KB of content — assert the prompt contains the first 2KB head-truncated from the file, not the 512-byte handoff excerpt. Case (2): delete `stderr.log` before rendering — assert the prompt falls back to the handoff excerpt and contains the annotation `[stderr.log missing — using truncated handoff excerpt]`.
  - **Two-tier capture (AC-13)**: run a failing check whose stderr is at least 100KB. Assert (a) the on-disk `stderr.log` in the artifact directory contains the full ≥100KB (byte-equal to what the subprocess wrote — no truncation), (b) the handoff row's Notes cell contains only the first 512 bytes of that output, and (c) the prompt rendered from this iteration contains the first 2KB. This is the regression guard against any future refactor that re-bounds the disk sink to the in-memory buffer's size.
  - **Preserves pre-existing dirty task artifacts (AC-11 invariant)**: before invoking the phase, the test seeds `tasks/<id>/handoff.md` and `tasks/<id>/notes.md` as uncommitted dirty files (and optionally a dirty source file outside `tasks/`). After a failing check that itself writes a new untracked file outside `tasks/`, the test asserts that (a) the pre-existing dirty `handoff.md` / `notes.md` are byte-identical to their pre-phase content, (b) the check-induced untracked file is removed, (c) the pre-existing dirty source file outside `tasks/` is also untouched (it was not in the check's delta).
  - Reroute prompt includes failing check name, captured stderr (truncated), artifact path, and `artifactReadingHint` if set on the check
  - **Revision-mode selection covers runtime-only reroutes (AC-9b)**: with `code_review.iterations === 0` and `runtime_validation.iterations === 1`, `buildPipelineState()` produces `TaskContext.runtimeIterations === 1`, and the implement-mode selection in `runImplementPhase` chooses the revisions prompt (not the fresh prompt). Asserted by checking which prompt-builder function is invoked (test seam) or by snapshotting the rendered prompt text.
  - **Revision prompt template — three shapes (AC-12b)**: render `promptImplementRevisions` with (a) review-only state, (b) runtime-only state, (c) both. Assert each rendered output: review-only contains the `## Round N` read instruction and no runtime block; runtime-only contains the `## Runtime check failures to address` block and **no reference to `review.md` or `## Round N`**; both contains review block first then runtime block. Iteration banner reflects the shape per AC-12b.
  
  Tests use the AC-4 test-seam parameter (`runRuntimeValidationPhase(taskIds, ctx, checks)`) to inject an explicit `RuntimeCheck[]` registry, since ESM-imported `RUNTIME_CHECKS` cannot be mutated at runtime. Tests use `spawn` (matching AC-13) against `echo`/`sh -c "exit 1"`/`sleep` real subprocesses for deterministic behavior.

- [ ] AC-11: **Failure-path artifact preservation + scoped delta cleanup.** The cleanup MUST NOT use a blanket `git stash --include-untracked` that would discard pre-existing dirty task artifacts. After `implement` closes and `autoCommitCode` runs (`scripts/run-task/main.ts:262–270, 376–384`), only paths listed in the handoff's Changes table are committed. Task artifacts the orchestrator manages — `tasks/<task-id>/handoff.md`, `tasks/<task-id>/notes.md`, `tasks/<task-id>/status.json`, and anything else under `tasks/<task-id>/` — typically stay uncommitted in the worktree and are later synced to the main checkout by `syncWorktreeArtifacts()` (`scripts/run-task/worktree.ts:149–174`). A blanket stash/drop would erase those files and the next sync would propagate the erasure.
  
  Required behavior:
  1. **Snapshot before each check**: capture `git status --porcelain=v1 -uall` from the check's `cwd` immediately before invoking the check. Parse it into a `Set<string>` of dirty paths (`preDirty`). Note: `git status` does **not** surface gitignored paths even with `-uall`, by design.
  2. **Snapshot after each check**: capture the same porcelain output post-check (`postDirty`).
  3. **Compute the check-induced delta**: `delta = postDirty \ preDirty` (paths that became dirty during the check). This is the only set of paths the **cleanup** step is allowed to touch. Paths already dirty before the check (including any uncommitted task artifacts) are out of bounds for cleanup. Delta does NOT govern artifact preservation — that has its own rule (step 4).
  4. **Artifact preservation on Fail or Timeout — declared paths bypass delta**:
     - **If `RuntimeCheck.artifactPaths` is set**: for each declared path, resolve it relative to the check's `cwd` and copy it verbatim if it exists on disk, **regardless of whether it appears in `delta`, in `git status`, or is gitignored**. This is the critical path for e2e runners that write reports/traces to gitignored directories (Playwright's `test-results/`, `playwright-report/`; Cypress's `cypress/screenshots/`, `cypress/videos/`; etc.) — `git status` does not surface those, so a delta-only rule would silently drop the artifacts the reroute prompt's `artifactReadingHint` points Codex at. Declared paths may be files or directories; directories are copied recursively. Missing declared paths are logged to stderr (`[<check-name> artifactPath '<p>' not found — skipping]`) but do not fail the phase.
     - **If `RuntimeCheck.artifactPaths` is NOT set**: fall back to the implicit-delta path — copy all of `delta` (paths that became dirty during this check). This is the safety net for checks whose authors didn't declare artifact paths; it captures whatever non-gitignored output landed in the worktree.
     - Either way, copy the resolved set into `tasks/<task-id>/runtime-check-output/<check-name>/iter-<N>/` (sanitize `check-name` per the existing Known Risk note). The `stdout.log` and `stderr.log` files in that directory are produced by AC-13's full-fidelity sink (streamed directly to disk during the check run, **not** dumped from a bounded in-memory buffer) and are therefore complete regardless of output size. The artifact-preservation step here just confirms they land in the final directory: if AC-13 wrote them in place, no move is needed; if AC-13 wrote them to a sibling scratch location, move them in on Fail. On Pass, AC-13 deletes them and they never appear in the artifact directory.
     - **Rationale for the split**: declared `artifactPaths` is the explicit-intent surface (the check author told us "these are the artifacts"); the delta is the implicit-intent fallback. Intersecting the two would silently dilute explicit intent, which is exactly the failure mode the round-3 spec review caught.
  5. **Scoped cleanup**: for every path in `delta` EXCEPT paths under `tasks/` (regardless of task id) and paths under `runtime-check-output/`, restore to the pre-check state. Implementation: tracked-but-modified delta paths → `git checkout -- <path>` from the worktree cwd; untracked delta paths → `rm` (or `rm -rf` for directories). Do **not** use `git stash`, `git clean`, or any other blanket invocation that operates on more than the explicit delta path list. Declared `artifactPaths` that point at gitignored locations are not in `delta` and therefore are not cleaned by this step — they remain on disk after the phase exits. That's fine: gitignored paths don't pollute commits, and adopters who want them cleaned can do so in their check command.
  6. On Pass: same scoped cleanup over `delta` (still excluding `tasks/`), but skip the artifact-copy step. No artifact directory is created on Pass.
  7. On Fail, write the artifact path into the handoff Fail row's Notes column: `"... artifacts: tasks/<task-id>/runtime-check-output/<check-name>/iter-<N>/"`.

  **Invariant**: cleanup MUST be a no-op for any path under `tasks/` (the task-artifact namespace) and for any path that was dirty before the check started. Tests in AC-10 exercise this directly — see the new "preserves pre-existing dirty task artifacts" case.
  
  **`.gitignore` addition**: `tasks/*/runtime-check-output/` is added to the project's `.gitignore` so artifact directories don't pollute the durable git record. The cumulative handoff sections remain the durable log; artifacts are debugging junk that doesn't survive `--ship`. Codex's iteration 2 session can still read the directory directly from disk because gitignored files exist on the worktree filesystem; they just aren't tracked.
  
  Auto-commit gate already exempts paths under `tasks/` via `autoCommitAllowedSourceBypass` — and gitignored files are not surfaced by `git status` anyway, so neither path interferes with iteration commits.

- [ ] AC-12: **Failure-mode reroute prompt for Codex.** When `runtime_validation.verdict = 'changes_requested'` triggers a route back to `implement`, the implement-revision prompt builder (`scripts/run-task/prompts/index.ts:135–155`) includes a new `## Runtime check failures to address` section. For each failed check, the section contains:
  - Check name (verbatim from the registry)
  - Captured stderr (truncated to 2KB).
    
    **Stderr source order** (explicit, since AC-5's handoff row only stores 512 bytes — less than the 2KB the prompt needs):
    1. **Preferred**: read `tasks/<task-id>/runtime-check-output/<check-name>/iter-<N>/stderr.log` from disk if it exists, and head-truncate to 2KB. AC-11 step 4 writes this file (full, untruncated) on every Fail/Timeout, so it is the authoritative source for prompt content.
    2. **Fallback**: if the file is missing for any reason (manual artifact deletion, disk error, prior pipeline run lost the directory), use the 512-byte excerpt parsed from the handoff row via `computeLatestRuntimeResults()`. Annotate the prompt section with `[stderr.log missing — using truncated handoff excerpt]` so Codex knows the context is shallower than usual.
    
    The prompt builder reads the iteration number from `runtime_validation.iterations` to construct the path. The `computeLatestRuntimeResults` helper is therefore used to identify *which checks failed in the latest iteration* and their handoff excerpts; the full-fidelity stderr is then loaded from disk by path. This split keeps the markdown parser focused on structure and lets the prompt content use the high-fidelity source.
  - Artifact path: `tasks/<id>/runtime-check-output/<check-name>/iter-<N>/`
  - The check's `artifactReadingHint` if set (verbatim, appended after the artifact path). Sourced at render time from `RUNTIME_CHECKS` in `scripts/pipeline-policy.ts` by check name — NOT from the handoff row, which does not carry the hint.
  - A standard discipline block (verbatim, identical for every failed check):
    ```
    Discipline:
    1. READ the artifacts before proposing a fix. The cause is usually visible there.
    2. Fix the code, NOT the check. Don't add waits, weaken selectors, or modify
       assertions unless the spec explicitly authorizes a behavior change.
    3. You cannot re-run this check yourself — the orchestrator will re-run after
       you close implement. You're fixing blind based on captured output.
    4. If you cannot determine the root cause from the artifacts, write your
       hypothesis in the handoff's Blockers section and request human escalation.
       Blind guessing burns iterations toward auto-block.
    ```
  
- [ ] AC-12b: **The implement-revision prompt template must be valid for all three failure shapes**: review-findings-only, runtime-failures-only, both. The current template (`scripts/run-task/prompts/templates/implement-revisions.md`) is **code-review-specific** — it tells Codex that Claude appended findings to `review.md`, instructs reading `## Round N`, and tells Codex to append `## Iteration N — addressing review round N` (`implement-revisions.md:1, 6, 12, 15`). On a first runtime-only failure (`code_review.iterations === 0`, `runtime_validation.iterations === 1`), there is no `review.md` and no `## Round 0`; this template would be invalid.
  
  Required change: rework the template + builder so the prompt composes from two independent conditional blocks driven by Mustache flags (canon's renderer at `scripts/run-task/prompts/render.ts` uses Mustache, not Handlebars — section syntax `{{#flag}}...{{/flag}}` is identical between the two but no Handlebars-only helpers may be used):
  
  - `hasReviewFindings` — set when `code_review.iterations > 0`. When true, render the existing "read `## Round N` of `review.md`" block (current template body). When false, omit it entirely.
  - `hasRuntimeFailures` — set when `runtime_validation.iterations > 0`. When true, render the AC-12 `## Runtime check failures to address` block (one entry per failed check, plus the discipline block). When false, omit it.
  
  Both flags are computed in `promptImplementRevisions(state)` from the per-task counters. The iteration banner (`[ITERATION N — ...]`) and handoff-append instruction must also conditionalize their wording so they're correct in each shape:
  - review-only: `[ITERATION N — addressing code review round M]`, append `## Iteration N — addressing review round M`
  - runtime-only: `[ITERATION N — addressing runtime validation failures]`, append `## Iteration N — addressing runtime validation`
  - both: `[ITERATION N — addressing code review round M and runtime validation failures]`, append `## Iteration N — addressing review round M and runtime validation`
  
  N is the next iteration number — `max(code_review.iterations, runtime_validation.iterations) + 1`. M is the prior code_review round (`code_review.iterations`).
  
  Section ordering in the rendered prompt when both flags are true: review findings first (more abstract), runtime failures second (concrete tool output). Codex addresses both.
  
  Test coverage: AC-10's "Reroute prompt includes ..." case asserts the rendered prompt for each shape — review-only, runtime-only, both — contains the right banner, the right top-level read instruction (review.md only when `hasReviewFindings`), and (for runtime cases) the failed check's name, stderr, path, hint, and discipline block.

- [ ] AC-13: **Real-time output streaming + heartbeat, with two-tier capture.** Long-running checks (playwright, deploy smoke) can take minutes and produce megabytes of output. The dispatcher uses `spawn` (not `spawnSync`) and maintains **two independent sinks per stream** to satisfy AC-5 (handoff has tight 512-byte excerpts), AC-11 (artifact `stdout.log` / `stderr.log` are full, untruncated), and AC-12 (prompt reads 2KB from the artifact log) without contradiction:
  1. Pipes the child's stdout/stderr through to the orchestrator's stdout/stderr in real time. Operator sees check output as it happens — progress dots, intermediate failures, final summary.
  2. **Full-fidelity sink (unbounded)**: stream each chunk directly to a temp file on disk — `<scratch>/stdout.log` and `<scratch>/stderr.log` (e.g., `tasks/<task-id>/runtime-check-output/<check-name>/iter-<N>/` itself, pre-created at check start, or a sibling temp directory if the artifact dir should only materialize on Fail). No in-memory size cap on this sink. On Fail/Timeout: the files remain in the artifact directory (AC-11 step 4 references them). On Pass: delete the files (and the directory, if empty).
  3. **Bounded summary buffer (head-truncated, in-memory)**: in parallel with the disk write, retain a small in-memory buffer per stream — **head-512-byte** for the handoff Notes cell per AC-5, and **head-2KB** for any in-process consumer that needs it. Implementation note: a 2KB rolling buffer suffices — derive the 512-byte handoff excerpt by slicing the first 512 bytes of the 2KB buffer. The buffer captures the head (first bytes), not a sliding tail, since AC-5 specifies the *first* 512 characters of stderr. The 2KB head bound is what protects the orchestrator's RSS from runaway-output checks; the full-fidelity content lives on disk, not in memory.
  4. **Prompt source (AC-12)** reads from the disk file head-truncated to 2KB, not from this in-memory buffer. The buffer is a fallback path / summary-display source; the disk file is the canonical content.
  5. Prints a heartbeat line `[<check-name> still running — <elapsedSec>s elapsed; <timeoutRemainingSec>s until timeout]` to stderr every 30 seconds IF no output has been seen since the last heartbeat (or the start). Heartbeat timer resets on any stdout/stderr chunk.
  6. Prints a final summary line at check completion: `[<check-name> finished in <duration> with exit code <code>]` for success/fail, `[<check-name> TIMED OUT after <duration>]` for timeout. Always on stderr so it's distinct from check output.
  7. Streaming works regardless of TTY/CI environment — output is written to `process.stdout`/`process.stderr` directly, which Node handles correctly in both interactive and piped contexts.

  Tests for this AC: capture the orchestrator's own stdout/stderr during the dispatcher run (Node's `--test` runner supports this via mocked streams) and assert (a) check output appears in real-time order, (b) heartbeat fires when expected, (c) summary line appears. A `sleep` subprocess test exercises the heartbeat path deterministically.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/types.ts` | Insert `'runtime_validation'` into `PHASE_ORDER` between `'implement'` and `'code_review'`. Update `Phase` type derivation. Type widening only — no other change. |
| `scripts/run-task/state.ts` | `deriveTopLevelStatus` already iterates `PHASE_ORDER`; no logic change but verify the new phase is treated correctly. Schema migration: when reading a `status.json` that lacks `phases.runtime_validation`, treat it as `{status: 'done', verdict: 'approved', iterations: 0}` (back-compat for tasks created before this task). |
| `tasks/_templates/status.json` | Add `runtime_validation` block to the `phases` object. |
| `scripts/pipeline-policy.ts` | Add `RuntimeCheck` type export and `RUNTIME_CHECKS: RuntimeCheck[]` array export. Canon-ai ships the single `orchestrator-phase-smoke` example. |
| `scripts/run-task/phases/runtime-validation.ts` | NEW. Main dispatcher: `runRuntimeValidationPhase(taskIds, ctx, checks?)`. Subprocess invocation, output capture, timeout, handoff write, status transition. The optional `checks?: readonly RuntimeCheck[]` parameter is the AC-4 test seam — production callers omit it and the dispatcher reads `RUNTIME_CHECKS` from `scripts/pipeline-policy.ts`; tests pass an explicit array. |
| `scripts/run-task/main.ts` | Add the new phase to the dispatch loop (`runPhase` switch). Update `checkAndRoute` to route `implement done → runtime_validation` and `runtime_validation changes_requested → implement`. Widen `getVerdict()` phase parameter to include `'runtime_validation'`. Update `buildPipelineState()` to populate the new `TaskContext.runtimeIterations` field. |
| `scripts/run-task/types.ts` (TaskContext) | Add `runtimeIterations: number` to `TaskContext` (`scripts/run-task/types.ts:80–87`). |
| `scripts/run-task/phases/implement.ts` | Update `isRevision` derivation (`implement.ts:43`) to be `tasks.some(t => t.iterations > 0 || t.runtimeIterations > 0)`. Pass the new field through so `promptImplementRevisions` can read it via `state.tasks[i].runtimeIterations`. |
| `scripts/run-task/prompts/index.ts` + `scripts/run-task/prompts/templates/implement-revisions.md` | Restructure `promptImplementRevisions` per AC-12b. Builder computes `hasReviewFindings`, `hasRuntimeFailures`, conditional banner text, and the per-check runtime-failure list. For each failed check, the builder assembles a render-time object containing: (a) the structural locator from `computeLatestRuntimeResults` parsed from handoff (check name, artifact path), (b) the stderr content from disk per AC-12 (preferred) or the handoff excerpt (fallback), and (c) the `artifactReadingHint` looked up by check name from `RUNTIME_CHECKS` in `scripts/pipeline-policy.ts` (NOT from the handoff row — the handoff cell does not carry the hint). Template uses Mustache `{{#hasReviewFindings}}...{{/hasReviewFindings}}` and `{{#hasRuntimeFailures}}...{{/hasRuntimeFailures}}` section blocks for the three composition shapes. |
| `scripts/run-task/validation.ts` | New helper `computeLatestRuntimeResults(handoffContent)` mirroring `computeLatestValidationResults` for the orchestrator section. Used by the implement-revision prompt builder. |
| `scripts/task.sh` | Recognize `runtime_validation` as a valid phase value for `task.sh phase <id> <phase> <status>` invocations. The phase-list is hardcoded in a few places (case statements, status-derivation, etc.). Update all of them. |
| `tasks/_templates/handoff.md` | Add a hint in the iteration-template comment block that orchestrator may append `### Re-run runtime validation` subsections on retries. No structural change — the section is appended at runtime, not part of the implementation handoff template. |
| `.gitignore` | Add `tasks/*/runtime-check-output/` so failed-check artifact directories don't pollute git history. |
| `tests/run-task-runtime-validation.test.ts` | NEW. Test cases per AC-10. |
| `AGENTS.md` | Document the new phase in the workflow description. Mention runtime-validation as the orchestrator's authority surface (vs. Codex's static-check authority). |
| `CLAUDE.md` / `CODEX.md` | Update phase-list references where relevant (any documented PHASE_ORDER snippets). |
| `docs/pipeline-orchestrator.md` | Document the new phase, its triggering rules, and the registration API in pipeline-policy.ts. |

### Interaction Dependencies

- **Cumulative-handoff fix (be516a5)** is a hard prerequisite for AC-5's iteration semantics. `computeLatestRuntimeResults` mirrors `computeLatestValidationResults`, which only works correctly post-be516a5.
- **`parseHandoffFiles`** (validation.ts) is used to read affected files for `when()` predicate evaluation. Already retrofitted to use parseTable in 1a-0.
- **`MAX_REVIEW_LOOPS`** semantics are shared with `code_review`. The reroute count for runtime_validation uses the same env-var-resolved cap from `pipeline-policy.ts`.
- **Future invariant-gate framework (1a-2)**: this new phase will eventually be governed by the invariant-gate (artifact-must-exist, verdict-must-be-parseable). Forward-compatible — the orchestrator writes a complete handoff section + verdict by design.
- **Worktree mode**: orchestrator already knows how to run subprocesses in the worktree (see `git.ts` `gitSafeAtRaw`). The `cwd: 'worktree'` option uses `resolveTaskCwd` (state.ts).

### Data Model Changes

- **`Phase` type**: new variant `'runtime_validation'` between `'implement'` and `'code_review'`.
- **`PhaseEntry`** (`scripts/run-task/types.ts:29–33`): no shape change. The `runtime_validation` instance is `{ status, agent: 'orchestrator', verdict, iterations }`. Verdict uses the existing shared `Verdict` union — `'approved'` on Pass, `'changes_requested'` on Fail/Timeout. **No widening of the `Verdict` type or new variant.** This keeps the type strict and uses values `getVerdict()` already handles in `checkAndRoute`.
- **`TaskContext`** (`scripts/run-task/types.ts:80–87`): add `runtimeIterations: number` field, populated from `status.phases.runtime_validation?.iterations ?? 0` in `buildPipelineState()`. Existing `iterations` field (sourced from `code_review.iterations`) is unchanged so behavior for code-review-only paths is identical. Per AC-9b, `runImplementPhase()` and `promptImplementRevisions()` are the two consumers that need to read both counters.
- **`getVerdict()`** (`scripts/run-task/main.ts:127–130`): widen the `phase` parameter from `'spec_review' | 'code_review'` to `'spec_review' | 'code_review' | 'runtime_validation'`. No body change — the lookup is generic over `status.phases[phase]?.verdict`.
- **`SessionSlot`**: NO new slot needed. The orchestrator's subprocess invocations are not agent sessions — no Codex / Claude binary involved.
- **`RuntimeCheck` type**: new public export from `pipeline-policy.ts`.

### Dispatch flow (textual)

```
implement done →
  runtime_validation phase fires →
    for each task in bundle:
      filter RUNTIME_CHECKS by when() predicate
    for each filtered check (sequential):
      snapshot pre-check `git status --porcelain` (AC-11 step 1)
      spawn (NOT spawnSync — streaming + heartbeat per AC-13)
      capture {result: Pass|Fail|Timeout, elapsed, stdout, stderr}
      snapshot post-check porcelain; compute delta = post \ pre
      on Fail/Timeout: copy delta artifacts (minus `tasks/`) into runtime-check-output/
      scoped cleanup: restore delta paths outside `tasks/` only (AC-11 step 5)
    write/append `## Runtime Validation Outcomes` (or `### Re-run` on retry) to handoff
    set status = done always (matches code_review convention so checkAndRoute's
      "phase must be done" guard at main.ts:1404–1416 passes)
    set verdict = 'approved' (all Pass) or 'changes_requested' (any Fail/Timeout) — reuses Verdict type
    checkAndRoute switch case (added next to code_review):
      verdict approved → fall through, advance to code_review
      verdict changes_requested → iterations++, route back to implement
                    (auto-block at MAX_REVIEW_LOOPS)
```

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (covers new tests + ensures existing pass)

Build, E2E, Migration runner: N/A (no compile step; no UI; status.json schema is backward-compatible via missing-block handling per AC-2).

## Docs Impact

- `AGENTS.md` — new phase in the workflow.
- `CLAUDE.md` — claude doesn't author this phase, but it should know about the new boundary (orchestrator-authored handoff section).
- `CODEX.md` — codex's implement-revision context now includes runtime validation results.
- `docs/pipeline-orchestrator.md` — phase docs + registration API.
- `docs/product-context.md` — terminology table (Runtime validation as a new term).
- `docs/architecture.md` — validation matrix gains a "runner" column (orchestrator vs codex).

## Known Risks

- **Subprocess hangs**: a misbehaving check command could hang past its timeout if the spawned process traps SIGTERM. Per AC-13 the dispatcher uses `spawn` (not `spawnSync`) so timeout handling is manual: `setTimeout(timeoutMs)` → `child.kill('SIGTERM')`; if the child hasn't exited within an additional grace period (~3s), `child.kill('SIGKILL')`. Heartbeat continues firing during the wait so the operator sees the kill sequence rather than silence.
- **Output capture size**: e2e tests can produce huge stdout/stderr (megabytes). Handoff cells stay tight: cap at **512 bytes per stream** in the handoff row (head-truncated; "..." marker if truncated). Full output written to `tasks/<id>/runtime-check-output/<check>/iter-<N>/stderr.log` and `stdout.log` for debugging. The handoff row's Notes column references that path; Codex's iteration 2 reads the full log directly. Rationale for the small handoff cap: artifacts (logs + check-emitted files) live alongside; the handoff only needs to identify which check failed at a glance, not contain the full debug trail.
- **Filename-safe `check.name`**: when writing the output log file, `check.name` may contain characters that don't work in filenames. Sanitize.
- **Worktree sync timing**: orchestrator runs checks AFTER `implement` closes and the worktree's auto-commit happens. The checks see the committed state. If a check itself writes files (e2e suites usually do — screenshots, traces, reports), those writes happen in the worktree and need cleanup. AC-11 handles this: Pass → discard; Fail → copy to `tasks/<id>/runtime-check-output/` then discard. The `tasks/` destination is already exempt from auto-commit's "must be in handoff Changes table" gate, so iteration 2's implement can read those files and commit normally without churn.
- **MAX_REVIEW_LOOPS shared between code_review and runtime_validation**: a task could legitimately need 3 implement→runtime_validation→implement passes AND 3 implement→code_review→implement passes. Under a global cap, that's 6 reroutes total. Today's cap is per-phase (each phase has its own iterations counter). Keep that — `runtime_validation.iterations` is independent from `code_review.iterations`. Document this in `pipeline-orchestrator.md`.
- **Codex's static-check trust hole remains**: this task does not close it. If a Codex hallucination on `npm run lint` happens, the pipeline still trusts it. Filed as `orchestrator-static-check-cross-verify` follow-on.
- **No retry-on-flake**: a flaky e2e fails the same as a real bug. Adopters with flaky suites get more iterations than they should. Retries / quarantine flagging is out of scope; can be added to the `RuntimeCheck` type later.
- **Scoped delta-cleanup correctness**: AC-11 deliberately avoids `git stash`, `git clean`, and any other blanket cleanup. The reason: after `implement` and `autoCommitCode`, `tasks/<task-id>/handoff.md` and other task artifacts are frequently uncommitted dirty files in the worktree. A blanket cleanup would erase them, and `syncWorktreeArtifacts` would then propagate the erasure to the main checkout. The cleanup must operate on `delta = postDirty \ preDirty` only, and skip paths under `tasks/`. AC-10 has a dedicated test (the "preserves pre-existing dirty task artifacts" case) that exercises this invariant — a regression there means handoffs can vanish mid-pipeline.
- **Self-bootstrapping**: this task's pipeline run uses the OLD PHASE_ORDER (no runtime_validation phase). The new phase only activates after this task lands. Acceptable — same as how 1a-0's pipeline didn't validate its own parser. Don't try to test the new phase end-to-end during this task's own pipeline; that's what subsequent tasks will exercise.

## Human Test Plan

The product owner is the developer running canon-ai (and adopters like gallery_wall).

1. After the pipeline completes, inspect `scripts/pipeline-policy.ts` — confirm the `RUNTIME_CHECKS` export exists and ships exactly one `orchestrator-phase-smoke` example check.
2. Run a tiny canon-ai task manually through the pipeline (e.g., a no-op spec change). Watch the log: the `runtime_validation` phase should fire after `implement`, print "Running orchestrator-phase-smoke...", complete, write a `## Runtime Validation Outcomes` section to that task's handoff with one Pass row, and advance to `code_review`.
3. Force a failure for testing: temporarily edit the example check's command to `false` (returns exit 1). Re-run a small task. Expect: `runtime_validation` phase fires, captures the failure, writes a Fail row to handoff, reroutes to `implement`. Codex's iteration 2 prompt should reference the failure. Reset the command after testing.
4. (Adopter test, gallery_wall) Replace canon-ai's `orchestrator-phase-smoke` with `{ name: 'e2e', command: 'npm run test:e2e', timeoutMs: 30 * 60 * 1000 }`. Run a real task through gallery_wall's pipeline. Expect: e2e runs from orchestrator's environment, results land in the handoff, normal pipeline advances when e2e passes.
5. Verify the existing tests still pass: `npm test` reports the new runtime-validation suite passing + all prior tests unchanged.

---

## Spec Quality Checklist

- [x] Every AC states how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Known Risks covers the main failure modes (subprocess hang, output size, worktree pollution, trust gaps, self-bootstrapping)
- [x] Human Test Plan uses product-level steps (run a task, look at the handoff section, edit the registry)
- [x] Validation Required has lint, type-check, unit tests
- [x] Non-Goals prevents scope creep (cross-check trust model, plugin system, parallel execution, sandbox-escape all deferred)
