# Implementation Plan: no-base-scaffold-commit

> Written by: Claude | Implements: `tasks/no-base-scaffold-commit/spec.md`

## Approach

Three moving parts:

1. **Bootstrap.** Delete the base commits and copy the scaffold into the worktree as untracked files.
2. **Pull-time clearing.** Before `--ship` and `canon task post-merge-sync` pull, a shared helper deletes untracked `tasks/` files that the incoming ref tracks and HEAD does not.
3. **Cleanup and restatements.** Remove the full-send base push, the classifier, the hint, and every doc or prompt that describes them.

Write the AC-7 / AC-8 / AC-11 tests before the ship and post-merge-sync code changes (Step 1). They are the red-first evidence the spec asks for. Do not use `git stash` to get a pre-change baseline (patterns.md "Never use blanket git stash"). Ordering the steps is enough.

### Feasibility check

- **Exists:** confirmed by search. `commitTaskArtifactsToBase`, `isScaffoldCommitSubject`, `classifySafeToPushCommitFromData`, `classifySafeToPushCommit`, `hasUnpushedScaffoldCommits`, `SafeToPushVerdict` and the `SCAFFOLD_*_SUBJECT` regexes are in `src/orchestrator/git.ts`. `ensureBranch` is at git.ts:360. `ensureWorktree` and `TASK_ARTIFACT_FILES` are in `src/orchestrator/worktree.ts`. `scaffoldCommitHint` and the commit call are in `src/orchestrator/phases/implement.ts`. These are in `src/orchestrator/main.ts`:
  - `pushScaffoldBaseCommitsForFullSend` (:1382), called from the full-send tail (:3143);
  - `mergeOpenPRsAndPull` (:2216);
  - `assertLocalBaseInSyncWithOrigin` (:1785);
  - `formatCompleteStateBanner` (:1319);
  - `shipTasks` (:2409).

  `taskPostMergeSync` and `findUntrackedClobberPaths` are in `src/task/index.ts` (:1316, :1289). `CANON_RUNTIME_GITIGNORE_PATTERNS` is in `src/lib/canon-block.ts`. The fake `gh` is `setupFakeTools` in `tests/run-task-ship.test.ts`.
- **Real path:**
  - Bootstrap: `runImplementPhase` → `ensureBranch` → `ensureWorktree` → branch-recording loop. `ensureBranch` has exactly one caller (`implement.ts:79`).
  - `--ship` merge path: `shipTasks` → `mergeOpenPRsAndPull` (merge loop → `git pull origin <base>`).
  - `--ship` no-merge path: `shipTasks` → `assertLocalBaseInSyncWithOrigin` (fetch → `pull --ff-only`).
  - post-merge-sync: fetch → ff `pull --ff-only`, or the reset path (dirty guard → untracked-clobber guard → `reset --hard`).
  - Existing code that already does part of the work: `assertRepoRootCleanBeforeFirstWorktree` already allows untracked `tasks/`. `isPipelineOwnedPath`, `humanReviewAllowedPath`, `buildHumanReviewStagePaths` and `verifyBaseDriftFromData` (validation.ts:1616) already exempt `tasks/<id>/` paths by prefix, whether tracked or untracked. `commitQaArtifacts` already runs `git add -A -- tasks/<id>`, which picks up untracked files and respects `.gitignore`. So the QA-end commit carries the scaffold with no change (AC-6 is test-only).
- **Callers:**
  - `ensureBranch`: implement.ts only.
  - `mergeOpenPRsAndPull` and `assertLocalBaseInSyncWithOrigin`: `shipTasks` only.
  - `getUnpushedBaseCommits` stays and keeps one caller, `verifyBaseDivergence` (validation.ts:1791).
  - `TASK_ARTIFACT_FILES`: implement.ts only, so delete it.
  - `taskDirForRepoRoot` in git.ts: only the deleted function, so drop the import.
  - `splitGit.classifySafeToPushCommit` / `splitGit.getUnpushedBaseCommits` in main.ts: only the deleted function.
  - `tests/recovery-hints.test.ts` (`HINT_PATTERN`): no line this plan edits or deletes matches it, so the registry needs no change.
- **Tests that can fail:** each new regression test below names the state that drives it through the changed path. AC-7(a–d), AC-8 and the AC-11 success case fail on today's code with git's "untracked working tree files would be overwritten" refusal. They fail only because the fake `gh pr merge` performs a real squash on origin and REPO_ROOT holds an untracked copy of the merged paths.
- **Predicates:**
  - Copy runs when `<worktree>/tasks/<id>/status.json` is absent: `ENOENT` means copy; any other `lstat` error dies.
  - An empty `ls-files` list, or one without `status.json`, dies.
  - Collision set = untracked ∩ incoming ∖ HEAD. An empty input gives a no-op; any probe failure fails closed. Paths use `-z` throughout.
  - The branch-only guard arms only for `worktree: false`, no override, and `REPO_ROOT/tasks/<id>/status.json` absent after the base checkout.
