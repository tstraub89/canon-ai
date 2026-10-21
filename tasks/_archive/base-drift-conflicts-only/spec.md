# Spec: base-drift-conflicts-only — --pr base-drift blocks only on real merge conflicts

> Written by: Claude | Review by: Codex
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

GitHub issue #103. The `--push` / `--pr` base-drift gate (`verifyBaseDrift` in `src/orchestrator/validation.ts`, called from `commitHumanReviewFiles` in `src/orchestrator/main.ts`) aborts whenever the base branch has advanced on any file outside the task's allowlist, even when the two sides do not touch the same lines.

Confirmed mechanism (deterministic, traced in code and in adopter run logs):

- `getTreeDriftFiles` runs a two-dot tree diff, `git diff origin/<base> HEAD --name-status -M -z`. Every file that differs between `origin/<base>` and the task `HEAD` is a candidate.
- `verifyBaseDriftFromData` drops allowlisted paths: spec Affected Files, `PIPELINE_TELEMETRY_FILES`, admitted docs once QA is done, and `tasks/<id>/` for the current task ids only.
- `classifyBaseDriftFilesFromData` splits the remainder into two lists:
  - `baseAdvanced`: changed only on the base side. Example: another task's pre-pipeline scaffold commit under `tasks/<other-id>/`, or a sibling PR that merged first.
  - `taskChangedOutOfScope`: changed by the task branch but not declared in Affected Files.
- Either list non-empty aborts the run unless the operator passes `--force`.

Adopter evidence: two concurrent worktree tasks on the same base each aborted their full-send tail with `--pr aborted: base-drift detected. The base branch advanced. These files changed only on origin/<base>: ...`. The listed files were the sibling task's `tasks/<other-id>/*` and source files from a sibling PR that had already merged. None overlapped the task's own changes. The existing real-git test `commitHumanReviewFiles base-drift gate dies when the base branch advanced outside Affected Files` in `tests/run-task-safety.test.ts` encodes today's behavior: the base adds one file, the task changes a different file, and the gate dies.

Why the `baseAdvanced` block is the wrong rule:

- The gate's base-side purpose is to catch work that will not merge cleanly. `--ship` squash-merges through `gh pr merge`, and the forge computes that merge itself, so non-overlapping base advance merges without trouble.
- Stale validation against an old base is the forge CI's job, since PR checks run against the merge of head and base. Canon does not and should not re-check it.

The `taskChangedOutOfScope` half is different. It is scope drift inside the task's own worktree: the task changed files its spec never declared. That check is intentional and stays as it is.

## Decision

Replace the base-side half of the gate with a real merge-conflict check. Leave the task-side scope check unchanged.

1. **Base side:** at `--push` / `--pr`, canon checks whether merging `origin/<base>` into the commit it is about to push would conflict. It uses a merge that touches neither the working tree nor the index (`git merge-tree --write-tree`).
   - **What is probed:** the exact commit that will be pushed. There are two cases:
     - **Dirty path:** after `commitHumanReviewFiles` runs `git commit` for the human_review artifacts, and before `git push`. Canon probes the new `HEAD`. That is the tree git actually recorded, including any change an adopter's pre-commit hook made to the index during the commit. Canon does not probe a pre-commit candidate, because a hook can rewrite the index after the candidate is built.
     - **Clean-tree retry path:** `HEAD`, before the push.
   - **Gate placement:** the base-drift gate (fetch, scope-drift classification, conflict probe, force/abort decision) moves from its current position near the top of `commitHumanReviewFiles` to the two points above, immediately before each `git push`. The base-divergence and docs-refs gates stay where they are. Scope drift is computed against the probed `HEAD`. The human_review commit normally adds only allowlisted paths, so the result matches today's. If a hook added an undeclared file to the commit, scope drift now catches it.
   - **Nothing is left committed or pushed on abort:** a conflict abort, a scope abort, or a probe-error abort pushes nothing.
     - On the dirty path, canon first undoes the human_review commit it just made, with `git reset --soft` to the `HEAD` recorded before the commit. That restores `HEAD` and leaves the committed content staged, so the working tree is untouched. A re-run then re-stages and re-commits it, because those paths are inside the allowlist.
     - If the undo itself fails, the abort message says so, names the leftover commit, and gives the manual `git reset --soft` command.
     - The clean-tree path made no commit, so it has nothing to undo.
   - **No conflicts:** base advance never blocks. When the base advanced on files outside the allowlist, canon prints one info line naming how many such files there are and saying they merge cleanly.
   - **Conflicts:** the run aborts before pushing.
     - The header says the task conflicts with `origin/<base>`, not "base-drift".
     - The message lists the conflicted paths and gives the existing merge/rebase remediation.
     - Every path counts, allowlisted ones included, because a conflict in any file breaks `--ship`'s squash-merge.
   - **Why block at `--pr` rather than leave it to the forge:** the operator sees the conflict while still in the task's context instead of at `--ship`. Issue #103 asks for this explicitly.
   - **Runs on every `--push` / `--pr`:** the conflict probe runs whether or not any scope drift was found. Today the gate's blocking branch is reached only when the post-allowlist drift list is non-empty. A conflict on a declared or allowlisted path leaves that list empty, so it must still be reported. The force/abort decision covers conflicts and scope drift together.
