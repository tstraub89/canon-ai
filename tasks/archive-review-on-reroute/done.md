# Completion Summary: archive-review-on-reroute — Reroute archives review.md so a fresh round-1 review can't wedge on a stale trailing round verdict

> For the human. This is what you need to know.

## What Changed

Rerouting a task that had already gone through two or more code-review rounds used to leave the old, multi-round `review.md` sitting on disk. When the post-reroute round 1 review finished, its approval landed outside the old file's `## Round N` structure, and canon's verdict reader — which deliberately looks only at the *last* `## Round N` section — kept reading the stale round's `changes_requested` verdict instead of the fresh approval. The task would wedge with a "verdict mismatch" error, or, worse, could silently advance past code review on a stale approved verdict that had nothing to do with the new work. This task closes that hole: a reroute now archives each task's `review.md` to `review-prior-<n>.md` (numbered one above whatever's already there) before resetting anything else, so the fresh round-1 review starts on a clean file. It also drops the old review session ID so round 2 of the new review doesn't quietly resume a conversation that remembers every pre-reroute round, and it repoints the two prompt surfaces that used to say "see `review.md` for outstanding findings" at the archived file instead, since that file no longer exists in that spot after a reroute.

## Files Changed

- `src/orchestrator/review-archive.ts` — new shared module: the archive-rename helper (highest-numbered-archive-plus-one), the newest-archive lookup, and the `review-prior-` filename convention, all backed by one directory scan so they can't disagree.
- `src/orchestrator/main.ts` — reroute's per-task reset loop now archives every task's `review.md` before any `status.json` is touched (and aborts the whole reroute, with no status mutated, if any archive fails), and unconditionally drops the stored `claude_review` session.
- `src/task/index.ts` — `canon task reset-code-review`'s existing archive step now goes through the same shared helper (same behavior, just the numbering rule changed from "lowest free number" to "one above the highest").
- `src/orchestrator/prompts/index.ts` — the two reroute prompt lines that point a sibling task at its outstanding review findings now look up the archived file on disk at render time instead of naming the (now relocated) `review.md`.
- `docs/pipeline-orchestrator.md` (+ `templates/` mirror) — §"Human Reroute" documents the archive step, the template-stub exception, the fail-closed ordering, and the session drop.
- `tests/run-task-reroute-preflight.test.ts`, `tests/task-cli.test.ts`, `tests/run-task-prompts.test.ts` — new and updated coverage (see Test Results).
- `dist/orchestrator/run-task.js`, `dist/cli/index.js` — rebuilt bundles.

## How to Test

1. Take a task whose code review went through two or more rounds, then reroute it with a spec amendment.
   Expected: the old review is preserved under a "prior review" file in the task's folder (`review-prior-1.md`), and `review.md` itself starts clean for the new round.
2. Let the rerouted task's fresh review round finish with an approval.
   Expected: the pipeline accepts the verdict and moves on — no "verdict mismatch" error.
3. Reroute the same task a second time after another amendment.
   Expected: a second prior-review file (`review-prior-2.md`) appears alongside the first; nothing is overwritten or lost.
4. Reroute a task whose code review never actually ran yet (review file is still the blank template).
   Expected: no prior-review file is created, and the reroute proceeds normally.
5. Reroute a bundle where one task had a spec-gap escalation and its sibling had outstanding review findings.
   Expected: the sibling's instructions point at the preserved prior-review file for its findings, and that file exists and contains them.
6. Read the "Human Reroute" section of `docs/pipeline-orchestrator.md`.
   Expected: it explains that rerouting sets the old review aside under a prior-review name and starts the next review fresh.

## Test Results

| Check | Result | Notes |
|---|---|---|
| Red-first stale-round regression | Pass | Confirmed failing pre-fix with the exact `verdict mismatch` error, passing post-fix. |
| Red-first stale-evidence regression | Pass | Confirmed the pre-fix path silently advances `code_review` on a stale approved verdict; post-fix it correctly reports no usable evidence. |
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite: 1,175 tests, 1,174 passed, 1 environment skip (unrelated to this change). |
| `npm run build` | Pass | Both tracked `dist/` bundles rebuilt and committed. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| Golden regeneration | Pass | `UPDATE_GOLDENS=1` run produced a byte-identical golden file — the recorded prompt fixtures don't contain a non-advancing reroute-exempt sibling, so the changed pointer is covered by direct assertions instead (see code review N10). |
| Code review (3-lens: anchored Claude, cold Claude, cold Codex) | Approved with nits | All 13 ACs Pass. No correctness bugs. 5 non-blocking risk/guardrail findings and 10 nits, all in one small helper function and message wording — none change pipeline behavior on any path canon can currently produce. Two items filed to `docs/BACKLOG.md` rather than fixed here (see below). |

## Human Verification Required

None. All validation checks in `handoff.md`'s Validation Outcomes table resolved to `Pass`; nothing is `human_pending`.

**Handoff Validation pre-merge checklist:**
- [x] Version correct — no version bump proposed by QA; decided at the release step.
- [x] Changelog updated if needed — draft below, human finalizes.
- [x] PR body current — see `tasks/archive-review-on-reroute/pr-body.md`.
- [x] Final CI/CD checks green — lint, type-check, full test suite, build, docs-refs, template-sync all pass locally per handoff and independent code-review re-run.
- [x] Final diff matches spec intent — code review confirms all 13 ACs met and no Non-Goals violated.

## Proposed Changelog

- **`--reroute` no longer leaves a stale multi-round `review.md` behind to wedge the next code review.** Rerouting a task whose code review had already gone through multiple rounds kept the old `## Round N` sections on disk; because the verdict reader deliberately scopes to the *last* `## Round N` section, a fresh round-1 approval landing outside any round heading was invisible, and the phase gate reported the stale round's verdict instead — in the worst case, a stale approved verdict could let the phase silently advance without a real review having run. Reroute now archives the prior `review.md` to `review-prior-<n>.md` (numbered one above whatever's already there; a still-blank template is left in place) before resetting anything else, and drops the carried-over review session so round 2 doesn't resume a conversation that remembers every pre-reroute round. Reroute prompts that pointed a sibling task at its outstanding findings now point at the archived file instead of the now-relocated `review.md`.

