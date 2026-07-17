# Completion Summary: allow-comma-separated-multipath-cells — Accept comma-separated multi-path cells in handoff Changes and spec Affected Files tables

> For the human. This is what you need to know.

## What Changed

The handoff `## Changes` table and spec `### Affected Files` table cells used to hard-reject any row that listed more than one file path — Codex routinely writes tightly-coupled rows like `` `a.ts`, `b.ts` `` (e.g. a canon-managed file plus its `templates/` mirror), and the old parser bounced every one of them with "multiple paths in one cell", forcing the operator to hand-split rows to unblock the pipeline. This task rewrites the parser to accept a comma-separated list of one or more path tokens (backtick paths or markdown links) per cell, with an optional trailing free-text note, while still rejecting anything structurally ambiguous — prose between tokens, tokens juxtaposed without a comma, a path token hidden inside what looks like a note, or a dangling/trailing comma. Every extracted path still runs through the existing per-path checks (no wildcards, no placeholders, no absolute paths, no `..` traversal), and a cell with one bad path among good ones still surfaces the good paths plus a precise error naming the bad one — no silent dropping. The comma-list format is now documented as first-class in the handoff template, not just tolerated.

## Files Changed

- `scripts/run-task/validation.ts` — replaced first-path-only extraction with sequential comma-list tokenization, balanced markdown-link destination parsing, structural rejection for ambiguous shapes, per-path validation, and multi-path propagation to all consumers (`parseHandoffChangesRows`, `parseAffectedFilesFromSpec`, `collectUnscannedTableHits`); deleted the retired `extractHandoffPath` single-path wrapper.
- `scripts/run-task/main.ts` — reworded the `autoCommitCode` malformed-row die message to describe the comma-list grammar instead of "one path per line".
- `.canon/templates/handoff.md` — documented multi-path cells as first-class in both the baseline and per-iteration Changes-table notes, with grouping guidance (group tightly-coupled files, keep unrelated files on separate rows) and the retained prohibitions.
- `templates/.canon/templates/handoff.md` — regenerated mirror of the above.
- `tests/run-task-validation.test.ts` — added parser/spec-table/handoff-table/malformed-structure/per-path-validation/unscanned-table coverage for the new grammar; removed the retired `extractHandoffPath` wrapper tests.
- `tests/task-cli.test.ts` — split the old single "rejects malformed handoff rows" test into an acceptance test (comma-list row flows through `taskAccept`) and a retained refusal test using a genuinely malformed (prose-between-tokens) fixture.
- `docs/BACKLOG.md` — reworded the three stale single-path references in the multi-table design note to reflect comma-list support, without touching the note's still-open core problem or the separate deletion-handling entry.
- `docs/codebase-map.md` — fixed the stale parser description to note comma-separated backtick-path / markdown-link tokens per cell.
- `dist/cli/index.js` — rebuilt bundle.
- `dist/scripts/run-task.js` — rebuilt bundle.

## How to Test

1. Create a throwaway task and, in its `handoff.md` Changes table, list two changed files on one row separated by a comma (optionally with a short note after the second file, e.g. `` `a.ts`, `b.ts` regenerated mirrors ``).
2. Let the pipeline's implementation-commit step run (or run `canon task accept` against a work tree that has both files committed).
3. Expected: the row is accepted and both files land in the commit — no "multiple paths in one cell" rejection, no operator intervention needed.
4. Write a row that puts a sentence between two file references instead of a comma (e.g. `` `a.ts` regenerated, `b.ts` ``).
5. Expected: the pipeline rejects that row, with a message explaining that file references must be a comma-separated list at the start of the cell, with any note after the last one.

## Test Results

