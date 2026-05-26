# Implementation Handoff: fix-ship-non-worktree-enoent

> Author: Codex | Spec: `tasks/fix-ship-non-worktree-enoent/spec.md` | Plan: `tasks/fix-ship-non-worktree-enoent/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `scripts/run-task/main.ts` | `shipTasks` now captures `baseBranch`, resolved task branch names, worktree flags, and full status snapshots before checking out the base branch; post-switch helpers consume captured values instead of re-reading status. |
| `tests/run-task-safety.test.ts` | Added real-git `--ship` coverage for `worktree: false` with no base-branch task dir and `worktree: true` with a real worktree; documented the existing fake-git smoke test's actual coverage. |
| `CHANGELOG.md` | Added the adopter-facing 1.5.0 fixed entry for non-worktree `canon run --ship` ENOENT. |
| `dist/scripts/run-task.js` | Refreshed tracked build output from `npm run build` for the `main.ts` change. |

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

The failure was caused by `shipTasks` switching REPO_ROOT to the base branch and then calling helpers that derived `baseBranch`, branch names, or status from `tasks/<id>/status.json`. For non-worktree tasks, that directory is absent on base until the PR merge and pull complete.

The fix keeps the existing state helpers intact and moves the `shipTasks` call tree to a pre-switch snapshot: `baseBranch`, each task's resolved branch name, the worktree flag, and the full `StatusJson` are captured before `ensureCheckedOutBaseBranch`. The post-switch merge, safety checks, archive loop, and local-branch cleanup now use that captured state.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| `assertOriginTaskBranchAbsent` now takes only `branchName` and `baseBranch`, not `taskId`. | The helper no longer needs `taskId` once the post-switch status reads are removed; keeping an unused parameter would add lint risk without preserving behavior. | None; AC-6 requires `branchName` and `baseBranch`, and both call sites pass captured values. |
| The new real-git subprocess helper imports `main.ts` from `process.cwd()` instead of `REPO_ROOT`. | In this linked-worktree test run, `REPO_ROOT` resolves to the supervising checkout, which would run stale source. This follows the existing test-writing pitfall for subprocess tests. | Strengthens AC-7 and AC-9 coverage; no behavior change. |
| `dist/scripts/run-task.js` is included in the changes. | `npm run build` is required by the spec and refreshes the tracked bundled CLI output. | None; generated artifact matches the source change. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `baseBranch` is captured in `shipTasks` before `ensureCheckedOutBaseBranch`; no post-switch `getBaseBranch(taskIds)` remains in `shipTasks`. |
| AC-2 | Met | `shipTasks` builds `taskSnapshots` before the branch switch with branch, worktree flag, and full status; the archive loop uses `taskSnapshot(...)` for status and branch name. |
| AC-3 | Met | `mergeOpenPRsAndPull` accepts `baseBranch` and `branchByTaskId`; grep of the function body has zero `getBaseBranch` / `resolveTaskBranchName` matches. |
| AC-4 | Met | `assertNoOpenPRForTask` accepts `branchName` and `baseBranch`; its body no longer derives either value. |
| AC-5 | Met | `assertLocalBaseInSyncWithOrigin` accepts `baseBranch`; its body has zero `getBaseBranch` matches. |
| AC-6 | Met | `assertOriginTaskBranchAbsent` accepts `branchName` and `baseBranch`; both `shipTasks` and the `mergeOpenPRsAndPull` local-delete-failed loop pass captured values. |
| AC-7 | Met | Added `main --ship handles a task with worktree: false when base lacks status.json`; it uses real git so checkout to base removes the task dir. Pre-fix ENOENT evidence is pasted below. |
| AC-8 | Met | Added the one-line audit comment above the existing fake-git `--ship` smoke test explaining that fake checkout leaves `tasks/<id>/` on disk and AC-7 supplies ENOENT coverage. |
| AC-9 | Met | Added `main --ship handles a task with worktree: true and tears down the worktree`; status lives in the real task worktree and the test asserts archive plus worktree removal. |
| AC-10 | Met | Grep of `shipTasks` after `ensureCheckedOutBaseBranch` found zero `readStatus`, `getBaseBranch`, or `resolveTaskBranchName` calls; the four updated helpers also have zero prohibited derivation calls. |
| AC-11 | Met | Added the 1.5.0 `### Fixed` CHANGELOG entry for non-worktree `--ship` ENOENT. |

## Edge Cases Considered

- Non-worktree task branch where base lacks `tasks/<id>/status.json` until `git pull` after the simulated merge.
- Worktree-mode task whose status is available only under the linked worktree before teardown.
- Existing fake-git `--ship` smoke coverage, which cannot reproduce missing task dirs because fake checkout only changes a marker file.
- Bundles sharing a branch: `mergeOpenPRsAndPull` still deduplicates captured branch names.
- The `gh pr merge --delete-branch` local-delete-failed path still runs `assertOriginTaskBranchAbsent` using captured branch/base values.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | |
| `type-check` (`npm run type-check`) | Pass | |
| `unit tests` (`npm test`) | Pass | Also ran targeted `node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-safety.test.ts` after adding the real-git cases. |
| `docs-refs-check` (`npm run docs-refs-check`) | Pass | |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | |
| `build` (`npm run build`) | Pass | Refreshed `dist/scripts/run-task.js`. |
| `E2E` | not_configured | Spec: Validation Required marks E2E as N/A; no UI path. |

Manual pre-fix reproduction evidence for AC-7:

```text
STATUS: 1
STDOUT:
→ Switching from 'task/ship-nw-prefixed' to base branch 'main' before shipping...

STDERR:
Error: ENOENT: no such file or directory, open '/private/var/folders/dk/qw6f77vn4v37h4k_zzvb9tvw0000gn/T/ship-prefix-enoent-bcPn8I/local/tasks/ship-nw-prefixed/status.json'
    at Object.readFileSync (node:fs:441:20)
    at readStatus (/Users/tstraub/canon-ai/dev-worktrees/fix-ship-non-worktree-enoent/scripts/run-task/state.ts:109:34)
    at Module.getBaseBranch (/Users/tstraub/canon-ai/dev-worktrees/fix-ship-non-worktree-enoent/scripts/run-task/git.ts:113:28)
    at mergeOpenPRsAndPull (/Users/tstraub/canon-ai/dev-worktrees/fix-ship-non-worktree-enoent/scripts/run-task/main.ts:1445:33)
    at shipTasks (/Users/tstraub/canon-ai/dev-worktrees/fix-ship-non-worktree-enoent/scripts/run-task/main.ts:1650:20)
    at Module.main (/Users/tstraub/canon-ai/dev-worktrees/fix-ship-non-worktree-enoent/scripts/run-task/main.ts:2398:9)
    at [eval]:2:87 {
  errno: -2,
  code: 'ENOENT',
  syscall: 'open',
  path: '/private/var/folders/dk/qw6f77vn4v37h4k_zzvb9tvw0000gn/T/ship-prefix-enoent-bcPn8I/local/tasks/ship-nw-prefixed/status.json'
}
```

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>` (`origin/release/v1.5` is an ancestor of HEAD)

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
