# Spec: base-divergence-gate — Harden the --push/--pr/--ship remote boundary (base-divergence gate + push reminder + tolerate auto-deleted branch at ship-merge)

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon's `--push`/`--pr`/`--ship` boundary — the only place the pipeline touches `origin` — currently dies on two recoverable real-world git/GitHub states. Both leave the operator in a confusing or half-complete state.

**Problem A — local base drift is invisible until it manifests as a confusing symptom.** Canon's pre-implement phase auto-commits the task scaffold (`tasks/<id>/spec.md`, `status.json`, empty handoff/review/done templates) **on the operator's local base branch** before creating the worktree (the worktree branches from that local-base tip — per the commit-ownership matrix in `AGENTS.md`). Canon does **not** push the base branch — implicit pushes to `origin` are intentionally out of scope. So every task creation leaves local `<base_branch>` one or more commits ahead of `origin/<base_branch>`, and the drift compounds across parked specs and parallel tasks. It surfaces only later, as a *symptom*:

- The existing `verifyBaseDrift` file-allow-list gate fires with confusing per-file errors ("`tasks/<other-id>/spec.md` not in this task's Affected Files") when the real cause is *other tasks' scaffold commits live on local base but not on origin*.
- At `--ship`, the post-merge `git pull origin <base>` (`mergeOpenPRsAndPull`, main.ts:1514) can **conflict** against those unpushed local-base commits (both touch `tasks/<id>/`), killing ship *after* the PR merged but *before* teardown — a half-complete state.

The thing we are actually trying to prevent is **commits on local base that will collide** with an operation that pulls `<base>`. We are *not* enforcing that local base is "up to date and clean" in a broader sense — a dirty working tree with no unpushed commits is harmless (`git stash`/`pop` handles it) and must never be flagged. The check keys strictly on unpushed *commits*, never on working-tree state. Note canon already hard-blocks the *inverse* direction at ship (`assertLocalBaseInSyncWithOrigin`, main.ts:1155, blocks when local base is *behind* origin) — this task adds the *ahead* direction, which no existing guard covers.

**Problem B — ship dies when GitHub already auto-deleted the merged branch.** In ship's merge mode, `mergeOpenPRsAndPull` runs `gh pr merge --squash --delete-branch` (main.ts:1476). When the repo has "automatically delete head branches" enabled, GitHub removes the head branch as part of the merge, so gh's own `--delete-branch` step then fails on an already-gone branch and the command exits non-zero. The current tolerance only excuses `already merged` and `used by worktree` stderr (main.ts:1485–1488), so any other delete-failure stderr — including the auto-delete race — triggers `die("Failed to merge PR …")` **after the merge already succeeded**. Half-complete ship: PR merged, worktree stranded. (The *cleanup* path — PR merged via the UI before ship — is already safe: `assertOriginTaskBranchAbsent` treats an absent remote branch as the expected post-condition, main.ts:1287. The bug is specific to ship performing the merge itself.)

## Decision

Three changes, unified by one theme: **canon's `--push`/`--pr`/`--ship` remote boundary must handle recoverable git/GitHub state gracefully instead of dying or emitting misleading errors.**

**1. Preventive — push reminder at task creation.** When the pre-implement phase commits the task scaffold to local base and creates the worktree (the moment the drift is introduced), canon prints an informational reminder to `git push origin <base>`. `canon run` itself still never pushes — only `--push`/`--pr`/`--ship` touch the remote — so a *reminder* (not an action) is the correct preventive here.

**2. Detective — base-divergence gate at the remote boundary.** A check runs at `--push`, `--pr`, and `--ship` when local `<base_branch>` has commits not on `origin/<base_branch>`, and **hard-fails (`die`) at all three** with a root-cause error listing the colliding commits. Blocking (not warning) at `--ship` is the correct call: it matches the existing `assertLocalBaseInSyncWithOrigin` hard-block precedent, and catching the divergence *before* `mergeOpenPRsAndPull` prevents the conflicting post-merge pull described in Problem A. A new flag `--allow-divergent-base` bypasses this check **at all three boundaries** (downgrading the block to a warn-and-proceed). The check runs **before** the existing `verifyBaseDrift` file-allow-list gate at `--push`/`--pr`, so the more informative root-cause message fires first. `--allow-divergent-base` bypasses **only** this new check; the existing `--force` continues to bypass **only** the file-allow-list gate. The two bypasses stay distinct.

