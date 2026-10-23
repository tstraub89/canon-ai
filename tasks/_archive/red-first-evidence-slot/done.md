# Completion Summary: red-first-evidence-slot — Red-first evidence section in the handoff, checked by the anchored lens

> For the human. This is what you need to know.

## What Changed

The handoff template now has a fixed place for the red run. A bug-fix task's handoff gets a Red-First Evidence table with one row per red-first acceptance criterion: the test command, the commit the pre-fix code was at, the failure the test showed there, and the post-fix result. A `[wrong-premise]` blocker is named next to `[ambiguity]` in the Blockers section. The three implement prompts now point the implementer at that table and tell it to run the test against the pre-fix state before changing non-test code. The anchored code-review lens gets a Stage 1 item that checks each red-first AC for a row showing a pre-fix run, a `[wrong-premise]` reference, or the environment-bound escape's outcome. Late evidence recorded against the pre-fix commit counts, so a revision round can close a gap without redoing the fix. The change is guidance only: no orchestrator code reads the new section or the label. Issue #105 is the source.

## Files Changed

- `.canon/templates/handoff.md` — Red-First Evidence section, `[wrong-premise]` in Blockers, Iteration-skeleton subsection
- `templates/.canon/templates/handoff.md` — mirror of the above
- `.canon/templates/review.md` — Stage 1 red-first evidence checkbox
- `templates/.canon/templates/review.md` — mirror of the above
- `.claude/agents/code-review-anchored.md` — Stage 1 red-first evidence item
- `templates/.claude/agents/code-review-anchored.md` — mirror of the above
- `src/orchestrator/prompts/templates/implement.md` — names the section and the base-commit pre-fix state
- `src/orchestrator/prompts/templates/implement-revisions.md` — names the Iteration subsection, adds the missing-evidence recovery
- `src/orchestrator/prompts/templates/implement-reroute.md` — names the Iteration subsection, carries rows forward on the handoff rewrite
- `src/orchestrator/prompts/templates/code-review-foreman.md` — round 2+ directive reads red-first evidence across the whole handoff
- `tests/run-task-prompts.test.ts` and `tests/run-task-prompts.golden.json` — rendered prompt assertions, regenerated snapshots
- `tests/red-first-evidence-template.test.ts` — new; template and charter assertions
- `docs/decisions.md` — new entry: red-first evidence is checked in anchored Stage 1, not pre-flight; Stage 1 scope list updated
- `dist/orchestrator/run-task.js` — rebuilt bundle

## How to Test

1. Start a new bug-fix task and open its handoff template.
2. Expected: a Red-First Evidence section sits between Blockers and Validation Outcomes, with columns for the AC, the command, what it ran against, the pre-fix failure and the post-fix result. Blockers names both `[ambiguity]` and `[wrong-premise]`.
3. Run a bug-fix task through the pipeline whose handoff leaves the red-first section empty for a red-first AC.
4. Expected: code review lists the missing red-first evidence as a spec-compliance gap and sends the task back.
5. Then add a row for that AC, recorded against the pre-fix commit, in a revision round.
6. Expected: the next review passes the check without the fix being redone.

## Test Results

Results below are the ones recorded in `tasks/red-first-evidence-slot/handoff.md` during implement. QA did not re-run them.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,561 passed, 1 skipped, 0 failed (handoff record) |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js` |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |
| Prompt tests (`tests/run-task-prompts.test.ts`) | Pass | 55 tests |
| Template/charter tests (`tests/red-first-evidence-template.test.ts`) | Pass | 2 tests |
| AC-6 source grep | Pass | Only `src/orchestrator/prompts/index.ts:157` matched, under `src/orchestrator/prompts/` |

## Human Verification Required

None.

Handoff Validation pre-merge checklist:
- [ ] Version correct: not decided here. The release step picks the bump tier (see Proposed Changelog).
- [ ] Changelog updated if needed: the proposed entry below is for the release step; nothing has been written to `CHANGELOG.md`.
- [x] PR body current: `tasks/red-first-evidence-slot/pr-body.md` drafted in this QA pass.
- [ ] Final CI/CD checks green: not checked in this session.
- [x] Final diff matches spec intent: the code-review lens and the QA diff check both found the 15 changed files consistent with the spec's Affected Files.

## Proposed Changelog

- **Bug-fix tasks record red-first evidence in the handoff, and code review checks for it.** The handoff template gets a Red-First Evidence section with one row per red-first acceptance criterion: the test command, the commit the pre-fix code was at, the failure it showed there, and the post-fix result. A `[wrong-premise]` blocker can stand in for a failure excerpt when the test cannot be made to fail. Code review flags a red-first criterion with no pre-fix run as a spec-compliance gap. A revision round can close the gap by running the test against the pre-fix commit, without redoing the fix.

## Decisions Made

- **Red-first evidence is checked in the anchored lens's Stage 1, not in a pre-flight gate.** Finding red-first ACs means reading spec prose, and the structural pre-flight was kept free of spec matching for the reasons recorded in `docs/pipeline-orchestrator.md`. `docs/decisions.md` records this.
- **The gap condition is "no pre-fix run," not "first run after the fix."** Otherwise no later round could clear a gap. Late evidence against the pre-fix commit satisfies the check (spec Decision 3).
- **Reroute evidence goes in that round's Iteration subsection, and the baseline rows are carried forward on the handoff rewrite.** This is the one deviation the implementer recorded in the handoff; it follows the AC-3 wording.
- **Stage 1 halts Stage 2 on a missing evidence row.** This matches how other Stage 1 gaps work and is the accepted risk in the spec.

## Open Questions

- **Reroute prompt wording.** `src/orchestrator/prompts/templates/implement-reroute.md` has the implementer rewrite `handoff.md` wholesale (step 7) but record new rows in "this round's Iteration subsection." A rewritten handoff may have no Iteration section yet, so the implementer has to create one or use the baseline table. Both reviewer lenses flagged this as low severity and not blocking. Tighten it in a follow-up if it shows up in a real reroute.
- **Charter test is loose.** `tests/red-first-evidence-template.test.ts` matches "pre-fix" and "Red-First Evidence" as separate substrings, so it would still pass if the late-evidence clause were removed. It also slices from the first HTML comment. Low severity; left as a nit.
- **Curly apostrophes.** The new text in the implement prompts uses `’`, and the test regexes depend on that character. Cosmetic.
- **`docs/pipeline-orchestrator.md` does not mention red-first evidence.** QA checked it for contradictions and found none (its Stage 1 and pre-flight passages are still accurate), so no edit was made. Whether it should describe the new check is a judgment call for the human.

Maintenance: lessons-learned.md plus this task’s fragment have 22 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Doc-and-prompt-only change; code review approved with nits (reroute wording, loose charter test); no human_review rejection yet.
</content>