- **Scope:** every file below is in the spec's Affected Files. Two contradictions are recorded in Open Questions: `src/cli/index.ts` and `src/orchestrator/cli.ts` help text stays unchanged, and `tests/recovery-hints.test.ts` is untouched.
- **Async/stateful:**
  - Re-entry: the copy is idempotent (status.json-last marker, never overwrite), and clearing is idempotent.
  - Interruption: an interrupted copy resumes (AC-4c). Clearing that fails partway reports what it removed and dies.
  - Stale state: the REPO_ROOT copy stays a backup until a pull clears it.
  - Ownership: clearing is keyed on the incoming tree, not task IDs.
  - The branch-only exit hook is process-local and disarmed explicitly; it does not cross a phase boundary.

## Steps

### Step 1: Red-first ship and post-merge-sync tests (before any `main.ts` / `task/index.ts` change)

Files: `tests/run-task-ship.test.ts`, `tests/task-cli.test.ts`

**1a. Make the fake `gh pr merge` squash for real.** In `setupFakeTools`'s `pr merge` branch, add two opt-ins and leave current behavior as the default:
```sh
if [ "${FAKE_GH_MERGE_FAIL:-0}" = "1" ]; then echo "simulated merge failure" >&2; exit 1; fi
if [ -n "${FAKE_GH_SQUASH_ORIGIN:-}" ]; then
  read_state
  head="${STATE_HEAD:-${FAKE_GH_PR_HEAD:-}}"
  tmp="$(mktemp -d)"
  git clone -q "$FAKE_GH_SQUASH_ORIGIN" "$tmp/c"
  git -C "$tmp/c" config user.email test@example.com; git -C "$tmp/c" config user.name "Test User"
  git -C "$tmp/c" checkout -q "${FAKE_GH_SQUASH_BASE:-main}"
  git -C "$tmp/c" merge -q --squash "origin/$head"
  git -C "$tmp/c" commit -qm "squash $head"
  git -C "$tmp/c" push -q origin "HEAD:${FAKE_GH_SQUASH_BASE:-main}"
  rm -rf "$tmp"
fi
```
Run the existing state-file update (`MERGED`) only when the merge did not fail. With `FAKE_GH_MERGE_FAIL=1` the state stays `OPEN`, so `isPRMerged` → `gh pr view --json state` → `OPEN` → `classifyMergeOutcome` = `fail` → `die`.

