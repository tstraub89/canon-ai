# Spec: ship-shared-doc-dirt-preservation — Stop --ship discarding live shared-doc edits in the supervising checkout

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

At `--ship`, when any shipped task is worktree-mode, the orchestrator runs a blanket `gitSafe('checkout', 'HEAD', '--', ...presentSharedDocs)` in the supervising checkout (`scripts/run-task/main.ts:2067-2072`), silently reverting every dirty `PIPELINE_SHARED_DOCS` file — the 3 telemetry files and the 6 managed docs (`scripts/run-task/worktree.ts:9-24`).

**Confirmed mechanism** (confirmed by code trace plus a real data-loss incident in an adopter repo on 2026-07-06): spec and spec_review phases run *before* a task's worktree exists, so their telemetry rows are appended to the supervising checkout's `docs/pipeline-invocations.md` (`recordMetric()` calls in `scripts/run-task/agents/claude.ts:243` and `scripts/run-task/agents/codex.ts:124`, resolving via `getMetricsFile()` in `scripts/run-task/metrics.ts:7` to REPO_ROOT) and sit uncommitted there until a later absorb/commit. When a *different* task ships while those rows are pending, the cleanup discards them. In the incident, shipping task A destroyed the uncommitted pre-implement telemetry rows of in-flight sibling tasks. The same code path would silently discard an operator's uncommitted edits to any of the six managed docs (e.g. `docs/lessons-learned.md`, `docs/patterns.md`) — a worse loss than telemetry.

The cleanup exists for a real reason (introduced in v1.4.0, replacing `flushWorktreeTelemetry()`): a dirty tracked shared doc that differs from the incoming content makes the base-branch checkout at `main.ts:2081-2091` and/or the base pull inside `mergeOpenPRsAndPull()` (`main.ts:1812`) fail with "local changes would be overwritten" — and by pull time the PR merge has already happened, so a failure there strands a half-shipped state. The cleanup cannot simply be deleted; the discard must be replaced with behavior that distinguishes stale mirror dirt from live foreign dirt.

## Decision

Replace the blanket shared-doc discard with a pre-merge classification, split by file class. All classification and any abort happen **before** the first irreversible step (`gh pr merge`) and before the base-branch checkout switch:

1. **Managed docs** (`PIPELINE_MANAGED_DOCS`): if any is dirty in the supervising checkout, `--ship` aborts with an error that names each dirty file and the recovery ("commit or stash your edits, then re-run --ship"). Nothing is merged, nothing is discarded, the operator's edits are untouched. Only operators write these files; silent discard is never acceptable.

2. **Telemetry files** (`PIPELINE_TELEMETRY_FILES` — `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md`): preserve-and-reapply, applied uniformly to all three. For each dirty telemetry file, verify the working copy is a **pure append** over the HEAD copy (working content starts with HEAD content byte-for-byte). If yes: persist the appended suffix to a backup file on disk, log the backup path, then revert the working copy to HEAD.

   The revert-to-HEAD step is byte-for-byte what today's blanket discard already does at this site, so the downstream archive path is unchanged: after the merge, `rewriteArchivedTaskRefs()` (`main.ts:1911`) rewrites task refs in `docs/lessons-learned.md` / `docs/task-quality-log.md`, and `commitArchiveChanges()` (`main.ts:1886`) stages those two files (`stagedPaths` at `main.ts:2226`) and commits+pushes them — exactly the base+ref-rewrite content it commits today, with no preserved suffix in it.

   **Re-append happens after `commitArchiveChanges()` completes — the final ship mutation — not after the merge.** For each preserved telemetry file, re-append the saved suffix to its (now merged-and-archived) working copy, leave the file uncommitted, and delete the backup. The insertion point is load-bearing: two of the three telemetry files (`docs/lessons-learned.md`, `docs/task-quality-log.md`) are committed and pushed by the archive path, so re-appending *before* it would fold a sibling task's pending telemetry into *this* task's `chore: archive` commit and push it upstream — misattributing the sibling's in-flight rows and violating the "leave uncommitted" contract. The preserved suffix belongs to the sibling task, whose own pipeline will absorb it later; its correct home is uncommitted supervising-checkout dirt, never this task's archive commit. (`docs/pipeline-invocations.md` is neither rewritten nor staged, so its timing is indifferent — a single uniform re-append point after the archive commit is correct for all three.)

   A plain append (no dedup) is correct — under the worktree-canonical model (v1.5.0+), REPO_ROOT telemetry dirt is never mirrored to the task branch (`buildHumanReviewStagePaths` at `main.ts:712` stages active-worktree copies only), so the suffix cannot already exist in the merged content. If the dirt is *not* a pure append, or reading the HEAD copy fails (file untracked / probe error): abort pre-merge exactly like the managed-doc case — fail closed, never discard.

