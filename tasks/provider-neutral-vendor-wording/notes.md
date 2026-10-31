# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] AC-10's grep `"plus network access"` cannot fail: on main the phrase wraps across `.canon/README.md:33-34` ("plus" / "network access"), so the grep already returns nothing. Plan Step 6 rewrites the paragraph regardless; verify AC-10 by reading.
- [plan] Concurrent task `no-base-scaffold-commit` (code_review) edits `src/lib/pipeline-policy.ts`, `tests/pipeline-policy.test.ts`, `tests/run-task-code-review.test.ts` near the scope-reason lines — expect a trivial rebase for whichever merges second.
