# Implementation Plan: base-drift-conflicts-only

> Written by: Claude | Implements: `tasks/base-drift-conflicts-only/spec.md`

## Approach

Add a `git merge-tree --write-tree` conflict probe in `git.ts`. `verifyBaseDrift` runs it after the existing fetch and tree diff and returns its result next to `drift`. In `commitHumanReviewFiles`, the whole base-drift gate moves out of the top of the function into one local helper. That helper runs immediately before each of the two `git push` calls. On the dirty path it runs after the human_review commit. Its abort callback runs `git reset --soft <pre-commit sha>` before `die()`. Base-only drift (`baseAdvanced`) stops blocking and becomes a count in an info line. Conflicts block, and so does task-side scope drift, which is unchanged.

**Spec-review nit (Non-Goals wording on old git):** implement the Decision §4 / AC-6 behavior. Git older than 2.38 **warns and proceeds**. It does not fail closed. The Non-Goals phrase "the fail-closed probe message covers old git" is loose wording, and the plan does not follow it.

### Feasibility check

- **Exists:** these were all found in the code: `verifyBaseDrift`, `verifyBaseDriftFromData`, `classifyBaseDriftFilesFromData`, `buildBaseDriftAbortMessage` (`src/orchestrator/validation.ts:1564-1710`); `getTreeDriftFiles`, `getAffectedFiles`, `gitSafeAt(Raw)` (`src/orchestrator/git.ts`); `commitHumanReviewFiles` (`src/orchestrator/main.ts:1171`); `setupFakeGit`, `setupHumanReviewHarness`, `runHumanReviewCommit`, `makeGitFixture`, `writeAffectedFilesSpec`, `makeCompleteStatus` (`tests/run-task-safety.test.ts`). The direct-`spawnSync` exit-status pattern this plan copies is `filterGitIgnoredPaths` (`git.ts:~70`).
- **Real path:** there are three callers of `commitHumanReviewFiles`: the full-send tail (`main.ts:2837`, `createPR=true`), human_review `--push/--pr` (`main.ts:2870`), and complete-phase `--push/--pr` (`main.ts:2892`). All three pass through the moved gate. Inside the function, the order today is base-divergence → docs-refs → base-drift → allowlist build → dirty inspection → clean-tree push branch | dirty-path stage/commit/push. After this change it becomes base-divergence → docs-refs → allowlist build → dirty inspection → clean-tree: **gate** → push | dirty: stage → record pre-SHA → commit → **gate** → push.
- **Callers:** `verifyBaseDrift` is called only from `main.ts` and from the `tests/run-task-validation.test.ts` unit tests. `buildBaseDriftAbortMessage` and `classifyBaseDriftFilesFromData` are called only from `main.ts` and tests. `verifyBaseDriftFromData` keeps its signature (code-review.ts:36/369 still use it).
- **Tests that can fail:** AC-1 (the rewritten mode-1 test) dies today at the `baseAdvanced` branch, which makes it red-first. AC-3/4b/4c need a `merge-tree` exit of 1, which today's code never computes. Today they would either pass the declared-path conflict (empty drift) or die on scope drift with the wrong wording. AC-4c-hook passes on any pre-commit-index probe, so it fails unless the probe targets the recorded commit. AC-4d fails if the undo leaves a commit or loses the staged edit. AC-5 and AC-6 need the new fake-git `merge-tree` stub. **Verified on git 2.55:** an unresolvable ref passed to `merge-tree` exits **1** with empty stdout. That is the same status as a conflict (see Step 1). An unknown option exits 129. Unrelated histories exit 128.
- **Predicates:** the probe result is classified like this. Exit 0 → clean. Exit 1 with a first NUL token that is a hex OID → conflicts. Exit 1 without an OID → error. Exit 129 → unsupported. A spawn error or any other status → error. The conflict path list goes through a Set, because a path can repeat across conflict stages. An empty path list on exit 1 is still a conflict, and the message then says "(paths not reported)". The `baseAdvanced` count is 0 → no info line, 1 → "1 file", n → "n files".
- **Scope:** every file the plan edits is listed in Affected Files. No new test file is needed: the real-git tests go in `tests/run-task-safety.test.ts`, and the unit tests in `tests/run-task-validation.test.ts`.
- **Async/stateful:** the code is synchronous. The undo is stateful: the pre-commit SHA is recorded in the same synchronous function, and the reset must run before every `die` that follows the commit (conflict, scope, probe error, task-diff error, tree-diff error). No re-entry concern applies.

