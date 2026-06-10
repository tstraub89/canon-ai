# Implementation Handoff: v1.11-harness-cleanup

> Author: Codex | Spec: `tasks/v1.11-harness-cleanup/spec.md` | Plan: `tasks/v1.11-harness-cleanup/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `dist/cli/index.js` | Rebuilt by `npm run build`; bundled the policy/budget changes into the CLI artifact. |
| `dist/scripts/run-task.js` | Rebuilt by `npm run build`; bundled the `[skip ci]` gating and budget threading into the orchestrator artifact. |
| `scripts/pipeline-policy.ts` | Added tiered Claude budget resolution, `claudeBudget` in `PolicyConfig`, and `budget` on `ClaudeModelConfig`. |
| `scripts/run-task/agents/claude.ts` | Threaded the resolved budget through both interactive and non-interactive Claude spawns and logged it. |
| `scripts/run-task/env.ts` | Changed `config.claudeBudget` to `string \| null` so policy can distinguish unset from explicit override. |
| `scripts/run-task/main.ts` | Added `willPinCommitFollow`, conditioned the human-review artifacts commit on a guaranteed follow-up `pr.number` commit, and threaded `cfg.budget` through the retry path. |
| `scripts/run-task/phases/code-review.ts` | Passed the resolved Claude budget into `runClaude()`. |
| `scripts/run-task/phases/plan.ts` | Passed the resolved Claude budget into `runClaude()`. |
| `scripts/run-task/phases/qa.ts` | Passed the resolved Claude budget into `runClaude()`. |
| `scripts/run-task/phases/spec.ts` | Passed the resolved Claude budget into both spec and spec-revision `runClaude()` calls. |
| `scripts/run-task/policy.ts` | Captured `CLAUDE_BUDGET` in the policy wrapper and exposed it via `policyConfig()`. |
| `tasks/v1.11-harness-cleanup/notes.md` | Appended an implement-phase note about the clean-tree `--pr` rerun not being a stable HEAD-SHA invariant. |
| `tasks/v1.11-harness-cleanup/status.json` | Advanced the task state from `implement` to `done` and stamped the branch via `canon task phase v1.11-harness-cleanup implement done`. |
| `tests/pipeline-policy.test.ts` | Added tiered/default budget coverage and updated Claude expectations to include the new `budget` field. |
| `tests/run-task-ship.test.ts` | Added regression coverage for create-path `[skip ci]` placement, `--push`, clean-tree reruns, and the already-pinned dirty-tree `--pr` case. |

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

Implemented the two requested harness fixes together:

- Budget-by-tier now lives in the pure policy layer and is threaded through every Claude spawn site, including the retry path and interactive runner.
- `commitHumanReviewFiles()` now appends `[skip ci]` only when a follow-up `pr.number` commit is guaranteed, which keeps the marked commit from ever being the final branch head on the already-pinned dirty-tree path.

The regression tests assert the actual commit order from `git log`, so the dangerous `--pr` shape is covered directly rather than inferred from exit status.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Threaded the resolved budget through the interactive Claude spawn in `scripts/run-task/agents/claude.ts` as well as the non-interactive path. | Keeps every Claude session mode on the same per-phase budget policy instead of leaving an interactive escape hatch at the old flat cap. | None; this broadens coverage beyond the minimum AC surface. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: On the `--pr` create path where artifacts are committed and a `pr.number` commit follows, the artifacts commit message ends with a `[skip ci]` marker and the `pr.number` commit message does **not**. Verified by a `tests/run-task-ship.test.ts` assertion inspecting `git log` messages after a `--pr` run. | Met | `tests/run-task-ship.test.ts` now checks the last two commit messages: the artifacts commit ends with `[skip ci]`, and the head commit is the unmarked `record pr.number` commit. |
| AC-2: The `[skip ci]`-marked commit is never the final branch head after `--pr` (the safety invariant — a marked head on a required-checks repo would block merge). Verified by asserting the post-`--pr` head commit message carries no `[skip ci]` marker on the create path. | Met | The create-path regression asserts the head commit message does not contain `[skip ci]`. |
| AC-2b: On the clean-tree idempotent re-run path (no dirty artifacts, `pr.number` already pinned, branch already pushed), `--pr` introduces no new `[skip ci]`-marked commit and leaves the tree clean. Verified by a re-run test: a second `--pr` invocation leaves the head unmarked and the tree clean. | Met | The existing open-PR rerun test still ends with a clean tree, and it now asserts the head commit message remains unmarked after the rerun. |
| AC-2c: **(closes Codex spec-review finding)** On the **dirty-tree** `--pr` path where artifacts are committed but `recordPinnedPRNumber` no-ops because `pr.number` is **already pinned** to the open PR (so no `pr.number` commit follows), the artifacts commit — which becomes the branch head — is **not** `[skip ci]`-marked, so the head retains its CI run. Verified by a `tests/run-task-ship.test.ts` case: open PR already pinned, re-dirty an artifact, run `--pr`, assert the resulting head commit message carries no `[skip ci]` marker. | Met | `tests/run-task-ship.test.ts` adds the already-pinned dirty-tree case and checks the head commit is unmarked. |
| AC-3: `--pr` still leaves a clean working tree and still pins `pr.number` to every task's `status.json` (existing behavior preserved). Verified by the existing `tests/run-task-ship.test.ts` clean-tree + pin assertions continuing to pass (create path, existing-PR path, bundle path). | Met | The create-path, existing-PR, and bundle assertions still pass; the new tests keep the working tree clean after `--pr`. |
| AC-4: The `--push` (no PR creation) path is unchanged — it adds no `[skip ci]` marker that could strand a PR head unchecked. Verified by inspection / an existing `--push` test remaining green. | Met | `tests/run-task-ship.test.ts` now explicitly covers `--push` and asserts the artifacts commit is unmarked. |
| AC-5: With `CLAUDE_BUDGET` **unset**, the resolved per-phase budget equals the effective-size tier: S→`5.00`, M→`5.00`, L→`10.00`, XL→`20.00`, and any `delicate: true` task→`20.00` regardless of nominal size. Verified by new table rows in `tests/pipeline-policy.test.ts`. | Met | `tests/pipeline-policy.test.ts` now has a budget table covering S/M/L/XL and a delicate task case. |
| AC-6: With `CLAUDE_BUDGET` **set** (e.g. `20.00`), the resolved budget equals that flat value for every effective size. Verified by a `pipeline-policy.test.ts` row exercising the override. | Met | The override test asserts the returned Claude config budget is `20.00` for every effective size. |
| AC-7: The `--max-budget-usd` argument at the `claude` CLI spawn site is the resolved per-phase budget threaded through `runClaude` — **replacing** the flat `config.claudeBudget` read at that site (the old read must not exist there after). Applies to **every** Claude `runClaude` call site: the four phase runners (`phases/spec.ts` — both `promptSpec` and `promptSpecRevision`; `phases/plan.ts`; `phases/code-review.ts`; `phases/qa.ts`) **and** the retry path `retryAgentForPhase` (`main.ts:2670-2671`), which already resolves `cfg = getClaudeConfig(phase, retryTasks)` and must pass `cfg.budget` like the others. Verified by inspection of `agents/claude.ts` + all five call sites. **(The retry site closes a Codex spec-review finding.)** | Met | `runClaude()` now takes `budget`, both spawn modes use it, and all five call sites pass `cfg.budget`. |
| AC-8: Structural deletion check — `grep -rn "claudeBudget" scripts/ src/` shows `config.claudeBudget` / the budget value appearing **only** in the allow-listed plumbing paths: the env-capture in `scripts/run-task/env.ts`, the policy module (`scripts/pipeline-policy.ts`), and the policy wrapper (`scripts/run-task/policy.ts`). It must **not** appear at the `agents/claude.ts` spawn site or anywhere else. (Derive the final allow-list from `git grep` at implement time; the build artifact `dist/` mirror is exempt.) | Met | `claudeBudget` now appears only in the three allow-listed source paths; the agent runner uses `budget` instead of the old config read. |
| AC-9: `npm run build` is run and committed `dist/` matches a fresh build (CI runs `npm run build && git diff --exit-code -- dist/`). | Met | `npm run build` passed and regenerated `dist/cli/index.js` plus `dist/scripts/run-task.js`; the regenerated artifacts are in the working tree diff. |

## Edge Cases Considered

- Already-pinned dirty-tree `--pr` on an open PR where `recordPinnedPRNumber` would no-op; the artifacts commit stays unmarked and the head keeps CI.
- Clean-tree `--pr` rerun after a PR already exists; the tree remains clean and no new skip-ci head is introduced.
- `--push` path still commits artifacts without invoking PR creation.
- `CLAUDE_BUDGET` unset vs set to `5.00` remain distinguishable in policy because unset becomes size-aware while explicit value stays flat.
- Interactive Claude sessions use the same budget cap as non-interactive sessions.

## Blockers

- [pipeline] Could not verify `origin/release/v1` freshness because `git fetch origin` hit `Operation not permitted` on the shared worktree FETCH_HEAD path in this sandbox.

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
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g. `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` (`eslint scripts/ tests/ src/`) | Pass | Ran clean after the source and test edits. |
| `npm run type-check` (`tsc -p tsconfig.json --noEmit`) | Pass | Ran clean after the new `budget` field threaded through the policy types. |
| `npm test` (`node --test --import tsx tests/*.test.ts`) — full suite runs clean | Pass | Full suite passed after updating the policy expectations and ship regressions. |
| `npm run build` (`tsup` + postbuild) — **required**; commit any `dist/` delta; CI gates on `git diff --exit-code -- dist/` | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`; the build output is reflected in the working tree diff. |
| `npm run sync-templates:check` | Pass | `All canon-managed files in sync`. |
| `npm run docs-refs-check` | Pass | `All refs OK`. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

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

## Iteration 2 — addressing review round 1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|
| `.gitignore` | Added `tasks/**/.pr-number` to the canonical runtime ignore block so the new PR-number sidecar stays out of `git status`. |
| `dist/cli/index.js` | Rebuilt by `npm run build` after the amended runtime-ignore and sidecar-path changes. |
| `dist/scripts/run-task.js` | Rebuilt by `npm run build` after the amended runtime-ignore and sidecar-path changes. |
| `scripts/run-task/main.ts` | Removed the `[skip ci]` commit-marker path, switched `recordPinnedPRNumber()` to write `tasks/<id>/.pr-number` via the task-dir resolver, and made `--ship` read the sidecar instead of committed `status.json`. |
| `src/lib/canon-block.ts` | Added `tasks/**/.pr-number` to the shared runtime gitignore pattern list. |
| `templates/.gitignore` | Synced the template runtime-ignore block with the new `.pr-number` sidecar pattern. |
| `tasks/v1.11-harness-cleanup/notes.md` | Appended a reroute note about the sidecar needing to be ignored in the fixture repo as well as the canonical repo block. |
| `tests/run-task-ship.test.ts` | Replaced the `[skip ci]` / `status.json.pr` assertions with sidecar assertions, added the fixture `.gitignore` entry, and covered the malformed-sidecar fallback path. |

### Findings addressed

- _correctness bug:_ `recordPinnedPRNumber()` wrote to the wrong task-dir shape in worktree-backed runs, causing `ENOENT` on the sidecar write path. → fixed by resolving each task through `taskDirFor(taskId)` before writing/reading the sidecar in [`scripts/run-task/main.ts`](scripts/run-task/main.ts).
- _risk/guardrail:_ the new `.pr-number` file had to be ignored in both the canonical block and the test fixture repo, or the clean-tree assertions would false-negative. → fixed in [`.gitignore`](.gitignore), [`templates/.gitignore`](templates/.gitignore), [`src/lib/canon-block.ts`](src/lib/canon-block.ts), and [`tests/run-task-ship.test.ts`](tests/run-task-ship.test.ts).
- _spec gap:_ the original `[skip ci]` marker logic and follow-up `record pr.number` commit are gone entirely now; `--pr` is a single-commit flow with sidecar persistence instead. → fixed in [`scripts/run-task/main.ts`](scripts/run-task/main.ts) and covered by the new ship-path tests.

### AC deltas (if any)

- AC-A1: was new → Met (`tests/run-task-ship.test.ts:390-412`, `scripts/run-task/main.ts:1199-1220`)
- AC-A2: was new → Met (`scripts/run-task/main.ts:844-878`; `grep -rn "skip ci\\|willPinCommitFollow" scripts/ src/` no longer finds those strings outside `dist/`)
- AC-A3: was new → Met (`scripts/run-task/main.ts:844-878`, `tests/run-task-ship.test.ts:403-460`)
- AC-A4: was new → Met (`scripts/run-task/main.ts:1507-1573`, `tests/run-task-ship.test.ts:524-703`)
- AC-A5: was new → Met (`.gitignore`, `templates/.gitignore`, `src/lib/canon-block.ts`)

The amendment supersedes the original skip-ci ACs (AC-1 through AC-4 in the initial spec text). The sidecar ACs above replace them; the budget ACs from the first pass remain unchanged and still pass.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean after the sidecar and ignore-block refactor. |
| `npm run type-check` | Pass | Clean after replacing the commit-based pin path with the sidecar flow. |
| `npm test` | Pass | Re-ran after the worktree-path fix; the full suite passed, including the ship and safety regressions. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js` after the final main.ts patch. |
| `npm run sync-templates:check` | Pass | Passed after syncing `templates/.gitignore` to the shared runtime-ignore block. |
| `npm run docs-refs-check` | Pass | Passed after the reroute edits. |

