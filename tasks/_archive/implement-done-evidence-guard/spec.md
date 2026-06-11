# Spec: implement-done-evidence-guard — Evidence-check status-claimed implement done in recovery paths

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

When Codex dies mid-`implement` (token revoke, MCP error, sandbox issue), the orchestrator decides whether the phase actually finished. `tryEvidenceAdvance` (`scripts/run-task/main.ts:2502`) already enforces four evidence gates (non-empty handoff Changes table, no malformed rows, handoff-vs-spec validation, files exist on disk) — but a **status-claimed** `done` bypasses them entirely:

1. **`checkAndRoute` trusts a pre-set `done`.** If Codex called `canon task phase implement done` and then died mid-handoff-write, `getPhaseStatus(...) === 'done'` at `main.ts:2747` skips recovery entirely — the evidence gates only run for tasks whose status is *not* `done`. The pipeline advances with an empty `handoff.md`; the auto-commit step then aborts ("Changes table is empty but the working tree has source-file changes"), leaving a wedged state: implementation dirty in the worktree, no commit, `status.json` claiming `done`. Recovery today requires hand-editing `status.json` back to `in_progress` — which canon's own rules forbid. Crucially, this hole is **not** tied to the run in which Codex died: a fresh `canon run <id>` after an orchestrator death encounters the same stale `done` and sails through the same way. And on this path `validateHandoffAgainstSpec` never runs at all — it is only reachable through the recovery flow, so `autoCommitCode` (which checks row format and file existence, not handoff-vs-spec validation) is the only gate left standing.

2. **The retry path declares success from status alone.** `retryAgentForPhase` returns `'done'` purely from `getPhaseStatus(...) === 'done'` (`main.ts:2707`), and `recoverPhaseForTask` logs `"Retry succeeded — '<id>' implement is now done."` (`main.ts:2722-2724`) without re-running the evidence gates. This produced the exact misleading log in the 2026-05-25 `worktree-canonical-task-state` incident: "Retry succeeded" followed immediately by the auto-commit abort.

BACKLOG entry: "Stricter implement-phase evidence-advance: handoff.md Changes table must be non-empty" (`docs/BACKLOG.md`, Pipeline Architecture section). The entry predates the four-gate `tryEvidenceAdvance`; this task closes the residual status-trusting paths.

## Decision

For the `implement` phase, a `done` recorded in `status.json` is honored only when the handoff evidence gates pass — **unconditionally**, not gated on the current run's agent exit status (the stale-`done` wedge is most often encountered by a *fresh* invocation after a death, where no agent has exited at all). The evidence check is a cheap local file read; a legitimately finished implement passes it trivially.

