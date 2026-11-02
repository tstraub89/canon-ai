# Completion Summary: spec-judgment-calls — Surface judgment calls in specs

> For the human. This is what you need to know.

## What Changed

Specs now have a `## Judgment Calls` table right after `## Decision`. Each row names a choice the spec made, the option chosen, the strongest alternative, why the choice fits, and who decided it: `Human` when you explicitly picked the option, `Author` when it is the author's lean. The spec-writing guidance (skill, pipeline spec prompt, revision prompt) now requires authors to list every real judgment call, and grill mode asks for the runner-up's strongest case and what would flip the call. The pipeline `spec_review` raises a Blocking finding when a spec makes a call it does not list, but only when the reviewer can name the call, a defensible alternative the spec does not record, and the AC or behavior that would differ. A missing section by itself is not a finding. QA now lists every `Author` row in `done.md` under `## Judgment Calls to Confirm`, and in the PR body for single tasks, so the calls you did not explicitly make are visible before merge. Nothing is enforced by a parser or lint; this is guidance plus review.

Two pieces of the change are under test: a canonical-text test pins three sentences (the definition, the "settled choices are not calls" sentence, and the review bar) across every carrier, and the test was shown to fail when one carrier drops its sentence.

## Files Changed

- `.canon/templates/spec.md` — Judgment Calls section and checklist item
- `.canon/templates/spec-review.md` — Shape Check question
- `.canon/templates/done.md` — `## Judgment Calls to Confirm` before Decisions Made
- `.claude/skills/canon-spec/SKILL.md` — author rule, self-check, grill counter-case, Phase 5 presentation
- `.claude/skills/canon-spec-review/SKILL.md` — Agent C item (11) at STRONG; ten → eleven
- `.claude/skills/canon-pipeline/SKILL.md` — human spec gate reminder for `Author` rows
- `docs/pipeline-orchestrator.md` — Shape Check restatement and definitions
- `src/orchestrator/prompts/index.ts` — `promptSpec` self-check item
- `src/orchestrator/prompts/templates/spec.md`, `spec-revision.md`, `spec-review.md`, `qa.md` — author, revision, review, and QA guidance
- `tests/run-task-prompts.test.ts` — canonical-text parity test and rendered-prompt assertions
- `tests/run-task-prompts.golden.json` — seven prompt snapshots regenerated (`promptSpec`, `promptSpec_withDocsMap`, `promptSpecRevision`, `promptSpecRevision_withDocsMap`, `promptSpecReview`, `promptQa`, `promptQa_withTemplate`)
- `dist/orchestrator/run-task.js` — rebuilt bundle
- Generated `templates/` mirrors of each canon-managed file above

## How to Test

1. Start a new spec with the spec skill for a small feature with an obvious fork, such as whether a new warning blocks or only warns.
2. During the question round, check that the assistant gives its recommendation, the best case for the other option, and what would change its mind.
3. Check that the finished spec has a "Judgment Calls" section after "Decision" listing that fork with the alternative and who decided.
4. At the approval stop, check that the assistant names the calls it made that you did not explicitly choose.
5. Remove one row from the section and run the pipeline's spec review. Expected: the review requests changes and names the call, the alternative, and what would differ.
6. Run the spec review on a small spec with no Judgment Calls section and no contested choice. Expected: no change request about the missing section.
7. Let a task finish QA. Expected: `done.md` has a "Judgment Calls to Confirm" section listing the assistant's own calls, and the draft PR body lists them too.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (`UPDATE_GOLDENS=1`, full suite) | Pass — 2,067 passed, 1 skipped, 0 failed |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| Canonical-text parity test, D removed from one carrier | Fails as expected; passes when restored (red-first, recorded in handoff) |
| Section-less spec marked `spec done` (AC-10) | Pass — existing test at `tests/task-cli.test.ts:442-452` |
| Golden comparison (AC-12) | Pass — exactly the seven named keys changed |

The one skipped test is the linked-worktree test, which the sandbox gates on `.git/` writes. It is unrelated to this diff. It was not run, so it is not counted as passing.

