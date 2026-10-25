# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- [plan] Pre-existing: watch's `printUsage(stderr)` writes each line via raw `process.stderr.write` with no `\n`, so the usage block renders as one run-on line today. The shared newline-terminated `WATCH_USAGE` (Decision 2) fixes it; flagged in plan so review doesn't read the stderr-shape change as scope creep.
- [plan] AC-4 `task accept --reason "--help"`: plan prefers an end-to-end fixture assertion, falling back to the AC's "or the parse result carries it" clause via `parseTaskAcceptArgs()` if no cheap accept fixture exists; implementer records which in the handoff.
- [plan] `task phase` usage is rendered from `PHASE_ORDER`/`VALID_STATUSES`/`VALID_VERDICTS` (no literal copy), so `tests/run-task-validation.test.ts` retargets to the rendered `TASK_SUBCOMMAND_ARGS.phase.usage` rather than a source-text read.
- code_review r2 (foreman): un-backticked the old completion-spec path in review.md, review-cold-codex.md, review-cold-codex-run-2.md so docs-refs-check passes (Codex P2 on the review artifact; reviewer-owned text, not implementer code).
- [implement-revision] A synthetic `preScanArgs` declaration with `freeTextSlots: [0]` can make help-after-value regressions vacuous because flag parsing does not advance the positional counter; use production declarations for those cases.
