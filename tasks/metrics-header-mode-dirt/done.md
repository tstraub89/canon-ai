# Completion Summary: metrics-header-mode-dirt — Widen stale metrics headers; abort ship on mode-only doc changes

> For the human. This is what you need to know.

## What Changed

This task fixes two small bugs. First, a task's `metrics.md` table created before the Effort column was added kept its old 9-column header, so every new row showed an unlabeled extra column. Recording a row now widens a narrower header to the current one. Existing rows are left byte-for-byte unchanged, and fragments with no table are untouched. Second, `--ship` treated a file-mode-only change (for example, `chmod +x`) on a shared telemetry doc as clean, so the change was swept into the archive commit on base. `--ship` now stops before merging when a shared doc has an uncommitted mode change, or when its mode cannot be checked, and the message tells the operator to commit or revert it. Shipping never discards anything on this path.

## Files Changed

- `src/orchestrator/metrics.ts` — `recordMetric` widens a narrower existing header before appending.
- `src/lib/markdown-table.ts` — the header-only merge helper moved here so the orchestrator can use it without importing from the CLI.
- `src/cli/commands/upgrade.ts` — re-exports and uses the relocated helper; upgrade behavior is unchanged.
- `src/orchestrator/validation.ts` — the shared-doc classifier takes a file-mode input (changed, unchanged, or unknown); a changed or unknown mode gives `abort`, checked first.
- `src/orchestrator/main.ts` — probes each dirty shared doc's index-to-worktree mode once with `git diff --raw` and passes the result to the classifier. A failed or unparseable probe marks every dirty doc unknown.
- `tests/metrics.test.ts` — legacy-header widening, current-header and no-table preservation.
- `tests/run-task-validation.test.ts` — classifier verdicts for changed, unknown, and unchanged modes.
- `tests/run-task-ship-docs-fold.test.ts` — real-git test: a mode-only change on a shared doc makes `--ship` exit non-zero, and the file's mode and content are left as they were.
- `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` — the "Shared-doc dirt at `--ship`" paragraph now covers mode-change aborts. The two copies are identical.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles.

## How to Test

1. Create a task-workspace metrics file that uses the older 9-column header (the table without the Effort column), then record another phase against that task. Expected: the file shows one consistent table with the Effort header, and the older rows are unchanged.
2. In a project that uses worktree-mode tasks, make a shared telemetry doc executable without changing its text (`chmod +x`), then try to ship a task that ran in its own isolated workspace. Expected: `--ship` stops before merging, says the file's permissions changed, and leaves the file's mode and text as they were.
3. Undo the mode change (`chmod -x`), and ship again. Expected: the shared-doc check passes.

## Test Results

Results below are from the implementer's handoff (`tasks/metrics-header-mode-dirt/handoff.md`, Validation Outcomes). QA did not re-run them.

| Check | Result |
|---|---|
| Lint (`npm run lint`) | Pass |
| Type-check (`npm run type-check`) | Pass |
| Unit tests (`npm test`) | Pass — 2322 passed, 1 skipped, 0 failed. The handoff does not say which test is skipped. |
| E2E tests | Not applicable — no E2E suite in this task's required checks |
| Build (`npm run build`) | Pass |
| Docs refs (`npm run docs-refs-check`) | Pass |
| Template sync (`npm run sync-templates:check`) | Pass |
| Red-first AC-1 (`tests/metrics.test.ts`) | Failed on the baseline commit, as expected (header stayed at 9 columns); passes after the fix |
| Red-first AC-4 (`tests/run-task-ship-docs-fold.test.ts`) | Failed on the baseline commit, as expected (the shipping call exited 0); passes after the fix |

Code review (round 1, approved with nits): no correctness bugs and no blocking findings. Three nits and one coverage note are listed under Follow-ups.

## Human Verification Required

None.

Pre-merge checklist (items QA could not confirm):

