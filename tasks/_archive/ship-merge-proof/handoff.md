# Implementation Handoff: ship-merge-proof

> Author: Codex | Spec: `tasks/ship-merge-proof/spec.md` | Plan: `tasks/ship-merge-proof/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover the current implementation through reroute round 1. On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `.canon/templates/status.json` | Documented the optional PR pin field for new task scaffolds. |
| `CLAUDE.md` | Updated the `--ship` quick reference with the local-branch deletion proof gate, ancestor-or-equal PR-head proof, materialize-or-die behavior, and the `--force` non-bypass rule. |
| `dist/scripts/run-task.js` | Rebuilt the run-task bundle from the source changes. |
| `docs/pipeline-orchestrator.md` | Updated the shipping section with proof ordering, ancestor-or-equal PR-head proof, materialize-or-die behavior, ungated fast-forward behavior, and cleanup semantics. |
| `scripts/run-task/main.ts` | Added PR-number pin persistence, pinned/legacy merge proof before local branch deletion, PR-head materialization, ancestor-or-equal proof via `git merge-base --is-ancestor`, ungated pure-behind base fast-forward, and remote-delete no-op tolerance. |
| `scripts/run-task/types.ts` | Added optional `pr?: { number: number }` to `StatusJson`. |
| `templates/.canon/templates/status.json` | Synced the status template mirror. |
| `templates/CLAUDE.md` | Synced the CLAUDE quick-reference mirror. |
| `templates/docs/pipeline-orchestrator.md` | Synced the orchestrator documentation mirror. |
| `tests/run-task-safety.test.ts` | Extended the existing fake `gh` contract for `baseRefName` and updated existing PR/ship fixtures for pinned PR semantics. |
| `tests/run-task-validation.test.ts` | Added status validation coverage for both legacy status files and optional `pr.number`. |
| `tests/run-task-ship.test.ts` | Added real-git ship and PR fixtures covering PR pinning, proof success/failure, bundles, legacy fallback, fast-forward, remote-delete tolerance, behind-local ancestor proof, and unmaterializable PR-head refusal. |

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

The implementation moves the safety boundary to the destructive operation: local task branches are deleted only after a positive merge proof is established. The proof uses pinned PR numbers recorded by `--pr` when available, with live `gh` checks for merged state, base ref, and PR head ancestry. The local task-branch tip must be an ancestor of, or equal to, the PR `headRefOid`; strict equality is intentionally not required because a local branch can be safely behind the remote PR head. Legacy tasks without a pin still use the existing base-filtered merged-PR lookup, under the same ancestor-or-equal rule.

Before the merge can delete the remote branch, `--ship` resolves the relevant PR head and materializes that commit object locally. If the object cannot be materialized, the proof remains unestablished and the local branch is not deleted.

The base fast-forward path is deliberately ungated because `git pull --ff-only` on the base branch is non-destructive and cannot prove the task branch was merged. Proof is collected for every task in a bundle before any archive or branch deletion runs, so a single unproven task aborts the whole destructive tail.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| `recordPinnedPRNumber()` dies on stage/commit/push failure instead of warning. | AC-1b requires successful `--pr` to leave the pin persisted cleanly; failing closed avoids a dirty or unpushed status surprise. | Strengthens AC-1b. |
| Did not extract the fake CLI helpers into a shared fixture. | A dedicated real-git ship suite plus a small extension to the existing safety-test fake `gh` kept the change localized and avoided reshaping unrelated test helpers. | None. |
| `npm run build` emitted `dist/cli/index.js`, but it has no tracked diff. | The source change only produced a tracked delta in `dist/scripts/run-task.js` after normalization. Listing a clean generated file in the Changes table would create a false handoff-to-diff mismatch. | None. |
| The reroute plan named a `prefetchPRHeads()` helper; the implementation keeps the prefetch loop in `shipTasks()` and factors only the reusable materialization/ancestry helpers. | The prefetch loop needs the local ship snapshot and active cwd for each task; keeping it adjacent to the merge call makes the ordering explicit while preserving the same behavior. | None. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: PR number is pinned at `--pr` time | Met | `reportOrCreatePR()` records the found or newly-created PR number for all task IDs; covered by `--pr pins pr.number on create path and leaves status clean` and `--pr pins existing PR number and exits clean on re-run`. |
| AC-1b: `--pr` persists the pinned number cleanly | Met | Pin writes are staged, committed, and pushed in the active cwd, with fail-closed errors on any persistence failure; tests assert clean final trees. |
| AC-2: Deletion requires proof, happy path | Met | `establishMergeProof()` requires `MERGED`, matching `baseRefName`, and local-tip ancestor-or-equal proof against a materialized `headRefOid`; happy-path exact-match fixture archives and deletes. |
| AC-2b: Wrong-base merged PR is refused | Met | Pinned proof compares PR base to `base_branch` before accepting head ancestry; wrong-base fixture leaves task and branch intact. |
| AC-3: Branch-reuse signal is refused | Met | Pinned and fallback proof require local tip to be an ancestor of the materialized PR head; unrelated-head fixture dies without deleting, including with `--force`. |
| AC-4: Never-merged work is refused | Met | Unproven fixture with a surviving local branch dies with merge-proof recovery guidance. |
| AC-5: Legacy fallback proof works | Met | Status without `pr.number` can ship when a base-filtered merged PR head materializes and contains the local tip. |
| AC-6: Fast-forward is ungated and non-destructive | Met | Pure-behind base runs `git pull --ff-only`; proof still runs afterward. |
| AC-7: Abort-then-rerun completes in one rerun | Met | Happy ship fixture starts with local base behind origin and completes by fast-forwarding, proving, archiving, and deleting. |
| AC-14: Behind-local branch ships | Met | New fixture advances the remote PR branch beyond the local branch, materializes that descendant head, and ships because the local tip is a strict ancestor. |
| AC-15: Unmaterializable PR head dies fail-closed | Met | New fixture reports a non-resolvable `headRefOid`; `--ship` dies with the local branch and task intact. |
| AC-7b: Base in sync without proof is refused | Met | Synced-base unproven fixture dies without archiving or deleting. |
| AC-8: Local branch already gone archives without proof | Met | No-branch fixture archives successfully. |
| AC-9: `--force` does not bypass proof | Met | Branch-reuse test runs both normal and `--force` paths and both fail closed. |
| AC-10: Bundle proof is all-or-nothing | Met | Bundle fixture with failed proof leaves both tasks unarchived and the shared local branch intact. |
| AC-10b: Bundle `--pr` pins every task | Met | Bundle `--pr` fixture asserts the same PR number in every sibling status file. |
| AC-11: Schema additive and migration-free | Met | `StatusJson` and templates accept optional `pr`; validation test covers legacy and pinned statuses. |
| AC-11b: Malformed `pr` fails closed | Met | `readPinnedPrNumber()` narrows from `unknown`; malformed fixture falls back and refuses deletion. |
| AC-12: Docs reflect behavior | Met | Updated `docs/pipeline-orchestrator.md`, `CLAUDE.md`, and their synced template mirrors. |
| AC-13: Already-deleted remote branch is tolerated | Met | Stale-remote cleanup treats "remote ref does not exist" as no-op; fixture completes. |

## Edge Cases Considered

- PR creation returns a URL before canon can know the number; implementation performs a follow-up open-PR lookup and dies if it cannot pin the number.
- Existing PR reruns skip a new pin commit when the stored number is already current.
- Bundled tasks share one PR but each status file gets the pin before later `--ship`.
- Proof reads the local branch tip before archive/worktree teardown and uses the active worktree cwd for worktree-backed tasks.
- PR heads are resolved and materialized before `mergeOpenPRsAndPull()` can delete the remote branch.
- Behind-local branches are accepted only when real git ancestry proves the local tip is contained in the PR head.
- Existing but unrelated PR heads fail as branch reuse/local-only work; missing PR head objects fail as unproven materialization failures.
- If base checkout no longer contains an unmerged task dir after switching to base, proof can use the pre-switch status snapshot only for proof input; archive writes still re-read fresh status after proof.
- A pure-behind base is fast-forwarded, but a diverged base still dies.
- `gh` unavailable or malformed pin data cannot prove deletion and therefore fails closed while the local branch exists.

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
| `npm run lint` | Pass | ESLint completed cleanly. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` | Pass | Full suite completed: 786 tests, 785 pass, 1 skipped. |
| `npm run build` | Pass | `tsup` build completed and `normalize-dist-paths` rewrote the generated run-task bundle. |
| `npm run docs-refs-check` | Pass | Run after writing this handoff; all refs OK. |
| `npm run sync-templates:check` | Pass | Run after docs/template updates; canon-managed mirrors are in sync. |
| E2E — N/A (no UI surface) | deferred_by_spec | Spec: Validation Required marks E2E as N/A because this task has no UI surface. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch contains current `origin/release/v1.10.2` (`git merge-base --is-ancestor origin/release/v1.10.2 HEAD` returned 0); task branch has no upstream until the orchestrator pushes it

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

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