2. **Task side:** `taskChangedOutOfScope` behaves exactly as today: its abort section, remediation text, and allowlist semantics are unchanged. That includes the fail-closed case: if the task-changed (three-dot) diff cannot be computed while drift exists, canon cannot tell scope drift from base advance, so the run still dies and cannot be bypassed. `commitHumanReviewFiles fails closed when only the task-changed diff fails` keeps passing.
3. **`--force`:** still bypasses both the conflict block and the scope block, with a loud warning that names what was bypassed. When the only drift is clean base advance, there is nothing to bypass. Canon prints the info line and no override warning, with or without `--force`.
4. **Probe failure:**
   - **Unsupported git** (older than 2.38, no `--write-tree`): canon warns once, names the 2.38 minimum, says conflicts were not checked, and proceeds. This matches today's treatment of a failed fetch.
   - **Any other probe failure** (an unreadable ref, or an exit status other than clean or conflicts): the run aborts fail-closed with the git error. Like today's diff-computation failure, `--force` cannot bypass it.

## Non-Goals

- No change to the task-side scope check (`taskChangedOutOfScope`), the allowlist construction (`buildAffectedFilesAllowlist`), or the Affected Files parser.
- No change to the base-divergence gate (`verifyBaseDivergence`, `--allow-divergent-base`) or to `--ship`'s merge-proof logic.
- No automatic merge or rebase of the base into the task branch. Canon only reports.
- No new `canon doctor` git-version check. The fail-closed probe message covers old git.
- The abort header's "`--pr` aborted" wording under `--push` is not fixed here.

## Acceptance Criteria

- [ ] **AC-1 — non-overlapping base advance passes (red-first).** Rewrite the real-git test `commitHumanReviewFiles base-drift gate dies when the base branch advanced outside Affected Files` in `tests/run-task-safety.test.ts`. In it, the base adds a file the task never touches and the task changes a different declared file. It must now assert that `--pr`/`--push` commits successfully and prints the clean-merge info line. The pre-change code dies on this fixture, so the rewritten test is red before the change.
- [ ] **AC-2 — another task's artifacts on the base pass.** Add a real-git test: the base gains `tasks/<other-id>/spec.md` and `tasks/<other-id>/status.json` after the task branched, and the task touches only declared files. The gate passes with no `--force`.
- [ ] **AC-3 — a real conflict aborts.** Add a real-git test: the base and the task both edit the same line of the same file (use a declared Affected Files path, which shows the check covers allowlisted paths). The run exits non-zero. The message names the conflicted path and includes the merge/rebase remediation. `HEAD` is the same commit before and after the run, and origin has no task branch.
- [ ] **AC-4 — scope drift still aborts unchanged.** The existing tests for task-changed files outside Affected Files keep passing with their current assertions. That includes `commitHumanReviewFiles base-drift gate dies on drift outside the allowlist` and the `base-drift abort message varies with drift cause` unit test, with only the base-advanced assertions updated to the conflict wording.
- [ ] **AC-4b — conflict plus scope drift.** A new case with both a conflict and out-of-scope task files aborts with both sections in one message.
- [ ] **AC-4c — conflicts in the human_review commit are caught and the commit is undone.** Real-git tests:
  - **Dirty artifact:** the conflicting edit exists only as a dirty admitted-doc change that `commitHumanReviewFiles` will commit, and the base edited the same lines of that doc. The run aborts and names that doc as conflicted. `HEAD` equals the pre-run commit, the doc edit is still present (staged or in the working tree), and origin has no task branch.
  - **Hook-introduced conflict:** the fixture installs a pre-commit hook in the fixture repo (via `core.hooksPath`) that rewrites a staged admitted doc so it conflicts with a base-side edit, then re-stages it. The staged content before the hook runs merges cleanly. The run aborts naming that doc, `HEAD` equals the pre-run commit, and origin has no task branch. This case pins the probe to the recorded commit: a probe of the pre-commit index would pass it.
  - **Clean-tree variant:** the conflicting edit is already committed. The run aborts with no push and `HEAD` unchanged.
