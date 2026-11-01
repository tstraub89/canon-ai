# Spec: no-base-scaffold-commit — Keep canon's pre-merge commits off the base branch

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

On the first `implement` call, `commitTaskArtifactsToBase` (`src/orchestrator/git.ts`) commits `tasks/<id>/` to whatever REPO_ROOT has checked out — the local base branch for worktree tasks — as `task(<id>): commit artifacts pre-pipeline`. When any `PIPELINE_TELEMETRY_FILES` entry is dirty, a sibling `chore: absorb pre-implement telemetry into scaffold for <ids>` commit follows. `ensureBranch` then cuts `task/<id>` from local base so the new worktree inherits the scaffold through its checkout.

The commit exists only to get the task's artifacts into the worktree, and it costs three things:

1. **It blocks `--pr` / `--push`.** The base-divergence gate (`verifyBaseDivergence`) sees the unpushed scaffold commit on local base and stops with `Fix: git push origin <base>`. The operator pushes canon's own bookkeeping by hand, every task.
2. **Full-send carries a special-case workaround.** `pushScaffoldBaseCommitsForFullSend` (`src/orchestrator/main.ts`) pushes base before the PR gates. It lists unpushed commits with `getUnpushedBaseCommits` and vets each with `classifySafeToPushCommit` (`classifySafeToPushCommitFromData`, `isScaffoldCommitSubject`, the `SCAFFOLD_*_SUBJECT` regexes in `src/orchestrator/git.ts`). Separately, `implement` prints a push hint (`scaffoldCommitHint`) gated on `hasUnpushedScaffoldCommits`. All of this exists only because canon writes to base.
3. **It assumes base accepts direct pushes.** In a repo where every commit to base must come through a PR, the scaffold commit cannot be pushed at all.

Canon already treats the worktree as the source of truth for `tasks/<id>/` from implement onward (`docs/decisions.md` §"Worktree-canonical task state from implement onward"). After the worktree exists, nothing reads the base copy.

The telemetry-absorb commit has no remaining producer worth preserving. Current engines write per-task fragments (`metrics.md`, `quality-log.md`, `lessons.md`), so the shared logs get dirty only from manual edits or from `--ship`'s deliberate preservation of pure-append dirt. The human has confirmed there are no legacy in-flight tasks left to absorb for.

Git behavior this spec relies on, verified on git 2.55 in a throwaway repo: when REPO_ROOT holds an untracked `tasks/x/spec.md` and `git pull` brings in a commit that adds the same path, the pull aborts with "untracked working tree files would be overwritten by merge … Please move or remove them before you merge" — **even when the untracked file's content is byte-identical** to the incoming one. The same refusal applies to a local `git merge` and to `git pull --ff-only`.

## Decision

Canon makes no commits to the base branch before a task's PR merges. The scaffold travels to the worktree as **untracked files** and reaches base through the PR.

- **Bootstrap (worktree tasks).** `commitTaskArtifactsToBase` and the telemetry-absorb commit are deleted. In `ensureBranch`, for every path that attaches a worktree (first creation and re-attach for a recorded branch), each bundle member's git-trackable `tasks/<id>/` files are copied from the **real REPO_ROOT task directory** into the worktree **only when the worktree has no `tasks/<id>/status.json`**. The copy:
  - never overwrites an existing destination file;
  - copies `status.json` **last**, so its presence marks a completed copy;
  - completes for every member before the branch-recording loop, whose order (secondaries first, leader last) is unchanged;
  - is skipped when `CANON_TASKS_DIR_OVERRIDE` is set (task state then lives outside both checkouts, so there is nothing to copy).

  The branch is still cut from **local** base, as today. The REPO_ROOT copy stays in place as the pre-implement backup.
