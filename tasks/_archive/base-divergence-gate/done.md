# QA Summary: base-divergence-gate

> Task: Harden --push/--pr/--ship remote boundary: base-divergence gate, push reminder, tolerate auto-deleted branch
> Reviewer: Claude | Date: 2026-05-29

## What Changed

Three hardening changes to canon's remote-boundary layer (`--push` / `--pr` / `--ship`):

**1. Base-divergence gate** — A new check runs before the existing file-allow-list gate at `--push` / `--pr`, and before `mergeOpenPRsAndPull` at `--ship`. When local `<base_branch>` has commits not yet on `origin/<base_branch>`, canon hard-fails with a root-cause message listing the colliding commits, a `git push origin <base>` fix instruction, and an `--allow-divergent-base` override instruction. Blocking before merge is the key safety property: it prevents the post-merge pull conflict that would previously strand ship in a half-complete state. `--force` does NOT bypass this gate; it requires the dedicated `--allow-divergent-base` flag.

**2. Push reminder** — The first-implement path (inside the `!worktreeAlreadyCreated` guard) now prints an informational message reminding the operator to `git push origin <base>` after the scaffold commits land. Fires exactly once per bundle, never on reroutes or review iterations.

**3. Auto-deleted branch tolerance at ship-merge** — `mergeOpenPRsAndPull` replaced its stderr-substring tolerance (`already merged` / `used by worktree`) with an authoritative prNum-specific merge-state check (`isPRMerged(prNum)` via `gh pr view <prNum> --json state`). When `gh pr merge --squash --delete-branch` exits non-zero but the specific PR is confirmed merged, ship emits a warning and continues instead of dying. The `assertOriginTaskBranchAbsent` safety net is preserved in the tolerated path. This covers the GitHub "automatically delete head branches" race condition.

## Files Changed

| File | What Changed |
|---|---|
| `scripts/run-task/git.ts` | Added `getUnpushedBaseCommits(baseBranch, cwd)` |
| `scripts/run-task/validation.ts` | Added `verifyBaseDivergenceFromData` and `verifyBaseDivergence` |
| `scripts/run-task/types.ts` | Added `CliArgs.allowDivergentBase` |
| `scripts/run-task/cli.ts` | Parsed `--allow-divergent-base`, documented in usage text |
| `scripts/run-task/main.ts` | Wired divergence gate at `--push`/`--pr`/`--ship`; prNum-specific merge tolerance; `classifyMergeOutcome` seam |
| `scripts/run-task/phases/implement.ts` | Push reminder in `!worktreeAlreadyCreated` guard |
| `tests/run-task-validation.test.ts` | Data-seam + real-git fixture tests (AC-7, AC-8) |
| `tests/run-task-safety.test.ts` | Subprocess `--push` block/bypass tests; reminder-once test; `classifyMergeOutcome` matrix (AC-9, AC-13, AC-15) |
| `tests/run-task-cli.test.ts` | Updated parser shape tests for new `CliArgs` field (outside spec Affected Files; required to keep suite green) |
| `docs/codebase-map.md` | Row updated: "Base-drift + base-divergence gates (`--push`/`--pr`/`--ship`)" |
| `docs/pipeline-orchestrator.md` | Documented `--allow-divergent-base`, gate ordering, ship ahead-block |
| `templates/docs/pipeline-orchestrator.md` | Derived template sync (outside spec Affected Files; required by `sync-templates:check`) |
| `dist/scripts/run-task.js` | Regenerated bundle (spec marked Build N/A; `docs/architecture.md` requires regeneration for `scripts/run-task/**` changes) |

## How to Test

Steps from the spec's Human Test Plan:

