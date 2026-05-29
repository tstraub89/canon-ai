# Code Review: base-divergence-gate

> Reviewer: Claude | Spec: `tasks/base-divergence-gate/spec.md`

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, unit tests, docs-refs-check)
- [x] No required checks were skipped without justification (Build and E2E flagged N/A per spec; `sync-templates:check` added per project policy)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `getUnpushedBaseCommits` in `git.ts` | Pass | `scripts/run-task/git.ts:153–173`. Calls `gitSafeAtRaw(cwd, 'log', origin/<base>..<base>, '--format=%H%x09%s')`, tab-splits, returns `{ commits, ok, stderr }`. Mirrors `getTreeDriftFiles` shape. |
| AC-2: `verifyBaseDivergenceFromData` | Pass | `validation.ts:1098–1109`. Empty → `''`. Header names N commits and collision-when-pulled framing; one indented `short-sha  subject` line per commit; literal `Fix: git push origin <base>` and `Override: rerun with --allow-divergent-base ...` lines. Exact format pinned in tests. |
| AC-3: `verifyBaseDivergence` four-field result | Pass | `validation.ts:1111–1132`. Fetch via `gitSafeAt`; existing-cwd fetch failure warns + `{ commits: [], ok: true, stderr: '', fetchFailed: true }` (fail-open); helper failure → `{ ..., ok: false, fetchFailed: false }`; happy path → `fetchFailed: false`. |
| AC-4: `CliArgs.allowDivergentBase` + parser + usage | Pass | `types.ts:130` adds field; `cli.ts:86,119–121,139` parse + default + return; usage text at `cli.ts:45–49` documents bypass at `--push`/`--pr`/`--ship` and notes independence from `--force`. |
| AC-5: `commitHumanReviewFiles` runs divergence before drift | Pass | `main.ts:912–924` invokes `verifyBaseDivergence` immediately before the unchanged `verifyBaseDrift` call at line 926. Hard-fail, fetch-fail-open, and bypass-warn branches all wired. **`verifyBaseDrift` body is byte-identical** (only the import line gained `getUnpushedBaseCommits`) — confirmed via `git diff release/v1.6.1 -- scripts/run-task/validation.ts`. |
| AC-6: `shipTasks` runs divergence before merge | Pass | `main.ts:1705–1716` runs the gate after `ensureCheckedOutBaseBranch` (1703) and before `mergeOpenPRsAndPull` (1719). Same hard-block semantics as AC-5. `assertLocalBaseInSyncWithOrigin` remains in its downstream cleanup-only position. |
| AC-7: data-seam tests for `verifyBaseDivergenceFromData` | Pass | `tests/run-task-validation.test.ts:1500–1535`. Covers empty → `''`, single-commit exact-format assertion (including short-sha truncation to 7 chars and full subject), multi-commit ordering on separate lines, and literal-substring assertions for `git push origin` and `--allow-divergent-base`. |
| AC-8: integration tests for `verifyBaseDivergence` | Pass | `tests/run-task-validation.test.ts:1537–1578`. Clean repo → empty `ok` result; non-existent cwd → `ok: false`, non-empty stderr; bonus worktree-vs-repo-root parity test confirms the worktree concern in spec §Known Risks. |
| AC-9: subprocess `--push` block + bypass | Pass | `tests/run-task-safety.test.ts:2119–2169`. Block test asserts non-zero exit, stderr contains the divergent commit's short sha, `--allow-divergent-base` literal, and `Base divergence detected`. Bypass test asserts override message in combined output, sha present, and divergence-error absent. |
| AC-10: existing `verifyBaseDrift` tests still pass | Pass | Full `npm test` reported 613 tests, 612 pass, 1 skipped; existing base-drift suite passed without modification. |
| AC-11: `docs/codebase-map.md` row update | Pass | `docs/codebase-map.md:49`. Row renamed to "Base-drift + base-divergence gates (`--push`/`--pr`/`--ship`)"; references both helpers; notes commit divergence runs first; entry points expanded to all three. |
| AC-12: `docs/pipeline-orchestrator.md` flag docs | Pass | Lines 38, 238, 240, 335, 339. Flag table entry, body text (divergence before drift), independence note, ship-order step (1), and ship-guardrail paragraph all present. Note: ship has no separate §Shipping H2, but the changes land in the existing "Shipping" subsection (lines 335/339). |
| AC-13: scaffold push reminder | Pass | `scripts/run-task/phases/implement.ts:46–53`. Sits inside `!worktreeAlreadyCreated`; single `info(...)` call using `getBaseBranch(taskIds)` once for the whole bundle (no per-task loop); message includes literal `git push origin` and resolved base. Test in `tests/run-task-safety.test.ts:1168` (line 1240 specifically) asserts exactly one occurrence on first implement, then a second invocation with `worktreeAlreadyCreated: true` asserts the reminder does NOT print. |
| AC-14: `mergeOpenPRsAndPull` tolerance via `isPRMerged(prNum)` | Pass | `main.ts:1485–1532`. Replaces stderr-substring tolerance with `classifyMergeOutcome({ exitOk, mergeConfirmed: result.ok ? true : isPRMerged(prNum) })`. `isPRMerged` (main.ts:1397–1401) uses `gh pr view <prNum> --json state --jq .state` keyed on the **attempted** prNum (not branch-based — Codex spec-review finding observed). Tolerated path emits warn, sets `anyMerged = true`, **and still runs `assertOriginTaskBranchAbsent`** for affected tasks (1516–1521), preserving the post-merge remote-ref safety net per spec §Interaction Dependencies. |
| AC-15: unit tests for `classifyMergeOutcome` | Pass | `tests/run-task-safety.test.ts:2107–2117`. All three matrix branches covered (exit-ok → tolerate, exit-fail + merged → tolerate, exit-fail + not-merged → fail). |

