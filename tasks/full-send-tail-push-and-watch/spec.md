# Spec: full-send-tail-push-and-watch — Full-send tail pushes canon scaffold commits; watch reports a dead tail

> Written by: Claude | Review by: Codex
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

This is GitHub issue #104, part 1. Part 2, the `--ship` branch-delete ordering, is fixed separately and is out of scope here. Several `canon run --full-send <id>` runs ended with `canon watch` reporting `state=human_review reason=checkpoint phase=qa→human_review` and no draft PR. The operator read that as a clean stop.

Confirmed mechanism. It is deterministic. There are two independent defects, each with its own evidence:

- Defect 1 is confirmed by the exit markers in the run logs of two adopter tasks, plus a code trace.
- Defect 2 is confirmed by a code trace plus the operator's report that a later manual `--pr` needed `git push origin <base>` first. The logged deaths passed the divergence gate, so the logs themselves do not show defect 2.

1. **Watch hides a dead full-send tail.**
   - After QA, the full-send tail (`shouldRunFullSendTail` → `commitHumanReviewFiles(taskIds, cwd, true)` in `src/orchestrator/main.ts`) runs inside the detached orchestrator.
   - In both adopter logs it died with exit 1. The run log's last line was `■ orchestrator exit code=1 [reason=--pr aborted: base-drift detected. · ...]`.
   - Nothing was written to `status.json` before the death, so the task sat at `human_review` with `phases.human_review.status === 'pending'` and `full_send === true`.
   - `canon watch` never looked at the exit marker:
     - `classifyIdle` in `src/cli/commands/watch.ts` returns `checkpoint` for any `state === 'human_review'` before any crash check.
     - `classifyAttach` explicitly skips its crash-evidence branch when the current phase is `human_review` (`currentPhase !== 'human_review'`), so a late attach returns `nothing_to_watch`.
   - The crash-reporting work in 3.11.0 (`findCrashEvidence`) deliberately left `human_review` out of scope.
   - The base-drift cause of these particular deaths is fixed separately (issue #103). This task makes any tail death visible, whatever its cause.

2. **The full-send tail cannot pass the base-divergence gate on its own scaffold commits.**
   - Before the worktree is created, implement commits `tasks/<id>/` to the local base branch (`commitTaskArtifactsToBase` in `src/orchestrator/git.ts`). It may also make a `chore: absorb pre-implement telemetry into scaffold for <ids>` commit.
   - It then prints `Scaffold committed to local <base>; run \`git push origin <base>\` ...`, and that message is printed even when nothing was committed.
   - `commitHumanReviewFiles` runs the base-divergence gate first (`verifyBaseDivergence`, i.e. `git log origin/<base>..<base>`). Any unpushed base commit dies there: `Base divergence detected ... Fix: git push origin <base>`.
   - Under full-send nobody is present to push. The operator confirmed that after the drift deaths, a manual `--pr` also needed `git push origin <base>` first.
   - Canon never pushes base during the run because pushing needs consent. `--full-send` is that consent for getting the PR open, and the commits in question are ones canon created itself.
   - The guard does not need to prove that canon made a commit. The harm to prevent is publishing operator work, meaning source changes the operator has not chosen to push. A commit whose content is limited to task artifacts and pipeline telemetry is safe to publish no matter who made it. An operator-made look-alike that touches only `tasks/` is still only task artifacts. So the guard is a content-safety rule, not a provenance rule. Recording provenance (SHA records, tree verification) was considered and rejected as cost without matching benefit.

## Decision

1. **Watch reports a dead full-send tail as death, and keeps watching a live one.**
   - **Scope:** every rule here applies only to tasks with `full_send === true` sitting at `human_review` with `phases.human_review.status === 'pending'`. Behavior for every other task is unchanged.
   - **Dead tail.** A fresh non-zero exit marker in the run log means the orchestrator died. Watch reports `reason=death`, prints the marker's reason on stderr, and exits 4, the same contract as other crashes. "Fresh" uses the existing `findCrashEvidence` rule. Both entry points apply it:
     - classification during a watched run
     - attach after the run has already died
   - **Live tail.** While the orchestrator pid is alive, watch keeps blocking. It reports neither `checkpoint` nor `death`, even when the heartbeat has gone stale during the tail's synchronous git/gh calls. A live pid takes precedence over any exit marker. The run log is append-only, so a resumed tail can sit behind a non-zero marker left by its own earlier death, and that marker must not be read as this run's death.
   - **Deliberate stop.** A `canon stop` during the tail writes a signal marker. Watch reports it as death, with the signal as the reason. That is acceptable, because the reason says what happened.
   - **Clean stop.** With no live pid, watch defers to the existing `findCrashEvidence` helper. If the helper finds evidence, which includes a pid that resolves but is dead, watch reports `death`. If it finds none, watch reports `checkpoint`.
2. **The full-send tail pushes unpushed base commits that carry only scaffold content.**
   - **Safe-to-push commit:** a commit qualifies only if both conditions hold:
     - Its full subject exactly equals `task(<id>): commit artifacts pre-pipeline` for some task id, or `chore: absorb pre-implement telemetry into scaffold for <ids>`. This is a whole-subject match, so a subject that merely contains, extends or nearly matches one of these does not qualify.
     - Every path it changes is under `tasks/` or is one of `PIPELINE_TELEMETRY_FILES`. Changed paths are read with rename detection off, so a rename is a deletion of the old path plus an addition of the new one. Moving a file from outside `tasks/` into `tasks/` therefore changes the outside path and does not qualify.
     - Copies need no special rule. A copy leaves its source path unchanged, so the only changed path is the new file, which is an addition like any other. The guard never audits the content of files under `tasks/`, and any file there could carry arbitrary text, so detecting copies would add no protection. A copy of an unpushed source change is still blocked, because the commit carrying that source change is in the unpushed range and does not qualify.
   - A merge commit (more than one parent) never qualifies, whatever its subject or paths.
   - Who created the commit is deliberately not checked (see Problem).
   - **The tail push.** It runs only in the full-send tail, before the base-divergence gate:
     - Canon fetches `origin/<base>`, lists the commits on local `<base>` that are not on `origin/<base>`, and notes the tip SHA of that range.
     - If the list is non-empty and every commit in it is safe to push, canon pushes exactly that tip SHA to the remote base branch (`<sha>:refs/heads/<base>`), never the moving branch name. Pushing the SHA closes the race with an operator committing on base during the tail. Canon prints one line listing the pushed commits and why.
     - If any unpushed commit does not qualify, canon pushes nothing. The existing divergence gate then dies as it does today.
   - **Fail closed:**
     - If the fetch or the commit-listing/path probe fails, the tail dies with the error and pushes nothing.
     - If the push fails, for example because the branch is protected or the push is non-fast-forward, the tail dies with the git error. The message notes that the base branch may be protected and tells the operator to push or merge the commits manually and re-run.
   - **Ordering tradeoff (accepted):** the push runs before the docs-refs, base-drift and dirty-tree gates, so a later gate can still abort after the commits are on origin. That is harmless, because they carry only task artifacts and telemetry, a re-run needs them pushed anyway, and the push is what full-send consented to.
   - Failures use the orchestrator's `die` path (a clean message), not the throwing git helper.
   - `--allow-divergent-base` under full-send: the push still runs first. The override then applies to whatever divergence remains.
   - `--push`, `--pr` and `--ship` are unchanged. `--ship` keeps its existing base push of the archive commit.
3. **The scaffold hint is accurate.**
   - After the scaffold step, the `Scaffold committed to local <base>` hint prints only when local `<base>` actually has unpushed canon scaffold commits (safe-to-push commits not on `origin/<base>`, no fetch). They count whether they were created by this call or left by an earlier one. If that probe fails, the hint prints today's push advice — it is advisory, not a gate.
   - Under full-send, the hint says the full-send tail pushes unpushed base commits that carry only task artifacts and pipeline telemetry, and stops if any other commit is unpushed on `<base>`.
   - Otherwise the hint keeps today's push advice.

## Non-Goals

- No change to which gates the tail runs, or their order, other than inserting the scaffold push. The base-drift relaxation is issue #103 and is a separate task.
- No new base push in `--push`, `--pr`, `--ship`, or any non-full-send path.
- No auto-pull, rebase, or retry when the base push is rejected as non-fast-forward. The tail dies and the operator resolves it.
- No change to watch for tasks that are not full-send, to `complete`, to the `--until` settle logic, or to heartbeat ticking.
- No new runtime file, record, gitignore pattern, watch reason or exit code.
- No provenance tracking of who made a commit.

## Acceptance Criteria

- [ ] **AC-1: `classifyIdle` reports a dead tail (red-first).**
  - In `tests/watch.test.ts`, use a status at `human_review` with `human_review.status: 'pending'` and `full_send: true`, no resolvable pid, and a run log whose newest marker is `code=1` and fresher than `status.json`.
  - It classifies as `death` with the marker reason. The pre-change code returns `checkpoint` for this fixture.
  - Sibling cases keep `checkpoint`:
    - the same fixture with a `code=0` marker
    - the same fixture with `full_send: false` and a fresh `code=1` marker
  - The existing `classifyIdle: checkpoint when human_review settled` test is unchanged.
- [ ] **AC-2: late attach reports a dead tail (red-first).**
  - `classifyAttach` on the AC-1 fixture returns `death` with the marker reason. No pid resolves in this fixture. The pre-change code returns `nothing_to_watch`.
  - A `watchCmd` test on the same fixture prints the death summary and reason on stderr and exits 4.
- [ ] **AC-3: a live tail is never a checkpoint or a death.**
  - Fixtures: full-send, `human_review` pending, a live orchestrator pid, a stale heartbeat, and either no marker or a fresh `code=1` marker from an earlier death of the same task.
  - Watch keeps blocking and reports neither `checkpoint` nor `death`, both from `classifyIdle`/`classifyAttach` and from the idle loop's still-progressing check. The pre-change code reports `checkpoint`.
- [ ] **AC-4: the tail pushes safe-to-push commits (red-first).**
  - Setup: a real-git test in `tests/run-task-safety.test.ts` that reuses the `setupDivergentBaseRepo` shape with `full_send: true`. It is driven through `main()` as a child process (like the `--push` divergence tests) with fake agent CLIs on PATH, so `shouldRunFullSendTail` is actually taken. Local base has unpushed `task(<id>): commit artifacts pre-pipeline` commits that touch only `tasks/<id>/`.
  - Expected: the full-send tail pushes them, so `origin/<base>` contains them. It continues past the divergence gate and prints the pushed-commit line.
  - Red-first: the pre-change code dies at the divergence gate.
  - Control: the same fixture under plain `--pr` still dies with the divergence message and pushes nothing.
  - Copy case: an extra unpushed commit with an exact scaffold subject whose only change adds a byte-identical copy of an already-pushed tracked file (e.g. `src/module.ts`) under `tasks/<id>/`, with the source unchanged, qualifies and is pushed. This pins the Decision 2 copy rule.
- [ ] **AC-5: other commits are never pushed.**
  - Setup: the AC-4 fixture plus one extra unpushed commit.
  - Expected for every variant below: the tail does not push, `origin/<base>` is unchanged, and the run dies with the divergence message. Variants:
    - an arbitrary subject
    - a near-miss subject: a scaffold subject with a suffix, or one embedded in a longer subject
    - an exact scaffold subject on a commit that also touches a file outside `tasks/` and the telemetry files
    - an exact scaffold subject on a commit whose only change is renaming a file from outside `tasks/` (e.g. `src/module.ts`) to a path under `tasks/<id>/`; red against a check that reports only the post-rename path
    - an exact scaffold subject on a merge commit
- [ ] **AC-6: push and probe failures fail closed.**
  - Push rejected: when origin rejects the base push, the tail dies with the git error and the protected-branch hint. PR creation is never reached.
  - Probe failure: when the commit-listing probe fails (for example, `origin/<base>` is missing after the fetch), the tail dies without pushing.
- [ ] **AC-7: concurrent operator commit is not pushed.**
  - Setup: a real-git test advances local `<base>` with an operator source commit after the tail lists the range and before it pushes. Use the injection point the plan chooses, such as a fake git wrapper that commits on the push call.
  - Expected: only the checked tip SHA is pushed, so `origin/<base>` does not contain the operator commit.
- [ ] **AC-8: accurate scaffold hint (red-first for the no-commit case).**
  - Implement entry with nothing to commit and no unpushed safe-to-push commits prints no `Scaffold committed` line. The pre-change code prints it.
  - With unpushed safe-to-push commits the line prints. It uses the full-send wording under full-send and today's advice otherwise.
- [ ] **AC-9: restatements updated.**
  - `docs/pipeline-orchestrator.md`: the watch exit-code rows for `0` and `4`, the `--full-send` row, the scaffold-to-base paragraph, and the base-divergence paragraph (which must mention the full-send push of safe-to-push commits), synced to `templates/docs/pipeline-orchestrator.md`.
  - The README "Git side effects need a flag" paragraph, which must say that full-send also pushes unpushed base commits that carry only task artifacts and pipeline telemetry.
- [ ] **AC-10: build and checks.** `npm run build` output is committed. Lint, type-check, the full suite, `sync-templates:check`, and `docs-refs-check` pass.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/watch.ts` | For a full-send task at pending `human_review`: `classifyIdle` and `classifyAttach` consult `findCrashEvidence` before returning `checkpoint` / `nothing_to_watch`, with a live orchestrator pid taking precedence; `orchestratorStillProgressing` keeps blocking on a live pid in that state. |
| `src/orchestrator/main.ts` | Full-send tail: before `commitHumanReviewFiles`' divergence gate, push the unpushed base range by tip SHA when every commit in it is safe to push (exact scaffold subject + only `tasks/`/telemetry paths); fail closed on fetch/probe/push errors. Plain `--pr`/`--push` paths unchanged. |
| `src/orchestrator/git.ts` | Safe-to-push commit predicate (exact subject + changed-path check with rename detection off, merges rejected) and a helper listing the paths a commit changes; `commitTaskArtifactsToBase` reports whether it committed. |
| `src/orchestrator/phases/implement.ts` | Print the scaffold hint only when unpushed safe-to-push commits exist; full-send-aware wording. |
| `tests/watch.test.ts` | AC-1, AC-2, AC-3. |
| `tests/run-task-safety.test.ts` | AC-4, AC-5, AC-6, AC-7, AC-8. |
| `docs/pipeline-orchestrator.md` | Watch exit-code rows, `--full-send` row, scaffold-to-base paragraph, base-divergence paragraph. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror. |
| `README.md` | Git side-effects paragraph. |
| `dist/cli/index.js` | Rebuilt. |
| `dist/orchestrator/run-task.js` | Rebuilt. |

### Interaction Dependencies

- **Issue #103 (`base-drift-conflicts-only`)** changes the drift gate that ran in the same function. The two tasks touch different blocks of `commitHumanReviewFiles`. This task inserts the push before the divergence gate; #103 rewrites the drift gate after it.
- **`--ship`** keeps its own divergence gate. By the time a full-send task ships, its scaffold commits are already pushed.
- **Bundles:** `shouldRunFullSendTail` requires every task to be full-send, so the push runs once per tail invocation.

### Data Model Changes

None.

### Implementation Notes (non-binding)

- Reuse `getUnpushedBaseCommits` for the list. For per-commit paths, `git diff-tree --no-commit-id -r --name-only --no-renames <sha>` lists every changed path with renames split into delete + add. `--no-renames` is explicit so no config can turn detection on. Rename detection is off, so the `docs/patterns.md` `--name-status` rule (pre-image suppressed under `-M`) does not apply. If the plan prefers `--name-status`, `parseDiffNameStatus` still works because no `R`/`C` lines are emitted. A failed probe must die rather than push blind (`docs/patterns.md`, fail-closed guards).

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite
- [x] `npm run build` (dist committed)
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] E2E — N/A

## Docs Impact

`docs/pipeline-orchestrator.md` and `README.md` are edited here. Two docs may go stale and are left for QA to check:

- `docs/decisions.md`, the "Full-send mode collapses the spec gate and human_review stop" entry: the push is part of what full-send consents to.
- `docs/codebase-map.md`, the watch row.

## Known Risks

- **Pushing operator work by accident.** Three guards prevent it: an exact whole-subject match, a content rule (only `tasks/` and telemetry paths, renames split into delete + add, merges excluded), and pushing the checked tip SHA rather than the branch name. AC-5 and AC-7 pin them. An operator-made look-alike that passes both rules carries only task artifacts or telemetry, and pushing it is accepted (see Problem).
- **Protected base branch.** On repos that reject direct pushes to base, the tail now dies at the push with a clear hint. Today it dies at the divergence gate. The operator gets a better message, but the PR still does not auto-open there. That is no worse than today.
- **Base-branch CI or deploy triggers.** Pushing scaffold-only commits to base can start the adopter's base-branch CI or deploy. The scaffold commits change only task artifacts and telemetry, and `--ship` already pushes base the same way.
- **Absorb commits carry whatever telemetry was dirty**, possibly rows from other tasks. That is accepted: canon created the commit and the paths are telemetry-only. The guard's job is to keep operator source commits off origin, not to audit telemetry rows.
- **Concurrent full-send tasks.** A sibling task's scaffold commits are canon scaffold commits too, so the tail pushes them along with its own. That is intended, because they would otherwise block every sibling's PR.
- **A stale marker from an earlier run** misreported as a fresh death. `findCrashEvidence`'s freshness rule against `status.json` mtime already handles this, and AC-1's `code=0` case pins the healthy side.
- **Tail still running with a stale heartbeat**, for example during a slow `gh` call or the new push. Watch must keep blocking on a live pid, reporting neither checkpoint nor death (AC-3).

## Human Test Plan

1. Start a full-send run and let it reach the end without pushing the base branch yourself.
2. Expected: the draft PR opens, and the log lists the setup commits (task files and pipeline telemetry only) that canon pushed to the base branch.
3. Make an unrelated commit on the base branch without pushing it, then start another full-send run.
4. Expected: the run stops before opening the PR and tells you to push the base branch. Your commit is not pushed.
5. Force a full-send run to fail at the very end, for example with a deliberate conflict, while watching it.
6. Expected: watch reports that the run died and shows why, instead of reporting a normal stop for review.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps (fast tier) — N/A
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has entries marked `- [x]`
- [x] Bug fix: confirmed mechanism with evidence per defect (Problem); AC-1/2/3/4/8 are red-first, AC-5's rename variant is red against a post-image-only check
- [x] Refactor audit — N/A
