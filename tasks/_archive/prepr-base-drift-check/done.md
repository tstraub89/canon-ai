# QA Summary: prepr-base-drift-check — Pre-`--pr` base-drift check

## What Changed

Added a new safety gate, `verifyBaseDrift`, that fires inside `commitHumanReviewFiles()` at every `--pr` and `--push` invocation. The gate does a **two-dot tree comparison** between `origin/<base_branch>` and `HEAD` (after fetching origin), then flags any file in that diff that is not in the task's spec `### Affected Files`, a task directory, or the pipeline telemetry allow-list. This catches two previously-uncaught contamination modes:

- **Mode 1**: A third-party commit (hotfix, sibling chip session, or a separate canon task) lands on the base branch while a pipeline is mid-flight. Codex's task branch is unaware; its commits sit on top of a stale snapshot. The gate fetches fresh `origin/<base>` and surfaces the diverged file before the PR opens.
- **Wider Mode 2**: Foreign content auto-committed on the task branch during an earlier phase (before `--pr`) that Fix 2's dirty-tree gate can't see, because it's committed rather than dirty.

The gate is complementary to Fix 2's dirty-tree gate — Fix 2 stops bad content from being committed; this fix stops bad commits from being pushed and PR'd.

**Key behaviors:**
- Fetch failure (offline operator) → warns and skips. Best-effort guarantee given network state.
- Diff failure after a successful fetch → hard fail, no `--force` bypass. A gate that can't compute its answer must fail closed.
- Drift detected without `--force` → `die()` with an actionable message naming each drifted file, three recovery options (rebase onto current `origin/<base>`; `git checkout origin/<base> -- <path>` + commit; or `git revert <sha>`), the rename-both-sides requirement, and the `--force` bypass.
- Drift detected with `--force` → loud `warn()` listing all drifted files, then continues.
- No drift → silent continue.

**Rename requirement**: Because two-dot diff with `-M` surfaces both old and new paths for a rename, spec authors who legitimately rename a file must list **both** the old and new paths in `### Affected Files`. The die message explains this.

**Known residual** (documented in spec Known Risks): If a file appears in both the spec's Affected Files AND is touched by a third-party commit on base, base-drift sees it as authorized and lets it through. The deeper fix (rebase at implement→code_review boundary) is deferred to BACKLOG.md.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/git.ts` | New exported `getTreeDriftFiles(baseRef, cwd)` helper — two-dot diff with rename detection |
| `scripts/run-task/validation.ts` | New exported `verifyBaseDriftFromData` (pure data layer) and `verifyBaseDrift` (orchestrating wrapper with fetch + spec parse + result routing) |
| `scripts/run-task/main.ts` | Wired `verifyBaseDrift` into `commitHumanReviewFiles()` immediately after `mirrorHumanReviewDocsToCwd` |
| `scripts/run-task/cli.ts` | Updated `--pr` and `--push` help text to mention the base-drift gate and `--force` bypass |
| `src/cli/index.ts` | Same help text addition for top-level `canon --help` |
| `dist/cli/index.js` | Regenerated |
| `dist/scripts/run-task.js` | Regenerated |
| `tests/run-task-validation.test.ts` | 8 new `verifyBaseDriftFromData` cases (empty diff, allowed path, drift path, task-dir, telemetry, bundle union, deleted file, rename old-path) + wrapper fetch/diff/malformed tests |
| `tests/run-task-safety.test.ts` | Integration tests for `commitHumanReviewFiles` base-drift gate (allowed path, drift die, `--force` warn/proceed, diff-failure fail-closed, real-git base-advance Mode 1 fixture) |
| `docs/pipeline-orchestrator.md` | New paragraph in `## Auto-Branch + Auto-Commit` documenting the gate, where it fires, what it catches, complementarity with Fix 2, rename requirements, and `--force` limits |

## How to Test

**Automated**: `npm test` — 407 tests, 406 pass, 1 skipped (pre-existing skip). The new tests include a real-git fixture that proves two-dot semantics catch the Mode 1 case: origin/base advances on a file the task branch never edits, and the gate flags it. If the implementation accidentally used three-dot, this test would silently pass — the test construction is specifically designed to catch that regression.

