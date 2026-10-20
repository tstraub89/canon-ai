# Implementation Plan: autocommit-retry-at-review-entry

> Written by: Claude | Implements: `tasks/autocommit-retry-at-review-entry/spec.md`

## Approach

Add one orchestrator-context helper in `src/orchestrator/main.ts` that runs in the main loop immediately before `runPhase(currentPhase, state)` when `currentPhase === 'code_review'`. It re-invokes the existing `autoCommitCode` only when handoff-listed paths are dirty and implement is not still operator-accepted. A second change adds one rule to the foreman prompt. Spec review verdict is `approved` (no nits to fold in).

**Feasibility check** (found by reading code this session):
- **Exists:** `autoCommitCode` (`main.ts:380`, exported, sole caller `checkAndRoute('implement')` at ~`:3393`), `operatorAcceptedImplement` (`:350`), `isPipelineOwnedPath` (`:~330`), `splitValidation.parseHandoffChangesRows`, `splitGit.gitSafeAtRaw` / `parsePorcelain` / `filterGitIgnoredPaths`, `splitWorktree.getActiveCwd`, main loop single `runPhase` call (`:~3746`), `code-review-foreman.md` step 4 (`### 4. Write \`review.md\``), golden keys `promptCodeReview_round1` / `promptCodeReview_roundN` in `tests/run-task-prompts.golden.json` (both embed the foreman template, so both change), `UPDATE_GOLDENS=1` regen, fixtures `makeAutoCommitFixture`, `makeOutOfRootTaskFixture`, `makeBootstrappedTaskWorktreeFixture`, `runReviewLoopMain`, `runMainInline`, `setupInvocationLoggingCliTools`, `setupFakeCliTools` in `tests/run-task-safety.test.ts`.
- **Real path:** `main()` loop → `assertSamePhase` → `buildPipelineState` → `runPhase` → `runCodeReviewPhase` (`phases/code-review.ts`) → pre-flight `verifyHandoffAgainstDiff` (`base...HEAD`). Nothing before the pre-flight commits. `autoCommitCode` already does the whole job (guards, stage, commit, `verifyHandoffFilesCommitted`); the helper only decides *whether* to call it. Its early-return paths (clean tree, nothing to stage) make a spurious call harmless, but the spec requires no call and no log line when nothing is dirty, so the helper pre-checks.
- **Callers:** no function's contract changes. `autoCommitCode` and `operatorAcceptedImplement` keep their behavior; `operatorAcceptedImplement` is only refactored to share its accepted-flag + SHA predicate (its single caller is `autoCommitCode`). `runPhase` has one call site, so every route into `code_review` (including re-entry after a review round and reroute) is covered. The agent-failure try/catch from task `agent-failure-parks-phase` is not on `main` yet; the helper goes before `runPhase` and, if that lands, must stay outside its try/catch (git op, not an agent session). Whichever lands second reconciles the textual conflict.
- **Tests that can fail:** AC-1 fails pre-fix because the dirty handoff file reaches the pre-flight, which writes a `handoff→diff` block and bumps `preflight_rejections_current_loop`. AC-3 needs a state where `git commit` itself fails (a failing `pre-commit` hook in the fixture repo). AC-4 needs `operator_accepted: true` + `operator_accepted_sha` equal to HEAD; the stale companion moves HEAD with a commit that does not touch the dirty file.
- **Predicates:** dirty = any porcelain entry (staged, unstaged, untracked via `-uall`, staged deletion `D `) whose path is in the handoff set. Boundaries: empty handoff set → no retry (fall through to today's path); malformed rows → ignored by the pre-check (they are not in `files`), and `autoCommitCode` still reports them if a retry does fire; gitignored handoff paths never show in status, no special case; pipeline-owned paths (`tasks/<id>/…`, telemetry) are not in the handoff set so they never trigger (AC-5), unless a handoff lists one, which is the same as today; `git status` probe error → skip the retry (today's path then surfaces git problems through the pre-flight); this is a recorded judgment call (spec silent), chosen because a retry that cannot see state must not commit. Operator-accepted: all tasks `operator_accepted === true` AND HEAD equals each recorded SHA (`every`, per the bundle-gate pitfall in `docs/patterns.md`); missing/blank SHA or failed `rev-parse` → not accepted.
- **Scope:** every step edits only files in the spec's Affected Files (plus the golden JSON, which the spec names conditionally under AC-6 / Affected Files note).
- **Async/stateful:** the helper is synchronous, runs once per loop iteration before the agent spawns, and holds no state across iterations (it re-reads status/git each time, per the "no in-memory cross-phase state" pitfall). Re-entry is safe: after a successful commit the next iteration sees a clean handoff set and does nothing. Bundles: uses the bundle `taskIds` and `getActiveCwd(taskIds)`, like `checkAndRoute('implement')`.