**1b. AC-7 fixtures.** Add a helper, `prepareStaleCopyShipFixture(dir, taskIds, { worktree })`. Build on `makeGitFixture` (it already writes canon's runtime ignore block; add `.canon/worktrees/` from `CANON_RUNTIME_GITIGNORE_PATTERNS` too). It should produce this state:
- `task/<leader>` is created through `git worktree add <localDir>/.canon/worktrees/<leader> -b task/<leader> main`, following `prepareSharedWorktreeShipFixture`.
- The worktree holds the "merged" task files (`writeTaskFiles` with `worktree: true` and `branch` set, plus a distinguishing `done.md` line). They are committed and pushed.
- REPO_ROOT holds an **untracked** stale copy of each member's `tasks/<id>/` (different `done.md` content, `branch: ''`) plus one gitignored runtime file (`.heartbeat.json`).
- The open PR is set via `FAKE_GH_PR_STATE_FILE` (`<n>|<url>|main|task/<leader>|OPEN`) or the `FAKE_GH_OPEN_PR_NUMBER` / `FAKE_GH_PR_HEAD` / `FAKE_GH_PR_BASE` envs, with `FAKE_GH_SQUASH_ORIGIN=<originDir>`. Merge proof uses `FAKE_GH_HEAD_REF_OID=<tip>` and `FAKE_GH_BASE_REF_NAME=main`, as in the `--ship merges without gh --delete-branch` test.

Cases:
- **(a)** single worktree task.
- **(b)** 2-task bundle.
- **(c)** no-PR path: squash the branch into origin from a second clone (`git merge --squash origin/task/<id>` + push, mirroring `simulateMergeOnOrigin`). Delete the remote branch; no open PR. Proof via `FAKE_GH_MERGED_PR_NUMBER` + `FAKE_GH_HEAD_REF_OID`, as in `--ship legacy fallback proves merged PR by ancestor-or-equal head`.
- **(d)** task A squash-merged on origin but not shipped (stale untracked REPO_ROOT copy), task B shipped through the merge path, task C with only an untracked REPO_ROOT copy and never merged.
- **(e)** `tasks/<id>/` committed on local `main` and pushed (legacy scaffold shape).
- **(f)** `FAKE_GH_MERGE_FAIL=1`.

Assertions per AC-7:
- (a)/(b)/(d): `status === 0`. `tasks/_archive/<id>/done.md` equals the **merged** content. `tasks/_archive/<id>/.heartbeat.json` exists, because the gitignored file survives and the archive `renameSync` carries it. stdout lists each removed `tasks/<id>/…` path.
- (c): `status === 0` and the archive holds the merged content.
- (d): A's REPO_ROOT files now equal origin's tracked content (cleared, then restored by the pull). C's untracked files are byte-identical and still untracked.
- (e): `status === 0` and stdout has no removal lines.
- (f): `status !== 0`, and every REPO_ROOT `tasks/<id>/` file (including the stale ones) is still present.

**1c. AC-11 non-worktree fixtures.** Use `prepareShipFixture` (already `worktree: false`, artifacts committed on `task/<id>`, base lacking them) with `mergeToOrigin: false` and `deleteRemote: false`. Give it an open PR plus `FAKE_GH_SQUASH_ORIGIN`.
- Success case: ship completes and `tasks/_archive/<id>/` matches the squashed content.
- Abort case: `FAKE_GH_MERGE_FAIL=1` makes ship die between the base checkout and the pull. Assert stderr names `task/<id>` and the restore command. Then **run the printed command** (`git checkout task/<id>`) and assert `tasks/<id>/status.json` is back. This follows the repo's "pin every recovery hint to a test that runs it" convention (`tests/recovery-hints.test.ts`).

**1d. AC-8.** In `tests/task-cli.test.ts`, next to the existing post-merge-sync fixtures:
- Fast-forward case: create a bare origin plus a `work` clone. A second clone pushes a commit adding `tasks/merged-task/{spec.md,status.json}`. `work` holds an untracked stale `tasks/merged-task/spec.md` (different content) and an untracked `tasks/unmerged-task/spec.md`. `withCwd(work, () => taskPostMergeSync())` succeeds. `merged-task/spec.md` equals origin's content and is tracked. `unmerged-task/spec.md` is untouched. Captured stdout names the removed path.
- Reset-path case, recommended and cheap: the same setup plus one local telemetry-only commit on `main`. The pre-change code throws the "local files … match paths tracked" error; the new code syncs.

Run these tests now against unchanged `src/` and record each failure (expected/received or the git refusal line) in the handoff's red-first evidence. Cases (e), (f) and the AC-11 abort-message case are exempt from red-first, per AC-7. Two of them are already expected to fail before Step 6, for a different reason: the AC-11 abort assertion fails because the message doesn't exist yet. Record it as such.

### Step 2: Delete base-commit machinery in `git.ts`; add the scaffold copy

Files: `src/orchestrator/git.ts`

Delete:
- `commitTaskArtifactsToBase` (whole function, including the telemetry absorb);
- `CANON_TASK_ID_PATTERN`, `SCAFFOLD_ARTIFACTS_SUBJECT` and `SCAFFOLD_TELEMETRY_SUBJECT`;
- `isScaffoldCommitSubject`, `SafeToPushVerdict`, `classifySafeToPushCommitFromData`, `classifySafeToPushCommit` and `hasUnpushedScaffoldCommits`.

Drop `taskDirForRepoRoot` from the `./state.js` import. Keep `getUnpushedBaseCommits`, `filterStageablePaths` and `PIPELINE_TELEMETRY_FILES` (still used by `isPipelineOwnedDirtyPath`).

Add a pure planner (unit-testable) and the copy helper beside `ensureBranch`:

```ts
/** Orders a task's trackable paths for copying: status.json last, because its presence marks a complete copy. */
export function planTaskScaffoldCopy(taskId: string, listedPaths: readonly string[]): string[] {
    const statusPath = `tasks/${taskId}/status.json`;
    if (!listedPaths.includes(statusPath)) throw new Error(...);   // caller dies
    return [...listedPaths.filter(p => p !== statusPath).sort(), statusPath];
}

/** Copies each member's git-trackable REPO_ROOT tasks/<id>/ files into `worktreeRoot`
 *  when that worktree has no tasks/<id>/status.json. Never overwrites a destination file. */
export function copyTaskScaffoldIntoWorktree(taskIds: readonly string[], worktreeRoot: string): void
```

Mechanics:
- Return immediately when `process.env.CANON_TASKS_DIR_OVERRIDE` is set (spec: nothing to copy).
- Iterate **secondaries first, leader last** (`[...taskIds.slice(1), taskIds[0]]`), matching the branch loop. The leader's worktree `status.json` is what `resolveTaskCwd`'s direct-path check keys on (state.ts `resolveTaskCwd`).
- Per member, probe `<worktreeRoot>/tasks/<id>/status.json` with `fs.lstatSync`. If it exists, skip the member. On `ENOENT`, copy. On any other error, `die` (fail closed).
- List the source set with `gitSafeAtRaw(REPO_ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', `tasks/${id}`)`. Use the literal REPO_ROOT `tasks/` path, not `taskDirForRepoRoot`: the override is already handled. Split on `\0` and drop empties. A non-ok result dies with git's stderr. Pass the list through `planTaskScaffoldCopy`, which dies when `status.json` is not trackable.
- For each path: `fs.mkdirSync(path.dirname(dst), { recursive: true })`, then `fs.copyFileSync(src, dst, fs.constants.COPYFILE_EXCL)`. `EEXIST` means skip (never clobber, AC-4c). Source `ENOENT` (an index entry deleted on disk) means skip. Any other error dies, naming the path.
- Print one `info` line per member: `Copied N task file(s) for <id> into the worktree (untracked).`

Wire it into `ensureBranch`:
- **First-creation path:** call `copyTaskScaffoldIntoWorktree(taskIds, leaderWorktree)` right after `ensureWorktree(...)` returns and **before** the branch-recording loop. The loop is unchanged; it already writes to explicit worktree paths. Keep the start point exactly `ensureWorktree(taskIds[0], branchName, baseBranch)`: local base, no fetch (AC-3).
- **Recorded-branch path (`useWorktree` branch):** capture the return value: `const wt = ensureWorktree(taskIds[0], primaryStatus.branch); copyTaskScaffoldIntoWorktree(taskIds, wt);`. It is normally a no-op because the status.json is present. It covers a worktree that resolved through a REPO_ROOT branch record but lacks a member's copy.
- **Non-worktree path:** no change. The untracked `tasks/<id>/` survives `git checkout -b` (AC-5).

Update the first-creation comment: the worktree no longer "inherits" the scaffold through the checkout; it receives an untracked one-time copy.

### Step 3: Shared collision-set clearing helper

Files: `src/orchestrator/git.ts`

```ts
/** Untracked, non-ignored paths that `incoming` tracks and HEAD does not. Pure seam. */
export function findIncomingCollisionsFromData(input: {
    untracked: readonly string[]; incomingTracked: readonly string[]; headTracked: readonly string[];
}): string[]   // sorted; exact-path intersection

export type ClearIncomingCollisionsResult =
    | { ok: true; removed: string[] }
    | { ok: false; removed: string[]; stderr: string };

/** Deletes untracked tasks/ files that a pull of `incomingRef` would refuse to overwrite. Fails closed on any probe error. */
export function clearIncomingTaskCollisions(cwd: string, incomingRef: string): ClearIncomingCollisionsResult
```

Probes, all with `gitSafeAtRaw(cwd, …)` and `-z`:
- `ls-files -z --others --exclude-standard -- tasks/`
- `ls-tree -r -z --name-only <incomingRef> -- tasks/`
- `ls-tree -r -z --name-only HEAD -- tasks/`

Any non-ok result returns `{ ok: false, removed: [] }` before anything is deleted. Then `fs.rmSync(path.join(cwd, p))` each path in order. On a throw, return `{ ok: false, removed: <so far>, stderr }`. Gitignored runtime files are never listed (`--exclude-standard`), so they survive.

**Scope decision:** the probes are restricted to `tasks/`, following the spec's Implementation Notes. An operator's untracked source file is never deleted. A non-`tasks/` collision still surfaces git's own refusal, as today. Recorded in notes.md.

Callers print one line per removed path: `Removed stale untracked <path> (tracked in <incomingRef>).`

### Step 4: `implement.ts` and `worktree.ts` cleanup

Files: `src/orchestrator/phases/implement.ts`, `src/orchestrator/worktree.ts`

- implement.ts: delete `scaffoldCommitHint`, the explanatory comment block, `primaryStatus`/`worktreeAlreadyCreated`, and the whole `if (!worktreeAlreadyCreated) {…}` block. The phase now calls `ensureBranch(taskIds, { force })` directly. Trim the imports to `getAffectedFiles, getBaseBranch, gitSafeAtRaw, parsePorcelain, ensureBranch` and `getActiveCwd`. Drop `info` if it is no longer used; it is still used by `info(\`Phase: …\`)`, so keep it.
- worktree.ts: delete `TASK_ARTIFACT_FILES`.

### Step 5: Full-send tail, banner, and the no-merge pull path (`main.ts`)

Files: `src/orchestrator/main.ts`, `src/orchestrator/state.ts`

- Delete `pushScaffoldBaseCommitsForFullSend` and its call in the full-send tail. The tail goes straight to `commitHumanReviewFiles(taskIds, cwd, true)`, whose base-divergence gate stops on an unpushed operator commit (AC-10).
- `formatCompleteStateBanner` `unpushed` case: replace the parenthetical with explicit remove-then-merge steps. Do not hard-code one task, so it renders for every task in `taskIds`. For example:
  ```
    Next:    `canon run <ids> --pr` to push and open a draft PR.
             No-PR flow, from the main checkout on <base>:
               1. git clean -f -- tasks/<id>      (one per task: removes the stale untracked copy; ignored runtime files stay)
               2. git merge <branch>  then  git push origin <base>
               3. canon run <ids> --ship
  ```
  `git clean -f -- <pathspec>` recurses into untracked directories when a pathspec is given and leaves ignored files alone without `-x`. Verified during planning on git 2.55: it removed `tasks/x/spec.md` and `tasks/x/sub/` and kept the ignored `tasks/x/.heartbeat.json`. The AC-9 real-git test below still pins this behavior.
- `assertLocalBaseInSyncWithOrigin`:
  - Fetch-failure warning: replace `verify locally with git pull --rebase origin <base>` with `re-run canon run <ids> --ship when origin is reachable, or run canon task post-merge-sync`. Give the function a `taskIds` parameter so it can render `<ids>`; it has one caller.
  - Diverged `die`: keep the rebase advice, and add that `canon task post-merge-sync` handles the telemetry/task-only divergence case.
  - Immediately before `git('pull', '--ff-only', …)`, call `clearIncomingTaskCollisions(REPO_ROOT, \`origin/${baseBranch}\`)`. Print the removed paths. On `!ok`, `die` with `--ship aborted: could not clear stale task copies before fast-forwarding <base>: <stderr>`, naming any paths already removed.
- `state.ts`: in the `taskDirForRepoRoot` comment, drop `commitTaskArtifactsToBase (scaffold-to-base commit)` from the caller list.

### Step 6: Ship merge path split and the non-worktree window (`main.ts`)

Files: `src/orchestrator/main.ts`

- **`mergeOpenPRsAndPull`:** keep the merge loop unchanged. Replace the tail `if (anyMerged) { pull }` with:
  1. `gitSafe('fetch', 'origin', baseBranch)`. On failure, `die` with: the PR merge already landed; fix connectivity and re-run `canon run <ids> --ship`, which resumes on the already-merged path.
  2. `clearIncomingTaskCollisions(REPO_ROOT, \`origin/${baseBranch}\`)`. Print removed paths. On `!ok`, die with the same "merge already landed" re-run guidance.
  3. `git('pull', 'origin', baseBranch)`.

  Clearing runs only after every merge is confirmed. A `die` in the merge loop (AC-7f) returns before step 1, so nothing is deleted. Update the function's doc comment (merge → clear → pull).
- **Non-worktree window (AC-11):** in `shipTasks`, right after the `git checkout baseBranch` block (~:2563–2573):
  - Compute `branchOnlyTaskIds` = tasks with `!taskSnapshot(id).worktree`, no `CANON_TASKS_DIR_OVERRIDE`, and `!fs.existsSync(path.join(REPO_ROOT, 'tasks', id, 'status.json'))`.
  - If non-empty, build the message once with an exported pure builder, `formatBranchOnlyTaskFilesHint(taskIds, branchByTaskId)`. For example: `tasks/<id>/ is not in this checkout: until --ship pulls the merged <base>, it exists only on <branch>. To get it back: git checkout <branch>. Fix the error above, then re-run canon run <ids> --ship.` One line per task; bundle members share a branch.
  - Arm it with `const onExit = () => console.error(hint); process.on('exit', onExit);`.
  - After the merge/sync block (after the `if (!merged) {…}` block ends, ~:2627), re-check that every `branchOnlyTaskIds` status.json exists. If any is still missing, `die(hint)`; this window covers the "pull never ran" case. Otherwise call `process.off('exit', onExit)`.

  `die()` calls `process.exit(1)` (cli.ts:97), so the hook fires on every abort in the window, including `git()` throws that reach the top-level handler. Do **not** suggest `git checkout <branch> -- tasks/<id>` in the hint: it would stage the files onto base.
- Keep the `orphanedStatusPaths` `git checkout HEAD -- …` step unchanged. It is a no-op error on an untracked path; `gitSafe` ignores it.

### Step 7: post-merge-sync (`src/task/index.ts`)

Files: `src/task/index.ts`

- Import `clearIncomingTaskCollisions` from `../orchestrator/git.js` (already imported from there, so no cycle).
- Add a local `clearStaleTaskCopies(targetBranch)` that calls the helper with `process.cwd()` and `origin/${targetBranch}`. It logs `→ Removed stale untracked <path> (tracked in origin/<branch>).` per path, and on `!ok` throws `Error: could not clear stale task copies before syncing: <stderr>` listing anything removed.
- Fast-forward branch (`ahead === 0 && behind > 0`): call it before `pull --ff-only`.
- Reset branch: call it **after** the dirty-tracked-files refusal and **before** the `ls-files --others` clobber guard, so a refused sync deletes nothing.
- Messages:
  - Replace "only via pipeline telemetry / task-state edits that have been absorbed by squash merges" with wording that doesn't claim canon makes those commits. For example: "only via pipeline telemetry / task-file commits (such as a task scaffold commit from an older canon engine) that the squash merge already carries."
  - Clobber error: "…before re-running `canon task post-merge-sync`."
  - Non-telemetry refusal: "…or rebase manually, then re-run `canon task post-merge-sync`."
  - Don't change `nudgeShippableTasks` (it already names `--ship`).

### Step 8: Prompt template, comments, golden

Files: `src/orchestrator/prompts/templates/qa.md`, `tests/run-task-prompts.golden.json`, `src/cli/commands/watch.ts`, `tests/watch.test.ts`, `tests/run-task-prompts.test.ts`

- `qa.md:85`: replace the line with `- Task artifacts (\`tasks/<id>/\`) → task branch, committed by the orchestrator at QA end; nothing reaches the base branch before the PR merges.`
- Regenerate goldens with `UPDATE_GOLDENS=1 npm test` (`run-task-prompts.test.ts:184`). Diff the golden file and confirm only the `promptQa*` entries changed. `tests/run-task-prompts.test.ts` has no assertion on this line (grep found none), so leave it alone unless a structural assertion fails.
- `watch.ts:19` and `:532`, plus the `tests/watch.test.ts:370` comment: replace "scaffold commit, telemetry absorption" with "scaffold copy into the worktree". Comments only.
- `src/orchestrator/prompts/templates/implement-reroute.md`: **no change**. "REPO_ROOT's copy is the pre-implement scaffold and does NOT contain operator amendments" is still accurate, and editing it would churn goldens.

### Step 9: Docs, skills, README, BACKLOG

Files: `docs/pipeline-orchestrator.md` (sync regenerates `templates/docs/pipeline-orchestrator.md`), `docs/patterns.md`, `docs/decisions.md`, `docs/BACKLOG.md`, `README.md`, `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-pipeline/recovery.md` (sync regenerates both `templates/.claude/skills/canon-pipeline/` mirrors)

`docs/pipeline-orchestrator.md`:
- `--full-send` row (:100): drop the base-push sentence. The tail never pushes the base branch; an unpushed local-base commit stops it at the divergence gate unless `--allow-divergent-base` is set.
- `--ship` row (:97): "pull the base" becomes "remove untracked main-checkout copies of task files the merged base now tracks (listing each), pull the base".
- `post-merge-sync` row (:125): add that it first removes untracked `tasks/` files the synced ref tracks, the same as `--ship`.
- Replace the **"Scaffold-to-base before worktree creation"** paragraph (:302) with a **"Scaffold copy into the worktree"** paragraph. Content:
  - Canon makes no base commits before the PR merges.
  - On first implement, the worktree branch is cut from local `<base>`, and each member's git-trackable `tasks/<id>/` files are copied in untracked when the worktree has no `tasks/<id>/status.json`. `status.json` is copied last; existing files are never overwritten; the copy is skipped under `CANON_TASKS_DIR_OVERRIDE`.
  - The files are first committed by the QA-end commit.
  - Non-worktree tasks keep their untracked `tasks/<id>/` across the branch checkout.
- "Task-state source of truth" (:306): "The main repo keeps the pre-implement scaffold" becomes "The main checkout keeps its untracked pre-implement copy as a backup until `--ship` or `canon task post-merge-sync` clears it before pulling the merged base."
- Remote-boundary paragraph (:353): delete the three full-send push sentences ("The full-send tail first pushes…" through "…manual push/merge hint.").
- `--ship` order (:519): rewrite step (4) as "after the merge is confirmed, remove untracked, non-ignored main-checkout files under `tasks/` that the incoming base tracks and the checkout's HEAD does not (each removed path is printed; a failed probe aborts before anything is deleted), then pull or fast-forward the base branch". Add one sentence on non-worktree ships: the base checkout removes `tasks/<id>/` until the pull restores it, and an abort in that window prints how to get it back.
- Add a short note near "Ungated fast-forward" (:525): a plain `git pull` after a GitHub merge can refuse with "untracked working tree files would be overwritten"; use `canon run <id> --ship` or `canon task post-merge-sync` instead.

`docs/patterns.md`:
- Blanket-stash corollary (:130): `tasks/<id>/` is untracked in the worktree until QA-end, so the code_review-time committed range still excludes it. After the QA-end commit (post-QA reroute rounds), `spec.md` is an added file in `<base>...HEAD` alongside plan/handoff/review. This is accepted, and the cold lenses see it.
- Bundle-secondary pitfall (:254): "which inherits every member's `tasks/<id>/status.json` from base" becomes "which receives a one-time untracked copy of every member's `tasks/<id>/` from REPO_ROOT (status.json last)". Keep the rest.

`docs/decisions.md` §"Worktree-canonical task state from implement onward" (:63–69): add a sentence that the scaffold reaches the worktree as a one-time untracked copy, not a base commit, and canon makes no base commits before the PR merges. Remove `commitTaskArtifactsToBase` from the `taskDirForRepoRoot()` list. The file is root-only: **no** `templates/docs/decisions.md` edit (patterns.md "Declare templates/ mirrors…").

`docs/BACKLOG.md`:
- Delete the parked **"Telemetry discrimination gate at scaffold-commit time"** entry (:40–59). Its subject, the absorb commit, no longer exists.
- In "Retire the legacy shared-telemetry safety nets", delete the bullet naming the absorb half (:173), and rewrite the "Likely moots" bullet (:176) to say the absorb commit was removed by no-base-scaffold-commit.
- Leave the size-trajectory entry (:61) alone. It names no deleted symbol.

`README.md:260`: replace "its tail also pushes unpushed base commits that carry only task artifacts and pipeline telemetry, and leaves other unpushed commits to the divergence gate unless `--allow-divergent-base` is set" with "it never pushes the base branch, and an unpushed commit on local base stops it at the divergence gate unless `--allow-divergent-base` is set".

`.claude/skills/canon-pipeline/SKILL.md:84`: in the `--ship` sentence, add "clears stale untracked task-file copies the merged base now tracks, then pulls/fast-forwards…".

`.claude/skills/canon-pipeline/recovery.md`:
- "Local branch diverged…" (:88): change the cause to commits that touch only telemetry or task files, such as scaffold commits from an older canon engine.
- Add a new symptom entry plus its `Symptoms` index line: "`git pull` refuses: untracked working tree files would be overwritten (`tasks/<id>/…`)". Fix: `canon run <id> --ship`, or `canon task post-merge-sync`, both of which remove the stale untracked copies. Without canon: `git clean -f -- tasks/<id>` for the merged tasks only, then pull.
- "Parallel task PRs conflict…" (:99): note that it applies only to tasks bootstrapped by an older engine, whose scaffold commits on base were inherited by sibling branches. New tasks don't carry each other's artifacts.

Leave these unchanged; the AC-13 sweep confirms each is still accurate:
- `docs/architecture.md:128`;
- `docs/codebase-map.md:57` (names only `getUnpushedBaseCommits`, which stays);
- `.claude/skills/canon-status/SKILL.md:23` (the "stale pre-implement scaffold" wording is still accurate).

Then run `npm run sync-templates` and `npm run sync-templates:check`.

### Step 10: Remaining tests in `tests/run-task-safety.test.ts` and `tests/run-task-validation.test.ts`

Files: `tests/run-task-safety.test.ts`, `tests/run-task-validation.test.ts`

**Delete:**
- `safe scaffold push classifier…` (:1360);
- `hasUnpushedScaffoldCommits probes…` (:1372);
- `scaffold hint is absent…` (:1397);
- both `commitTaskArtifactsToBase …` tests (:5267, :5296);
- `main full-send tail pushes an unpushed scaffold tip SHA…` (:6469);
- `full-send tail fails closed on a rejected base push and a commit-list probe error` (:6600);
- `full-send tail pushes the checked tip but not a concurrent operator commit` (:6631).

Also remove the now-unused imports (`classifySafeToPushCommitFromData`, `hasUnpushedScaffoldCommits`, `scaffoldCommitHint`).

**Convert:**
- `setupDivergentBaseRepo` (:1294): change the operator commit's subject to a neutral one (`operator: local base commit`). Its users (:6427, :6453, :6661) stay green (AC-10).
- `setupFullSendTailFixture` (:1311): commit `tasks/` on the **task branch**, not on `main` with a scaffold subject. `addExtraCommit` still runs on `main` before branching.
- Rewrite `full-send tail leaves every unsafe scaffold-looking commit off origin` (:6530) as the AC-10 full-send test, with two cases:
  1. **Clean base**: the tail opens the draft PR and origin's `main` is unchanged.
  2. **One unpushed operator commit on `main`**: the tail exits non-zero with `Base divergence detected`, makes no `pr create`, and origin's `main` is unchanged.

  In both, wrap `git` in `fakeBins` (as the deleted concurrent test did) to log argv, and assert no `push origin main` / `…:refs/heads/main` was issued.
- `nonScaffoldCommits` (:515): drop the subject filter and its comment, and rename it (`commitsSince`). Update the stale "pre-implement scaffold commit" comments in `prepareImplementFixupFixture` (:470, :476); the hook behavior is unchanged.
- `runImplementPhase writes metrics and task artifacts only in the worktree after scaffold commit` (:5328) becomes **AC-1** (single task):
  - Before the run, make `docs/pipeline-invocations.md` dirty in REPO_ROOT (append a line, don't commit).
  - Snapshot `git rev-parse main` and `git rev-list --all` (sorted).
  - After the run: `main` SHA is unchanged, `rev-list --all` set is unchanged (the new `task/<id>` points at an existing commit), stdout has no `git push origin`, the telemetry file is still dirty with the same content, and the REPO_ROOT `tasks/<id>/` files exist and show `??`.
  - Keep the existing worktree-routing assertions, except the old one that `tasks/<id>` is clean in REPO_ROOT: it is now untracked (`??`), so assert that instead.
  - Add the **2-task bundle** variant: `runImplementPhase` with two tasks, `isBundle: true`, both `worktree: true`, same base.
- `ensureBranch records a bundle secondary's branch in the worktree, never main` (:2789): stop committing `tasks/` to base, so it exercises the copy. Keep its assertions. The REPO_ROOT secondary status is unchanged with `branch: ''`, now untracked: assert `git status --porcelain` shows `??` rather than empty.

**Add:**
- **AC-2:** a real-git, no-override bundle bootstrap via `runEnsureBundleBranchInline`. Commit a `.gitignore` with `CANON_RUNTIME_GITIGNORE_PATTERNS`. Put `.canon-pid` and `.heartbeat.json` in each REPO_ROOT task dir, plus `spec.md` and `plan.md`. Assert:
  - every `ls-files --cached --others --exclude-standard -- tasks/<id>` file from REPO_ROOT exists in the leader worktree with identical bytes;
  - each appears as `??` in the worktree's `status --porcelain -uall`;
  - `git diff main...HEAD --name-only` in the worktree is empty;
  - the runtime files are absent from the worktree, except `.heartbeat.json` if `tickAllHeartbeats` wrote a fresh one. To keep this deterministic, assert the absence of `.canon-pid` and that any `.heartbeat.json` content differs from the REPO_ROOT one, or run without an active heartbeat (none is registered in an inline child, so it should simply be absent; verify);
  - each secondary's worktree `status.json` has `branch === task/<leader>`.

  Unit-test `planTaskScaffoldCopy`: status.json last, and it throws without status.json. That is the "leader's status.json written last / status.json copied last" order check; real-git mtime ordering would be flaky.
- **AC-3:** extend `ensureBranch allows first worktree creation when only task artifacts and telemetry are dirty` (:2398, fake git, worktree mode). It already asserts `worktree add -b task/<id> <wt> release/v1`; add `assert.doesNotMatch(log, /^fetch\b/m)` and assert no `origin/release/v1` start point. The non-worktree release-base test (:2296) stays as is.
- **AC-4**, real git, no override (`runEnsureBranchInline`, `CANON_WORKTREES_ROOT` outside the repo):
  - (a) Bootstrap, commit a modified `spec.md` + `status.json` on `task/<id>` in the worktree, `git worktree remove --force`, change the REPO_ROOT `spec.md` to a third content, re-run. The worktree `spec.md` and `status.json` equal the branch versions.
  - (b) Bootstrap, remove the worktree with nothing committed, re-run. The worktree files equal the REPO_ROOT copy, with `branch` recorded.
  - (c) Bootstrap, then in the worktree delete `status.json` and `plan.md` and overwrite `spec.md` with `worktree edit`. Re-run: `plan.md` is restored, `spec.md` is still `worktree edit`, and `status.json` is present with `branch`.
- **AC-5:** a real-git `worktree: false` task. Call `runImplementPhase` twice (pattern of :5328 with `worktree: false`; a fake codex that writes nothing). `git log --all --format=%H -- tasks/<id>` is empty, `git branch --show-current` is `task/<id>`, and `tasks/<id>/` is `??`.
- **AC-6:** bootstrap a worktree task via the copy (no override), add a `.canon/config.json` docs-freshness config the way `writeQaArtifacts` / the :3572 test does, then call `commitQaArtifacts([id], worktree)`. `git ls-tree -r --name-only HEAD -- tasks/<id>` includes `spec.md`, `plan.md` and `status.json`, and `git log main..HEAD -- tasks/<id>` has exactly the QA commit.
- **Collision helper unit tests:**
  - `findIncomingCollisionsFromData`: exact intersection; HEAD-tracked paths excluded; empty inputs.
  - `clearIncomingTaskCollisions` fail-closed: an unresolvable `incomingRef` returns `ok: false`, and the untracked files are untouched (patterns.md "Write-safety guards must fail closed").
- **AC-9 banner:** update `formatCompleteStateBanner renders the unpushed state…` (:5474) to assert the `git clean -f -- tasks/<id>` line, the merge/push step and the `--ship` step, matching each as one phrase. Add a real-git check that runs the printed steps on a fixture: a REPO_ROOT stale untracked copy of an artifact the branch tracks. A local `git merge <branch>` is refused before the `git clean` and succeeds after it.

`tests/run-task-validation.test.ts:2393,2404`: replace the subject `task(example): commit artifacts pre-pipeline` with a neutral subject in both the commit and the expected data.

### Step 11: Build and validate; write the handoff

Run `npm run build` (this rebuilds `dist/orchestrator/run-task.js` and `dist/cli/index.js`), then:
- `npm run type-check`
- `npm run lint`
- `npm test`
- `npm run sync-templates:check`
- `npm run docs-refs-check`
- the AC-12 grep exactly as written in the spec (expect zero hits)

In the handoff:
- **Red-first evidence:** the Step 1 failures (git refusal lines and test names), each red-to-green.
- **AC-13 sweep:** the full `git grep -niE 'scaffold|pre-implement|pushes unpushed base' -- docs templates .claude src README.md` hit list with a disposition per hit (accurate or unrelated), covering `/canon-init` "scaffold docs", `rescaffoldReview`, `scaffold-paths.ts`, init/upgrade "scaffolded", the canon-status and implement-reroute "pre-implement scaffold" wording, and the `docs/task-quality-log.md` history rows.
- **Changes table:** list every `templates/` mirror the sync touched alongside its root file, and both `dist/` bundles.

## Open Questions / Recorded Decisions

- **Clearing scope is `tasks/` only.** The spec's Decision defines the collision set without a path limit; its Implementation Notes scope it with `-- tasks/`. The plan follows the notes, so canon never deletes an untracked non-task file. A non-`tasks/` collision keeps git's own refusal. Recorded in notes.md.
- **Help text not updated (contradiction, not resolved by widening scope).** `src/cli/index.ts:102` and `src/orchestrator/cli.ts:146` describe `--ship` as "… archive the task dir, and pull the base branch". They don't mention the scaffold or the full-send push, and are not in Affected Files. The order wording was already loose before this task. Left as is; recorded in notes.md.
- **AC-11 abort message mechanism.** The abort can come from any `die()` or a `git()` throw inside helpers in the window, so the plan uses a scoped `process.on('exit')` hook, armed after the base checkout and disarmed once the files are back. A post-block re-check covers the "pull never ran" case. The hint deliberately says `git checkout <branch>`, not `git checkout <branch> -- tasks/<id>`, which would stage the files onto base.
- **Merge-path fetch.** `mergeOpenPRsAndPull` adds an explicit `git fetch origin <base>`, so the collision set is computed against the post-merge `origin/<base>` and not a stale tracking ref. A fetch failure dies after the merge, with "re-run `--ship`" guidance; the re-run takes the already-merged path, which runs the same clearing.
- **`tests/recovery-hints.test.ts`** is not in Affected Files and needs no change: no edited or deleted line matches its `HINT_PATTERN`. If its registry test fails anyway, record it as a deviation in the handoff; don't silently widen scope.