- [ ] **AC-4d — the undo leaves the task re-runnable.** After the dirty-artifact abort in AC-4c, the fixture resolves the conflict (reverts the base-side edit on origin), then re-runs. The second run commits and pushes successfully, with no `--force`.
- [ ] **AC-5 — `--force` bypasses a conflict with a warning.** A test routed through `main()` (see `docs/patterns.md` on `commitHumanReviewFiles` reading module-level `cliArgs`) runs `--force` on a conflict. It proceeds and warns with the conflicted paths listed.
  - The fake-git harness may stand in for real git here, with a `merge-tree` stub that exits 1 and lists the paths.
  - A clean-base-advance case with `--force` prints the info line and no `--force override` warning.
- [ ] **AC-6 — probe failure.**
  - Unsupported: a fake-git test where `merge-tree --write-tree` is rejected as unsupported (usage error, exit 129) warns with the 2.38 minimum and proceeds.
  - Other errors: a test where the probe exits with another error status (e.g. 128) aborts with the git error text, both with and without `--force`. The fake-git harness in `tests/run-task-safety.test.ts` (`setupFakeGit`) must stub the new `merge-tree` invocation explicitly. Its fallthrough exits 1, which a naive implementation would read as "conflicts". Existing fake-git tests that reach the gate must pass because they stub a clean merge-tree, not because of that fallthrough.
- [ ] **AC-7 — restatements updated.** Every surface below describes the new contract (conflicts block; base advance alone does not; scope drift unchanged):
  - the `docs/pipeline-orchestrator.md` paragraphs on the base-drift check, and the `--force` / `--allow-divergent-base` rows, synced to `templates/docs/pipeline-orchestrator.md`
  - the `--pr` / `--push` / `--force` / `--allow-divergent-base` help text in `src/orchestrator/cli.ts` and `src/cli/index.ts`
  - the `docs/codebase-map.md` base-drift lines
  - `docs/patterns.md` §`getAffectedFiles` uses three-dot diff semantics: it notes that merge conflicts are probed with merge-tree, not a tree diff
  - `docs/patterns.md`: the git-behavior section gains the `merge-tree --write-tree` exit-status semantics (0 clean, 1 conflicts, other = error) and the 2.38 minimum

  `grep -rnE "changed only on origin|files changed only by base advancement" src docs templates` returns no hits.
