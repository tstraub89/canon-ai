# Done: fix-staged-deletion-autocommit-and-dir-refs

## Summary

Two false blocks on valid work are fixed. First, when an implementer removed a file with `git rm` or renamed one with `git mv`, the pipeline's auto-commit step (and the QA-end and human-review commit steps) tried to `git add -A` a path that no longer existed anywhere to stage, died with a `pathspec … did not match any files` error, and sent the task back into implement to fail the same way again. Second, `docs-refs-check` (the pre-PR reference checker) flagged a backticked reference to a real, existing directory as a "missing file" whenever the reference didn't end in a trailing slash — a reference to the exact same directory with a trailing slash was already accepted. Both are now fixed: stage calls skip only paths that are truly gone from both the working tree and the git index (the removal is committed instead of blocking the run), and directory references without a trailing slash pass the same way file references do.

A related bug surfaced during code review and was fixed in the same task: the implement-phase gate that runs *before* auto-commit was still rejecting a staged-deletion-only handoff as "no evidence of work," so the headline scenario above still wedged for non-worktree tasks even after the auto-commit fix landed. That gate now recognizes staged and unstaged deletions (via `git diff HEAD --diff-filter=D`), with `--no-renames` so Git's rename-pairing doesn't hide a real deletion behind a coincidentally similar added path.

## Files Changed

- `src/orchestrator/git.ts` — new exported `filterStageablePaths` helper: drops a stage path only when it's absent from both the index and the working tree.
- `src/orchestrator/main.ts` — `autoCommitCode`, `commitQaArtifacts`, and `commitHumanReviewFiles` all route their `git add` pathspecs through the helper; the unreachable "already settled in history" early return is removed; the implement-phase deletion-evidence probe now uses `git diff HEAD --name-only --diff-filter=D --no-renames`.
- `scripts/docs-refs-check.mjs` / `templates/scripts/docs-refs-check.mjs` (mirror) — the plain backtick-ref pass accepts an existing directory as well as an existing file; symbol, section, and anchor refs are unchanged.
- `tests/run-task-safety.test.ts` — real-git regressions for staged deletion, staged deletion + edit, staged rename, unstaged deletion (unchanged), the QA-end commit, the routed implement-phase evidence gate, and an intent-to-add rename case.
- `tests/run-task-validation.test.ts` — unit tests for every boundary of the shared helper (staged deletion, staged rename source/destination, `git rm -r` directory, directory with remaining content, unstaged deletion, `git rm --cached` file still on disk, modified file, untracked file, absent-on-disk directory index-prefix matching, trailing-slash matching, failed-probe fallback).
- `tests/docs-refs-check.test.ts` — existing-directory pass, missing-directory fail, and file-only symbol-ref boundary.
- `dist/orchestrator/run-task.js`, `dist/cli/index.js` — rebuilt bundles.
- `docs/patterns.md` — one sentence added to the existing trackedness-classifier entry noting the shared stage-path filter (QA edit, see Decisions below).

## How to Test

1. Start a task where the only change is deleting an unused file, and have the implementer remove it with git's own remove command (not a plain filesystem delete). Expected: the pipeline commits the deletion and continues to code review without stopping or re-entering implement.
2. Start a task where the implementer renames a file with git's own move command. Expected: the commit shows the rename (old path gone, new path present) and the pipeline continues.
3. Reference an existing project folder by name in a doc or task artifact, without a trailing slash (e.g. `` `src/orchestrator` ``). Expected: the pre-PR reference check does not report the folder as a missing file.

## Test Results

| Check | Result | Notes |
|---|---|---|
| AC-1 red-first (staged deletion, direct + routed) | Pass | Pre-fix: `pathspec 'dead.ts' did not match any files`; routed pre-fix also failed the evidence gate (exit 2) until iteration 2's fix. Post-fix: clean commit, clean tree. |
| AC-2 red-first (staged deletion + edit) | Pass | One commit contains both the `D` and the `M`. |
| AC-3 red-first (staged rename) | Pass | Old path absent from `git ls-tree` at HEAD, new path present. |
| AC-4 (unstaged deletion, unchanged) | Pass | Passes before and after the fix. |
| AC-5 red-first (QA-end commit) | Pass | Pre-fix: `failed to stage docs/pipeline-invocations.md`. Post-fix: one commit with the task artifacts and the deletion. |
| AC-6 (shared helper, unit-tested) | Pass | All eight required cases plus the round-1/round-2 review additions (index-prefix, trailing-slash, failed-probe fallback) covered in a temporary real-git repo. |
| AC-7 (early return removed) | Pass | `grep -c "already settled in history"` returns 0 in source and both bundles. |
| AC-8 (directory refs) | Pass | Existing directory passes; missing directory still fails; symbol-in-directory still fails. |
| AC-9 (mirror in sync) | Pass | `npm run sync-templates:check` passes; `cmp` shows byte-identical files. |
| AC-10 (red/green recorded, nothing skipped) | Pass | All red-first failures reproduced and recorded across all three iterations; 0 of this task's tests skipped in any full-suite run. |
| AC-11 (build and suite) | Pass | `npm run lint`, `type-check`, `docs-refs-check`, `sync-templates:check`, `npm test` (1268/1268, 1 pre-existing environment-gated skip unrelated to this task), and two fresh `npm run build` runs produced identical bundle SHA-256 hashes. |
| `git diff --check` | Pass | No whitespace errors. |
| E2E | N/A (per spec) | CLI-internal fix; covered by real-git integration tests instead. |