No contradiction with the spec found. Observation: the task dir already contained `handoff.md`, `review.md`, `done.md`, `pr-body.md` from before this phase while `status.json` is at `plan`; treated as stale and left untouched (see notes).

## Steps

### Step 1: Share the accepted-implement predicate

Files: `src/orchestrator/main.ts`

Extract the first two checks of `operatorAcceptedImplement` (all tasks `phases.implement.operator_accepted === true`, and `rev-parse HEAD` equals every recorded `operator_accepted_sha`) into a new private function `implementAcceptedAtHead(taskIds: readonly string[], cwd: string): boolean`. Rewrite `operatorAcceptedImplement` as `if (!implementAcceptedAtHead(taskIds, cwd)) return false;` followed by its unchanged clean-source-tree check. Behavior of `operatorAcceptedImplement` must not change.

### Step 2: Add the retry helper

Files: `src/orchestrator/main.ts`

Add, next to `autoCommitCode`:

```ts
export function retryImplementAutoCommitAtReviewEntry(taskIds: string[], cwd: string): boolean
```

Logic, in order:
1. `if (implementAcceptedAtHead(taskIds, cwd)) return false;` (Decision 2; dirty or not, the operator owns the commit).
2. Union the handoff files: `for (const id of taskIds) for (const f of splitValidation.parseHandoffChangesRows(id).files) set.add(f)`. Empty set → `return false`.
3. `const status = splitGit.gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall');` If `!status.ok` → `return false`. `const dirty = splitGit.parsePorcelain(status.stdout);` (confirm it yields both sides of a rename; if it only yields the destination, that is fine since `autoCommitCode` uses the same set). If no handoff file is in `dirty` → `return false`.
4. `splitCli.info('Retrying the implement auto-commit that did not complete…');` then `autoCommitCode(taskIds, cwd);` `return true`.

Do not catch errors: `autoCommitCode`'s `die` must stop the run before the pre-flight (Decision 3). Return value is for tests/logging only.

### Step 3: Call it from the main loop

Files: `src/orchestrator/main.ts`

In `main()`'s `while (true)` loop, immediately before `const state = buildPipelineState(taskIds); const phaseResult = await runPhase(...)`, add:

```ts
if (currentPhase === 'code_review') {
    retryImplementAutoCommitAtReviewEntry(taskIds, splitWorktree.getActiveCwd(taskIds));
}
```

Place it before `buildPipelineState` so state is built after the commit. Do not touch `checkAndRoute`.

### Step 4: Foreman citation rule

Files: `src/orchestrator/prompts/templates/code-review-foreman.md`

In step 4 (`### 4. Write \`review.md\``), add one bullet/sentence after the existing "Include:" list (keep other text unchanged). Single canonical text, no leading hash inside code blocks (see review.md heading-parser pitfall), wording that makes sense in an adopter repo (no canon-ai file names):

> When you cite a section of a Markdown doc with the quoted form `§"…"`, the quoted text must be an exact heading in that file. To point at a bold-lead paragraph or anything that is not a heading, use `file:line` or the unquoted `§Name` form instead.

Then `npm run build` (templates are bundled by `tsup`).

### Step 5: Docs sentence

Files: `docs/pipeline-orchestrator.md` (then `templates/docs/pipeline-orchestrator.md` via sync)

