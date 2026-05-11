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
- [ ] AC-4: New module `scripts/run-task/phases/runtime-validation.ts` exports `runRuntimeValidationPhase(taskIds, ctx)` mirroring the existing phase-module pattern (`scripts/run-task/phases/code-review.ts` as the closest reference). It:
  1. Reads `RUNTIME_CHECKS` from `pipeline-policy.ts`.
  2. For each task in the bundle, filters checks by `when()` predicate against the task's `status` and parsed-from-handoff affected files (using `parseHandoffFiles` from `validation.ts`).
  3. Runs filtered checks sequentially via `spawn` with real-time output streaming + heartbeat (see AC-13).
  4. Captures stdout, stderr, exit code, and elapsed time per check.
  5. Writes results to `handoff.md` (see AC-5).
  6. Sets `phases.runtime_validation.verdict` to `passed` (all checks Pass) or `failed` (any Fail/Timeout), and `status` to `done`.
- [ ] AC-4b: Empty-registry / all-filtered-out case: dispatcher writes nothing to the handoff, sets `phases.runtime_validation` to `{ status: "done", verdict: "passed", iterations: 0 }`, and routes to `code_review` immediately. No `## Runtime Validation Outcomes` section is added in this case (avoids visual noise on every handoff).
- [ ] AC-5: Results land in a new section `## Runtime Validation Outcomes` appended to the handoff (positioned after `## Validation Outcomes`, before `## Ready for Review`). Format:
  ```markdown
  ## Runtime Validation Outcomes

  > Authored by the orchestrator after Codex's implement phase. Codex did not run these checks.

  | Check | Result | Elapsed | Notes |
  |---|---|---|---|
  | `<name>` | Pass / Fail / Timeout | 12.4s | exit code 0; first 512 chars of stderr (full log: tasks/<id>/runtime-check-output/<check>/iter-N/) |
  ```
  On iteration N (revision): orchestrator appends a `### Re-run runtime validation` h3 inside the latest `## Iteration N` handoff section, mirroring Codex's `### Re-run validation` convention. This composes with the cumulative-handoff fix from commit be516a5 — `computeLatestValidationResults` does not include orchestrator-section checks, but a sibling function `computeLatestRuntimeResults` MUST do the same latest-wins logic over `## Runtime Validation Outcomes` + iteration `### Re-run runtime validation` subsections.
- [ ] AC-6: Failure routing: if any check in the final per-check map has result `Fail` or `Timeout`, the orchestrator sets `phases.runtime_validation.verdict = 'failed'`, `phases.runtime_validation.status = 'changes_requested'`, increments `iterations`, and routes back to `implement`. Same auto-block semantics as `code_review`: when `iterations` exceeds `MAX_REVIEW_LOOPS` (resolved from `pipeline-policy.ts`), halt with an explicit message and require manual reset to resume.
- [ ] AC-7: Timeout behavior: a check exceeding its `timeoutMs` is killed and recorded as `Timeout` with the elapsed time recorded as the timeout value. Timeout is treated as Fail for routing purposes. Default 10min; env-var `ORCHESTRATOR_CHECK_TIMEOUT_MS` (singular global override; per-check `timeoutMs` in the registry wins over env-var).
- [ ] AC-8: Codex's implement-revision prompt is updated to read `## Runtime Validation Outcomes` (latest iteration's `### Re-run runtime validation` if present, otherwise the baseline section) and include the failing checks' names + captured stderr in the prompt context. Codex iteration 2+ knows what runtime checks failed and why. Existing prompt-build infrastructure in `scripts/run-task/prompts/` is the reference; reuse `parseTable` + `parseTableH3` + `extractSectionBodies` from `markdown-table.ts`.
- [ ] AC-9: Dispatch routing in `scripts/run-task/main.ts` (`PHASE_ORDER` walk, `checkAndRoute` logic) routes:
  - `implement.status = done` → `runtime_validation`
  - `runtime_validation.verdict = passed` → `code_review`
  - `runtime_validation.verdict = failed` → `implement` (reroute, same as code_review)
  - All existing routing rules preserved.
