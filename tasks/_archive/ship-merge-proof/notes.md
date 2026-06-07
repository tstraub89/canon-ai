# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] `commitHumanReviewFiles()` commits/pushes before `reportOrCreatePR()`; recording new status from the PR-reporting path needs an explicit second persistence step or it leaves dirty unpushed task state.
[implement] A second --pr can legitimately create an artifact commit after the pr.number commit because canon snapshot refresh records the new HEAD; AC-1b should assert clean final state, not zero new commits.
[implement] In --ship cleanup-only runs, switching to base can make unmerged non-worktree task status absent from the working tree; proof needs the pre-switch status as fallback for failure reporting.
[implement-reroute] The amended ancestor proof needs two separate negative fixtures: an existing unrelated head for branch-reuse ancestry failure, and a missing head object for AC-15 materialization failure.


