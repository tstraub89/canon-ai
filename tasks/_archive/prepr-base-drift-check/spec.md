# Spec: prepr-base-drift-check — Pre-`--pr` base-drift check (cross-pipeline contamination Fix 1)

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The just-shipped `scope-pr-auto-commit-to-affected-files-v2` ([archived spec](../../tasks/_archive/scope-pr-auto-commit-to-affected-files-v2/spec.md)) addressed cross-pipeline contamination Mode 2 by narrowing the `--pr` auto-commit allow-list. It catches the *common* case: a dirty managed doc in the worktree, not listed in the spec's Affected Files, dies at the commit gate before landing in the PR. But its allow-list is path-level and only operates on *uncommitted* state at `--pr` time. Two contamination modes remain uncaught:

- **Mode 1 — third-party commit lands mid-pipeline** ([BACKLOG.md:454](../../docs/BACKLOG.md:454)). A manual hotfix, sibling chip session, or separate canon task commits to base while pipelines A and B are running. Codex implementing in pipeline B's worktree edits the same file the third actor touched. Codex's diff is computed against B's stale worktree base (pre-third-party), so the implement commit re-introduces lines the third party removed. The dirty-tree gate never fires (the file is committed, not dirty). Code review and QA pass against a stale base. The PR ships partially-stale content. **Reference**: gallery_wall commit `03ff7fb`.
- **Wider Mode 2** — a sibling pipeline's worktree-to-worktree sync propagated managed-doc content into Task B's worktree, and Codex auto-committed it during an earlier phase before `--pr`. By the time `--pr` runs, the foreign content is on the task branch's commits — not in the dirty tree. Fix 2 doesn't see it.

Both cases share the same shape: the task branch's HEAD tree differs from the *current* `origin/<base_branch>` tree on files that aren't in the spec's Affected Files. The detection is cheap (`git fetch origin <base>` + a two-dot `git diff origin/<base> HEAD --name-status -z`) and the signal is high: a divergence outside the spec's authorized scope is contamination or unauthorized scope creep.

**Why two-dot, not three-dot**: A three-dot diff (`git diff A...B`) reports only files changed on `B` since the merge base — it does not surface files where `A` (the base) advanced and `B` didn't. That makes three-dot blind to Mode 1's canonical case: a third-party commit lands on base while the task branch is mid-pipeline, touching a file the task never edits. Two-dot (`git diff A B`) compares the two trees directly: it surfaces files Codex edited on the task branch, files the base advanced with that the task didn't, and files both sides touched with divergent content. That's the right set for "is the PR diff against base contaminated?".

The fix is a new gate at `--pr` time, complementary to Fix 2's dirty-tree gate. Together they form a defense layer: Fix 2 stops bad content from being committed; Fix 1 stops bad commits from being pushed and PR'd.

## Decision

Add a `verifyBaseDrift` check that fires inside `commitHumanReviewFiles()` ([scripts/run-task/main.ts:887](../../scripts/run-task/main.ts:887)) **immediately after `mirrorHumanReviewDocsToCwd(cwd)`** and before all subsequent state inspection. The check is single-purpose, single-die-mode, additive:

