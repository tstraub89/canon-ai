# Spec: ship-merge-proof — Single-shot --ship with forge-proof merge verification

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

`canon run <id> --ship` can require 2–3 invocations to complete, and a naive fix for that introduced data-loss risk.

**The multi-run friction**: The happy path (one open PR, `gh` reachable) ships in a single invocation — `mergeOpenPRsAndPull()` finds the open PR, squash-merges it (`--delete-branch` removes the remote ref), pulls the base, and the archive/delete tail runs. But if a first `--ship` aborts *after* the squash-merge lands on origin and *before* the post-merge pull/archive (process killed, `gh` transient, a guard dying on a stale ref), the re-run finds the PR already merged (no longer open), so `mergeOpenPRsAndPull()` returns `false` and the `!merged` fallback runs. In that fallback, the local base branch is now *behind* origin (the merge landed; we never pulled). Before the recent attempt, `assertLocalBaseInSyncWithOrigin()` (`scripts/run-task/main.ts:1230`) **died** in that state, instructing the operator to `git pull` manually and re-run — forcing a second (sometimes third) manual cycle.

**Why the naive fix was unsafe**: Commit `23c03e2` (since reverted) made that path auto-fast-forward when `behind > 0 && ahead === 0`, then `return`. Codex flagged two P1 data-loss scenarios, both rooted in the same mistake — **gating the wrong thing and proving merge with a forgeable signal**:

1. **Branch-name reuse**: confirming "this task merged" via `findMergedPRNumber(branch, baseBranch)` (`main.ts:1433`) returns the *most recent* merged PR for that branch/base. If a branch name was reused after an earlier merged PR, a stale PR falsely confirms the current tip is merged. (This exact trap is already documented in `docs/patterns.md` → "Use the attempted `prNum` to confirm merge — not the branch name.")
2. **Manual-pull bypass**: instructing the operator to `git pull --ff-only` and re-run means that, after the pull, `behind === 0` and the guard returns *without any merge proof at all* — then the downstream archive/delete tail (`main.ts:1803–1864`) runs and force-deletes the local task branch.

**The core defect the naive fix exposed**: the only *destructive* act in the entire ship flow is the local task-branch deletion (`git branch -D`, `main.ts:1860`), which is currently **unconditional** once the branch is queued (`main.ts:1841`). The fast-forward pull (`git pull --ff-only`) is **non-destructive** — `--ff-only` refuses anything that is not a clean fast-forward, moves only the base-branch pointer, and never touches the task branch or rewrites local commits, even when origin advanced for unrelated reasons. The reverted fix gated the *non-destructive* fast-forward on a *forgeable* proof, while the *destructive* deletion remained ungated. The data-loss surface is entirely in the deletion.

Squash-merge is why this needs an explicit proof at all: a squash-merge creates a *new* commit on the base with a different SHA, so the task-branch tip is **not** an ancestor of the squashed base. Pure git ancestry (`git merge-base --is-ancestor`) returns false even for correctly-merged work. The only authority that maps "squash commit on base ← this task branch tip" is the PR record, read via `gh`.

**Second, smaller defect (also from the reverted commit).** The reverted commit `23c03e2` bundled a *separate*, benign fix that the revert also removed: in `assertOriginTaskBranchAbsent()`'s merged-PR recovery path, the stale-remote-branch cleanup `git push origin --delete <branch>` `die`s when it fails — including when it fails with `"remote ref does not exist"`, which simply means the remote branch is **already gone** (GitHub's *auto-delete-head-branches* setting removed it on merge, or a partial prior `--ship` run deleted it). Dying on the already-achieved end-state is a spurious failure that forces another `--ship` cycle. This is unrelated to the data-loss surface (it concerns the *remote* delete, not the *local* `git branch -D`) and Codex did not flag it; it is re-landed here because it belongs to the same single-shot-`--ship` goal and the same function.

## Decision

Gate the **destructive local task-branch deletion** on forge-proof evidence that the task's PR was squash-merged into the *current* base branch, and let the **non-destructive fast-forward** run freely so a clean re-run finishes in one invocation.