- [ ] Version correct — QA does not set the version; the release step decides it.
- [ ] Changelog updated — QA proposes the text below only; the human finalizes it.
- [x] PR body current — `tasks/metrics-header-mode-dirt/pr-body.md` was written in this QA pass.
- [ ] Final CI/CD checks green — not checked in this session.
- [ ] Final diff matches spec intent — approved with nits by code review; the human should confirm.

## Proposed Changelog

- **`--ship` stops before merging when a shared telemetry or config doc has an uncommitted file-mode change.** A `chmod` alone used to pass the dirty-doc check and was committed to base with the archive. The check now aborts, names the file and the mode change, and asks you to commit or revert it. A mode that cannot be read also aborts.
- **Per-task `metrics.md` tables widen their stale header.** A task whose metrics table was created before the Effort column was added showed new rows with an unlabeled extra column. Recording a row now updates that header; existing rows are unchanged.

## Judgment Calls to Confirm

- Repair scope for the stale metrics header — widen only the header and separator lines, and leave old 9-cell rows as they are — chosen: header-only repair; alternative: also pad old rows with an empty Effort cell.
- Verdict for a file-mode change on a shared doc — chosen: `abort` (fail closed); alternative: classify it as dirt and preserve it across the merge.
- Mode change plus a pure append — chosen: also `abort`; alternative: `preserve` the append and warn about the mode.
- Failed mode probe — chosen: abort every dirty shared doc; alternative: treat an unknown mode as unchanged.
- Reason precedence — chosen: check the mode first, so the reason names the mode change even when the content also changed; alternative: append the mode to the content reason.
- Delicate flag — chosen: No; alternative: Yes, because `--ship` deletes branches. The change only adds an abort path before the merge.

## Decisions Made

- The header-only merge helper moved from `src/cli/commands/upgrade.ts` to `src/lib/markdown-table.ts`, so the orchestrator does not import from the CLI. The upgrade command keeps its re-export.
- The mode probe is one `git diff --raw -z` call per ship, covering all dirty shared docs. Malformed or odd-count output counts as unknown.
- Code review findings that were dismissed and not tracked: a non-atomic read-then-write in `recordMetric` (fragments have one writer); a header column count that could misread an escaped pipe (the skeleton header has none); a legacy header with the same width but different names is not migrated (the spec covers narrower headers only); and a generic "could not be checked" reason on probe failure (specified by AC-3).

## Open Questions

- Should the two Proposed Changelog bullets ship as written? The metrics-header bullet is a small display fix; the human decides whether it belongs in the changelog.

## Follow-ups

| Category | Follow-up | Tracked |
|---|---|---|
| nit | Orphaned comments in `src/cli/commands/upgrade.ts` after the `mergeHeaderOnly` move: the `TABLE_SEPARATOR_RE` comment ends mid-sentence, and the helper's JSDoc now sits above `printDocsRefsCutoverWarning`. No adopter-visible effect, because `tsup` strips source comments. | untracked |
| nit | `src/orchestrator/metrics.ts` picks the header block by the first separator line, not by the `\| Timestamp \|` line. A hand-edited fragment with an earlier table-like line could have the wrong block replaced. Low risk, since fragments are machine-written. | untracked |
| nit | On CRLF fragments, the widened header is written with LF line endings while the rows stay CRLF. Display only. | untracked |
| risk | The real-git test (`tests/run-task-ship-docs-fold.test.ts`) covers only a telemetry doc with a mode-only change. Mode-plus-append, managed docs, and an unknown mode are covered only by pure classifier tests. This meets AC-4 as written. | untracked |
| observation | `recordMetric` reads and then writes the fragment without a lock. Review judged this acceptable because fragments have one writer, but two concurrent writers to the same fragment could lose rows. | untracked |

## Quality Log
- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Two small fixes bundled in one XS task; code review approved with three nits; no reroutes.

## Root Cause

None.

Maintenance: lessons-learned.md plus this task's fragment have 19 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