1. `git fetch origin <base_branch>` in the worktree. On fetch failure, emit a warning and continue (mirror [`assertOriginTaskBranchAbsent`'s offline tolerance](../../scripts/run-task/main.ts:1219) — operator re-runs when network is restored). Fetch failure is offline-tolerant because freshness of `origin/<base>` is what the check requires; an unreachable origin is "best effort given network state."
2. Compute the diff via a **new** helper `getTreeDriftFiles(baseRef, cwd)` added to [scripts/run-task/git.ts](../../scripts/run-task/git.ts). It runs `git diff <baseRef> HEAD --name-status -M -z` (two-dot, with rename detection) and returns `{ files: string[]; ok: boolean }`. On underlying `git diff` failure, `ok: false` — the wrapper must distinguish "diff failed" from "diff produced empty output." Reuses `parseNameStatusOutput` ([git.ts:314](../../scripts/run-task/git.ts:314)) so rename records contribute both old and new paths to the returned set, per the `docs/patterns.md` rule "Use --name-status, not --name-only, when building path sets from `git diff`." `getAffectedFiles` ([git.ts:330](../../scripts/run-task/git.ts:330)) is **not modified** — its three-dot semantics are correct for handoff validation, where "what did this branch change?" is the right question. Base-drift needs a different question and gets its own helper.
3. **Diff-failure handling.** If `getTreeDriftFiles` returns `ok: false` after fetch succeeded, that is a hard error, not a no-op. `verifyBaseDrift` propagates the failure to the caller (`{ drift: [], fetchFailed: false, diffFailed: true }`); the caller in `commitHumanReviewFiles` `die()`s with a message naming the underlying git error. A safety gate that silently passes when it can't compute its own answer is no gate. (Contrast with fetch failure, which is offline-tolerant by design — see step 1.)
4. Build the allow-list union:
   - **Task dirs**: `tasks/<id>` and `tasks/<id>/**` for every task ID in the bundle (always allowed — task artifacts are legitimate PR content).
   - **Telemetry**: `PIPELINE_TELEMETRY_FILES` at [worktree.ts:9](../../scripts/run-task/worktree.ts:9) (`docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md`).
   - **Spec Affected Files**: the *full* set returned by `parseAffectedFilesFromSpec(taskId)` ([validation.ts:649](../../scripts/run-task/validation.ts:649)) for each task ID, unioned. **No managed-docs intersection filter** — base-drift answers "is the PR diff against base contaminated?", not "what gets auto-committed at --pr?". Source/test files in Affected Files ARE legitimate task-branch content vs base (they were committed by Codex at implement phase) and must be in the allow-list.
5. Filter the diff: any file outside the allow-list is a drift entry.
6. **Rename semantics.** Because two-dot diff with `-M` reports rename records with both old and new paths included by `parseNameStatusOutput`, a rename either Codex performs on the task branch OR the base advances with will surface both paths in the diff. Spec authors who legitimately rename a file must list **both old and new paths** in `### Affected Files`. This is symmetric and predictable: if the rename is intentional task scope, both paths belong in the spec; if only one side appears in the allow-list while the other shows as drift, base-drift fires and the operator either adds the missing path or `--force`s. No rename-pairing magic — explicit listing keeps the gate's mental model "if it's in the diff, it must be in the allow-list." Surface this requirement in the die message and in the docs update (AC-13).
7. If drift entries exist and `cliArgs.force` is `false`: `die()` with an actionable message naming each drifted file, the two-prong remediation (add the path to spec.md's `### Affected Files` if it's intentional task scope, OR rebase the task branch onto current `origin/<base>` to absorb a base advance, OR `git checkout origin/<base_branch> -- <path>` + `git commit` to revert just that file to base's content when the drift is a stray task-branch commit), the rename-both-sides note, and the `--force` escape phrasing.
8. If drift entries exist and `cliArgs.force` is `true`: emit a loud `warn()` listing each drifted file with a `"--force override: base-drift detected; proceeding at user request"` lead. Continue.
9. If no drift entries: continue silently to the next step (`mirrorHumanReviewDocsToCwd` is already past at this point; next is the porcelain dirty-state read at [main.ts:893](../../scripts/run-task/main.ts:893)).

**Failure message shape** (mirror Fix 2's actionable form at [main.ts:940-944](../../scripts/run-task/main.ts:940)):

```
--pr aborted: base-drift detected. Files in the tree diff between origin/<base_branch>
and HEAD that are not in the spec's Affected Files (and not task-dir/telemetry):
  <path>
  <path>
The allowlist is: tasks/<id>/**, PIPELINE_TELEMETRY_FILES, and files listed in
your spec's '### Affected Files' table.
If this is a legitimate task change, add the path to spec.md '### Affected Files'
and rerun. For a rename, list BOTH the old and new paths. If the drift is
unexpected (likely cross-pipeline contamination from a sibling worktree's
managed-doc sync, OR a third-party commit landed on origin/<base_branch> while
this pipeline was running), recover with one of:
  - rebase onto current origin/<base_branch> to absorb the base advance:
      git fetch origin <base_branch> && git rebase origin/<base_branch>
  - reset a specific file to base's content if a stray task-branch commit
    introduced it:
      git checkout origin/<base_branch> -- <path> && git commit -m 'revert drift on <path>'
  - revert the offending task-branch commit entirely:
      git revert <sha>
Bypass with --force if you've verified the drift is intentional.
```

The check fires for both `--pr` and `--push` because both go through `commitHumanReviewFiles`. This is the same chokepoint Fix 2 uses; placing the check there gives one wire-up that covers all relevant entry points.

The function is implemented as a pure-data primitive `verifyBaseDriftFromData(diffFiles, allowedPaths, taskIds)` plus a thin orchestrating `verifyBaseDrift(taskIds, baseBranch, cwd)` wrapper that does the fetch + `getTreeDriftFiles` call + union assembly. This mirrors the existing `verifyHandoffAgainstDiff` / `verifyHandoffAgainstDiffFromData` pair at [validation.ts:836,903](../../scripts/run-task/validation.ts:836). The `*FromData` seam keeps the bulk of test coverage at the pure-data layer.

## Non-Goals

- **Implement → code_review base-drift check** ([BACKLOG.md:462](../../docs/BACKLOG.md:462) "Aggressive option, deferred"). Catches Mode 1 earlier but touches orchestrator phase routing — bigger surface, separate task.
- **Auto-rebase on detected drift.** Spec authors who want their task to absorb a base advance must do that explicitly; canon should not silently rewrite history.
- **Worktree-to-worktree sync rewrite** ([BACKLOG.md:468](../../docs/BACKLOG.md:468)). Closes contamination at the sync layer; this fix only catches it at `--pr`. Suitable for 1.5.
- **New `--allow-drift` flag.** Reuse existing `cliArgs.force` ([cli.ts:102](../../scripts/run-task/cli.ts:102), consumed at [main.ts:2370](../../scripts/run-task/main.ts:2370)) — same "I understand the risk" semantics as the existing full-send-on-delicate gate.
- **Modifying Fix 2's `--pr` auto-commit allow-list.** Fix 2's gate operates on dirty-tree state at `--pr` time; this fix operates on the branch's commit history vs origin/<base>. Both run; they're complementary.
- **Changing `getAffectedFiles`, `parseAffectedFilesFromSpec`, or `parseNameStatusOutput`.** Reuse as-is — exact precedent. (A new sibling helper `getTreeDriftFiles` is added; `getAffectedFiles` is intentionally untouched so its three-dot semantics keep working for handoff validation.)
- **Rename-pairing magic in the allow-list.** Renames must be listed explicitly in `### Affected Files` with both old and new paths. The gate stays a flat "is each diff path in the allow-list?" check; no second-order rename matching.
- **Changing `--ship` behavior.** PR review process should catch divergence after PR creation; base-drift is a `--pr`-time gate, not a `--ship`-time gate.
- **Per-task `--force` granularity.** `--force` applies to the entire `--pr` invocation; bundle invocations with mixed drift either all pass with `--force` or all fail without it.

## Acceptance Criteria

- [ ] AC-1: `verifyBaseDriftFromData(diffFiles: readonly string[], allowedPaths: ReadonlySet<string>, taskIds: readonly string[]): string[]` is exported from [scripts/run-task/validation.ts](../../scripts/run-task/validation.ts), placed adjacent to `verifyHandoffAgainstDiffFromData` (currently at [validation.ts:836](../../scripts/run-task/validation.ts:836)). Returns an array of drift paths — files in `diffFiles` that are neither in `allowedPaths` nor under any `tasks/<taskId>/` prefix for `taskId` in `taskIds`. Empty return = no drift. Verify by reading the source: the export exists with that signature; the implementation uses the same task-dir-prefix and `Set.has` checks as `humanReviewAllowedPath` at [main.ts:637](../../scripts/run-task/main.ts:637).

- [ ] AC-2: A new helper `getTreeDriftFiles(baseRef: string, cwd: string): { files: string[]; ok: boolean; stderr: string }` is exported from [scripts/run-task/git.ts](../../scripts/run-task/git.ts), placed adjacent to `getAffectedFiles` at [git.ts:330](../../scripts/run-task/git.ts:330). It runs `gitSafeAtRaw(cwd, 'diff', baseRef, 'HEAD', '--name-status', '-M', '-z')` (two-dot, not three-dot — see Decision §Why two-dot). On `ok: false` from the underlying call, return `{ files: [], ok: false, stderr: <underlying stderr> }` so the caller can distinguish failure from "no drift" AND propagate the underlying git error. On success, return `{ files: parseNameStatusOutput(stdout), ok: true, stderr: '' }`. `getAffectedFiles` itself is unchanged. Verify by reading the source.

- [ ] AC-3: `verifyBaseDrift(taskIds: string[], baseBranch: string, cwd: string): { drift: string[]; fetchFailed: boolean; diffFailed: boolean; diffError?: string }` is exported from [validation.ts](../../scripts/run-task/validation.ts), placed adjacent to `verifyHandoffAgainstDiff` at [validation.ts:903](../../scripts/run-task/validation.ts:903). It runs `gitSafeAt(cwd, 'fetch', 'origin', baseBranch)`. On fetch failure: emits a `warn()` matching `assertOriginTaskBranchAbsent`'s offline tolerance message shape ([main.ts:1219-1225](../../scripts/run-task/main.ts:1219)), returns `{ drift: [], fetchFailed: true, diffFailed: false }` (caller treats as no-op). On fetch success: calls `splitGit.getTreeDriftFiles('origin/' + baseBranch, cwd)`. **If the diff call returns `ok: false`**, returns `{ drift: [], fetchFailed: false, diffFailed: true, diffError: <stderr from getTreeDriftFiles> }` *without* emitting a warn (the caller dies with the error). **If the diff call returns `ok: true`**, builds the allowed-paths set by unioning `PIPELINE_TELEMETRY_FILES` ([worktree.ts:9](../../scripts/run-task/worktree.ts:9)) with the `parseAffectedFilesFromSpec(taskId)` files for each task ID, delegates to `verifyBaseDriftFromData`, returns `{ drift, fetchFailed: false, diffFailed: false }`. Malformed Affected Files cells are warned per task ID using the same pattern as the existing parse-and-warn loop at [main.ts:914-917](../../scripts/run-task/main.ts:914) and excluded from the allow-list (their cells contribute zero paths). Verify by reading the source.

- [ ] AC-4: `commitHumanReviewFiles()` at [main.ts:887](../../scripts/run-task/main.ts:887) invokes `verifyBaseDrift(taskIds, baseBranch, cwd)` exactly once, immediately after `mirrorHumanReviewDocsToCwd(cwd)` (which is currently called at [main.ts:891](../../scripts/run-task/main.ts:891)) and before the porcelain dirty-state read at [main.ts:893](../../scripts/run-task/main.ts:893). `baseBranch` is obtained via `splitGit.getBaseBranch(taskIds)`. Branch logic:
  - `fetchFailed: true` → continue (the warn has already been emitted by `verifyBaseDrift`).
  - `diffFailed: true` → `die()` with a message naming the underlying git error (from `diffError`) and pointing at `origin/<base>`. A safety gate that can't compute its own answer must fail closed — silent pass would defeat the gate.
  - `drift.length > 0` and `!cliArgs.force` → `die()` with the multi-line message from Decision.
  - `drift.length > 0` and `cliArgs.force` → `warn()` listing each drifted file with the `--force override` lead, then continue.
  - `drift.length === 0` → continue silently.

  Verify by reading the source: a single call site; the four branches are present; no other logic in `commitHumanReviewFiles` is touched.

- [ ] AC-5: The die message in `commitHumanReviewFiles` when drift is detected and `--force` is absent contains each drifted file path on its own line, names `tasks/<id>/**`, `PIPELINE_TELEMETRY_FILES`, and `spec's '### Affected Files'` as the allowlist components, presents the three recovery options (rebase onto current `origin/<base_branch>`; `git checkout origin/<base_branch> -- <path>` + commit; or `git revert <sha>`), mentions the rename-both-sides rule, and mentions `--force` as the bypass. Verify by reading the source: the message string contains the substrings `tasks/<id>/`, `PIPELINE_TELEMETRY_FILES`, `Affected Files`, `git rebase origin/`, `git checkout origin/`, `git revert`, `rename`, and `--force`. **The string `git checkout HEAD --` must NOT appear** — for base-vs-HEAD drift it is a no-op (HEAD already contains the drift), and including it would mislead operators per spec-review's blocking finding.

- [ ] AC-6: Bundle mode unions Affected Files across all tasks in the invocation. For a bundle `[task-a, task-b]` where `task-a/spec.md` lists `docs/codebase-map.md` and `task-b/spec.md` lists `scripts/run-task/main.ts`, `verifyBaseDrift` accepts both file paths in the diff without flagging drift. Verify with a unit test that exercises `verifyBaseDriftFromData` with two task IDs and a union allow-list of those two paths.

- [ ] AC-7: `verifyBaseDriftFromData` is covered by `tests/run-task-validation.test.ts` with at least: (a) **empty diff** → empty drift; (b) **single task, file in spec** → empty drift; (c) **single task, file NOT in spec** → drift contains that path; (d) **single task, task-dir file** → empty drift; (e) **single task, telemetry file in allowed-paths** → empty drift; (f) **bundle of two tasks, disjoint Affected Files, both diff paths in respective specs** → empty drift; (g) **drift contains a deleted file path** (status `D` from `parseNameStatusOutput`) → drift contains the deleted path when not in spec; (h) **rename record produces both old and new paths in the diff, only new path is in spec** → drift contains the old path (proves the rename-both-sides requirement is enforced rather than papered over). Verify by running `npm test` and reading new test names in the output.

- [ ] AC-8: `tests/run-task-safety.test.ts` adds integration coverage following the existing `commitHumanReviewFiles` fixture pattern at [tests/run-task-safety.test.ts:1428](../../tests/run-task-safety.test.ts:1428). At least four scenarios: (a) **task branch with content matching spec's Affected Files** → `commitHumanReviewFiles` proceeds normally; (b) **task branch with a drift file (not in spec, not in task-dir, not in telemetry)** → function dies, error mentions the drifted path and the `--force` bypass; (c) **same drift case with `cliArgs.force === true`** → function emits the `--force override` warning and proceeds to commit; (d) **base branch advances with a commit touching a file the task branch never edits and that is NOT in the spec's Affected Files** → `verifyBaseDrift`'s two-dot tree diff surfaces that file as drift, function dies (this is the Mode 1 case the spec exists to catch; if this test passes against three-dot, the diff helper is wrong). Use the existing temp-repo + origin fixture pattern.

- [ ] AC-9: Offline-fetch tolerance is covered by a test: when `git fetch origin <base>` fails (simulated via a mock or a fixture with no remote), `verifyBaseDrift` emits a `warn()` and returns `{ drift: [], fetchFailed: true, diffFailed: false }`. The caller does not die. Verify by reading the test source.

- [ ] AC-10: Diff-failure handling is covered by a test: when `getTreeDriftFiles` returns `ok: false` after fetch succeeds (simulated by passing an unresolvable `baseRef` to a fixture, or by mocking the helper), `verifyBaseDrift` returns `{ drift: [], fetchFailed: false, diffFailed: true, diffError: <non-empty string> }` and `commitHumanReviewFiles` dies with a message containing the diff error. Verify by reading the test source.

- [ ] AC-11: `cliArgs.force` retains its existing semantics. The existing full-send-on-delicate gate at [main.ts:2370](../../scripts/run-task/main.ts:2370) is unaffected; `--force` now additionally bypasses base-drift (but does NOT bypass `diffFailed` — see AC-4). No new flag is added to `parseArgs` ([cli.ts:52](../../scripts/run-task/cli.ts:52)). Verify by reading the source: `parseArgs` signature unchanged, `cliArgs.force` consumed in two places (the existing full-send-on-delicate check and the new base-drift gate).

- [ ] AC-12: `canon --help` and `canon run --help` are updated to mention base-drift on the `--pr` and `--push` flag descriptions in [src/cli/index.ts](../../src/cli/index.ts) and [scripts/run-task/cli.ts](../../scripts/run-task/cli.ts). One additional sentence per flag: `"Aborts if HEAD's tree differs from origin/<base> on files not in spec's Affected Files (bypass with --force)."` Verify by running `canon --help` and `canon run --help` and reading the rendered output, or by reading the source strings.

- [ ] AC-13: `docs/pipeline-orchestrator.md` `## Auto-Branch + Auto-Commit` section gains a short paragraph naming the base-drift check, where it fires (inside `commitHumanReviewFiles`), what it catches (cross-pipeline contamination Mode 1 + wider Mode 2), how it interacts with Fix 2's dirty-tree gate (complementary; both run), the rename-both-sides requirement for `### Affected Files`, and the `--force` bypass (with the note that `--force` does not bypass diff-computation failure). Verify by reading the file.

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

| File | Change |
|---|---|
| `scripts/run-task/git.ts` | Add exported `getTreeDriftFiles(baseRef, cwd): { files: string[]; ok: boolean; stderr: string }` adjacent to `getAffectedFiles` at line 330. Runs `gitSafeAtRaw(cwd, 'diff', baseRef, 'HEAD', '--name-status', '-M', '-z')` (two-dot, with rename detection), returns `{ files: parseNameStatusOutput(stdout), ok: true, stderr: '' }` on success and `{ files: [], ok: false, stderr: <underlying stderr> }` on failure so the caller can include the underlying git error in its die message. `getAffectedFiles` is **not** modified. |
| `scripts/run-task/validation.ts` | Add exported `verifyBaseDriftFromData(diffFiles, allowedPaths, taskIds): string[]` adjacent to `verifyHandoffAgainstDiffFromData` at line 836. Add exported `verifyBaseDrift(taskIds, baseBranch, cwd): { drift, fetchFailed, diffFailed, diffError? }` adjacent to `verifyHandoffAgainstDiff` at line 903. The wrapper does the fetch via `gitSafeAt(cwd, 'fetch', 'origin', baseBranch)`, the diff via the new `splitGit.getTreeDriftFiles('origin/' + baseBranch, cwd)`, parses each task's Affected Files via `parseAffectedFilesFromSpec(taskId)`, warns per malformed cell, unions everything into `allowedPaths`, and delegates to `verifyBaseDriftFromData`. Returns the four-field result described in AC-3. |
| `scripts/run-task/main.ts` | Inside `commitHumanReviewFiles` at line 887, after `mirrorHumanReviewDocsToCwd(cwd)` (line 891) and before the porcelain dirty-state read (line 893): call `splitValidation.verifyBaseDrift(taskIds, splitGit.getBaseBranch(taskIds), cwd)`. Handle the four branches per AC-4: `fetchFailed` → continue; `diffFailed` → `die()` with the diff error (no `--force` bypass); `drift.length > 0` and `!cliArgs.force` → `die()` with the full multi-line message from Decision; `drift.length > 0` and `cliArgs.force` → `warn()` with the `--force override` lead listing each drifted path, then continue. No other logic in the function changes. |
| `src/cli/index.ts` | Add one sentence to the `--pr` and `--push` flag descriptions explaining the base-drift gate and `--force` bypass. ~3 lines per flag. |
| `scripts/run-task/cli.ts` | Same sentence addition to `printUsage()` for `--pr` and `--push`. Mirror the existing line-wrapping convention. |
| `dist/cli/index.js` | Regenerated by `npm run build` from `src/cli/index.ts`. Committed `dist/` must match a fresh build — CI runs `git diff --exit-code -- dist/`. Listed explicitly so the Affected-Files scope cap (per AGENTS.md §Scope Discipline) covers the regenerated bundle, AND so this spec's own `verifyBaseDrift` allow-list does not flag it during the meta-test of running the gate on this task's PR. |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` from `scripts/run-task/{main,validation,git,cli}.ts`. Same CI gate and same allow-list rationale as the row above. |
| `tests/run-task-validation.test.ts` | Add `describe('verifyBaseDriftFromData', ...)` block covering AC-7 (a-h, including the rename case). Add a smaller `describe('verifyBaseDrift', ...)` block exercising the orchestrator wrapper's malformed-cell warning, offline fetch fallback (AC-9), and diff-failure path (AC-10). Use the existing fixture utilities (`fs.mkdtempSync`, etc.). |
| `tests/run-task-safety.test.ts` | Add `describe('commitHumanReviewFiles base-drift gate', ...)` covering AC-8's four scenarios — including the base-advance Mode 1 fixture that proves two-dot semantics. Follow the existing temp-repo + origin fixture pattern at line 1428. |
| `.canon/templates/spec.md` | No structural change. The template's `### Affected Files` note (added by v2) already explains why managed docs need to be listed; that same note now also implicitly drives base-drift's allow-list. No edit needed. |
| `templates/.canon/templates/spec.md` | Same — no edit. |
| `docs/pipeline-orchestrator.md` | Add a short paragraph in `## Auto-Branch + Auto-Commit` naming base-drift, where it fires, what it catches, complementarity with Fix 2, and `--force` bypass. |
| `docs/codebase-map.md` | QA "Docs Freshness" sweep updates: the spec-parser row in the Pipeline Orchestration table now names both `commitHumanReviewFiles` and `verifyBaseDrift` as consumers; a new row added for the base-drift gate. Listed here so v2's `--pr` allow-list permits the QA-phase edit. |

### Interaction Dependencies

- **`commitHumanReviewFiles`** ([main.ts:887](../../scripts/run-task/main.ts:887)) — gains one call site for `verifyBaseDrift` and one die/warn branch. No other logic changes.
- **`mirrorHumanReviewDocsToCwd`** ([main.ts:642](../../scripts/run-task/main.ts:642)) — unchanged. Base-drift fires *after* the mirror so REPO_ROOT → worktree telemetry sync is in place when we read the worktree's HEAD content.
- **`getAffectedFiles`** ([git.ts:330](../../scripts/run-task/git.ts:330)) — unchanged. Its three-dot semantics remain correct for handoff validation; base-drift uses the new sibling `getTreeDriftFiles` instead.
- **`getTreeDriftFiles`** ([git.ts](../../scripts/run-task/git.ts), new) — new helper. Two-dot `git diff <base> HEAD --name-status -M -z`, returns `{ files, ok, stderr }` so the caller can surface the underlying git error. Calls `parseNameStatusOutput`.
- **`parseNameStatusOutput`** ([git.ts:314](../../scripts/run-task/git.ts:314)) — unchanged. Rename records contribute both old and new paths; the spec's rename-both-sides rule keeps this predictable.
- **`parseAffectedFilesFromSpec`** ([validation.ts:649](../../scripts/run-task/validation.ts:649)) — unchanged. Reused as-is for the spec parse.
- **`verifyHandoffAgainstDiff` / `verifyHandoffAgainstDiffFromData`** ([validation.ts:836,903](../../scripts/run-task/validation.ts:836)) — unchanged. The new functions are placed adjacent to these as the structural precedent.
- **Fix 2's allow-list** (`humanReviewAllowedPath`, `buildHumanReviewStagePaths` at [main.ts:637,660](../../scripts/run-task/main.ts:637)) — unchanged. Operates on dirty-tree state at a later step; complementary, not duplicative.
- **`cliArgs.force`** ([cli.ts:102](../../scripts/run-task/cli.ts:102)) — unchanged shape. Gains a new consumer in `commitHumanReviewFiles`; the existing full-send-on-delicate consumer at [main.ts:2370](../../scripts/run-task/main.ts:2370) is untouched.

### Data Model Changes

None. No `status.json` schema changes, no new flags, no template structural changes.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — full suite passes
- [x] `build` (`npm run build`) — rebuilds dist; required per the corrected architecture.md binding because the change touches `scripts/run-task/main.ts`, `scripts/run-task/validation.ts`, `scripts/run-task/cli.ts`, and `src/cli/index.ts` (all bundled into `dist/`). Committed `dist/` must match a fresh build (CI gates on `git diff --exit-code -- dist/`).
- [ ] `E2E` — N/A; no UI

## Docs Impact

- **`docs/pipeline-orchestrator.md`** — updated per AC-13 to name base-drift in the auto-commit section.
- **`docs/codebase-map.md`** — the `## Pipeline Orchestration` table already points at `validation.ts` for handoff parsing. The new `verifyBaseDrift` functions are discoverable from the existing pointer; no new row required. QA-phase Claude audits and adds a row only if the existing pointer's wording is too narrow.
- **`docs/patterns.md`** — "Validation Gate Discipline" pattern already covers the parser-extension shape. No new pattern needed.
- **`docs/decisions.md`** — "Auto-commit owned by the orchestrator" decision still holds. Base-drift is consistent with its rule (the orchestrator owns the commit gate; the operator updates the spec, not the gate, when scope expands).
- **`docs/lessons-learned.md`** — QA distills any new lessons from this task. Candidates: the complementary-gates pattern (Fix 1 + Fix 2 as a layered defense), or any spec-iteration lessons that surface.

## Known Risks

- **Same-file Mode 1 residual (NOT addressed).** Base-drift catches Mode 1 only when the third-party-touched file is NOT in the task's Affected Files. If Codex's spec legitimately lists the same file the third party touched, base-drift sees the path as authorized and lets it through. The PR ships partially-stale content (Codex's edits on top of a stale snapshot of the file). Same path-level-allow-list residual class as Fix 2's same-file-overlap. The deeper fix is "rebase onto current origin/<base> at the implement → code_review boundary" — explicitly deferred in [BACKLOG.md:462](../../docs/BACKLOG.md:462). Surfaced in `done.md` so the operator knows what's caught vs not.
- **Fetch latency.** A `git fetch origin <base>` adds one network round-trip to every `--pr` and `--push`. For low-latency origins (GitHub from a fast connection) this is sub-second; for slow origins it could add a noticeable beat. No mitigation — the freshness of `origin/<base>` is the whole point.
- **Offline operator.** When `git fetch` fails (operator offline, origin unreachable), base-drift warns and skips. The contamination guarantee is "best effort given the network state." Acceptable trade-off — refusing to ship offline would be more friction than benefit. **Fetch failure and diff failure are NOT symmetric**: fetch failure is offline-tolerant (warn + skip); a diff failure after a successful fetch is hard fail (no `--force` bypass). A safety gate that can't compute its own answer must fail closed, not open.
- **Rename listing burden.** Renames now require both old and new paths in `### Affected Files`. Spec authors who forget one side will hit the gate. Mitigated by the rename mention in the die message and the docs update. Acceptable — the alternative (rename-pairing magic in the allow-list) adds quiet complexity that's hard to reason about when something goes wrong.
- **Drift on a clean-tree idempotent retry.** The clean-tree retry path at [main.ts:905-932](../../scripts/run-task/main.ts:905) skips the commit step and re-attempts PR creation only. Base-drift still fires (cheap, catches any new commits that landed between the two `--pr` invocations). Operator running the same `--pr` twice in succession will see the check run twice — that's deliberate, not a perf issue.
- **`--force` overuse.** A `--force` flag that's easy to type can become muscle memory. Mitigation: the warn message is loud and lists each drifted file by name, so even a fast `--force` operator sees what got accepted. No further guardrail.
- **Bundle drift with mixed task scope.** For a bundle, drift is detected against the union of all tasks' Affected Files. A drifted file flagged by base-drift doesn't say *which* task it should belong to (only that none of the tasks list it). The operator inspects the file content + spec to decide. Acceptable — the union model is the simplest consistent semantics.
- **Test fixture complexity** ([tests/run-task-safety.test.ts](../../tests/run-task-safety.test.ts:1428)). Base-drift tests need a temp git repo with an origin AND a populated spec.md. Existing pattern handles this; follow it. Use non-gitignored fixture file names per the test-writing pitfalls in [docs/patterns.md](../../docs/patterns.md).
- **Delicate surface.** `commitHumanReviewFiles` is on canon-ai's listed delicate surface ("Auto-commit logic" in [docs/product-context.md](../../docs/product-context.md)). Full-tier review chain with upgraded model is appropriate. The change is additive — one new check, one new die path, one new warn path; no existing path is removed or relaxed; the `--force` semantics are reused as-is.

## Human Test Plan

> Simulates cross-pipeline contamination Mode 1 by hand.

1. From `release/v1.4` with the merged fix in place, create a task: `canon task new contamination-demo-a "..."`. Write a spec listing `docs/codebase-map.md` in `### Affected Files`. Don't run the pipeline yet.
2. Simulate the third-party commit: directly on `release/v1.4` (or whatever the task's base is), make a small commit to a file NOT in the task's Affected Files — for example, edit `docs/decisions.md` and commit + push.
3. Now run `canon run contamination-demo-a` and let it reach `human_review`. Codex's implement phase commits its task content (which touches `docs/codebase-map.md` per the spec). The task branch's worktree is unaware that `release/v1.4` advanced.
4. Run `canon run contamination-demo-a --pr`. **Expected**: the orchestrator runs `git fetch origin release/v1.4`, computes the two-dot diff `git diff origin/release/v1.4 HEAD`, finds `docs/decisions.md` in the tree-diff (because origin advanced under the pipeline and HEAD does not have that change), notes it's not in the spec's Affected Files, dies before opening the PR. Error message lists `docs/decisions.md`, names the allow-list, presents the three recovery options (rebase onto current origin/<base>, `git checkout origin/<base> -- <path>` + commit, or `git revert <sha>`), mentions renames need both old and new paths in Affected Files, and mentions `--force`. (If the gate uses three-dot instead of two-dot, this step silently passes and the test fails — that's the fingerprint of the regression spec-review round 1 caught.)
5. Recovery option A — rebase the task branch onto current `origin/release/v1.4`. Re-run `--pr`. PR opens (drift gone — HEAD now contains the base advance).
6. Recovery option B — `git checkout origin/release/v1.4 -- docs/decisions.md && git commit -m 'revert drift'` to absorb the base's version of just that file. Re-run `--pr`. PR opens.
7. Recovery option C — run `canon run contamination-demo-a --pr --force`. **Expected**: a loud warning lists the drifted file with the `--force override` lead, then the PR opens. The operator has acknowledged the drift is intentional or acceptable.
8. Same scenario but with `docs/decisions.md` listed in the spec's Affected Files (i.e., the task legitimately edits that file): base-drift sees the path as allowed and proceeds without warning or die. The same-file Mode 1 residual is in play here — the PR will ship with the file content as it stands in the task branch (Codex's edits on top of a stale snapshot of decisions.md). Documented in Known Risks as the deferred "rebase at implement→code_review boundary" follow-up.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry checked (or "None" with justification)
