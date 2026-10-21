# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

spec (round 2): spec_review round 1 asked for a red-first QA check (edge-fine-tune). Added it to AC-7; no other changes.

[plan] Unit tests for the new validation.ts helpers (parseDocsRefsFindings, filterArtifactFindings) go in tests/run-task-safety.test.ts, not tests/run-task-validation.test.ts as patterns.md suggests: the latter is outside the spec's Affected Files.
[plan] Test pitfall: makeGitFixture has no .gitignore and runReviewLoopMain puts agent-invocations.log inside the repo. The fake agent appends to it during a fix session, which trips the scope guard. New tests must point FAKE_AGENT_LOG outside the repo.
[plan] AC-2's "counters equal today's main-driven failing-hook test" names a code_review-entry test. The plan reads this as: assert the same code_review counters stay 0, plus implement stays done.
[plan] The canonical citation sentence avoids backticked example paths, because the template .md files are scanned by the repo's own docs-refs-check.