| Check | Result | Notes |
|---|---|---|
| Lint | Pass | ESLint clean. |
| Type-check | Pass | TypeScript no-emit check clean. |
| Unit tests | Pass | 983 tests: 982 passed, 1 expected environment skip, 0 failed. |
| E2E tests | not_configured | No e2e suite in this project. |
| Build | Pass | Both published bundles rebuilt and committed; `git diff --stat -- dist/` empty after rebuild. |
| `npm run sync-templates:check` | Pass | Canon-managed template mirrors in sync. |
| `npm run docs-refs-check` | Pass | All doc references valid. |
| AC-8 symbol grep (`extractHandoffPath`) | Pass | Zero hits in `scripts/`, `src/`, `tests/`. |
| AC-9 retired-wording grep | Pass | Zero hits across scripts/src/tests/docs/.canon/templates/.github. |

Code review ran three independent lenses (anchored Claude, cold Claude, cold Codex). Anchored lens approved; cold Codex returned a clean pass with no findings; cold Claude raised 6 findings, all verified and dismissed as spec-intended behavior or non-issues on inspection — no correctness bugs or spec gaps survived. Final verdict: **approved with nits** (4 non-blocking cosmetic/doc-polish nits — see `tasks/allow-comma-separated-multipath-cells/review.md` for detail; none require action before shipping).

## Human Verification Required

None. All required validation checks recorded `Pass`; no `human_pending` rows remain in `handoff.md`'s Validation Outcomes table.

**Handoff pre-merge checklist:**
- [ ] Version correct — N/A at QA; version bump happens at the release step.
- [ ] Changelog updated if needed — proposed below; final entry + version decided at release.
- [x] PR body current — see `tasks/allow-comma-separated-multipath-cells/pr-body.md`.
- [ ] Final CI/CD checks green — confirm on the opened PR.
- [x] Final diff matches spec intent — all 14 ACs verified Met in code review Stage 1 (`tasks/allow-comma-separated-multipath-cells/review.md`).

## Proposed Changelog

- **Handoff `## Changes` and spec `### Affected Files` table cells now accept a comma-separated list of file paths in one row, not just a single path.** Previously, any first-column cell containing more than one backticked path or markdown link was rejected outright ("multiple paths in one cell"), forcing rows like a canon-managed file and its `templates/` mirror to be hand-split across separate rows — a repeat source of pipeline friction. A cell may now list one or more path tokens separated by commas, with an optional trailing note after the last one (e.g. `` `a.ts`, `b.ts` regenerated mirrors ``); every path is extracted and validated independently, so a bad path among good ones still surfaces the good paths plus a precise error naming the bad one. Structurally ambiguous cells — prose between path references, tokens juxtaposed without a comma, or a path reference hidden inside the trailing note — are still rejected, with a message naming the problem. The comma-separated format is documented as first-class in the handoff template. Ships to adopters via `canon upgrade`.

## Decisions Made

- Kept the `docs/BACKLOG.md` multi-table entry in resolved/historical tense rather than reverting it to "still open" as the spec's framing implied, because the file already marked that specific sub-item resolved (`[x]`) — matching the current file's actual state was judged correct over literally following a stale spec characterization. Code review agreed this was the right call.
- Rejected an annotation-attached-without-whitespace shape (a token glued directly onto the note with no space) as malformed, beyond what the spec's grammar strictly required, to keep the parser anchored to the documented "annotation is whitespace-separated" shape. This only tightens rejection of already-invalid input; no accepted-input behavior changed.
- Two AC-4 malformed classes (prose-between-tokens and token-hidden-in-annotation) share one reason string in the emitted error, since the fix action is identical (comma-join the stray token) — flagged as a nit in code review but judged non-blocking since it doesn't violate the "one message per failure class" rule where classes are truly distinct.

## Open Questions

None blocking. Two optional, non-blocking code-review nits are available if you want extra polish (see `review.md` for full detail):
- A markdown-link token can't hold a path with a literal `]` in the filename (e.g. `[src/foo[beta].ts](url)` truncates and rejects), while the equivalent backtick form works fine. Cosmetic; the backtick form is a trivial workaround.
- The handoff template's "short note" wording could explicitly say the trailing annotation must not itself contain a backticked path or markdown link, to preempt operator surprise at a loud rejection.
