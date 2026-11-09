# Completion Summary: spec-prompts-term-renames-rule — Carry the term-renames rule in the spec phase prompts

> For the human. This is what you need to know.

## What Changed

The spec-writing prompts that canon sends to agents now carry the "Codebase-wide term renames" rule of thumb, which until now lived only in the canon-spec skill. When a spec renames a term used across the codebase, the author and the reviser are told to split the old term into its distinct string families and gate each family with its own zero-result search check, rather than listing grep hits by hand. The rule was missing from the headless prompts that write specs and revise them after review, so a rename spec could grow a new label family every review round. The rule is a condensed one-paragraph version of the skill text, placed right after the refactor correctness-audit bullet in both prompt templates. A new parity test pins the rule's title across the skill copies, both prompt templates, and both rendered prompt outputs, so a later edit that drops or renames the rule on any carrier fails the suite. The spec-review and plan prompts and the skill itself are unchanged.

## Files Changed

- `src/orchestrator/prompts/templates/spec.md` — adds the term-renames bullet after the refactor audit bullet.
- `src/orchestrator/prompts/templates/spec-revision.md` — adds the identical bullet at the same position.
- `tests/run-task-prompts.test.ts` — new parity test ("term-renames guidance stays aligned across spec surfaces").
- `tests/run-task-prompts.golden.json` — regenerated for the four spec-prompt keys only (`promptSpec`, `promptSpecRevision`, and their `withDocsMap` variants).
- `dist/orchestrator/run-task.js` — rebuilt bundle carrying both templates.

## How to Test

1. Start a spec for a task that renames a term used across the codebase (or read the spec-writing prompt that a spec session receives).
2. Expected: the spec-writing guidance includes the "Codebase-wide term renames: gate per string family, not per enumerated hit" bullet, directly after the refactor correctness-audit bullet.
3. Expected: a rename spec's search-check acceptance criteria are organised by string family, with a zero-result check per family, rather than a hand-listed set of hits.
4. Optional: run `npm test` and confirm the test "term-renames guidance stays aligned across spec surfaces" passes.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass (exit 0, per handoff) |
| `npm run type-check` | Pass (exit 0, per handoff) |
| `npm test` (unit suite, after golden regeneration) | Pass — 2,174 passed, 1 skipped, 0 failed (per handoff) |
| `npm run build` | Pass — `dist/orchestrator/run-task.js` rebuilt; a repeat build produced identical bytes (per handoff) |
| `git diff --exit-code -- tests/completion.golden.json` | Pass — no diff |
| `git diff --check` | Pass |
| `npm run docs-refs-check` | Not run — the handoff does not record it; it is in the PR checklist |
| `npm run sync-templates:check` | Not run — the handoff does not record it; this task does not touch managed root files or `templates/` mirrors |
| E2E (`<E2E>` in Validation Required) | N/A — prompt-template-only change with no UI or end-to-end runtime (per the handoff's interpretation; see Open Questions) |
| Red-first run (AC-3) | Recorded — the new parity test failed on the base commit `288499c` for the missing prompt-template phrase, then passed after the change |

## Human Verification Required

None.

Items the pre-merge checklist cannot confirm yet:

- [ ] Version correct — no version is set in this QA pass; the bump tier is decided at the release step.
- [ ] Changelog updated if needed — the proposed entry is below; the human finalizes it.
- [ ] PR body current — `tasks/spec-prompts-term-renames-rule/pr-body.md` is drafted from this QA pass.
- [ ] Final CI/CD checks green — not yet run for the PR head.
- [x] Final diff matches spec intent — the five Affected Files are the only changed files outside task artifacts (AC-4), and code review found no spec gaps.

## Proposed Changelog

- Spec-authoring prompts now carry the term-renames rule of thumb: when a spec renames a term used across the codebase, the author and the reviser gate each distinct string family with its own zero-result search check instead of a hand-listed set of hits.

## Judgment Calls to Confirm

- Parity test pins only the shared title phrase on the skill copies, plus the full bullet being byte-identical across the two prompt templates — chosen over making the skill and the templates share one canonical sentence; alternative: pin one canonical sentence everywhere, which would widen scope to the shipped skill and its mirror.
- Review side left unchanged: author and reviser prompts only; the spec-review prompt and the canon-spec-review checklist do not gain a matching question — chosen to keep the task XS; alternative: add a review-side check, as the refactor correctness-audit rule has.
- Placement after "Refactor specs need a correctness audit" and before "UI spatial / gesture tasks" — chosen to match the skill's ordering; alternative: directly after "Enumerate every caller".

## Decisions Made

- Used the condensed one-paragraph wording from the spec's Decision (the human-chosen wording), not the skill's longer text, and kept it byte-identical in both templates.
- Regenerated goldens with `UPDATE_GOLDENS=1 npm test`; only the four named keys changed.
- Recorded the AC-3 red-first run against the base commit in the handoff.

## Open Questions

- The spec's Validation Required section still lists `<E2E>` as an unchecked item. The implementer treated it as N/A and recorded that as a blocker-level ambiguity. Confirm that N/A is acceptable, or have future specs drop unused validation placeholders instead of leaving them unchecked.
- The lessons-buffer sweep comment (`docs/lessons-learned.md`) still lists this gap as an unresolved follow-up. The spec leaves that comment for the next human sweep to update.
- A review-side check (so hand-listed rename ACs cannot pass spec review) is not part of this task. The spec calls it a clean follow-up if rename specs still pass review with hand-listed hits.

## Root Cause

None.

## Quality Log

- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Prompt-only change; spec approved on the first spec_review pass; code review approved_with_nits with no surviving findings; the E2E placeholder was treated as N/A.