**3. Robustness — tolerate an already-deleted remote branch at ship-merge.** In `mergeOpenPRsAndPull`, decouple merge-success from branch-delete-success: if the PR merged (verified authoritatively via gh PR state, not by matching gh's delete-failure stderr), a failed branch delete is downgraded to a warning and ship continues. Ship dies only if the *merge itself* failed. This generalizes the existing `used by worktree` tolerance and covers the GitHub auto-delete race.

## Non-Goals

- **No implicit push of the base branch under any flag.** Canon detects, reports, and *reminds*, but never pushes on the operator's behalf. The preventive reminder (change 1) is informational only — it does not run `git push`.
- **No change to where canon commits scaffolding.** Pre-implement commits still land on local `<base_branch>`; restructuring that is a separate, larger design question. The reminder makes the existing behavior visible; it does not move the commit.
- **The base-divergence check keys on commits, never on working-tree cleanliness.** A dirty tree on base with no unpushed commits is not flagged at any boundary. (The most likely over-reach: do not extend the check to `git status` state.)
- **No coalescing of `--force` and `--allow-divergent-base`** into one flag. They bypass different gates; an operator who wants past both must pass both.
- **No change to `verifyBaseDrift` semantics** or its `--force` bypass. It stays byte-identical and keeps catching file-level cross-pipeline contamination as a backstop.
- **No change to the inverse-direction ship guard** (`assertLocalBaseInSyncWithOrigin`, the behind-direction block). This task adds the ahead-direction; the behind-direction guard is untouched.
- **No retroactive cleanup of already-divergent local base branches.** The check informs; cleanup is the operator's `git push origin <base>`.
- **No broadening of change 3 beyond the merge/delete decoupling.** We do not rework `assertOriginTaskBranchAbsent` or the cleanup-path remote handling; only the merge-mode delete-failure tolerance changes.

## Acceptance Criteria

- [ ] AC-1: A new function `getUnpushedBaseCommits(baseBranch: string, cwd: string): { commits: { sha: string; subject: string }[]; ok: boolean; stderr: string }` exists in `scripts/run-task/git.ts`. It runs `git log origin/<baseBranch>..<baseBranch> --format=%H%x09%s` via `gitSafeAtRaw` and parses the tab-separated output into `commits[]`. Returns `{ commits: [], ok: false, stderr }` on git failure. Mirrors `getTreeDriftFiles`'s shape (no exceptions; success/failure in the return value).

- [ ] AC-2: A new function `verifyBaseDivergenceFromData(commits: readonly { sha: string; subject: string }[]): string` exists in `scripts/run-task/validation.ts`. It returns the empty string when `commits` is empty, and otherwise returns the formatted message, framed around **colliding commits** (not cleanliness): a header naming N commits on `<base>` not yet on `origin/<base>` and stating they will collide when `<base>` is pulled; one line per commit (short-sha + subject); a fix-instruction line containing `git push origin`; and an override-instruction line containing `--allow-divergent-base`. The same message is used at all three boundaries (the flag is meaningful everywhere now that ship also blocks), so it is baked into this function rather than appended per-site. The exact format is asserted in tests so it stays stable. Mirrors the `*FromData` data-seam pattern used by `verifyBaseDriftFromData`.

- [ ] AC-3: A new function `verifyBaseDivergence(baseBranch: string, cwd: string): { commits: { sha: string; subject: string }[]; ok: boolean; stderr: string; fetchFailed: boolean }` exists in `scripts/run-task/validation.ts`. It runs `git fetch origin <baseBranch>` via `gitSafeAt`, then calls `getUnpushedBaseCommits`. On fetch failure: emits a `warn(...)` (matching `verifyBaseDrift`'s precedent) and returns `{ commits: [], ok: true, stderr: '', fetchFailed: true }` (fail-open — a network blip doesn't block the operation). On `getUnpushedBaseCommits` failure: returns the helper's `commits`/`ok`/`stderr` plus `fetchFailed: false` — i.e. `{ commits: [], ok: false, stderr, fetchFailed: false }` — so the returned object always satisfies the declared four-field interface (the helper returns only three fields; the wrapper adds `fetchFailed: false` explicitly). On success: `{ commits, ok: true, stderr: '', fetchFailed: false }`. The fetch is independent of `verifyBaseDrift`'s — at `--push`/`--pr` both fetch the same ref; the second fetch is a near-instant no-op against an already-current remote.

- [ ] AC-4: The `CliArgs` type — defined in `scripts/run-task/types.ts` (line 118, after `force: boolean` at line 129), **not** `cli.ts` (which imports it from `./types.js`) — gains a new boolean field `allowDivergentBase`. The parser `parseArgs` in `scripts/run-task/cli.ts` parses `--allow-divergent-base` in its existing arg switch (near the `--force` case), defaults it to `false`, and includes it in the returned object. The CLI usage text in `cli.ts` documents the flag as bypassing the base-divergence block at `--push`/`--pr`/`--ship`, and explicitly notes it is independent of `--force` (different gate). Both files must be edited; the type addition and the parser addition together make `cliArgs.allowDivergentBase` both type-safe and populated.

- [ ] AC-5: `commitHumanReviewFiles` in `scripts/run-task/main.ts` (line 902–945) invokes `verifyBaseDivergence(baseBranch, cwd)` **before** the existing `verifyBaseDrift(taskIds, baseBranch, cwd)` call at line 908. Semantics: if `verifyBaseDivergence` returns `ok: false`, `die()` with `stderr` (git-execution failure; not bypassable). If `fetchFailed: true`, the warn was already emitted by the gate — treat as no divergence and continue to `verifyBaseDrift`. If `commits.length > 0` and `!cliArgs.allowDivergentBase`, `die()` with `verifyBaseDivergenceFromData(commits)`. If `cliArgs.allowDivergentBase` is true and commits are non-empty, emit a `warn(...)` listing the bypassed commits and continue to `verifyBaseDrift`. **Reviewer check**: `verifyBaseDrift`'s body and signature must be byte-identical before and after this task; any change to it is a Stage 1 fail.

- [ ] AC-6: The `--ship` dispatch path (`shipTasks` in `scripts/run-task/main.ts`, around line 1593) invokes `verifyBaseDivergence(baseBranch, cwd)` **before** `mergeOpenPRsAndPull` (line 1691) — i.e. before the irreversible merge — after the phase guards and `ensureCheckedOutBaseBranch` (line 1688). It uses the **same hard-block semantics as AC-5**: `commits.length > 0` and `!cliArgs.allowDivergentBase` → `die()` with `verifyBaseDivergenceFromData(commits)`; `ok: false` → `die()` with `stderr`; `fetchFailed` → warn-already-emitted, proceed; `cliArgs.allowDivergentBase` + commits → `warn(...)` and proceed. Blocking before the merge is the point: it prevents the conflicting post-merge `git pull origin <base>` (Problem A) and matches the existing `assertLocalBaseInSyncWithOrigin` hard-block precedent. `baseBranch` resolves via `getBaseBranch(taskIds)`; `cwd` via the same accessor the rest of `shipTasks` uses. The existing inverse-direction `assertLocalBaseInSyncWithOrigin` is unchanged and still runs in its current position.

- [ ] AC-7: The data-seam function `verifyBaseDivergenceFromData` has unit tests in `tests/run-task-validation.test.ts` covering: (a) empty commits → empty string; (b) one commit → message includes that commit's sha (first 7 chars) and full subject; (c) multiple commits → message lists each on its own line in input order; (d) the message includes the literal substrings `git push origin` **and** `--allow-divergent-base` (assert by substring so future copy edits don't break the test brittle-ly).