## Decisions Made

- Archive step and the "find the newest archive" lookup live in one new module (`src/orchestrator/review-archive.ts`) precisely so the numbering rule and the lookup rule can never drift apart — this was the spec's central design constraint and code review confirmed it holds.
- `canon task reset-code-review`'s numbering rule changed from "lowest free number" to "one above the highest" to match the new shared allocator; its other behavior (phase guard, counter resets, session drop, stdout wording) is untouched and its existing tests pass unmodified.
- A still-blank (never-reviewed) `review.md` is left in place rather than archived — archiving a template that holds no findings would just be noise, and its absence already makes canon treat the next review as a genuine round 1.

## Open Questions

- Code review flagged two follow-ups as out of scope for this task and recommended filing them to `docs/BACKLOG.md` rather than fixing here — worth a decision on whether/when to pick them up:
  - **A stale `done.md` can let QA silently be skipped after a reroute** (the same shape of bug this task fixes for `review.md`, but for the QA phase's evidence check). Not present on disk yet as a filed backlog item as of this QA pass.
  - **The template-stub detection is a bare substring match** and could misclassify a real review that happens to quote a certain placeholder token as an unfilled template, leaving it un-archived. Narrow reachability (only via a state PR #228 newly admits to reroute), and the spec explicitly directed reusing this existing predicate rather than writing a new one.
- Five non-blocking risk/guardrail findings from code review (unguarded directory scan on a render path, the no-archive prompt fallback naming a file guaranteed absent, a repo-root-relative path in two operator messages, and two lower-severity items) are recommended as one small follow-up commit rather than blocking this task — see `review.md`'s Findings section for specifics if picking this up.

## Quality Log
- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Clean full-tier M/delicate task; all 13 ACs met with zero correctness bugs; code review's own findings are confined to one small helper and message wording, two filed as BACKLOG follow-ups rather than fixed inline.