- [ ] AC-10: New test file `tests/run-task-runtime-validation.test.ts` covers:
  - Empty registry → phase becomes no-op (no handoff write, verdict=passed)
  - Single passing check → handoff section appended with Pass row, verdict=passed
  - Single failing check → handoff section appended with Fail row + captured stderr, verdict=failed, status=changes_requested
  - Timeout → recorded as Timeout, verdict=failed
  - `when()` predicate filters: a check whose `when` returns false is not run and not recorded
  - Iteration 2 re-run: latest result wins for each check (composes with the cumulative-handoff convention)
  - `cwd: 'worktree'` vs `cwd: 'repo_root'`: command runs from the correct directory
  - On Pass: worktree pollution is discarded (`git status --porcelain` is clean post-check)
  - On Fail: artifacts copied to `tasks/<id>/runtime-check-output/<check>/iter-<N>/`, then worktree cleaned
  - Reroute prompt includes failing check name, captured stderr (truncated), artifact path, and `artifactReadingHint` if set on the check
  
  Tests stub `RUNTIME_CHECKS` and use `spawnSync` against `echo`/`sh -c "exit 1"`/`sleep` real subprocesses for deterministic behavior.

- [ ] AC-11: **Failure-path artifact preservation (excluded from git).** On any check Fail or Timeout, the orchestrator:
  1. Determines which worktree paths to preserve: `RuntimeCheck.artifactPaths` if specified, else all paths in `git status --porcelain` delta between pre-check and post-check states.
  2. Copies those paths to `tasks/<id>/runtime-check-output/<check-name>/iter-<N>/` (sanitize `check-name` for filename safety). Directory is created if absent.
  3. Also writes captured `stdout.log` and `stderr.log` (full, untruncated) to the same directory.
  4. Runs `git stash --include-untracked -- '*' ':!tasks/*/runtime-check-output/'` (or equivalent — preserve gitignored directory through cleanup). Drops the stash.
  5. Writes the artifact path into the handoff Fail row's Notes column: `"... artifacts: tasks/<id>/runtime-check-output/<check-name>/iter-<N>/"`.
  
  On Pass: skip the copy step; run cleanup as in (4). No artifact directory created on Pass.
  
  **`.gitignore` addition**: `tasks/*/runtime-check-output/` is added to the project's `.gitignore` so artifact directories don't pollute the durable git record. The cumulative handoff sections remain the durable log; artifacts are debugging junk that doesn't survive `--ship`. Codex's iteration 2 session can still read the directory directly from disk because gitignored files exist on the worktree filesystem; they just aren't tracked.
  
  Auto-commit gate already exempts paths under `tasks/` via `autoCommitAllowedSourceBypass` — and gitignored files are not surfaced by `git status` anyway, so neither path interferes with iteration commits.

- [ ] AC-12: **Failure-mode reroute prompt for Codex.** When `runtime_validation.verdict = 'failed'` triggers a route back to `implement`, the implement-revision prompt builder (`scripts/run-task/prompts/`) includes a new `## Runtime check failures to address` section. For each failed check, the section contains:
  - Check name (verbatim from the registry)
  - Captured stderr (truncated to 2KB, full output reference)
  - Artifact path: `tasks/<id>/runtime-check-output/<check-name>/iter-<N>/`
  - The check's `artifactReadingHint` if set (verbatim, appended after the artifact path)
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
  
  The prompt composes with existing review.md content when both are present (e.g., iteration 3 has unresolved code_review findings from iter 1 AND fresh runtime_validation failures from iter 2). Both sections appear in the prompt; Codex addresses both. Order: review findings first (more abstract), runtime failures second (concrete tool output).
  
  Test coverage: AC-10's "Reroute prompt includes ..." case asserts the rendered prompt contains all required elements (name, stderr, path, hint, discipline block).