- [ ] AC-8: The integration function `verifyBaseDivergence` has at least one test in `tests/run-task-validation.test.ts` on a real fixture repo: happy path (clean, no divergent commits → `commits: []`, `ok: true`); git-failure path (non-existent `cwd` → `ok: false`, non-empty `stderr`). Fixture pattern mirrors the existing `verifyBaseDrift` integration tests.

- [ ] AC-9: An end-to-end test in `tests/run-task-safety.test.ts` (home of the established `commitHumanReviewFiles()` subprocess harness — real-git fixture + `main()` invocation with `process.argv` set, per `docs/patterns.md` "module-level `cliArgs`" pitfall) constructs a repo with origin, commits to local base without pushing, runs the `--push` flow via subprocess, and asserts: (a) without `--allow-divergent-base`, the process exits non-zero and stderr contains both the divergent commit's sha and the literal `--allow-divergent-base`; (b) with `--allow-divergent-base`, the process emits a warning containing the sha but proceeds past this gate (it may still fail at `verifyBaseDrift` or later — assert only that this gate did not die). One subprocess test per bypass branch is sufficient.

- [ ] AC-10: After the changes land, the existing `verifyBaseDrift` tests pass without modification. When `--allow-divergent-base` bypasses the new gate at `--push`/`--pr`, `verifyBaseDrift` runs with unchanged semantics. (Verified by `npm test` passing the existing suite; no new test required for this AC.)

