# Completion Summary: ship-followup-capture — Capture done.md follow-ups at ship

> For the human. This is what you need to know.

## What Changed

QA used to write follow-ups as prose in done.md, and nothing read them again. Now every done.md has a `## Follow-ups` table with a category, the item, and a Tracked state. QA must write the table before a task can pass the QA gate, and the human decides each untracked item at human_review, before the PR is opened. The decision is recorded in the table, so it ships in the task's own PR. When a task ships, `--ship` prints two lists after the final "Shipped" line: items marked for writing after merge, and items still undecided. `--ship` never prompts, files anything, edits files, or fails because of follow-ups. Canon does not file issues or write to a backlog; that stays with the operator.

## Files Changed

- `.canon/templates/done.md`, `templates/.canon/templates/done.md` — adds `## Follow-ups` after Open Questions and narrows Open Questions to decisions.
- `src/orchestrator/prompts/templates/qa.md` — QA rules for sources, category mapping, tracking defaults, escaping, and the `None.` form; golden fixtures in `tests/run-task-prompts.golden.json` regenerated.
- `src/orchestrator/followups.ts` — new parser and row classification, plus the ship block formatter.
- `src/orchestrator/validation.ts` — the qa phase gate rejects a missing or unparseable Follow-ups section.
- `src/orchestrator/main.ts` — ship reads follow-ups after merge proof and before archive, on both merge paths; prints the two blocks and one warning per missing or unparseable section.
- `src/orchestrator/phases/qa.ts` — on stdout salvage, a gate rejection now warns and leaves qa not done instead of crashing the run.
- `src/orchestrator/cli.ts` — `--ship` usage text.
- `.claude/skills/canon-pipeline/SKILL.md`, `.claude/skills/canon-pipeline/recovery.md`, and their `templates/` mirrors — human_review follow-up step, ship block instructions, and the valid-section requirement for `qa done`.
- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, `README.md`, `docs/codebase-map.md`, `docs/product-context.md`, `docs/decisions.md` — `--ship` descriptions, parser location, human flow, and the decision entry.
- Tests: `tests/followups.test.ts` (new), `tests/run-task-validation.test.ts`, `tests/run-task-ship-docs-fold.test.ts`, `tests/run-task-ship-helpers.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-safety-providers.test.ts`, `tests/run-task-safety-base-drift.test.ts`, `tests/run-task-safety-routing.test.ts`.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles.

## How to Test

1. Finish a task through QA. Open its done.md and confirm there is a Follow-ups table with a category and a Tracked value per item, or the line `None.`.
2. Remove the Follow-ups section from a done.md and run `canon task phase <id> qa done`. Expected: the phase is rejected with a message that names the expected header and the `None.` form.
3. Reach human_review. Expected: the session walks through each `untracked` row with four choices (file now, write after merge, drop, fix in this task), offers nits as one batch, and updates the Tracked cell before `--pr`.
4. Run `--ship` on a task with a mix of outcomes. Expected: after the final "Shipped" line, a "Post-ship follow-ups" block lists the `post-ship` rows, and an "Untracked follow-ups" block lists the `untracked` rows. Each block ends with its instruction line. Dropped and reference rows are not listed.
5. Run `--ship` on a task whose section is `None.` or whose rows are all dropped or tracked. Expected: no blocks and no warning.
6. Run `--ship` on a task with no Follow-ups section, or with a malformed table. Expected: one warning naming the task, and the ship still completes with exit 0 and archives the task.

## Test Results

| Check | Result |
|---|---|
| Lint (`npm run lint`) | Pass |
| Type-check (`npm run type-check`) | Pass |
| Unit tests (`npm test`) | Pass — 2,210 passed, 1 skipped, 2,211 total (from handoff) |
| Focused QA safety suites | Pass — 181/181 |
| Build (`npm run build`) | Pass — both dist bundles rebuilt |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| `git diff --check` | Pass |
| AC-12 source grep (`'issue'` in `src`) | Pass — no matches |
| E2E | Skipped — spec marks E2E N/A: no end-to-end surface |

Results are the implementer's handoff record. QA's code review re-ran the seven touched suites (641/641) and the two sync/docs checks in its own pass. QA did not re-run the full suite.

## Human Verification Required

Pending checks from handoff: None.

Not confirmable by QA:

- [ ] Version correct — not decided. The release step sets the bump tier under `docs/decisions.md` §"Versioning and release policy".
- [ ] Changelog updated — not applied. Proposed text is below for the release step to finalize.
- [ ] PR body current — drafted in `tasks/ship-followup-capture/pr-body.md`; recheck after `--pr`.
- [ ] Final CI/CD checks green — not run by QA.
- [ ] Final diff matches spec intent — human review.
- [ ] Human Test Plan (spec §Human Test Plan, steps 1–4) — not run. Step 5 (replay of the QA step on about five past tasks in a scratch copy) is deferred: watching live runs instead. At each human_review, compare the Follow-ups table against review.md findings and handoff Blockers; tighten the QA prompt or model if items go missing.

## Proposed Changelog

- **`--ship` lists the follow-ups QA recorded.** Each task's done.md now has a `## Follow-ups` table. The human decides at human review whether each item is filed now, written after merge, dropped, or fixed in the task. `--ship` then lists the items to write after merge and the items still undecided. Shipping never prompts, files, or fails because of follow-ups.
- **The QA gate requires a valid Follow-ups section.** `canon task phase <id> qa done` rejects a done.md that has no section or has a table it cannot read. When a QA salvage fails this gate, the run warns and leaves QA not done, rather than stopping with an error.

## Judgment Calls to Confirm

- Missing or unparseable section at QA — the qa gate rejects it, so QA repairs it; alternative: warn only at `--ship`.
- Unclear Tracked values — treated as `untracked` and shown; alternative: treat as a reference (hidden), or reject the table.
- How a task-id reference is written — explicit `task:<id>` prefix; alternative: a bare id counted as tracked when it names an existing task directory, live or archived.
- When the blocks print — after the final "Shipped" line, with rows read before archive; alternative: print as each task is read.
- Category vocabulary — fixed set of six values; alternative: free-text category.
- Docs drift items — each also gets a `scope` / `post-ship` Follow-ups row; alternative: leave them only in the Docs drift section.
- How the QA rules get tested — a one-off replay in the Human Test Plan, in a scratch copy; alternative: an automated test with a recorded model run.

## Decisions Made

- **`None.` must be the only visible line in the section.** Code review round 1 found that `None.` with other prose parsed as zero rows and dropped the prose items. It is now unparseable unless alone.
- **Tracked references are narrow.** Only a URL, an exact `#<n>`, a markdown link, or a valid `task:<id>` counts as tracked. `#42, #43` and `owner/repo#42` count as `untracked`, and so does `dropped (reason)`.
- **A header-only table is valid and has zero rows.** A prose-only or empty body is unparseable. Two tables, or a table plus `None.`, are unparseable.
- **The salvage catch is narrow.** `qa.ts` catches only `check-phase-gate:` errors. Other errors still rethrow. The blocked-session check runs first, so a blocked QA stays blocked.
- **Ship warns once per missing or unparseable task section** and continues.
- **Five human_review nits fixed inline on the task branch** (human decision, no reroute): the parser rejects the template's placeholder row; the missing-section gate message no longer ends in a doubled period; the ship warning distinguishes a missing done.md from a read error; the salvage catch matches a shared `PHASE_GATE_ERROR_PREFIX` constant; the recovery guide's gate sentence sits above its lead-in. The unclosed-fence message nit was dropped (cosmetic; the gate still rejects).

## Open Questions

None.

## Follow-ups

| Category | Follow-up | Tracked |
|---|---|---|
| nit | `src/orchestrator/followups.ts` ignores the unclosed-fence result, so a fenced heading gives a misleading "no section" message. The gate still rejects. | dropped |

## Quality Log

- Spec verdict: changes_requested
- Human reroute?: Yes
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Code review round 1 blocked on a `None.`-with-prose parser bug and three Affected Files gaps (AC-15 to AC-17, added by amendment); reroute fixed all of them, and five nits were fixed inline at human review and one was dropped.

## Root Cause

- execution: the parser accepted `None.` alongside other prose and silently dropped the prose items (`src/orchestrator/followups.ts`), found by cold Codex and Claude in code review round 1.
- spec-gap: Affected Files left out the QA stdout-salvage path (`src/orchestrator/phases/qa.ts`), so a gate rejection on salvage threw out of the run (AC-15). The plan had noted it and deferred it to the operator.
- spec-gap: Affected Files left out five QA fixtures (AC-16) and the canon-pipeline recovery guide (AC-17), which the new gate also affected.
