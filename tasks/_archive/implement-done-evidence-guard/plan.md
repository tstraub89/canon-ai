# Implementation Plan: implement-done-evidence-guard

> Written by: Claude | Implements: `tasks/implement-done-evidence-guard/spec.md`

## Approach

Extract the four implement-evidence gates already living in `tryEvidenceAdvance`'s `implement` case into a pure shared helper, then call that helper at the two places that currently trust a status-claimed `done`: the `checkAndRoute` done-check and the `retry === 'done'` branch of `recoverPhaseForTask`. A failing check is normalized into the *existing* "phase not done" recovery flow rather than a new exit shape — that reuses the one-shot session-resume retry and automatically covers the fresh-invocation (restart) case, because the gate keys on file evidence, not on this process's agent exit status.

## Steps

### Step 1: Extract the shared evidence helper

Files: `scripts/run-task/main.ts`

Pull the implement-case body of `tryEvidenceAdvance` (`main.ts:2504-2561` — Changes-table parse via `splitValidation.parseHandoffChangesRows`, malformed-row check, `validateHandoffAgainstSpec`, gitignore-filtered exists-on-disk check) into a helper, e.g. `checkImplementEvidence(taskId): { ok: boolean; note: string }`. It must contain no status writes — pure read + verdict. `tryEvidenceAdvance`'s implement case becomes: call helper; on `ok`, `taskPhase(taskId, 'implement', 'done')` and return advanced as today. Behavior must be byte-identical for existing callers (existing tests are the guard).

### Step 2: Evidence-gate status-claimed `done` in `checkAndRoute`

Files: `scripts/run-task/main.ts`

In the per-task loop (`main.ts:2745-2757`): when `phase === 'implement'` and `phaseStatus === 'done'`, call `checkImplementEvidence`. On failure: `warn` the evidence note plus a resume pointer ("Codex marked implement done but handoff.md evidence is missing/invalid: <note>. Re-run `canon run <id>` to resume the session."), revert the phase with `taskPhase(taskId, 'implement', 'in_progress')` (the state writer preserves `sessions` — verified, only the manual spec-review reset clears them), then fall into the same `recoverPhaseForTask` call the not-done branch uses. Unrecovered → existing `process.exit(2)` path, phase left `in_progress`.

### Step 3: Evidence-check the retry-success branch

Files: `scripts/run-task/main.ts`

In `recoverPhaseForTask` (`main.ts:2722-2724`): when `retry === 'done'` and `phase === 'implement'`, call `checkImplementEvidence` before logging. `ok` → keep `"Retry succeeded — ..."` exactly as today. Failure → `taskPhase(taskId, 'implement', 'in_progress')`, `warn("Retry completed but handoff evidence is still missing/invalid: <note>")`, return `false`. The string "Retry succeeded" must be unreachable on the failure path (AC-4 asserts its absence from the log). Other phases' retry handling unchanged.

### Step 4: Tests

Files: `tests/run-task-safety.test.ts`

Follow the existing fake-executable pattern (`writeExecutable` + PATH override, log/state inspection). Cases:
- AC-1: fake codex sets `implement: done` via the task CLI, leaves handoff Changes table empty, exits 1 → orchestrator ends with `implement: in_progress`, session id preserved, log names the evidence failure, exit 2.
- AC-2: pre-seed `status.json` with `implement: done` + empty handoff (no codex run in-process), invoke the orchestrator fresh → same outcome as AC-1 (restart case).
- AC-3: fake codex sets done AND writes a valid handoff → pipeline proceeds past implement (no revert, no extra warnings).
- AC-4: retry path — first run insufficient, fake codex retry sets done but still no handoff → log lacks "Retry succeeded", contains the retry-completed message, phase `in_progress`, exit 2.
- AC-5: retry sets done and writes valid handoff → "Retry succeeded" logged, pipeline proceeds.

### Step 5: Build

Files: `dist/scripts/run-task.js`, `dist/cli/index.js`

`npm run build`; commit any dist deltas (both artifacts declared in the spec).

## Testing Plan

- **Unit**: the five subprocess cases above; full `npm test` for regressions (especially existing evidence-advance tests in `run-task-safety.test.ts`).
- **E2E**: N/A (no E2E surface — per validation matrix).
- **Manual**: covered by the pipeline's own dogfood — any future mid-handoff agent death exercises this path.

## Rollback Plan

Revert the commit; no schema or data migration. The change is confined to orchestrator routing of one phase's recovery — reverting restores the prior (wedge-prone) behavior with no state cleanup needed.