- [ ] AC-11: `docs/codebase-map.md` updates the existing "Base-drift gate (`--pr`/`--push`)" row in the "Pipeline Orchestration" table to: (a) rename to "Base-drift + base-divergence gates"; (b) reference both `verifyBaseDrift` and `verifyBaseDivergence` / `getUnpushedBaseCommits`; (c) note commit-divergence runs first and blocks at all of `--push`/`--pr`/`--ship`; (d) add `--ship` to the entry points.

- [ ] AC-12: `docs/pipeline-orchestrator.md` documents `--allow-divergent-base` in the flags reference: name, applicable phases (`--push`, `--pr`, `--ship` — all hard-fail), what it bypasses (the commit-divergence check only), and what it does NOT bypass (the file-allow-list gate gated by `--force`). Adds a one-line note that `--force` and `--allow-divergent-base` are independent bypasses for two distinct gates. If the doc has a §Shipping section, also note that ship now blocks on ahead-divergence (complementing the existing behind-direction block).

- [ ] AC-13: The pre-implement scaffold-commit path prints a push reminder. In `scripts/run-task/phases/implement.ts`, inside the existing `if (!worktreeAlreadyCreated)` first-implement guard (line 46, where `commitTaskArtifactsToBase` runs) — or immediately after `ensureBranch(taskIds, { force })` at line 49 still gated by `!worktreeAlreadyCreated` — emit an `info(...)` reminder that the scaffold was committed to local `<baseBranch>` and the operator should run `git push origin <baseBranch>` to avoid base drift. Requirements: (a) message includes the literal substring `git push origin` and the resolved base-branch name; (b) prints **exactly once per first-implement invocation** — i.e. once per bundle (the base branch and worktree are shared across bundled tasks, and `commitTaskArtifactsToBase`/`ensureBranch` run once for the whole `taskIds` set inside the single `!worktreeAlreadyCreated` guard), NOT once per task. Reference the shared `<baseBranch>` once; do not loop per task. On reroutes/iterations (`worktreeAlreadyCreated === true`) it must NOT print; (c) verified by a test asserting the message emits exactly once on a fresh first-implement fixture (single-task and, if the harness supports it, a 2-task bundle → still one reminder) and is absent on a `worktreeAlreadyCreated` fixture. `info` and `getBaseBranch` are already imported in this file (lines 58 and 5). Informational only — `canon run` does not push.

