# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `--ship` archive staging includes `docs/lessons-learned.md` and `docs/task-quality-log.md`; preserved telemetry re-appended before `commitArchiveChanges()` would be committed/pushed for those two files rather than left uncommitted.

[spec] Resolved the spec_review blocker via option (a): single uniform re-append point AFTER `commitArchiveChanges()` (main.ts:2232), not after the merge. All three telemetry files end up as uncommitted supervising-checkout dirt; none is folded into the `chore: archive` commit. Rejected option (b) (let the archive absorb lessons-learned/task-quality-log dirt) because the pending suffix belongs to the SIBLING task — committing it under this task's archive commit misattributes it, and the sibling's own pipeline is the correct absorber. `rewriteArchivedTaskRefs()`/`stagedPaths` touch only lessons-learned.md + task-quality-log.md; pipeline-invocations.md is untouched, so one post-archive point serves all three. Added AC-11 pinning "committed blob excludes suffix, working copy includes it"; noted enlarged crash window (backup spans full merge→archive→push tail) in AC-7 + Known Risks.
