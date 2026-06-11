# Completion Summary: implement-done-evidence-guard — Evidence-check status-claimed implement done in recovery paths

> For the human. This is what you need to know.

## What Changed

Before this fix, if Codex died mid-`implement` after setting the phase to `done` but before finishing its handoff, the orchestrator would trust that `done` status unconditionally. On the next `canon run`, it would advance directly to `code_review` — then fail confusingly when the auto-commit step found an empty handoff with source-file changes in the working tree. Recovering required hand-editing `status.json`, which canon's own rules forbid. The retry path had the same gap: it would log "Retry succeeded" even when handoff evidence was still missing, producing the exact misleading output seen in the 2026-05-25 incident.

The fix introduces a shared `checkImplementEvidence` helper that encapsulates the four existing handoff evidence gates. Two new call sites:

- **`checkAndRoute`** now gates a status-claimed `implement: done` through `checkImplementEvidence`. Evidence passes → behavior unchanged. Evidence fails → phase reverted to `in_progress` (stored Codex session IDs preserved), task routed into the existing `recoverPhaseForTask` flow.
- **`recoverPhaseForTask`** re-runs `checkImplementEvidence` after a retry reports `done`. Only when evidence passes does it log "Retry succeeded"; a still-failing retry instead logs "Retry completed but handoff evidence is still missing/invalid: `<reason>`" and exits with code 2.

`tryEvidenceAdvance` now delegates to the same helper, so the gate logic exists in exactly one place.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Extracted `checkImplementEvidence` helper; stale-done gate in `checkAndRoute`; post-retry evidence recheck in `recoverPhaseForTask` |
| `scripts/run-task/cli.ts` | Exit-reason state and synchronous exit-marker writer (bundled with orchestrator-exit-logging) |
| `scripts/run-task/agents/claude.ts` | Exit reasons on Claude failure ladder (bundled) |
| `scripts/run-task/agents/codex.ts` | Exit reasons on Codex spawn/stall/signal failures (bundled) |
| `tests/run-task-safety.test.ts` | Subprocess-pattern tests for AC-1 through AC-5; extended fake git stub |
| `dist/cli/index.js` | Rebuilt |
| `dist/scripts/run-task.js` | Rebuilt |

## Test Results

| Check | Result |
|---|---|
| `lint` | Pass |
| `type-check` | Pass |
| `unit tests` | Pass — 830 passed, 1 skipped, 0 failed |
| `build` | Pass |
| `sync-templates:check` | Pass |

All 6 ACs met. Code review: **Approved with nits** (one round, no correctness bugs or risk items).

Open nit (optional, not blocking): `tests/run-task-safety.test.ts` lines 3510 and 3661 each contain a `writeImplementEvidenceFixture` call immediately overwritten by a second call — dead code, the test intent is achieved by the second call, but the first could confuse future readers.

## Human Verification Required

None.

## Decisions Made

- Shared helper (`checkImplementEvidence`) rather than three copies of the gate logic, per the cross-cutting-invariant rule in `CLAUDE.md`.
- Recovery failure on a stale `done` uses the existing non-recovery exit (code 2), not a new exit shape — the operator's recovery path (`canon run <id>`) is unchanged.
- Session IDs are preserved through the phase revert so a resumed run can pick up the interrupted Codex session.

## Open Questions

None.

## Proposed Changelog

Target release: **1.11.1** (patch — correctness fix, no new commands or configuration).

Proposed bullet for `[1.11.1] — Fixed`:

> **`canon run` no longer advances a task to code review when Codex died mid-handoff.** If Codex marks `implement` done and then crashes before finishing its handoff, a fresh `canon run` now detects the missing evidence, reverts the phase to in-progress, and triggers the normal resume-retry flow instead of advancing and aborting confusingly at the auto-commit step. "Retry succeeded" is no longer logged when handoff evidence is still absent after the retry.
