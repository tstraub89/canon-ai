# Spec: red-first-evidence-slot — Red-first evidence section in the handoff, checked by the anchored lens

> Written by: Claude | Review by: Codex
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

GitHub issue #105. The implement prompt's red-first checkpoint tells the implementer to run a bug fix's regression test against the pre-fix code, confirm it fails for the reason the spec states, and "report the red run (command + observed failure) in handoff.md". The instruction is prose only:

- The handoff template has no place for the red run. Implementers who do report it invent their own heading: archived handoffs use `## Red-First Evidence`, `## Red-first evidence`, `### Red-first evidence` inside Iteration sections, and `### Red-first regression evidence`, as prose plus a fenced command.
- The template's Blockers section names only the `[ambiguity]` label, although all three implement prompts tell the implementer to record a `[wrong-premise]` Blocker when the test cannot be made to fail.
- No later phase checks for the red run. The anchored code-review lens's Stage 1 checks validation outcomes, AC coverage and dropped sections, but says nothing about red-first evidence.

In a downstream project an implement session applied the fix first, then wrote the tests for two red-first ACs, and marked both ACs met. Neither test had ever run against the pre-fix code. The only sign was the absence of failing output in the handoff, which a reviewer had to notice unprompted. The issue shows the gap directly: the handoff template and the anchored charter in this repo contain no red-first text (confirmed by grep), and nothing parses `[wrong-premise]`.

This is a missing feature in the handoff contract, not a code bug, so no red-first test applies to this task itself.

## Decision

Give the red run a fixed place in the handoff and make the anchored lens check it.

1. **Handoff template.** Add a `## Red-First Evidence` section with one table row per red-first AC. The row records the AC, the test command, what it ran against (the commit the pre-fix code was at), an excerpt of the observed pre-fix failure, and the post-fix result. Two alternatives are allowed in place of a failure excerpt: a pointer to a `[wrong-premise]` Blocker, or, for a spec that uses the environment-bound escape, either what the named alternative produced or a statement that it was not executable and why. The template's placeholder row reads as "none" for a task with no red-first ACs. The commented Iteration skeleton gains a `### Red-First Evidence` subsection for rounds that add or change a red-first test or add missing evidence. The Blockers section names the `[wrong-premise]` label next to `[ambiguity]`.
2. **Implement prompts.** Each of the three implement prompts replaces its "report the red run in handoff.md / in the handoff delta" sentence with one that names the Red-First Evidence section, and states the pre-fix state for that prompt: the task's base commit for a fresh implement; the task branch's HEAD before this round's edits for revisions and reroutes. The prompts tell the implementer to write the test and run it against that state before changing non-test code; files that exist only to support tests count as test files. The revisions prompt also says that when a review round flags missing red-first evidence, the implementer runs the test against the recorded pre-fix commit (for example in a scratch checkout of that commit with only the test applied) and records the row; it does not need to re-do the fix. The reroute prompt tells the implementer to carry existing Red-First Evidence rows forward when it rewrites the handoff.
3. **Anchored lens Stage 1.** For each AC the spec states as a red-first regression test, the anchored lens looks for a Red-First Evidence row across the baseline section and every Iteration subsection. The row must show a run against pre-fix code (a commit that predates the fix) with a failure excerpt consistent with the reason the spec states, or a `[wrong-premise]` Blocker reference, or the environment-bound escape's outcome or stated non-executability. A missing row, or a row with no pre-fix run and no allowed alternative, is a Stage 1 gap. *When* the test was first run is guidance for the implementer, not a gap condition: evidence recorded later, against the pre-fix commit, satisfies the check, so a gap can always be closed by a revision round.
4. **Foreman and review template.** On round 2 and later the foreman directs the anchored lens to the latest Iteration section; it also tells the lens that red-first evidence is read across the whole handoff. The review template's Stage 1 Validation Gate list gains a red-first evidence checkbox.