## Human Verification Required

None.

Note: the spec's Human Test Plan (seven steps above) is not a validation check. It is a manual walkthrough of the live assistant behavior, which no automated check here exercises. Run it at your convenience; it is not blocking.

## Proposed Changelog

- **Specs record their judgment calls.** The spec template gains a `## Judgment Calls` table after Decision. Each row names the chosen option, the strongest alternative, and whether you or the author decided it. `spec_review` blocks a spec whose unlisted call has a concrete, defensible alternative, and QA lists the author-decided calls in the completion summary and the PR body for confirmation.

## Decisions Made

Calls from the spec (these are the `Author` rows; they are the calls you did not explicitly make, and they are also listed in the PR body):

- **QA output surface** — `done.md` for all tasks, plus `pr-body.md` for single tasks. Chosen over PR body only, because bundled full-send runs would otherwise drop the leans. Strongest alternative: PR body only, as originally scoped.
- **Bulk approval does not confirm `Author` rows** — only an explicit choice makes a row `Human`. Strongest alternative: approval after seeing the rows counts as confirmation, which would recreate the adopt-the-lean pattern.
- **Section-less specs are still reviewed** — an adopter template without the section still gets the Blocking check on unlisted calls; the fix is adding the section. Strongest alternative: gate the check on the section existing, which makes omitting it an opt-out.
- **Code review is out of scope** — the anchored lens does not check that the implementation honors each chosen option. Strongest alternative: add that check to the anchored lens.
- **Amendment (reroute) spec_review is unchanged** — strongest alternative: apply the same check to amendment-only review.
- **No tooling enforcement** — no parser, lint, or required heading for the section. Strongest alternative: lint at `spec done` that the heading exists.
- **Skill severity is STRONG** in `/canon-spec-review`, while the pipeline uses Blocking, following the skill's existing advisory split. Strongest alternative: BLOCKING to match the pipeline.

Implementation-time choices:

- The plan's suggested `npx tsx --test` invocation fails before test collection because prompt builders import `.md` files. The test was run with the project's Node runner and the md-loader registration (`node --test --import ./tests/md-loader-register.mjs --import tsx …`). This is already documented in `docs/architecture.md`; no new decision was made.
- The spec-review nit on `docs/pipeline-orchestrator.md` was applied at the spec gate, before plan.
- Code review round 1 (changes requested) found an unclosed inline-code span in the `promptSpec` self-check. Fixed in iteration 2. No acceptance criterion was dropped.

## Open Questions

- The spec's Known Risks names a follow-up: compare `spec_review` iteration counts over the next ~10 S+ tasks in `docs/task-quality-log.md`, and downgrade the check if rounds inflate. This needs a human to track it after merge.
- A `docs/decisions.md` entry for the new Blocking category is a human follow-up after merge (QA does not write decisions.md, per the spec's Non-Goals).

## Judgment Calls to Confirm

- QA output surface — `done.md` (all tasks) plus `pr-body.md` (single tasks); strongest alternative was PR body only.
- Bulk spec approval does not confirm `Author` rows; strongest alternative was counting approval as confirmation.
- Section-less specs that make a call still draw the Blocking review; strongest alternative was gating on the section existing.
- Code review of judgment calls is out of scope; strongest alternative was an anchored-lens check.
- Amendment spec_review is unchanged; strongest alternative was applying the check to reroutes.
- No tooling enforcement for the section; strongest alternative was a heading lint at `spec done`.
- `/canon-spec-review` severity is STRONG, not BLOCKING; strongest alternative was matching the pipeline.

## Root Cause

- `execution` — code review round 1 (changes requested): an unclosed inline-code span around `None — <reason>` in the `promptSpec` self-check. Fixed in iteration 2.

## Quality Log

- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Code review round 1 requested changes for an unclosed inline-code span in the promptSpec self-check (AC-2 text); fixed in iteration 2, no AC dropped.

Maintenance: lessons-learned.md plus this task’s fragment have 29 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