**Classification is a strict two-phase gate**: all dirty shared docs are classified first, and any abort verdict (managed-doc dirt, non-pure-append telemetry, unreadable HEAD copy) wins **before any mutation** — no backup is written and no working copy is reverted anywhere if any file fails classification.

3. A clean supervising checkout ships exactly as today; the trigger condition (only when at least one shipped task is worktree-mode) is unchanged.

The net operator-visible change: `--ship` never destroys uncommitted work. Sibling-task telemetry survives shipping with zero added friction; anything the orchestrator cannot prove safe blocks the ship before the merge with a named-file recovery message.

## Non-Goals

- **No change to the `orphanedStatusPaths` cleanup** (`main.ts:2074-2079`): task-scoped `status.json` mirrors are covered by the worktree-canonical decision; that block stays byte-identical.
- **No change to what the archive commit contains** for `docs/lessons-learned.md` / `docs/task-quality-log.md`: `rewriteArchivedTaskRefs()` + `commitArchiveChanges()` commit the base+ref-rewrite version, byte-identical to today. The preserved suffix is layered on afterward as uncommitted dirt, never committed.
- **No relocation of pre-implement telemetry writes**: moving spec/spec_review telemetry out of REPO_ROOT is the structural fix for the collision and is a separate future task.
- **No change to `--pr` / `--push`**: neither path has a shared-doc discard today; none is added.
- **No new behavior for non-worktree ships**: the trigger condition (some shipped task has `worktree: true`) is preserved as-is.
- **No interactive prompt**: aborts are hard failures with guidance; no confirm-to-discard flow.

## Acceptance Criteria

