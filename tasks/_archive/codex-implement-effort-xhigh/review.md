# Code Review: codex-implement-effort-xhigh

> Reviewer: Claude | Spec: `tasks/codex-implement-effort-xhigh/spec.md`

Synthesized by the foreman from three lenses: anchored Claude, cold-Claude, and pre-obtained cold-Codex.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence: none required (no red-first ACs)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: implement effort cells | Pass | `src/lib/pipeline-policy.ts` XS/S mini/xhigh, M/L mini/max, XL full/high; other rows unchanged; table rows in `tests/pipeline-policy.test.ts` match. |
| AC-2: `max` valid effort | Pass | `max` after `xhigh` in `VALID_CODEX_EFFORTS`; new accept/reject test; regex ends `\|xhigh\|max`. |
| AC-3: full-model default | Pass | `policy.ts` fallback `gpt-6.1-sol`; no `'gpt-6-sol'` in `src`; env-table row and `max` caveat with recovery path in the guide. |
| AC-4: stale env/overthinking claims | Pass | Zero-match greps clean; comment rewritten; 2026-06 entry kept with inline note. |
| AC-5: delicate = model upgrade | Pass | README and guide wording corrected; matrix table and prose match AC-1. |
| AC-6: product-context summary | Pass | XS mini/xhigh; no "scales with size"; cross-references new entry. |
| AC-7: decisions entry | Pass | All of (a)–(f) present; four inline supersede notes present. |
| AC-8: mirror/build in sync | Pass | Template mirror matches root; `dist/orchestrator/run-task.js` rebuilt and carries both source changes; `dist/cli/index.js` unchanged. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail**

## Stage 2 — Code Quality

### Summary

Small, tightly scoped change: matrix cells, one validator entry, one default string, docs, mirror, and dist all agree. No correctness bugs survived adjudication; the cold-Claude findings concern the deliberately unenforced CLI/model compatibility, which the spec records as a Non-Goal and Known Risk.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `tests/run-task-code-review.test.ts:247` (anchored, cold-Claude — flagged by 2 lenses): the new test only checks the validator and uses `assert.notEqual(..., null)` for `ultra`. No test pins the `gpt-6.1-sol` default string (policy tests use `mini`/`full` placeholders) or that matrix efforts pass `invalidCodexEffortMessage`. Optional follow-up.
- `src/lib/pipeline-policy.ts:205`: the spec_review comment says "effort scales with size", which is true for spec_review; not a stale claim, no action.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): `codex.ts:16-24` — `invalidCodexEffortMessage` gives no hint that `max` may be rejected by an older CLI/model — that message is canon's own pre-spawn validation for values outside its list; a CLI rejection surfaces Codex's own error. Spec Non-Goal "No Codex CLI version gate" and Known Risks (first bullet) accept this, with the caveat and recovery path documented in the guide per AC-3.
- Dismissed (cold-Claude): `pipeline-policy.ts:235-238` — no preflight/`canon doctor` check that CLI and model accept `max` — explicit spec Non-Goal ("No `canon doctor` check and no runtime version gate"); Known Risk accepted by the spec; not a code-bug or spec-gap (decision made deliberately, mitigated by documentation).
- Dismissed (cold-Claude): `policy.ts:28` — `gpt-6.1-sol` resolvability unchecked and XL spec_review also moves — the spec's Decision changes the shared full-model fallback (both full-model phases) and cites the operator running `CODEX_MODEL_FULL=gpt-6.1-sol` since 2026-10-04; rollback via `CODEX_MODEL_FULL` is documented.
- Dismissed (cold-Claude): `decisions.md:220` — cost-ratio rationale conflicts with the older "overthinks" rationale — the old text is explicitly marked superseded per AC-7, and the new entry addresses the 2026-07 evidence in its Why (item b); docs-only.
- Dismissed (cold-Codex): no findings; it noted only the documented `max` CLI/model compatibility risk, already accepted in Known Risks.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