### Contradiction recorded (spec AC-4 vs Decision §1)

AC-4 says the existing scope-drift tests "keep passing with their current assertions". Three of the fake-git tests assert `assert.doesNotMatch(gitLog, /^commit /m)` on a gate abort: `dies on drift outside the allowlist`, `fails closed when only the task-changed diff fails` (both force values), and `fails closed when tree diff fails`. Under the Decision, the dirty path commits first and then undoes the commit, so `commit` now appears in the fake-git log. The plan therefore updates those negative assertions to the equivalent invariant: the log contains `reset --soft <pre-sha>` after `commit`, and contains no `push`. Every other assertion in those tests stays. This is logged in `notes.md`.

## Steps

### Step 1: Conflict probe helper in `git.ts`

Files: `src/orchestrator/git.ts`

Add this helper next to `getTreeDriftFiles`:

```ts
export type MergeConflictProbe =
    | { kind: 'clean' }
    | { kind: 'conflicts'; paths: string[] }
    | { kind: 'unsupported'; stderr: string }
    | { kind: 'error'; stderr: string };

export function probeMergeConflicts(baseRef: string, cwd: string, headRef = 'HEAD'): MergeConflictProbe {
    const result = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', headRef, baseRef], {
        cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    ...
}
```

- Use `spawnSync` directly, not `gitSafeAt`. `gitSafeAt` collapses exit 1 into `ok:false`, which is the reason the spec gives for a new helper. Copy the `filterGitIgnoredPaths` pattern.
- Classify the result in this order:
  1. `result.error` → `error` with the error message.
  2. Status 0 → `clean`.
  3. Status 129 → `unsupported`, with stderr.
  4. Status 1 → split stdout on `\0`. If token 0 matches `/^[0-9a-f]{40}([0-9a-f]{24})?$/`, return `conflicts` with `[...new Set(tokens.slice(1).filter(Boolean))]`. Otherwise return `error`, because an unresolvable ref also exits 1 with empty stdout (verified on 2.55: `merge-tree: nosuchref - not something we can merge`, exit 1).
  5. Any other status → `error` with the trimmed stderr, or `exit <n>` when stderr is empty.
- Put a short comment above the function giving the exit semantics (0 clean, 1 conflicts *or* bad ref, distinguished by the OID line; 129 usage error means git older than 2.38; anything else is an error).
- Git 2.55 output shape, verified: `<tree-oid>\0path1\0path2\0`. A modify/delete conflict also lists its path. All four flags (`--write-tree`, `--name-only`, `--no-messages`, `-z`) belong to the 2.38 `--write-tree` mode. Do not use `--merge-base`, which arrived in 2.40. Git before 2.38 handled `merge-tree` with an exact-argc `usage()`, which exits 129 for this argv.

### Step 2: `verifyBaseDrift` returns the probe, and the abort message changes

Files: `src/orchestrator/validation.ts`

1. Change `verifyBaseDrift`'s return type to `{ drift: string[]; fetchFailed: boolean; diffFailed: boolean; diffError?: string; conflict?: MergeConflictProbe }`.
   - If the fetch fails, return as today, with no probe. The existing behavior skips the whole gate offline, and the spec matches it.
   - If the tree diff fails, return as today, with no probe.
   - Otherwise run `probeMergeConflicts(\`origin/${baseBranch}\`, cwd)` and include it as `conflict`. The probe runs whether or not `drift` is empty (spec Decision §1, "Runs on every `--push` / `--pr`").
   - Import `probeMergeConflicts` and the type from `./git.js`. Follow how `getTreeDriftFiles` is imported today.
