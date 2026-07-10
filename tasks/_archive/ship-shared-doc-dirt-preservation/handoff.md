# Implementation Handoff: ship-shared-doc-dirt-preservation

> Author: Codex | Spec: `tasks/ship-shared-doc-dirt-preservation/spec.md` | Plan: `tasks/ship-shared-doc-dirt-preservation/plan.md`

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/main.ts` | Replaced the worktree-mode shared-doc blanket checkout with a pre-merge `git status --porcelain=v1` classification gate, durable suffix backups, fail-closed aborts for unsafe status codes, the split `stageArchiveChanges()` / `commitArchiveChanges()` seam, and post-staging/pre-commit re-append of preserved telemetry dirt. |
| `scripts/run-task/validation.ts` | Added the pure shared-doc classification seam, now gated first by porcelain code (`null` clean, only `' M'` content-checked), plus the formatted abort message seam. |
| `tests/run-task-ship.test.ts` | Added integration coverage for preserved telemetry, managed-doc aborts including `--force`, mixed-dirt abort ordering, non-append/untracked telemetry aborts, backup cleanup, archive-commit exclusion of preserved suffixes, commit/push failure preservation, staged shared-doc dirt aborts, and working-tree deletion aborts. |
| `tests/run-task-safety.test.ts` | Updated the direct archive-commit helper test to call `stageArchiveChanges()` before the slimmed `commitArchiveChanges()`. |
| `tests/run-task-validation.test.ts` | Added and updated unit rows for porcelain-gated shared-doc classification, the defensive HEAD-read-failure fallback, mixed-set aborts, and abort message formatting. |
| `docs/pipeline-orchestrator.md` | Documented the `--ship` shared-doc dirt gate and corrected the run-order timing to re-append after archive staging and before archive commit/push. |
| `templates/docs/pipeline-orchestrator.md` | Synced generated mirror of the pipeline orchestrator doc edit. |
| `dist/scripts/run-task.js` | Rebuilt generated run-task bundle. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The implementation keeps the original `--ship` cleanup purpose: dirty tracked shared docs in the supervising checkout must not be silently discarded or swept into this task's archive commit. The old behavior solved branch-switch friction by discarding every present shared doc. The new behavior inspects all shared-doc paths through git porcelain status before any mutation, aborts before merge if any path is unsafe, and only preserves telemetry dirt in the safe plain-unstaged shape (`' M'`) when the content is a byte-for-byte pure append over `HEAD`.

Safe telemetry suffixes are written to a temp backup before the working copy is reverted. Archive changes are staged while those telemetry files are suffix-free. Immediately after staging, the suffixes are re-appended and backups deleted, then the archive commit/push runs from the already-captured index. That keeps sibling rows out of this task's archive commit while restoring them before commit or push failure paths can abort the process.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| `dist/cli/index.js` is not listed in Changes. | `npm run build` was run after the source edits; the fresh build changed `dist/scripts/run-task.js` only. Listing a byte-identical file would fail the handoff diff cross-check. | None; generated output present in the actual diff is included. |
| Round 2 implementation uses the existing `initialFiles` fixture option instead of the plan's sample `seedSharedDocs` name. | `prepareShipFixture()` already exposes `initialFiles`; no helper rename or duplicate option was needed to seed tracked shared docs. | None; A7-A9 fixtures exercise the requested states. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `presentSharedDocs` has no matches in `scripts/run-task/main.ts`; shared-doc handling calls `classifyAndPreserveSharedDocDirt()` under the existing worktree-mode guard, before orphaned status cleanup and branch switch. No direct managed-doc checkout path remains. |
| AC-2 | Met | `tests/run-task-ship.test.ts` covers appended `docs/pipeline-invocations.md` dirt surviving successful `--ship` as uncommitted working-copy dirt while `HEAD:docs/pipeline-invocations.md` excludes the suffix. |
| AC-3 | Met | Mixed pure-append telemetry plus dirty `docs/patterns.md` aborts before PR merge, leaves both files byte-identical, and creates no backup directory entry. |
| AC-4 | Met | Dirty `docs/patterns.md` aborts before PR merge, names the file and commit/stash recovery, preserves file bytes, and repeats the same with `--force`. |
| AC-5 | Met | Non-pure-append telemetry dirt aborts before PR merge and leaves the file untouched. |
| AC-6 | Met | Present-on-disk untracked telemetry now aborts before PR merge via the porcelain `??` status branch, before any content read or discard. |
| AC-7 | Met | `main.ts` writes the suffix backup and logs its path before checkout; successful integration asserts the logged backup file is removed after re-append. Under the amended timing, backups persist through staging and are deleted after successful re-append before commit/push. |
| AC-8 | Met | `validation.ts` exposes pure `classifySharedDocDirtFromData(docClass, porcelainCode, headContent, workingContent)` and `classifySharedDocSetFromData()` helpers. Unit rows cover clean `null`, safe `' M'` preservation and aborts, managed dirt, unsafe porcelain codes, missing-HEAD fallback, mixed-set abort, and message text. |
| AC-9 | Met | Full `npm test` passed, including existing clean-path ship tests. |
| AC-10 | Met | `docs/pipeline-orchestrator.md` and its template mirror document managed-doc aborts, pure-append telemetry preservation, unsafe telemetry aborts, and re-append after archive staging but before archive commit/push. |
| AC-11 | Met | Integration test verifies `docs/lessons-learned.md` and `docs/task-quality-log.md` suffixes remain uncommitted after ship, while committed blobs contain the archive ref rewrite and exclude the suffixes. |
| A1 | Met | `stageArchiveChanges(stagedPaths)` now owns only the `git add -A` loop; `commitArchiveChanges(taskIds, baseBranch)` has no `stagedPaths` parameter and handles cached diff, commit, and push. The call site stages, re-appends/deletes backups, then commits. |
| A2 | Met | Integration test forces archive `git commit` failure and asserts the preserved telemetry suffix is already back in the working tree when `--ship` exits non-zero. |
| A3 | Met | Integration test forces archive `git push origin <base>` failure and asserts the preserved telemetry suffix is already back in the working tree when `--ship` exits non-zero. |
| A4 | Met | AC-2, AC-3, AC-11, A2, and A3 ship fixtures all passed after the Round 2 status-gating change. |
| A5 | Met | Spec Known Risks carries the amended "Crash window, narrowed to staging" entry; implementation and docs align with it. |
| A6 | Met | No source/docs prose outside the amended spec describes backups as surviving commit or push failure; commit/push failure recovery is now the restored working tree, verified by A2/A3. |
| A7 | Met | New ship test stages `docs/patterns.md`, restores the working file to HEAD, and verifies `--ship` aborts before PR merge while the staged diff remains. |
| A8 | Met | New ship test applies the same staged-only shape to `docs/pipeline-invocations.md` and verifies the telemetry path aborts fail-closed before merge. |
| A9 | Met | New ship test deletes tracked `docs/decisions.md` from the working tree and verifies `--ship` aborts before merge with the deletion still visible in porcelain status. |
| A10 | Met | Unit tests cover absent/clean (`null`), safe `' M'`, staged add/modify/delete (`'A '`, `'M '`, `'D '`), working-tree delete (`' D'`), rename (`'R '`), untracked (`'??'`), `MM`, and the HEAD-read-failure fallback. |
| A11 | Met | The amended spec already updates Design/Known Risks for porcelain-first detection; implementation follows that mechanism and no docs change was required in this round. |

## Edge Cases Considered

- Classification is two-phase: no backup or checkout occurs if any shared doc aborts.
- `--force` is intentionally ignored by the shared-doc safety gate.
- Git status probe failure aborts before merge instead of treating the tree as clean.
- Non-`' M'` porcelain codes skip content reads and abort for both managed and telemetry files.
- `git show HEAD:<path>` failures remain unsafe when porcelain reports the safe `' M'` shape.
- Backup deletion happens only after append succeeds; a failure before staging leaves the logged backup path on disk.
- Commit and push failures happen after re-append, so the working tree itself carries the preserved suffix.
- Tests use raw porcelain output for uncommitted-state assertions so leading status columns are not lost.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 939 tests: 938 pass, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js`; `dist/cli/index.js` stayed byte-identical. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
