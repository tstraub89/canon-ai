# Implementation Plan: affected-files-fail-closed

> Written by: Claude | Implements: `tasks/affected-files-fail-closed/spec.md`

## Approach

Change `getAffectedFiles` to return a discriminated union. Every caller then has to narrow on `ok`, and each of the four callers gets the disposition the spec gives it. The "which full-send bundles are scope-checked" rule moves into one exported predicate in `code-review.ts`. Both `findUnjudgedFullSendFilesFromData` (success path) and the new B failure path call that predicate, so the exemption set has one source. Spec review was `approved` with no nits.

**Feasibility check**

- **Exists:** All of these were found by grep:
  - `src/orchestrator/git.ts`: `getAffectedFiles` (git.ts:449), `getPathsInRange` (:453), `gitSafeAtRaw` (:49), `parseNameStatusOutput` (:433), and the sibling shape `getTreeDriftFiles` (:488).
  - `src/orchestrator/phases/code-review.ts`: `findUnjudgedFullSendFilesFromData` (:28), `fullSendScopeBlockReason` (:42), `CodeReviewPhaseDeps.getAffectedFiles` (:57), the pre-flight read (:295).
  - `src/orchestrator/main.ts`: caller A (:1226), caller B (:3252), and the SPEC GAP `scopeNote` (:3357).
  - `src/orchestrator/phases/implement.ts`: caller D (:74).
  - `src/orchestrator/prompts/index.ts`: `buildAffectedFilesBlock` (:48).
  - Test fixtures: `runCheckAndRouteInFixture`, `makeDeps`, and `initReviewRepo` (`tests/run-task-code-review.test.ts`); `setupFakeGit` and `runHumanReviewCommit` (`tests/run-task-safety.test.ts`); `withTempDir` and the `parseNameStatusOutput` tests (`tests/run-task-validation.test.ts`).
- **Real path:**
  - C: `runCodeReviewPhase` calls `deps.getAffectedFiles` first, then `deps.verifyHandoffAgainstDiff`, then `classifyPreflightBlockers` / `determinePreflightRoute`. The new block goes between the loop-cap check and `verifyHandoffAgainstDiff`.
  - B: `checkAndRoute` runs the full-send block (main.ts:3248–3271), then the `switch (phase)` → `case 'code_review'` (SPEC GAP halt → reroute).
  - A: `commitHumanReviewFiles` runs `verifyBaseDrift` (tree diff via `getTreeDriftFiles`) and then, only when there is drift, `getAffectedFiles(origin/<base>)` for classification.
  - D: `runImplementPhase` passes the list to `promptImplement` / `promptImplementRevisions` / `promptImplementReroute`.
- **Callers:** `getAffectedFiles` has exactly 4 production callers (A, B, C, D) and none in `templates/`. `CodeReviewPhaseDeps.getAffectedFiles` is stubbed only in `tests/run-task-code-review.test.ts`: `makeDeps` plus 6 `deps.getAffectedFiles = ` overrides. All change to the `{ ok: true, files }` shape. The prompt builders keep their existing parameter shape and only widen it with `null` (Step 5), so the 13 calls in `tests/run-task-prompts.test.ts` and the one in `tests/run-task-reroute-preflight.test.ts` compile unchanged.
- **Tests that can fail:**
  - AC-1: a nonexistent base ref makes git exit 128. Pre-fix, the function returns `[]`, and `.ok` is undefined.
  - AC-2: `status.base_branch = 'no-such-base'` on every member, with a real repo. Pre-fix, B gets `[]` → `unjudged` is empty → exit 0, not blocked.
  - AC-3: the stub returns `ok: false` and `verifyHandoffAgainstDiff` returns `['git diff failed: …']`. Pre-fix, that issue is classified as `format`, so the run is pre-flight-rejected.
  - AC-4: a new fake-git switch fails only `diff origin/main...HEAD`. Pre-fix, `[]` puts every drift file in "base advanced", so the message contains "git rebase".
  - AC-5: `null` input. Pre-fix, the builder has no `null` branch.
- **Predicates:**
  - `ok: true` with `files: []` is a successful empty diff. It must keep today's behavior: B/C proceed, and D renders "No prior commits".
  - `ok: false` with empty `stderr` (spawn error, or git printing nothing) renders as `unknown error`, matching the sibling `diffError ?? 'unknown error'`.
  - B on failure (verdict combinations):
    - any `spec_gap` → note only;
    - otherwise any `changes_requested` / `needs_re_review` → fall through to the reroute;
    - otherwise (all approved / approved_with_nits / `null`) → block.
    - The exempt predicate already returns true for all three verdict kinds in the first two bullets, so "block iff not exempt" plus "note iff includes spec_gap" gives exactly the spec's precedence.