**Manual simulation** (from spec's Human Test Plan):
1. Create a demo task with a spec listing `docs/codebase-map.md` in `### Affected Files`. Don't run the pipeline yet.
2. Commit a small change to a different file (e.g., `docs/decisions.md`) directly on the base branch and push.
3. Let the pipeline reach `human_review` without rebasing the task branch.
4. Run `canon run <id> --pr`. **Expected**: gate fires, names `docs/decisions.md` as drift, presents three recovery options, mentions `--force`.
5. Recovery A — `git fetch origin <base> && git rebase origin/<base>`, re-run `--pr`. **Expected**: PR opens.
6. Recovery B — `git checkout origin/<base> -- docs/decisions.md && git commit`, re-run `--pr`. **Expected**: PR opens.
7. Recovery C — `canon run <id> --pr --force`. **Expected**: loud warning listing the drifted file, then PR opens.
8. Same scenario with `docs/decisions.md` also in the spec's Affected Files: gate passes. This is the documented same-file Mode 1 residual — expected behavior.

## Test Results

All validation checks passed on Codex's submitted iteration (single-pass implementation):

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (full suite) | Pass — 407 tests, 406 pass, 1 skipped |
| `npm run build` | Pass — dist matches fresh build; CI `git diff --exit-code -- dist/` will pass |
| E2E | N/A — no UI |

## Decisions Made

- **Two-dot, not three-dot**: `getTreeDriftFiles` uses `git diff <base> HEAD --name-status -M -z`. Three-dot only reports files changed on the task branch since the merge base and is blind to base advances — exactly the Mode 1 case this gate exists to catch.
- **No new flag**: Reused `cliArgs.force` rather than adding a new `--allow-drift` flag. Same "I understand the risk" semantics as the existing full-send-on-delicate gate.
- **Fetch-fail vs diff-fail asymmetry**: Fetch failure is offline-tolerant (warn + skip); diff failure after a successful fetch is hard-fail (no `--force` bypass). A gate that can't compute its answer must fail closed.
- **`--force` does not bypass diff failure**: `--force` is for "I've verified the drift is intentional," not for "the gate is broken."
- **Implementation deviation**: The `--force` bypass test routes through `main()` rather than calling `commitHumanReviewFiles()` directly, because the function reads the module-level `cliArgs`. Documented in the handoff; no AC coverage impact.

## Open Questions

None blocking. The same-file Mode 1 residual is documented in the spec's Known Risks and tracked in BACKLOG.md ("rebase at implement→code_review boundary" — explicitly deferred to a future task for 1.5).

---

## Proposed Changelog

**Target version**: 1.4.0 (already unreleased — add to the existing `[1.4.0]` `### Added` section)

**Proposed bump rationale**: New feature (new pipeline gate at `--pr`/`--push`) that does not break existing usage when the spec's `### Affected Files` is accurate. Tasks with an accurate spec pass silently; no workflow changes required. Minor bump — already targeted to the 1.4.0 unreleased block.

**Proposed bullet** (for `### Added` in `[1.4.0]`):

> **`canon run --pr` and `--push` now abort if the task branch's tree has diverged from `origin/<base>` on files outside the spec's scope.** After fetching the latest `origin/<base>`, the orchestrator computes a two-dot tree diff and flags any file not in the spec's `### Affected Files`, the task directory, or pipeline telemetry. This catches two previously-undetected contamination modes: a third-party commit landing on base while a pipeline is mid-flight (Mode 1, the shape behind the gallery_wall `03ff7fb` incident), and foreign content auto-committed to the task branch during an earlier phase (wider Mode 2). The error message names each drifted file and offers three recovery options (rebase onto current origin/<base>, single-file checkout from origin, or git revert). Bypass with `--force` when drift is intentional; note that renames require both old and new paths in `### Affected Files`. Fetch failure (offline) is tolerated with a warning; diff failure after a successful fetch is a hard abort.