2. Keep `classifyBaseDriftFilesFromData` unchanged. It still splits `drift` into `baseAdvanced` and `taskChangedOutOfScope`, and `baseAdvanced` now only feeds the info count.
3. Change `buildBaseDriftAbortMessage(baseBranch, { conflicts: readonly string[]; taskChangedOutOfScope: readonly string[] })`:
   - **Header:** if `conflicts.length > 0`, use `` `--pr aborted: the task branch conflicts with origin/${baseBranch}.` `` Otherwise keep `'--pr aborted: base-drift detected.'` (the scope-only output stays as it is today).
   - **Conflict section**, when non-empty:
     ```
     Merging origin/<base> into this branch would conflict in:
       <path>
     Merge or rebase the base branch into the task branch, resolve the conflicts, then rerun:
       git fetch origin <base> && git rebase origin/<base>
       (or: git merge origin/<base>)
     ```
     If the probe reported conflicts but no paths, print `  (git did not report paths)` in place of the list.
   - **Scope section:** byte-identical to today.
   - **Footer:** `Bypass with --force if you've verified the drift is intentional.` stays, because the scope-only output must stay unchanged. When conflicts are present, add a line before it: `A conflict will still block --ship's merge until it is resolved.`
   - Make sure the strings `changed only on origin` and `files changed only by base advancement` do not survive anywhere (AC-7 grep).

### Step 3: Move the gate in `commitHumanReviewFiles` and add the undo

Files: `src/orchestrator/main.ts`

1. Delete the block at `main.ts:1215-1245`, the `verifyBaseDrift` call through the `--force override` warn.
2. Add a module-local function in `main.ts`, just above `commitHumanReviewFiles`:
   ```ts
   function runBaseDriftGate(taskIds: string[], baseBranch: string, cwd: string, abort: (message: string) => never): void
   ```
   The body runs these steps in order:
   - `const r = splitValidation.verifyBaseDrift(taskIds, baseBranch, cwd);`
   - If `r.fetchFailed`, return (the warning was already emitted).
   - If `r.diffFailed`, call `abort(...)` with today's "could not compute base-drift diff" message, unchanged.
   - **Probe outcome, before any force decision** (Known Risk "--force path skipping the probe"):
     - `error`: call `abort(` `` `--pr aborted: could not check for merge conflicts with origin/${baseBranch}.\nGit error: ${stderr || 'unknown error'}\nThis failure cannot be bypassed with --force.` `` `)`.
     - `unsupported`: `warn(` `` `Skipping the merge-conflict check against origin/${baseBranch}: git merge-tree --write-tree requires git 2.38 or newer. Conflicts were not checked.` `` `)`.
   - `conflicts = r.conflict?.kind === 'conflicts' ? r.conflict.paths : []`. A clean result counts as conflicts only when the kind is `conflicts`, so a probe that reports `kind: 'conflicts'` with an empty path list still blocks. Track this with a boolean `hasConflict`, not with `conflicts.length`.
   - Scope classification: when `r.drift.length > 0`, compute `taskChanged = splitGit.getAffectedFiles(...)`. On `!ok`, `abort(...)` with today's text unchanged. Then classify with `classifyBaseDriftFilesFromData`. When drift is empty, both lists are empty.
   - If `hasConflict || taskChangedOutOfScope.length > 0`:
     - Without `cliArgs.force`, call `abort(buildBaseDriftAbortMessage(baseBranch, { conflicts, taskChangedOutOfScope }))`.
     - With force, warn per cause:
       - For conflicts: `` `--force override: merge conflicts with origin/${baseBranch}; proceeding at user request. Conflicted files:\n` `` plus the list.
       - For scope: keep today's exact text, `` `--force override: base-drift detected; proceeding at user request. Drifted files:\n` ``, listing `taskChangedOutOfScope`. The existing test asserts the `/--force override: base-drift detected/` prefix and the `docs/BACKLOG.md` path, and both survive.
   - **Info line:** if `baseAdvanced.length > 0`, print it whether or not `--force` is set, and also after a forced bypass.
     - When the probe kind is `clean`, or `conflicts` with none of the `baseAdvanced` paths conflicted: `` info(`origin/${baseBranch} advanced on ${n} file${n === 1 ? '' : 's'} outside this task's Affected Files; they merge cleanly.`) ``.
     - When the kind is `unsupported`, print the same count but end it with `; not checked for conflicts.`
     - Never print a `--force override` line when the only drift is base advance (AC-5b).