1. **`checkAndRoute` evidence-gates a status-claimed `done`.** When `implement` reads as `done`, run the same evidence gates `tryEvidenceAdvance` applies. Evidence passes → proceed as today. Evidence fails → treat the task as **not done**: revert the phase to `in_progress` (preserving stored agent sessions so the next run resumes them) and route it through the **existing** recovery flow (`recoverPhaseForTask`: evidence-advance → one-shot retry → stop). No new exit shape — a no-evidence `done` becomes the already-handled "phase not done" case, which also gives it the one-shot session-resume retry (well-suited here: the resumed session's remaining work is typically just finishing the handoff). If recovery fails, the orchestrator stops exactly as it does today for an unrecovered phase (exit 2), with the phase left `in_progress` and an actionable log line naming the evidence failure and pointing at `canon run <id>` to resume.
2. **The retry path verifies evidence before declaring success.** In `recoverPhaseForTask`, when the retry reports `'done'` for `implement`, re-run the evidence gates before logging success. Evidence passes → today's behavior ("Retry succeeded"). Evidence fails → revert to `in_progress` and replace the success log with "Retry completed but handoff evidence is still missing/invalid: <reason>" — the phrase "Retry succeeded" must not appear on this path — and return un-recovered.

Both paths reuse the existing gate logic — extract the implement-evidence check from `tryEvidenceAdvance` into a shared helper rather than duplicating it (cross-cutting invariant in one helper, per `CLAUDE.md`).

## Non-Goals

- No *new* validation gates on the healthy path — a valid `done` passes the existing evidence gates unchanged; this task adds no checks beyond routing the failing case into existing recovery.
- No change to evidence semantics for other phases (`code_review`, `spec_review`, `plan`, `qa`) — their status-claimed `done` handling is out of scope.
- No change to the auto-commit gates (`autoCommitCode` stays the belt-and-suspenders check).
- No retry-count changes — still one-shot retry.

## Acceptance Criteria

- [ ] AC-1: With `status.json` claiming `implement: done` but `handoff.md`'s Changes table empty (Codex died mid-handoff-write), the orchestrator does not advance to code_review: the phase is treated as not-done, recovery runs, and if recovery cannot produce valid evidence the run stops with the existing non-recovery exit (code 2), `phases.implement.status` ends `in_progress`, stored agent session ids are preserved, and the log names the evidence failure with a resume pointer.
- [ ] AC-2: The same stale-`done` + empty-handoff state is caught by a **fresh** `canon run <id>` invocation (no Codex exit in that process) — the restart case behaves identically to AC-1.
- [ ] AC-3: A `done` with fully populated, valid handoff evidence is honored and the pipeline proceeds — no behavior change for the healthy case, and no additional gates beyond the existing evidence checks.
- [ ] AC-4: When the one-shot retry ends with `status.json` claiming `done` but handoff evidence still failing, the log does **not** contain "Retry succeeded"; it names the evidence failure, the phase reverts to `in_progress`, and the orchestrator stops with the existing non-recovery exit (code 2).
- [ ] AC-5: When the retry ends with `done` and valid handoff evidence, "Retry succeeded" is logged and the pipeline proceeds (current behavior preserved).
- [ ] AC-6: The implement-evidence gate logic exists once (shared helper used by `tryEvidenceAdvance` and both new call sites), not three copies — `tryEvidenceAdvance`'s existing behavior unchanged (existing tests keep passing).

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Extract implement-evidence gates from `tryEvidenceAdvance` (~2504-2561) into a shared helper; in `checkAndRoute` (~2745-2757), evidence-gate a status-claimed `implement: done` and route failures into the existing `recoverPhaseForTask` flow as not-done (revert to `in_progress`, sessions preserved); evidence-check the `retry === 'done'` branch of `recoverPhaseForTask` (~2722) |
| `tests/run-task-safety.test.ts` | Subprocess-pattern tests for AC-1 through AC-5 (fake `codex` executable sets phase done, writes/omits handoff content; AC-2 via a second orchestrator invocation against the stale state) |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` |
| `dist/cli/index.js` | Regenerated by `npm run build` if shared chunks bundle into the CLI entry — declared defensively |

### Interaction Dependencies

- Session resumption: the revert must keep stored agent session ids intact so the next `canon run` (or the in-run retry) resumes the dying Codex session rather than starting fresh.
- Status-writer invariants: revert via the same state-writer used elsewhere (no hand-rolled status mutation), so the top-level derived `status` pointer stays consistent.
- The auto-block counter machinery must not be touched — a reverted `in_progress` is not a review iteration.

### Data Model Changes

None.

## Validation Required

- [x] `lint` (`npm run lint`)
- [x] `type-check` (`npm run type-check`)
- [x] `unit tests` (`npm test`) — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `build` (`npm run build`) — commit `dist/` deltas
- [x] `sync-templates:check` (`npm run sync-templates:check`)

## Docs Impact

None expected (internal orchestrator hardening). If the recovery message becomes operator-facing guidance worth documenting, a one-line note in `docs/pipeline-orchestrator.md` at QA's discretion.

## Known Risks

- **False reverts:** if the evidence helper is stricter than what a legitimately-finished implement produces (e.g. all-gitignored handoffs), a healthy `done` could be bounced into recovery, costing a redundant retry/resume. Mitigated by reusing the exact `tryEvidenceAdvance` gates (already battle-tested on the advance path) rather than writing new checks. Failure mode is loud and lossless (session resumes), not silent.
- **Unconditional gate on every implement pass-through:** the evidence check now runs on healthy `done`s too. It is a local file read + parse (the same work `validateHandoff` does later anyway); if profiling ever shows it matters, it doesn't — but the reviewer should confirm no network or git calls live in the shared helper.
- **Worktree resolution:** evidence reads must resolve `handoff.md` via the worktree-aware path (`taskDirFor`), same as `tryEvidenceAdvance` does today — a REPO_ROOT read would see the stale stub and false-revert every worktree task.

## Human Test Plan

1. Start a small task pipeline and let the implementer run; interrupt it after it has marked its work finished but before it has written its handoff summary (pulling network/auth mid-write, or killing the agent process, reproduces the incident; the automated suite covers the same scenario deterministically).
2. Re-run the pipeline for that task. Expected: instead of advancing and later failing with a confusing commit error, it reports that the handoff evidence is missing and resumes the interrupted session to finish it.
3. Once the handoff is complete, the task proceeds to review normally, and at no point did you have to hand-edit any task state file.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]` (not `- [ ]`). `- [ ]` is a placeholder; the spec author flips required checks to `- [x]` before marking spec done. The orchestrator's code_review pre-flight blocks if no `[x]` items are present.
