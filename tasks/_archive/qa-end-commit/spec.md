# Spec: qa-end-commit — Commit QA artifacts at QA-end so the worktree is clean

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

Across most of the pipeline lifecycle, `status.json` and task artifacts (`handoff.md`, `review.md`, `done.md`, `notes.md`) plus any `PIPELINE_SHARED_DOCS` (managed docs + telemetry) that QA's *Docs Freshness* sweep touches sit **uncommitted** in the worktree. They are only committed at `--pr`/`--push` time by `commitHumanReviewFiles` ([`scripts/run-task/main.ts:969`](../../scripts/run-task/main.ts)). This dirty-across-the-gap state causes three distinct failures, all hit live during canon dogfood:

1. **Reroute trips the post-implement auto-commit** (issue #152). A `--reroute` from `human_review` re-enters `implement` with the prior QA phase's managed-doc edit (e.g. `docs/codebase-map.md`) still dirty. The post-implement handoff↔diff reconciler — scoped to the implement iteration — sees that edit as an uncovered/orphan change and **aborts the auto-commit**, halting the run at the implement→code_review boundary until the operator manually commits or reverts (risking loss of legitimate QA docs-freshness work).
2. **Operator git surgery silently wipes pipeline progress.** A `git reset --hard HEAD~1` / `git checkout HEAD~N` / `git stash drop` on the worktree at `human_review` discards all uncommitted artifacts + accumulated phase progress in `status.json`. The next `canon run` re-derives the phase as `implement` and re-dispatches Codex, overwriting post-QA artifacts.
3. **The rebase stash/pop dance.** At `--pr`, a base-drift rebase requires `git stash push` → `rebase` → `stash pop` because the QA artifacts are uncommitted. A clean tree lets the rebase run directly.

Root cause for all three: the QA → `human_review` boundary leaves the worktree dirty. Backlog item [`docs/BACKLOG.md` "Commit pipeline state at QA-end"](../../docs/BACKLOG.md) (promoted 2026-06-08) is the structural fix.

## Decision

At the QA → `human_review` boundary — when `qa.status` becomes `done` — the orchestrator commits the QA-phase output so the worktree enters `human_review` with a clean tree. A new commit helper (mirroring `commitHumanReviewFiles`'s staging shape but with **no push/PR steps**) stages and commits, for every task in the bundle:

- `tasks/<id>/{handoff.md, review.md, done.md, notes.md, status.json}`
- Any `PIPELINE_SHARED_DOCS` files (managed docs + telemetry, per [`scripts/run-task/worktree.ts:24`](../../scripts/run-task/worktree.ts)) that the worktree has dirty.

Commit message: `chore: QA artifacts for <task-id>` (bundle: list all ids).

The commit fires once, at the QA→`human_review` transition, regardless of which code path advanced `qa` to `done` (normal QA-phase completion or the `tryEvidenceAdvance` path at [`main.ts:2673`](../../scripts/run-task/main.ts)). After it fires, `commitHumanReviewFiles` at `--pr`/`--push` finds nothing (or only marginal late edits) dirty and takes its existing idempotent-retry path (push branch + create/report PR).

**Defense-in-depth (issue #152 fix #2): exempt managed docs from the reconciler.** Separately from *when* the commit fires, the post-implement handoff↔diff reconciler's bypass check `autoCommitAllowedSourceBypass` ([`scripts/run-task/validation.ts:763`](../../scripts/run-task/validation.ts)) currently exempts only `tasks/` and `PIPELINE_TELEMETRY_FILES` — **not** `PIPELINE_MANAGED_DOCS`. That omission *is* the #152 mechanism: a dirty managed doc reads as an "uncovered source change" and aborts the implement auto-commit. Add `PIPELINE_MANAGED_DOCS` to the bypass so a dirty managed doc is never treated as an orphan implement change. This is a structural invariant (independent of commit timing) and is consistent with managed docs already being pipeline-owned and swept by the `--pr` allow-list. Together with the QA-end commit, #152 is closed both by *timing* (clean tree at reroute) and by *structure* (the reconciler no longer aborts on managed docs even if one is dirty during implement — e.g. in the residual window below).

This is the **minimum-scope** fix (one QA-end commit + the reconciler exemption). Per-phase commits (implement/code_review each committing their own artifacts) are a deliberately deferred broader-scope follow-up.

## Non-Goals

- **Per-phase commits are out of scope.** Implement-phase keeps committing source/test/dist via the handoff Changes table only; code_review does not commit its own `review.md`. The structural per-phase redesign is a separate future task.
- **The implement→first-QA uncommitted-progress window stays open.** If `code_review` keeps rejecting (implement→code_review loop without ever reaching QA-done), no QA-end commit fires and `status.json`/artifact progress remains uncommitted across those iterations, so operator git surgery during that window can still wipe progress. (Note: the *#152-flavor* managed-doc abort is no longer possible even in this window, because the reconciler exemption above neutralizes it independent of the commit.) Closing the uncommitted-progress window is the per-phase follow-up's job.
- **No change to the implement-phase auto-commit's contents** (it commits source/test/dist via the handoff Changes table — that stays).
- **No change to `--pr`/`--push`'s base-drift gate, allow-list, or PR-creation logic.** The QA-end commit must satisfy the *existing* allow-list; it does not relax it.
- **Not changing what `commitHumanReviewFiles` is allowed to stage**, and **not** modifying its no-pr/no-push `die` at [`main.ts:1127`](../../scripts/run-task/main.ts) — the clean-tree `--pr`/`--push` path is already graceful (see AC-5). The only requirement is to not regress it.

## Acceptance Criteria

- [ ] AC-1: A new commit helper (e.g. `commitQaArtifacts(taskIds, cwd)`) exists in `scripts/run-task/main.ts`, mirroring `commitHumanReviewFiles`'s staging/allow-list shape but performing **no** push and **no** PR creation, reusing the existing pure `buildHumanReviewStagePaths` ([`main.ts:664`](../../scripts/run-task/main.ts)) for its staged-path set. Verify by unit test on the helper's staged-path set in `tests/run-task-safety.test.ts`.
- [ ] AC-2: When `qa.status` transitions to `done` at the QA→`human_review` boundary, the orchestrator invokes the helper for **every** task in the bundle, staging `tasks/<id>/{handoff.md, review.md, done.md, notes.md, status.json}` plus any dirty `PIPELINE_SHARED_DOCS`. Verify: after a QA phase completes, `git -C <worktree> status --porcelain` reports no dirty task-artifact / managed-doc / telemetry files.
- [ ] AC-3: The commit fires from a **single chokepoint** covering both advance paths (normal QA completion and `tryEvidenceAdvance`'s `taskPhase(taskId, 'qa', 'done')` at `main.ts:2673`) — i.e. there is no code path that advances `qa → done` without the QA-end commit. Verify by test exercising the evidence-advance path.
- [ ] AC-4: The commit message is `chore: QA artifacts for <task-id>` for a single task; for a bundle it names all task ids. Verify by inspecting the commit subject in a bundle test.
- [ ] AC-5: After a QA-end commit has committed everything, `commitHumanReviewFiles` at `--pr`/`--push` succeeds with a clean tree via its **existing** idempotent early-return path ([`main.ts:1098-1124`](../../scripts/run-task/main.ts) — clean tree + `--pr`/`--push` → push + PR, no `die`, no empty commit). The implementer must **not** regress this path, and the no-pr/no-push `die` at `main.ts:1127` (only reachable when neither flag is set) is left unchanged. Verify by running `--pr` immediately after QA with no intervening edits and asserting success.
- [ ] AC-6: When there *are* late edits dirty at `--pr` time (e.g. operator tweaked `done.md` after QA), the existing `commitHumanReviewFiles` dirty-tree commit path still fires and commits them — no regression to the established behavior. Verify by a test that dirties an artifact post-QA then runs `--pr`.
- [ ] AC-7: The QA-end commit's staged set is scoped to the **worktree**, never pulling content from `REPO_ROOT` (cross-pipeline contamination guard). The helper stages only files dirty in the worktree's own tree. Verify by test asserting the staged paths derive from worktree `git status`, not a hardcoded REPO_ROOT read.
- [ ] AC-8: **Issue #152 regression closed (timing)** — after a QA phase that left a managed doc (`docs/codebase-map.md`) edited, a `--reroute` re-enters `implement` from a clean committed state; the post-implement auto-commit does **not** abort on that managed-doc file. Verify by a regression test reproducing #152's setup (QA-touched managed doc → reroute → implement auto-commit) that now passes.
- [ ] AC-9: **Issue #152 root mechanism closed (structure)** — `autoCommitAllowedSourceBypass` ([`validation.ts:763`](../../scripts/run-task/validation.ts)) exempts `PIPELINE_MANAGED_DOCS` in addition to `tasks/` and `PIPELINE_TELEMETRY_FILES`, so a dirty managed doc is never classified as an uncovered/orphan implement change — independent of commit timing (covers the residual implement→first-QA window too). Verify by a unit test on `findUncoveredTrackedChanges` (or its caller): a dirty `docs/codebase-map.md` with a handoff that does not list it is **not** reported as uncovered.
- [ ] AC-10: The QA-end commit reuses `commitHumanReviewFiles`'s existing allow-list logic (`humanReviewAllowedPath`, [`main.ts:652`](../../scripts/run-task/main.ts)). Because the commit fires precisely when `qa.status === 'done'`, that logic already unions **all** `PIPELINE_MANAGED_DOCS` into the allowed set — the QA "Docs Freshness" auto-allowlist live at [`main.ts:1069-1083`](../../scripts/run-task/main.ts) and mirrored in `verifyBaseDrift` ([`validation.ts:1430-1443`](../../scripts/run-task/validation.ts)). So a managed doc QA touched that is **not** in spec Affected Files is **committed**, not flagged — no spec backfill required, and no new or relaxed gate. What still aborts is a dirty path **outside** that union (a non-managed, non-telemetry, non-task-artifact file — e.g. a stray source edit), which hits the existing allowlist-violation `die` ([`main.ts:1131-1138`](../../scripts/run-task/main.ts)). Verify by two tests: (a) a QA-touched managed doc absent from Affected Files appears in the helper's staged set and commits cleanly; (b) a dirty file outside the union aborts the QA-end commit with the existing message.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Add `commitQaArtifacts(taskIds, cwd)` helper (no push/PR) that reuses `buildHumanReviewStagePaths` for its staged set. Route **both** `qa → done` writers — normal QA completion and `tryEvidenceAdvance`'s qa case ([`main.ts:2673`](../../scripts/run-task/main.ts)) — through a single chokepoint that calls it (AC-3). Do **not** modify the `commitHumanReviewFiles` clean-tree path — it is already graceful for `--pr`/`--push` (AC-5). |
| `scripts/run-task/validation.ts` | Add `PIPELINE_MANAGED_DOCS` to `autoCommitAllowedSourceBypass` (≈ line 763) so a dirty managed doc is not flagged as an uncovered implement change (AC-9, #152 root mechanism). |
| `tests/run-task-safety.test.ts` | New unit tests for the QA-end helper's staged-path set + commit-message shape (AC-1, AC-2, AC-4, AC-7, AC-10) — extend the existing `buildHumanReviewStagePaths` coverage here; do **not** create a new test file. |
| `tests/run-task-parse-porcelain.test.ts` | New unit test for `findUncoveredTrackedChanges` / `autoCommitAllowedSourceBypass`: a dirty `docs/codebase-map.md` absent from the handoff is **not** reported as uncovered (AC-9). |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` (bundles `scripts/run-task/**`, incl. `main.ts` + `validation.ts`). Commit the rebuilt artifact. |
| `docs/pipeline-orchestrator.md` | Document the QA-end commit step in the pipeline phase walk. Canon-owned → its `templates/` mirror auto-syncs (next row). |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced from the root doc by the pre-commit hook / `npm run sync-templates` — **not hand-edited**. Listed so the regenerated mirror falls inside the implement reconciler + `--pr` base-drift allow-lists and `npm run sync-templates:check` passes. |
| `docs/patterns.md` | Update the existing "Operator git surgery on a task branch between phases discards uncommitted pipeline state" pitfall to reflect the QA-end commit now closing the post-QA window (note the implement→first-QA residual window remains). Not canon-owned → no `templates/` mirror. |
| `docs/BACKLOG.md` | Check off the "Commit pipeline state at QA-end so it survives operator git surgery" item (≈ line 886). Implement-phase edit (committed via the handoff Changes table), so it is never dirty at QA-end; allowed at `--pr` base-drift because it is in Affected Files. |

> The doc edits above (`pipeline-orchestrator.md`, `patterns.md`, `BACKLOG.md`) are **implement-phase** edits — documenting the new step and checking off the backlog item is part of building the feature, committed at implement, so they are clean by QA and never staged by the QA-end commit. They are listed per the Affected-Files discipline so they fall inside the implement handoff↔diff reconciler and the `--pr` base-drift allow-list. `docs/pipeline-orchestrator.md` is canon-owned (`CANON_OWNED` in `src/lib/canon-owned.ts`), so its `templates/` mirror is regenerated by the sync hook and must also be listed; `docs/patterns.md` and `docs/BACKLOG.md` are not canon-owned and have no mirror. Telemetry files (`lessons-learned`, `task-quality-log`, `pipeline-invocations`) are auto-committed and need no row. The doc/telemetry constants are defined in `scripts/run-task/worktree.ts` (`PIPELINE_TELEMETRY_FILES` ≈ line 9, `PIPELINE_MANAGED_DOCS` ≈ line 15, `PIPELINE_SHARED_DOCS` ≈ line 24). The remaining mechanics (exact helper signature, chokepoint location) are **deferred to plan/implement** — this spec fixes the behavioral contract.

### Interaction Dependencies

- **`--pr`/`--push` base-drift gate** (`main.ts` ~1006–1040): runs at push time, after the QA-end commit is already on the branch. The QA-end commit's content (task artifacts + dirty managed docs + telemetry) is inside the gate's allow-list — managed docs are auto-allowlisted once `qa.status === 'done'` (`verifyBaseDrift`, [`validation.ts:1430-1443`](../../scripts/run-task/validation.ts)) — so base-drift passes. The implement-phase doc edits (`docs/pipeline-orchestrator.md` + its mirror, `docs/patterns.md`, `docs/BACKLOG.md`) are allowed because they are in spec Affected Files. No change to the gate itself.
- **`canon task accept`**: the accept path skips the next-run post-phase auto-commit. If accept is used after QA-end, the QA-end commit is already on the branch; accept just marks the phase done. Compatible — verify no double-commit.
- **Bundle mode**: the helper takes `taskIds[]` and commits all bundle tasks' artifacts (mirror `commitHumanReviewFiles`'s bundle handling — one commit covering the bundle is acceptable; match the existing shape).
- **Managed-doc cross-pipeline sync** (`syncWorktreeTelemetry` / `canMirrorSharedDocs`): unchanged. The QA-end commit reads only the worktree's own dirty state (AC-7).

### Data Model Changes

None. No `status.json` schema change — this only changes *when* existing artifacts are committed.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; includes new unit/regression tests for the helper and the #152 closure
- [x] `npm run build` — touches `scripts/run-task/**` → `dist/scripts/run-task.js` must be rebuilt and committed
- [x] `npm run sync-templates:check` — `docs/pipeline-orchestrator.md` is canon-managed; sync the `templates/` mirror
- [x] `npm run docs-refs-check` — `docs/` files touched
- [ ] E2E — N/A (no UI surface)

## Docs Impact

`docs/pipeline-orchestrator.md` (new QA-end commit step) + its canon-owned `templates/` mirror, `docs/patterns.md` (update the git-surgery pitfall), `docs/BACKLOG.md` (check off the backlog item) — all **implement-phase** edits, not QA edits. Telemetry (`lessons-learned`, `task-quality-log`) updated by QA discipline.

## Known Risks

- **Delicate — auto-commit/commit machinery.** This touches the same commit-ownership surface as the cross-pipeline-contamination fixes and the `--pr` base-drift gate. A staging-scope bug could leak another worktree's content into the commit (AC-7 guards this) or commit outside the allow-list (AC-10 guards this). Reviewer must audit the staged-path derivation at every entry point.
- **Reconciler exemption widens what implement may auto-commit.** Adding `PIPELINE_MANAGED_DOCS` to `autoCommitAllowedSourceBypass` (AC-9) means a managed doc dirty *during* implement is auto-committed rather than flagged as uncovered. This is acceptable — managed docs are pipeline-owned and still gated by the `--pr` allow-list at push — but the reviewer must confirm it does not let an *unintended* managed-doc edit slip silently into an implement commit without surfacing at `--pr`.
- **Two advance paths.** `qa → done` is reached via normal QA completion *and* `tryEvidenceAdvance`. A fix wired into only one path leaves a hole (AC-3). Prefer a single chokepoint over patching both call sites (cross-cutting-invariant discipline).
- **Do NOT regress the clean-tree `--pr` path.** `commitHumanReviewFiles` already early-returns gracefully (push + PR) on a clean tree when `--pr`/`--push` is set ([`main.ts:1098-1124`](../../scripts/run-task/main.ts)); the `die` at `main.ts:1127` is only reachable in the no-pr/no-push case and is left untouched. The risk is an implementer "fixing" the wrong path; AC-5 pins the contract.
- **Residual implement→first-QA uncommitted-progress window** (Non-goal) — operator git surgery during the implement↔code_review loop (before first QA-done) can still wipe uncommitted `status.json`/artifact progress. The #152-flavor managed-doc abort is *not* part of this residual (the AC-9 exemption neutralizes it everywhere). Documented, not fixed here.

## Human Test Plan

1. Take any task through the pipeline to the point where QA finishes and the task reaches the "ready for review" state.
2. In the task's working folder, check the version-control status. **Expected:** the working folder is clean — the QA notes, review notes, and any updated project docs have already been saved into a commit titled "QA artifacts for …". (Before this change, those files would still show as unsaved/dirty.)
3. Push the branch / open the draft PR as usual. **Expected:** it succeeds with no errors about "nothing to commit," and the PR opens normally.
4. Reproduce the original bug scenario: on a task whose QA updated a project doc, send the task back for another implementation round (reroute). **Expected:** the reroute proceeds cleanly and does **not** halt with an auto-commit error blaming an uncommitted project doc.
5. Make a small manual edit to one of the review notes after QA, then push / open the PR. **Expected:** the late edit is still captured in the push (not silently dropped).

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; pipeline writes plan)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