- [ ] AC-1 (replacement): The blanket discard is gone — `grep -n "presentSharedDocs" scripts/run-task/main.ts` returns no matches, and no code path invokes `checkout HEAD --` on a `PIPELINE_MANAGED_DOCS` path. The replacement classification helper is called at the same pre-switch site in the `--ship` flow, under the same "at least one shipped task is worktree-mode" guard.
- [ ] AC-2 (red-first regression, incident file survives uncommitted): New integration test in `tests/run-task-ship.test.ts`: a ship fixture where REPO_ROOT's `docs/pipeline-invocations.md` has uncommitted appended rows (simulating a sibling task's pre-implement telemetry) → `--ship` completes successfully AND afterward those rows are present in REPO_ROOT's `docs/pipeline-invocations.md` as **uncommitted** modifications on the updated base (`git status --porcelain` shows the file modified; the rows are not in any commit). This test fails on pre-fix code (rows are discarded) and passes after.
- [ ] AC-3 (mixed dirt, abort wins before any mutation): Integration test: pure-append telemetry dirt in `docs/pipeline-invocations.md` AND a dirty `docs/patterns.md` in the same run → `--ship` exits non-zero pre-merge (fake `gh` log shows no `pr merge`), BOTH files are byte-identical to their pre-run dirty state, and no backup file was created.
- [ ] AC-4 (managed-doc abort, --force does not bypass): Integration test: a dirty `docs/patterns.md` in REPO_ROOT → `--ship` exits non-zero, the error message names `docs/patterns.md` and instructs commit-or-stash, the fake `gh` log shows `pr merge` was never invoked, and the dirty content is byte-identical after the failed run. Repeating the same fixture with `--force` still aborts identically.
- [ ] AC-5 (non-pure-append abort): Integration test: a telemetry file whose dirt modifies an existing line (not a pure append) → `--ship` aborts pre-merge (fake `gh` log shows no `pr merge`), file content untouched.
- [ ] AC-6 (fail closed on unreadable HEAD copy): Integration test: a telemetry file present on disk but untracked in HEAD → `--ship` aborts pre-merge rather than discarding or proceeding. (This is the observable probe-failure case: reading the HEAD copy fails.)
- [ ] AC-7 (crash safety across the full ship tail): Before the working copy of a pure-append telemetry file is reverted, the suffix is written to a backup file on disk and its path is printed in the run log. The backup persists across the entire merge → archive-rewrite → archive-commit/push tail and is deleted only after that file's suffix is successfully re-appended; if the run `die()`s anywhere in that window (e.g. archive-commit push fails), the backup is left in place for recovery. Verified via unit tests on the helper seam plus an integration assertion that the log line appears and the backup file is absent after a successful ship.
- [ ] AC-8 (pure logic seam): The classification and suffix computation live in `scripts/run-task/validation.ts` as side-effect-free `*FromData`-style functions (inputs: file class, HEAD content, working content; outputs: classification verdict / append suffix), consistent with the existing `*FromData` seam convention there (e.g. `classifyPreflightBlockersFromData`, `verifyBaseDivergenceFromData`). Unit tests in `tests/run-task-validation.test.ts` cover: pure append, working copy identical to HEAD (not dirty), modified existing line, missing HEAD content (untracked), empty suffix, and mixed-file-set classification where one failing file yields an overall abort verdict.
- [ ] AC-9 (clean-path regression): The full existing suite (`npm test`) passes; ship fixtures with a clean supervising checkout behave identically to today.
- [ ] AC-10 (docs): `docs/pipeline-orchestrator.md`'s `--ship` run-order section documents the new gate ("dirty managed docs abort pre-merge; pure-append telemetry dirt is preserved and re-applied as uncommitted dirt after the archive commit; anything else aborts pre-merge") and no longer describes an unconditional discard.
- [ ] AC-11 (archive-staged telemetry preserved without absorption): Integration test in `tests/run-task-ship.test.ts`: REPO_ROOT's `docs/lessons-learned.md` AND `docs/task-quality-log.md` each carry uncommitted pure-append dirt before ship → after a successful `--ship`: (a) both files show their appended suffix as **uncommitted** modifications in `git status --porcelain`; (b) the `chore: archive <id>` commit's committed blob for each file (`git show HEAD:docs/lessons-learned.md`) equals the base+ref-rewrite version and does **not** contain the appended suffix; (c) the suffix is present in the working copy layered on top of the archived/ref-rewritten base content. This test fails both on pre-fix code (suffix discarded) and on any implementation that re-appends before `commitArchiveChanges()` (suffix would be committed into the archive commit) — pinning the load-bearing insertion point.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Replace the `presentSharedDocs` blanket-checkout block (~2063-2072) with a pre-merge classification call (classify all files before mutating any), a managed-doc/unsafe-dirt abort, and the pure-append telemetry preserve step (backup file + revert). Add a re-append step **after `commitArchiveChanges()` returns cleanly** (~2232) that re-appends each saved suffix, leaves the file uncommitted, and deletes its backup. Carry the preserved-suffix set as a local within `shipTasks()` (single process — not cross-phase state; the on-disk backup is the durable/crash-recovery layer). |
| `scripts/run-task/validation.ts` | New pure helpers (`*FromData` seam): classify shared-doc dirt (managed vs telemetry; pure-append vs foreign; abort-wins aggregation across the file set), compute append suffix. |
| `tests/run-task-ship.test.ts` | New integration tests covering AC-2 through AC-7 and AC-11. |
| `tests/run-task-validation.test.ts` | Unit rows for the new `*FromData` helpers (AC-8). |
| `docs/pipeline-orchestrator.md` | Update `--ship` run-order + teardown wording (AC-10). |
| `templates/docs/pipeline-orchestrator.md` | Generated artifact — auto-synced mirror of the managed-doc edit. |
| `dist/cli/index.js` | Generated artifact — rebuild output (shared run-task sources bundle into both entry points). |
| `dist/scripts/run-task.js` | Generated artifact — rebuild output. |

### Interaction Dependencies

