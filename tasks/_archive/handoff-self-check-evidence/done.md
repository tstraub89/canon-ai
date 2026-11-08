# Completion Summary: handoff-self-check-evidence — Handoff Self-Check evidence section with pre-flight and anchored verification

> For the human. This is what you need to know.

## What Changed

Implement handoffs now carry a `## Self-Check` table with three rows: test integrity, restatement sweep, and sibling parity. Each row names the evidence the implementer gathered, or `N/A` with a reason. Before code review, the pipeline's pre-flight rejects a handoff whose baseline section is missing, whose rows are missing, or whose evidence is empty, still a placeholder, or a bare `N/A`. The pre-flight checks presence only. The anchored review lens judges whether the evidence is true against the diff. On revision rounds, an Iteration can restate a row, and the latest filled row per check is the one judged; earlier rows stay as history. The implement, reroute, revision, and resume prompts were updated to match. A task already in review when you upgrade gets one rejection to add the baseline section in place.

## Files Changed

- `.canon/templates/handoff.md`, `templates/.canon/templates/handoff.md` — `## Self-Check` table and optional Iteration `### Self-Check` subsection (mirror synced)
- `.canon/templates/review.md`, `templates/.canon/templates/review.md` — Stage 1 Self-Check contradiction checklist item (mirror synced)
- `.claude/agents/code-review-anchored.md`, `templates/.claude/agents/code-review-anchored.md` — Stage 1 contradiction check against the effective record; Stage 2 omission rule (mirror synced)
- `src/orchestrator/validation.ts` — shared Self-Check presence/fill check wired into `validateHandoff` and `classifyPreflightBlockers` (format bucket)
- `src/orchestrator/prompts/templates/implement.md`, `src/orchestrator/prompts/templates/implement-reroute.md` — record evidence in `## Self-Check`; reroute carries whole-branch evidence forward
- `src/orchestrator/prompts/templates/implement-revisions.md` — Iteration `### Self-Check`; baseline in-place repair after a pre-flight rejection
- `src/orchestrator/prompts/templates/code-review-foreman.md` — re-review reads every Self-Check block and judges the effective record
- `src/orchestrator/prompts/index.ts` — interrupted-resume handoff summary names the Self-Check table
- `tests/run-task-validation.test.ts` — invalid and tolerated cases through both gates; format framing and rejection counter
- `tests/red-first-evidence-template.test.ts` — template shape and position, charter supersession and examples, review parsing
- `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` — prompt assertions, regenerated goldens, new pre-flight revision golden
- `tests/run-task-code-review.test.ts`, `tests/recovery-hints.test.ts`, `tests/run-task-safety-helpers.ts` — filled Self-Check sections in passing fixtures
- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` — presence/fill gate and anchored truth judgment
- `docs/architecture.md` — implement-to-review steps and gates list name the Self-Check presence check; QA also corrected the two lines that named `validateHandoff()` as the live pre-review gate, which is now `classifyPreflightBlockers()`
- `docs/codebase-map.md` — pre-flight gate row
- `docs/decisions.md` — enforcement-split decision (presence at pre-flight, truth at the anchored lens); Stage 1 checklist aligned
- `dist/orchestrator/run-task.js` — rebuilt bundle
- `tasks/handoff-self-check-evidence/lessons.md` — one lessons fragment entry (new)
- `tasks/handoff-self-check-evidence/done.md`, `tasks/handoff-self-check-evidence/pr-body.md` — QA artifacts

## How to Test

1. Run a small task through the pipeline (the spec's Human Test Plan).
2. Open its `handoff.md` after implementation.
3. Expected: a `## Self-Check` section with three rows. Each row names the tests and what they assert, the searches run for changed wording, and the parallel paths checked.
4. On a throwaway task, wait for implementation to finish, delete one Self-Check row from the handoff before review starts, and continue the run.
5. Expected: the handoff is sent back before review, with a message naming the missing row.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass per handoff: 2,125 tests, 2,124 pass, 0 fail, 1 skip. Note: the anchored review lens saw one failure, `tests/run-task-signals.test.ts` "SIGTERM shutdown writes exactly one exit marker", and it passed 3/3 when run alone. See Open Questions. |
| `npm run build` | Pass |
| `npm run docs-refs-check` | Pass (re-run by QA after the `docs/architecture.md` correction: "All refs OK") |
| `npm run sync-templates:check` | Pass per handoff (four managed pairs) |
| `git diff --check` | Pass per handoff |
| E2E tests | Not run; the handoff cites no E2E suite |

Skipped, not passing: the worktree-root test in `tests/run-task-safety-staging.test.ts` skipped because `.git` writes are restricted here, and the fish completion checks skip internally because fish is not installed.

QA did not re-run the suite. The results above come from the handoff's Validation Outcomes and the code review's own runs.

## Human Verification Required

None. No check in the latest Validation Outcomes is `human_pending`.

Pre-merge checklist (items QA cannot confirm):
- [ ] Version correct: a release-step decision, not QA's (see Proposed Changelog)
- [ ] Changelog updated if needed: release step (`/canon-changelog`)
- [x] PR body current: `tasks/handoff-self-check-evidence/pr-body.md` written in this pass
- [ ] Final CI/CD checks green: not checked by QA
- [ ] Final diff matches spec intent: not checked by QA beyond the code review's Stage 1 and Stage 2