- **Bootstrap (non-worktree tasks).** No copy and no commit; the untracked `tasks/<id>/` stays in place across `git checkout -b task/<id>`.
- **Commit point.** Task artifacts are first committed by the existing QA-end commit (`commitQaArtifacts`), exactly as later artifact edits are today. Up to the first QA-end commit, every diff consumer of `<base>...HEAD` sees the same committed range as today. After it (post-QA `--reroute` rounds), `spec.md` appears in that range as an added file alongside the plan/handoff/review files that already appear today — accepted; see Known Risks.
- **Full-send.** Its base-push step and the safe-to-push classifier are deleted. The base-divergence gate stays as the guard for operator commits on base.
- **Clearing stale copies before a pull.** One shared helper computes the **collision set**: untracked, non-ignored REPO_ROOT paths that the incoming ref (`origin/<base>` after a fetch, or the post-merge-sync target) tracks and REPO_ROOT's HEAD does not. It deletes exactly those files and prints each removed path. It fails closed if any probe errors. It is keyed on the incoming tree, not on task IDs, so it also clears other merged-but-unshipped tasks' stale copies and never touches an unmerged task's copy.
  - `--ship` runs it **after the merge is confirmed and immediately before the pull**, in both pull paths: the merge path (`mergeOpenPRsAndPull`, which splits merge from pull for this) and the already-merged path (`assertLocalBaseInSyncWithOrigin`'s fast-forward). A ship that aborts before or during the merge deletes nothing.
  - `canon task post-merge-sync` runs it before its fast-forward and before its untracked-clobber guard, against the ref it syncs to.
- **Non-worktree ship.** For a `worktree: false` task, `--ship`'s checkout of base removes the now-branch-only `tasks/<id>/` from REPO_ROOT until the pull restores it. Ship must still complete end to end. Any abort between that checkout and the pull must tell the operator the task files are on `task/<id>` and how to restore them.
- **Operator hints.** Every post-merge message that tells the operator to pull or merge base by hand states what to do about the stale copy:
  - pull and fast-forward guidance names `canon run <id> --ship` or `canon task post-merge-sync`;
  - the no-PR banner's "merge to base manually" path prints explicit steps that remove the task's untracked `tasks/<id>/` files from the main checkout before merging, because a local merge hits the same refusal and `--ship` cannot run until the merge is on origin.

## Non-Goals

- **The `--ship` `chore: archive` commit and push to base.** Unchanged. Lazy archiving on a later PR is a possible follow-up, not this task.
- **Cutting task branches from `origin/<base>`** or introducing a recorded task-base ref. Every diff consumer keeps using local `<base>`. Pinned by AC-3.
- **Changing the base-divergence or base-drift gates.** `verifyBaseDivergence`, `verifyBaseDivergenceFromData`, `getUnpushedBaseCommits`, `verifyBaseDrift` and `--allow-divergent-base` keep their behavior. Pinned by AC-10.
- **Moving the scaffold, or deleting the REPO_ROOT copy, at bootstrap.** The REPO_ROOT copy is the backup until the pull clears it. Pinned by AC-1.
- **Excluding task artifacts from the cold lenses' diff on post-QA reroutes.**
- **A new canon command for clearing stale copies.** The no-PR path gets printed steps only.
- **Making a plain `git pull` work after a GitHub merge.** Hints only (AC-9).
- **Migrating in-flight tasks.** A task whose worktree already exists has its `status.json` there, so the copy is a no-op. A task whose scaffold commit already sits on local base ships as before. The `git checkout HEAD -- tasks/<id>/status.json` step in `shipTasks` is kept for those tasks (a no-op when the path is untracked).
- **Committing task artifacts earlier than QA-end**, or adding per-phase artifact commits.
- **Rewriting CHANGELOG history.** Release notes are a release-time step.

## Acceptance Criteria

- [ ] **AC-1: No base commits at bootstrap.** Fixture: real git, no `CANON_TASKS_DIR_OVERRIDE`, and a dirty `PIPELINE_TELEMETRY_FILES` entry in REPO_ROOT. After the first `implement` bootstrap of a worktree task, local base's HEAD SHA is unchanged and no commit was created on any branch. Run the case for a single task and for a 2-task bundle. The REPO_ROOT `tasks/<id>/` files are still present and untracked, and the telemetry file is still dirty and uncommitted in REPO_ROOT.
- [ ] **AC-2: Scaffold reaches the worktree untracked.** Fixture: real git, no override, and a `.gitignore` carrying canon's `tasks/**` runtime-file block. After bootstrap:
  - every member's `git ls-files --cached --others --exclude-standard -- tasks/<id>` files from REPO_ROOT exist in the leader worktree with identical content;
  - they show as `??` in the worktree's `git status --porcelain -uall`;
  - `<base>...HEAD` in the worktree is empty;
  - gitignored runtime files in the REPO_ROOT task dir (`.canon-pid`, `.heartbeat.json`) are **not** copied;
  - each secondary's worktree `status.json` records `branch`, and the leader's is written last.
- [ ] **AC-3: Branch start point unchanged.** In **worktree mode**, the task branch is created from local `<base>` (the value `getBaseBranch` returns), not from `origin/<base>`, and bootstrap runs no `git fetch`. Verify with a worktree-mode test asserting the start point passed to `git worktree add -b` and the absence of a fetch. The existing non-worktree test (`ensureBranch creates a task branch from the declared release base, not main`) stays green.
- [ ] **AC-4: Copy never clobbers and is resumable.** Real-git, no override. Cases:
  - **(a) Committed branch.** Commit a modified `tasks/<id>/spec.md` and `status.json` on `task/<id>`, remove the worktree, keep a different stale REPO_ROOT copy, then re-run bootstrap. The worktree files equal the branch versions.
  - **(b) Torn down before QA.** Remove the worktree when `tasks/<id>/` was never committed to the branch. The REPO_ROOT copy is restored.
  - **(c) Interrupted copy.** Leave a worktree holding some task files but no `status.json`. Re-running copies the missing files without overwriting the present ones, and writes `status.json` last.
- [ ] **AC-5: Non-worktree tasks never commit artifacts before QA-end.** For a `worktree: false` task, across two consecutive `implement` invocations, no commit touches `tasks/<id>/` on either base or `task/<id>`. `tasks/<id>/` remains untracked in REPO_ROOT on `task/<id>`. Real-git fixture.
- [ ] **AC-6: QA-end commit carries the scaffold.** After `commitQaArtifacts` in worktree mode, `git ls-tree -r --name-only HEAD -- tasks/<id>` on the task branch includes `spec.md`, `plan.md` and `status.json`, all untracked until then. Fixture test through the existing QA-end commit path.
- [ ] **AC-7: Ship clears exactly the collision set, after the merge.** Real-git `--ship` tests in which the fake `gh pr merge` performs an actual squash-merge onto origin. REPO_ROOT holds an untracked stale `tasks/<id>/` that includes one gitignored runtime file. Each case except (e) and (f) must fail on the pre-change code with the "untracked working tree files would be overwritten" refusal (red-first; record it in the handoff).
  - **(a) Single worktree task.** Ship completes, the archive holds the **merged** content, the gitignored file survives, and stdout lists each removed path.
  - **(b) 2-task bundle.** The same assertions hold for both members.
  - **(c) No-PR path.** The task branch is merged into origin's base from a second clone, and `--ship` takes the `assertLocalBaseInSyncWithOrigin` fast-forward. Ship completes.
  - **(d) Another merged-but-unshipped task.** Task A was merged on origin but not shipped, while task B is shipped. B's ship completes, clears A's colliding stale files, and leaves an unmerged third task's untracked REPO_ROOT copy untouched.
  - **(e) Already tracked.** When `tasks/<id>/` is already tracked at REPO_ROOT HEAD, nothing is removed.
  - **(f) Merge fails.** When the fake `gh pr merge` exits non-zero and the merge is not confirmed, ship aborts and every REPO_ROOT `tasks/<id>/` file is still present.
- [ ] **AC-8: post-merge-sync clears the same way.** `canon task post-merge-sync` uses the same helper before both its fast-forward and its reset-path untracked-clobber guard. A REPO_ROOT holding a stale untracked copy of a merged task syncs without the refusal, and an unmerged task's untracked copy is untouched. Verify with a `tests/task-cli.test.ts` fixture covering the fast-forward path.
- [ ] **AC-9: Hints name a step that works.** All of the following name `--ship` or `canon task post-merge-sync`, or give remove-then-merge steps, as the Decision's operator-hints bullet specifies:
  - the no-PR banner (`unpushed` state) in `src/orchestrator/main.ts`;
  - the `assertLocalBaseInSyncWithOrigin` pull guidance;
  - the post-merge-sync messages in `src/task/index.ts`.

  A test asserts the no-PR banner text in the state that emits it.
- [ ] **AC-10: Divergence gate still guards operator commits.** An operator commit on local base (non-canon subject) still blocks `--pr` with the existing `verifyBaseDivergenceFromData` message, and `--allow-divergent-base` still bypasses it. In full-send mode, the tail issues no `push origin <base>` and stops at the same gate when an operator commit is unpushed. Add a test for the full-send case; existing divergence tests stay green.
- [ ] **AC-11: Non-worktree ship completes.** A real-git `--ship` for a `worktree: false` task, with an actual squash-merge onto origin, archives the merged `tasks/<id>/`. A forced abort between the base checkout and the pull prints the message from the Decision naming `task/<id>` as the files' location.
- [ ] **AC-12: Deleted machinery is gone.** `git grep -nE 'commitTaskArtifactsToBase|pushScaffoldBaseCommitsForFullSend|classifySafeToPushCommit|isScaffoldCommitSubject|hasUnpushedScaffoldCommits|SCAFFOLD_ARTIFACTS_SUBJECT|SCAFFOLD_TELEMETRY_SUBJECT|scaffoldCommitHint|commit artifacts pre-pipeline|absorb pre-implement telemetry' -- src tests dist templates docs .claude .canon README.md` returns zero hits. `CHANGELOG.md` and `tasks/` are outside the pathspec, so history stays. The `docs/BACKLOG.md` entries that name these are rewritten or removed so they don't.
- [ ] **AC-13: Restatements match the new flow.** Every doc, skill, prompt template, README section and source comment that describes the scaffold-to-base commit, the telemetry-absorb commit, the full-send base push, or `--ship`'s order is updated. Verification:
  - the AC-12 grep for literal names;
  - a reviewed sweep of `git grep -niE 'scaffold|pre-implement|pushes unpushed base' -- docs templates .claude src README.md`, where each remaining hit is either accurate under the new flow or unrelated (`/canon-init` "scaffold docs", the "pre-pipeline" spec review), with each hit and its disposition listed in the handoff;
  - `npm run sync-templates:check` and `npm run docs-refs-check` pass.
- [ ] **AC-14: Golden prompts regenerated.** The `qa.md` commit-ownership line no longer says the orchestrator commits the scaffold to base. `tests/run-task-prompts.golden.json` is regenerated and `npm test` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/git.ts` | Delete `commitTaskArtifactsToBase` (incl. telemetry absorb), `isScaffoldCommitSubject`, `classifySafeToPushCommitFromData`, `classifySafeToPushCommit`, `hasUnpushedScaffoldCommits`, the `SCAFFOLD_*_SUBJECT` regexes, `SafeToPushVerdict` and any import left unused (e.g. `taskDirForRepoRoot`). `ensureBranch`: copy each member's trackable task files into the worktree when its `status.json` is absent, on both the first-creation and recorded-branch re-attach paths (status.json last, before the branch-write loop, skipped under `CANON_TASKS_DIR_OVERRIDE`). Add the shared collision-set clearing helper here or beside `findUntrackedClobberPaths`. Keep `getUnpushedBaseCommits`. |
| `src/orchestrator/phases/implement.ts` | Remove the `commitTaskArtifactsToBase` call, the `worktreeAlreadyCreated` gate, `scaffoldCommitHint`, and now-unused imports (`TASK_ARTIFACT_FILES`, `hasUnpushedScaffoldCommits`). |
| `src/orchestrator/worktree.ts` | Remove `TASK_ARTIFACT_FILES` if it has no remaining user; host the copy helper here if it fits beside `ensureWorktree`. `ensureWorktree`'s start-point semantics unchanged. |
| `src/orchestrator/main.ts` | Delete `pushScaffoldBaseCommitsForFullSend` and its full-send tail call. `mergeOpenPRsAndPull`: split merge from pull and run the clearing helper between them, after the merge is confirmed. `assertLocalBaseInSyncWithOrigin`: run the helper before its `--ff-only` pull and update its pull guidance. `shipTasks`: non-worktree abort message between base checkout and pull. Update the no-PR banner (`unpushed` state). Keep the `checkout HEAD -- tasks/<id>/status.json` step. |
| `src/orchestrator/state.ts` | Update the `taskDirForRepoRoot` caller-list comment (drop `commitTaskArtifactsToBase`). |
| `src/task/index.ts` | `post-merge-sync`: run the shared clearing helper before the fast-forward and before the untracked-clobber guard; update messages that describe telemetry-only squash absorption. |
| `src/cli/commands/watch.ts` | Comments naming "scaffold commit, telemetry absorption" in the pre-agent window. |
| `src/orchestrator/prompts/templates/qa.md` | Commit-ownership line: the scaffold is no longer committed to base before implement. |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Only if its REPO_ROOT-copy wording becomes inaccurate (still the stale pre-implement copy, now untracked). |
| `tests/run-task-safety.test.ts` | Delete classifier / hint / full-send-push / telemetry-absorb tests and the full-send push cases built on `setupFullSendTailFixture`; update `ensureBranch` and `runImplementPhase` fixtures that commit tasks to base first; add AC-1–AC-5 and AC-10 tests. |
| `tests/run-task-ship.test.ts` | AC-7 and AC-11 real-squash ship fixtures. |
| `tests/task-cli.test.ts` | AC-8 post-merge-sync fixture. |
| `tests/run-task-validation.test.ts` | Replace the deleted scaffold subject in the divergence sample data (lines ~2393, ~2404). |
| `tests/run-task-prompts.test.ts` | Update assertions on the `qa.md` commit-ownership line if any. |
| `tests/run-task-prompts.golden.json` | Regenerate for the `qa.md` change. |
| `tests/watch.test.ts` | Comment only, if it names the scaffold commit. |
| `README.md` | The `--full-send` description (~line 260) no longer says the tail pushes base commits. |
| `docs/pipeline-orchestrator.md` | `--full-send` flag row; rewrite the scaffold-to-base paragraph to the copy model; dirty-guard and "main repo keeps the scaffold" sentences; drop the full-send push sentence from the remote-boundary paragraph; `--ship` order (collision-set clearing after merge, before pull); post-merge-sync row. |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror (sync hook). |
| `docs/patterns.md` | Bundle-secondary pitfall ("inherits every member's status.json from base") and the blanket-stash corollary (cold lenses see `spec.md` on post-QA reroutes), to the copy model. |
| `docs/decisions.md` | Amend "Worktree-canonical task state from implement onward": the scaffold reaches the worktree by an untracked one-time copy, not a base commit; remove `commitTaskArtifactsToBase` from the sanctioned `taskDirForRepoRoot()` list. Root-only, no mirror. |
| `docs/BACKLOG.md` | Rewrite or remove the telemetry-discrimination-gate entry and the absorb-retirement note so they no longer name the deleted symbols (AC-12). |
| `docs/codebase-map.md` | Only if an entry names a deleted symbol or the ship order. |
| `docs/architecture.md` | Only if its ship/push description becomes inaccurate. |
| `.claude/skills/canon-pipeline/SKILL.md` | `--ship` description. |
| `.claude/skills/canon-pipeline/recovery.md` | Diverged-base and parallel-PR recovery entries that assume scaffold commits on base; add the untracked-overwrite refusal as a symptom with its fix. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Generated mirror. |
| `templates/.claude/skills/canon-pipeline/recovery.md` | Generated mirror. |
| `.claude/skills/canon-status/SKILL.md` | Only if the REPO_ROOT-copy wording becomes inaccurate. |
| `templates/.claude/skills/canon-status/SKILL.md` | Generated mirror, only with the row above. |
| `dist/orchestrator/run-task.js` | Rebuilt bundle (`npm run build`). |
| `dist/cli/index.js` | Rebuilt bundle (`npm run build`). |

### Interaction Dependencies

- **Worktree resolver.** `resolveTaskCwd` finds a worktree by `<worktree>/tasks/<id>/status.json`, so the copy must land before any `readStatus`/`writeStatus` for a member. Bundle secondaries still resolve by worktree content (`docs/patterns.md` bundle-secondary pitfall). Their REPO_ROOT `status.json` survives until a pull clears it, so `canon task list`, `canon doctor` and the orphaned-worktree fallback keep working until then.
- **Dirty-tree guards inside the worktree.** Untracked `tasks/<id>/` files in the worktree go through the same task-artifact exemptions modified ones do today: `autoCommitCode` / `findUncoveredTrackedChanges`, the code_review pre-flight, and the QA-end and human_review allowlists (`buildHumanReviewStagePaths`).
- **`assertRepoRootCleanBeforeFirstWorktree`.** Still runs; REPO_ROOT's untracked `tasks/` is already allowed.
- **`--ship` telemetry fold.** `foldTelemetryFragments` reads fragments from REPO_ROOT after the pull. With colliding stale copies cleared first, it reads the merged fragments.
- **Detached `--ship`.** Writes its pid and heartbeat into REPO_ROOT `tasks/<id>/`. Those survive the clearing only because canon's `.gitignore` block ignores them.
- **`commitHumanReviewFiles` (`--pr`/`--push`).** Unchanged; the base-divergence gate no longer fires on canon's own commits.

### Data Model Changes

None. `status.json` schema unchanged.

### Implementation Notes (non-binding; owned by plan/implement)

- Copy set: `git -C <REPO_ROOT> ls-files -z --cached --others --exclude-standard -- tasks/<id>`. Decode `-z`, create directories, skip existing destinations, write `status.json` last.
- Collision set: untracked, non-ignored paths (`ls-files --others --exclude-standard`) intersected with `git ls-tree -r --name-only <incoming> -- tasks/` and absent from `git ls-tree -r --name-only HEAD`. The existing `findUntrackedClobberPaths` (`src/task/index.ts`) computes a similar set and may be generalized. Fail closed on any probe error (patterns.md "Write-safety guards must fail closed").

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`
- [ ] `<E2E>` — N/A; no UI
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

Edited: `docs/pipeline-orchestrator.md`, `docs/patterns.md`, `docs/decisions.md` (see Affected Files). `docs/codebase-map.md` and `docs/architecture.md` may go stale if an entry names a removed symbol or the ship order; each has an "only if" row. `docs/product-context.md`: none expected.

## Known Risks

- **Clobbering evolved artifacts (AC-4).** The first-creation path in `ensureBranch` re-runs whenever a worktree was torn down, because REPO_ROOT status never records `branch`. A copy keyed on "worktree newly created" rather than "status.json absent" would overwrite a branch's committed artifacts with the stale REPO_ROOT copy.
- **Interrupted copy.** If `status.json` were not copied last, an interrupted copy would leave a worktree that looks bootstrapped but lacks `spec.md` or `plan.md`.
- **Override hides the copy.** Under `CANON_TASKS_DIR_OVERRIDE`, source and destination are the same directory. Tests that keep the override pass without exercising the copy, so AC-1, AC-2 and AC-4 must not set it.
- **Uncommitted window grows by the scaffold.** Before the QA-end commit, the worktree's `tasks/<id>/` is entirely untracked. A `git clean`, `git stash -u`, or worktree removal before QA loses it, the same exposure later artifact edits have today. The REPO_ROOT copy remains the backup until a pull clears it.
- **Clearing scope (AC-7, AC-8).** Keyed on the incoming tree, it can delete operator edits made to the REPO_ROOT copy of any task the pull is about to replace (the wrong copy, per the worktree-canonical decision); the printed list is the notice. Keying on task IDs instead would deadlock when two tasks were merged on GitHub before either shipped. Running it before the merge is confirmed would strand a failed ship with no REPO_ROOT `status.json`.
- **Ignored-file survival.** Liveness files survive the clearing only through canon's `.gitignore` block. An adopter whose `.gitignore` lacks it would have a detached ship's pid/heartbeat copied and then cleared. Fixtures must include the block.
- **Spec visible to cold lenses on post-QA reroutes.** After the QA-end commit, `spec.md` is an added file in `<base>...HEAD`, so cold-Claude and cold-Codex see it on post-QA reroute rounds. They already see the plan, handoff and review files there today. Accepted (Non-Goals); recorded in `docs/patterns.md`.
- **Non-worktree ship window (AC-11).** Between the base checkout and the pull, a non-worktree task's files exist only on `task/<id>`. An abort in that window must say so.
- **Fake `gh` merges that change nothing.** Existing ship fixtures' fake `gh pr merge` leaves origin untouched, so their pull is a no-op that can't expose the refusal. AC-7 and AC-11 need a real squash on origin.
- **In-flight tasks at upgrade.** A task bootstrapped by the old engine has its scaffold commit on local base. If unpushed, `--pr` still hits the divergence gate once and the operator pushes as before.

## Human Test Plan

1. Start a new task and run the pipeline until it opens a draft PR. Expected: you were never asked to push the main branch, and the main branch has no new commits from canon.
2. Open the draft PR. Expected: it contains the task's spec, plan and other task files alongside the code changes.
3. Approve and ship the task. Expected: the PR merges, the main branch updates without a "files would be overwritten" error, the task moves to the archive, and the output lists the stale task files it removed from the main checkout.
4. Merge two tasks' PRs on GitHub, then ship only one. Expected: the ship succeeds, and shipping the second afterwards also succeeds.
5. Run a task in full-send mode. Expected: it opens the draft PR without pushing anything to the main branch first.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A: behavior change, not a bug fix; the git refusal it depends on was confirmed empirically (Problem)
- [x] (Refactors) — N/A: not a refactor
