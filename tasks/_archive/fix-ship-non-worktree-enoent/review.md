# Code Review: fix-ship-non-worktree-enoent

> Reviewer: Claude | Spec: `tasks/fix-ship-non-worktree-enoent/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification (`E2E` marked `not_configured` with spec citation; no UI path)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `const baseBranch = splitGit.getBaseBranch(taskIds)` at `main.ts:1632`, before `ensureCheckedOutBaseBranch` at line 1669. No post-switch `getBaseBranch(taskIds)` remains in `shipTasks`. |
| AC-2 | Pass | `taskSnapshots` and `branchByTaskId` built at `main.ts:1633–1643` (before line 1669). Archive loop uses `taskSnapshot(taskId)` at lines 1705, 1722 — no post-switch `readStatus` calls. |
| AC-3 | Pass | `mergeOpenPRsAndPull` at `main.ts:1438` accepts `baseBranch: string` and `branchByTaskId: ReadonlyMap<string, string>`. Body uses `branchByTaskId.get(id)` — no internal `getBaseBranch` or `resolveTaskBranchName`. Call site at line 1672 passes captured values. |
| AC-4 | Pass | `assertNoOpenPRForTask(branchName: string, baseBranch: string)` at `main.ts:1361`. Call site at line 1684 passes `taskSnapshot(taskId).branch` and captured `baseBranch`. |
| AC-5 | Pass | `assertLocalBaseInSyncWithOrigin(baseBranch: string)` at `main.ts:1134`. No `getBaseBranch` in body. Call site at line 1683 passes captured `baseBranch`. |
| AC-6 | Pass | `assertOriginTaskBranchAbsent(branchName: string, baseBranch: string)` at `main.ts:1246`. Both call sites (line 1692 in `shipTasks`; local-delete-failed path inside `mergeOpenPRsAndPull`) pass captured values. |
| AC-7 | Pass | Test `'main --ship handles a task with worktree: false when base lacks status.json'` added at `tests/run-task-safety.test.ts:1441`. Uses real git; local main lacks the task dir until pull. Pre-fix ENOENT trace captured in `handoff.md` validates the fixture reproduces the bug. |
| AC-8 | Pass | One-line audit comment added above the existing fake-git `--ship` smoke test explaining fake checkout leaves tasks dir on disk and AC-7 supplies real ENOENT coverage. |
| AC-9 | Pass | Test `'main --ship handles a task with worktree: true and tears down the worktree'` added at `tests/run-task-safety.test.ts:1523`. Creates a real `git worktree add`, asserts archive dir present and worktree dir absent after ship. Has `finally` cleanup block. |
| AC-10 | Pass | Grepped `shipTasks` from line 1669 onward: zero `readStatus`, `getBaseBranch`, or `resolveTaskBranchName` calls in the post-switch body, confirmed by full read of `main.ts:1669–1737`. Four updated helpers are also clear (confirmed by diff). |
| AC-11 | Pass | CHANGELOG `### Fixed` entry added under `## [1.5.0] — unreleased` matches the adopter-facing description from the spec. |

### Dropped Sections Check

- [x] Non-goals respected (no `getBaseBranch` fallback, no broader audit, no `state.ts` refactor, no `worktree: false` retirement, no PR mechanics change)
- [x] Known Risks addressed (other-callers risk: type-check confirms no missed call sites; worktree-mode regression: covered by AC-9)
- [x] Human Test Plan satisfiable by the shipped code

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, focused implementation. The pre-switch snapshot pattern is the right approach — captures exactly what's needed, threads it through four refactored helpers, and leaves everything else untouched. The two real-git tests are well-constructed and together give genuine coverage of both `worktree: false` and `worktree: true` shipping paths. The `dist` build output matches the source changes.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `optional cleanup/nit` — `main.ts:1645–1649`: The `taskSnapshot` closure calls `splitCli.die(...)` if the snapshot is missing. Since the map is built from the same `taskIds` slice a few lines earlier, this branch is unreachable in practice. The defensive guard is harmless and consistent with the pattern used in `mergeOpenPRsAndPull`'s branch lookup — leave it.

#### Spec Gaps

(none)

## Final Verdict

- [x] **Approved** — ship as-is

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
