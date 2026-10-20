# Code Review: watch-late-attach-crash

> Reviewer: Claude (foreman) | Spec: `tasks/watch-late-attach-crash/spec.md`

Synthesized from three lenses: anchored Claude, cold-Claude, and cold-Codex (pre-obtained; reported no actionable regressions).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `tests/watch.test.ts:223` — fresh `code=1` marker after done phase → `death` with reason. Red-first claim taken from handoff, not re-run. |
| AC-2 | Pass | No log / no pid → `nothing_to_watch`. |
| AC-3 | Pass | `code=0` and stale non-zero markers → `nothing_to_watch`. |
| AC-4 | Pass | `in_progress` with marker carries reason; without evidence keeps generic hint. |
| AC-5 | Pass | `watchCmd` exits 4, stdout `state=plan reason=death`, stderr has reason and `canon run t1`. |
| AC-6 | Pass | Both classifiers call `findCrashEvidence`; `timestampMs >= statusMtimeMs - 1_000` appears once (`src/cli/commands/watch.ts:409`). No existing tests modified. |
| AC-7 | Pass | Exit-code 4 row updated in doc and template mirror. |
| AC-8 | Pass | Validation matrix all Pass; `dist/cli/index.js` rebuilt. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality

### Summary

Clean extraction of the idle-path evidence check into `findCrashEvidence`, reused on attach with the spec'd fall-through behavior. The `death` variant gains an optional reason and the reporter prints it. No correctness bugs survived adjudication; remaining items are test-coverage nits.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nits

- **Untested attach-side dead-pid branch** (`code-bug`-free nit; flagged by 3 lenses: anchored, cold-Claude; cold-Codex silent) — `tests/watch.test.ts`: no attach-level test sets `resolvedPid` to a dead pid and expects `death` with "orchestrator died without a clean exit". The branch is shared with idle (covered), but the new call site's `orchestratorLive` wiring is unverified. Verified against the diff: true.
- **Untested attach edges** (anchored) — heartbeat-primary candidate selection (`watch.ts:369-370`), `human_review` exclusion with a fresh marker, and a `changes_requested` phase skipping the check have no tests.
- **Redundant helper parameter** (anchored) — `findCrashEvidence` takes both `probeAlive` and `resolvedPidAlive`; both callers pass the latter, so the fallback probe is dead. Documented deviation in handoff; harmless.
- **Known Risks gap** (anchored, cold-Claude) — `classifyAttach` checks evidence without requiring a previously-done phase (`watch.ts:363-373`), unlike `classifyIdle`. A leftover non-zero marker on a first-phase `pending` task now reports death. The spec explicitly asks for "current phase is pending or in_progress" with no previous-phase requirement, so this matches spec; the false-positive direction is not named in Known Risks. Spec-intended, not a defect.

## Dismissed Cold Findings

- Dismissed (cold-Claude): legacy `inProgress` fallback returns death without reason when current phase is `blocked`/`human_review` — spec Decision 2 says no-evidence falls through "unchanged", and Non-Goals exclude `human_review`/blocked handling changes; odd-state only.
- Dismissed (cold-Claude): attach death carries no `pid` while idle death does — spec Decision 2 specifies reason + hint only; summary line unchanged by spec (Decision 3); Known Risks says keep each function's existing state shape.
- Dismissed (cold-Claude): race where a just-spawned resume sees the prior run's marker as fresh — low confidence; launch-window and live checks precede the evidence check, and the freshness heuristic is reused unchanged per Non-Goals (same exposure as idle path).
- Dismissed (cold-Claude, test-integrity): attach "clean/stale" test lacks dead-pid coverage — folded into the dead-pid nit above; the test itself is sound.
- Dismissed (cold-Claude): consistency gap on missing previous-done-phase guard — merged into the Known Risks nit above (spec-evidenced: Decision 2).
- Dismissed (anchored): `docs/lessons-learned.md:180` stale wording — historical lesson, not a contract restatement.
- cold-Codex: no findings to dismiss.

## Final Verdict

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