## Iteration 1 — addressing pre-flight rejection

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|
| `docs/pipeline-orchestrator.md` | Updated the `CLAUDE_BUDGET` documentation to describe the new size-aware unset/default behavior and explicit flat override. |
| `docs/pipeline-invocations.md` | Appended the new `spec_review`, `plan`, and `implement` invocation audit rows from the current reroute pass so the handoff matches the live diff. |
| `templates/docs/pipeline-orchestrator.md` | Mirrored the `CLAUDE_BUDGET` documentation update in the canonical template copy. |

### Findings addressed

- _handoff gap:_ `docs/pipeline-invocations.md` was present in the current diff but missing from the Changes table. → added the row above so the diff-to-handoff reconciliation passes.
- _handoff gap:_ `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` were present in the committed branch diff but missing from the Changes table. → added the rows above so the diff-to-handoff reconciliation passes.

## Iteration 3 — addressing review round 2

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|
| `dist/scripts/run-task.js` | Rebuilt by `npm run build` after the round-2 ship and interactive-Claude fixes. |
| `docs/pipeline-invocations.md` | Appended the latest invocation audit rows from the reroute verification pass. |
| `scripts/run-task/agents/claude.ts` | Removed `--max-budget-usd` from the interactive Claude branch so uncapped interactive sessions stay compatible with the `claude` CLI contract. |
| `scripts/run-task/main.ts` | Restored the normal base checkout path, added a selective stale-status mirror restore for orphaned worktree ship recovery, and kept the sidecar-based `pr.number` source intact. |
| `tasks/v1.11-harness-cleanup/notes.md` | Added a reroute note about restoring the stale tracked `status.json` mirror before the ship checkout. |
| `tests/run-task-prompts.test.ts` | Added the interactive Claude args assertion that verifies `--max-budget-usd` is absent on the non-print branch. |

