# Done: ship-merge-proof — Single-shot --ship with forge-proof merge verification

## What Changed

`--ship` had two related problems: (1) it required 2–3 manual invocations when a first run merged the PR but aborted before the pull/archive step, and (2) a naive fix for that die path introduced a data-loss risk by gating a non-destructive fast-forward on a forgeable signal while leaving the actual destructive operation (local branch deletion) ungated.

This task fixes both by moving the safety boundary to where it belongs — the local branch deletion.

**PR number is now pinned at `--pr` time.** When `canon run <id> --pr` creates or finds the task's PR, it records the PR number in `status.json` as `pr.number` (for all tasks in a bundle). Subsequent `--ship` invocations key off this specific number rather than a branch-name query, which structurally defeats the branch-reuse trap.

**Local branch deletion now requires forge-proof merge evidence.** Before deleting the local task branch, `--ship` verifies three conditions via `gh pr view <num>`: the PR is `MERGED`, its base ref matches the task's current `base_branch`, and the local task-branch tip is an ancestor of (or equal to) the PR's `headRefOid`. All three must hold. If proof cannot be established and the local branch exists, `--ship` dies with a recovery message — it never silently deletes. `--force` does not bypass this gate.

**Ancestor-or-equal, not strict equality (amended from round 1).** The original round-1 proof used strict SHA equality against the local tip. Codex's PR-level review caught this as a P1: when the task branch was advanced from another checkout, the local ref is behind `origin/<branch>` but holds no unique commits — a documented-safe case `assertTaskBranchPushed()` permits. Strict equality spuriously aborted that case. The fix uses `git merge-base --is-ancestor <localTip> <headRefOid>`, which accepts a behind-local tip (local ⊆ merged) while still failing closed when the local branch holds commits the PR never included. The `headRefOid` must be materialized locally before the squash-merge deletes the remote branch; if it can't be fetched, the merge is unproven and `--ship` dies.

**The fast-forward is now ungated.** `git pull --ff-only` on the base branch (the non-destructive operation) runs freely when the base is strictly behind origin. The reverted commit's `die`-on-behind path is gone. This is what makes the abort-then-re-run case complete in one re-run.

**Legacy tasks without a pinned number** fall back to `findMergedPRNumber()` (base-filtered), but now also require the local tip to be an ancestor-or-equal of the merged PR's `headRefOid`, under the same materialize-or-die rule.

**Already-deleted remote task branch** on cleanup is now tolerated. When `git push origin --delete <branch>` fails with "remote ref does not exist" (GitHub auto-deleted it on merge), `--ship` logs a no-op notice and continues instead of dying.

## Files Changed

| File | What changed |
|---|---|
| `scripts/run-task/main.ts` | `recordPinnedPRNumber()` (persists `pr.number` via commit+push after `commitHumanReviewFiles()`); `establishMergeProof()` (MERGED + base-ref + ancestor-or-equal head check); `readPinnedPrNumber()` (unknown-narrowing parser, fails closed on malformed); PR-head materialization before squash-merge; ungated fast-forward in `assertLocalBaseInSyncWithOrigin()`; "remote ref does not exist" no-op in `assertOriginTaskBranchAbsent()`; bundle proof-before-delete ordering in `shipTasks()` |
| `scripts/run-task/types.ts` | Added optional `pr?: { number: number }` to `StatusJson` |
| `.canon/templates/status.json` | Documented optional `pr` field convention |
| `tests/run-task-ship.test.ts` | New real-git fixture suite covering all 15 ACs (including AC-14 behind-local ancestor and AC-15 unmaterializable head) |
| `tests/run-task-safety.test.ts` | Extended fake `gh` contract for `baseRefName`; updated existing ship fixtures for pinned-PR semantics |
| `tests/run-task-validation.test.ts` | Status validation rows for optional `pr` field (both legacy and pinned) |
| `docs/pipeline-orchestrator.md` | Shipping & Post-Merge Reconciliation section updated with proof semantics, ancestor-or-equal check, materialize-or-die behavior, ungated fast-forward, and `--force` non-bypass |
| `CLAUDE.md` | `--ship` Quick Ref updated with merge-proof gate, ancestor-or-equal semantics, and `--force` non-bypass note |
| `dist/scripts/run-task.js` | Rebuilt from source |
| `templates/` mirrors | Auto-synced by pre-commit hook |

## How to Test

