# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Pre-flight routing changes have two prompt surfaces: the review.md rejection block and the implement-revisions prompt that Codex receives after `preflight_rejections_current_loop > 0`.
[spec_review] `tests/run-task-prompts.golden.json` currently snapshots `promptImplementRevisions` only for the review-findings branch; the pre-flight branch is covered by a lighter assertion test in `tests/run-task-prompts.test.ts`.
