# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->

spec (round 2): spec_review round 1 asked for a red-first QA check (edge-fine-tune). Added it to AC-7; no other changes.

[plan] Unit tests for the new validation.ts helpers (parseDocsRefsFindings, filterArtifactFindings) go in tests/run-task-safety.test.ts, not tests/run-task-validation.test.ts as patterns.md suggests: the latter is outside the spec's Affected Files.
[plan] Test pitfall: makeGitFixture has no .gitignore and runReviewLoopMain puts agent-invocations.log inside the repo. The fake agent appends to it during a fix session, which trips the scope guard. New tests must point FAKE_AGENT_LOG outside the repo.
[plan] AC-2's "counters equal today's main-driven failing-hook test" names a code_review-entry test. The plan reads this as: assert the same code_review counters stay 0, plus implement stays done.
[plan] The canonical citation sentence avoids backticked example paths, because the template .md files are scanned by the repo's own docs-refs-check.
[implement] A review-entry fix-up session runs after the phase is done; its failure must be caught inside the fix-up loop so the existing park wrapper does not reopen the completed phase.
[implement] The fixture pre-commit hook did not reject the intentionally broken implement handoff when the fix-up call was disabled. The QA baseline red run did reproduce the intended broken committed artifact.
[implement-revision] A temp path can have a `/var` alias while Git resolves it under `/private/var` on macOS. A CLI script guarded by `import.meta.url` must be invoked with the canonical `fs.realpathSync` path in hook fixtures, or the script can silently skip its CLI behavior.
[implement-revision] `setupInvocationLoggingCliTools` records agent argv inside an `{agent, argv}` object, while small custom agent shims may log argv arrays directly. Resume-count assertions should normalize both record shapes and inspect argv tokens, not search the whole prompt text for `resume`.

[implement-revision] A test fake that writes `status.json` directly must model the derived top-level status itself; unlike the production status writer, raw JSON fixture writes do not derive it from completed phases. The QA fix-up fixture now advances its fake top-level status to `human_review` when it marks QA done.
[implement-revision] Porcelain-only scope snapshots miss a session that stages and commits a previously clean tracked file; compare `HEAD` across each fix-up session as well as dirty-path content.
