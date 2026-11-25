# Spec: metrics-header-mode-dirt — Widen stale metrics headers; abort ship on mode-only doc changes

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

This task bundles two small, unrelated bug fixes, GitHub #183 and #16.

**#183: stale per-task metrics header.** `recordMetric` (`src/orchestrator/metrics.ts`) writes `METRICS_SKELETON`, whose header has 10 columns ending in `Effort`, only when the per-task `metrics.md` fragment doesn't exist yet. It then appends a 10-cell row. A fragment created before #182 added the Effort column keeps the old 9-column header (`| Timestamp | Task | Phase | Agent | Model | Iter | Duration | Tokens | Status |`, separator with 9 cells), and every new row has 10 cells. The table then renders with an extra unlabeled column.

- **Confirmed by trace (deterministic):** `metrics.ts` line 39 writes the skeleton only when `!fs.existsSync(metricsFile)`. Commit `46d7dc9` (#182) changed the skeleton header from 9 to 10 columns and made the row template 10 cells. `METRICS_SKELETON`'s header is now 10 columns (checked by running it).
- **Impact:** display only. `foldMetricsFragment` throws fragment headers away on `--ship`, so the shared `docs/pipeline-invocations.md` is correct. The fragment `tasks/<id>/metrics.md` stays malformed while the task is in flight.

**#16: a mode-only change on a shared doc is classified clean.** `classifySharedDocDirtFromData` (`src/orchestrator/validation.ts`) returns `clean` for porcelain code `' M'` when the working content equals HEAD. A `chmod` on a shared telemetry doc (with `core.fileMode=true`) shows as `' M'` with byte-identical content, so it is classified clean.

- `--ship` then runs `stageArchiveChanges` (`git add -A` on the telemetry docs), which sweeps the mode bit into the `chore: archive <id>` commit pushed to base. This is a hole in the "fail closed, never discard or sweep unrelated dirt" rule of the shared-doc dirt check.
- A related case: a mode change plus a pure append is classified `preserve`. The preserve path runs `git checkout HEAD -- <doc>`, which silently reverts the mode.
- **Confirmed by execution (deterministic):** calling `classifySharedDocDirtFromData('telemetry', ' M', 'x\n', 'x\n')` returned `{"verdict":"clean"}`. The caller `classifyAndPreserveSharedDocDirt` in `src/orchestrator/main.ts` gathers only the porcelain code and the HEAD and working contents, so a mode change is invisible to the classifier.

## Decision

1. **#183:** before appending a row, `recordMetric` checks the table header of the file it is about to append to. If that header has fewer columns than the current header, it replaces the file's whole header block with `METRICS_SKELETON`'s. The header block is everything up to and including the table's separator line, so it also brings in the skeleton's Effort note ("Older rows may have no Effort cell"). Rows are left byte-for-byte unchanged. A file whose header is already current, or has no recognizable table, isn't rewritten.
2. **#16:** the shared-doc dirt check also detects an uncommitted file-mode change between the index and the working tree for each dirty shared doc.
   - **Mode change found:** the doc gets `abort`, whether or not its content also changed. The mode check runs before the other checks, so the reason names the mode change and tells the operator to commit or revert it.
   - **Mode can't be determined:** if the probe fails or its output can't be parsed, every dirty shared doc gets `abort`, with a reason saying the file mode couldn't be checked. It is never treated as unchanged (fail closed).
   - **Unchanged:** the existing abort message format (`buildSharedDocAbortMessage`) and the "`--force` does not bypass" rule.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Bundling | One task for #183 and #16 | Two separate tasks | Both are XS fixes approved together by the human. They touch different files, so a reviewer can read them separately | `Human` |
| #183 repair scope | Repair only the header and separator lines of an existing fragment, when narrower than current | Also pad old 9-cell rows with an empty Effort cell | The skeleton note already says "Older rows may have no Effort cell", which accepts 9-cell rows under a 10-column header. Rewriting rows risks corrupting data for no display gain | `Author` |
| #16 verdict for a mode change | `abort` (fail closed) | Classify it as dirt and preserve it across the merge | There is no "preserve mode" mechanism, and the preserve path re-checks out HEAD, which drops the mode. Abort is what every other non-append dirt gets | `Author` |
| #16 mode change plus append | Also `abort` | `preserve` the append and warn about the mode | Preserving silently discards the mode. Aborting keeps the never-discard guarantee, and the operator resolves it once | `Author` |
| #16 failed mode probe | Abort every dirty shared doc | Treat as no mode change | Treating it as unchanged reopens the hole this task closes. `docs/patterns.md` says probe errors are never clean | `Author` |
| #16 reason precedence | Check the mode first, so a mode change is named even when content also changed | Append the mode to the content reason | One reason per doc keeps the existing message shape. The operator sees the mode issue, which content checks wouldn't reveal | `Author` |
| Delicate | No | Yes, because `--ship` deletes branches | The change only adds an abort reason before the merge. It never adds a path that deletes, commits or pushes. `docs/product-context.md`'s delicate list doesn't name the shared-doc dirt check | `Author` |

## Non-Goals

- No change to `foldMetricsFragment` or to the shared `docs/pipeline-invocations.md` (already correct). No behavior change to `canon upgrade`'s header merge, though its helper may be moved so it can be shared (see Affected Files).
- No rewriting of existing 9-cell metric rows.
- No detection of mode changes on files other than the shared docs the check already covers, and no handling of `core.fileMode=false` (git reports nothing there).
- No change to `applyTelemetryFold`'s temp-file write, which resets the mode on docs that receive fold rows.
- Retiring the legacy shared-telemetry safety net (`docs/BACKLOG.md`) is not part of this task.

## Acceptance Criteria

- [ ] **AC-1 (#183, red-first):** a test in `tests/metrics.test.ts` creates a fragment with the pre-#182 header block, using the 9-column header and separator, plus one 9-cell row, and calls `recordMetric`. It asserts:
  - everything through the separator equals `METRICS_SKELETON`'s header block, including the Effort note;
  - the old 9-cell row is byte-for-byte unchanged;
  - the new row has 10 cells.

  The test fails on `main` before the fix, because the header stays at 9 columns.
- [ ] **AC-2 (#183):** recording into a fragment that already has the current header leaves everything before the appended row byte-identical. This covers both a fragment `recordMetric` created fresh and an existing current fragment. A file with no `| Timestamp |` table gets the row appended and is otherwise untouched. The existing metrics tests pass.
- [ ] **AC-3 (#16, pure):** `tests/run-task-validation.test.ts` covers the classifier for telemetry and managed docs:
  - with a mode change, identical content gives `abort`, and a telemetry pure append gives `abort`. The reason mentions the file mode, including when the content also changed;
  - with an unknown mode (probe failed), the result is `abort` with the could-not-check reason;
  - with no mode change, every existing verdict is unchanged. The new input is optional or defaulted, so the existing calls stay unmodified and keep passing.
- [ ] **AC-4 (#16, red-first, real git):** a real-git test in `tests/run-task-ship-docs-fold.test.ts` uses the spawned `classifyAndPreserveSharedDocDirt` fixture. It sets `core.fileMode=true` on the fixture repo and runs `chmod +x` on `docs/pipeline-invocations.md` without changing its content. It asserts:
  - the process exits non-zero;
  - stderr starts with the standard `--ship aborted: uncommitted shared-doc edits` text and names the file and the mode change;
  - the doc's mode and content are unchanged.

  The test fails on `main`, because the doc is classified clean and the call succeeds. Skip it with a stated reason where POSIX modes are unavailable.
- [ ] **AC-5 (docs):** the "Shared-doc dirt at `--ship`" paragraph in `docs/pipeline-orchestrator.md` and its mirror `templates/docs/pipeline-orchestrator.md` say that an uncommitted file-mode change on a shared doc, or a mode that can't be checked, also aborts `--ship` before anything merges. `npm run sync-templates:check` passes.
- [ ] **AC-6:** `npm run build` updates `dist/`, and the full `npm test` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/metrics.ts` | `recordMetric` replaces a narrower existing header block with the skeleton's before appending |
| `src/lib/markdown-table.ts` | Optional: the home for `mergeHeaderOnly` if it is moved out of the upgrade command to be shared |
| `src/cli/commands/upgrade.ts` | Optional: import `mergeHeaderOnly` from its new home, if moved. No behavior change |
| `src/orchestrator/validation.ts` | `classifySharedDocDirtFromData` and `SharedDocEntryInput` take an optional mode input (changed, unchanged, unknown); a changed or unknown mode gives `abort` with a mode reason, checked first |
| `src/orchestrator/main.ts` | `classifyAndPreserveSharedDocDirt` probes each dirty doc's index-vs-worktree mode once (new raw-diff parsing) and passes changed, unchanged or unknown to the classifier |
| `tests/metrics.test.ts` | AC-1, AC-2 |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | AC-5: mode-change abort in the shared-doc dirt paragraph; mirror synced |
| `tests/run-task-validation.test.ts` | AC-3 |
| `tests/run-task-ship-docs-fold.test.ts` | AC-4 |
| `dist/` | Rebuilt bundles that include the touched modules |

### Implementation Notes (non-binding)

- **#183:** `mergeHeaderOnly(templateContent, projectContent)` in `src/cli/commands/upgrade.ts` already replaces a header block and keeps rows byte-for-byte, CRLF included. Calling `mergeHeaderOnly(METRICS_SKELETON, existing)` when the existing header is narrower is the simplest fix. The orchestrator shouldn't import from `cli/commands`, so move the helper to `src/lib` if you reuse it.
- **#16:** one `git diff --raw -z -- <dirty docs>` call (index vs worktree) gives `:<oldmode> <newmode> …` records separated by NULs. No existing helper parses them, so this is new parsing code. A path whose old and new modes differ has a mode change; a path that isn't listed has none. A non-zero exit or unparseable output means unknown for every dirty doc.

### Interaction Dependencies

- **#16:** `--ship` pre-merge abort messages. The `preserve` and restore paths are unchanged for docs with no mode change.
- **#183:** fragment display and `foldMetricsFragment`, which still drops fragment headers.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite
- [x] `npm run build` — `dist/` rebuilt and committed
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`

## Docs Impact

`docs/pipeline-orchestrator.md` and its mirror are edited (AC-5). No other protected doc is affected.

## Known Risks

- **#16: a probe that never sees the mode.**
  - `git diff --raw` compares the index with the worktree. A mode change that is already staged shows as a porcelain code other than `' M'`, which already aborts.
  - With `core.fileMode=false` git reports no mode change, which is out of scope.
- **#16: the real-git test on CI.** Linux CI runners have POSIX modes and `core.fileMode=true` by default. The test sets it explicitly for the fixture repo.
- **#183: header detection on a hand-edited fragment.** If no `| Timestamp |` line exists, append as today and don't rewrite anything.

## Human Test Plan

1. Take a task whose step log was started before the Effort column existed, and run another phase on it.
2. Expected: the task's step log shows one consistent table, with an Effort column header and no unlabeled extra column. The older rows are unchanged.
3. Make a shared log file executable without changing its text, then try to ship a task that ran in its own isolated workspace (the check only runs for those).
4. Expected: shipping stops before merging, says the file's permissions changed, and leaves the file as it was.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files: one heading under Design, one file per row, specific changes
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Replacement framing: #16 changes two verdicts. A mode-only `' M'` goes from clean to abort, and a mode plus append goes from preserve to abort. Decision 2 states the new behavior directly
- [x] Non-Goals rule out the tempting expansions (row padding, fold changes, safety-net retirement)
- [x] Symbols named in ACs exist (grep-verified: `recordMetric`, `METRICS_SKELETON`, `foldMetricsFragment`, `classifySharedDocDirtFromData`, `classifySharedDocSetFromData`, `classifyAndPreserveSharedDocDirt`, `stageArchiveChanges`)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has `- [x]` entries
- [x] (Bug fix) *Problem* states confirmed mechanisms (trace + execution); AC-1 and AC-4 are red-first; AC-3 pins the fail-closed probe
- [x] (Refactors) N/A
- [x] *Judgment Calls* lists every call with its alternative and Decided by
