# Spec: v1.11-harness-cleanup — --pr CI self-cancellation + budget-by-tier

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Two independent orchestrator bugs surfaced during the `operator-review-recovery` (#151) ship cycle. They are bundled here into one M-tier task so the bundle earns a Codex spec-review pass; they share no code.

**A — `canon run --pr` double-push races its own CI and leaves the PR head's checks cancelled** *(observed 2026-06-08 on PR #151)*. The `--pr` flow pushes the human-review artifacts commit, creates the PR, then makes and pushes a **second** `chore: record pr.number …` commit (`recordPinnedPRNumber`, `scripts/run-task/main.ts:840-870`). On a task branch, CI fires only on `pull_request` (the `push` trigger in `.github/workflows/ci.yml` is scoped to `main`/`dev`), so the two events are `opened` (artifacts commit) and `synchronize` (pr.number commit) — both in the same concurrency group `${{ github.workflow }}-${{ github.ref }}` (`refs/pull/N/merge`) with `cancel-in-progress: true`. Whichever run starts second cancels the first; when the `opened` run wins the webhook race it cancels the `synchronize` run, **which is on the actual PR head**, so the PR surfaces a cancelled/red check even though the code passed. On #151 the operator had to `gh run rerun` the head's cancelled runs to get an honest green. This red-badges essentially every canon `--pr`, eroding trust in the CI signal.

**B — every Claude pipeline session spawns with a flat `$5` budget cap, too low for XL/delicate phases** *(diagnosed 2026-06-08 during #151)*. Each Claude phase is spawned with `--max-budget-usd config.claudeBudget`, defaulting to `'5.00'` (`scripts/run-task/env.ts:124`, consumed at `scripts/run-task/agents/claude.ts:110`). On an oversized phase — a large spec revision, or a `code_review` foreman fanning out two lens sub-agents over a ~100KB diff — the session exhausts $5 mid-work. (The downstream consequence, the orchestrator-killing `process.exit` on the resulting non-zero agent exit, is **out of scope** — deferred to v1.12 as the "blast-radius" half of the budget-death backlog entry. This task removes the *trigger* only.)

## Decision

**A.** Make a single `canon run --pr` invocation produce exactly one CI run, on the PR head. The artifacts commit carries a `[skip ci]` marker so its `pull_request: opened`/`synchronize` event is skipped; the `pr.number` commit (the head) stays unmarked and triggers the sole CI run. This is sound because the two commits differ only by `tasks/<id>/status.json`'s `pr` field, which CI never exercises — so testing the head loses no coverage.

**The marker is conditional, never unconditional.** The load-bearing invariant: a `[skip ci]`-marked commit must never be left as the branch head, because a marked head on a required-checks repo would carry no CI run and block merge. The artifacts commit is therefore marked **only when a subsequent unmarked `pr.number` head commit is guaranteed to follow in the same run.** `recordPinnedPRNumber` (`main.ts:840-870`) early-returns *without committing* when the PR number is already pinned (`!anyChanged`, line 850) — so on a dirty-tree `--pr` against an already-pinned open PR, no `pr.number` commit follows and the artifacts commit would itself become the (skipped) head. The fix must determine, **before** the artifacts commit is made, whether a `pr.number` commit will follow — concretely, mark only when `createPR` is set **and** the open-or-to-be-created PR's number is not already pinned to every task's `status.json`. When no pin commit will follow (already pinned, clean-tree re-run, `--push`-only), the artifacts commit is left unmarked and gets its own CI run as the head. (Exact placement of the lookup and the predicate is a mechanics detail for plan/implement; the contract is "never a marked head.")

**B.** Scale the per-phase Claude `--max-budget-usd` cap by **effective size** (delicate forces XL, as everywhere else): **S = $5, M = $5, L = $10, XL/delicate = $20**. M intentionally inherits the $5 cap — the exhaustion incident was XL/delicate-specific (Opus `code_review` foreman + two lens sub-agents over a ~100KB diff); an M `code_review` runs Sonnet over a smaller diff and $5 is ample. The gradient departs from $5 only where the heavy phases live (L, XL). When the `CLAUDE_BUDGET` env var is set, it overrides the tiered value with a flat cap for all phases (preserving today's `CLAUDE_BUDGET=20.00` interim mitigation). The budget decision lives in `scripts/pipeline-policy.ts` per the "any new routing decision goes in pipeline-policy.ts" rule (`docs/decisions.md`).

Mechanics (exact function signature for threading the budget, where the `[skip ci]` conditional is evaluated) are deferred to plan/implement; the ACs below state observable contracts.

## Non-Goals

- **Not** touching the `process.exit`-on-agent-failure blast-radius behavior in `runClaude` (the orchestrator-death half of the budget-death entry) — that is a separate delicate v1.12 task. Scope here is the budget *trigger* only.
- **Not** changing `--ship`, the merge-evidence/ancestry gate, or `recordPinnedPRNumber`'s pinning semantics — the `pr.number` is still committed and pushed so the local tip stays equal to the PR head and `--pr` leaves a clean tree. Only the CI-trigger behavior of the surrounding commits changes.
- **Not** altering `.github/workflows/ci.yml` or any adopter CI config — the fix is portable orchestrator behavior that works regardless of a repo's concurrency settings.
- **Not** the 733 mixed-bundle reroute over-requirement (separate backlog entry).
- **Not** introducing a config/env flag to toggle the `[skip ci]` behavior — it is unconditional on the `--pr` create path.
- **`[skip ci]` is applied only when an unmarked `pr.number` head commit is guaranteed to follow.** The `--push`-only path (no PR creation), the clean-tree re-run path, **and the dirty-tree `--pr` against an already-pinned open PR** (where `recordPinnedPRNumber` no-ops, so no `pr.number` commit follows) must never apply a `[skip ci]` marker — in each, the artifacts commit is or becomes the head and would be stranded with no CI run. (Positive framing of the AC-2 / AC-2b / AC-2c / AC-4 invariant.)

## Acceptance Criteria

**Fix A — single CI trigger on `--pr`:**

- [ ] AC-1: On the `--pr` create path where artifacts are committed and a `pr.number` commit follows, the artifacts commit message ends with a `[skip ci]` marker and the `pr.number` commit message does **not**. Verified by a `tests/run-task-ship.test.ts` assertion inspecting `git log` messages after a `--pr` run.
- [ ] AC-2: The `[skip ci]`-marked commit is never the final branch head after `--pr` (the safety invariant — a marked head on a required-checks repo would block merge). Verified by asserting the post-`--pr` head commit message carries no `[skip ci]` marker on the create path.
- [ ] AC-2b: On the clean-tree idempotent re-run path (no dirty artifacts, `pr.number` already pinned, branch already pushed), `--pr` introduces no new `[skip ci]`-marked commit and leaves the tree clean. Verified by a re-run test: a second `--pr` invocation leaves the head unmarked and the tree clean.
- [ ] AC-2c: **(closes Codex spec-review finding)** On the **dirty-tree** `--pr` path where artifacts are committed but `recordPinnedPRNumber` no-ops because `pr.number` is **already pinned** to the open PR (so no `pr.number` commit follows), the artifacts commit — which becomes the branch head — is **not** `[skip ci]`-marked, so the head retains its CI run. Verified by a `tests/run-task-ship.test.ts` case: open PR already pinned, re-dirty an artifact, run `--pr`, assert the resulting head commit message carries no `[skip ci]` marker.
- [ ] AC-3: `--pr` still leaves a clean working tree and still pins `pr.number` to every task's `status.json` (existing behavior preserved). Verified by the existing `tests/run-task-ship.test.ts` clean-tree + pin assertions continuing to pass (create path, existing-PR path, bundle path).
- [ ] AC-4: The `--push` (no PR creation) path is unchanged — it adds no `[skip ci]` marker that could strand a PR head unchecked. Verified by inspection / an existing `--push` test remaining green.

**Fix B — budget-by-effective-size:**

- [ ] AC-5: With `CLAUDE_BUDGET` **unset**, the resolved per-phase budget equals the effective-size tier: S→`5.00`, M→`5.00`, L→`10.00`, XL→`20.00`, and any `delicate: true` task→`20.00` regardless of nominal size. Verified by new table rows in `tests/pipeline-policy.test.ts`.
- [ ] AC-6: With `CLAUDE_BUDGET` **set** (e.g. `20.00`), the resolved budget equals that flat value for every effective size. Verified by a `pipeline-policy.test.ts` row exercising the override.
- [ ] AC-7: The `--max-budget-usd` argument at the `claude` CLI spawn site is the resolved per-phase budget threaded through `runClaude` — **replacing** the flat `config.claudeBudget` read at that site (the old read must not exist there after). Applies to **every** Claude `runClaude` call site: the four phase runners (`phases/spec.ts` — both `promptSpec` and `promptSpecRevision`; `phases/plan.ts`; `phases/code-review.ts`; `phases/qa.ts`) **and** the retry path `retryAgentForPhase` (`main.ts:2670-2671`), which already resolves `cfg = getClaudeConfig(phase, retryTasks)` and must pass `cfg.budget` like the others. Verified by inspection of `agents/claude.ts` + all five call sites. **(The retry site closes a Codex spec-review finding.)**
- [ ] AC-8: Structural deletion check — `grep -rn "claudeBudget" scripts/ src/` shows `config.claudeBudget` / the budget value appearing **only** in the allow-listed plumbing paths: the env-capture in `scripts/run-task/env.ts`, the policy module (`scripts/pipeline-policy.ts`), and the policy wrapper (`scripts/run-task/policy.ts`). It must **not** appear at the `agents/claude.ts` spawn site or anywhere else. (Derive the final allow-list from `git grep` at implement time; the build artifact `dist/` mirror is exempt.)

**Both:**

- [ ] AC-9: `npm run build` is run and committed `dist/` matches a fresh build (CI runs `npm run build && git diff --exit-code -- dist/`).

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | **Fix A**: in `commitHumanReviewFiles`, append a `[skip ci]` marker to the artifacts commit message **only when a following unmarked `pr.number` head commit is guaranteed** (createPR set AND the open/created PR's number is not already pinned). Determine that before committing artifacts; leave `recordPinnedPRNumber`'s `pr.number` commit unmarked. The `--push`-only path, the clean-tree re-run path, and the dirty-tree-already-pinned path (where `recordPinnedPRNumber` no-ops) must never leave a `[skip ci]` head. **Fix B**: in `retryAgentForPhase` (`~line 2670`), pass `cfg.budget` (from the already-resolved `getClaudeConfig`) into `splitClaude.runClaude`, matching the four phase call sites. |
| `tests/run-task-ship.test.ts` | Fix A: assert marker placement on the create path (artifacts commit has `[skip ci]`, pr.number commit does not); add the AC-2b clean-tree re-run case (head unmarked, tree clean) **and the AC-2c dirty-tree-already-pinned case** (head commit unmarked because no pin commit follows); keep existing clean-tree/pin/bundle assertions green. |
| `scripts/pipeline-policy.ts` | Fix B: add the effective-size→budget mapping (S/M `5.00`, L `10.00`, XL `20.00`), override-aware (flat when the `CLAUDE_BUDGET` value is present in `PolicyConfig`); expose the resolved budget as a `budget` field on the policy's returned `ClaudeModelConfig` (so every `getClaudeConfig` caller, including the retry path, gets it via `cfg.budget`). |
| `scripts/run-task/policy.ts` | Fix B: pass the `CLAUDE_BUDGET` override into `PolicyConfig` (`policyConfig()`), and surface the resolved budget via `getClaudeConfig`. |
| `scripts/run-task/env.ts` | Fix B: change `claudeBudget` (line 124) from `?? '5.00'` to an override-or-unset shape (the env value or a null/sentinel) so the policy can distinguish "operator set a flat cap" from "use the tier." |
| `scripts/run-task/agents/claude.ts` | Fix B: `runClaude` gains a `budget` parameter and uses it for `--max-budget-usd` (line 110) instead of the flat `config.claudeBudget`; the `config.claudeBudget` read at this site is removed. |
| `scripts/run-task/phases/spec.ts` | Fix B: pass the resolved budget from `getClaudeConfig` into `runClaude` (both `promptSpec` and `promptSpecRevision` call sites). |
| `scripts/run-task/phases/plan.ts` | Fix B: pass the resolved budget into `runClaude`. |
| `scripts/run-task/phases/code-review.ts` | Fix B: pass the resolved budget into `runClaude`. |
| `scripts/run-task/phases/qa.ts` | Fix B: pass the resolved budget into `runClaude`. |
| `tests/pipeline-policy.test.ts` | Fix B: add budget table rows for each effective size + the `CLAUDE_BUDGET` override case. |
| `dist/` | Build artifact: regenerated by `npm run build` because `src/`→`scripts/run-task.ts`/`scripts/run-task/**`/`scripts/pipeline-policy.ts` are bundled into `dist/`. Declared so the `--pr` base-drift gate allows the regenerated output. |

### Interaction Dependencies

- Fix A interacts with `--ship`'s merge-evidence/ancestry proof, which requires the local branch tip to equal-or-be-ancestor-of the PR head. The `pr.number` commit must still be committed **and pushed** (unchanged) so local == origin head; only its CI-trigger neighbor changes. No change may make the local tip diverge from the pushed head.
- Fix B interacts with the model/effort matrix in `pipeline-policy.ts` (same effective-size bucketing; `getEffectiveSize`/`anyDelicate` already force XL for delicate). Budget reuses that bucketing — no new tier concept.

### Data Model Changes

`status.json` shape unchanged. `PolicyConfig` gains a budget-override field (`string | null`, mirroring `maxReviewLoops`); `ClaudeModelConfig` gains a `budget: string` field; `runClaude` gains a `budget` parameter (internal types, not persisted). No persisted-data changes.

## Validation Required

- [x] `npm run lint` (= `eslint scripts/ tests/ src/`)
- [x] `npm run type-check` (= `tsc -p tsconfig.json --noEmit`)
- [x] `npm test` (= `node --test --import tsx tests/*.test.ts`) — full suite runs clean
- [x] `npm run build` (= `tsup` + postbuild) — **required**; commit any `dist/` delta; CI gates on `git diff --exit-code -- dist/`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`
- E2E: N/A (no UI surface)

## Docs Impact

- `docs/pipeline-orchestrator.md` — the `CLAUDE_BUDGET` env-var row (currently "Default `5.00`, Max spend per Claude phase") should be updated to describe the tiered default + override semantics. QA may touch this; declared here.
- `docs/decisions.md` — optional: a one-line note under the model/effort policy that budget now scales by effective size. Not required if the orchestrator doc covers it.
- No `codebase-map.md` / `patterns.md` / `architecture.md` / `product-context.md` drift expected.

## Known Risks

- **Fix A — `[skip ci]` placement must guarantee the marked commit is never the final head.** This is the trickiest part and the subject of the Codex spec-review finding. `recordPinnedPRNumber` early-returns *without committing* when `pr.number` is already pinned (`!anyChanged`, `main.ts:850`), so on a dirty-tree `--pr` against an already-pinned open PR **no `pr.number` commit follows** and a blanket `[skip ci]` on the artifacts commit would strand the head with no CI. The marker must be conditioned on "a `pr.number` head commit is guaranteed to follow" — decided **before** the artifacts commit (createPR set AND the open/created PR not already pinned). The clean-tree re-run path and `--push`-only path likewise produce no following pin commit and must stay unmarked. AC-2, AC-2b, AC-2c, and AC-4 together guard every variant.
- **Fix A — `[skip ci]` marker portability.** GitHub honors `[skip ci]` (and `[ci skip]`) on the head commit of `push`/`pull_request` events; the implementation should use the canonical `[skip ci]` form. Adopters whose CI ignores skip markers would still see the double run but no *worse* than today (no regression); for canon-ai the fix is effective.
- **Fix A is not unit-testable end-to-end** (no real GitHub in tests). The testable proxy is the commit-message marker placement and push sequence via the existing fake-git/gh subprocess harness. The true behavior (one head run, no cancellation) is verified in the Human Test Plan on a live PR.
- **Fix B — over-provisioning is safe** (budget is a ceiling; unspent headroom costs nothing), but a too-low XL/delicate cap would re-trigger the exhaustion. $20 is chosen against the observed #151 consumption; if a future XL `code_review` exhausts $20, raise the tier or set `CLAUDE_BUDGET`.
- **Fix B — distinguishing "unset" from "set to 5.00".** The env capture must treat an explicit `CLAUDE_BUDGET=5.00` as an override (flat) and an absent var as "use the tier," even though S/M tier is also `5.00`. The distinction only matters for L/XL, where unset→tiered and set→flat differ. AC-5/AC-6 cover both.

## Human Test Plan

1. **Budget tiers (Fix B).** On a task whose size is L or XL (or any delicate task), start the pipeline with `CLAUDE_BUDGET` unset and confirm the run log / dry-run shows the Claude phases using a higher spend cap than the old flat $5 (L → $10, XL/delicate → $20). On a small (S) task, confirm the cap is still $5.
2. **Budget override (Fix B).** Re-run the same task with `CLAUDE_BUDGET=20.00` set and confirm every phase uses the $20 flat cap regardless of size.
3. **One honest CI run on `--pr` (Fix A).** Take any task to the point of opening a draft PR and run the open-PR step. On GitHub, confirm the PR shows a **single** CI run on the latest commit and it completes without being cancelled — no red/cancelled check on the head, and no need to manually re-run. Expected: exactly one green (or legitimately failing) check on the PR head, not a cancelled one.
4. **Ship still works (Fix A).** Confirm the task can still be shipped normally after the PR is approved — the PR number is still recorded and the merge completes.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories, except the declared `dist/` build artifact) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names — N/A (full tier; plan written in pipeline)
- [x] Known Risks covers failure modes for the trickiest ACs (the `[skip ci]`-as-head invariant, unset-vs-set budget)
- [x] Human Test Plan uses product language only (no code beyond the operator-facing env var / CLI step)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] Symbols named in ACs exist: `commitHumanReviewFiles`/`recordPinnedPRNumber` (`main.ts`, with `recordPinnedPRNumber`'s `!anyChanged` early-return at `main.ts:850` confirmed), `config.claudeBudget` (`env.ts:124`, `agents/claude.ts:110`), `getClaudeConfig`/`ClaudeModelConfig`/`PolicyConfig` (`policy.ts`/`pipeline-policy.ts`), `runClaude` + the four phase call sites + the retry site `retryAgentForPhase` (`main.ts:2670-2671`, which already resolves `cfg = getClaudeConfig(...)`) — all grep-verified during exploration.

---

## Amendment

**Fix A is redesigned — eliminate the second commit instead of skipping its CI run. Fix B is unchanged by this amendment.**

**Why.** The original Fix A marks the non-head artifacts commit with `[skip ci]` so the `pr.number` commit (head) is the sole CI trigger. That marker must be decided *before* `gh pr create` is confirmed on the new-PR path, so a transient creation failure can strand a `[skip ci]` commit as the branch head with CI permanently suppressed until a successful re-run (Codex PR-review **P2** on #153, `scripts/run-task/main.ts:876`). The root cause is deeper than the marker: `--pr` makes **two pushed commits** (artifacts, then `chore: record pr.number`), and the second push is what creates the `opened`-vs-`synchronize` race in the first place. Removing the second commit removes the race, the marker, and the P2 together — and is a net code reduction.

**New mechanism (verified feasible).** The second commit exists only to persist `pr.number`, and `pr.number` is consumed by exactly one caller — `--ship`'s merge-evidence (`readPinnedPrNumber` at `main.ts:1539` and `1587`), read from the local on-disk task state. Nothing in git history or on origin needs it. So: persist `pr.number` to a **gitignored task-local sidecar** `tasks/<id>/.pr-number` (same pattern as the existing `tasks/**/.canon-pid`, `.canon-run.log`, `.heartbeat.json` entries in `.gitignore`) instead of committing it to `status.json`. `recordPinnedPRNumber` writes the sidecar with **no stage/commit/push**. `--pr` then makes exactly **one** pushed commit (the artifacts commit, which is the head), so `gh pr create` fires a single `pull_request` run on the head — no race, no marker, in every path (create, clean re-run, dirty re-run). `--ship` reads `pr.number` from the sidecar, falling back to its existing branch-lookup (`findOpenPRNumber`/`findMergedPRNumber`) when the sidecar is absent.

**Superseded acceptance criteria.** AC-1, AC-2, AC-2b, AC-2c (all `[skip ci]`-marker behavior) are **removed**. The `[skip ci]` marker logic and the `willPinCommitFollow` helper introduced for the original Fix A **must not exist after this amendment**. AC-3 is superseded by AC-A3 below (clean tree preserved; pin now lives in the sidecar, not committed `status.json`). AC-4 is moot (there is no marker to mis-apply on `--push`). AC-5 through AC-9 (Fix B + build) are unchanged.

**New acceptance criteria (Fix A):**

- [ ] AC-A1: On the `--pr` create path, `canon run --pr` produces **exactly one** pushed commit (the artifacts commit), which is the branch head. No `chore: record pr.number` commit is created. Verified by `tests/run-task-ship.test.ts` asserting `git log` after `--pr` shows the artifacts commit as HEAD and **no** `record pr.number` commit.
- [ ] AC-A2: No commit message produced by `--pr` contains `[skip ci]`, and `willPinCommitFollow` does not exist in the tree. Verified by grep (`grep -rn "skip ci\|willPinCommitFollow" scripts/ src/` returns nothing outside `dist/`).
- [ ] AC-A3: `--pr` persists `pr.number` to `tasks/<id>/.pr-number` (gitignored) and leaves a **clean working tree** (`git status --porcelain` empty). `pr.number` is no longer written to committed `status.json` as the ship source of truth. Verified by a `tests/run-task-ship.test.ts` assertion: after `--pr`, the sidecar exists with the PR number and the tree is clean.
- [ ] AC-A4: `--ship` reads `pr.number` from the sidecar for merge-evidence (base-ref match + head-ancestor proof unchanged); when the sidecar is absent it falls back to branch-lookup (pre-1.11 behavior). Verified by ship tests covering both the sidecar-present and sidecar-absent paths.
- [ ] AC-A5: `.gitignore` includes `tasks/**/.pr-number` (or equivalent) so the sidecar never appears in `git status`. Verified by inspection + the AC-A3 clean-tree assertion.

### Affected Files

> Supersede the original Fix A rows. Root canon-managed files (`.gitignore`) carry their derived `templates/` mirror per the canon-managed-file sync convention; QA's `docs/pipeline-orchestrator.md` edit likewise mirrors to `templates/`. Both sides are declared so the `--pr` base-drift gate allows the synced output.

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | `recordPinnedPRNumber` writes the `.pr-number` sidecar (remove the stage/commit/push); **delete** `willPinCommitFollow` and the `[skip ci]` marker logic in `commitHumanReviewFiles`; the two `--ship` `readPinnedPrNumber` call sites (`~1539`, `~1587`) read the sidecar (with branch-lookup fallback preserved). |
| `src/lib/canon-block.ts` | Register `tasks/**/.pr-number` in `CANON_RUNTIME_GITIGNORE_PATTERNS` (the canon-owned source that generates the gitignore block + its mirror). |
| `.gitignore` | Generated: adds `tasks/**/.pr-number` to the canon-managed block. |
| `templates/.gitignore` | Derived mirror of `.gitignore` (auto-synced by the pre-commit hook). |
| `docs/pipeline-orchestrator.md` | QA: update the `CLAUDE_BUDGET` row to the tiered default + override semantics. |
| `templates/docs/pipeline-orchestrator.md` | Derived mirror of the above (auto-synced). |
| `tests/run-task-ship.test.ts` | Replace the `[skip ci]`-marker tests with: single-commit assertion (AC-A1), no-marker/no-`willPinCommitFollow` grep intent (AC-A2), sidecar-written + clean-tree (AC-A3), `--ship` reads sidecar + fallback (AC-A4). |
| `dist/` | Rebuilt. |

**Known Risks (amendment):**

- `pr.number` is now task-local (sidecar), not in committed `status.json`. It is consumed only by same-machine `--ship` and is archived after ship; worktree loss before `--ship` degrades gracefully to branch-lookup. The anti-branch-reuse pin property from 1.10.2 is **preserved** — the number is still pinned to *this* `--pr`'s PR, just stored locally rather than committed.
- The change touches `--ship`'s merge-evidence **source** (sidecar vs. committed `status.json`). The ancestry/base-ref proof logic itself is unchanged; verify the fallback path (sidecar absent → branch-lookup) still holds and that a stale/missing sidecar can never *falsely* prove a merge.

---

## Amendment Round 2

**Two correctness fixes from Codex's PR-level review of #153 (both confirmed against the codebase). Behavioral contracts only; no new scope.**

**Round-2-A — the budget flag is print-mode-only; it must not be passed to interactive Claude sessions.** AC-7 said "every Claude phase," and the implementation threaded `--max-budget-usd` into *both* branches of `runClaude` — including the interactive (`--interactive` / no `-p`) branch at `scripts/run-task/agents/claude.ts:~83`. But `claude --help` documents `--max-budget-usd` as **"only works with --print"**. So in the interactive branch the flag is at best silently ignored (interactive was never actually capped) and at worst errors at startup, breaking `canon run --interactive`. Passing a print-only flag to a non-`-p` invocation is incorrect either way.

- [ ] AC-R2-1: `--max-budget-usd` is passed **only** on the print-mode (`-p` / non-interactive) `runClaude` path. The interactive branch (`agents/claude.ts:~83`) must **not** include `--max-budget-usd` in its args. Interactive Claude sessions therefore run uncapped (the prior behavior, and the only correct one given the CLI constraint). Verified by inspection of both `runClaude` branches + a test asserting the interactive args array contains no `--max-budget-usd`.
- This **supersedes** the part of AC-7 that implied the budget reaches *interactive* sessions; AC-7's print-mode threading (the four phase runners + `retryAgentForPhase`, all `-p`) is unchanged and still required.

**Round-2-B — the `--ship` sidecar read must honor `tolerateMissingWorktree`.** Approach B's `sidecarPathFor()` (`main.ts:~840`) resolves through `taskDirFor()` → `resolveTaskCwd()`, which `die()`s when `status.json` has `worktree: true` but the worktree directory is gone. But `--ship`'s partial-cleanup recovery (`main.ts:~1846`) deliberately uses `getActiveCwd(..., { tolerateMissingWorktree: true })`. So reading the sidecar `pr.number` during that recovery (`readSidecarPRNumber` at `~1525`/`~1573`) crashes **before** the tolerant fallback — a regression vs. the pre-Approach-B `status.json` read, which went through the tolerated cwd. AC-A4 required `--ship` to read the sidecar but didn't specify worktree-tolerance.

- [ ] AC-R2-2: The `--ship` sidecar read resolves the `.pr-number` path from a cwd that tolerates a missing worktree (thread the tolerated active cwd into `sidecarPathFor`/`readSidecarPRNumber`, or an equivalent `cwd` parameter), so partial-cleanup `--ship` (worktree removed, `status.json` still `worktree: true`) reads the sidecar and falls back to branch-lookup when it's absent — without `die()`ing first. Verified by a `tests/run-task-ship.test.ts` case: orphaned-worktree state + `--ship` reads the sidecar (or falls back) instead of crashing.
- This **refines** AC-A4 (sidecar read on `--ship`); the sidecar-vs-branch-lookup fallback semantics are otherwise unchanged.

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/agents/claude.ts` | Remove `--max-budget-usd` from the interactive branch's args (keep it on the `-p`/print branch only). |
| `scripts/run-task/main.ts` | `sidecarPathFor`/`readSidecarPRNumber` accept/resolve from a worktree-tolerant cwd so the `--ship` partial-cleanup path reads the sidecar instead of `die()`ing. |
| `tests/run-task-prompts.test.ts` | Assert the interactive `runClaude` args contain no `--max-budget-usd`. |
| `tests/run-task-ship.test.ts` | Orphaned-worktree `--ship` reads the sidecar / falls back without crashing. |
| `dist/` | Rebuilt. |

Fix B's print-mode budget threading and the rest of Approach B are otherwise unchanged.

---

## Amendment Round 3

**One fix: `--ship`'s cwd resolution must delegate to the existing shared resolver, not approximate it.** *(Operator-run `codex review` P2 on the Round-2 implementation, confirmed against the code.)*

**Problem.** Round 2's implementation satisfied AC-R2-2's "tolerated active cwd **or an equivalent cwd parameter**" with a hand-rolled helper `resolveShipCwd` (`scripts/run-task/main.ts:1815-1818`) that checks only the literal `WORKTREES_ROOT/<id>` path and otherwise falls back to `REPO_ROOT`, feeding six `shipTasks` call sites (status reads, branch names, the `.pr-number` sidecar read, gates). That is **not equivalent** to `getActiveCwd([taskId], { tolerateMissingWorktree: true })`: it bypasses (1) the **branch-based worktree lookup** (`findExistingWorktreeForBranch`, `state.ts:13`, used by `resolveTaskCwd`) that bundle **secondary** tasks depend on — bundle tasks share one worktree named after the primary, so a secondary's literal `worktreePath(taskId)` does not exist and `--ship` silently reads stale `REPO_ROOT` state and misses the real sidecar (re-introducing the previously fixed bundle-secondary-fallback bug class); and (2) **`CANON_TASKS_DIR_OVERRIDE`** handling (`state.ts:36/47/111`), breaking the test-harness override guarantee on the ship path. Silent mis-resolution on the highest-stakes path (`--ship` merge evidence + branch deletion) is not acceptable.

**Decision.** `resolveShipCwd` (or its replacement) must **delegate to the shared resolver** — `getActiveCwd([taskId], { tolerateMissingWorktree: true })` — rather than re-deriving worktree location from a path check. "Equivalent" in AC-R2-2 is hereby pinned to mean: tolerant fallback **plus** branch-based worktree lookup **plus** `CANON_TASKS_DIR_OVERRIDE` semantics, i.e. the shared resolver itself.

### Acceptance Criteria

- [ ] AC-R3-1: Every `shipTasks` cwd resolution (all current `resolveShipCwd` call sites) routes through `getActiveCwd([taskId], { tolerateMissingWorktree: true })` (directly or via a thin delegating wrapper). No `fs.existsSync`-on-`worktreePath` approximation of worktree resolution remains in `shipTasks`. Verified by inspection + grep for the removed pattern.
- [ ] AC-R3-2: Bundle-secondary `--ship` resolution works: a `tests/run-task-ship.test.ts` case with two bundled tasks sharing the primary's worktree asserts the **secondary**'s ship-path reads (status + `.pr-number` sidecar) resolve to the shared worktree, not `REPO_ROOT`. Verified by the new test.
- [ ] AC-R3-3: `CANON_TASKS_DIR_OVERRIDE` is honored on the ship path: a test with the override set asserts ship-state reads resolve under the override directory. Verified by the new test.
- [ ] AC-R3-4: The Round-2 orphaned-worktree behavior (AC-R2-2) still holds — partial-cleanup `--ship` (worktree removed, `worktree: true`) reads the sidecar or falls back to branch-lookup without `die()`ing. Verified by the existing AC-R2-2 test continuing to pass.

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Replace `resolveShipCwd`'s hand-rolled path check with delegation to `getActiveCwd([taskId], { tolerateMissingWorktree: true })`; all six call sites unchanged in shape. |
| `tests/run-task-ship.test.ts` | Add bundle-secondary resolution test (AC-R3-2) and `CANON_TASKS_DIR_OVERRIDE` ship test (AC-R3-3); keep the orphaned-worktree test green (AC-R3-4). |
| `dist/` | Rebuilt. |

Everything else from Rounds 1–2 (sidecar mechanism, interactive-flag removal, Fix B) is unchanged.