3. **Clean-tree path** (`main.ts:~1305`): inside `if (branchName) {`, call `runBaseDriftGate(taskIds, baseBranch, cwd, msg => die(msg))` before `info(\`Clean tree. Pushing...\`)`. There is nothing to undo here.
4. **Dirty path:**
   - Just before `gitSafeAt(cwd, 'commit', ...)`, record `const preCommit = gitSafeAt(cwd, 'rev-parse', 'HEAD');`. If that fails, die with `Human review commit aborted: could not record HEAD before committing: …`. That happens before any commit, so nothing needs undoing.
   - After the commit succeeds and `Committed human_review artifacts…` is printed, call `runBaseDriftGate(taskIds, baseBranch, cwd, msg => die(undoHumanReviewCommit(cwd, preSha, branchName, msg)))`, then the existing push.
   - `undoHumanReviewCommit` is a small `main.ts` helper:
     1. Read `git rev-parse HEAD` as `leftover`, best effort.
     2. Run `git reset --soft <preSha>`.
     3. On success, return `` `${msg}\n\nThe human_review commit was undone (HEAD reset to ${preSha.slice(0, 7)}); its changes are still staged. Re-run after resolving.` ``.
     4. On failure, return `` `${msg}\n\nCould not undo the human_review commit ${leftover || '(unknown)'} on ${branchName}: ${stderr}\nUndo it manually with: git reset --soft ${preSha}` ``.
   - The callback must run before `die()`, because `die` exits the process. Passing a callback is what guarantees that every abort branch inside the gate (tree-diff failure, probe error, task-diff failure, conflict, scope) gets the undo.
5. **Ordering consequence (spec Known Risk "Gate reordering"):** the allowlist, dirty, and staged checks now run before the gate. If an existing test fails because it now hits one of those earlier messages, fix the test's fixture, not the ordering.

### Step 4: Fake-git harness stubs

Files: `tests/run-task-safety.test.ts` (`setupFakeGit`)

Add these branches before the final `unexpected git args` fallthrough:

- **`merge-tree`** (`[ "${1:-}" = "merge-tree" ]`):
  - `FAKE_GIT_MERGE_TREE_STATUS` defaults to `0`.
  - Status 0: `printf '%s\0' 0000000000000000000000000000000000000001`, then `exit 0`.
  - Status 1: print the same OID followed by each comma-separated entry of `FAKE_GIT_MERGE_TREE_CONFLICTS` as `%s\0`, then `exit 1`.
  - Any other status: print `${FAKE_GIT_MERGE_TREE_ERROR:-merge-tree failed}` to stderr and exit with that status.
- **`reset --soft`** (`[ "${1:-}" = "reset" ] && [ "${2:-}" = "--soft" ]`): exit 1 with stderr when `FAKE_GIT_RESET_SOFT_FAIL=1`, otherwise exit 0.
- **Three-dot override:** in the existing generic `diff` branch, right after the `FAKE_GIT_AFFECTED_DIFF_FAIL` check, add `if [ "${2:-}" = "origin/${FAKE_GIT_BASE_BRANCH:-main}...HEAD" ] && [ -n "${FAKE_GIT_AFFECTED_FILES+x}" ]; then` and emit `M\0<file>\0` per comma entry of `FAKE_GIT_AFFECTED_FILES` (empty allowed), then `exit 0`. Without this override, every fake drift file also counts as task-changed, so the harness cannot express clean base advance (AC-5b). When the variable is unset, behavior is unchanged.

Because the default stub is clean, existing fake-git tests that reach the gate pass for the right reason. Without the stub, the probe would fall through to exit 1 with no OID, which Step 1 classifies as an error and aborts.

### Step 5: Update existing tests

Files: `tests/run-task-safety.test.ts`, `tests/run-task-validation.test.ts`

- **`run-task-validation.test.ts` `base-drift abort message varies with drift cause` (~2004):** pass `{ conflicts, taskChangedOutOfScope }`.
  - Conflict-only: match `/conflicts with origin\/main/`, `/git fetch origin main && git rebase origin\/main/`, and the path. `doesNotMatch` both `/not in the spec's Affected Files/` and `/base-drift detected/`.
  - Task-only: match `/base-drift detected/` and `/not in the spec's Affected Files/`. `doesNotMatch` `/conflicts with origin/`.
  - Mixed: both paths and both sections.
  - These are state-varying pairs (patterns.md "pin it with a state-varying pair").
