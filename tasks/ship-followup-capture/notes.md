# Notes

Raw observations from any phase. Prefix with phase name. Distilled into the task’s `lessons.md` fragment during QA; `--ship` folds it into `docs/lessons-learned.md`.

<!-- Append below this line -->
- spec (round 2): spec_review asked how a task-id reference is recognized. Chose explicit `task:<id>` prefix; bare ids count as untracked because the task id rule also matches free text like `tbd`. Recorded as an Author judgment call.
- [plan] Contradiction: `src/orchestrator/phases/qa.ts` stdout-salvage calls `taskPhase(qa, done)` directly; with the new qa gate a salvaged done.md lacking a valid Follow-ups section throws and aborts the run (qa left in_progress). qa.ts is not in Affected Files; plan tells the implementer not to edit it and to record the gap. Operator: consider an amendment adding a one-line `followupsProblem` guard there.
- [plan] Contradiction: `tests/run-task-safety-base-drift.test.ts` (~line 1848/1876) asserts `Auto-advanced 'qa'` on a done.md without Follow-ups; the new evidence check refuses it. Fixture needs `## Follow-ups\n\nNone.` — outside Affected Files. Implementer lists it as a planned deviation; operator must add it (and any other fixture the full suite turns up) to Affected Files before `--pr`.
- [plan] Open choices pinned: prose-only / empty Follow-ups body = unparseable; two tables or table + `None.` = unparseable; header-only table = 0 rows (valid); `None` matched case-insensitively with optional period. Tracked: only exact `#<n>` (so `#42, #43` and `owner/repo#42` = untracked); `dropped (reason)` = untracked; cell lowercased before `task:` id check.
- [plan] Correction to the fixture note above: `implement.md` makes Affected Files the scope cap, so the implementer records the `run-task-safety-base-drift.test.ts` fixture as a handoff Blocker and does not edit it. The operator amends Affected Files.
- [plan] `.claude/skills/canon-pipeline/recovery.md` (~line 103, and its mirror) has the manual `canon task phase <id> qa done` recipe. The new gate rejects a pre-change done.md there unless a `## Follow-ups` section is added first. Out of manifest; candidate for the same amendment.
