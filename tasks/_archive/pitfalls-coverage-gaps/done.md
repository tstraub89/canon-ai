# Completion Summary: pitfalls-coverage-gaps — Pitfall selection: prose-only Known Pitfalls and directory Affected Files

> For the human. This is what you need to know.

## What Changed

Two gaps in how canon picks pitfalls for the implementer's prompt are closed. First, a project whose `## Known Pitfalls` section is plain prose (no `###` headings) used to get nothing injected, so every rule in that section silently dropped out of implement prompts. That section's text now goes into the prompt in full, minus its index tables and blockquotes (the scaffold's author guidance), under a subsection that says it is included regardless of the task's files. Second, a directory listed in a spec's Affected Files (for example `src/orchestrator/`) now selects pitfalls, Trigger Table rows, and lessons that cite paths inside it. Before, only exact files, directory prefixes of a cited path, and globs matched. Sections with `###` entries behave as before.

## Files Changed

- `src/orchestrator/pitfalls.ts` — prose-only fallback entry; directory-aware token matching shared by every selection channel.
- `tests/pitfalls.test.ts` — red-first tests for the fallback, its boundaries, cap demotion, and directory matching.
- `docs/patterns.md` — "How to use this doc" describes both selection behaviors.
- `templates/docs/patterns.md` — same wording in the init scaffold.
- `.claude/skills/canon-init/write-guide.md` and `templates/.claude/skills/canon-init/write-guide.md` — pitfall selection wording (root and mirror).
- `README.md` — pattern-guidance row describes both behaviors.
- `dist/orchestrator/run-task.js` — rebuilt tracked bundle.

## How to Test

1. In a project whose Known Pitfalls section is plain prose with no sub-headings, run a small task.
2. Expected: the implementer's prompt contains that prose, under a "Known Pitfalls (included regardless of your files)" subsection. Blockquotes and index tables do not appear in that subsection.
3. Run a task whose spec lists a whole folder (for example `src/orchestrator/`) under Affected Files.
4. Expected: pitfalls and Trigger Table sections that cite files inside that folder appear in full.
5. Expected for both: a project whose Known Pitfalls has `###` entries sees no change in which entries are selected.

Developer check: `npx tsx --test tests/pitfalls.test.ts` (23 tests).

## Test Results

Results below are as recorded in `tasks/pitfalls-coverage-gaps/handoff.md` (Validation Outcomes). They were not re-run during QA. Code review re-ran `tests/pitfalls.test.ts` and reported 23/23.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 2150 passed, 1 skipped, 0 failed (handoff) |
| `npm run build` | Pass |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| `npx tsx --test tests/pitfalls.test.ts` | Pass — 23 passed, 0 failed |

Red-first evidence (AC-1, AC-3) is recorded in `handoff.md` against base `2f36ff1`. Both fail before the fix.

## Human Verification Required

None. No validation check is `human_pending`.

Pre-merge checklist (items not yet confirmed):

- [ ] Version correct — the release step decides the bump; QA does not.
- [ ] Changelog updated — the proposed entry below is for the human to finalize.
- [x] PR body current — `tasks/pitfalls-coverage-gaps/pr-body.md` is written.
- [ ] Final CI/CD checks green — no PR exists yet.
- [ ] Final diff matches spec intent — human review.

## Proposed Changelog

Scope check: both changes alter what implementers see in their prompts, so an adopter would notice. Entry text only; the version and tier are for the release step.

### Fixed

- **Known Pitfalls sections written as prose are injected again.** A Known Pitfalls section with no `###` headings had its text left out of implement prompts. Its prose now appears in full, except blockquotes and index tables, under a subsection marked as included regardless of the task's files.

### Changed

- **A directory in a spec's Affected Files selects pitfalls inside it.** Pitfalls, Trigger Table rows, and lessons that cite a path under a listed directory are now selected, the same as a listed file or glob.

## Judgment Calls to Confirm

- Fixing the prose-only gap — inject the prose body in full, unconditionally; alternative: show only a title line pointing at `docs/patterns.md`.
- Fallback scope — only when the section has no `###` entries at all; alternative: also inject the preamble before the first H3.
- Glob versus directory — segment-wise "could some path inside match" test with no filesystem I/O; alternative: require the glob to match a real file under the directory.
- Blockquotes in a prose-only section — excluded from the fallback body; alternative: inject them too.
- Where the fallback renders — its own subsection labeled as included regardless of files; alternative: under the "cite your files" subsection.

## Decisions Made

- When the spec's boundary and the plan's example disagree, the spec wins. A glob at the directory's own depth (`src/*` against `src/a/`) does not match, because it only matches the directory itself. The plan's example said it should. Recorded in `handoff.md` Deviations.
- The prose fallback uses the existing `direct` demotion channel, so it is demoted after lessons, section targets, and linked-doc entries, as the spec requires.

## Open Questions

Optional follow-ups from code review. None is blocking; the review verdict was `approved_with_nits`.

- A list item, heading, or fence line placed directly after a blockquote, with no blank line between them, is dropped from the prose fallback (`proseFallbackBody` in `src/orchestrator/pitfalls.ts`). Low severity; the spec's "all blockquote paragraphs removed" rule allows it.
- A table in the middle of prose, in a section with no `###` entries, is treated as an index table and stripped. Matches the spec's "tables directly under the H2" rule, but no test covers it.
- A Trigger Table row that targets the prose-only H2 itself may interact with span-based dedup. Low confidence; an unlikely fixture shape.
- Two test assertions are loose: the AC-1b scaffold test depends on the template's example H3 title, and the AC-2 demotion regex is broad. Hardening only.

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Code review approved_with_nits with four low-severity nits and no blocking findings; the nits are listed under Open Questions.

## Root Cause

None.

Maintenance: lessons-learned.md plus this task's fragment have 34 entries (33 `###` headings in the doc, one of them the format example, plus this task's fragment); a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