- **`verifyBaseDrift: two-dot diff catches base-advance drift…` (~2371):** keep `drift` = `['docs/decisions.md']` and add `assert.deepEqual(result.conflict, { kind: 'clean' })`.
- **Add a unit test for `probeMergeConflicts`** in `run-task-validation.test.ts`, using a real-git fixture (`makeGitFixture` exists there):
  - Clean result.
  - A same-line conflict returns `{kind:'conflicts', paths:[file]}`. Include one path with a space to check `-z` parsing.
  - A bad ref (`origin/nosuch`) returns `kind: 'error'` and **not** `conflicts`. This pins the exit-1 disambiguation.
  - The import comes from `../src/orchestrator/git.ts`. Check how that file already imports git helpers.
- **Fake-git abort tests:**
  - In `dies on drift outside the allowlist`, `fails closed when only the task-changed diff fails` (both force values), and `fails closed when tree diff fails`, replace `assert.doesNotMatch(gitLog, /^commit /m)` with:
    - `assert.match(gitLog, /^commit [\s\S]*^reset --soft abc123$/m)`
    - `assert.doesNotMatch(gitLog, /^push /m)`
  - The other assertions stay. This is the recorded contradiction.
  - `fails closed when only the task-changed diff fails` asserts `doesNotMatch …|git rebase|…`. That still holds, because the merge-tree stub is clean.
- **`base-drift gate warns and proceeds with --force`:** unchanged. With `FAKE_GIT_AFFECTED_FILES` unset, BACKLOG counts as task-changed, so the scope `--force` text is still emitted.
- **`run-task-ship.test.ts`:** it runs `--pr` through real git, so the probe actually executes there. No edit is expected. If something fails, diagnose it before changing anything, and record any fixture change as a deviation in the handoff (this file is not in Affected Files).

### Step 6: New real-git tests (AC-1 … AC-4d)

Files: `tests/run-task-safety.test.ts`

Add a local fixture helper next to the mode-1 test: `makeBaseDriftFixture(dir, { baseFiles?, taskFiles?, declared })`. It does the following:

- Calls `makeGitFixture`.
- Optionally commits shared seed files on `main` and pushes them.
- Checks out `task/demo`.
- Writes `makeCompleteStatus` plus `writeAffectedFilesSpec` under `tasksRoot` (outside `localDir`, via `CANON_TASKS_DIR_OVERRIDE`).
- Returns `{ localDir, originDir, tasksRoot, thirdParty(fn) }`. The `thirdParty` helper clones origin `main`, sets the user config, runs `fn(dir)`, commits, and pushes. This is the same flow as today's mode-1 test.

Reuse the mode-1 test's `runNodeInline` invocation, and add a `createPR` parameter.

**Dirty-path trigger:** a clean tree with `createPR=false` and no `--push` dies with "no dirty task artifacts" *before* the gate. Every dirty-path test therefore writes a dirty allowlisted file, such as `tasks/task-a/done.md` inside `localDir`. Shared assertion helpers:

- `headOf(localDir)`: `git rev-parse HEAD`.
- `originHasBranch(originDir, 'task/demo')`: `git ls-remote --heads <origin> task/demo` is non-empty.

The tests:

- **AC-1 (rewrite `…dies when the base branch advanced outside Affected Files`):** rename it to `…passes when the base branch advanced on non-overlapping files`. Keep the existing setup: the task changes declared `src/orchestrator/main.ts`, and the base adds `docs/BACKLOG.md`. Add a dirty `tasks/task-a/done.md`. Assert:
  - status 0
  - output matches `/advanced on 1 file outside this task's Affected Files; they merge cleanly/`
  - `doesNotMatch(/base-drift detected|conflicts with origin/)`
  - `originHasBranch` is true

  This test is red before the change (today it dies with `base-drift detected`).
- **AC-2:** the same shape, but the base adds `tasks/other-id/spec.md` and `tasks/other-id/status.json`. Assert status 0 and `/advanced on 2 files/`.
- **AC-3:** seed `docs/patterns.md` (`a\nb\nc\n`) on main before branching, and declare it. The task commits a line-1 edit `TASK`. The base pushes a line-1 edit `BASE`. Add a dirty `tasks/task-a/done.md`. Record `pre = headOf` and run. Assert:
  - non-zero exit
  - `/conflicts with origin\/main/`, `/docs\/patterns\.md/`, `/git rebase origin\/main/`, `/human_review commit was undone/`
  - `headOf === pre`
  - `!originHasBranch`