- **Scope:** Every file below is in the spec's Affected Files. Step 6 adds a `--force` case to `tests/run-task-safety.test.ts`, which is already listed. Nothing outside the list is touched.
- **Async/stateful:** No new async. Each block uses the existing `autoBlockPhase` + `process.exit(2)` pattern, which increments `auto_block_count` the same way the sibling scope blocks do. N/A otherwise.

**Spec contradiction found (recorded in notes.md):** at caller A, `getAffectedFiles` runs only inside `if (!cliArgs.force)`. With the spec's message ("This failure cannot be bypassed with --force.") and the code left as it is, the message would be false: `--force` skips the computation and proceeds. **Plan decision:** compute the task-changed set before the `--force` branch, so that a three-dot failure dies even under `--force`. That makes the mandated message true, matches the tree-diff sibling (which dies before the force check), and follows the Non-Goal "No `--force` bypass". The change stays inside `main.ts`. Step 6 pins it with a test.

## Steps

### Step 1: New result contract for `getAffectedFiles`

Files: `src/orchestrator/git.ts`

Replace git.ts:449–451 with:

```ts
export type AffectedFilesResult = { ok: true; files: string[] } | { ok: false; stderr: string };

export function getAffectedFiles(baseRef: string, cwd: string): AffectedFilesResult {
    // Fail closed: callers must distinguish "branch changed nothing" from "diff unreadable".
    const result = gitSafeAtRaw(cwd, 'diff', `${baseRef}...HEAD`, '--name-status', '-M', '-z');
    if (!result.ok) return { ok: false, stderr: result.stderr };
    return { ok: true, files: parseNameStatusOutput(result.stdout) };
}
```

Keep the git argv **byte-identical** to `getPathsInRange`'s. The fake-git fixtures match on argv: `$2` is the range, so a different argument order would silently fall through to other branches. `parseNameStatusOutput('')` already returns `[]`, so no `!stdout` special case is needed. Leave `getPathsInRange` unchanged. After this step, `grep -rn "getPathsInRange(.*) ?? \[\]" src/` must return nothing.

### Step 2: Shared full-send exemption predicate and failure reasons

Files: `src/orchestrator/phases/code-review.ts`

1. Extract the verdict check from `findUnjudgedFullSendFilesFromData` into an exported predicate, and have the helper call it. The helper's signature and behavior stay unchanged.

   ```ts
   /** Bundles that never advance to QA from this verdict set; scope is re-checked on the next review. */
   export function isFullSendScopeCheckExempt(verdicts: readonly (string | null)[]): boolean {
       return verdicts.some(verdict =>
           verdict === 'changes_requested' || verdict === 'needs_re_review' || verdict === 'spec_gap');
   }
   ```

   Keep the existing comment block above the condition: move it onto the predicate. `findUnjudgedFullSendFilesFromData` becomes `if (isFullSendScopeCheckExempt(verdicts)) return [];` followed by the existing `verifyBaseDriftFromData` return.