1. **Divergent-base block at `--pr`:** Create two tasks without pushing base between them. Take one to `human_review`. Run `canon run <id> --pr`. Expected: hard-fail listing the colliding commit short-shas and subjects, with literal `git push origin <base>` and `--allow-divergent-base` in the error.
2. **Gate clears after push:** Run `git push origin <base>`, then re-run `canon run <id> --pr`. Expected: gate no longer fires.
3. **Override path:** In a fresh divergent scenario, run `canon run <id> --pr --allow-divergent-base`. Expected: warning about divergent commits, but no abort at this gate.
4. **`--force` is not a substitute:** Fresh divergent scenario, run `canon run <id> --pr --force` (no `--allow-divergent-base`). Expected: still aborts at the commit-divergence gate.
5. **`--ship` blocks before merge:** Push base clean, open PR, add a fresh unpushed scaffold commit to local base. Run `canon run <id> --ship`. Expected: aborts before merging the PR. With `--allow-divergent-base`, ship proceeds.
6. **Push reminder:** Fresh task, first implement run. Expected: one `git push origin <base>` reminder in output. Continue through a reroute or review iteration — reminder does NOT print again.
7. **Auto-deleted branch tolerance:** On a repo with "automatically delete head branches" enabled, run `canon run <id> --ship` while ship performs the merge. Expected: ship completes cleanly with at most a warning about the tolerated branch-delete.

## Test Results

| Check | Result |
|---|---|
| Linting — `npm run lint` | Pass |
| Type checking — `npm run type-check` | Pass |
| Unit tests — `npm test` | Pass — 613 tests, 612 pass, 1 skipped |
| Build — `npm run build` | Pass |
| E2E | deferred_by_spec — canon has no UI surface |
| Docs references — `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| `git diff --check` | Pass |

## Human Verification Required

None.

## Decisions Made

- **`--allow-divergent-base` and `--force` are independent, non-coalescing bypasses.** `--allow-divergent-base` bypasses only the commit-divergence check; `--force` bypasses only the file-allow-list gate. Operators who need past both must pass both.
- **`--ship` hard-blocks on ahead-divergence before merge.** Matches the existing `assertLocalBaseInSyncWithOrigin` hard-block precedent (behind direction). `--allow-divergent-base` is the escape valve.
- **Fetch-fail-open:** a network blip at the divergence check emits a warning and does not block operations.
- **Merge-state tolerance is prNum-specific, not branch-based.** `findMergedPRNumber(branch, baseBranch)` was rejected: it proves *some* PR for that branch/base is merged, not the just-attempted one. A reused branch name (older merged PR on same branch→base) would false-tolerate a real merge failure. `isPRMerged(prNum)` keys on the exact attempted PR number.

## Open Questions

None.

## Proposed Changelog

Candidate entries for the `[Unreleased]` block:

```markdown
### Added

- **`--push`/`--pr`/`--ship` base-divergence gate** — hard-fails when local `<base_branch>` is ahead of `origin/<base_branch>`, listing the colliding commits with fix and override instructions. Prevents the misleading "file drift" error and the post-merge pull conflict that previously stranded `--ship` after an irreversible merge. New flag `--allow-divergent-base` bypasses this check only; `--force` continues to bypass only the file-allow-list gate.
- **Scaffold push reminder** — first `canon run` on a task prints an informational reminder to `git push origin <base>` after the scaffold commits land on the local base branch.

### Fixed

- **`canon run --ship` tolerates a branch already deleted by GitHub's "auto-delete head branches"** — when `gh pr merge --squash --delete-branch` fails on branch deletion but the PR is confirmed merged (verified against the specific attempted PR number), ship warns and completes teardown instead of dying after the irreversible merge.
```

**Proposed version bump: 1.7.0 (minor).** The new gate and `--allow-divergent-base` flag are additive new behavior operators will encounter on their next `--push`/`--pr`/`--ship` run; per `docs/decisions.md`, new validation gates are minor-level. The AC-14 fix alone would be patch, but the gate + flag tip the bundle to minor. The current release branch is `release/v1.6.1` (patch) — recommend confirming whether to rename it or cut a fresh `release/v1.7.0` branch.

The human finalizes copy and version.
