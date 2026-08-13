# Notes

Raw observations from any phase. Prefix with phase name. Distilled into `docs/lessons-learned.md` during QA.

<!-- Append below this line -->

[spec_review] Pre-flight routing changes have two prompt surfaces: the review.md rejection block and the implement-revisions prompt that Codex receives after `preflight_rejections_current_loop > 0`.
[spec_review] `tests/run-task-prompts.golden.json` currently snapshots `promptImplementRevisions` only for the review-findings branch; the pre-flight branch is covered by a lighter assertion test in `tests/run-task-prompts.test.ts`.
[implement] Code-review pre-flight now computes changed files once from the bundle-wide three-dot diff via `getAffectedFiles`; every per-task classifier receives that union so no bundled task can mark a peer-changed file as `Fail – unrelated`.
[implement-reroute] The amended slash-based Fail-unrelated reference gate had to preserve the existing `unit/e2e failure` vague-prose rejection; the implemented predicate treats `:line` as sufficient, and otherwise requires a path separator plus filename extension before Stage 1 credibility review.
[implement-reroute] Round 2 supersedes the prior basename-with-line accept path: `editor.spec.ts:1231` still passes the outer reference check, then the matcher scans changed-file last segments and classifies it as in-diff when the basename was changed.
[implement-reroute] Round 3 restores the pre-refactor all-row plain-Fail scan for non-required Validation Outcomes rows; replacing a broad gate with required-only iteration needs explicit non-required-row tests.