2. Add one shared builder for the "scope could not be verified" text, next to `fullSendScopeBlockReason`. Both C and B use it.

   ```ts
   export function scopeUnverifiedReason(
       context: string, taskIds: readonly string[], baseBranch: string, stderr: string, verdictNote = '',
   ): string {
       return `${context} could not verify scope for ${taskIds.join(', ')}: ` +
           `the committed diff against base branch '${baseBranch}' could not be read.\n` +
           `Git error: ${stderr || 'unknown error'}\n` +
           `Check that the base_branch recorded in each task's status.json exists in the active checkout.` +
           `${verdictNote}\n` +
           `Then re-run \`canon run ${taskIds.join(' ')}\`.`;
   }
   ```

   The text must end with the re-run command, per the spec. Do not name canon-ai source paths. `status.json` is a task artifact that adopters have, so mentioning it is allowed under AGENTS.md §Adopter Scope.

3. **Caller C:** fail closed before handoff classification. Replace code-review.ts:295 (`const changedFiles = new Set(deps.getAffectedFiles(...))`) with:

   ```ts
   // Must stay ahead of verifyHandoffAgainstDiff/classification: its "git diff failed:" issue
   // is classified as a handoff format problem and would misroute to implement.
   const affected = deps.getAffectedFiles(baseBranch, activeCwd);
   if (!affected.ok) {
       const reason = scopeUnverifiedReason('Code review pre-flight', taskIds, baseBranch, affected.stderr);
       warn(reason);
       autoBlockPhase(taskIds, 'code_review', codeReviewCheck.count, reason);
       process.exit(2);
   }
   const changedFiles = new Set(affected.files);
   ```

   This applies to full-send and non-full-send runs alike. Do not gate it on `scopeFullSend`. Everything after this point (`verifyHandoffAgainstDiff`, the classification loop, `verifyBaseDriftFromData([...changedFiles], …)`) stays as it is. `process.exit` is typed `never`, so `affected` narrows after the `if`. If lint or TS complains, use an `else`-free early-exit form with an explicit `return` after `process.exit(2)`. Don't restructure the surrounding code.

### Step 3: Caller B — full-send router keeps bundle precedence on failure

Files: `src/orchestrator/main.ts`

1. Add `isFullSendScopeCheckExempt` and `scopeUnverifiedReason` to the existing `./phases/code-review.js` import (main.ts:5).

2. Rewrite the block at main.ts:3248–3271:

   ```ts
   let specGapScopeFiles: string[] = [];
   let specGapScopeError: string | null = null;
   if (phase === 'code_review' && statuses.every(status => status.full_send === true)) {
       const cwd = splitWorktree.getActiveCwd(taskIds);
       const baseBranch = splitGit.getBaseBranch(taskIds);
       const affected = splitGit.getAffectedFiles(baseBranch, cwd);
       const verdicts = statuses.map(status => getVerdict(status, 'code_review'));
       const maxIter = statuses.reduce((max, status) => Math.max(max, getIterations(status)), 0);
       if (!affected.ok) {
           // Same precedence as success: spec_gap halts below (with a note), requested
           // changes reroute below, and only a bundle that would advance to QA blocks here.
           if (verdicts.includes('spec_gap')) {
               specGapScopeError = affected.stderr || 'unknown error';
           } else if (!isFullSendScopeCheckExempt(verdicts)) {
               const recorded = verdicts.filter(Boolean);
               const verdictNote = ` Recorded code-review verdict(s): ${recorded.length > 0 ? recorded.join(', ') : 'none'}; inspect the review before resuming.`;
               const reason = scopeUnverifiedReason('Full-send code review', taskIds, baseBranch, affected.stderr, verdictNote);
               warn(reason);
               splitState.autoBlockPhase(taskIds, 'code_review', maxIter, reason);
               process.exit(2);
           }
       } else {
           const changedFiles = affected.files;
           // ... existing allowlist / specGapScopeFiles / unjudged logic unchanged,
           //     reusing maxIter above instead of recomputing it
       }
   }
   ```

   Keep the success branch's logic identical to today's, including the `buildAffectedFilesAllowlist` call. Move it inside the `else` branch, because the failure path doesn't need it.

3. In `case 'code_review'` (main.ts:3357), extend `scopeNote` so that the failure note goes where the "`--pr` will still reject" note goes:

   ```ts
   const scopeNote = specGapScopeFiles.length > 0
       ? /* existing text unchanged */
       : specGapScopeError !== null
           ? ` Full-send scope could not be verified: the committed diff against the base branch could not be read (git error: ${specGapScopeError}). ` +
               `Scope was not checked; --pr will still reject any task-changed file outside Affected Files. `
           : '';
   ```

   In the console box, next to the existing `if (specGapScopeFiles.length > 0) { … }` lines, add an `else if (specGapScopeError !== null)` with two lines: `Full-send scope could not be verified (git error: …).` and `BLESS does not check scope; --pr will still reject task-changed files outside Affected Files.` The FIX/BLESS lines and the whole-bundle block stay unchanged.

4. The `changes_requested` / `needs_re_review` path needs no code. On failure it reaches the existing `routeBackTo(taskIds, 'implement')`. `routeBackTo` (main.ts:2687) only rewrites phase statuses; it doesn't read the base ref.

### Step 4: Caller A — `--pr`/`--push` drift abort

Files: `src/orchestrator/main.ts`

Replace main.ts:1224–1235 (`else if (baseDriftResult.drift.length > 0) { … }`) with:

```ts
} else if (baseDriftResult.drift.length > 0) {
    // Computed before the --force branch: an unreadable diff cannot be bypassed.
    const taskChanged = splitGit.getAffectedFiles(`origin/${baseBranch}`, cwd);
    if (!taskChanged.ok) {
        splitCli.die(
            `--pr aborted: base-drift detected, but the task-changed files could not be computed against origin/${baseBranch}.\n` +
            `Drifted files:\n${baseDriftResult.drift.map(filePath => `  ${filePath}`).join('\n')}\n` +
            `Git error: ${taskChanged.stderr || 'unknown error'}\n` +
            `This failure cannot be bypassed with --force.`
        );
    }
    if (!cliArgs.force) {
        const classification = splitValidation.classifyBaseDriftFilesFromData(
            baseDriftResult.drift, new Set(taskChanged.files),
        );
        die(splitValidation.buildBaseDriftAbortMessage(baseBranch, classification));
    }
    warn(/* existing --force warning unchanged */);
}
```

Use `splitCli.die`, not the local `const die = splitCli.die` alias (main.ts:109). That alias has no explicit type annotation, so TS won't narrow `taskChanged` after the call. If narrowing still fails, use an explicit `if/else`.

### Step 5: Caller D — implement prompt renders "could not determine"

Files: `src/orchestrator/prompts/index.ts`, `src/orchestrator/phases/implement.ts`

1. In `prompts/index.ts`, widen the type to `readonly string[] | null | undefined`, where `null` means "diff could not be determined" and `undefined` means "no block" (as today). Apply this to `buildAffectedFilesBlock`'s parameter and to the `affectedFiles` parameter of `promptImplement`, `promptImplementRevisions`, and `promptImplementReroute`. Add a one-line comment on `buildAffectedFilesBlock` saying what `null` means. Add the new branch **before** the `length === 0` branch. Do not change the existing two branches' text (the golden entries must not churn):

   ```ts
   if (affectedFiles === null) {
       return [
           '## Committed diff vs base branch',
           '',
           'The committed diff vs the base branch could not be determined (the git diff failed). Apply the full default check matrix from the spec\'s *Validation Required* section — run every check unconditionally; do not evaluate predicate gates against an assumed file set.',
           '',
       ].join('\n');
   }
   ```

   Note: the existing `if (!affectedFiles) return '';` would swallow `null`. Change it to `if (affectedFiles === undefined) return '';` and put the `null` branch right after it.

2. In `implement.ts:74`:

   ```ts
   const affected = getAffectedFiles(baseBranch, activeCwd);
   if (!affected.ok) {
       warn(`Could not compute the committed diff vs ${baseBranch} (${affected.stderr || 'unknown error'}); the implement prompt will apply the full check matrix.`);
   }
   const affectedFiles = affected.ok ? affected.files : null;
   ```

   Import `warn` from `../cli.js` if it isn't already imported. The three builder calls at :90–94 stay unchanged and receive the `string[] | null` value.

### Step 6: Tests

Files: `tests/run-task-validation.test.ts`, `tests/run-task-code-review.test.ts`, `tests/run-task-safety.test.ts`, `tests/run-task-prompts.test.ts`

**AC-1** (`tests/run-task-validation.test.ts`, next to the `parseNameStatusOutput` tests at ~:265–290): import `getAffectedFiles` alongside `parseNameStatusOutput`. Use `withTempDir` and the real-git pattern from the `filterStageablePaths` test (:83). Commit a base on `main`, branch `feature`, and on that branch modify one file and `git mv` another (renames on both sides).
- Success test: `assert.deepEqual(getAffectedFiles('main', dir), { ok: true, files: [<sorted old+new+modified>] })`.
- Failure test: `const r = getAffectedFiles('no-such-base', dir); assert.equal(r.ok, false); if (!r.ok) { assert.match(r.stderr, /no-such-base/); } assert.ok(!('files' in r));`.

**Stub reshaping** (`tests/run-task-code-review.test.ts`, AC-6):
- `makeDeps` (:257) becomes `getAffectedFiles: () => ({ ok: true, files: [] })`.
- Every `deps.getAffectedFiles = () => [x]` override becomes `() => ({ ok: true, files: [x] })`. Grep for `getAffectedFiles = ` to find all of them.
- Change no assertions.

**AC-3** (`tests/run-task-code-review.test.ts`, near the "scope pre-flight blocks normal runs" test at :385): loop over `full_send` values `[false, true]`.
- Setup:
  - `writeTask(tasksRoot, id)`; for `true`, set `status.full_send = true` via `writeStatusToFile`.
  - Build deps with `makeDeps({ activeCwd, events })`.
  - `deps.getAffectedFiles = () => ({ ok: false, stderr: "fatal: ambiguous argument 'no-such-base...HEAD': unknown revision" })`.
  - `deps.verifyHandoffAgainstDiff = () => ["git diff failed: fatal: ambiguous argument 'no-such-base...HEAD'"]`.
- Assertions:
  - `await expectExitTwo(...)`;
  - `assert.deepEqual(events, ['verifyBranch'])` (no cold/foreman);
  - status `code_review.status === 'blocked'`;
  - `verdict !== 'changes_requested'`;
  - `preflight_rejections_current_loop === 0`;
  - the escalation JSON matches `/could not verify scope/` and `/unknown revision/`, and `doesNotMatch(/src\//)`;
  - `review.md` either doesn't exist or doesn't match `/## Pre-Flight Rejection/`.

**AC-2** (`tests/run-task-code-review.test.ts`, after the "full-send bundle router" loop at ~:494): write a helper `setupFailingBundle(tasksRoot, activeCwd, verdicts: Array<string>)`. It runs `initReviewRepo(activeCwd)` and creates one task per verdict (ids `fail-a`, `fail-b`, …). For each task it sets:
- `full_send = true`;
- `base_branch = 'no-such-base'`;
- `phases.code_review.status = 'done'`;
- `phases.code_review.verdict = <v>`.

It also writes `writeFilledReview` for approved/changes_requested, as the existing router tests do. Then call `runCheckAndRouteInFixture`. Cases:
- `['approved']` and `['approved', 'approved_with_nits']`:
  - `status === 2`;
  - every member is `code_review.status === 'blocked'`;
  - the escalation reason matches `/could not verify scope/`, `/no-such-base/`, and `/approved/` (and `/approved_with_nits/` for the bundle), and `doesNotMatch(/src\//)`.
- `['spec_gap']` and `['approved', 'spec_gap']`:
  - `status === 2`;
  - the output matches `/SPEC GAP/`, `/FIX/`, and `/BLESS/`;
  - every member is blocked;
  - the escalation reason matches `/spec_gap verdict/` and `/scope could not be verified/i`, and `doesNotMatch(/src\//)`;
  - the reason does **not** match the rule-3 reason (`/Full-send code review could not verify scope/`).
- `['changes_requested']`, `['approved', 'changes_requested']`, `['approved', 'needs_re_review']`:
  - `status === 0`;
  - no member is blocked;
  - every member has `phases.implement.status === 'pending'` and `phases.code_review.status === 'pending'`.

`routeBackTo(…, 'implement')` (main.ts:2687) resets `implement` and every downstream phase to `pending` and clears verdicts (verified), so these assertions hold on today's routing. Leave the existing "full-send scope exemptions match routing verdicts across a bundle" test unchanged, and optionally add `isFullSendScopeCheckExempt` assertions in a separate test.

**AC-4** (`tests/run-task-safety.test.ts`):
1. In `setupFakeGit`, insert this new branch **immediately before** the generic `diff` branch (`'if [ "${1:-}" = "diff" ] && [ "${2:-}" != "--cached" ]; then'`):

   ```
   'if [ "${1:-}" = "diff" ] && [ "${2:-}" = "origin/${FAKE_GIT_BASE_BRANCH:-main}...HEAD" ] && [ "${FAKE_GIT_THREE_DOT_DIFF_FAIL:-}" = "1" ]; then',
   '  printf "%s\\n" "${FAKE_GIT_THREE_DOT_DIFF_ERROR:-three-dot diff failed}" >&2',
   '  exit 1',
   'fi',
   ```

   It only fires when the env var is set, so existing argv patterns and tests are unaffected (fake-git lockstep). The tree-drift diff's `$2` is `origin/main` with no `...HEAD`, so this branch doesn't match it.

2. New test `commitHumanReviewFiles base-drift gate fails closed when task-changed files cannot be computed`, modeled on the tree-diff-failure test (:6209). Use `runHumanReviewCommit` with:
   - `FAKE_GIT_DRIFT_FILES: 'docs/BACKLOG.md'`;
   - `FAKE_GIT_THREE_DOT_DIFF_FAIL: '1'`;
   - `FAKE_GIT_THREE_DOT_DIFF_ERROR: 'fatal: simulated three-dot failure'`;
   - the usual `FAKE_GIT_STATUS_OUTPUT` / `FAKE_GIT_DIFF_OUTPUT`.

   Assert:
   - a non-zero status;
   - the output matches `/task-changed files could not be computed against origin\/main/`, `/fatal: simulated three-dot failure/`, `/cannot be bypassed with --force/`, and `/docs\/BACKLOG\.md/` (drift reported, proving the tree diff succeeded);
   - the output `doesNotMatch` `/The base branch advanced/`, `/git rebase/`, `/could not compute base-drift diff/`, and `/src\//`;
   - the git log does not match `/^commit /m`.

   Before writing the `/src\//` assertion, check that `combinedOutput` in this harness doesn't already contain an unrelated `src/` path, such as a Node stack frame. If it does, assert `doesNotMatch(/src\//)` on the die-message line only and note this in handoff.

3. New test for the plan decision: the same failure under `--force`. Copy the `--force` test (:6178) runner and add `FAKE_GIT_THREE_DOT_DIFF_FAIL: '1'`. Assert a non-zero status, a match on `/task-changed files could not be computed/`, and no `^commit ` in the git log.

**AC-5** (`tests/run-task-prompts.test.ts`, next to "promptImplement renders empty affected-files branch" at ~:398): `promptImplement(baseState, 'fresh', null, 'main')`. Assert the output matches `/could not be determined/` and `/full default check matrix/`, and does not match `/No prior commits/`. Add one call each for `promptImplementRevisions(baseState, null, 'main')` and `promptImplementReroute(baseState, false, null, 'main')` with the same assertions. Do **not** regenerate `tests/run-task-prompts.golden.json`. The existing golden tests must pass as they are.

### Step 7: Docs and build

Files: `docs/patterns.md`, `dist/orchestrator/run-task.js`

1. Edit `docs/patterns.md` §"`getAffectedFiles` uses three-dot diff semantics" (:161–163). Append two sentences to the paragraph:
   - It returns `{ ok: true; files } | { ok: false; stderr }`, and callers must treat `ok: false` as "cannot verify": guards fail closed, per §"Write-safety guards must fail closed when the underlying probe errors". Prompt hints may stay lenient but must not claim an empty diff.
   - The code_review pre-flight's could-not-verify block must stay ahead of handoff classification, because `verifyHandoffAgainstDiff`'s `git diff failed:` issue is classified as a handoff format problem, and reordering would bring the reroute-to-implement misroute back.
   
   Then run `npm run docs-refs-check`.
2. Run `npm run build`. Commit the regenerated `dist/orchestrator/run-task.js`. `dist/cli/index.js` should be unchanged. If it changes, report that in handoff rather than reverting it.
3. Validation, in order: `npm run lint`, `npm run type-check`, `npm run build`, then (after the build finishes) `npm test`, then `npm run docs-refs-check`. Record each one in handoff's Validation Outcomes. Per `docs/lessons-learned.md` / the worktree test note, one `run-task-safety` linked-worktree-guard failure can show up only when running inside a Claude worktree. Report any failure as it happened. Don't relabel it as passing.

## Testing Plan

- **Unit:**
  - AC-1 real-repo tests for `getAffectedFiles` (success with rename, failure with nonexistent base);
  - AC-5 prompt rendering for the `null` branch across all three implement builders;
  - optional `isFullSendScopeCheckExempt` direct assertions.
- **Integration:**
  - AC-2 `checkAndRoute` subprocess runs, 7 verdict combinations against a real repo with a nonexistent `base_branch`;
  - AC-3 `runCodeReviewPhase` with failing stubs (full_send false/true);
  - AC-4 fake-git `--pr` path, three-dot-only failure, without and with `--force`.
- **Regression:** the existing code-review, safety, and prompt suites pass with stubs reshaped only. The golden file is not regenerated.
- **E2E:** N/A (no UI).
- **Manual:** see the spec's Human Test Plan (code review on a task with a bogus `base_branch` blocks before any reviewer runs).

## Rollback Plan

Reverting the commit restores the `string[]` contract and the fail-open behavior. There is no data migration: `status.json` is unchanged. Any task that was blocked by the new checks can be resumed after the revert with `canon run <ids>`. The block increments `auto_block_count` the same way existing scope blocks do.
