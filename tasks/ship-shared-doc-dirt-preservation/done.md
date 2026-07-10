# Completion Summary: ship-shared-doc-dirt-preservation — Stop --ship discarding live shared-doc edits in the supervising checkout

> For the human. This is what you need to know.

## What Changed

`--ship` used to run a blanket revert on every uncommitted "shared doc" it found in the supervising checkout right before switching branches — that swept up both the six operator-maintained knowledge docs (`docs/patterns.md`, `docs/decisions.md`, etc.) and the three telemetry files that other in-flight tasks append to (`docs/pipeline-invocations.md`, `docs/lessons-learned.md`, `docs/task-quality-log.md`). If a sibling task had pending, uncommitted telemetry rows — or an operator had a hand-edit sitting in one of the knowledge docs — shipping any *other* worktree-mode task silently discarded it. This actually happened in an adopter repo on 2026-07-06.

`--ship` now classifies every dirty shared doc **before** merging anything, gated first on the file's `git status --porcelain` code and only then on content:
- A dirty managed doc (knowledge doc) aborts the ship up front, names the file, and tells the operator to commit or stash (`--force` does not bypass this).
- A dirty telemetry file is preserved only if it's in the plain "unstaged modification" shape (`' M'`) **and** its uncommitted content is a byte-for-byte pure append over the committed version. The suffix is backed up to disk, the working copy reverted so the merge/checkout can proceed, and — once the ship's own archive commit has been staged (but before it's committed or pushed) — the suffix is re-appended as ordinary uncommitted dirt, never folded into the shipping task's commit.
- Anything else — a staged-only edit, a working-tree deletion, a rename, an untracked file, or telemetry dirt that isn't a pure append — aborts pre-merge instead of being silently discarded or swept into the archive commit.

This task went through two rounds of hardening after the initial implementation: a spec amendment fixed a narrowed-but-real crash window (a commit or push failure between revert and re-append could still strand the suffix — closed by moving the re-append to strictly after `stageArchiveChanges()` and before `commitArchiveChanges()`), and a second round closed a real regression (`SG-1`) that `code_review` caught: the original content-diff-only classifier treated a **staged-only** edit (`git add` followed by a botched working-tree reset) as `clean`, so it would have ridden silently into the pushed archive commit. The fix replaced content-diff detection with `git status --porcelain` as the first-order gate — only the exact `' M'` code is eligible for the pure-append/managed-dirt check; every other code (staged add/modify/delete, working-tree delete, rename, untracked) aborts for both file classes.

## Files Changed

- `scripts/run-task/main.ts` — replaced the blanket `checkout HEAD --` shared-doc discard with a batched `git status --porcelain` classification gate, durable backup-then-revert for safe pure-append telemetry, fail-closed aborts for every unsafe porcelain shape, the split `stageArchiveChanges()` / `commitArchiveChanges()` seam, and re-append strictly between staging and commit.
- `scripts/run-task/validation.ts` — new pure classification helpers (`classifySharedDocDirtFromData`, `classifySharedDocSetFromData`, `buildSharedDocAbortMessage`), porcelain-code-gated before any content comparison.
- `tests/run-task-ship.test.ts` — integration coverage for preserved telemetry, managed-doc abort (including with `--force`), mixed-dirt abort ordering, non-append/untracked telemetry aborts, backup cleanup, archive-commit exclusion of the preserved suffix, commit/push-failure preservation, staged-only-edit aborts (managed + telemetry), and working-tree-deletion aborts.
- `tests/run-task-safety.test.ts` — updated the direct archive-commit helper test to call the new `stageArchiveChanges()` before the slimmed `commitArchiveChanges()`.
- `tests/run-task-validation.test.ts` — unit rows for the porcelain-gated classification helpers, covering every practical porcelain code plus the defensive HEAD-read-failure fallback.
- `docs/pipeline-orchestrator.md` (+ `templates/docs/pipeline-orchestrator.md` mirror) — documents the new `--ship` shared-doc gate and the corrected 9-step run order (re-append after archive staging, before commit/push).
- `dist/scripts/run-task.js` — rebuilt bundle (source-only change; `dist/cli/index.js` came out byte-identical).

## How to Test

1. In a canon-managed project, start two tasks. Let the second one finish only its spec phase, so its telemetry rows are pending and uncommitted in the main checkout. Take the first task all the way through its pipeline and open its PR.
2. Ship the first task.
3. Expected: the ship completes normally, and the second task's pending telemetry rows are still present, uncommitted, in the main checkout afterward — nothing was lost, and they were not folded into the shipped task's history.
4. Hand-edit one of the six managed knowledge docs (add a line, leave it uncommitted), then ship another ready task.
5. Expected: the ship refuses before merging anything, tells you which file has uncommitted edits and to commit or stash them, and your edit is exactly as you left it. After committing the edit, re-running the ship succeeds.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 939 tests: 938 pass, 1 skipped |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js`; `dist/cli/index.js` byte-identical |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |

Code review (3-lens: anchored Claude, cold Claude, cold Codex) verdict on the final round: **approved with nits**. All 11 base ACs plus 6 Amendment-Round-1 ACs (A1–A6) plus 5 Amendment-Round-2 ACs (A7–A11) — 22 total — independently re-verified Pass; no correctness bug or test-integrity issue survived adjudication across any lens. Six low-severity nits were logged and dispositioned as non-blocking (see Open Questions below).

## Human Verification Required

None. Every check in `handoff.md`'s Validation Outcomes resolved `Pass`; no `human_pending` rows.

Handoff pre-merge checklist:
- [ ] Version correct — N/A for this task; version bump is a separate release-step commit per `docs/decisions.md` §"Versioning and release policy", not part of this diff.
- [ ] Changelog updated — not yet; see Proposed Changelog below for the draft entry text. Final version/tier and the changelog commit happen at the release step.
- [x] PR body current — refreshed in `tasks/ship-shared-doc-dirt-preservation/pr-body.md` to match the final (post-amendment) implementation.
- [ ] Final CI/CD checks green — will run once the PR is opened; not yet observable at QA time.
- [x] Final diff matches spec intent — all 22 ACs (11 base + A1–A6 + A7–A11) confirmed Met by the final code review round.

## Proposed Changelog

- **`--ship` no longer silently discards uncommitted edits to shared docs in the supervising checkout.** Shipping any worktree-mode task used to run a blanket revert of every dirty file in `PIPELINE_SHARED_DOCS` — including a sibling task's pending telemetry rows and an operator's hand-edited knowledge docs — right before the base-branch checkout. `--ship` now classifies shared-doc dirt via `git status` before merging anything: a dirty managed doc (`docs/patterns.md`, `docs/decisions.md`, etc.) aborts the ship, names the file, and tells the operator to commit or stash (`--force` does not bypass this). Telemetry dirt (`docs/pipeline-invocations.md`, `docs/lessons-learned.md`, `docs/task-quality-log.md`) is preserved only when it's a plain unstaged pure append over the committed copy — it's backed up, reverted for the merge, and re-appended as uncommitted dirt once the ship's own archive commit is staged (but before it's committed), so a sibling task's in-flight rows survive without being folded into the wrong commit. A staged-only edit, a working-tree deletion or rename, or non-append telemetry dirt all abort pre-merge instead of being discarded or silently committed. Ships to adopters via `canon upgrade`.

## Decisions Made

- **Re-append insertion point.** Telemetry suffixes are re-appended at a single point *after* `stageArchiveChanges()` runs but *before* `commitArchiveChanges()` runs — not right after the PR merge, and not after the whole archive commit/push completes. Two of the three telemetry files (`docs/lessons-learned.md`, `docs/task-quality-log.md`) pass through the archive commit's staging; re-appending earlier would fold a sibling task's pending rows into — and push them as part of — this task's `chore: archive` commit. Re-appending any later would leave the suffix unrestored through a commit or push failure. This narrows the crash window to "merge through staging" (recoverable via the on-disk backup) while closing it entirely for the commit/push tail.
- **Porcelain-first classification (closes a real regression, `SG-1`).** The original implementation classified dirt purely by comparing working-tree content to `HEAD`. `code_review` found this let a **staged-only** edit (content matches HEAD in the working tree, but the index differs) pass as `clean` and ride silently into the pushed archive commit — a direct hole in the "fail closed on managed-doc dirt" guarantee. The fix replaced content-diff detection with a batched `git status --porcelain` gate: only the exact `' M'` code (no staged difference, working tree modified) is eligible for the pure-append/managed-dirt content check; every other code — staged add/modify/delete, working-tree delete, rename, untracked — aborts for both file classes, with no per-case exceptions. This closes the staged-only-edit hole and, as a side effect, a pre-existing gap where a working-tree deletion or rename was invisible to the old `fs.existsSync` present-filter.
- **`--force` does not bypass the managed-doc abort.** Silent data loss on a knowledge doc was judged worse than added friction; commit-or-stash is always available as a way through.
- **No dedup on re-append.** Under the worktree-canonical model, REPO_ROOT telemetry dirt is never mirrored to the task branch, so the merged content can't already contain the preserved suffix — a plain append is correct today. Flagged as an assumption to revisit if a future change reintroduces a REPO_ROOT→branch telemetry path.

## Open Questions

The final code-review round (all three lenses: anchored Claude, cold Claude, cold Codex) converged on two residual edges that are real but low-severity with no data-loss path, plus four cosmetic/test-coverage nits. None required a further revision round; all are non-blocking and available for a human decision at this gate:

- **N1 — A mode-only `' M'` (content identical to HEAD) is classified `clean`, bypassing the fail-closed managed-doc gate** (`scripts/run-task/validation.ts`, `workingContent === headContent → clean`). `git status` reports a `chmod`-only change as `' M'` with byte-identical content, so a genuinely git-dirty managed doc with only a mode change skips the abort — and for `docs/lessons-learned.md`/`docs/task-quality-log.md` the mode bit would ride into the pushed archive commit. Reachable only via `chmod` on a markdown file (no real operator workflow); the leaked artifact is a mode bit, not content — cosmetic, visible in the diff, trivially reversible. One-line hardening if elected: gate the `clean` fast-path on `porcelainCode === null` only, so a mode-only `' M'` aborts like any other unrecognized state.
- **N2 — The `HEAD:<path>` snapshot is taken before the base-branch switch; a supervising checkout not already on base would validate against the wrong blob** (`scripts/run-task/main.ts`). Under the supported worktree-canonical model, REPO_ROOT is already on base at this point, so `HEAD` == base and this is correct. The only affected path is a contrived mixed worktree/non-worktree bundle or a manual non-base checkout — and even there the worst outcome is a fail-closed false-abort (friction, no data loss), never silent corruption. Hardening if elected: read `${baseBranch}:<path>` explicitly instead of `HEAD:<path>`.
- **N3 — Leaked empty backup directory.** The temp directory created to hold a backup file is never removed (only the file inside it is) — cosmetic tmp litter, one empty dir per preserving ship.
- **N4 — Misleading reason text on a defensive fallback branch.** A `null` working-copy read is described as "not readable at HEAD," which points at the wrong side of the comparison. Effectively unreachable in practice; cosmetic wording fix if touched again.
- **N5 — A unit test asserts the unsafe-porcelain-code abort only for the `telemetry` doc class**, not `managed`. Behavior is identical for both (the abort happens before the class branch), but only one class has a locking test.
- **N6 — No fixture exercises a re-append onto content the base advanced under the suffix**, so N2's failure mode is never directly observed by the test suite even though the code paths (N1, N2 hardening) would be.

None of these require your input before merging — they're logged here so a future hardening task (or an explicit Non-Goal note in this spec) has the context if one of them ever bites.
