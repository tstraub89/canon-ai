# Code Review: refactor-spec-correctness-audit-ac

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored-Claude, cold-Claude, cold-Codex (injected). All three returned valid forms.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 – AC-4 | Met | Author-side carriers (skill, template, spec/spec-revision prompts, builder self-check) carry A/O verbatim; goldens split correctly. |
| AC-5, AC-12 | Met | spec_review bullet beside bug-fix bullet, Blocking severity, silence-default unchanged. |
| AC-6, AC-13 | Met | Check (10) after (9), STRONG/never BLOCKING, scope line says ten. |
| AC-7, AC-15 – AC-18 | Met | One test defines O/A/R once and asserts every carrier and mirror verbatim; mutation check reported. |
| AC-8 – AC-11, AC-14, AC-19 | Met | Scope bound held, no backticks/internal paths, mirrors/goldens/dist regenerated (anchored lens rebuilt: no dist drift), BACKLOG single-line removal. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality

### Summary

Guidance-only change, aligned across all carriers. No correctness bugs or adopter-scope violations. Cold-Codex independently confirmed alignment and a passing suite. Only low-severity nits survive.

### Findings

#### Correctness Bugs

None.

#### Risk / Guardrails

None.

#### Optional Cleanup / Nit

- `tests/run-task-prompts.test.ts` (~973-1070) — flagged by anchored + cold-Claude (2 lenses): the self-check line and review bullet are located with `find(... includes('correctness audit'))`, which silently retargets if an earlier line gains the phrase. Also, canon-spec skill bullet placement and check (10) ordering are not asserted (only the two prompt templates get adjacency checks). Cold-Claude adds: reads via `process.cwd()` rather than an `import.meta`-resolved path. Low severity; matches sibling test style.
- Severity split (Blocking in pipeline prompt vs STRONG in advisory skill) — cold-Claude, low. Intentional per Amendment Round 1/AC-13, pinned by test, and explained in lessons-learned; not a defect.
- `spec-revision` has no self-check counterpart — cold-Claude, low. Intentional per AC-4 (self-check is spec-prompt only; revision gets rule A); spec_review catches omissions.

#### Spec Gaps

None.

### Dismissed Cold Findings

- Dismissed (cold-Claude): BACKLOG line deleted rather than marked shipped — AC-11 explicitly requires deletion per file convention.
- Dismissed (cold-Claude): lead-in tone inconsistency of the spec-review bullet (anchored nit) — cosmetic, pinned by canonical text R.
- Cold-Codex: no findings (alignment confirmed, suite passed); nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