- **AC-4b:** the AC-3 shape, plus the task commits an undeclared `src/extra.ts`. Assert both `/conflicts with origin\/main/` and `/not in the spec's Affected Files[\s\S]*src\/extra\.ts/`, and `headOf === pre`.
- **AC-4c dirty artifact:** the task branch has no committed doc edit. Leave `docs/patterns.md` line-1 edited and dirty (unstaged) in `localDir`. The base edits line 1. Assert:
  - non-zero exit, and the output names `docs/patterns.md`
  - `headOf === pre`
  - `git diff --cached --name-only` includes `docs/patterns.md` (the edit survived, staged)
  - `!originHasBranch`
- **AC-4c hook:**
  - The base edits line 1 of `docs/patterns.md`. The task leaves a dirty line-3 edit, which merges cleanly.
  - Write `<dir>/hooks/pre-commit` with mode `0o755`: `#!/bin/sh\nsed '1s/.*/HOOK/' docs/patterns.md > docs/patterns.md.tmp && mv docs/patterns.md.tmp docs/patterns.md && git add docs/patterns.md\n`.
  - Set `gitIn(localDir, 'config', 'core.hooksPath', <dir>/hooks)`.
  - Assert the abort names `docs/patterns.md`, `headOf === pre`, and `!originHasBranch`.
  - Add a sanity assertion first: before the run, `git merge-tree --write-tree HEAD origin/main` against a commit built from the pre-hook content would be clean. A simpler equivalent is to assert that the dirty line-3 edit alone does not touch line 1. Avoid an extra merge-tree call in the test if that is simpler; the fixture's line choice proves the case.
- **AC-4c clean-tree:** the AC-3 shape with no dirty file. Call with `createPR=true`, which routes into the clean-tree branch. `gh` may be absent: `isCommandAvailable` only sets a flag, and the gate aborts before `reportOrCreatePR`. Assert non-zero exit, `headOf === pre`, and `!originHasBranch`.
- **AC-4d:** after the AC-4c dirty-artifact abort:
  - Revert the base edit through `thirdParty` (`git revert --no-edit HEAD` and push).
  - Re-run the same command.
  - Assert status 0, `originHasBranch`, and that `git log -1 --format=%s` matches `/^chore: add task artifacts for task-a/`. The staged doc must be in that commit: `git show --name-only HEAD` includes `docs/patterns.md`.

### Step 7: New fake-git tests (AC-5, AC-6)

Files: `tests/run-task-safety.test.ts`

Route these through `main()`, copying the `base-drift gate warns and proceeds with --force` invocation (patterns.md: `cliArgs` needs `main()`). Use a small local builder so the env block is not copied four times.

- **AC-5a:** with `--force`, `FAKE_GIT_MERGE_TREE_STATUS=1`, `FAKE_GIT_MERGE_TREE_CONFLICTS=docs/patterns.md,src/a.ts`, and empty drift, assert:
  - status 0
  - `/--force override: merge conflicts with origin\/main/`
  - both paths in the output
  - `^push -u origin task\/task-a$` in the log
  - no `reset --soft`
- **AC-5b:** with `--force`, `FAKE_GIT_DRIFT_FILES=docs/BACKLOG.md`, `FAKE_GIT_AFFECTED_FILES=` (set but empty), and a clean merge-tree, assert:
  - status 0
  - `/advanced on 1 file .*merge cleanly/`
  - `doesNotMatch(/--force override/)`
  - push present
- **AC-6 unsupported:** without `--force`, set `FAKE_GIT_MERGE_TREE_STATUS=129` and `FAKE_GIT_MERGE_TREE_ERROR='usage: git merge-tree <base-tree> <branch1> <branch2>'`. Assert status 0, `/2\.38/`, `/Conflicts were not checked/`, and push present.
- **AC-6 error:** loop over `force` in `[false, true]`. Set `FAKE_GIT_MERGE_TREE_STATUS=128` and `FAKE_GIT_MERGE_TREE_ERROR='fatal: simulated merge-tree failure'`. Assert:
  - non-zero exit
  - `/could not check for merge conflicts/`, `/fatal: simulated merge-tree failure/`, `/cannot be bypassed with --force/`
  - the log has `commit` and then `reset --soft abc123`, and no `push`
