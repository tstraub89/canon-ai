# Code Review: v1.11-harness-cleanup

> Reviewer: Claude (synthesis foreman — anchored + cold lenses) | Round: 1 (post-Amendment implementation)
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (post-Amendment implementation). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

**Result: Pass**

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All six checks Pass (Iteration 2 re-run): `npm run lint`, `npm run type-check`, `npm test`, `npm run build`, `npm run sync-templates:check`, `npm run docs-refs-check`.

### Acceptance Criteria Check

Note: The Amendment superseded AC-1 through AC-4 (`[skip ci]` marker approach). The binding Fix A ACs are AC-A1 through AC-A5 (sidecar approach). AC-5 through AC-9 (Fix B + build) are unchanged.

| AC | Status | Notes |
|---|---|---|
| AC-A1: `--pr` produces exactly one pushed commit (artifacts commit = HEAD; no `record pr.number` commit) | Met | `recordPinnedPRNumber` writes sidecar only — no stage/commit/push (`main.ts:844-852`). `run-task-ship.test.ts:410-411` asserts HEAD is the artifacts commit and no `record pr.number` commit exists in `git log`. |
| AC-A2: No `[skip ci]` in any commit produced by `--pr`; `willPinCommitFollow` does not exist | Met | `grep -rn "skip ci\|willPinCommitFollow" scripts/ src/` returns empty. Confirmed by anchored lens. |
| AC-A3: `--pr` writes `tasks/<id>/.pr-number` sidecar; `pr.number` absent from committed `status.json`; tree clean after | Met | `recordPinnedPRNumber` writes sidecar via `sidecarPathFor(taskId)` (`main.ts:844-852`). Tests at `run-task-ship.test.ts:406-409` assert sidecar populated, `status.pr === undefined`, and `git status --porcelain` empty. |
| AC-A4: `--ship` reads `pr.number` from sidecar first, falls back to branch-lookup when absent | Met | `readSidecarPRNumber` called in `resolveProofPRNumberForPrefetch` and `establishMergeProof` (`main.ts:1507-1527`). `run-task-ship.test.ts:602-616` covers the legacy fallback path (no sidecar → branch-lookup). |
| AC-A5: `.gitignore` includes `tasks/**/.pr-number` | Met | Added in `.gitignore:26`, `templates/.gitignore:6`, and `src/lib/canon-block.ts:8`. Fixture `.gitignore` in test file also includes it. |
| AC-5: `CLAUDE_BUDGET` unset → tiered budget (S→`5.00`, M→`5.00`, L→`10.00`, XL→`20.00`, delicate→`20.00`) | Met | `BUDGET_TABLE` in `pipeline-policy.test.ts:98-111` covers S, M, L, XL, and M-delicate (effective XL → `20.00`). Verified via `p.claude('spec').budget` and `p.claude('qa').budget`. |
| AC-6: `CLAUDE_BUDGET` set → flat cap for every effective size | Met | `pipeline-policy.test.ts:114-121` sets `claudeBudget: '20.00'` and iterates all effective sizes, asserting `'20.00'` for both `spec` and `code_review`. |
| AC-7: `--max-budget-usd` at every `runClaude` call site uses resolved budget from `cfg.budget` (not flat `config.claudeBudget`) | Met | All six call sites updated: `phases/spec.ts` (both `promptSpec` and `promptSpecRevision`), `phases/plan.ts`, `phases/code-review.ts`, `phases/qa.ts`, and `retryAgentForPhase` in `main.ts:2648`. `agents/claude.ts` imports only `REPO_ROOT` from `env.js` — `config` import removed. Both interactive and non-interactive paths use the `budget` param. |
| AC-8: `claudeBudget` appears only in `scripts/run-task/env.ts`, `scripts/pipeline-policy.ts`, `scripts/run-task/policy.ts` | Met | `grep -rn "claudeBudget" scripts/ src/` shows only those three files. Absent from `agents/claude.ts`. |
| AC-9: `npm run build` committed; `dist/` matches fresh build | Met | `dist/cli/index.js` and `dist/scripts/run-task.js` rebuilt and present in the diff. Handoff Iteration 2 confirms `npm run build` Pass. |

### Dropped Sections Check

- [x] Non-goals respected — `process.exit`-on-failure blast-radius untouched; `--ship` merge-evidence/ancestry proof logic unchanged (only *source* of pinned PR number changed from `status.json` to sidecar); CI config unchanged
- [x] Known Risks addressed (Amendment) — sidecar absent before `--ship` degrades gracefully to branch-lookup (pre-1.11 behavior); anti-branch-reuse pin preserved (sidecar still pins `pr.number` to the specific PR, just stored locally)
- [x] Human Test Plan satisfiable — three manual steps (budget tiers on L/XL task, flat override, single CI run on `--pr`) verifiable against a live task and real GitHub

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

---

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean implementation of both fixes. The sidecar approach (Amendment) is a net code reduction vs. the original `[skip ci]` design — removes the double-push race at the root rather than masking it. Budget-by-tier is correctly layered in the pure policy module using the same effective-size bucketing as the model/effort matrix. No correctness bugs found by either lens.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

