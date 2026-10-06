# Code Review: rearm-spec-gate

> Reviewer: Claude (foreman synthesis) | Spec: `tasks/rearm-spec-gate/spec.md`

Code review synthesized from anchored Claude, cold-Claude, and cold-Codex lenses.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification (one unrelated skipped worktree test is unverified, not passing)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `taskSetValue` case-insensitive true/false; atomic write; invalid value byte-identical; worktree routing tested |
| AC-2 | Pass | Arming clears `full_send` in the same write; note names real id; no note otherwise |
| AC-3 | Pass | Disarm leaves `full_send` |
| AC-4 | Pass | Delicate disarm throws before write, names `--full-send --force <id>`; arming allowed |
| AC-5 | Partial | Message corrected in `src/task/index.ts`, but the updated refusal test asserts only `/canon run --full-send/`; nothing pins `--reroute` or absence of "not durable metadata" |
| AC-6 | Pass | Four warning/note cases covered |
| AC-7 | Pass | Redirect + refusal branch removed; Settable list updated |
| AC-8 | Pass | New reroute-preflight test; no orchestrator change |
| AC-9 | Pass | `printCreatedTask` points at `canon task set <id>` |
| AC-10 | Partial | §"Spec gate is a single-use latch" (docs/pipeline-orchestrator.md and mirror) lacks the required statement that an armed latch halts after a full-tier reroute's amendment review and never fires on a fast-tier reroute; that text exists only in the reroute paragraph (line ~473). Other bullets met |
| AC-11 | Pass | No `src/orchestrator/` or `pipeline-policy.ts` changes |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Stage 1 fails on two partial ACs (AC-5 test pin, AC-10 latch-section text). Stage 2 not run by the anchored lens; cold-lens findings are adjudicated below.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Implementation is small and sound: single atomic write, refusal before write, warning matrix correct. Gaps are a missing doc sentence and a weak test assertion; plus two spec-level issues.

### Findings

#### Correctness Bugs

1. **code-bug** (anchored) — `docs/pipeline-orchestrator.md` §"Spec gate is a single-use latch" (and `templates/docs/pipeline-orchestrator.md`): add that an armed latch halts after a full-tier reroute's amendment review and never fires on a fast-tier reroute (AC-10). Edit root, then `npm run sync-templates`.
2. **code-bug / test integrity** (anchored) — `tests/task-cli.test.ts` refusal test (~line 607): `full_send` assertion must also match `--reroute` and `doesNotMatch(/not durable metadata/)` (AC-5).

#### Risk / Guardrails

#### Optional Cleanup / Nit

- (cold-Claude, low) The big compound test in `tests/task-cli.test.ts` chains many scenarios; consider splitting. Not blocking.

#### Spec Gaps

- **spec-gap** (cold-Codex P2, `src/task/index.ts:1543`; anchored noted the fast-tier variant; flagged by 2 lenses): the spec-review-done note advertises `canon run --reroute <id>`, but reroute only admits tasks at `code_review`/`qa`/`human_review`, and the note prints for fast-tier tasks where the gate can never fire again. Verified: AC-6 mandates this wording and Known Risks says to name only the full-tier reroute, so code matches spec; the spec's recovery guidance is incomplete for tasks right after the gate halts. Human decision needed on wording; does not block this round's fixes.
- **spec-gap** (anchored + cold-Claude, low): delicate guard exists only on `human_spec_gate false`; `delicate false` → `human_spec_gate false` → `delicate true` bypasses the `--force` friction. Spec scopes the guard to the gate setter only (AC-4); no `delicate` guard specified.

### Dismissed Cold Findings

- Dismissed (cold-Claude): `--force` recovery in the delicate error may not work — `src/orchestrator/main.ts:3632` shows `--force` acknowledges the `--full-send` delicate guard, so the advertised command is valid.
- Dismissed (cold-Claude): disarm on a started, spec_review-done task prints nothing — AC-6 explicitly requires neither note nor warning.
- Dismissed (cold-Claude): arming silently clears `full_send` — it prints a note and AC-2 requires the behavior.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Delta — base `b2be516a9566b6e378fa5bf24981ac3ca775a8bc` — reason: small fix within the files already under review

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from round 1) | |
| AC-2 | Met (unchanged) | |
| AC-3 | Met (unchanged) | |
| AC-4 | Met (unchanged) | |
| AC-5 | Met | Refusal test now requires `canon run --full-send` and `--reroute`, and `doesNotMatch(/not durable metadata/)` |
| AC-6 | Met (unchanged) | |
| AC-7 | Met (unchanged) | |
| AC-8 | Met (unchanged) | |
| AC-9 | Met (unchanged) | |
| AC-10 | Met | Latch section now states a full-tier reroute halts after amendment review and a fast-tier reroute never reaches the gate; root and `templates/` mirror identical |
| AC-11 | Met (unchanged) | |

Validation gate: handoff has no Fail rows; I did not re-run the suite myself.

### Verifying Round 1 findings

- _code-bug:_ AC-10 latch-section sentence missing → addressed (`docs/pipeline-orchestrator.md:367`, mirror synced) ✓
- _code-bug / test integrity:_ AC-5 refusal test too weak → addressed (`tests/task-cli.test.ts:607-612`) ✓

### New findings

No code-bugs. Nits and carried items:

- (anchored, low) The reroute paragraph in `docs/pipeline-orchestrator.md` (~line 475) joins the new reroute clause to the plan-append clause with semicolons; reads as a run-on. Optional split.
- (cold-Claude, low) The latch section doesn't say a reroute does not re-arm an already-consumed latch, so a reader may assume every full-tier reroute halts. Clarity only.
- **Carried spec-gaps, accepted as non-blocking (both low severity):** (1) the completed-`spec_review` note advertises the full-tier reroute, which is not admitted right after the gate halts, and prints for fast-tier tasks; AC-6 mandates this wording. (2) Setting `delicate false`, then the gate `false`, then `delicate true` bypasses the delicate `--force` friction; AC-4 scopes the guard to the gate setter. Strictly these are spec-gaps. I am not routing to `spec_gap` because they are low severity and spec-mandated, and a halt would stall the task over wording and a deliberate multi-step bypass. Recommend Tim file follow-ups.

### Dismissed Cold Findings

- Dismissed (cold-Codex): no actionable defect in the delta — nothing to dismiss.
- Dismissed (cold-Claude): the `--reroute` assertion may match incidentally — the message is fixed text and this is the AC-5 pin.

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
