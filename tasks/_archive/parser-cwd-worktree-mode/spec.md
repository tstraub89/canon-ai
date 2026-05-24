# Spec: parser-cwd-worktree-mode — Thread cwd through task-file parsers for worktree mode

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Four task-file parsers in `scripts/run-task/validation.ts` read from `taskDirFor(taskId)` at [state.ts:34](../../scripts/run-task/state.ts:34), which resolves to `path.join(TASKS_DIR, taskId)` where `TASKS_DIR` is `path.join(REPO_ROOT, 'tasks')`. The path is REPO_ROOT-anchored regardless of the caller's context:

- `parseAffectedFilesFromSpec(taskId)` at [validation.ts:650](../../scripts/run-task/validation.ts:650) — reads `tasks/<id>/spec.md`
- `parseHandoffChangesRows(taskId)` at [validation.ts:618](../../scripts/run-task/validation.ts:618) — reads `tasks/<id>/handoff.md`
- `parseHandoffFiles(taskId)` at [validation.ts:593](../../scripts/run-task/validation.ts:593) — wraps `parseHandoffChangesRows`
- `validateHandoff(taskId)` at [validation.ts:71](../../scripts/run-task/validation.ts:71) — reads `tasks/<id>/spec.md` directly + calls `parseHandoffChangesRows`

For worktree-mode tasks (the default — `worktree: true` in status.json), the worktree IS the source of truth for task files during pipeline execution. The pipeline writes spec / handoff / review / done / notes / status.json into the worktree's `tasks/<id>/` directory. REPO_ROOT's task dir is a lazy mirror that gets updated via `syncWorktreeArtifacts` at certain phase boundaries but is NOT canonical during pipeline-phase operations.

When a parser is invoked during a worktree-mode phase, it reads REPO_ROOT's stale copy instead of the worktree's actual content. The bug manifests at the following worktree-context call sites:

**Human-review / push path** ([main.ts](../../scripts/run-task/main.ts)):
- **`commitHumanReviewFiles`** at [main.ts:887](../../scripts/run-task/main.ts:887) — calls `parseAffectedFilesFromSpec` to build the `--pr` allow-list. Bug surfaced 2026-05-23 during prepr-base-drift-check's `--pr` cycle: operator edited the worktree's `spec.md` to add `docs/codebase-map.md` to Affected Files (the documented recovery for v2's "QA touched a managed doc not in spec" Known Risk). v2's gate fired anyway because the parser read REPO_ROOT's pre-edit copy. Workaround: `cp` the worktree's spec to REPO_ROOT before re-running. Brittle, breaks canon's worktree-isolation discipline.
- **`verifyBaseDrift`** at [validation.ts:938](../../scripts/run-task/validation.ts:938) — just shipped in PR #97 (Fix 1). Calls `parseAffectedFilesFromSpec` and inherits the same latent bug. Not yet bitten because Fix 1 doesn't have a real-world contamination case under test, but the bug will fire the first time someone edits a worktree spec to satisfy base-drift.
- **`verifyHandoffAgainstDiff`** at [validation.ts:918](../../scripts/run-task/validation.ts:918) — calls `parseHandoffFiles` to verify the handoff's Changes table matches the diff. Latent bug: if the worktree's handoff diverges from REPO_ROOT's mirror (which it can during implement-phase iterations before sync), the parser sees REPO_ROOT and the diff cross-check is against a stale handoff.

**Code-review preflight** ([scripts/run-task/phases/code-review.ts](../../scripts/run-task/phases/code-review.ts)):
- **`runCodeReviewPhase` preflight** at [code-review.ts:44-47](../../scripts/run-task/phases/code-review.ts:44) — calls `validateHandoff(t.taskId)` per task and `verifyHandoffAgainstDiff(taskIds, baseBranch)` for the bundle. Worktree mode is the default for these paths (`getActiveCwd(taskIds)` is already in scope at [code-review.ts:24](../../scripts/run-task/phases/code-review.ts:24)). The preflight then writes the rejection review.md into `resolveTaskCwd(taskId)` — the worktree — but validates against REPO_ROOT's stale spec/handoff. A worktree handoff edit between implement and the preflight call is invisible; the preflight either rejects a fixed handoff or passes a stale one.

**Implement-phase auto-commit / evidence advance** ([main.ts](../../scripts/run-task/main.ts)):
- **`autoCommitCode`** at [main.ts:346](../../scripts/run-task/main.ts:346) — already takes `cwd` (passed by `checkAndRoute` at line 2267 as `splitWorktree.getActiveCwd(taskIds)`) and uses it for git porcelain reads. Calls `parseHandoffChangesRows(taskId)` at line 358 without forwarding `cwd`, so the auto-commit allow-list is built from REPO_ROOT's handoff. The worktree's handoff is canonical for implement-phase auto-commit; reading REPO_ROOT means a freshly-rewritten handoff can be ignored and a stale one enforced.
- **`tryEvidenceAdvance`** at [main.ts:1988](../../scripts/run-task/main.ts:1988) — two stale-read paths under worktree mode:
  - `case 'implement'`: calls `parseHandoffChangesRows(taskId)` at line 2002 and `validateHandoffAgainstSpec(path.join(taskDirFor(taskId), 'spec.md'), path.join(taskDirFor(taskId), 'handoff.md'))` at lines 2011-2013. Both REPO_ROOT-anchored.
  - `case 'code_review'`: calls `readArtifact(taskId, 'review.md')` at line 2052; `readArtifact` at [main.ts:1983](../../scripts/run-task/main.ts:1983) resolves via `taskDirFor(taskId)` — REPO_ROOT-anchored. But `review.md` is written into the worktree by `runCodeReviewPhase` (both the BLOCKED-path write at [code-review.ts:84](../../scripts/run-task/phases/code-review.ts:84) and the post-Claude read at [code-review.ts:124](../../scripts/run-task/phases/code-review.ts:124) use `resolveTaskCwd(taskId)`). Evidence advance therefore reads the wrong file: a fresh worktree review.md is invisible while a stale REPO_ROOT copy can falsely satisfy the verdict check.
  - `case 'qa'`: at line 2083 resolves done.md as `path.join(splitState.taskDirFor(taskId), 'done.md')` — REPO_ROOT-anchored. But `runQaPhase` writes done.md into the worktree (the salvage write at [qa.ts:39](../../scripts/run-task/phases/qa.ts:39) uses `getActiveCwd(taskIds)`, and the QA prompt template directs Claude to write `tasks/<id>/done.md` from the worktree-anchored agent cwd). Evidence advance reads a stale REPO_ROOT done.md and either falsely templates the recovery (worktree was populated) or falsely advances (REPO_ROOT had old content).
  - Other branches (`spec_review`, `spec`, `plan`) run in REPO_ROOT today, so their `readArtifact` calls remain correct; no cwd needed there.
  - Invoked from `recoverPhaseForTask` → `checkAndRoute`, which already computes `splitWorktree.getActiveCwd(taskIds)` for `autoCommitCode`. The same cwd should flow to evidence advance for the implement, code_review, and qa branches.

**This is a class of bug.** Any current or future parser that takes only `taskId` and reads a task file via `taskDirFor` is suspect under worktree mode. The fix is a uniform plumbing change: parsers gain an optional `cwd` parameter (default REPO_ROOT for backward compatibility); worktree-context callers pass their cwd; REPO_ROOT-context callers (`canon task phase` / `list` / `status`, `checkPhaseGate` in `state.ts`, `buildContextBlock` in `context.ts`) keep working unchanged via the default.

**Why band-aid, not structural**: the deeper problem is that canon maintains two copies of task files (worktree + REPO_ROOT) with bidirectional, time-lagged sync. The structural fix is the worktree-canonical single-source-of-truth redesign tracked across the QA-end-commit BACKLOG entry and the managed-doc sync rewrite. This fix correctly implements canon's *stated* worktree-canonical discipline; it doesn't unify the source-of-truth model, but it removes the current accidental REPO_ROOT-read in worktree-context code paths and unblocks the structural redesign by making the parser layer cwd-aware.

## Decision

Add an **optional `cwd: string` parameter (default `REPO_ROOT`)** to each of the four parsers. Inside the parsers, replace `path.join(taskDirFor(taskId), 'spec.md')` (or `'handoff.md'`) with `path.join(cwd, 'tasks', taskId, 'spec.md')` (or `'handoff.md'`). When `cwd === REPO_ROOT` (the default), this produces the exact same path as today's `taskDirFor(taskId)`-based resolution. When `cwd` is a worktree path, the parser reads from the worktree's task dir.

Update the worktree-context call sites to pass `cwd`:

- **`commitHumanReviewFiles`** ([main.ts:887](../../scripts/run-task/main.ts:887)) — already takes `cwd: string` as its second parameter. Pass it to `parseAffectedFilesFromSpec` at the call site around [main.ts:914](../../scripts/run-task/main.ts:914), and to `verifyHandoffAgainstDiff` if invoked from this function.
- **`verifyBaseDrift`** ([validation.ts:938](../../scripts/run-task/validation.ts:938)) — already takes `cwd: string` as its third parameter. Pass it to `parseAffectedFilesFromSpec` inside the function body.
- **`verifyHandoffAgainstDiff`** ([validation.ts:918](../../scripts/run-task/validation.ts:918)) — takes `baseRef: string` but operates implicitly in the current working directory. The function needs a new `cwd: string` parameter, threaded to `parseHandoffFiles`. All worktree-context callers pass their `cwd`.
- **`runCodeReviewPhase` preflight** ([code-review.ts:44-47](../../scripts/run-task/phases/code-review.ts:44)) — `activeCwd` is already computed at line 24 via `getActiveCwd(taskIds)` and used for `runClaude` / scoped-diff. Pass it to `validateHandoff(t.taskId, activeCwd)` and `verifyHandoffAgainstDiff(taskIds, baseBranch, activeCwd)`. No new helper or scope change needed.
- **`autoCommitCode`** ([main.ts:346](../../scripts/run-task/main.ts:346)) — already takes `cwd` and uses it for porcelain reads. Pass it to `parseHandoffChangesRows(taskId, cwd)` inside the per-task loop at line 358. No signature change.
- **`tryEvidenceAdvance`** ([main.ts:1988](../../scripts/run-task/main.ts:1988)) — gains a new `cwd: string` parameter (required, threaded from above; default would mask the bug).
  - `case 'implement'` uses `cwd` for the `parseHandoffChangesRows(taskId, cwd)` call and for the spec.md / handoff.md paths passed to `validateHandoffAgainstSpec`: `path.join(cwd, 'tasks', taskId, 'spec.md')` and `path.join(cwd, 'tasks', taskId, 'handoff.md')`.
  - `case 'code_review'` uses `cwd` for the `readArtifact` call that reads `review.md`. To keep `readArtifact` simple and avoid threading cwd through every caller (the other readArtifact calls — `spec.md`, `plan.md`, `spec-review.md` — all run in REPO_ROOT today), give `readArtifact` an optional trailing parameter: `function readArtifact(taskId: string, name: string, cwd = REPO_ROOT): string | null` with body `path.join(cwd, 'tasks', taskId, name)`. The `code_review` branch passes `cwd`; the other branches keep their existing call shape and resolve to REPO_ROOT via the default.
  - Other phase branches (`spec_review`, `spec`, `plan`, `qa`) don't read worktree-anchored files, so they ignore the new parameter — that's fine. **`recoverPhaseForTask`** ([main.ts:2172](../../scripts/run-task/main.ts:2172)) takes a `cwd` parameter and forwards to `tryEvidenceAdvance` (calls at lines 2173 and 2189). **`checkAndRoute`** ([main.ts:2200](../../scripts/run-task/main.ts:2200)) computes the cwd once at the top of the function using `isWorktreePhase ? splitWorktree.getActiveCwd(taskIds) : REPO_ROOT` where `isWorktreePhase = phase === 'implement' || phase === 'code_review' || phase === 'qa'`. This intentionally adds `'qa'` to the rule from `retryAgentForPhase` at line 2131-2132 — see AC-7f for the reasoning (qa.ts writes done.md into the worktree). The computed cwd flows to `recoverPhaseForTask`. The implement-phase `case` keeps its existing `autoCommitCode(taskIds, splitWorktree.getActiveCwd(taskIds))` call (or simplify to pass the local `cwd` — equivalent).

REPO_ROOT-context callers stay unchanged. Specifically:

- **`canon task phase` / `list` / `status` / `accept`** in [src/task/index.ts](../../src/task/index.ts) — call no parsers directly (they update status.json or print state). No changes.
- **`checkPhaseGate`** in [state.ts](../../scripts/run-task/state.ts) — calls `validateHandoff(taskId)`. Default-param keeps it working. No changes.
- **`buildContextBlock`** in [scripts/run-task/context.ts](../../scripts/run-task/context.ts) — REPO_ROOT-anchored context build. Reads spec via its own logic, not via the four parsers. No changes.
- **All tests** in [tests/run-task-validation.test.ts](../../tests/run-task-validation.test.ts) — call parsers via the public API. Default-param keeps existing tests passing. New tests added (see ACs) to exercise the cwd parameter.

The change is **purely additive plumbing**:
- No gate behavior changes (no new die paths, no behavior-state-machine interactions)
- No parser return shape changes
- No new helpers introduced (`getActiveCwd` / `resolveTaskCwd` already exist and aren't relevant to this fix — the existing worktree-context callers already have `cwd` in scope)
- No `taskDirFor` modifications — stays as-is for REPO_ROOT-anchored callers

## Non-Goals

- **Migrating REPO_ROOT-context callers to pass explicit cwd.** They work correctly via the default. Forcing them to pass `REPO_ROOT` explicitly is churn without benefit.
- **Introducing a new `taskDirForCwd(taskId, cwd)` helper in `scripts/run-task/state.ts`.** Three call sites is below the threshold for a helper; inline `path.join(cwd, 'tasks', taskId, '<file>')` is clearer.
- **Refactoring `taskDirFor`** ([state.ts:34](../../scripts/run-task/state.ts:34)) **itself.** Stays REPO_ROOT-anchored for its existing callers. The fix introduces the new cwd plumbing alongside, not replacing.
- **Auditing beyond the named parsers, helpers, and call sites.** The spec_review audit (2026-05-23, three rounds) confirmed the complete set: four parsers (`parseAffectedFilesFromSpec`, `parseHandoffChangesRows`, `parseHandoffFiles`, `validateHandoff`); two helpers (`verifyHandoffAgainstDiff`, `readArtifact`); worktree-context call sites (`commitHumanReviewFiles`, `verifyBaseDrift`, `runCodeReviewPhase` preflight, `autoCommitCode`, and three `tryEvidenceAdvance` branches: implement, code_review, qa). If a new call site surfaces later, file separately.
- **Fixing `retryAgentForPhase`'s `isWorktreePhase` rule.** That function at line 2131-2132 omits `'qa'` from the worktree-phase set. It's a latent bug, but inert because qa retries return `'no_session'` before the cwd matters (no stored session slot for qa). Out of scope here; can be cleaned up in a follow-up.
- **Source-of-truth model redesign.** This fix implements the existing worktree-canonical discipline correctly. The structural single-source-of-truth design (worktree-canonical for ALL task state, with commit-per-phase) is tracked separately via the QA-end-commit and sync-rewrite BACKLOG entries.
- **Changing parser behavior.** No new gates, no new die paths, no return shape changes, no malformed-row handling changes. Pure path-source change.
- **Removing the `cp to REPO_ROOT` operator workaround documentation.** Until this fix ships, the workaround remains the recovery path; don't preempt the workaround removal in docs.

## Acceptance Criteria

- [ ] AC-1: `parseAffectedFilesFromSpec(taskId: string, cwd?: string)` at [validation.ts:650](../../scripts/run-task/validation.ts:650) accepts an optional `cwd` parameter. Default value: `REPO_ROOT` (imported from `./env.js`, the same source `taskDirFor` uses). Body resolves the spec path as `path.join(cwd, 'tasks', taskId, 'spec.md')`. Verify by reading the source: the signature includes the new parameter; the path-resolution line uses `cwd`; the import of REPO_ROOT is present.

- [ ] AC-2: `parseHandoffChangesRows(taskId: string, cwd?: string)` at [validation.ts:618](../../scripts/run-task/validation.ts:618) accepts an optional `cwd` parameter with the same shape as AC-1 (default `REPO_ROOT`, body resolves handoff path as `path.join(cwd, 'tasks', taskId, 'handoff.md')`). Verify by reading the source.

- [ ] AC-3: `parseHandoffFiles(taskId: string, cwd?: string)` at [validation.ts:593](../../scripts/run-task/validation.ts:593) accepts an optional `cwd` parameter and forwards it to `parseHandoffChangesRows`. The wrapper's body forwards: `return parseHandoffChangesRows(taskId, cwd).files;` (or equivalent — the existing body shape stays, just with cwd added to the inner call). Verify by reading the source.

- [ ] AC-4: `validateHandoff(taskId: string, cwd?: string)` at [validation.ts:71](../../scripts/run-task/validation.ts:71) accepts an optional `cwd` parameter. The function reads spec.md and handoff.md directly (not through the other parsers) AND calls `parseHandoffChangesRows`. Both direct file reads and the inner parser call use the `cwd` parameter. Verify by reading the source: direct reads use `path.join(cwd, 'tasks', taskId, '<file>')`; the `parseHandoffChangesRows(taskId, cwd)` call passes cwd.

- [ ] AC-5: `verifyHandoffAgainstDiff(taskIds: string[], baseRef: string, cwd: string)` at [validation.ts:918](../../scripts/run-task/validation.ts:918) gains a new **required** `cwd: string` parameter as the third arg (after `baseRef`). The body passes `cwd` to `parseHandoffFiles(taskId, cwd)` for each taskId. Cwd is required (not optional) because this function is only invoked in worktree-context paths today and a default would mask the wrong-cwd bug we're fixing. Verify by reading the source: signature includes `cwd: string` (no `?`); call to `parseHandoffFiles` passes `cwd`.

- [ ] AC-6: `commitHumanReviewFiles` at [main.ts:887](../../scripts/run-task/main.ts:887) passes its `cwd` parameter to `parseAffectedFilesFromSpec(taskId, cwd)` at the call site around line 914 (the loop that builds the resolved Affected Files set). Same `cwd` is passed to `verifyHandoffAgainstDiff(taskIds, baseRef, cwd)` if that function is invoked from `commitHumanReviewFiles` (search for the call site; pass `cwd` per AC-5). Verify by reading the source.

- [ ] AC-7: `verifyBaseDrift(taskIds: string[], baseBranch: string, cwd: string)` at [validation.ts:938](../../scripts/run-task/validation.ts:938) passes its `cwd` parameter to `parseAffectedFilesFromSpec(taskId, cwd)` at the call site inside the function. Verify by reading the source: the existing call to `parseAffectedFilesFromSpec` is updated to pass cwd.

- [ ] AC-7b: `runCodeReviewPhase` in [scripts/run-task/phases/code-review.ts](../../scripts/run-task/phases/code-review.ts) passes the existing `activeCwd` (computed at line 24 via `getActiveCwd(taskIds)`) into the preflight parser calls: `validateHandoff(t.taskId, activeCwd)` at line 44, and `verifyHandoffAgainstDiff(taskIds, baseBranch, activeCwd)` at line 47. No signature change on the phase function itself; no new variable or helper. Verify by reading the source: both call sites pass `activeCwd` as the trailing argument.

- [ ] AC-7c: `autoCommitCode(taskIds: string[], cwd = REPO_ROOT)` at [main.ts:346](../../scripts/run-task/main.ts:346) passes its `cwd` parameter to `parseHandoffChangesRows(taskId, cwd)` inside the per-task loop at line 358. The function signature is unchanged (cwd already present with REPO_ROOT default). Verify by reading the source: the inner `parseHandoffChangesRows` call passes `cwd`.

- [ ] AC-7d: `tryEvidenceAdvance(taskId: string, phase: Phase, cwd: string)` at [main.ts:1988](../../scripts/run-task/main.ts:1988) gains a new **required** `cwd: string` parameter (no default — see Known Risks; default would mask the bug).
  - `case 'implement'` uses `cwd` for: (a) the `parseHandoffChangesRows(taskId, cwd)` call at line 2002; (b) both arguments to `validateHandoffAgainstSpec` — `path.join(cwd, 'tasks', taskId, 'spec.md')` and `path.join(cwd, 'tasks', taskId, 'handoff.md')`.
  - `case 'code_review'` uses `cwd` by passing it as the third argument to `readArtifact(taskId, 'review.md', cwd)` at line 2052 (relies on AC-7d-extension below).
  - `case 'qa'` uses `cwd` to resolve the done.md path: replace `const donePath = path.join(splitState.taskDirFor(taskId), 'done.md');` at line 2083 with `const donePath = path.join(cwd, 'tasks', taskId, 'done.md');`. (This branch doesn't go through `readArtifact`, so AC-7d-extension doesn't cover it — the path is rebuilt inline.)
  - Other case branches (`spec_review`, `spec`, `plan`) don't pass `cwd` — `readArtifact` defaults them to REPO_ROOT.
  Verify by reading the source.

- [ ] AC-7d-extension: `readArtifact` at [main.ts:1983](../../scripts/run-task/main.ts:1983) gains an optional trailing parameter: `function readArtifact(taskId: string, name: string, cwd = REPO_ROOT): string | null`. The body resolves the file path as `path.join(cwd, 'tasks', taskId, name)` instead of `path.join(taskDirFor(taskId), name)`. When `cwd === REPO_ROOT` (the default), this produces the same path as today. Verify by reading the source: signature includes the optional `cwd` parameter; body uses `cwd` in the path join.

- [ ] AC-7e: `recoverPhaseForTask(taskId: string, phase: Phase, initialStatus: PhaseStatus, cwd: string)` at [main.ts:2172](../../scripts/run-task/main.ts:2172) gains a new **required** `cwd: string` parameter as the trailing arg. The two `tryEvidenceAdvance` call sites (lines 2173 and 2189) pass `cwd`. Verify by reading the source.

- [ ] AC-7f: `checkAndRoute(phase: Phase, taskIds: string[])` at [main.ts:2200](../../scripts/run-task/main.ts:2200) — signature unchanged. Inside the function, before the recovery loop, compute `const cwd = (phase === 'implement' || phase === 'code_review' || phase === 'qa') ? splitWorktree.getActiveCwd(taskIds) : REPO_ROOT;`. Note: this isWorktreePhase rule **intentionally diverges** from `retryAgentForPhase`'s rule at line 2131-2132, which omits `'qa'`. That existing omission is a latent bug for `tryEvidenceAdvance` purposes (qa.ts writes done.md into the worktree), but it doesn't affect `retryAgentForPhase` itself because qa retries return `'no_session'` early (no stored slot for the qa phase, per the comment at line 2102). Fixing `retryAgentForPhase`'s rule is out of scope; this AC adds the correct rule only at the `checkAndRoute` site that feeds `recoverPhaseForTask` → `tryEvidenceAdvance`. Pass this `cwd` to `recoverPhaseForTask(taskIds[i], phase, phaseStatus, cwd)` at line 2211. The existing `autoCommitCode(taskIds, splitWorktree.getActiveCwd(taskIds))` call at line 2267 may be simplified to `autoCommitCode(taskIds, cwd)` — equivalent and reduces duplicate computation. Verify by reading the source.

- [ ] AC-8: REPO_ROOT-context callers are unchanged. Specifically: (a) `checkPhaseGate` in [scripts/run-task/state.ts](../../scripts/run-task/state.ts) calls `validateHandoff(taskId)` with no cwd argument; verify the call site is untouched and the default-param resolution produces the REPO_ROOT path (test below). (b) `canon task` CLI commands in [src/task/index.ts](../../src/task/index.ts) make no parser calls; verify the file diff includes no changes. Verify by reading the source diff.

- [ ] AC-9: `tests/run-task-validation.test.ts` adds the following cases for each of the four parsers (`parseAffectedFilesFromSpec`, `parseHandoffChangesRows`, `parseHandoffFiles`, `validateHandoff`):
  - **(a) Default cwd → REPO_ROOT behavior preserved**: existing tests pass without modification (no cwd argument) and read from REPO_ROOT's task dir. Verify by running `npm test` after the fix and confirming the existing assertions still pass.
  - **(b) Explicit cwd reads from the passed directory**: new test creates a temp fixture dir via `fs.mkdtempSync`, populates `<tmpdir>/tasks/<id>/spec.md` (or `handoff.md`) with known content, calls the parser with `cwd: <tmpdir>`, asserts the parser returned content from the tmpdir version. Use non-gitignored fixture filenames per `docs/patterns.md` "Test-writing pitfalls."
  - **(c) Cwd-overrides-REPO_ROOT divergence**: new test populates REPO_ROOT-side `tasks/<id>/spec.md` with one content AND a tmpdir's `tasks/<id>/spec.md` with different content, calls parser with `cwd: <tmpdir>`, asserts the tmpdir content is returned (not REPO_ROOT's). This is the regression test for the actual bug.
  Verify by reading the new test names in the test output after running `npm test`.

- [ ] AC-10: `tests/run-task-safety.test.ts` adds an integration test for the `commitHumanReviewFiles` → `parseAffectedFilesFromSpec` chain. The test creates a temp repo with a worktree, populates the worktree's `tasks/<id>/spec.md` with a managed-doc entry in Affected Files, makes that managed doc dirty in the worktree, AND ensures REPO_ROOT's `tasks/<id>/spec.md` does NOT contain the entry. Calls `commitHumanReviewFiles` with the worktree as cwd. Asserts the function does NOT die (because the parser correctly reads the worktree's spec and sees the managed doc allowed). Follow the existing fixture pattern at [tests/run-task-safety.test.ts:1428](../../tests/run-task-safety.test.ts:1428).

- [ ] AC-10b: `tests/run-task-validation.test.ts` (or a sibling test file co-located with the affected helpers) adds a regression test for `verifyHandoffAgainstDiff` under worktree divergence: populate REPO_ROOT-side `tasks/<id>/handoff.md` with one Changes table and a tmpdir worktree-side `tasks/<id>/handoff.md` with a different Changes table whose files match a synthetic diff. Call `verifyHandoffAgainstDiff([id], baseRef, tmpdir)` and assert the returned issues array reflects the tmpdir handoff (not REPO_ROOT's). This is the regression test for the bundle-preflight path called from `runCodeReviewPhase`.

- [ ] AC-11: The full test suite passes — `npm test` reports zero failures. Lint and type-check pass.

- [ ] AC-12: `dist/cli/index.js` and `dist/scripts/run-task.js` are regenerated by `npm run build` after the source changes. Committed `dist/` must match a fresh build per the canon-ai CI gate. Verify by running `npm run build && git diff --exit-code -- dist/` post-commit (expected: no diff).

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

| File | Change |
|---|---|
| `scripts/run-task/validation.ts` | (1) `parseAffectedFilesFromSpec(taskId, cwd?)` at line 650 — add optional `cwd: string = REPO_ROOT` parameter; resolve spec path as `path.join(cwd, 'tasks', taskId, 'spec.md')`. (2) `parseHandoffChangesRows(taskId, cwd?)` at line 618 — same shape, resolve handoff path as `path.join(cwd, 'tasks', taskId, 'handoff.md')`. (3) `parseHandoffFiles(taskId, cwd?)` at line 593 — same shape, forward `cwd` to `parseHandoffChangesRows`. (4) `validateHandoff(taskId, cwd?)` at line 71 — same shape; direct spec.md and handoff.md reads use `path.join(cwd, 'tasks', taskId, '<file>')`; the internal `parseHandoffChangesRows` call passes `cwd`. (5) `verifyHandoffAgainstDiff(taskIds, baseRef, cwd)` at line 918 — add required `cwd: string` parameter (NOT optional — see AC-5); the body passes `cwd` to `parseHandoffFiles`. (6) `verifyBaseDrift` at line 938 — the existing call to `parseAffectedFilesFromSpec` inside the function body passes the `cwd` it already has in scope. Import: add `REPO_ROOT` to the imports from `./env.js` if not already imported. |
| `scripts/run-task/main.ts` | (1) **`commitHumanReviewFiles`** at line 887 — its `cwd` parameter is already in scope. At the call to `parseAffectedFilesFromSpec` around line 914, pass `cwd` as the second argument. If `verifyHandoffAgainstDiff` is invoked from this function (grep to confirm), pass `cwd` as the third argument per AC-5. (2) **`autoCommitCode`** at line 346 — already takes `cwd`. At the `parseHandoffChangesRows(taskId)` call inside the per-task loop at line 358, pass `cwd` as the second argument. Signature unchanged. (3) **`tryEvidenceAdvance`** at line 1988 — add required `cwd: string` parameter. In `case 'implement'`: pass `cwd` to `parseHandoffChangesRows` at line 2002; rebuild the spec.md and handoff.md paths at lines 2012-2013 as `path.join(cwd, 'tasks', taskId, '<file>')` instead of `path.join(taskDirFor(taskId), '<file>')`. In `case 'code_review'`: pass `cwd` as the third arg to `readArtifact(taskId, 'review.md', cwd)` at line 2052. In `case 'qa'`: replace `const donePath = path.join(splitState.taskDirFor(taskId), 'done.md');` at line 2083 with `const donePath = path.join(cwd, 'tasks', taskId, 'done.md');`. Other phase branches keep their existing two-arg `readArtifact` shape. (3a) **`readArtifact`** at line 1983 — add optional `cwd = REPO_ROOT` parameter; body uses `path.join(cwd, 'tasks', taskId, name)`. (4) **`recoverPhaseForTask`** at line 2172 — add required `cwd: string` parameter; forward to both `tryEvidenceAdvance` calls (lines 2173 and 2189). (5) **`checkAndRoute`** at line 2200 — compute `cwd` once near the top using `isWorktreePhase ? splitWorktree.getActiveCwd(taskIds) : REPO_ROOT` where `isWorktreePhase = phase === 'implement' || phase === 'code_review' || phase === 'qa'` (intentionally diverges from `retryAgentForPhase`'s rule at line 2131-2132 by adding `'qa'`; see AC-7f). Pass it to `recoverPhaseForTask` at line 2211; optionally use the local `cwd` at line 2267's `autoCommitCode` call. No external-API signature change beyond the helpers listed. |
| `scripts/run-task/phases/code-review.ts` | `runCodeReviewPhase` preflight at lines 44 and 47 — pass the already-in-scope `activeCwd` to `validateHandoff(t.taskId, activeCwd)` and `verifyHandoffAgainstDiff(taskIds, baseBranch, activeCwd)`. No other changes to the function. |
| `tests/run-task-validation.test.ts` | (1) Add three test cases per parser (12 cases total) covering: default-cwd-REPO_ROOT, explicit-cwd-temp-dir, cwd-overrides-REPO_ROOT-divergence. Use `fs.mkdtempSync` for the explicit-cwd cases. Non-gitignored fixture filenames per the test-writing pitfalls. Place adjacent to the existing parser tests. (2) Add the AC-10b regression test for `verifyHandoffAgainstDiff` under worktree divergence (tmpdir handoff differs from REPO_ROOT-side handoff; assertions reflect tmpdir). |
| `tests/run-task-safety.test.ts` | Add one integration test per AC-10: temp repo + worktree fixture, worktree's spec lists a managed doc that REPO_ROOT's spec doesn't, worktree has the managed doc dirty, `commitHumanReviewFiles(taskIds, worktreeCwd, false)` succeeds without dying. Follow the existing fixture pattern at line 1428. |
| `dist/cli/index.js` | Regenerated by `npm run build` from `src/cli/index.ts` (transitively bundles `scripts/run-task/validation.ts`, `scripts/run-task/main.ts`). Required for CI's `git diff --exit-code -- dist/` gate per [docs/architecture.md](../../docs/architecture.md) Full build binding. |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` from `scripts/run-task.ts` (transitively bundles the same files). Same CI gate. |

### Interaction Dependencies

- **`taskDirFor`** at [state.ts:34](../../scripts/run-task/state.ts:34) — unchanged. Stays REPO_ROOT-anchored for its existing CLI callers in `src/task/index.ts`. The fix adds new path-resolution logic in the parsers without replacing or refactoring this helper.
- **`REPO_ROOT`** constant in [env.ts](../../scripts/run-task/env.ts) — already exported. The parsers import it as the default for the new `cwd` parameter. No changes.
- **`getActiveCwd`** at [worktree.ts](../../scripts/run-task/worktree.ts) and **`resolveTaskCwd`** at [state.ts:39](../../scripts/run-task/state.ts:39) — unchanged. The three worktree-context callers already have `cwd` in scope from these helpers (or from their function signatures); no new helper resolution needed.
- **`commitHumanReviewFiles`** at [main.ts:887](../../scripts/run-task/main.ts:887) — its `cwd` parameter is already used for git operations (`mirrorHumanReviewDocsToCwd(cwd)`, porcelain status reads, etc.). The fix extends that same `cwd` to the parser calls inside the function. No structural change to the function.
- **`verifyBaseDrift`** at [validation.ts:938](../../scripts/run-task/validation.ts:938) — its `cwd` parameter is already used for git fetch and diff. The fix extends it to the `parseAffectedFilesFromSpec` call inside. No structural change.
- **Test fixtures** — existing fixtures in `run-task-validation.test.ts` use `fs.mkdtempSync` for isolated parser tests. The new cwd-parameter tests follow the same pattern; no new fixture infrastructure needed.

### Data Model Changes

None. No `status.json` schema changes. No new flags. No template structural changes. No new fields on any function's return shape.

## Validation Required

- [ ] `lint` (`npm run lint`)
- [ ] `type-check` (`npm run type-check`)
- [ ] `unit tests` (`npm test`) — full suite passes
- [ ] `build` (`npm run build`) — rebuilds dist; required per the architecture.md Full build binding because the change touches `scripts/run-task/validation.ts` and `scripts/run-task/main.ts`, both bundled into `dist/`. Committed `dist/` must match a fresh build (CI gates on `git diff --exit-code -- dist/`).
- [ ] `E2E` — N/A; no UI

## Docs Impact

- **`docs/patterns.md`** — already has the worktree-git-fragility pitfall (added inline 2026-05-23 as part of the QA-end-commit groundwork). After this fix ships, the `cp to REPO_ROOT` workaround can be REMOVED from operator-facing docs because the parser now correctly reads the worktree. QA-phase Claude should audit any docs that mention the cp workaround.
- **`docs/codebase-map.md`** — the `## Pipeline Orchestration` table's parser row already references `validation.ts` generically. No specific row update needed; QA-phase Claude confirms.
- **`docs/decisions.md`** — no settled decision conflicts. The worktree-canonical-during-pipeline discipline is implicit in canon's design but isn't an explicit decision entry. Consider adding one if the QA-phase audit finds it useful (lower priority).
- **`docs/lessons-learned.md`** — QA distills any insights surfaced during this task. Candidate lesson: "When a parser takes only `taskId` and reads a task file via `taskDirFor`, it is REPO_ROOT-anchored — for worktree-mode operations, the caller must pass an explicit cwd." Already partially captured in the worktree-git-fragility pitfall; QA decides whether to add a sibling lesson.
- **`docs/pipeline-orchestrator.md`** — no relevant section to update; the fix is internal plumbing not adopter-visible behavior.

## Known Risks

- **Required cwd on `verifyHandoffAgainstDiff` is a breaking API change for any external caller.** The function is exported. Within canon-ai-dev the callers are `commitHumanReviewFiles` and `runCodeReviewPhase` preflight (per the audit) — both now pass cwd. Adopters who haven't touched this function won't be affected — they only invoke canon via the CLI, not the exported API. Still, this is one of three signatures in the fix that break backward-compat (the others are `tryEvidenceAdvance` and `recoverPhaseForTask`, both internal — not exported, no external caller). Mitigation: keep cwd required on these three despite the break, because making it optional with a REPO_ROOT default would mask the wrong-cwd bug we're fixing. Document in the changelog as an internal-API change.
- **Default-param drift across the four parsers**. The default value `cwd = REPO_ROOT` must be consistent across all four. If a future PR makes one parser default to something else (e.g., `process.cwd()`) by mistake, the default-param contract is broken and worktree-mode callers might get inconsistent behavior. Mitigation: AC-1 through AC-4 explicitly assert the default; tests cover the default-param case for each parser.
- **Test fixture isolation**. The cwd-overrides-REPO_ROOT test (AC-9c) populates BOTH REPO_ROOT-side AND a tmpdir-side `tasks/<id>/spec.md` with different content. The REPO_ROOT-side population is via test fixture, not the real REPO_ROOT — the test must not write into canon-ai-dev's actual `tasks/` directory. Use the existing `CANON_TASKS_DIR_OVERRIDE` env var pattern from [state.ts:34](../../scripts/run-task/state.ts:34) to redirect REPO_ROOT-side reads to a fixture path.
- **Build-time impact**. The dist regeneration includes the parser changes. The `dist/` files are bundled JS — verify visually that the regenerated bundle includes the new `cwd` parameter handling. CI's `git diff --exit-code -- dist/` gate catches if `dist/` is stale; no separate concern.
- **Interaction with the QA-end-commit BACKLOG entry**. If/when the structural fix ships (committing task artifacts at QA-end), the worktree and REPO_ROOT diverge less because the worktree's state is durable. Parser-cwd remains correct under that model — it just becomes less load-bearing. No conflict.
- **Delicate surface**. `commitHumanReviewFiles` is on canon-ai's listed delicate surface ("Auto-commit logic" in [docs/product-context.md](../../docs/product-context.md)). Full-tier review chain with upgraded model is appropriate. The change is additive plumbing — no die paths added or removed, no gate behavior changes.

## Human Test Plan

> Reproduces the bug surfaced during prepr-base-drift-check's `--pr` cycle.

1. Pick any task at `human_review` on `release/v1.4` (or create one to dogfood). Note the spec's current `### Affected Files` list.
2. In the worktree (`dev-worktrees/<task-id>`), edit `tasks/<task-id>/spec.md` to add a managed doc to `### Affected Files` (e.g., add `docs/codebase-map.md` if it isn't listed). Do NOT mirror the edit to REPO_ROOT.
3. Make the managed doc dirty in the worktree — `echo "" >> docs/codebase-map.md && cd /Users/tstraub/canon-ai/dev-worktrees/<task-id> && git status` shows it as M.
4. Run `canon run <task-id> --push` from REPO_ROOT.
5. **Expected (post-fix)**: v2's gate reads the worktree's spec.md (which has the managed doc listed), allows the commit, branch pushes. Operator sees the AC-7 advisory warning naming `docs/codebase-map.md` per the v2 spec, then the push succeeds.
6. **Expected (pre-fix, what we hit yesterday)**: v2's gate reads REPO_ROOT's spec.md (which does NOT have the managed doc), dies with `"docs/codebase-map.md ... outside the human_review allowlist."` The operator's worktree edit is invisible to the gate.
7. Revert the test changes: `git checkout HEAD -- docs/codebase-map.md` in the worktree, revert the spec edit if you don't want it in the PR.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry checked (or "None" with justification)