In §"Auto-Branch + Auto-Commit", after the **Auto-commit** paragraph's first sentence group, add one sentence: if the auto-commit fails, the next `canon run` retries it before code_review's pre-flight (when handoff-listed files are still uncommitted and implement was not operator-accepted); if the retry fails again the run stops before the pre-flight without consuming a review loop. Run `npm run sync-templates`; never hand-edit the mirror.

### Step 6: Tests

Files: `tests/run-task-safety.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`

Safety tests (`{ concurrency: false }`, `withTempDir`, new `void test(...)` blocks near the existing `makeAutoCommitFixture` / review-loop tests):
- Fixture: build with `makeBootstrappedTaskWorktreeFixture` (worktree mode, per AC-1) or, if the code_review pre-flight needs a fuller state, adapt `writeReviewLoopFixture` with `worktree: true`; write `implement: done`, `code_review: pending`, a handoff whose Changes row lists `src-file.ts`, commit the baseline, then modify `src-file.ts` (staged and/or unstaged) in the active checkout. Drive `main()` through `runReviewLoopMain` / `runMainInline` with `--step` and the fake agent CLIs (`setupInvocationLoggingCliTools`) so review agents are faked. Read results from the active-checkout `status.json` and `review.md`.
- **AC-1:** file shows in `git log base..HEAD`; `preflight_rejections_current_loop === 0`; `review.md` has no `handoff→diff`. Confirm it fails with Step 3 removed.
- **AC-2 + AC-5:** clean handoff files, plus a dirty `tasks/<id>/review.md` and a dirty telemetry file: no new commit (HEAD unchanged), output lacks `Retrying the implement auto-commit`, code_review proceeds.
- **AC-3:** install a failing `.git/hooks/pre-commit` (`exit 1`, executable) in the fixture; expect exit 1, `Auto-commit failed:` in output/exit marker, no pre-flight block in `review.md`, `preflight_rejections_current_loop` and `iterations_current_loop` unchanged.
- **AC-4:** set `phases.implement.operator_accepted: true` and `operator_accepted_sha` to HEAD with the file dirty: HEAD unchanged, file still dirty, no Retrying line. Companion: add an unrelated commit so HEAD ≠ recorded SHA → retry commits (as AC-1).
- Optionally one direct unit-style test of `retryImplementAutoCommitAtReviewEntry` returning `false`/`true` for the bundle `every` case (one task accepted, one not → retry runs).

Prompt test (`tests/run-task-prompts.test.ts`): add a test next to the foreman tests (~line 549) asserting the rendered `promptCodeReview` output contains the rule text, using `process.cwd()`-derived paths per the worktree pitfall. Then regenerate goldens: `UPDATE_GOLDENS=1 npm test` (or the file-scoped form that `before()`/`recordOrAssert` supports), and list `tests/run-task-prompts.golden.json` in the handoff with that command. Inspect the golden diff: only the foreman step 4 text should change in `promptCodeReview_round1` and `promptCodeReview_roundN`.

### Step 7: Build and validate

Files: `dist/cli/index.js`, `dist/orchestrator/run-task.js` (generated; do not revert)

Run, in order: `npm run build && npm run type-check && npm run lint && npm test && npm run sync-templates:check && npm run docs-refs-check`. In a Claude worktree run `npm ci` first and expect only the known linked-worktree-guard failure in `run-task-safety` unless the diff touches it. In the handoff Changes table list every changed file including `templates/docs/pipeline-orchestrator.md`, the golden JSON, and both `dist/` files.

## Testing Plan

- **Unit/integration:** AC-1 to AC-5 in `tests/run-task-safety.test.ts`; AC-6 in `tests/run-task-prompts.test.ts` plus regenerated golden.
- **Red-first:** write AC-1 first and confirm it fails (pre-flight rejection recorded) before Step 3.
- **Manual:** the spec's Human Test Plan (failing pre-commit check, fix, re-run).

## Rollback Plan

Revert the commit. No data/schema changes; the helper is stateless and only calls existing `autoCommitCode`. Stuck state from a failed retry is the same as today's failed auto-commit (staged index, operator fixes the hook failure and re-runs).
