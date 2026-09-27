# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] The `gitDirWritable` probe in `tests/run-task-safety.test.ts` targets this checkout's `.git`, but existing real-Git `makeGitFixture` tests run in temporary repositories without that gate. The spec's AC-8 currently permits skipping its required red-first tests when this checkout's `.git` is restricted.

[spec_review] Revision 1 closes the temporary-repo red-first gap. Its Docs Impact mentions `docs/patterns.md`, which is root-only despite an existing `templates/docs/patterns.md`; `src/lib/canon-owned.ts` does not manage that pair.
[spec] Revision 1: dropped the gitDirWritable skip escape; all real-git tests use temp repos (makeGitFixture), red/green recorded in handoff (AC-10). Folded Codex's plan note into Decision 2 + AC-7: the stageable.length===0 early return is unreachable today but would skip the deletion-only commit post-fix, so it is deleted. Added red-first QA-end case (git rm of a telemetry file reproduces exit 128) and directory-pathspec helper cases.