**No mechanical pre-flight check.** The issue proposes pre-flight flagging as one option. Finding red-first ACs means matching free spec prose (33 archived specs mark them at least seven different ways), and the pre-flight was deliberately made structural rather than spec-matching after prose matching between spec and handoff falsely blocked valid work three times (#163, #200, add-xs-tier; recorded in `docs/pipeline-orchestrator.md` and in comments in `src/orchestrator/validation.ts`). The check lives in Stage 1, where the reviewer reads the spec. `docs/decisions.md` records this.

## Non-Goals

- No pre-flight gate, parser, or orchestrator code that reads the Red-First Evidence section or `[wrong-premise]` Blockers. AC-6 backs this with a grep.
- No spec-side marker for red-first ACs. The lens recognizes them by the spec's wording, as spec_review already does; a tag would have to reach every spec-authoring carrier to be useful.
- No change to how spec authors write the environment-bound escape. The spec template says the AC states it while the spec prompts say *Problem* states it; aligning those is separate work.
- No change to the cold lenses or the foreman's synthesis rules beyond AC-5's directive line.
- No reviewer re-execution of red-first tests against the base. The lens judges the recorded evidence.
- No migration of existing tasks' handoff.md copies. New tasks pick up the template; an adopter override in `tasks/_templates/handoff.md` keeps its own content.

## Acceptance Criteria

- [ ] AC-1: `.canon/templates/handoff.md` has a `## Red-First Evidence` H2 between `## Blockers` and `## Validation Outcomes`. It contains a guidance note and a table with the columns AC, Command, Ran against, Pre-fix failure, Post-fix result. The note says: one row per red-first AC; "Ran against" is the commit of the pre-fix code; the two allowed alternatives (a `[wrong-premise]` Blocker reference; the environment-bound escape's outcome or its stated non-executability); and that a task with no red-first ACs leaves the "none" placeholder row. Verified by a test that reads the template and asserts the heading, its position, and the five column headers.
- [ ] AC-2: the template's `## Blockers` section names `[wrong-premise]` (a red-first test that cannot be made to fail for the stated reason) alongside `[ambiguity]`. The commented Iteration skeleton gains a `### Red-First Evidence` subsection with the same five columns. Verified by the same test.
- [ ] AC-3: in each of the three implement prompt templates, the sentence that tells the implementer to report the red run is replaced by one naming the Red-First Evidence section (the revisions and reroute prompts name the Iteration subsection for a round's new rows) and the pre-fix state for that prompt (fresh: the task's base commit; revisions and reroute: the branch HEAD before this round's edits). The revisions prompt adds the recovery instruction for missing evidence from Decision 2, and the reroute prompt's handoff-rewrite step says to carry Red-First Evidence rows forward. The existing `[wrong-premise]` and environment-bound wording stays. Verified by a prompt test asserting, for each rendered prompt, the string `Red-First Evidence` and its pre-fix state phrase, that the old "Report the red run" sentence is gone, and the revisions recovery and reroute carry-forward sentences; the prompt golden snapshots are regenerated.
- [ ] AC-4: `.claude/agents/code-review-anchored.md` Stage 1 gains a numbered item implementing Decision 3, including that late-recorded evidence against the pre-fix commit satisfies it. The charter names no internal prompt template. Verified by a test asserting the Stage 1 item mentions `Red-First Evidence`, `[wrong-premise]`, and the pre-fix commit, and by `npm run sync-templates:check`, which runs the canon-owned leak scan.
- [ ] AC-5: the foreman prompt's round-2+ directive keeps pointing the anchored lens at the latest Iteration section and adds that red-first evidence is read across the whole handoff. `.canon/templates/review.md`'s Stage 1 Validation Gate list gains a checkbox for red-first evidence. Verified by a prompt test on the rendered round-2 foreman prompt, a test asserting the review template line, and regenerated goldens.
- [ ] AC-6: no orchestrator code reads the new section or the label. `grep -rniE "red-first|wrong-premise" src/ --include='*.ts'` returns matches only under `src/orchestrator/prompts/`. Verified by running that grep in the handoff's validation notes.
- [ ] AC-7: the `templates/` mirrors of every edited canon-managed file match their roots (`npm run sync-templates:check` passes), and `dist/` is rebuilt so the bundled prompts carry the new text.
- [ ] AC-8: `docs/decisions.md` gains a short entry recording that red-first evidence is checked in the anchored lens's Stage 1, not pre-flight, citing the structural-pre-flight reasoning in `docs/pipeline-orchestrator.md` (by section heading text exactly as it appears) rather than restating history. The "Two-stage code review" entry's Stage 1 scope list adds red-first evidence.

## Design

### Affected Files

| File | Change |
|---|---|
| `.canon/templates/handoff.md` | Add `## Red-First Evidence` section; name `[wrong-premise]` in Blockers; add Iteration-skeleton subsection |
| `templates/.canon/templates/handoff.md` | Generated mirror |
| `.canon/templates/review.md` | Stage 1 red-first evidence checkbox |
| `templates/.canon/templates/review.md` | Generated mirror |
| `.claude/agents/code-review-anchored.md` | Stage 1 red-first evidence item |
| `templates/.claude/agents/code-review-anchored.md` | Generated mirror |
| `src/orchestrator/prompts/templates/implement.md` | Replace the report sentence; name the section and the base-commit pre-fix state |
| `src/orchestrator/prompts/templates/implement-revisions.md` | Same, for a revision round; missing-evidence recovery |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Same, for a reroute round; carry rows forward in the handoff rewrite |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Round-2+ directive: red-first evidence read across the whole handoff |
| `tests/run-task-prompts.golden.json` | Regenerated prompt snapshots |
| `tests/run-task-prompts.test.ts` | AC-3 and AC-5 prompt assertions |
| `tests/red-first-evidence-template.test.ts` | New: AC-1, AC-2, AC-4 and AC-5 template and charter assertions |
| `docs/decisions.md` | AC-8 entry and Stage 1 scope line (root-only doc, no mirror) |
| `dist/orchestrator/run-task.js` | Rebuilt bundle carrying the prompt changes |

### Interaction Dependencies

- The handoff coverage parsers read only the `## Changes` table and Iteration `### Changes` tables, and the near-miss scan reads only a table's first column. The new table's first column holds AC ids, which the path parser does not accept as paths, so it does not affect diff coverage.
- `tests/sync-canon-templates.test.ts` rejects a canon-owned file that names an internal-only prompt template, so the anchored charter and handoff template must describe the implement phase without naming its template file.
- The code-review foreman passes the anchored lens the spec, the full handoff and the diff. On round 2+ it also directs the lens to the latest Iteration section; AC-5 keeps the red-first check cumulative.
- The reroute prompt has the implementer rewrite handoff.md wholesale; AC-3 makes it carry Red-First Evidence rows forward so the cumulative check still finds them.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/decisions.md` is edited (AC-8). `docs/pipeline-orchestrator.md` describes the structural pre-flight but not handoff sections or red-first evidence; QA checks it. `docs/patterns.md` does not cover either.

## Known Risks

- **Over-blocking on non-bug tasks.** A lens that treats any test-adding AC as red-first would raise false Stage 1 gaps on features. Decision 3 scopes the item to ACs the spec states as red-first regression tests.
- **Evidence that is fabricated rather than missing.** A pasted failure excerpt is agent-reported, not machine-attested. The lens checks consistency with the spec's stated reason; attested receipts are a separate BACKLOG entry.
- **Golden churn.** Prompt edits break the golden snapshots; regenerating them is part of AC-3.
- **Revision rounds.** A round that changes a red-first test records evidence in its Iteration subsection; the lens must read across the baseline section and Iteration subsections (AC-4, AC-5).
- **Unclosable gaps.** If the lens treated "first ran after the fix" as a gap, no later round could clear it and the task would loop to the review cap. Decision 3 makes the gap condition the absence of a pre-fix run, and the revisions prompt gives the recovery.
- **Stage 1 halts Stage 2.** A missing evidence row costs a round without Stage 2 findings, like other Stage 1 gaps. That is accepted: the row is cheap to add and the recovery is explicit.

## Human Test Plan

1. Start a new bug-fix task and open its handoff template.
2. Expected: a Red-First Evidence section sits between Blockers and Validation Outcomes, with columns for the AC, the command, what it ran against, the pre-fix failure and the post-fix result, and Blockers mentions the wrong-premise label.
3. Run a bug-fix task through the pipeline whose handoff leaves the red-first section empty for a red-first AC.
4. Expected: code review lists the missing red-first evidence as a spec-compliance gap and sends the task back.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A — feature work on the handoff contract
- [x] (Refactors) N/A