### Dropped Sections Check

- [x] Non-goals respected: `verifyBaseDrift` body byte-identical; no implicit base push; scaffold-commit location unchanged; no working-tree state check; no flag coalescing; `assertLocalBaseInSyncWithOrigin` untouched; merge/delete decoupling is the only change to `mergeOpenPRsAndPull`.
- [x] Known Risks addressed: worktree-vs-REPO_ROOT parity verified in test; stale remote-tracking ref handled by fetch-first + fail-open; ship friction acknowledged and recoverable via `--allow-divergent-base`; AC-14 false-tolerate risk mitigated by prNum-specific check + preserved `assertOriginTaskBranchAbsent`; reminder noise gated by `!worktreeAlreadyCreated` and test-verified; message-format substrings test-pinned.
- [x] Human Test Plan satisfiable: all four scenarios (divergent block, push-then-retry, `--allow-divergent-base` warn, `--force` is not a substitute, `--ship` block, reminder, auto-deleted branch) are wired into the implementation.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

High-quality implementation. The `*FromData` data-seam pattern is followed consistently, `classifyMergeOutcome` is extracted as a pure helper (tested in isolation), `verifyBaseDrift` is byte-identical, and the four-field interface contract for `verifyBaseDivergence` is honored on every code path. The merge/delete decoupling is a strict generalization that subsumes both the existing `used by worktree` and `already merged` stderr tolerances under a single authoritative gh state query keyed on the attempted prNum — preventing the branch-reuse false-tolerate trap Codex spec-review caught. Test coverage is appropriately layered: pure-function tests for the data seam, real-git fixture tests for `verifyBaseDivergence`, and subprocess tests for the wired CLI behavior including the reminder once-per-task signal.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

- _spec gap:_ Three files outside the spec's `### Affected Files` table required edits to land the change: `tests/run-task-cli.test.ts` (parser-shape assertions), `dist/scripts/run-task.js` (rebuilt artifact per `docs/architecture.md`), and `templates/docs/pipeline-orchestrator.md` (auto-synced canon-managed template per the pre-commit hook). Codex flagged this in `handoff.md` Blockers. This is informational — the operator will need to amend the spec's Affected Files at `--pr` time (or pass `--force` for the file-allow-list gate) because the base-drift gate computes its allow-list from the spec table. Suggested template improvement: spec-authoring checklist should call out "if changes touch `scripts/run-task/**`, also list `dist/scripts/run-task.js`" and "if changes touch a canon-managed doc under `docs/`, also list the `templates/` mirror." (The `docs/patterns.md` "Build-generated artifacts go in Affected Files alongside their sources" rule covers the dist file; the templates-sync rule is not yet there.)

## Final Verdict

- [x] **Approved** — ship as-is