- [ ] AC-13: **Real-time output streaming + heartbeat.** Long-running checks (playwright, deploy smoke) can take minutes. The dispatcher uses `spawn` (not `spawnSync`) and:
  1. Pipes the child's stdout/stderr through to the orchestrator's stdout/stderr in real time. Operator sees check output as it happens — progress dots, intermediate failures, final summary.
  2. Maintains a capture buffer for both streams (used for handoff write per AC-5; truncated to 2KB per stream).
  3. Prints a heartbeat line `[<check-name> still running — <elapsedSec>s elapsed; <timeoutRemainingSec>s until timeout]` to stderr every 30 seconds IF no output has been seen since the last heartbeat (or the start). Heartbeat timer resets on any stdout/stderr chunk.
  4. Prints a final summary line at check completion: `[<check-name> finished in <duration> with exit code <code>]` for success/fail, `[<check-name> TIMED OUT after <duration>]` for timeout. Always on stderr so it's distinct from check output.
  5. Streaming works regardless of TTY/CI environment — output is written to `process.stdout`/`process.stderr` directly, which Node handles correctly in both interactive and piped contexts.

  Tests for this AC: capture the orchestrator's own stdout/stderr during the dispatcher run (Node's `--test` runner supports this via mocked streams) and assert (a) check output appears in real-time order, (b) heartbeat fires when expected, (c) summary line appears. A `sleep` subprocess test exercises the heartbeat path deterministically.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/types.ts` | Insert `'runtime_validation'` into `PHASE_ORDER` between `'implement'` and `'code_review'`. Update `Phase` type derivation. Type widening only — no other change. |
| `scripts/run-task/state.ts` | `deriveTopLevelStatus` already iterates `PHASE_ORDER`; no logic change but verify the new phase is treated correctly. Schema migration: when reading a `status.json` that lacks `phases.runtime_validation`, treat it as `{status: 'done', verdict: 'passed', iterations: 0}` (back-compat for tasks created before this task). |
| `tasks/_templates/status.json` | Add `runtime_validation` block to the `phases` object. |
| `scripts/pipeline-policy.ts` | Add `RuntimeCheck` type export and `RUNTIME_CHECKS: RuntimeCheck[]` array export. Canon-ai ships the single `orchestrator-phase-smoke` example. |
| `scripts/run-task/phases/runtime-validation.ts` | NEW. Main dispatcher: `runRuntimeValidationPhase(taskIds, ctx)`. Subprocess invocation, output capture, timeout, handoff write, status transition. |
| `scripts/run-task/main.ts` | Add the new phase to the dispatch loop (`runPhase` switch). Update `checkAndRoute` to route `implement done → runtime_validation` and `runtime_validation failed → implement`. |
| `scripts/run-task/prompts/index.ts` + `scripts/run-task/prompts/templates/` | Update `promptImplementRevisions` (or equivalent revision prompt builder) to read `## Runtime Validation Outcomes` and include failing-check context. Specific template file TBD by implementer based on actual prompts/ layout. |
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
- **`PhaseEntry`** (or whatever the status.json phase block type is called): new instance for `runtime_validation` with `{ status, agent: 'orchestrator', verdict, iterations }`. Verdict values: `'passed' | 'failed'` (smaller than code_review's 4-way).
- **`SessionSlot`**: NO new slot needed. The orchestrator's subprocess invocations are not agent sessions — no Codex / Claude binary involved.
- **`RuntimeCheck` type**: new public export from `pipeline-policy.ts`.

### Dispatch flow (textual)

```
implement done →
  runtime_validation phase fires →
    for each task in bundle:
      filter RUNTIME_CHECKS by when() predicate
    for each filtered check (sequential):
      spawnSync with timeout
      capture {result: Pass|Fail|Timeout, elapsed, stderr}
    write/append `## Runtime Validation Outcomes` (or `### Re-run` on retry) to handoff
    set verdict based on all-Pass vs any-Fail/Timeout
    if passed → status = done → route to code_review
    if failed → status = changes_requested, iterations++, route back to implement
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