- [ ] AC-14: `mergeOpenPRsAndPull` in `scripts/run-task/main.ts` (line 1459) tolerates an already-deleted remote branch after a successful merge. Replace the stderr-substring tolerance (`already merged` / `used by worktree`, lines 1485–1488) with an authoritative merge-state check **keyed on the specific `prNum` that `gh pr merge` just attempted** (the value from `findOpenPRNumber` at line 1472, already in scope). Do **not** use `findMergedPRNumber(branch, baseBranch)` — it only proves *some* PR for that branch/base is merged, so a reused branch name (an older merged PR on the same branch→base) would falsely confirm the current attempt and tolerate a real merge failure (Codex spec-review finding). Add a small prNum-specific helper — e.g. `isPRMerged(prNum: number): boolean` running `gh pr view <prNum> --json state --jq .state` and testing `=== 'MERGED'` (note `getMergedPRHeadSha` is NOT a substitute — it returns a head SHA for any PR regardless of merge state). Behavior: when `gh pr merge --squash --delete-branch` exits non-zero, if `isPRMerged(prNum)` is true, emit a `warn(...)` noting the branch-delete failure was tolerated (covers GitHub auto-delete-on-merge and the existing used-by-worktree local-delete case), set `anyMerged = true`, and continue; if false, `die()` with the merge error (today's behavior). **Preserve the existing post-merge remote-ref safety net**: in the tolerated path, still run `assertOriginTaskBranchAbsent` for the affected branch's tasks (as the current `localDeleteFailed` branch does at lines 1501–1506) so a tolerated delete-failure cannot let a stale origin ref survive unchecked. Extract the die-vs-tolerate decision into a pure, testable helper (e.g. `classifyMergeOutcome({ exitOk, mergeConfirmed }): 'tolerate' | 'fail'`) with a `*FromData`-style seam; `mergeConfirmed` is produced by the prNum-specific `isPRMerged(prNum)` call, wired in `mergeOpenPRsAndPull` and code-inspected.

- [ ] AC-15: Unit tests for AC-14's pure decision helper in `tests/run-task-safety.test.ts` (or `tests/run-task-validation.test.ts`, wherever the helper lands) cover the matrix: (a) exit ok → tolerate (merge succeeded, nothing to excuse); (b) exit non-ok + mergeConfirmed true → tolerate (delete failed but merge landed); (c) exit non-ok + mergeConfirmed false → fail (real merge failure → die). The gh-dependent wiring in `mergeOpenPRsAndPull` is verified by code inspection (the full gh merge flow is impractical to fixture in a unit test).

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/git.ts` | Add `getUnpushedBaseCommits(baseBranch, cwd)` near `commitsAheadOfBase` (line ~146): `gitSafeAtRaw(cwd, 'log', 'origin/${baseBranch}..${baseBranch}', '--format=%H%x09%s')`, parse line-by-line, tab-split into `{ sha, subject }`, empty stdout → empty commits, return `{ commits, ok, stderr }`. |
| `scripts/run-task/validation.ts` | Add `verifyBaseDivergenceFromData(commits)` (uniform message, empty when commits empty) and `verifyBaseDivergence(baseBranch, cwd)` (fetch + wrapper). Place near `verifyBaseDrift` (~line 1028). Export both. `verifyBaseDrift` untouched. |
| `scripts/run-task/types.ts` | Add `allowDivergentBase: boolean` to `CliArgs` (line 118, after `force` at 129). |
| `scripts/run-task/cli.ts` | In `parseArgs`: `let allowDivergentBase = false` (line ~80); switch case `'--allow-divergent-base'` (~line 110, near `--force`); add to returned object; usage text (~line 41) — bypasses base-divergence block at push/pr/ship, distinct from `--force`. Imports `CliArgs` from `./types.js`; the field itself is added in `types.ts`. |
| `scripts/run-task/main.ts` | (1) `commitHumanReviewFiles` (902–945): `verifyBaseDivergence` before `verifyBaseDrift`, hard-fail per AC-5. (2) `shipTasks` (~1593): `verifyBaseDivergence` before `mergeOpenPRsAndPull` (1691), after `ensureCheckedOutBaseBranch` (1688), hard-fail per AC-6. (3) `mergeOpenPRsAndPull` (1459): replace stderr-substring tolerance (1485–1488) with prNum-specific merge-state tolerance per AC-14 (new `isPRMerged(prNum)` helper keyed on the attempted PR number, NOT branch-based `findMergedPRNumber`), preserving the `assertOriginTaskBranchAbsent` net. `verifyBaseDrift` and `assertLocalBaseInSyncWithOrigin` untouched. |
| `scripts/run-task/phases/implement.ts` | Add the push-reminder `info(...)` per AC-13, inside the `!worktreeAlreadyCreated` guard (lines 46–49). No new imports (`info` line 58, `getBaseBranch` line 5). |
| `tests/run-task-validation.test.ts` | Data-seam tests for `verifyBaseDivergenceFromData` (AC-7); integration tests for `verifyBaseDivergence` (AC-8). |
| `tests/run-task-safety.test.ts` | Subprocess `--push` block/bypass tests (AC-9); unit tests for the AC-14 decision helper (AC-15); the AC-13 reminder once-per-task test (or in validation.test, wherever the implement-phase harness fits). |
| `tests/run-task-cli.test.ts` | Parser shape tests updated for the new `CliArgs.allowDivergentBase` field + explicit `--allow-divergent-base` parse coverage. (Declared post-implementation: the `CliArgs` change requires updating this file's shape assertions to keep the suite green — the "a CliArgs field touches three files" coupling.) |
| `docs/pipeline-orchestrator.md` | Document `--allow-divergent-base` and the ship ahead-block per AC-12. |
| `templates/docs/pipeline-orchestrator.md` | Canon-managed derived mirror of `docs/pipeline-orchestrator.md`; regenerated and staged by the `sync-templates` pre-commit hook when the root doc changes. Declared so the `--pr` base-drift gate accepts the synced artifact. |
| `dist/scripts/run-task.js` | Regenerated bundled CLI; `docs/architecture.md` requires `dist/` regeneration when `scripts/run-task/**` changes. Build-generated artifact declared alongside its sources so the `--pr` base-drift gate accepts it. |
| `docs/codebase-map.md` | Update the base-drift gate row per AC-11. |

### Interaction Dependencies

- **`verifyBaseDrift` runs after the new gate at `--push`/`--pr`.** When the new gate fires, `verifyBaseDrift` never runs (`die()` exits). When bypassed via `--allow-divergent-base`, `verifyBaseDrift` runs normally and may still fail on file-level drift — operators who want past both pass both flags.
- **At `--ship`, the new gate runs before `mergeOpenPRsAndPull`**, so a hard-fail aborts before the irreversible merge. The existing behind-direction `assertLocalBaseInSyncWithOrigin` (cleanup mode) and the `mergeOpenPRsAndPull` merge-pull are downstream and unchanged.
- **AC-14's tolerance interacts with `assertOriginTaskBranchAbsent`.** Today, a successful-merge-but-failed-delete sets `anyMerged = true`, which skips the downstream `!merged` block that calls `assertOriginTaskBranchAbsent`. The current `used by worktree` path compensates by calling it inline; AC-14's tolerated path must do the same so the remote-ref safety net is never skipped.
- **`canon run` pre-implement scaffold commit** is the source of the drift the gate detects and the reminder warns about. Unchanged by this task.
- **Full-send mode** routes through `commitHumanReviewFiles` — the gate fires there too; full-send does not auto-pass `--allow-divergent-base`.

### Data Model Changes

`CliArgs` gains one boolean field (`allowDivergentBase`). No `status.json` schema change.

## Validation Required

- [x] **Linting** — `npm run lint`. All touched files are TS/JS in `scripts/` and `tests/`.
- [x] **Type checking** — `npm run type-check`. New `CliArgs` field; new exports must type-check across the codebase.
- [x] **Unit tests** — `npm test`. New tests per AC-7/8/9/13/15; suite must remain green.
- [ ] **Build** — N/A. Canon runs via `tsx`; no separate build artifact touched.
- [ ] **E2E** — N/A. Canon has no UI surface.
- [x] **Docs references** — `npm run docs-refs-check`. `docs/codebase-map.md` and `docs/pipeline-orchestrator.md` updates must pass the validator.

## Docs Impact

- **`docs/codebase-map.md`** — updated per AC-11.
- **`docs/pipeline-orchestrator.md`** — updated per AC-12.
- **`docs/patterns.md`** — candidate new pitfall: "decouple operation-success from cleanup-success — don't let a post-op cleanup failure (branch delete) abort/mask a successful irreversible op (merge)." QA decides during the docs-freshness sweep; not an AC.
- **`AGENTS.md`** / **`CLAUDE.md`** / **`CODEX.md`** — no edits expected; operator-facing tooling, not a workflow rule.

## Known Risks

- **Worktree cwd vs. REPO_ROOT cwd for `git log` resolution.** Worktrees share `.git`, so `git log origin/<base>..<base>` resolves the same refs from a worktree cwd as from REPO_ROOT (the gate inspects refs, not the working tree, so checkout state is irrelevant). All wired flows run with the worktree on the task branch. **Verification**: in the integration test, assert the gate yields the same `commits[]` from the worktree dir and from REPO_ROOT for the same fixture.

- **Stale remote-tracking ref.** `verifyBaseDivergence` fetches `origin/<base>` before checking, matching `verifyBaseDrift`. On fetch failure it warns and fails open (no divergence reported, operation proceeds) — a network blip must not block. At `--push`/`--pr` the two gates fetch independently; the second fetch is a fast no-op, accepted as the cost of keeping `verifyBaseDrift` untouched.

- **`--ship` blocking before merge — friction vs. safety.** Blocking ship on ahead-divergence adds a stop that didn't exist, including in cleanup-only mode against an already-merged PR. Accepted because: (a) cleanup mode already blocks on behind-divergence (`assertLocalBaseInSyncWithOrigin`), so this is consistent, not novel; (b) `--allow-divergent-base` makes it recoverable in seconds; (c) the alternative (warn-and-proceed) lets the conflicting post-merge pull strand ship half-complete, which is worse.

- **AC-14 false-tolerate risk (and the branch-reuse trap).** The tolerance must hinge on confirming the **specific attempted `prNum`** is merged (`isPRMerged(prNum)`), never on "any merged PR for this branch/base." The branch-based `findMergedPRNumber(branch, baseBranch)` would false-tolerate a genuine merge failure whenever the branch name was reused after an earlier merged PR — the exact failure Codex spec-review caught. With the prNum-specific check: if it returns false on a *genuinely* merged PR (gh transient error), AC-14 `die()`s (treats as merge-failed) — fails *safe*, reverting to today's behavior. The dangerous direction (tolerating when the merge did NOT happen) requires `isPRMerged(prNum)` to falsely report the attempted PR merged, which a state query on that exact number does not do. The preserved `assertOriginTaskBranchAbsent` call is the second layer.

- **AC-14 must not regress the `used by worktree` case.** Today, `gh pr merge --delete-branch` failing because a worktree holds the local branch is expected and tolerated. The new merge-state-based logic must still tolerate it (merge succeeded → tolerate), and must still defer local-branch deletion to teardown. Reviewer confirms the worktree-held-branch path still reaches teardown cleanly.

- **AC-13 reminder noise.** Must fire exactly once (first implement) and stay silent on reroutes/iterations, or it nags every loop. The `!worktreeAlreadyCreated` guard (implement.ts:46) is the once-per-task signal; the reminder lives inside it. Test both branches per AC-13(c).

- **Test fragility around message format.** AC-7's substring assertions (`git push origin`, `--allow-divergent-base`) are intentional — operators copy-paste these. Don't let "polish the message" change them without updating tests deliberately.

- **`delicate` classification.** This touches three delicate surfaces named in `docs/product-context.md`: validation gates (the new check), auto-commit logic (AC-13's touch on the scaffold-commit path), and worktree/ship machinery (AC-6, AC-14). False-positives are bounded (recoverable via `--allow-divergent-base`; AC-14 fails safe). The reviewer should confirm AC-13 adds no branching to `commitTaskArtifactsToBase`/`ensureBranch` (pure `info()`), and that AC-14 preserves every existing ship safety net (`assertOriginTaskBranchAbsent`, worktree-held-branch deferral).

## Human Test Plan

1. **Setup (divergent base):** create two canon tasks in a row without pushing the base branch between them — each `canon task new` + `canon run` leaves a pre-implement scaffold commit on local base.
2. Take one task to `human_review`.
3. Run `canon run <task-id> --pr` (no override flags).
4. **Expected:** canon aborts with a clear error — local base is N commits ahead of origin, each commit listed by short-sha + subject, plus two literal instructions: how to push base, and how to override (`--allow-divergent-base`).
5. Run `git push origin <base-branch>`, then re-run `canon run <task-id> --pr`.
6. **Expected:** this gate no longer fires; the PR opens (file-allow-list gate is a separate concern).
7. **Override path:** create a fresh divergent scenario; run `canon run <task-id> --pr --allow-divergent-base`.
8. **Expected:** canon warns about the divergent commits but does not abort at this gate.
9. **`--force` is not a substitute:** in a fresh divergent scenario, run `canon run <task-id> --pr --force` (no `--allow-divergent-base`).
10. **Expected:** canon still aborts at the commit-divergence gate — `--force` only bypasses the file-allow-list gate.
11. **`--ship` block:** get a task through `--pr` cleanly (push base first), PR approved/ready. Make a fresh unpushed scaffold commit on local base. Run `canon run <task-id> --ship`.
12. **Expected:** canon aborts **before** merging the PR, same error as step 4. With `--allow-divergent-base`, ship proceeds (merge + teardown).
13. **Push reminder:** create a brand-new task and run it to its first implementation; watch the output as the worktree is created.
14. **Expected:** a one-time reminder that the scaffold was committed to local base and you should `git push origin <base>`. Continue through a code-review iteration or reroute — the reminder does NOT print again.
15. **Auto-deleted branch at ship-merge:** on a repo with "automatically delete head branches" enabled, take a task to an open, approved PR. Run `canon run <task-id> --ship` so ship performs the merge.
16. **Expected:** ship merges the PR and completes teardown/archive cleanly, even though GitHub already deleted the remote branch. At most a warning about the tolerated branch-delete — no abort, no half-complete state.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names — N/A (full-tier; plan written in pipeline)
- [x] Known Risks covers failure modes for the trickiest ACs (AC-6, AC-13, AC-14)
- [x] Human Test Plan uses product language (canon CLI is the operator's product surface)
- [x] Validation Required has at least one entry marked `- [x]`
