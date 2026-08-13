# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->
[spec_review] `syncWorktreeArtifacts()` does not mirror `notes.md`, but AGENTS still treats notes as part of the final task-artifacts commit. A worktree task can therefore lose notes edits before human_review unless the spec adds an explicit sync/flush rule for notes.
[implement] `REPO_ROOT` now resolves through `git rev-parse --git-common-dir`, so the prompt snapshot test picks up the canonical repo path instead of the older worktree path. The golden file had to be updated to match the new test-time root.