- [ ] **AC-8 — build and checks.** `npm run build` output is committed and `dist/` matches a fresh build. Lint, type-check, the full test suite, `sync-templates:check`, and `docs-refs-check` all pass.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/git.ts` | Add a merge-conflict probe helper (merge-tree against `origin/<base>`) that returns clean / conflicts-with-paths / error, distinguishing exit 1 from other failures (the existing `gitSafeAt` collapses them). |
| `src/orchestrator/validation.ts` | `verifyBaseDrift` runs the conflict probe and returns conflicts and probe errors alongside the scope-drift result; replace the base-advanced section of `buildBaseDriftAbortMessage` with a conflicts section; keep `taskChangedOutOfScope` classification. |
| `src/orchestrator/main.ts` | `commitHumanReviewFiles`: move the base-drift gate to just before each `git push` (after the human_review commit on the dirty path, before the push on the clean-tree path); probe `HEAD`; block on conflicts or scope drift; on a dirty-path abort, soft-reset the human_review commit before dying; info line for clean base advance; `--force` warning; fail-closed probe error. |
| `src/orchestrator/cli.ts` | `--pr` / `--push` / `--force` help text. |
| `src/cli/index.ts` | `--pr` / `--push` help text. |
| `tests/run-task-safety.test.ts` | Rewrite the base-advanced real-git test (AC-1); add AC-2/3/4b/4c/4d/5/6 tests (AC-4c installs a fixture-local pre-commit hook); stub `merge-tree` in `setupFakeGit`. |
| `tests/run-task-validation.test.ts` | Update abort-message and `verifyBaseDrift` unit tests for the new result shape and wording. |
| `docs/pipeline-orchestrator.md` | Base-drift contract paragraphs and flag rows. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror (via `npm run sync-templates`). |
| `docs/codebase-map.md` | Base-drift helper lines. |
| `docs/patterns.md` | merge-tree exit semantics and minimum git version. |
| `dist/cli/index.js` | Rebuilt. |
| `dist/orchestrator/run-task.js` | Rebuilt. |

### Interaction Dependencies

- The full-send tail calls `commitHumanReviewFiles(..., true)`, so it gets the relaxed gate automatically. Concurrent full-send tasks on one base stop aborting on each other's scaffold commits.
- `--ship` does not call this gate and is unchanged. Its squash-merge still fails loudly on a forge-side conflict.
- The base-divergence gate runs earlier in the same function and is unaffected.

### Data Model Changes

None. `status.json` is untouched. Two internal signatures change: the return of `verifyBaseDrift`, and the classification input of `buildBaseDriftAbortMessage`. `verifyBaseDriftFromData` keeps its signature, because the code_review pre-flight and the full-send scope check call it.

### Implementation Notes (non-binding; owned by plan/implement)

- `git merge-tree --write-tree --name-only --no-messages HEAD origin/<base>` exits 0 when clean and 1 on conflicts, and lists the conflicted paths after the tree OID. Verify the exact output shape on the installed git before parsing.
- Probe the same base ref the drift diff already uses, after the existing fetch.
- Record `git rev-parse HEAD` before the human_review `git commit`. On a dirty-path gate abort, run `git reset --soft <recorded>` before `die()`. `die()` exits the process, so the undo must happen first, on every abort branch (conflict, scope, probe error).
- The AC-4c hook fixture sets `core.hooksPath` in the temp fixture repo to a directory holding a plain shell `pre-commit` script, so canon-ai's own `.githooks/` and its orchestrator skip marker are not involved.
- Pass `-z` when parsing merge-tree's path output (`docs/patterns.md`, porcelain C-quoting pitfall). Before writing the 2.38 message, confirm the minimum version for every flag used.
- The existing `verifyBaseDrift: two-dot diff catches base-advance drift that three-dot would miss` test asserts a base-only file in `drift`. Whatever result shape is chosen must keep base-advanced files available for the info-line count, and that test must be updated to match.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite
- [x] `npm run build` (dist committed)
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] E2E — N/A

## Docs Impact

`docs/pipeline-orchestrator.md`, `docs/codebase-map.md` and `docs/patterns.md` are edited in this task. `docs/architecture.md` (its validation note says the gate rejects undeclared dist artifacts) stays true because that is the scope-drift half. `docs/decisions.md` has no base-drift entry.

## Known Risks

- **Fake-git fallthrough reads as a conflict.** `setupFakeGit` exits 1 on unknown argv, the same status `merge-tree` uses for conflicts. AC-6 requires an explicit stub so that tests pass for the right reason (`docs/lessons-learned.md` records fake-git argv going stale).
- **The `--force` path skipping the probe.** If the probe runs only inside a `!force` branch, the claim that `--force` cannot bypass a probe error becomes false (`docs/lessons-learned.md` records this exact trap). The probe must run before the force decision.
- **Telemetry conflicts.** Appends to shared telemetry docs from two tasks could conflict textually. Blocking is correct, because `--ship` would hit the same conflict, but the message should make clear it is a merge conflict and not scope drift.
- **Old git on adopter machines.** Git older than 2.38 skips the conflict check with a warning (AC-6). That case must not be confused with a generic probe failure, which fails closed.
- **Probe placement.** Probing `HEAD` before staging would miss conflicts in the files the human_review commit adds. Probing a pre-commit candidate built from the index would miss a pre-commit hook's rewrite (spec_review round 2). The probe must run on the commit git actually recorded, so the no-commit-on-abort contract is kept by undoing that commit, not by probing before it.
- **Undo safety.** `git reset --soft` only moves the branch ref back to the commit canon recorded a moment earlier, inside the same synchronous function. It does not touch the index content or the working tree. If the reset fails (for example, an index lock), canon must not claim the tree is clean: the abort message names the leftover commit and the manual recovery. A post-commit hook's side effects (if the adopter has one) are not undone. That is acceptable, because the hook already runs on today's successful commits.
- **Gate reordering.** Moving the gate later means checks that used to run after it now run first: the dirty-files-outside-allowlist abort, the "no dirty task artifacts" abort, and the staged-allowlist aborts. A fixture that triggers one of those and also has drift now gets the earlier message. Existing tests that assert a base-drift abort must still reach the gate; if one fails on ordering, fix the fixture, not the ordering.
- **Adopters without PR CI.** Non-overlapping base advance no longer prompts a rebase before the PR opens. Unless the forge runs CI, nothing re-validates the task against the new base. The old gate never re-validated either; this change only removes the nudge.

## Human Test Plan

1. Run two tasks at once against the same base branch. Merge the first one's PR, then open the second one's PR.
2. Expected: the second PR opens without `--force`. Canon notes that the base moved and that it merges cleanly.
3. On a throwaway task, change one line of a file on the task branch. Change the same line on the base branch and push that change to the shared remote. Then try to open the PR.
4. Expected: canon refuses, names the conflicting file, and explains how to merge or rebase.
5. On a task that changed a file its spec never mentioned, try to open the PR.
6. Expected: canon refuses with the same "not in the spec's Affected Files" message as before.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps (fast tier) — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has entries marked `- [x]`
- [x] Bug fix: Problem states the confirmed mechanism (deterministic code trace plus adopter log evidence); AC-1 is a red-first regression test
- [x] Refactor audit — N/A