Concretely:

1. **Pin the PR number at `--pr` time.** When `reportOrCreatePR()` creates or finds the task's PR, record its number in `status.json` as `pr.number`. From then on, ship-path merge verification keys off this *specific* number — never a branch-name query — which structurally defeats the branch-reuse trap (P1 #1). The pinned number must be persisted to the task's `status.json` such that a *later, separate* `--ship` invocation reads it, and a successful `--pr` must not leave `tasks/<id>/status.json` in a divergent uncommitted-and-unpushed state that confuses subsequent gates. **Note the ordering constraint**: `reportOrCreatePR()` is invoked from inside `commitHumanReviewFiles()` (`main.ts:1093`, `1192`) *after* that function has already committed and pushed the human-review artifacts — so the PR number is not known until after the push. The persistence mechanism (write-before-commit on the idempotent existing-PR path where the number is already known, a follow-up commit/push on the create path, or treating the pinned number as live worktree-canonical on-disk state that `--ship` reads without a commit) is **deferred to plan/implement**; the contract is AC-1 + AC-1b.

2. **Establish a positive merge proof per task before any deletion.** A task's local branch may be deleted **only** if its merge is proven. Proof precedence:
   - **`gh` reachable**: the pinned PR (`pr.number`) satisfies **all three** of: (a) it is in `MERGED` state; (b) its base ref equals the task's current `base_branch`; (c) the local `task/<id>` branch tip is an **ancestor of, or equal to**, the PR's head-ref commit (`headRefOid`). All three are required — a PR merged into a *different* base does not prove the work reached *this* base (see AC-2b). (The ancestor-or-equal head-ref check defeats branch-reuse and stale-PR forgery; the base-ref match defeats merged-into-wrong-base.) The base-ref check requires reading the PR's base via `gh pr view <num> --json baseRefName` — a `gh` field not currently read anywhere in `main.ts`; this spec authorizes a new typed helper for it (see Affected Files) and matching fake-`gh` support in tests.

   > **Which commit the proof compares, and how (corrected — see the Amendment section).** "PR head" means `gh pr view <num> --json headRefOid` — the pre-squash task-branch tip that was pushed (which `getMergedPRHeadSha()` returns), **not** the squash commit on base. The proof checks that the **local `task/<id>` tip is an ancestor of, or equal to, `headRefOid`** via `git merge-base --is-ancestor <localTip> <headRefOid>` — **not** strict SHA equality against the local tip. Rationale: when the branch was advanced from another checkout, the local ref is *behind* `origin/<branch>` and behind the merged PR head; `assertTaskBranchPushed()` documents that as safe (local holds no unique commits) and `mergeOpenPRsAndPull()` merges from the remote tip. Strict local-equality spuriously aborts that documented-safe behind-local case (the original P1 in this round); ancestor-or-equal accepts it (local ⊆ merged) while still **failing closed** when the local branch holds commits the PR never included (local is *not* an ancestor of `headRefOid`) or when a stale/reused PR's head is unrelated to the local work. **Operational requirement (fail closed):** the squash-merge with `--delete-branch` removes `origin/<branch>`, so the `headRefOid` object may be absent locally at proof time. The proof must **materialize `headRefOid` before the branch can disappear** (fetch the PR head / its ref); if the object cannot be materialized, the merge is **unproven → die** — never assumed.
   - **No pinned `pr.number`** (tasks created/PR'd before this change): fall back to `findMergedPRNumber(branch, base)`, but require the local task-branch tip to be an ancestor of, or equal to, that merged PR's head (`headRefOid`), under the same materialize-or-die rule. The ancestor check keeps this fallback forge-proof — a stale or reused PR's head is unrelated to the current local work, so the local tip is not an ancestor of it.
   - **Proof cannot be established AND the local task branch still exists**: `die` with recovery instructions (push the branch / verify the merge / manual archive). This is an accepted false-negative — it fires only when the operator did something out of the ordinary, and failing closed protects unmerged work.
   - **Local task branch already absent** (a prior run deleted it): deletion is a no-op, so there is no data to lose; archive proceeds without requiring proof.

3. **Ungate the fast-forward.** In the `!merged` fallback, when the local base is strictly behind origin (`behind > 0 && ahead === 0`), `git pull --ff-only` proceeds without a merge-proof gate (it is non-destructive). The reverted commit's `die`-on-behind path is removed. This is what lets the abort-then-re-run case complete in a single re-run instead of demanding a manual pull.

4. **Bundle semantics**: proof is established per task before *any* task's branch is deleted; if any task in the bundle fails its proof gate, the whole destructive tail aborts (consistent with bundle all-or-nothing).

5. **Tolerate an already-deleted remote branch on cleanup.** In `assertOriginTaskBranchAbsent()`'s merged-PR recovery path, when `git push origin --delete <branch>` fails *specifically* with `"remote ref does not exist"`, treat it as a successful no-op (log and continue) instead of dying — the remote branch being gone is the exact end-state that path wants. Any *other* delete failure still `die`s (unchanged). This re-lands the benign half of the reverted commit and is independent of the merge-proof gate.

The merge proof's primary path is a *live* `gh` query when `gh` is reachable; the `gh`-reachable result is authoritative and a contradicting live result wins over any other signal. There is intentionally **no** durable on-disk merge record — the normal re-run has `gh` available, so the live query plus the pinned `pr.number` covers the one-shot-re-run goal without persisting merge state. (The `pr` object is shaped so a durable field could be added later if a `gh`-offline-on-re-run pain point ever materializes; it is out of scope here.)

## Non-Goals

- **Not** hardening the *first* `--ship` run against crashing mid-pull/mid-archive. The first run can still abort; the contract is that the *re-run* completes safely in one shot. Making the first run transactional is a separate concern.
- **Not** persisting a durable on-disk merge record for `gh`-offline-on-re-run resilience. Explicitly deferred; the `pr` object is left extensible for it.
- **Not** adding a `--force` (or any new) bypass for the merge-proof gate. Like the base-divergence gate, `--force` does not bypass it. The die message names the manual recovery path instead.
- **Not** changing the squash-merge strategy, the `--pr`/`--push` base-drift gate, or the `--allow-divergent-base` divergence gate.
- **Not** removing the existing negative guards (`assertNoOpenPRForTask`, `assertOriginTaskBranchAbsent`). They remain as defense-in-depth; the new positive proof gate is added ahead of deletion, not as a replacement.

## Acceptance Criteria

Mechanics (exact function signatures, where within `mergeOpenPRsAndPull`/`shipTasks` the helper is called, the proof helper's name) are deferred to plan/implement. ACs state observable contracts; the Testing Matrix defines verification.

- [ ] **AC-1 — PR number is pinned at `--pr` time.** After `canon run <id> --pr` creates or finds the task's PR, `status.json` contains `pr.number` equal to that PR's number. This holds on both branches of `reportOrCreatePR()` (PR newly created, and pre-existing open PR found).
- [ ] **AC-1b — `--pr` persists the pinned number cleanly.** After a successful `canon run <id> --pr`, the pinned `pr.number` is persisted such that a *separate, later* `--ship` invocation reads it, and `--pr` exits **without** leaving a divergent uncommitted-and-unpushed `tasks/<id>/status.json` (no dirty-tree surprise for later gates). Verified on both the PR-created path and the idempotent existing-PR-found path.
- [ ] **AC-2 — Deletion requires proof (gh-reachable, happy path).** When the pinned PR is `MERGED`, its base ref equals the task's current `base_branch`, and the local task-branch tip is an ancestor of (or equal to) its head-ref commit (`headRefOid`), `--ship` archives the task and deletes the local branch. Verified by a fixture where all three hold (exact-equality sub-case).
- [ ] **AC-2b — Deletion refused on merged-into-wrong-base.** When the pinned PR is `MERGED` and the local tip is an ancestor-or-equal of its head-ref commit, but its base ref is **not** the task's current `base_branch` (the work merged into a different base), `--ship` `die`s without archiving or deleting the local branch. This is distinct from AC-3/AC-5 (branch-name forgery) — it exercises the pinned-number path with a wrong base. Verified by a fixture where `gh pr view` reports `state=MERGED`, an ancestor-matching `headRefOid`, and a non-matching `baseRefName`.
- [ ] **AC-3 — Deletion refused on forgeable signal (branch reuse).** When the only "merged PR" for the branch is a *stale* PR whose head-ref commit the local task-branch tip is **not** an ancestor of (simulating branch-name reuse — the stale head is unrelated to the current local work), `--ship` does **not** delete the local branch — it `die`s with a recovery message. The local branch and task dir survive.
- [ ] **AC-4 — Deletion refused when never merged.** When the task branch was never pushed / has no merged PR and the local branch still exists, `--ship` `die`s without deleting the branch or archiving the task.
- [ ] **AC-5 — Fallback proof for legacy tasks (no pinned number).** When `status.json` has no `pr.number` (pre-change task) but a merged PR exists whose head-ref commit the local tip is an ancestor of (or equal to), `--ship` proves the merge via the branch-lookup fallback and completes (archive + delete).
- [ ] **AC-6 — Fast-forward is ungated and non-destructive.** In the `!merged` fallback with local base strictly behind origin (`behind > 0 && ahead === 0`), `--ship` fast-forwards the base via `git pull --ff-only` without requiring a merge-proof gate on the fast-forward itself, and the reverted commit's `die`-on-behind path is gone. (The deletion that follows is still gated per AC-2–AC-5.)
- [ ] **AC-7 — Clean abort-then-re-run completes in one re-run.** Simulating "first run merged the PR but aborted before pull/archive": a single subsequent `--ship` (PR already `MERGED`, local base behind, local tip ancestor-or-equal of the PR head) fast-forwards, archives, and deletes the branch — no second manual cycle, no `die`.
- [ ] **AC-14 — Behind-local branch ships (regression for the round-1 PR-review P1).** When the local `task/<id>` is *behind* `origin/<branch>` because the branch was advanced from another checkout (local holds no unique commits — the documented-safe case `assertTaskBranchPushed()` permits), and the pinned PR merged that remote tip into `base_branch`, `--ship` proves the merge (local tip is a strict ancestor of `headRefOid`) and completes archive + delete in a single invocation — it does **not** `die` with "does not match local tip." Verified by a fixture where the local ref is an ancestor of, and not equal to, the merged PR head.
- [ ] **AC-15 — Unmaterializable PR head ⇒ unproven ⇒ die (fail closed).** If the `headRefOid` commit object cannot be made available locally (the remote branch was deleted by the squash-merge and the fetch of the PR head fails / the object is absent), the proof is treated as **unestablished**: with the local branch present, `--ship` `die`s with a recovery message rather than assuming the merge or comparing against a missing object. Verified by a fixture where the PR head object is not resolvable locally.
- [ ] **AC-7b — Base already in sync but proof absent ⇒ deletion still refused (P1 #2 regression).** When the local base is *already* in sync with origin (`behind === 0`, e.g. the operator manually `git pull`ed) but the task's merge is **not** provable (no merged PR matching the local tip) and the local branch exists, `--ship` `die`s without deleting the branch or archiving. This pins the manual-pull bypass: a synced base must never be read as merge proof — proof is required at the deletion gate regardless of how the base reached sync. Verified by a fixture where base is fast-forwarded/clean but no matching merged PR exists.
- [ ] **AC-8 — Local branch already gone ⇒ no-op deletion, archive proceeds.** When the local task branch does not exist (prior run deleted it) but the task dir is still present, `--ship` archives without requiring merge proof and without error.
- [ ] **AC-9 — `--force` does not bypass the proof gate.** Re-running AC-3's forgeable-signal scenario with `--force` still refuses deletion and `die`s. (`--force`'s existing documented bypasses are unchanged.)
- [ ] **AC-10 — Bundle is all-or-nothing on proof.** In a bundle where one task's merge is provable and another's is not (and the other's local branch exists), `--ship` aborts the destructive tail for the whole bundle — neither task's branch is deleted and neither task is archived.
- [ ] **AC-11 — Schema additive and migration-free.** The top-level `pr` object is optional. A `status.json` without it parses and ships exactly as before (legacy path = AC-5/AC-8). `.canon/templates/status.json`, the `StatusJson` type, and any parser that validates status shape accept the new optional field; existing tests for status parsing still pass.
- [ ] **AC-11b — Malformed `pr` data fails closed.** Because `pr.number` gates a destructive deletion, the proof path must treat the on-disk value as untrusted: a present-but-malformed `pr` (e.g. `pr.number` missing, non-numeric, or wrong-typed) must **not** be silently coerced via the TypeScript cast. The proof helper validates it at the boundary (type the at-risk field `unknown` and narrow) and, on malformed data, falls through to the fallback proof path or `die`s with a recovery message — never deletes on the strength of an unvalidated cast. Verified by a fixture with a corrupt `pr` field.
- [ ] **AC-10b — Bundle `--pr` pins the number to every task.** Since `reportOrCreatePR(taskIds, branchName)` receives the whole bundle and bundle tasks share one branch/PR, `--pr` writes the same pinned `pr.number` to **every** task in `taskIds`. AC-10's per-task proof must hold via the pinned-number path for all siblings, not silently depend on the legacy branch-lookup fallback for the non-author tasks. Verified by a bundle fixture asserting each member's `status.json` carries the pinned number.
- [ ] **AC-13 — `--ship` tolerates an already-deleted remote task branch on cleanup.** In `assertOriginTaskBranchAbsent()`'s merged-PR recovery path, when the stale-remote cleanup `git push origin --delete <branch>` fails *specifically* with `"remote ref does not exist"`, `--ship` logs a no-op notice and continues rather than `die`ing. Any other delete failure still `die`s (unchanged). Verified by a fixture where the delete returns "remote ref does not exist" and `--ship` completes the recovery path without aborting.
- [ ] **AC-12 — Docs reflect the new behavior.** `docs/pipeline-orchestrator.md` (ship/post-merge section) and `CLAUDE.md` (the `--ship` Quick Ref) describe the merge-proof gate and that `--force` does not bypass it. Any restated symbol/value uses the reference form per `AGENTS.md` "Code is Canonical."

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Record `pr.number` in `reportOrCreatePR()` (both create + found-existing branches), persisted per AC-1b. Add a typed helper to read a PR's base ref via `gh pr view <num> --json baseRefName` (no existing `baseRefName` read in this file — this is new). Add a per-task merge-proof helper and call it in `shipTasks()` before the archive/branch-delete tail (`localBranchesToDelete` queue at ~1841, deletion at ~1860); the gh-reachable proof requires MERGED + base-ref-match + **local tip is ancestor-or-equal of `headRefOid`** (`git merge-base --is-ancestor`), **not** strict local-equality. **Materialize `headRefOid` locally before the merge/`--delete-branch` can remove `origin/<branch>`** (fetch the PR head/ref); treat an unresolvable head object as unproven. Fail closed (die) when proof is unestablished and the local branch exists; skip the proof requirement when the local branch is absent. Ungate the fast-forward in `assertLocalBaseInSyncWithOrigin()` (~1230) — remove the reverted `die`-on-behind path so `git pull --ff-only` runs when `behind > 0 && ahead === 0`. In `assertOriginTaskBranchAbsent()` (~1409), tolerate a `git push origin --delete` failure whose stderr contains `"remote ref does not exist"` (log + return instead of die); all other delete failures still die (AC-13). Reuse `isPRMerged()`, `getMergedPRHeadSha()`, `findMergedPRNumber()` (already base-filtered — covers the fallback path's base check), `findOpenPRNumber()`; do not key owned-task proof off branch-name queries. |
| `scripts/run-task/types.ts` | Add optional top-level `pr?: { number: number }` to `StatusJson`. |
| `.canon/templates/status.json` | Document the optional `pr` field convention (no default key required — absence is the legacy/pre-PR state). Mirror to `templates/` is auto-synced. |
| `tests/run-task-ship.test.ts` (new) | Real-git fixtures + stubbed `gh` covering AC-1b through AC-15: PR-number persistence + clean `--pr`, happy path (exact-equality), **merged-into-wrong-base refusal (AC-2b)**, branch-reuse refusal, never-merged refusal, legacy fallback, ungated fast-forward, abort-then-re-run, **base-in-sync-but-unproven refusal (AC-7b)**, branch-already-gone, `--force` non-bypass, bundle all-or-nothing, **already-deleted-remote-branch cleanup tolerance (AC-13)**, **behind-local ancestor ships (AC-14)**, **unmaterializable PR head ⇒ die (AC-15)**. Because the proof is now ancestor-or-equal, fixtures must build real commit chains where the local tip is a strict ancestor of `headRefOid` (AC-14) vs. equal (AC-2) vs. unrelated (AC-3). The fake `gh` must support `--json baseRefName` (and `state`, `headRefOid`). Follow the subprocess + real-git fixture pattern in `tests/run-task-safety.test.ts`. |
| `tests/run-task-validation.test.ts` | Add a status-parse row asserting the optional `pr` field is accepted and a status without it still validates (AC-11). |
| `tests/run-task-safety.test.ts` | Extend the existing fake-`gh` double to support `--json baseRefName`; update existing ship fixtures for pinned-PR semantics. |
| `docs/pipeline-orchestrator.md` | Update the Shipping & Post-Merge Reconciliation section to describe the merge-proof gate, the ungated fast-forward, and `--force` non-bypass. |
| `CLAUDE.md` | Update the `--ship` Quick Ref to note the merge-proof gate (delete-only-when-proven) and that `--force` does not bypass it. |
| `dist/scripts/run-task.js` | Rebuilt from source via `npm run build`. |
| `dist/cli/index.js` | Rebuilt from source via `npm run build`. `main.ts` is reachable from both `scripts/run-task.ts` and `src/cli/index.ts` entry points (see lessons-learned "source file bundles into multiple dist artifacts"). |
| `templates/.canon/templates/status.json` | Auto-synced canon-managed mirror of `.canon/templates/status.json` (pre-commit hook). |
| `templates/CLAUDE.md` | Auto-synced canon-managed mirror of `CLAUDE.md` (pre-commit hook). |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced canon-managed mirror of `docs/pipeline-orchestrator.md` (pre-commit hook). |

### Interaction Dependencies

- **`reportOrCreatePR()` / `createDraftPRForTask()` / `findOpenPRNumber()`** — the `--pr` path that must write `pr.number`. Recording must work on the idempotent re-`--pr` path (existing open PR found) so canon-driven close-and-reopen refreshes the pinned number.
- **`mergeOpenPRsAndPull()`** — the happy path that returns `true` and skips the fallback; the proof gate runs in `shipTasks` regardless of which path merged, so a single-invocation ship still verifies before deleting.
- **`assertOriginTaskBranchAbsent()` / `assertNoOpenPRForTask()`** — retained negative guards; the new positive gate runs alongside them, not instead.
- **Worktree teardown** — happens in the archive loop before local-branch deletion; the proof gate must read the local task-branch tip *before* teardown affects branch resolution. Use the active checkout for reads (`docs/patterns.md` worktree-cwd pitfall).
- **`canon task` CLI / status validators** — must tolerate the new optional field (State Schema Discipline).

### Data Model Changes

Adds optional top-level `pr?: { number: number }` to `StatusJson` (`scripts/run-task/types.ts`) and the template. Optional and additive — no migration shim; absence is a valid (legacy) state handled by the fallback/no-op paths.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite runs clean; new `tests/run-task-ship.test.ts` added
- [x] `npm run build` — rebuild and commit `dist/` deltas (both entry-point bundles)
- [x] `npm run docs-refs-check` — `docs/` + `CLAUDE.md` + task artifacts touched
- [x] `npm run sync-templates:check` — `.canon/templates/status.json` is canon-managed; mirror must stay aligned
- [ ] E2E — N/A (no UI surface)

## Docs Impact

- `docs/pipeline-orchestrator.md` — Shipping & Post-Merge Reconciliation section gains the merge-proof gate description (updated by this task, listed in Affected Files).
- `CLAUDE.md` — `--ship` Quick Ref note (updated by this task).
- `docs/product-context.md` — delicate-surfaces list already covers the ship/branch-deletion path under worktree machinery + auto-commit; no new entry needed.
- `docs/decisions.md` — no new decision entry required; this implements existing decisions (file-based state, no-self-review) rather than settling a new debate.

## Known Risks

- **Local-tip resolution under worktree teardown.** The proof must read the task-branch tip from the correct checkout *before* worktree teardown changes branch resolution. Reading the wrong checkout (REPO_ROOT vs worktree) silently compares against a stale tip. Mitigation: resolve the tip in the active checkout and capture it before the archive loop tears anything down; the test fixtures must cover a `worktree: true` task end-to-end.
- **`headRefOid` object availability (the round-1 P1 caveat).** The ancestor check (`git merge-base --is-ancestor <localTip> <headRefOid>`) needs the `headRefOid` commit object present locally — but the squash-merge with `--delete-branch` removes `origin/<branch>`, and the object may never have been fetched into this checkout. Mitigation: materialize the PR head (fetch the PR ref / the SHA) **before** the merge deletes the branch, and treat an unresolvable object as **unproven → die** (AC-15), never as a pass and never as a silent skip. A fixture must exercise the missing-object path. Anchoring on the *local* tip with strict equality (the shipped round-1 code) is the specific defect this corrects — it spuriously aborts the documented-safe behind-local case (AC-14).
- **`gh` JSON contract drift.** Proof depends on `gh pr view --json state` / `--json headRefOid` (already used by `isPRMerged`/`getMergedPRHeadSha`) plus a **new** `--json baseRefName` read for the base-ref check. Keep the new read in one typed helper alongside the existing two so the `gh` contract surface stays narrow and the fake-`gh` test double has a single place to extend.
- **`--pr` PR-number persistence ordering.** `reportOrCreatePR()` runs after `commitHumanReviewFiles()` has already committed/pushed artifacts (`main.ts:1093`, `1192`), so a naive `status.json` write there leaves dirty unpushed state (AC-1b guards this). The create path doesn't know the number until after the push; the existing-PR path knows it up front. Plan must pick a persistence mechanism that keeps `--pr` clean on both paths — do not assume a single write site covers both.
- **Accepted false-negative.** AC-4/AC-3's `die` fires whenever proof can't be established and the local branch exists — including genuinely-merged work that `gh` can't currently confirm (e.g. `gh` down on the re-run with no pinned number). This is intended fail-closed behavior; the die message must give a concrete manual path so an operator is never stuck without a documented recovery.
- **Bundle proof ordering.** All proofs must be established *before* the first deletion, not interleaved per task in the archive loop — otherwise an early task's branch could be deleted before a later task's proof fails. The implementation must separate "prove all" from "delete all."
- **`createDraftPRForTask` may not surface the PR number directly.** If the create path doesn't return the number, recording `pr.number` may require a follow-up `findOpenPRNumber` after creation. Acceptable; verify the number is captured on the create branch (AC-1), not only the found-existing branch.

## Human Test Plan

1. Run a small task through the pipeline to `human_review` and open its PR with the `--pr` step. Confirm the task's stored state now records the pull-request number for that task.
2. From `human_review`, ship the task in the normal way (PR open, merge online). Expected: the task ships and is archived in a single step, exactly as today.
3. Simulate an interrupted ship: merge the task's PR on the hosting site directly, then run the ship step once. Expected: the ship step completes in that one run — it brings the local base up to date and archives the task without asking you to pull manually first, and without any second attempt.
4. Simulate a reused branch name: arrange a state where the most recent merged pull request for the branch is an *older, unrelated* one that does not correspond to the current work, then run the ship step. Expected: the ship step refuses to finish, leaves the task and its branch intact, and prints a recovery message explaining what to check.
5. Try the same refused case again but add the "force" option. Expected: it still refuses — forcing does not override the merge-safety check.
6. Confirm older in-progress tasks (created before this change, with no stored pull-request number) still ship normally when their work is genuinely merged.
7. Simulate a branch advanced from another machine: arrange a state where your local copy of the task branch is *behind* the version that was actually merged (someone pushed newer commits and merged them while your local copy stayed older), then run the ship step. Expected: it recognizes the work was merged and ships cleanly in one step — it does **not** stop and complain that your local branch "doesn't match," which is the bug this amendment fixes.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; plan written post-spec-review)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`

---

## Amendment

> Reroute from `human_review` after Codex's PR-level review (PR #145) flagged a P1 in the round-1 implementation. This amendment **corrects the merge-proof comparison anchor**; everything else in the spec stands.

### What was wrong

Round-1 ACs (and the implementation) defined the gh-reachable proof's third condition as *"the PR's head-ref SHA **equals** the **local** task-branch tip."* That breaks a path canon explicitly documents as safe: when the task branch was advanced from **another checkout**, the local `task/<id>` ref is *behind* `origin/<branch>` (it holds no unique commits — `assertTaskBranchPushed()` permits this, and `mergeOpenPRsAndPull()` merges from the remote tip). Strict equality against the stale local tip then **spuriously aborts a correctly-merged PR** ("does not match local tip"), forcing manual branch surgery and defeating the single-shot-`--ship` goal. This is fail-*closed* (it refuses to archive merged work; it never deletes unmerged work), so it is not a data-loss regression — but it is a real P1 against the documented behavior and this task's purpose.

### The correction

The third condition becomes: **the local task-branch tip is an ancestor of, or equal to, the PR's head-ref commit (`headRefOid`)** — checked with `git merge-base --is-ancestor <localTip> <headRefOid>`, not strict SHA equality.

- **Behind-local (the bug):** local is a strict *ancestor* of the merged head → proof passes (local's commits ⊆ merged work) → ships in one step. (AC-14)
- **Exact match (normal):** ancestor-or-equal trivially holds. (AC-2)
- **Local holds commits the PR never merged:** local is *not* an ancestor of `headRefOid` → fails closed. (data-loss protection preserved)
- **Branch reuse / stale PR:** the stale head is unrelated to the current local work → not an ancestor → fails closed. (AC-3; the pinned `pr.number` already prevents querying the wrong PR on the primary path)

**Operational caveat (fail closed):** `git merge-base --is-ancestor` needs the `headRefOid` object present locally, but the squash-merge's `--delete-branch` removes `origin/<branch>` and the object may be absent. The proof must **materialize `headRefOid` before the branch can disappear** (fetch the PR head/ref); an unresolvable object is **unproven → die**, never a pass and never a silent skip. (AC-15)

### Scope of changes in this amendment

- Reworded proof definition: Decision §2 (gh-reachable bullet + the "Which commit the proof compares" block) and the no-pinned-number fallback bullet.
- Reworded ACs to ancestor-or-equal semantics: AC-2, AC-2b, AC-3, AC-5, AC-7.
- Added AC-14 (behind-local ancestor ships — the regression test for this P1) and AC-15 (unmaterializable PR head ⇒ die).
- `main.ts` Affected Files row, Known Risks (`headRefOid` object availability), the test row (ancestor-chain fixtures), and Human Test Plan step 7 updated to match.

No change to: PR-number pinning (AC-1/AC-1b), wrong-base refusal intent (AC-2b), the ungated fast-forward (AC-6/AC-7b), bundle semantics (AC-10/AC-10b), schema (AC-11/AC-11b), `--force` non-bypass (AC-9), or the stale-remote-ref tolerance (AC-13).
