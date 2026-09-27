# Spec: fix-staged-deletion-autocommit-and-dir-refs — Auto-commit handles already-staged deletions and renames; docs-refs-check accepts directory refs

> Written by: Claude | Review by: Codex
> Status: draft (revision 1 — addresses spec_review round 1)

## Problem

Two false blocks on valid paths (GitHub issues #45 and #58).

### #45: auto-commit dies on an already-staged deletion or rename

After implement, `autoCommitCode` (`src/orchestrator/main.ts`) stages every handoff Changes-table path with one `git add -A -- <paths>` call (the `stageable` list). When the implementer removed a file with `git rm`, or renamed one with `git mv`, the removal is already in the index: the old path exists in neither the working tree nor the index. `git add` then fails with `fatal: pathspec '<path>' did not match any files`, `autoCommitCode` dies with `Failed to stage files: …`, and the pipeline re-enters implement and fails the same way.

The issue's proposed fix (`git add -A`) is already in place. The existing `settledDeletions` filter only covers paths that are clean in `git status` and whose deletion is already *committed* in `<base>..HEAD`. A path that shows up in `git status` as a staged deletion (`D ` index status) or as a staged rename's source (`R  old -> new`) is in `dirtyFiles`, so it skips that check and goes straight into `stageable`.

**Confirmed mechanism (executed twice, git 2.55.0, scratch repo; deterministic):**
- `git rm dead.ts` → porcelain `D  dead.ts` → `git add -A -- dead.ts` exits 128 with `pathspec 'dead.ts' did not match any files`.
- Same staged deletion plus an edit to `keep.ts` → `git add -A -- keep.ts dead.ts` exits 128 and **`keep.ts` is not staged either** (`git diff --cached` shows only the pre-staged `D dead.ts`), so one bad path aborts the whole add.
- `git mv keep.ts moved.ts` → porcelain `R  keep.ts -> moved.ts` → `git add -A -- keep.ts moved.ts` exits 128 on `keep.ts`.
- Plain `rm dead.ts` (unstaged deletion, ` D`) → `git add -A -- dead.ts` exits 0 and stages the deletion. That case already works.
- `git rm --cached dead.ts` (index entry removed, file still on disk) → `git add -A -- dead.ts` exits 0 and re-adds it. A path still on disk is never a pathspec failure.
- `git add --ignore-errors` and `git add -u` fail the same way, so no flag avoids it.

The QA-end commit (`commitQaArtifacts`) and the human-review commit (`commitHumanReviewFiles`) run the same `git add -A -- <path>` per stage path (task directories, telemetry files, managed docs, affected prefixes) and die on the first failure. Confirmed the same way: `git rm docs/pipeline-invocations.md` → `git add -A -- docs/pipeline-invocations.md` exits 128. Rare in practice, but the same failure.

### #58: docs-refs-check reports existing directories as missing files

In `scripts/docs-refs-check.mjs`, the plain backtick-ref loop reports `missing file` unless the target exists **and** `isFile()`. A backticked path to a real directory without a trailing slash (e.g. `` `src/orchestrator` ``) is flagged. The same path with a trailing slash is skipped by `isPlaceholderTarget`, so the result depends only on how the ref was typed. The checker ships to adopters as a canon-owned file (`templates/scripts/docs-refs-check.mjs`) and runs at the `--pr` gate. Deterministic; confirmed by code trace (the `isFile()` condition in the plain backtick pass is the only rejection for an existing directory).

## Decision

1. **Already-staged removals are left out of the stage call.** One shared helper filters a list of stage paths: a path that is absent from the working tree **and** has no index entry at or under it is dropped, because its removal is already recorded (a staged deletion, the source of a staged rename, a directory removed with `git rm -r`, or a deletion already committed). Every other path is kept. `autoCommitCode`, the QA-end staging loop, and the human-review staging loop pass their `git add` pathspecs through it.
2. **In `autoCommitCode`, the helper replaces the `settledDeletions` staging filter.** `settledDeletions` stays only as the rule that accepts a missing handoff path in the pre-stage check. The `stageable.length === 0` early return ("All handoff files are already settled in history — skipping auto-commit.") is removed. When the helper leaves nothing to add, the `git add` call is skipped and the function continues to the post-stage checks and the commit, which records the removal from the index. The early return is unreachable today, since `toStage` being non-empty implies a dirty handoff path and a dirty path is never settled. After the fix it would fire on exactly the deletion-only case (AC-1) and skip the commit.
3. **Plain backtick refs accept existing directories.** In the plain backtick-ref pass of `docs-refs-check`, a target that exists as a file **or** a directory passes. `` `symbol` in `path` `` refs, section refs, and anchor links stay file-only (they read file contents). Trailing-slash refs stay skipped.

## Non-Goals

- **No change to how deleted paths may be mentioned in prose** (handoff, review, done). No new prompt warnings. The existing implement-revision rule stands.
- **No checking of trailing-slash directory refs** in docs-refs-check.
- **No change to directory-prefix matching across gates** (#14).
- **No change to which handoff paths the pre-stage check accepts** (`settledDeletions` acceptance, gitignored exemption, tracked check), to the coverage checks (`findUncoveredTrackedChanges`, `findStagedFilesOutsideHandoff`), or to `verifyHandoffFilesCommitted`. The fix only changes which paths reach `git add`.
- **Other `git add` sites are out of scope:** `stageArchiveChanges` (`--ship`; moves with `fs.renameSync`, so the old path stays in the index, and ignores add failures), the pre-pipeline task-artifact commit in `src/orchestrator/git.ts`, and `canon upgrade`'s staging. None stages a path the caller removed through the index.

## Acceptance Criteria

All tests below that touch git use a **real git repository created in a temporary directory** (the `makeGitFixture` / `withTempDir` pattern already used by the real-git `commitQaArtifacts` tests in `tests/run-task-safety.test.ts`). They must not be gated on `gitDirWritable` or any other probe of the canon-ai checkout's `.git`. "Red-first" means the test fails on the pre-fix code for the stated reason and passes after the fix.

- [ ] AC-1: **Red-first, staged deletion only.** The implement-phase auto-commit runs on a task whose handoff Changes table lists only a file removed with `git rm`. Pre-fix: the run fails with `pathspec … did not match`. Post-fix: it succeeds, `HEAD` is a new commit whose `git show --name-status HEAD` shows `D <file>`, and the working tree is clean.
- [ ] AC-2: **Red-first, staged deletion alongside an edit.** Handoff lists one file removed with `git rm` and one edited file. Post-fix: a single new commit contains both (`D` for the removed file, `M` for the edited one).
- [ ] AC-3: **Red-first, staged rename.** Handoff lists both paths of a `git mv old new`. Post-fix: at `HEAD`, `old` is absent from `git ls-tree` and `new` is present.
- [ ] AC-4: **Unstaged deletion unchanged.** A handoff file removed with plain `rm` (not staged) still commits as a deletion (`D` in `git show --name-status HEAD`). Passes before and after the fix.
- [ ] AC-5: **Red-first, QA-end commit.** `commitQaArtifacts` runs on a task whose QA artifacts are dirty and whose telemetry file `docs/pipeline-invocations.md` was removed with `git rm`. Pre-fix: it dies with `failed to stage docs/pipeline-invocations.md`. Post-fix: it commits the task artifacts and the deletion in one commit.
- [ ] AC-6: **One shared rule, unit-tested.** The removal filter is one exported helper in `src/orchestrator/git.ts`. Unit tests in `tests/run-task-validation.test.ts` run it in a temporary real-git repo and assert: a staged deletion is dropped; a staged rename's source is dropped and its destination kept; a directory removed with `git rm -r` is dropped; a directory that still has a tracked file is kept; an unstaged deletion is kept; a `git rm --cached` file still on disk is kept; a modified file is kept; an untracked new file is kept. The three call sites in Decision 1 each take their `git add` pathspecs from it (verified by review; AC-1 to AC-3 and AC-5 exercise two of them end to end).
- [ ] AC-7: **Early return removed.** `src/orchestrator/main.ts` no longer contains the string `already settled in history`. Verify: `grep -c "already settled in history" src/orchestrator/main.ts` prints `0`. AC-1 covers the behavior.
- [ ] AC-8: **Directory refs pass.** In `tests/docs-refs-check.test.ts`: a backticked path to an existing directory without a trailing slash passes (red-first); a backticked path to a missing directory still fails with `missing file`; a `` `symbol` in `<existing-directory>` `` ref still fails.
- [ ] AC-9: **Mirror in sync.** `templates/scripts/docs-refs-check.mjs` is byte-identical to `scripts/docs-refs-check.mjs`. Verify: `npm run sync-templates:check`.
- [ ] AC-10: **Red/green evidence recorded, nothing skipped.** The handoff's Validation Outcomes records, for each red-first test (AC-1, AC-2, AC-3, AC-5, and the first AC-8 case), the pre-fix failure message and the post-fix pass. The `npm test` run reports none of this task's new tests as skipped. A skipped or unrecorded red-first result means the AC is unmet, not deferred to code_review.
- [ ] AC-11: **Build and suite.** `npm run build` output is committed and matches a fresh build; `npm run lint`, `npm run type-check`, `npm run docs-refs-check`, and `npm test` pass.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/git.ts` | New exported helper that drops stage paths absent from both the working tree and the index. |
| `src/orchestrator/main.ts` | `autoCommitCode`: replace the `settledDeletions` staging filter with the helper, skip `git add` when the list is empty, and delete the "already settled in history" early return. `commitQaArtifacts` and `commitHumanReviewFiles`: filter `stagePaths` through the helper before the per-path `git add` loop. |
| `scripts/docs-refs-check.mjs` | Plain backtick-ref pass accepts an existing directory as well as a file. |
| `templates/scripts/docs-refs-check.mjs` | Mirror (sync-templates). |
| `tests/run-task-safety.test.ts` | Real-git temp-repo tests for the implement auto-commit (AC-1 to AC-4) and the QA-end commit (AC-5). |
| `tests/run-task-validation.test.ts` | Helper unit tests (AC-6). |
| `tests/docs-refs-check.test.ts` | Directory-ref tests (AC-8). |
| `dist/orchestrator/run-task.js` | Rebuilt output. |
| `dist/cli/index.js` | Rebuilt output (the build rewrites it when orchestrator code changes). |

### Implementation Notes (non-binding; plan/implement own these)

- **Index presence:** `git ls-files -- <path>` with non-empty output covers files and directory pathspecs in one call. Batch the paths if you like; keep the per-path answer.
- **Working-tree presence must not follow symlinks.** Use `lstat`, not `fs.existsSync`, so an untracked broken symlink the implementer created is kept, not dropped.
- **Harness for AC-1 to AC-4:** `autoCommitCode` is not exported. Either drive `checkAndRoute('implement', …)` from a child process whose cwd is the temp repo (`REPO_ROOT` resolves from cwd via `git rev-parse --git-common-dir`; import `main.ts` by absolute file URL, as `runCommitQaArtifactsInline` does), with `worktree: false` and fake agent CLIs, or export a narrow test seam. Either way, git must be real.
- **`git reset HEAD -- …handoffFiles`** on the abort paths is unchanged. It restores an index entry for a staged-deleted path and is harmless for the others.

### Interaction Dependencies

- `verifyHandoffFilesCommitted` must still accept the committed deletion or rename after the fix. AC-1 to AC-3 go through the full auto-commit path, so they cover it.
- The in-flight task `code-review-delta-rerounds` edits `scripts/docs-refs-check.mjs` (`isNoisySourceFile`) and its mirror. Different function, so expect a trivial merge.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; this task's real-git tests run unskipped (AC-10)
- [x] `npm run build` — committed `dist/` must match
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] E2E — N/A (CLI internals; covered by real-git integration tests)

## Docs Impact

- `docs/patterns.md`: the entry on `git rm` versus `rm` fixtures gets one line: stage calls pass through the shared removal filter, so a path removed through the index is never handed to `git add`.

## Known Risks

- **Excluding too much:** dropping a path that still has content to stage would silently leave it out of the commit. The rule drops only paths absent from both the working tree and the index. AC-6's kept cases pin the boundary (unstaged deletion, `rm --cached`, untracked, directory with remaining content). `findUncoveredTrackedChanges` after staging is the backstop.
- **Empty add list short-circuiting the commit:** the deletion-only case leaves the helper's output empty. Any early return on an empty list skips the commit and leaves the removal staged but uncommitted. AC-1 and AC-7 cover this.
- **Rename in porcelain:** `R  old -> new` reports both paths, and both are handoff entries. `old` must be dropped and `new` staged (AC-3, AC-6).
- **Red-first tests in a restricted sandbox:** the tests use temporary repositories, not the canon-ai checkout's `.git`, so a sandbox that blocks writes to that `.git` does not skip them (AC-10). If the implement sandbox cannot create temp git repos at all, that is a blocker to report, not a skip.

## Human Test Plan

1. Run a task where the only change is deleting an unused file, and the implementer removes it with git's own remove command.
2. Expected: the pipeline commits the deletion and moves on to code review without stopping.
3. Run a task where the implementer renames a file with git's own move command.
4. Expected: the commit shows the rename and the pipeline moves on.
5. Run a task whose notes mention a project folder by name, without a trailing slash.
6. Expected: the pre-PR reference check does not report the folder as a missing file.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed; *Acceptance Criteria* includes red-first regression tests