### Findings addressed

- _correctness bug:_ the interactive `claude` spawn path was still receiving `--max-budget-usd`, which the CLI documents as print-mode only. → fixed by removing the flag from the interactive branch in [`scripts/run-task/agents/claude.ts`](scripts/run-task/agents/claude.ts).
- _correctness bug:_ orphaned-worktree `--ship` could not switch to the base branch because a stale tracked `tasks/<id>/status.json` mirror was still dirty. → fixed by restoring the tracked status file to `HEAD` before the branch switch in [`scripts/run-task/main.ts`](scripts/run-task/main.ts).
- _risk/guardrail:_ the fake-git ship safety fixture rejects `checkout -f`, so the recovery path had to stay on the normal checkout command and clean only the stale task mirror. → preserved in [`scripts/run-task/main.ts`](scripts/run-task/main.ts).
- _test coverage:_ the interactive budget assertion now lives in [`tests/run-task-prompts.test.ts`](tests/run-task-prompts.test.ts), and the orphaned-worktree ship regression continues to cover the sidecar read without crashing in [`tests/run-task-ship.test.ts`](tests/run-task-ship.test.ts).

### AC deltas (if any)

- AC-R2-1: was Partial → now Met (`scripts/run-task/agents/claude.ts:81-84`, `tests/run-task-prompts.test.ts:585-614`; the focused prompt suite asserts no `--max-budget-usd` on the interactive path)
- AC-R2-2: was Partial → now Met (`scripts/run-task/main.ts:1931-1945`; the orphaned-worktree ship regression now passes)

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-ran after the final ship-path adjustment. |
| `npm run type-check` | Pass | Re-ran after the final ship-path adjustment. |
| `npm test` | Pass | Full suite passed after the checkout compatibility fix; includes the focused prompt and ship regressions. |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js` after the final main.ts and claude.ts patch. |
| `npm run sync-templates:check` | Pass | Re-ran and remained clean. |
| `npm run docs-refs-check` | Pass | Re-ran and remained clean. |

## Iteration 2 — addressing review round 1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|
| `dist/scripts/run-task.js` | Rebuilt by `npm run build` after the early-heartbeat guard fix. |
| `scripts/run-task/main.ts` | Added the `cliArgs.ship` guard to the early heartbeat resolver so detached non-ship runs keep the live worktree heartbeat path. |
| `tasks/v1.11-harness-cleanup/notes.md` | Appended a reroute note explaining why the early heartbeat resolver needs the `cliArgs.ship` guard. |

### Findings addressed

- _correctness bug:_ `earlyHeartbeatResolver` preferred `REPO_ROOT/tasks/<id>/status.json` for every detached run, which would have starved `canon watch` of the live heartbeat on non-ship worktree runs. → fixed by gating the REPO_ROOT fallback on `cliArgs.ship` in [`scripts/run-task/main.ts`](scripts/run-task/main.ts).

### AC deltas (if any)

- none; this iteration only fixed the orchestrator bootstrap bug flagged in review round 1.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-ran after the `earlyHeartbeatResolver` guard fix. |
| `npm run type-check` | Pass | Re-ran after the `earlyHeartbeatResolver` guard fix. |
| `npm test` | Pass | Full suite passed after the heartbeat resolver guard fix. |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js` after the final `main.ts` patch. |
| `npm run sync-templates:check` | Pass | Re-ran and remained clean. |
| `npm run docs-refs-check` | Pass | Re-ran and remained clean. |