## Proposed Changelog

Scope test: this changes what adopters see in their pipeline. A new pre-flight gate can reject a handoff, and the prompts change. It is in scope.

Proposed entry text (no version; the release step decides the tier):

### Added

- **Implement handoffs carry a Self-Check record that the pipeline checks before review.** The handoff gains a `## Self-Check` table with three rows: test integrity, restatement sweep, and sibling parity. Each row holds the evidence the implementer gathered, or `N/A` with a reason. Before code review, the pipeline sends back a handoff whose baseline section is missing, whose rows are missing, or whose evidence is empty, still a placeholder, or a bare `N/A`. The anchored reviewer checks each row's evidence against the diff. A task that is already in review when you upgrade gets one rejection to add the baseline section in place.

## Judgment Calls to Confirm

- Contradiction vs omission — a contradicted claim is a Stage 1 gap; an unmentioned changed behavioral test is a Stage 2 `risk/guardrail` finding; alternative: all mismatches in Stage 1, which costs a full round for bookkeeping gaps.
- Grandfathering in-flight tasks — no exemption; the first pre-flight after upgrade rejects a handoff without the section, and the message says to add it in place; alternative: gate only tasks created after the release.
- Adopter handoff-template overrides — prompts always instruct writing `## Self-Check`; alternative: skip the gate when an override template lacks the section, which would make the gate opt-out by accident.
- Iteration subsections in the pre-flight — not checked by the pre-flight, only by the anchored lens; alternative: require `### Self-Check` in every iteration, which penalizes rounds that change only handoff text.
- Implement-done evidence guard — unchanged; the check runs in `classifyPreflightBlockers` and `validateHandoff`, like AC Coverage; alternative: also block implement auto-advance.
- Revision-round Self-Check semantics — latest filled row per check wins, each row restates whole-branch evidence, and superseded rows are never judged; alternative: judge each block against the diff as it stood at the end of its own iteration, which needs per-round commit archaeology the lens does not do reliably.
- Stale effective row (true when written, false after a later round) — Stage 1 contradiction, because one appended row fixes it; alternative: Stage 2 omission, on the view that the later round just forgot bookkeeping.
- Test-integrity scope — behavioral tests only; regenerated snapshots and fixture-only edits can be summarized in one line; alternative: every changed test file.

## Decisions Made

- **Docs freshness correction (QA):** `docs/architecture.md` lines that named `validateHandoff()` as the live pre-review gate now name `classifyPreflightBlockers()`. `validateHandoff` has no callers in `src/` (it is test-only parity), so this matches the code. The naming predated this task, but this task touched those lines. `docs-refs-check` passes. No other doc was edited by QA.
- **Stage 1 wording:** the Self-Check contradiction check follows the red-first item in the anchored charter, with both historical-evidence examples from the spec.
- **Two-cell rule:** a recognized Self-Check row with a cell count other than two is rejected with a repair message naming the row. The handoff records this as a deviation from the plan. It keeps an unescaped `|` from silently truncating evidence. The code review accepted it as a nit.

## Open Questions

- **`run-task-signals` flake:** the anchored review lens saw one failure in `tests/run-task-signals.test.ts` ("SIGTERM shutdown writes exactly one exit marker") during its `npm test` run. It passed 3/3 alone, and the cold-Codex run had no failure. The handoff reports 0 failures. This is unverified. QA did not reproduce it. Decide whether it needs a follow-up task.
- **Unescaped pipes:** the code review's first nit suggests a follow-up that reads `cells.slice(1).join('|')` as evidence, rather than rejecting the row. Wait for real rejection data before changing it.
- **Placeholder detection:** only the leading `_(` marker counts. A wrapped placeholder (`**_(…)_**`) or a literal `N/A — <reason>` copy counts as filled. The review's nit #2 proposes the same strip the bare-N/A check uses. Not changed here.
- **Heading and table edge cases:** `## Self-Check (evidence)` gets a misleading "missing" message, and a table with no header row loses its first data row. Both fail closed. Review nits #3 and #4 are open.
- **`classifyPreflightBlockers` vs `validateHandoff`:** `docs/architecture.md` is corrected (above). `docs/patterns.md` (lines 85, 90, 296) and `docs/codebase-map.md` (line 138) still name `validateHandoff()` as the per-task check. The code review's nit #7 flagged this. QA left them alone as predating this task.
- **Human Test Plan:** steps 1–5 of the spec's Human Test Plan (a real run and a throwaway-task rejection) have not been done. They need a human run.

Maintenance: lessons-learned.md plus this task’s fragment have 31 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Root Cause

- spec-gap: spec_review round 1 found the whole-handoff contradiction check had no supersession rule, while the revision prompt appends only deltas, so a stale baseline `N/A` or an uncorrected false row could fail later rounds.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 1
- Notes: First spec_review round asked for historical-evidence supersession; code review was approved_with_nits; validation gap is the environment-skipped worktree-root staging test; npm test had an unreproduced signals flake.