Follow the Human Test Plan from the spec:

1. Run a small task through the pipeline to `human_review` and open its PR with `canon run <id> --pr`. Confirm `tasks/<id>/status.json` now contains a `pr.number` field equal to the GitHub PR number.
2. Ship the task normally (PR open, merge online via `--ship`). Expected: ships and archives in a single invocation, same as before.
3. Simulate an interrupted ship: merge the task's PR on GitHub directly, then run `canon run <id> --ship` once. Expected: completes in that one run — fast-forwards the base, archives, deletes branch — no second attempt needed.
4. Simulate branch-name reuse: arrange a state where the most recent merged PR for the branch is a stale, unrelated one whose head commit the local tip is not an ancestor of, then run `--ship`. Expected: refuses, leaves task and branch intact, prints recovery message.
5. Repeat step 4 with `--force`. Expected: still refuses — `--force` does not bypass the merge-proof gate.
6. Ship an older task created before this change (no `pr.number` in `status.json`) after its PR is genuinely merged. Expected: ships normally via the legacy fallback path.
7. Simulate a behind-local branch: arrange a state where the local task branch is behind the version that was actually merged (someone pushed newer commits from another checkout). Run `--ship`. Expected: ships cleanly in one step — does not stop and complain that the local branch "doesn't match" the merged tip.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 786 tests, 785 pass, 1 skipped |
| `npm run build` | Pass |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| E2E | deferred_by_spec — no UI surface |

Code review: **approved_with_nits** (1 round, 0 changes-requested iterations). Stage 1 clean; Stage 2 nits only.

## Human Verification Required

None.

## Decisions Made

- **Ancestor-or-equal, not strict equality.** `git merge-base --is-ancestor <localTip> <headRefOid>` accepts the documented-safe behind-local case while failing closed when the local branch holds commits the PR never included. The round-1 strict-equality check was a P1 caught in Codex's PR-level review.
- **Materialize-or-die on unresolvable PR head.** `headRefOid` must be fetched locally before the squash-merge deletes the remote branch. If the object can't be materialized, the proof is unestablished and `--ship` dies. Never assumed proven.
- **Proof is on the deletion, not the invocation.** The safety gate is on `git branch -D` specifically. The fast-forward is explicitly ungated because it's non-destructive.
- **No durable on-disk merge record.** The live `gh` query plus the pinned `pr.number` covers the one-shot re-run goal. The `pr` object shape is extensible for a future `gh`-offline path, but that's explicitly out of scope.
- **`--force` does not bypass the proof gate.** Consistent with the base-divergence gate. The die message provides a concrete manual recovery path.
- **Bundle is all-or-nothing.** All proofs are established before any deletion. If one task in a bundle fails its proof, the destructive tail aborts for the whole bundle.
- **`recordPinnedPRNumber()` dies on any persistence failure** rather than warning, so a dirty/unpushed state never silently survives to confuse later gates.

## Open Questions

None. All 15 ACs met; no deferred concerns except the explicitly out-of-scope `gh`-offline re-run resilience (spec §Non-Goals).

## Proposed Changelog

Target version: **1.10.2** (patch increment — bug fix + safety hardening; no breaking changes; `pr` field in `status.json` is optional and additive).

### Fixed

- **`--ship` now completes in a single re-run after an interrupted merge.** If the first `--ship` lands the squash-merge on origin but aborts before the pull/archive step (process killed, transient `gh` error), the re-run fast-forwards the local base and finishes cleanly without requiring a manual `git pull` or a second manual invocation.
- **`--ship` now requires forge-proof merge evidence before deleting the local task branch.** The branch is deleted only when the pinned PR is confirmed `MERGED`, its base ref matches the task's `base_branch`, and the local tip is an ancestor of (or equal to) the PR's head commit — preventing silent data loss from branch-name reuse or a stale merged PR. `--force` does not bypass this gate. When proof cannot be established and the local branch exists, `--ship` dies with a recovery message.
- **`--pr` now records the PR number in `status.json`.** Subsequent `--ship` invocations key off this pinned number rather than a branch-name query; legacy tasks without a pin fall back to the existing branch lookup under the same ancestor-or-equal head check.
- **`--ship` no longer dies when the remote task branch is already deleted on cleanup.** A "remote ref does not exist" response from the stale-branch cleanup step (e.g., GitHub's auto-delete-head-branches) is now treated as a successful no-op.