- **Undo-failure message:** the same as AC-6 error, without force, plus `FAKE_GIT_RESET_SOFT_FAIL=1`. Assert `/Could not undo the human_review commit/` and `/git reset --soft abc123/`. This covers the spec's "If the undo itself fails" clause.

### Step 8: Docs and help text (AC-7)

Files: `docs/pipeline-orchestrator.md`, `docs/codebase-map.md`, `docs/patterns.md`, `src/orchestrator/cli.ts`, `src/cli/index.ts`; then `npm run sync-templates` to regenerate `templates/docs/pipeline-orchestrator.md`

- **`pipeline-orchestrator.md` §351 ("Second, for `--pr` and `--push`…"):** rewrite it to say:
  - The gate runs immediately before the push, after the human_review commit on the dirty path.
  - It fetches `origin/<base>` and probes `git merge-tree --write-tree HEAD origin/<base>`. Any conflicted path, allowlisted or not, aborts with merge/rebase remediation.
  - Base advance that merges cleanly only prints an info line with the file count.
  - Task-changed files outside the allowlist still abort, with the same remediation as before.
  - On an abort after the human_review commit, the commit is soft-reset, so nothing is left committed or pushed.
  - Git older than 2.38 skips the conflict check with a warning. Other probe failures fail closed.

  Keep the Mode 1 / Mode 2 framing accurate: Mode 1 now blocks only on conflict.
- **§355:** `--force` bypasses conflicts and scope drift, but not diff or probe failures.
- **§98 and §101 rows:** in the `--allow-divergent-base` row, replace "file-allow-list base-drift gate" with "base-drift gate (merge conflicts and out-of-scope task files)". In the `--force` row, use "base-drift gate (merge conflicts and out-of-scope task files)" and add "merge-conflict probe failures" to "does not bypass".
- **`codebase-map.md:57`:** name `probeMergeConflicts` in `git.ts` as a low-level helper, and describe `verifyBaseDrift` as returning scope drift plus the conflict probe, gated in `commitHumanReviewFiles` before each push.
- **`patterns.md` §`getAffectedFiles` uses three-dot diff semantics:** append this sentence: "Mergeability is a third question: whether the base merges into the task branch cleanly is probed with `git merge-tree --write-tree` (`probeMergeConflicts`), not inferred from either tree diff."
- **`patterns.md` §Git and npm behavior:** add a bullet: "**`git merge-tree --write-tree` exit status is overloaded.** 0 = clean, 1 = conflicts *or* an unresolvable ref (distinguish by the tree-OID first line in stdout), 129 = usage error (git older than 2.38 lacks `--write-tree`), anything else = error. Pass `-z --name-only --no-messages` to get `<oid>\0path\0…`."
- **Help text:** in both `cli.ts` (lines 131-135, 140, 144) and `src/cli/index.ts` (92-96), replace "Aborts if HEAD's tree differs from origin/<base> on files not in spec's Affected Files (bypass with --force)" with "Aborts if merging origin/<base> would conflict, or if the branch changed files not in spec's Affected Files (bypass with --force)". Keep the lines within the existing column widths. In `cli.ts:144`, "file-allow-list gate" becomes "base-drift gate".
- **Grep:** `grep -rnE "changed only on origin|files changed only by base advancement" src docs templates` must return nothing. Also grep `file-allow-list` and `HEAD's tree differs` across `src docs templates README.md` and update any remaining restatement.

### Step 9: Build and validate (AC-8)

1. `npm run sync-templates`, then `npm run sync-templates:check`.
2. `npm run build`. This updates `dist/cli/index.js` and `dist/orchestrator/run-task.js`, and both get committed.
3. `npm run type-check && npm run lint && npm test`, `npm run docs-refs-check`.
4. Confirm `git status` shows no files outside Affected Files. Expect `tests/run-task-ship.test.ts` to be untouched.

## Open questions (unattended; interpretation chosen)

- **Header wording when only scope drift is present:** kept as `base-drift detected` so AC-4's "unchanged" holds. The new conflict header is used whenever any conflict is present.
- **A fetch failure skips the probe too:** this matches today's offline best-effort behavior. The spec's "Runs on every `--push`/`--pr`" is read as covering every *successful-fetch* run.
