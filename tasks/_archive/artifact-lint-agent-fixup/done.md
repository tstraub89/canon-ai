# Completion Summary: artifact-lint-agent-fixup — Send task-artifact docs-refs failures back to the agent session that wrote them

> For the human. This is what you need to know.

## What Changed

Before canon commits a task's artifacts, it now runs the docs-refs checker on them. If the checker finds a broken reference in a file the agent wrote, canon resumes that agent's session and asks it to fix the line, then checks again, up to two attempts. This applies at two points: after implement (the handoff) and after QA (the summary and PR body). Before each fix session, canon records the content of everything outside the agent's own artifacts. If the session changes anything else, the run stops, names the files, and commits nothing. If the fix fails or references remain, canon warns and falls back to the old behavior, so a failed fix session never parks a phase. The four phase prompts also tell agents to cite repository files by full path and to cite deleted files with the markdown-link form, which keeps the errors from happening in the first place. Issue #102.

## Files Changed

- `src/orchestrator/main.ts` — fix-up loop around both implement auto-commit entries and the QA commit; scope guard; fallback warnings.
- `src/orchestrator/validation.ts` — runs the checker CLI, parses its output, filters findings to the task's own artifacts.
- `src/orchestrator/prompts/index.ts` — fix-up prompt for implement and QA (renders inline); shared citation rule.
- `src/orchestrator/prompts/templates/implement.md`, `implement-reroute.md`, `implement-revisions.md`, `qa.md` — full-path and deleted-file citation guidance.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — fix-up, fallback, scope guard, in-process QA resume (mirror synced).
- `docs/architecture.md` — implement artifact check before auto-commit.
- `docs/decisions.md` — "Auto-commit owned by the orchestrator" entry notes the orchestrator may resume implement to repair handoff references.
- `tests/run-task-safety.test.ts` — parsing, filtering, and snapshot tests; implement, review-entry, and QA integration fixtures.
- `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` — citation guidance pins and fix-up prompt goldens.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt.

## How to Test

1. Run a task whose implementer writes a handoff citing a path that doesn't exist (for example, a bare `src/...` path without the workspace prefix).
2. Expected: the log shows the implementer was asked to fix the handoff, one info line per attempt, and the run continues to code review without an `Auto-commit failed:` stop.
3. Run a task that deletes a file and whose QA summary cites that file in backticks.
4. Expected: QA fixes the citation before its commit, and `--pr` doesn't stop on a broken reference.
5. Expected: if the agent can't fix a line in two tries, implement's commit proceeds with a warning naming the finding (and fails with today's `Auto-commit failed:` message only if a hook rejects it); QA warns and reaches `human_review`.
6. Expected: if a fix session edits a file outside the task's artifacts, the run stops before any commit and names that file.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (full suite) | Fail – unrelated. Last full run (after iteration 3): 1,530 passed, 1 failed, 1 skipped. The failure is `tests/run-task-ship.test.ts:1529`, a fixture `git clone` that exited 128 in `simulateMergeOnOrigin`; it is outside this task's Affected Files. After the final iteration, only `tests/run-task-safety.test.ts` was re-run: 256 passed, 0 failed, 1 skipped. The full suite has not been re-run clean since. |
| `npm run build` | Pass (iteration 3; iteration 4 changed tests only) |
| `npm run docs-refs-check` | Pass (iteration 3) |
| `npm run sync-templates:check` | Pass (iteration 3) |
| E2E | N/A — spec AC-10 marks E2E as N/A |

## Human Verification Required

None.

Pre-merge checklist (items I could not confirm here):
- [ ] Version correct — decided at the release step, not by QA
- [ ] Changelog updated — human finalizes the entry below at release
- [ ] PR body current — drafted in `pr-body.md`; re-check after any change
- [ ] Final CI/CD checks green — not run from this session
- [ ] Final diff matches spec intent — the AC-1 red-first run is not reproduced in-tree (see Open Questions)

## Proposed Changelog

- **Broken references in a task's handoff or QA summary are fixed by the agent that wrote them, before the commit.** After implement, and again after QA, `canon run` checks the task's artifacts with the docs-refs checker. If it finds a broken reference, it resumes the same agent session to fix it, up to two attempts. A fix session may change only the task's own artifacts; if it changes anything else, the run stops and names the files. If a reference is still broken after two attempts, canon warns and continues as before.
- **QA summaries cite deleted files as links, not code spans.** The implement and QA prompts now ask agents to cite repository files by full path and to cite a deleted file as a markdown link, so the `--pr` docs-refs gate is less likely to stop a run.

## Decisions Made

- The fix-up prompt renders inline in `promptArtifactFixup` rather than from a new `artifact-fixup.md` template. A new template broke the pinned template-inventory test in `tests/sync-canon-templates.test.ts`, which is outside the spec's Affected Files (handoff Deviations table).
- The scope guard snapshots `HEAD` as well as dirty paths. A fix session that commits a clean tracked file would otherwise go unseen. This came from code review round 2 and was added in iteration 2.
- Both fix-up prompts forbid `git add` and `git commit`, added in iteration 2 beyond the spec's wording. This is a prompt-level instruction; the scope guard is the enforcement.
- Absent-checker behavior is tested through `main()` (iteration 4), not only at the runner boundary.
- Docs freshness: `docs/architecture.md` already describes the implement pre-commit check and the docs-refs gate lines still hold; no further edits were needed there.

## Open Questions

- **AC-1 red-first evidence.** The implementer could not reproduce the pre-change `Auto-commit failed:` result with the fixture's hook (handoff Blockers, iteration 1). The round 2 reviewer reproduced it in a scratch copy with the fix-up disabled, but the exact command was not saved. Rerun it if the red-first proof matters for the record.
- **Open code-review nits (non-blocking, approved with nits).** (a) `src/orchestrator/main.ts:412` uses `[git HEAD]` as a key in the same map as repo paths; a root file with that exact name could overwrite it. Negligible, cheap fix: a key that can't be a path. (b) The stop message says "Nothing was committed" even when the fix session moved HEAD. (c) The guard records the HEAD SHA, not the symbolic ref, so a branch switch at the same commit would pass.
- **Test gaps flagged in review.** The HEAD-commit scope case covers implement only, not QA. Both use the same code path, so the risk is low.
- **Out of scope, found during review:** the checker's entry guard does not handle a symlinked invocation path. It predates this task. A separate task should track it.
- **`docs/BACKLOG.md`** entry "Shift the `--pr` artifact-format gates left" is partly delivered (citation guidance and the pre-commit check). Left unedited; the human decides how to update the backlog.
- **Full suite not green on the final tree.** Rerun `npm test` to confirm the `run-task-ship` clone failure is transient.
- Maintenance: lessons-learned.md plus this task's fragment have 20 entries (19 `###` headings in the buffer, counting its template example, plus one here); a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 6
- Validation gaps: 2
- Notes: Implement left AC-1, AC-2, AC-3, AC-5, AC-6, AC-7 partial (missing integration cases); code review rounds 1-2 drove them to met. Full suite not re-run clean after final iteration.
