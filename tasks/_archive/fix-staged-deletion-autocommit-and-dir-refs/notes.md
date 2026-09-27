# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] The `gitDirWritable` probe in `tests/run-task-safety.test.ts` targets this checkout's `.git`, but existing real-Git `makeGitFixture` tests run in temporary repositories without that gate. The spec's AC-8 currently permits skipping its required red-first tests when this checkout's `.git` is restricted.

[spec_review] Revision 1 closes the temporary-repo red-first gap. Its Docs Impact mentions `docs/patterns.md`, which is root-only despite an existing `templates/docs/patterns.md`; `src/lib/canon-owned.ts` does not manage that pair.
[spec] Revision 1: dropped the gitDirWritable skip escape; all real-git tests use temp repos (makeGitFixture), red/green recorded in handoff (AC-10). Folded Codex's plan note into Decision 2 + AC-7: the stageable.length===0 early return is unreachable today but would skip the deletion-only commit post-fix, so it is deleted. Added red-first QA-end case (git rm of a telemetry file reproduces exit 128) and directory-pathspec helper cases.
[implement] Direct real-git autoCommitCode tests needed a narrow export before the red run; without it, the subprocess failed at the test seam rather than at git add. After exporting only the function, the three staged-removal cases reproduced the pathspec failure, while plain rm already passed.
[implement-revision] `git ls-files --deleted` sees working-tree-only removals but not files already removed from the index by `git rm`; an implement evidence gate using it can reject a valid deletion before auto-commit runs. Use a HEAD-to-worktree diff when both staged and unstaged deletions count.
[implement-revision] A directory-prefix filter test must remove the directory from disk without staging the removal; a directory left on disk passes through lstat even if index-prefix matching is broken. Include a trailing-slash candidate and a failed Git probe to pin the keep boundary.
[implement-revision] The suite's existing deletion-evidence fake Git fixture modeled only `ls-files --deleted`; after changing the production probe to `git diff HEAD`, that fixture failed despite the real-git regression passing. Keep fake-command responses aligned with the exact production probe when a gate changes.
[implement-revision] `git diff HEAD --name-only --diff-filter=D` can hide a removed path when Git detects a rename to an intent-to-add or staged addition. The deletion-evidence probe needs `--no-renames` if it consumes only D paths; a real-Git intent-to-add fixture caught the difference.