- `mergeOpenPRsAndPull()` (`main.ts:1812`) — the pull the discard was protecting; the preserve/revert step must run before it (and before the branch switch) so a dirty tracked file can't block the checkout or pull. This is the same pre-switch site the current cleanup occupies.
- `rewriteArchivedTaskRefs()` (`main.ts:1911`) rewrites `tasks/<id>/` → `tasks/_archive/<id>/` in `docs/lessons-learned.md` and `docs/task-quality-log.md` only; `commitArchiveChanges()` (`main.ts:1886`) then `git add -A`s those two files (via `stagedPaths` at `main.ts:2226`) and commits+pushes them. Because two of the three telemetry files pass through this commit, the re-append must happen **after** `commitArchiveChanges()` returns — otherwise a preserved sibling suffix lands in the pushed archive commit. `docs/pipeline-invocations.md` is untouched by both, so a single post-archive re-append point serves all three uniformly.
- `commitHumanReviewFiles()` / `buildHumanReviewStagePaths()` (`main.ts:712`) stage telemetry from the **active worktree only** (worktree-canonical model, v1.5.0+); REPO_ROOT telemetry dirt is never mirrored to the task branch. This is why the preserved suffix cannot already exist in the merged base content and a plain re-append (no dedup) is correct. If a future change reintroduces a REPO_ROOT→branch telemetry path, the re-append assumption must be revisited.
- The base-branch switch block (`main.ts:2081-2091`) — a dirty tracked file can also block this switch; the classification/preserve step must run before it (the same site as the current cleanup).
- The `orphanedStatusPaths` block (`main.ts:2074-2079`) sits between the current cleanup and the switch; it must remain untouched and ordering-equivalent.

### Data Model Changes

None. No `status.json` schema change; the backup file is a transient artifact in a temp location, not task state.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; check means "suite runs clean," and this task also adds the red-first integration tests and unit rows
- [x] `npm run build` — required: `scripts/run-task/**` changes rewrite both `dist/` entry-point bundles; committed `dist/` must match a fresh build
- [x] `npm run docs-refs-check` — required: `docs/pipeline-orchestrator.md` edit
- [x] `npm run sync-templates:check` — required: managed-doc edit must keep the `templates/` mirror aligned

## Docs Impact

- `docs/pipeline-orchestrator.md` — updated in-task (AC-10).
- `docs/patterns.md` — possible QA-time addition: the "--ship never destroys uncommitted work" invariant as a pattern entry; QA decides.

## Known Risks

- **Re-append insertion point (the reviewed blocker)**: `docs/lessons-learned.md` and `docs/task-quality-log.md` are committed by the archive path, `docs/pipeline-invocations.md` is not. Re-appending before `commitArchiveChanges()` silently commits a sibling's suffix into this task's archive commit and pushes it. Killed by placing the sole re-append point after the archive commit and by AC-11, which asserts the committed blob excludes the suffix while the working copy includes it.
- **Enlarged crash window**: because the re-append now runs at the very end, the revert→re-append gap spans the merge, proof, archive loop, ref-rewrite, and archive commit/push — more steps that can `die()`. The on-disk backup (AC-7) is the load-bearing recovery layer for this whole window; a crash leaves a logged backup rather than silent loss.
- **Duplicate rows via an unforeseen overlap path**: the no-dedup design assumes no path commits REPO_ROOT telemetry dirt to the task branch (verified true today). If one appears later, the blind re-append would produce duplicate rows — a cosmetic defect, not data loss; the Interaction Dependencies note flags the assumption for future changes.
- **New abort friction**: managed-doc dirt now blocks `--ship`. Intended (fail closed), but the message must name files and the exact recovery. `--force` must NOT bypass this gate (AC-4) — silent data loss is not an operator-electable outcome; commit/stash is always available.
- **Ordering regression**: the classification must run before both the branch switch and the merge; a mistake reintroduces the half-shipped-state failure the original cleanup fixed. AC-3/AC-4/AC-5/AC-6 pin "no `pr merge` invoked" to guard this.
- **Sequential per-file processing**: classifying and mutating file-by-file could revert a telemetry file before discovering managed-doc dirt. The two-phase gate in Decision and AC-3 (mixed-dirt fixture, no backup created, both files untouched) exist to kill exactly this interleaving.

## Human Test Plan

1. In a canon-managed project, start two tasks. Let the second one finish only its spec phase (its telemetry rows are now pending, uncommitted, in the main checkout). Take the first task all the way through its pipeline and open its PR.
2. Ship the first task.
3. Expected: the ship completes normally, and the second task's pending telemetry rows are still present, uncommitted, in the main checkout afterward — nothing was lost, and they were not folded into the shipped task's history.
4. Now hand-edit one of the six managed knowledge docs (add a line, leave it uncommitted), and ship another ready task.
5. Expected: the ship refuses before merging anything, tells you which file has uncommitted edits and to commit or stash them, and your edit is exactly as you left it. After committing the edit, re-running the ship succeeds.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed; AC-2 is the red-first regression test