1. **risk/guardrail** — `scripts/run-task/agents/claude.ts:83` — Interactive Claude spawns (`--interactive` / human-in-the-driver's-seat mode) previously had no `--max-budget-usd`. This diff adds it, capping interactive sessions at the tier budget (e.g. `$5` for S/M tasks). Handoff documents this as a deliberate deviation: "keeps every Claude session mode on the same per-phase budget policy instead of leaving an interactive escape hatch at the old flat cap." Operators using interactive mode for extended debugging on S/M tasks may hit the cap unexpectedly. Not a blocker; the rationale is sound and the handoff records it. *(Cold lens only.)*

#### Optional Cleanup / Nit

1. **optional cleanup/nit** — `scripts/run-task/main.ts:844-845` — `alreadyPinned` uses `every()` as an all-or-nothing gate: if any task in the bundle is not yet pinned, all sidecars are (re-)written. In a partially-pinned bundle the already-correct sidecars are overwritten with the same value — idempotent and safe, but the semantics read strangely. A per-task skip inside the write loop would be more precise. *(Flagged by both lenses.)*

2. **optional cleanup/nit** — `scripts/run-task/main.ts` (`shipTasks` prefetch loop) — `activeCwd` is computed before the `prNum === null` early-return check. If `resolveProofPRNumberForPrefetch` returns null (or the prNum is already cached), `activeCwd` was computed and discarded. One extra `getActiveCwd` call; no correctness impact. *(Anchored lens only.)*

3. **optional cleanup/nit** — `scripts/run-task/env.ts` — `config.claudeBudget` captures `CLAUDE_BUDGET ?? null` but is no longer consumed by any caller (`agents/claude.ts` dropped the `config` import; the budget is now threaded via `pipeline-policy.ts` → `policy.ts` → `runClaude` parameter). The field sits in the AC-8 allow-list location but is vestigial. Can be removed on a future cleanup pass. *(Cold lens only.)*

4. **optional cleanup/nit** — `tests/pipeline-policy.test.ts` — AC-5 says "any `delicate: true` task → `20.00` regardless of nominal size." The `BUDGET_TABLE` covers M-delicate but not S-delicate explicitly. The code path is identical (effective-size XL → `20.00`) and the routing table covers S-delicate having effective=XL, so the behavior is transitively verified. A dedicated S-delicate budget row would make AC-5 coverage self-contained. *(Anchored lens only.)*

5. **optional cleanup/nit** — `tests/run-task-ship.test.ts` — No `worktree: true` fixture scenario for sidecar path resolution. The handoff records that a `ENOENT` worktree-path bug was caught and fixed (Iteration 2 finding: "recordPinnedPRNumber wrote to the wrong task-dir shape in worktree-backed runs"). The fix routes through `taskDirFor(taskId)` and is correct per inspection, but there is no test that exercises the worktree-backed sidecar write/read path. A regression here would go undetected. *(Cold lens only.)*

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **Dismissed (cold)**: Sidecar lost on ephemeral CI runner — spec-intended. The Amendment explicitly states "Worktree loss before `--ship` degrades gracefully to branch-lookup" and the `readSidecarPRNumber` → `findOpenPRNumber`/`findMergedPRNumber` fallback in `resolveProofPRNumberForPrefetch` implements this. The pre-1.11 behavior is preserved when the sidecar is absent.
- **Dismissed (cold)**: Non-atomic check-then-act in `recordPinnedPRNumber` — concurrent `--pr` races produce idempotent sidecar writes; the lens itself states "not a real bug in practice." Low-confidence finding dismissed.
- **Dismissed (cold)**: `budget` positional parameter maintainability footgun — TypeScript enforces type safety at the call sites (metricsContext is an object, budget is a string). All six callers were correctly updated. Architectural concern only.
- **Dismissed (cold)**: Interactive budget cap is a behavioral change — confirmed intentional deviation documented in handoff with rationale; AC-7 covers "the `claude` CLI spawn site" without distinguishing interactive vs non-interactive.

---

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Needs re-review** — significant changes expected; re-review (both stages) after iteration
- [ ] **Spec gap** — root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N-1's response to round N-1

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->

---

## Round 1 (post-reroute, verifying Iteration 3 — Amendment Round 2 implementation)

> This section covers the first code review of the rerouted implementation. The prior `## Stage 1` / `## Stage 2` sections above document the pre-reroute review cycle (approved_with_nits on the Amendment Round 1 implementation). Round 2 amendment added AC-R2-1 and AC-R2-2; this section reviews their implementation in Iteration 3.

### Stage 1 — Acceptance Criteria Re-Check

All ACs verified fresh against the current code.

| AC | Status | Notes |
|---|---|---|
| AC-A1: `--pr` produces exactly one pushed commit (no `record pr.number` commit) | Met (unchanged from prior round) | `recordPinnedPRNumber` writes sidecar only — no stage/commit/push. `run-task-ship.test.ts:410-411` asserts HEAD is artifacts commit and no `record pr.number` commit exists in `git log`. |
| AC-A2: No `[skip ci]` in commits; `willPinCommitFollow` does not exist | Met (unchanged) | `grep -rn "skip ci\|willPinCommitFollow" scripts/ src/` returns empty. |
| AC-A3: `.pr-number` sidecar written; `pr.number` absent from committed `status.json`; clean tree after | Met (unchanged) | `run-task-ship.test.ts:406-409` asserts sidecar contains PR number, `status.pr === undefined`, and `git status --porcelain` empty. |
| AC-A4: `--ship` reads sidecar first, falls back to branch-lookup when absent | Met (unchanged) | `readSidecarPRNumber` called in `resolveProofPRNumberForPrefetch` and `establishMergeProof` with explicit worktree-tolerant taskDir. Fallback path covered by `run-task-ship.test.ts:602-616`. |
| AC-A5: `.gitignore` includes `tasks/**/.pr-number` | Met (unchanged) | `.gitignore:26`, `templates/.gitignore`, `src/lib/canon-block.ts:8`. Fixture gitignore in test also includes it. |
| AC-5: `CLAUDE_BUDGET` unset → tiered budget (S/M→`5.00`, L→`10.00`, XL/delicate→`20.00`) | Met (unchanged) | `BUDGET_BY_SIZE` in `pipeline-policy.ts:66-72`; `resolveBudget` at line 89. `pipeline-policy.test.ts` covers S, M, L, XL, and M-delicate. |
| AC-6: `CLAUDE_BUDGET` set → flat cap for all effective sizes | Met (unchanged) | `resolveBudget` returns `claudeBudget` when non-null. `pipeline-policy.test.ts` exercises override. |
| AC-7: `--max-budget-usd` at every `runClaude` call site uses `cfg.budget` | Met (unchanged) | All five call sites updated: `phases/spec.ts` (both), `phases/plan.ts`, `phases/code-review.ts`, `phases/qa.ts`, `retryAgentForPhase` (`main.ts:2685`). `config` import removed from `agents/claude.ts`. |
| AC-8: `claudeBudget` only in allow-listed plumbing paths | Met (unchanged) | `grep -rn "claudeBudget" scripts/ src/` shows only `env.ts`, `pipeline-policy.ts`, `policy.ts`. |
| AC-9: `npm run build` committed; `dist/` matches fresh build | Met | Iteration 3 rebuilt `dist/scripts/run-task.js`; `npm run build` Pass in Iteration 3 validation. |
| AC-R2-1: `--max-budget-usd` only on print-mode path; interactive branch excludes it | Met | `agents/claude.ts:85-88` interactive branch builds args without `--max-budget-usd`. Non-interactive at line 113 includes it. `tests/run-task-prompts.test.ts:588-614` asserts interactive args contain no `--max-budget-usd`. |
| AC-R2-2: `--ship` sidecar read tolerates missing worktree | Met | `resolveShipCwd` (`main.ts:1815-1818`) checks for worktree status.json existence; returns `REPO_ROOT` when gone. Sidecar read uses explicit `path.join(taskCwd, 'tasks', taskId)`. `readSidecarPRNumber` catches ENOENT and falls back. Orphaned-worktree test in `run-task-ship.test.ts:713-733` confirms no crash. |

**Validation gate**: Iteration 3 validation outcomes all Pass. No `Fail` results. All spec-required checks run.

**Dropped sections check**: Non-goals respected. Known Risks addressed. Human Test Plan satisfiable.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

---

### Stage 2 — New findings (Iteration 3 changes only)

#### Correctness Bugs

1. **correctness bug** — `scripts/run-task/main.ts:2989-2991` (`earlyHeartbeatResolver` lacks `--ship` guard) — **Cold lens only; verified by foreman.** The new resolver prefers `REPO_ROOT/tasks/<id>/` whenever `REPO_ROOT/tasks/<id>/status.json` exists — which is true for every scaffolded task, not only orphaned worktree tasks. For `--ship` on orphaned worktrees the preference is correct: `statusFileFor` would call `resolveTaskCwd`, which reads REPO_ROOT's `status.json`, sees `worktree: true`, fails to find the worktree directory, and **dies** (`state.ts:97-101`). For non-ship pipeline runs on live worktree tasks, the worktree exists so `statusFileFor` would not die — but `REPO_ROOT/tasks/<id>/status.json` always exists post-scaffolding, so the REPO_ROOT branch fires anyway, writing the heartbeat to `REPO_ROOT/tasks/<id>/` instead of the worktree. Since `heartbeatStarted = true` after the early boot (`main.ts:2995`), the main-loop heartbeat at line 3083-3086 is unconditionally skipped — the REPO_ROOT heartbeat is the only heartbeat for the entire CANON_DETACHED run. `canon watch` uses `heartbeatDirResolver = (id) => path.dirname(statusFileFor(id))` = worktree path (`main.ts:3030`); it won't find the heartbeat at the worktree path, so it reports the pipeline as dead even though it's running. The `checkDeps` change at `main.ts:2912-2915` correctly guards the same REPO_ROOT preference with `cliArgs.ship &&`; the heartbeat resolver is missing that guard. Fix: add `cliArgs.ship &&` before the REPO_ROOT existence test in `earlyHeartbeatResolver`, or replace with a try/catch around `statusFileFor` that falls back to REPO_ROOT only when `statusFileFor` throws.

#### Risk / Guardrails

(none beyond the above)

#### Optional Cleanup / Nits

1. **optional cleanup/nit** — `scripts/run-task/main.ts:1909-1910` — `readShipBranchName(taskId)` internally calls `readShipStatus(taskId)`, which the caller at line 1909 also just called. The snapshot-building loop double-reads `status.json` per task. No correctness issue; nit flagged by both lenses.

2. **optional cleanup/nit** — `scripts/run-task/main.ts:1934-1939` — The orphaned-status restore (git checkout HEAD -- tasks/<id>/status.json) runs AFTER `readShipStatus` has already computed the phase-gate and snapshot values. The restore is needed to clean dirty tracked files before the branch switch; the pre-restore read is from the live REPO_ROOT copy. In practice the REPO_ROOT copy shouldn't have local modifications for an orphaned task (no in-flight commits after the task completed), but the sequencing is worth noting. Both lenses flagged; low severity.

3. **optional cleanup/nit** — `tests/pipeline-policy.test.ts` — AC-5 requires S-delicate tasks to produce `20.00` budget (effective size XL). The test covers M-delicate but not S-delicate explicitly. The code path is identical. Anchored lens only.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **Dismissed (cold)**: "`return` after `shipTasks` is dead code" — `shipTasks` does NOT unconditionally call `process.exit`. On success it returns normally; without the `return`, execution would fall through to `if (cliArgs.reroute)`, full-send, and the phase loop against already-archived tasks. The `return` is necessary.
- **Dismissed (cold)**: "sidecar written to worktree, read from REPO_ROOT on orphaned ship" — spec-intended degradation. The Amendment explicitly states "Worktree loss before `--ship` degrades gracefully to branch-lookup"; `readSidecarPRNumber` returns null → `findMergedPRNumber` fallback. Correct behavior.
- **Dismissed (cold)**: "budget param `dead code` on interactive path" — documented deliberate deviation in handoff; the `budget` param is kept for type-consistency across call sites while the interactive branch correctly omits `--max-budget-usd`.
- **Dismissed (cold)**: "non-atomic check-then-act in `recordPinnedPRNumber`" — idempotent sidecar write; self-assessed "not real in practice" by the lens.
- **Dismissed (cold)**: "`checkDeps` reads REPO_ROOT for worktree tasks on `--ship`" — existence check only; phase validation happens in `shipTasks` via `readShipStatus`. Not a phase-routing concern.
- **Dismissed (cold)**: "heartbeat consistency between early and main resolvers" — partially; the specific finding about `earlyHeartbeatResolver` missing the `--ship` guard is kept as correctness bug #1 above after foreman verification.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] **Changes requested** — correctness bug #1 (`earlyHeartbeatResolver` missing `cliArgs.ship` guard) must be fixed before shipping.
- [ ] Needs re-review
- [ ] Spec gap

---

## Round 2 (verifying Iteration 3 earlyHeartbeatResolver fix)

> Both lenses re-run from scratch. This section covers Round 2.

### Stage 1 — Acceptance Criteria Re-Check

All ACs verified fresh against the current code.

| AC | Status | Notes |
|---|---|---|
| AC-A1: `--pr` produces exactly one pushed commit (no `record pr.number` commit) | Met (unchanged) | `recordPinnedPRNumber` writes sidecar only — no stage/commit/push. `run-task-ship.test.ts:410-411` asserts HEAD is artifacts commit and no `record pr.number` in `git log`. |
| AC-A2: No `[skip ci]` in commits; `willPinCommitFollow` does not exist | Met (unchanged) | `grep -rn "skip ci\|willPinCommitFollow" scripts/ src/` returns empty. |
| AC-A3: `.pr-number` sidecar written; `pr.number` absent from committed `status.json`; clean tree after `--pr` | Met (unchanged) | `run-task-ship.test.ts:406-409` asserts sidecar contains PR number, `status.pr === undefined`, and `git status --porcelain` empty. |
| AC-A4: `--ship` reads sidecar first, falls back to branch-lookup when absent | Met (unchanged) | `readSidecarPRNumber` called in `resolveProofPRNumberForPrefetch` (main.ts:1525) and `establishMergeProof` (main.ts:1573), both with explicit worktree-tolerant `path.join(taskCwd, 'tasks', taskId)`. Fallback to branch-lookup at lines 1527/1609+. `run-task-ship.test.ts:602-616` covers the absent-sidecar path. |
| AC-A5: `.gitignore` includes `tasks/**/.pr-number` | Met (unchanged) | `.gitignore:26` in canon-managed block; `templates/.gitignore` mirrored; `src/lib/canon-block.ts` registered. |
| AC-5: `CLAUDE_BUDGET` unset → tiered budget (S/M→`5.00`, L→`10.00`, XL/delicate→`20.00`) | Met (unchanged) | `BUDGET_BY_SIZE` at `pipeline-policy.ts:69-74`; `resolveBudget` at line 89. `pipeline-policy.test.ts:98-112` covers S, M, L, XL, M-delicate. |
| AC-6: `CLAUDE_BUDGET` set → flat cap for all effective sizes | Met (unchanged) | `resolveBudget` returns `claudeBudget` when non-null. `pipeline-policy.test.ts:114-121` exercises override. |
| AC-7: `--max-budget-usd` at every `runClaude` call site uses `cfg.budget` (four phase runners + `retryAgentForPhase`) | Met (unchanged) | `retryAgentForPhase` at `main.ts:2685` passes `cfg.budget`. All four phase runners updated. `config.claudeBudget` read removed from `agents/claude.ts`. |
| AC-8: `claudeBudget` only in allow-listed plumbing paths | Met (unchanged) | `grep -rn "claudeBudget" scripts/ src/` shows only `env.ts`, `pipeline-policy.ts`, `policy.ts`. |
| AC-9: `npm run build` committed; `dist/` matches fresh build | Met (unchanged) | Iteration 3 validation: `npm run build` Pass; `dist/scripts/run-task.js` rebuilt. |
| AC-R2-1: `--max-budget-usd` only on print-mode path; interactive branch excludes it | Met (unchanged) | `agents/claude.ts:85-88` interactive args: `['--model', model, '--effort', effort, '--add-dir', REPO_ROOT]` — no `--max-budget-usd`. Non-interactive at line 113 includes it. `tests/run-task-prompts.test.ts:588-614` asserts absence on interactive path. |
| AC-R2-2: `--ship` sidecar read tolerates missing worktree | Met (unchanged) | `resolveShipCwd` (`main.ts:1815-1818`) returns `REPO_ROOT` when worktree `status.json` is absent. Both sidecar-read call sites receive worktree-tolerant `taskCwd`. `readSidecarPRNumber` catches ENOENT and returns null. Orphaned-worktree test at `run-task-ship.test.ts:713-733` passes. |

**Primary verification — Round 1 correctness bug**: `earlyHeartbeatResolver` at `main.ts:2989-2994` now reads:
```
cliArgs.ship && fs.existsSync(repoRootStatusFile) ? repoRootStatusFile : splitState.statusFileFor(id)
```
The `cliArgs.ship &&` guard correctly limits REPO_ROOT preference to `--ship` invocations only, matching the analogous guard in `checkDeps` (`main.ts:2909-2915`). For non-ship CANON_DETACHED pipeline runs on live worktree tasks, `statusFileFor(id)` is used (correct — worktree path). The heartbeat and `canon watch` heartbeatDirResolver are now consistent on non-ship paths.

**Validation gate**: Iteration 3 validation outcomes all Pass. No `Fail` results. All spec-required checks run.

**Dropped sections check**: Non-goals respected. Known Risks addressed. Human Test Plan satisfiable.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

---

### Stage 2 — New findings (Iteration 3 fix only)

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nits

1. **optional cleanup/nit** — `scripts/run-task/main.ts:1507` — `readSidecarPRNumber`'s second parameter has a default expression `taskDirFor(taskId)` that evaluates at call time, outside the function's `try` block. `recordPinnedPRNumber` at line 849 calls `readSidecarPRNumber(taskId)` without an explicit `taskDir`; if `taskDirFor` called `resolveTaskCwd` on an orphaned task, the `die()` would propagate unhandled rather than being caught as an ENOENT. Not a live bug — `recordPinnedPRNumber` only runs on the `--pr` path where the worktree is present — but the default is a latent hazard if a future caller adds an orphaned-task path. **Both lenses concur.** Low severity.

2. **optional cleanup/nit** — `scripts/run-task/main.ts:1815-1818` — `resolveShipCwd` conflates two responsibilities: locating the live task state and providing the worktree-tolerance mechanism for all downstream sidecar reads. A brief comment clarifying that this function also serves as the worktree-tolerance gate for `--ship` would prevent a future reader from treating it as purely "where is the cwd." Anchored lens only. Low severity.

3. **optional cleanup/nit** — `tests/pipeline-policy.test.ts:98-112` — AC-5 requires "any `delicate: true` task → `20.00` regardless of nominal size." The test covers M-delicate (effective XL) but not S-delicate. The code path is identical; no correctness risk. **Carried from Round 1; still present.** Anchored lens.

4. **optional cleanup/nit** — `scripts/run-task/main.ts:1909-1910` — `readShipBranchName(taskId)` internally calls `readShipStatus(taskId)`, which the snapshot loop already called at line 1909. Double-read per task. No correctness impact. **Carried from Round 1; still present.** Both lenses.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- **Dismissed**: "consistency gap — `earlyHeartbeatResolver` prefers REPO_ROOT for `--ship` while `resolveShipCwd` prefers worktree for live tasks" — intentional design, mirroring the `checkDeps` guard pattern introduced in the prior iteration. `--ship` is a short operation rarely monitored via `canon watch`; the worktree is torn down by the operation anyway. Spec-intended.
- **Dismissed**: "consistency gap — `checkDeps` reads REPO_ROOT stub for live-worktree `--ship` tasks" — pre-existing pattern not introduced by Iteration 3.
- **Dismissed**: "empty `taskIds` defense at `main.ts:1840`" — pre-existing code, not in Iteration 3 diff.
- **Dismissed**: "orphaned-status cleanup discards REPO_ROOT uncommitted edits before merge proof" — spec-intended; handoff describes this as "stale tracked `status.json` mirror restore before ship checkout." Out-of-scope scenario.
- **Dismissed**: "`ClaudeMatrixConfig` vs `ClaudeModelConfig` type split" — intentional internal structure; no bug.
- **Dismissed**: "budget `string` param has no runtime assertion" — TypeScript enforces non-nullable type; no spec requirement for defensive assertion. Low confidence.
- **Dismissed**: "test integrity — orphaned-worktree fixture may revert `worktree: true` via cleanup before proof runs" — anchored lens independently verified AC-R2-2 as Met; snapshot is pre-computed before the orphaned-status cleanup runs, so the `taskCwd` passed to the sidecar-read call sites is the REPO_ROOT path regardless of any subsequent tracked-file restore.

### Verdict for Round 2

- [ ] Approved
- [x] **Approved with nits** — all 12 ACs Met; no correctness bugs remain. Round 1 correctness bug confirmed fixed. Four surviving nits (nits 1–4 above) are non-blocking.
- [ ] Changes requested
- [ ] Needs re-review
- [ ] Spec gap

---

## Round 3 (verifying Amendment Round 3 implementation — AC-R3-1 through AC-R3-4)

> Both lenses re-run from scratch. This section covers the first code review of the Amendment Round 3 implementation (pipeline-invocations.md: implement 2026-06-10T02:08:25, 51.8s).

### Stage 1 — Acceptance Criteria Re-Check

All prior ACs (A1–A5, R2-1, R2-2, 5–9) are verified unchanged from Round 2. Only the new Amendment Round 3 ACs are re-proved below alongside a full table for completeness.

| AC | Status | Notes |
|---|---|---|
| AC-A1: `--pr` produces exactly one pushed commit | Met (unchanged from Round 2) | `recordPinnedPRNumber` writes sidecar only. Test at `run-task-ship.test.ts:410-411` asserts HEAD is artifacts commit; no `record pr.number` in `git log`. |
| AC-A2: No `[skip ci]` in commits; `willPinCommitFollow` absent | Met (unchanged) | `grep -rn "skip ci\|willPinCommitFollow" scripts/ src/` returns empty. |
| AC-A3: `.pr-number` sidecar written; `status.pr` absent from committed state; clean tree | Met (unchanged) | `run-task-ship.test.ts:406-409`. |
| AC-A4: `--ship` reads sidecar first, falls back to branch-lookup | Met (unchanged) | `readSidecarPRNumber` called in `resolveProofPRNumberForPrefetch` and `establishMergeProof`. |
| AC-A5: `.gitignore` includes `tasks/**/.pr-number` | Met (unchanged) | `.gitignore:26`, `templates/.gitignore`, `src/lib/canon-block.ts`. |
| AC-5: `CLAUDE_BUDGET` unset → tiered budget | Met (unchanged) | `pipeline-policy.ts:69-74`; tested in `pipeline-policy.test.ts:98-112`. |
| AC-6: `CLAUDE_BUDGET` set → flat cap | Met (unchanged) | `resolveBudget` returns `claudeBudget` when non-null; tested. |
| AC-7: `--max-budget-usd` at all `runClaude` call sites uses `cfg.budget` | Met (unchanged) | All five call sites; `config` import removed from `agents/claude.ts`. |
| AC-8: `claudeBudget` only in allow-listed plumbing paths | Met (unchanged) | `grep` confirms only `env.ts`, `pipeline-policy.ts`, `policy.ts`. |
| AC-9: `npm run build` committed; `dist/` matches fresh build | Met (unchanged) | `dist/scripts/run-task.js` rebuilt. |
| AC-R2-1: `--max-budget-usd` only on print-mode path | Met (unchanged) | `agents/claude.ts:85-88` interactive branch excludes it; `run-task-prompts.test.ts:588-614`. |
| AC-R2-2: `--ship` sidecar read tolerates missing worktree | Met (unchanged) | `resolveShipCwd` returns REPO_ROOT when worktree absent; `run-task-ship.test.ts:713-733`. |
| **AC-R3-1**: Every `shipTasks` cwd resolution routes through `getActiveCwd([taskId], { tolerateMissingWorktree: true })`; no `fs.existsSync`-on-`worktreePath` approximation remains | **Not Met** | `resolveShipCwd` at `scripts/run-task/main.ts:1815-1817` (confirmed via compiled `dist/scripts/run-task.js`) still uses `const worktreeStatus = path.join(worktreePath(taskId), 'tasks', taskId, 'status.json'); return fs.existsSync(worktreeStatus) ? worktreePath(taskId) : REPO_ROOT`. This bypasses (1) `findExistingWorktreeForBranch` (the branch-based worktree lookup bundle secondaries depend on) and (2) `CANON_TASKS_DIR_OVERRIDE`. The spec requires delegation to `getActiveCwd([taskId], { tolerateMissingWorktree: true })` — directly or via a thin delegating wrapper. **Flagged by both lenses.** |
| **AC-R3-2**: Bundle-secondary `--ship` resolution test: secondary task's reads resolve to shared worktree, not REPO_ROOT | **Not Met** | No such test in `tests/run-task-ship.test.ts`. `grep` for "bundle-secondary" and "CANON_TASKS_DIR_OVERRIDE" in ship test file returns empty. **Flagged by both lenses.** |
| **AC-R3-3**: `CANON_TASKS_DIR_OVERRIDE` honored on ship path; test confirms reads resolve under override dir | **Not Met** | No such test in `tests/run-task-ship.test.ts`. The implementation itself does not honor `CANON_TASKS_DIR_OVERRIDE` in `resolveShipCwd` (only `tasksRootForGate` uses it, not the cwd resolver). **Flagged by both lenses.** |
| **AC-R3-4**: Orphaned-worktree `--ship` reads sidecar or falls back without crashing (AC-R2-2 preserved) | Partial | Orphaned-worktree test at `run-task-ship.test.ts:713-733` still passes: `resolveShipCwd` returns REPO_ROOT, sidecar is read from REPO_ROOT path, no crash. However, the correctness guarantee is structural (the approximation happens to work for non-bundle single-task orphaned cases) rather than architectural — it depends on the same `fs.existsSync` approximation that AC-R3-1 prohibits. Partial credit; AC-R3-4 cannot be marked fully Met until AC-R3-1's shared-resolver delegation is in place. |

**Stage 1 result: FAIL** — AC-R3-1, AC-R3-2, and AC-R3-3 are not met. The Amendment Round 3 ACs are absent from the handoff's AC Coverage table, and no "Iteration 4" section exists — the 51.8-second implement on 2026-06-10 did not implement them.

**Dropped sections check**: Non-goals and Human Test Plan unchanged and satisfiable; Known Risks unchanged.

### Stage 2 — Not run — Stage 1 failed

---

### Findings

#### Correctness Bugs — Stage 1

1. **correctness bug** — `scripts/run-task/main.ts:1815-1817` (`resolveShipCwd` approximation) — AC-R3-1 explicitly prohibits `fs.existsSync`-on-`worktreePath` and requires `getActiveCwd([taskId], { tolerateMissingWorktree: true })`. The current implementation checks `worktreePath(taskId)` (always `<WORKTREES_ROOT>/<taskId>`). For bundle secondary tasks, the worktree directory is named after the **primary** task, not the secondary — so `worktreePath(secondary)` is always absent, and `resolveShipCwd(secondary)` always returns `REPO_ROOT`. All six downstream call sites (`readShipStatus`, `readShipBranchName`, `resolveProofPRNumberForPrefetch`, `materializePRHead` prefetch, `establishMergeProof`, cleanup `readShipStatus`) will silently read stale REPO_ROOT state and the wrong sidecar path for any bundle secondary task. **Flagged by both lenses; high confidence.**

2. **correctness bug** — `tests/run-task-ship.test.ts` — Missing bundle-secondary resolution test (AC-R3-2). The bundle ship bug class described in finding #1 has zero test coverage. The existing bundle ship tests (`--ship bundle proof is all-or-nothing`) run both tasks in the same local directory without a worktree, so `resolveShipCwd` never exercises the branch-based secondary-task path.

3. **correctness bug** — `scripts/run-task/main.ts:1815-1817` and `tests/run-task-ship.test.ts` — `CANON_TASKS_DIR_OVERRIDE` not honored in `resolveShipCwd` (AC-R3-3). The override is consumed in `tasksRootForGate` (line 1873) but the cwd resolver ignores it. Test also absent. Ship-path status reads and sidecar reads bypass the override, breaking the test-harness override guarantee for any project using `CANON_TASKS_DIR_OVERRIDE`.

### Dismissed Cold Findings

- **Dismissed (cold)**: `checkDeps` prefers REPO_ROOT stub for all ship runs — this is an existence-only check before `shipTasks` runs; it does not affect phase routing. Cascade of the AC-R3-1 core issue, not independent.
- **Dismissed (cold)**: `earlyHeartbeatResolver` consistency concern — confirmed fixed in Round 1's correctness bug fix (the `cliArgs.ship &&` guard is present). Verified unchanged.
- **Dismissed (cold)**: `return` after `shipTasks` is correct behavior — fall-through to reroute/full-send loop post-ship would have been a bug. Dismissed.
- **Dismissed (cold)**: Sidecar optimization bypassed for secondary tasks — cascade of finding #1 (AC-R3-1 fix will also fix this).
- **Dismissed (cold)**: `orphanedStatusPaths` condition false-matches bundle secondaries — cascade of finding #1; the condition `resolveShipCwd(taskId) === REPO_ROOT` will correctly narrow to orphaned tasks once `resolveShipCwd` uses the shared resolver.

### Verdict for Round 3

- [ ] Approved
- [ ] Approved with nits
- [x] **Changes requested** — three correctness bugs (AC-R3-1: `resolveShipCwd` approximation; AC-R3-2: missing bundle-secondary test; AC-R3-3: `CANON_TASKS_DIR_OVERRIDE` not honored + missing test). All are required by the spec. No optional nits added per round-3+ constraint.
- [ ] Needs re-review
- [ ] Spec gap

---

## Round 4 (re-review after iteration addressing Round 3 findings)

> Both lenses re-run from scratch. This section covers the re-review of the 126.1s implement at 2026-06-10T02:19:34.

### Stage 1 — Acceptance Criteria Re-Check

All prior ACs verified unchanged from Round 3 — only the Round 3 findings need fresh proof.

| AC | Status | Notes |
|---|---|---|
| AC-A1 through AC-A5 | Met (unchanged from Round 3) | Sidecar mechanism, gitignore, single commit — no regression. |
| AC-R2-1, AC-R2-2 | Met (unchanged from Round 3) | Interactive flag absent; orphaned-worktree test still at `run-task-ship.test.ts:713-733`. |
| AC-5 through AC-9 | Met (unchanged from Round 3) | Budget tier, override, call sites, structural check, build. |
| **AC-R3-1**: Every `shipTasks` cwd resolution routes through `getActiveCwd([taskId], { tolerateMissingWorktree: true })`; no `fs.existsSync`-on-`worktreePath` approximation | **Not Met** | `resolveShipCwd` at `scripts/run-task/main.ts:1815-1817` is unchanged from Round 3: `const worktreeStatus = path.join(splitWorktree.worktreePath(taskId), 'tasks', taskId, 'status.json'); return fs.existsSync(worktreeStatus) ? worktreePath(taskId) : REPO_ROOT`. `getActiveCwd` is not called. **Flagged by both lenses.** |
| **AC-R3-2**: Bundle-secondary `--ship` resolution test | **Not Met** | `tests/run-task-ship.test.ts` ends at line 756 with no bundle-secondary worktree resolution test. Confirmed by both lenses. |
| **AC-R3-3**: `CANON_TASKS_DIR_OVERRIDE` honored on ship path + test | **Not Met** | `resolveShipCwd` has no reference to `CANON_TASKS_DIR_OVERRIDE`. No test added. Both lenses confirm. |
| **AC-R3-4**: Orphaned-worktree behavior preserved | Met (unchanged) | Orphaned-worktree test at `run-task-ship.test.ts:713-733` still passes. |

**Handoff gap**: No "Iteration 4" section exists in `tasks/v1.11-harness-cleanup/handoff.md`. The AC Coverage table does not list AC-R3-1 through AC-R3-4. The 126.1s implement ran but left the handoff without a cumulative record of this round's findings or their resolution.

**Stage 1 result: FAIL** — AC-R3-1, AC-R3-2, and AC-R3-3 remain unmet, identical to Round 3. No changes were made to `resolveShipCwd` or the ship-path tests.

### Stage 2 — Not run — Stage 1 failed

---

### Findings (Round 3 bugs — all unchanged)

1. **correctness bug** — `scripts/run-task/main.ts:1815-1817` — AC-R3-1: `resolveShipCwd` uses `fs.existsSync(worktreePath(taskId)/tasks/<id>/status.json)` approximation. For bundle secondary task B, `worktreePath('B')` = `<WORKTREES_ROOT>/B/` which does not exist (worktree is named after the primary); `resolveShipCwd('B')` always returns `REPO_ROOT`. All six downstream call sites (phase gate, status reads, sidecar reads, merge proof) silently use stale REPO_ROOT state for secondary tasks. The fix requires delegation to `getActiveCwd([taskId], { tolerateMissingWorktree: true })` which uses the branch-based worktree lookup to find the primary's worktree for secondary tasks. **Flagged by both lenses; high confidence.**

2. **correctness bug** — `tests/run-task-ship.test.ts` — AC-R3-2: No bundle-secondary worktree resolution test. The bundle ship bug described above has zero test coverage. Existing bundle tests set `worktree: false`, so `resolveShipCwd` never exercises the branch-based lookup path.

3. **correctness bug** — `scripts/run-task/main.ts:1815-1817` and `tests/run-task-ship.test.ts` — AC-R3-3: `CANON_TASKS_DIR_OVERRIDE` is not honored in `resolveShipCwd` (only in `tasksRootForGate` at line ~1873, after cwd resolution). No test covering the override on the ship path. Both lenses confirm.

### Dismissed Cold Findings

All cold findings are corroborations of the three code-bugs above (same root cause: `resolveShipCwd` approximation). No independent dismissed findings.

### Verdict for Round 4

- [ ] Approved
- [ ] Approved with nits
- [x] **Changes requested** — same three correctness bugs as Round 3 (AC-R3-1, AC-R3-2, AC-R3-3). The 126.1s implement did not address them. Handoff is also missing the Iteration 4 section per the cumulative-record requirement. Per round-3+ constraint: correctness bugs only, no nits.
- [ ] Needs re-review
- [ ] Spec gap

---

## Round 5 (re-review after 2332.2s implement at 2026-06-10T03:26:00)

> Both lenses re-run from scratch. This section covers the review of the third implement pass in the current reroute loop (pipeline-invocations.md: implement iter 2, 2332.2s). The 2332.2s pass replaced `resolveShipCwd` with a new implementation and added two new test fixtures (lines 814 and 840 of `tests/run-task-ship.test.ts`).

### Stage 1 — Acceptance Criteria Re-Check

Prior ACs (A1–A5, R2-1, R2-2, 5–9) verified unchanged from Round 4 by anchored lens. Amendment Round 3 ACs:

| AC | Status | Notes |
|---|---|---|
| AC-A1 through AC-A5 | Met (unchanged) | Sidecar, gitignore, single-commit, ship sidecar read, clean tree — no regression. |
| AC-R2-1, AC-R2-2 | Met (unchanged) | Interactive flag absent; orphaned-worktree test at `run-task-ship.test.ts:713-733`. |
| AC-5 through AC-9 | Met (unchanged) | Budget tiers, override, all five `runClaude` call sites, structural deletion, build. |
| **AC-R3-1**: Every `shipTasks` cwd resolution routes through `getActiveCwd([taskId], { tolerateMissingWorktree: true })`; no `fs.existsSync`-on-`worktreePath` approximation | **Met** | Old `fs.existsSync(worktreePath(taskId)/tasks/<id>/status.json)` approximation is gone. `resolveShipCwd` now uses `isOrphanedWorktreeState(taskId)` + `taskDirFor(taskId)`. `taskDirFor` routes through `resolveTaskCwd` → `findExistingWorktreeForBranch` — the same branch-based lookup `getActiveCwd` uses — and has its own `CANON_TASKS_DIR_OVERRIDE` fast-path. `isOrphanedWorktreeState` handles the tolerate-missing-worktree case (returns REPO_ROOT when branch has no live worktree). Combined, this is the "thin delegating wrapper" the spec permits. For bundle secondary B: `resolveTaskCwd('B')` reads branch `task/A` from REPO_ROOT status, calls `findExistingWorktreeForBranch('task/A')`, returns the primary's worktree — correct. Verified by anchored lens inspection + AC-R3-2 test discriminating mechanism. |
| **AC-R3-2**: Bundle-secondary `--ship` resolution test: secondary reads resolve to shared worktree, not REPO_ROOT | **Met** | Test at `tests/run-task-ship.test.ts:814-838`. `prepareSharedWorktreeShipFixture` sets `secondaryRepoStatus.base_branch = 'release/v1'` in `localDir` but `secondaryWorktreeStatus.base_branch = 'main'` in the shared worktree. If `resolveShipCwd(secondary)` returned REPO_ROOT, `readShipStatus` would read `base_branch = 'release/v1'`, the bundle mismatch die fires, and `result.status !== 0` — test fails. Provides clear discriminating coverage that secondary status reads route to the shared worktree. |
| **AC-R3-3**: `CANON_TASKS_DIR_OVERRIDE` honored on ship path; test confirms reads resolve under override directory | **Not Met — test non-discriminating** | Test exists at `tests/run-task-ship.test.ts:840-863` (both lenses agree). However: `prepareShipOverrideFixture` sets `tasksRoot = path.join(localDir, 'tasks')` — the repository's own tasks directory. `CANON_TASKS_DIR_OVERRIDE = tasksRoot` therefore points to the same location the normal (non-override) path uses. Removing the `CANON_TASKS_DIR_OVERRIDE` branch from `resolveShipCwd` entirely does not cause this test to fail, because `taskDirFor` (which the fallback path calls) already handles the override via its own fast-path and would produce the identical result. The test has zero discriminating power for the AC it claims to cover. The spec requires "a test... asserts ship-state reads resolve under the override directory" — this test cannot detect an override-path regression. **Flagged by both lenses.** |
| **AC-R3-4**: Orphaned-worktree behavior preserved | Met (unchanged) | `isOrphanedWorktreeState` returns `true` when branch has no live worktree; `resolveShipCwd` returns `REPO_ROOT`. Orphaned-worktree test at `run-task-ship.test.ts:713-733` still passes. |

**Validation table gap**: Handoff "Iteration 4" (the most recent section) only ran `docs-refs-check`. The 2332.2s implement changed `scripts/run-task/main.ts` (new `resolveShipCwd`, `isOrphanedWorktreeState`) and `tests/run-task-ship.test.ts` (two new fixtures + two new tests). The required checks `npm run lint`, `npm run type-check`, `npm test`, and `npm run build` are not documented as having been re-run for these changes. No Iteration 5 section exists in the handoff for the 2332.2s changes. The anchored lens cannot verify the current code tree passes all validations from the handoff record alone.

**Stage 1 result: Partial** — AC-R3-1 and AC-R3-2 are now Met. AC-R3-3 is still not met due to a non-discriminating test. Validation table incomplete for 2332.2s changes.

**Dropped sections check**: Non-goals, Known Risks, and Human Test Plan are unchanged and satisfiable. No dropped sections.

### Stage 2 — Findings

#### Correctness Bugs

1. **correctness bug** — `scripts/run-task/main.ts` (`readShipStatus`, ~line 1837) — **TDZ ReferenceError on missing-status.json path.** `readShipStatus` is a closure defined at line ~1827 and references `taskStatuses` (declared `const` at line ~1924). `readShipStatus` is called in the early `baseBranches` loop (line ~1847) before `taskStatuses` is declared. In JavaScript, `const` is in the temporal dead zone from function entry until the declaration — if any call to `readShipStatus` before line 1924 reaches the `taskStatuses.get(taskId)` branch (all three `candidates[]` fail to find `status.json`), the process throws `ReferenceError: Cannot access 'taskStatuses' before initialization` instead of a meaningful error. In normal operation `status.json` always exists so the TDZ branch is never reached; but the code structure is wrong and produces an opaque crash if status.json is ever missing. Fix: move `const taskStatuses = new Map()` before the first `readShipStatus` call. **Flagged by cold lens; confirmed by foreman.**

2. **correctness bug** — `tests/run-task-ship.test.ts:840-863` — **AC-R3-3 test has no discriminating power.** The `CANON_TASKS_DIR_OVERRIDE` fixture sets the override to `path.join(localDir, 'tasks')` — the repo's actual tasks directory. `resolveShipCwd` with the override returns `path.dirname(tasksRoot) = localDir`. Without the override branch, `taskDirFor` (called in the fallback) also returns `CANON_TASKS_DIR_OVERRIDE + '/taskId'`, producing `path.dirname(path.dirname(...)) = localDir`. Both paths give the same result for this fixture. Deleting the `CANON_TASKS_DIR_OVERRIDE` branch from `resolveShipCwd` entirely would not cause this test to fail. To have discriminating power, the fixture must place status.json at a distinct override path that the non-override resolution would NOT find. **Flagged by both lenses; high confidence.**

### Dismissed Cold Findings

- **Dismissed (cold)**: `candidates[1]` in `readShipStatus` (`path.join(taskCwd, taskId, 'status.json')` missing `tasks/` segment) is dead code — never matches a real file. Nit; filtered per round-3+ constraint.
- **Dismissed (cold)**: `env.ts` `config.claudeBudget = null` is a no-op since nothing reads `config.claudeBudget` for budget purposes — the live path goes through `policy.ts`. Nit; filtered.
- **Dismissed (cold)**: `policy.ts` duplicates the env-var resolution block from `env.ts`. Nit; filtered.

### Verdict for Round 5

- [ ] Approved
- [ ] Approved with nits
- [x] **Changes requested** — two correctness bugs remain: (1) TDZ ReferenceError in `readShipStatus` when `taskStatuses` is referenced before its `const` declaration; (2) AC-R3-3 test at `tests/run-task-ship.test.ts:840-863` has no discriminating power (override points to same directory as non-override path). Per round-3+ constraint: correctness bugs only.
- [ ] Needs re-review
- [ ] Spec gap

---

## Round 6 (re-review after 1088.4s implement at 2026-06-10)

> Both lenses re-run from scratch. This section covers the review of the fourth implement pass in the current reroute loop (pipeline iter 3). The 1088.4s pass addressed both Round 5 correctness bugs: (1) TDZ fix — `taskStatuses` hoisted to line 1827, before `readShipStatus` at 1828; (2) AC-R3-3 test made discriminating — `prepareShipOverrideFixture` now creates a real git clone in `dir/override/` with a distinct `overrideStatus.base_branch = 'main'`, while `localDir` retains `repoStatus.base_branch = 'release/v1'`. Pre-assertions at lines 854-855 verify the two trees diverge before the ship run.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-A1 through AC-A5 | Met (unchanged) | Sidecar, gitignore, single-commit, ship sidecar read, clean tree — no regression. |
| AC-R2-1, AC-R2-2 | Met (unchanged) | Interactive flag absent; orphaned-worktree test unchanged. |
| AC-5 through AC-9 | Met (unchanged) | Budget tiers, override, all five `runClaude` call sites, structural deletion, build. |
| **AC-R3-1** | **Met** | Unchanged from Round 5 — `resolveShipCwd` uses `isOrphanedWorktreeState(taskId)` + `taskDirFor(taskId)` (branch-based lookup). No `fs.existsSync`-on-`worktreePath` approximation. |
| **AC-R3-2** | **Met** | Unchanged from Round 5 — bundle-secondary test at `run-task-ship.test.ts:819-843` discriminates via `base_branch` mismatch die. |
| **AC-R3-3** | **Met** | `prepareShipOverrideFixture` now clones `originDir` into `overrideDir = dir/override`, checks out the task branch, and writes `overrideStatus.base_branch = 'main'` to `overrideDir/tasks/<id>/status.json` (NOT pushed). `localDir` retains `base_branch = 'release/v1'`. `tasksRoot = path.join(overrideDir, 'tasks')` — a distinct path from `localDir/tasks`. Pre-assertions at lines 854-855 verify both trees have different `base_branch` values. `--ship` runs with `CANON_TASKS_DIR_OVERRIDE = tasksRoot` and fake-PR `FAKE_GH_PR_BASE = 'main'`. If the override is ignored at any level (both `resolveShipCwd`'s explicit branch AND `taskDirFor`'s fast-path), `readShipStatus` returns `base_branch = 'release/v1'`, which diverges from the PR's base ref → merge proof fails → non-zero exit → test fails. The test is now genuinely discriminating. |
| **AC-R3-4** | **Met (unchanged)** | `isOrphanedWorktreeState` + orphaned test unchanged. |

**Validation coverage**: Iteration 5 ran all six checks (lint, type-check, test, build, sync-templates:check, docs-refs-check) — all Pass. Iteration 6's delta was test-file-only (fixture clone approach + assertion shape refinement); `npm test` Pass is sufficient. Full validation coverage confirmed across the cumulative record.

**Dropped sections**: Non-goals, Known Risks, and Human Test Plan unchanged and satisfiable.

**Stage 1 result: Pass**

### Stage 2 — Findings

#### Dismissed Cold Findings (foreman adjudication)

The cold lens raised six findings. Per round-4+ synthesis discipline (only `correctness bug` and `spec gap` drive verdict):

- **Dismissed (cold #1/#5 — archive cross-tree)**: When `CANON_TASKS_DIR_OVERRIDE` is set, `archiveDir` computes from the static `TASKS_DIR` constant (override-unaware), while `taskDirForRepoRoot` honors the override — the `fs.renameSync` crosses trees. Real observation, but (a) the archive code was not changed by this task; (b) the spec scope for AC-R3-3 is "reads resolve under override directory" — the archive is a post-proof write not specified by any Amendment Round 3 AC; (c) the rename succeeds in all same-filesystem deployments. Classify as out-of-scope pre-existing behavior, not a spec gap introduced by this task.
- **Dismissed (cold #2 — stale snapshot fallback)**: Theoretical path (all three `readShipStatus` candidates miss) not reachable under normal ship preconditions. Low-confidence finding. Filtered.
- **Dismissed (cold #3 — test asserts only exit-0)**: Addressed above — AC-R3-3 test is discriminating via exit code (wrong cwd → `base_branch` mismatch → non-zero exit). Exit-0 is sufficient proof given the merge-proof mechanism.
- **Dismissed (cold #4 — PATH mutation in run-task-prompts.test.ts)**: Pre-existing code in a different test file not modified by this task. Out of scope.
- **Dismissed (cold #6 — duplicate candidate)**: `candidates[0]` and `candidates[2]` coincide when override is set. Redundant I/O. Nit; filtered per round-4+ constraint.

No `correctness bug` or `spec gap` findings survive adjudication.

### Verdict for Round 6

- [x] **Approved**
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review
- [ ] Spec gap