## Human Verification Required

None. Every check in the latest handoff `## Validation Outcomes` (through Iteration 3) reads `Pass`; nothing is `human_pending`.

**Handoff pre-merge checklist** (for the human, at `--pr`/merge time):
- [ ] Version correct — N/A here; this task makes no version change (per project policy, that's a separate release-step commit).
- [ ] Changelog updated — not yet; see Proposed Changelog below for the draft text, to be finalized at the release step.
- [x] PR body current — see `pr-body.md`.
- [ ] Final CI/CD checks green — not yet observable from this session; confirm once the PR's CI run completes.
- [x] Final diff matches spec intent — confirmed across three code-review rounds (final verdict: approved with nits).

## Decisions Made

- Added the one sentence spec's Docs Impact section assigned to QA: `docs/patterns.md`'s existing "git trackedness classifier" entry now notes that the shared stage-path filter routes all three commit sites, closing out review follow-up F5. `docs/patterns.md` has no `templates/` mirror (root-only, not in `CANON_OWNED`/`DELIMITED`), so no sync step was needed.
- No other doc edits were needed — nothing else in `docs/architecture.md`, `docs/codebase-map.md`, `docs/product-context.md`, or `docs/decisions.md` references the fixed behavior in a way this task contradicts.

## Open Questions

Code review closed with **approved with nits** after 3 rounds, but left eight numbered follow-ups (F1–F8) explicitly out of scope for this task and routed to the human:

- **F1**: a gitignored handoff path that still exists on disk reaches `git add -A` and dies with "paths are ignored" — pre-existing, not introduced by this task.
- **F2**: `commitTaskArtifactsToBase` (`src/orchestrator/git.ts`) has the same staged-deletion exposure this task fixed elsewhere, but was explicitly out of the spec's Affected Files / Non-Goals.
- **F3**: `.canon/templates/handoff.md` (and its mirror) still tells adopters that backticking a bare directory path always fails `docs-refs-check` — no longer true for existing directories.
- **F6**: the shared helper compares paths as raw strings rather than NFC-normalizing them, unlike its sibling classifiers — a very rare NFD-vs-NFC mismatch could drop a directory prefix.
- **F7**: the pre-existing committed-range deletion probe (`deletedInCommits`, byte-identical to `main`) has the same rename-pairing gap the implement-phase probe was fixed for in this task, but was ruled out of scope since it didn't regress.
- **F8**: the helper isn't aware of sparse-checkout skip-worktree entries; practically unreachable since canon has no sparse-checkout support today.

None of these block shipping this task; they're candidates for a follow-up issue, most plausibly bundled (a single issue could cover F1, F2, F6–F8 per the reviewer's note).

Maintenance: lessons-learned.md has 6 entries; no sweep is due yet (threshold ~15).

## Proposed Changelog

- **Auto-commit no longer fails when a handoff file was already removed or renamed through the index.** When the implementer removed a file with `git rm` or renamed one with `git mv`, staging the handoff's changed paths died with `fatal: pathspec '<path>' did not match any files`, and the pipeline re-entered implement and failed the same way on retry. Stage calls at auto-commit, the QA-end commit, and the human-review commit now skip a path only when it's absent from both the working tree and the git index — the removal or rename it already recorded is committed instead of blocking the run. ([#45](https://github.com/tstraub89/canon-ai/issues/45))
- **`docs-refs-check` no longer reports an existing directory as a missing file.** A backticked reference to a real directory without a trailing slash (for example `` `src/orchestrator` ``) was flagged as `missing file`, while the identical path with a trailing slash already passed. Plain backtick references now accept an existing directory the same way they accept an existing file; symbol, section, and anchor references are unchanged. ([#58](https://github.com/tstraub89/canon-ai/issues/58))

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 2
- Validation gaps: 0
- Notes: Delicate S-size task; 3 code-review rounds (2 changes_requested) to close AC-1's evidence-gate path and AC-6's helper test boundary; final approved_with_nits with F1-F8 follow-ups deferred to the human.