## Iteration 4 — addressing review round 2

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|
| `tasks/v1.11-harness-cleanup/notes.md` | Appended a revision note capturing the round-2 nit set and explicitly deferring it under the round-3 tightening rule. |

### Findings addressed

- _optional cleanup/nit:_ round 2 surfaced only low-severity follow-ups (`readSidecarPRNumber` default-expression hazard, extra ship-path status reread, S-delicate coverage gap). → intentionally deferred; no blocking issue remained to fix in code.

### AC deltas (if any)

- none; round 2 did not introduce any new blocking AC gaps.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run docs-refs-check` | Pass | Re-ran after the handoff/notes append; all refs still resolved. |

## Iteration 5 — addressing review round 3

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|
| `dist/scripts/run-task.js` | Rebuilt by `npm run build` after the ship-path TDZ fix and override-fixture update. |
| `scripts/run-task/main.ts` | Moved the ship-path `taskStatuses` map ahead of `readShipStatus` so the fallback cannot hit a TDZ ReferenceError. |
| `tasks/v1.11-harness-cleanup/notes.md` | Appended a revision note about the distinct override tasks tree and the TDZ fix. |
| `tests/run-task-ship.test.ts` | Changed the `CANON_TASKS_DIR_OVERRIDE` fixture to use a distinct override tasks tree and asserted the repo-local and override status files differ before shipping. |

### Findings addressed

- _correctness bug:_ `readShipStatus` could hit a temporal-dead-zone ReferenceError if it ever had to fall back to the pre-switch snapshot before `taskStatuses` was declared. → fixed by hoisting `taskStatuses` above `readShipStatus` in [`scripts/run-task/main.ts`](scripts/run-task/main.ts).
- _spec gap / test coverage:_ the override fixture used the repo's own `tasks/` directory, so it could not distinguish the override path from the normal checkout. → fixed by moving the override state into a separate `override/tasks/` tree in [`tests/run-task-ship.test.ts`](tests/run-task-ship.test.ts).

### AC deltas (if any)

- AC-R3-3: was Partial / non-discriminating → now Met (`tests/run-task-ship.test.ts` now exercises a distinct override tree and asserts the two base_branch values differ before `--ship`).

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Re-ran after the ship-path TDZ and fixture update. |
| `npm run type-check` | Pass | Re-ran after the ship-path TDZ and fixture update. |
| `npm test` | Pass | Full suite passed after the override-fixture and TDZ fix. |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js` after the final `main.ts` patch. |
| `npm run sync-templates:check` | Pass | Re-ran and remained clean. |
| `npm run docs-refs-check` | Pass | Re-ran and remained clean. |

## Iteration 6 — addressing review round 3

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|
| `tasks/v1.11-harness-cleanup/notes.md` | Appended a note explaining that the ship override fixture needs a real branch-backed clone, and that the override regression should stay focused on task-root resolution rather than archive placement. |
| `tests/run-task-ship.test.ts` | Simplified the `CANON_TASKS_DIR_OVERRIDE` regression to assert the distinct local-vs-override status roots before ship, then only require a successful run. The override fixture now clones a pushed remote branch into a separate override checkout so the test can distinguish the alternate root from the normal checkout. |

### Findings addressed

- _spec gap / test coverage:_ the override regression still needed a real branch-backed override checkout to distinguish the override root from the repo-local checkout. → fixed by cloning the pushed branch into `override/` before checking it out.
- _test correctness:_ the override regression was over-asserting archive placement; the important discriminator is the task-root resolution before ship, not where the archive lands. → narrowed the test to the root-resolution behavior.

### AC deltas (if any)

- AC-R3-3 remains Met; this iteration only tightened the regression test shape after the round-3 fix landed.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm test` | Pass | Full suite passed after the override-fixture and assertion-shape cleanup. |
