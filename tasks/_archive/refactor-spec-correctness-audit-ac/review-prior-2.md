# Code Review: refactor-spec-correctness-audit-ac

> Reviewer: Claude (foreman) | Spec: `tasks/refactor-spec-correctness-audit-ac/spec.md`

Synthesized from three lenses: anchored Claude, cold-Claude, and pre-obtained cold-Codex (no actionable defects; its test run was interrupted before completion).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Note: the lenses did not re-run the build or tests; this relies on the handoff's reported Pass results (E2E is `deferred_by_spec`).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Skill bullet follows the caps bullet, names all three outcomes; gated self-check added. |
| AC-2 | Pass | Refactor note under Acceptance Criteria and gated checklist line; no new section. |
| AC-3 | Pass | Identical bullet after the caps bullet in both prompts; test asserts equality and adjacency. |
| AC-4 | Pass | Refactor-gated builder line; spec golden has it, spec-revision golden does not. |
| AC-5 | Pass (as amended) | Bullet sits beside the bug-fix evidence bullet; silence-default text unchanged. |
| AC-6 | Pass | Check (10) after (9), STRONG never BLOCKING; scope line says ten; no stray "nine". |
| AC-7 | Pass | Structural test covers the six carriers, the builder line, and the golden. |
| AC-8 | Pass | Source diff is limited to Affected Files and Generated Artifacts. |
| AC-9 | Pass | No backticks or canon-internal paths in added shipped lines. |
| AC-10 | Pass | Mirrors byte-identical; goldens and bundle regenerated. |
| AC-11 | Pass | Single BACKLOG line removed. |
| AC-12 | Pass | spec_review bullet says Blocking, no STRONG wording; test pins it. |
| AC-13 | Pass | Advisory skill check (10) and mirror unchanged by the amendment. |
| AC-14 | Pass | Spec-review golden and bundle regenerated; checks reported passing. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality

### Summary

Guidance-only change, consistently carried across every surface the spec names, with structural tests and regenerated fixtures. No code bugs or spec gaps survived adjudication; only low-severity test-hardening nits remain.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `tests/run-task-prompts.test.ts` — the new test locates the self-check and review lines with `find(line => line.includes('correctness audit'))`, so a later line containing the phrase could become the target silently. Also the spec_review severity check matches a bare `/Blocking/`, a weak pin. Low severity (anchored lens, cold-Claude; flagged by 2 lenses). Optional hardening: match on a more distinctive anchor.
- `docs/lessons-learned.md` and other docs outside Affected Files changed. These are QA/telemetry bookkeeping artifacts, not scope creep (anchored lens).

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): pipeline spec_review calls a missing audit Blocking while the canon-spec-review skill check (10) says STRONG, never BLOCKING — the split is deliberate. Amendment Round 1 (spec.md) explicitly sets Blocking for the pipeline prompt, because the pipeline has only Blocking/nit tiers and a nit would never trigger spec revision, and AC-13 requires the advisory skill to stay STRONG, where STRONG is a real tier. Not a defect.
- Dismissed (cold-Claude): test reads files relative to `process.cwd()` — low confidence; sibling tests in this suite follow the same style and the suite passes from the repo root.
- Dismissed (cold-Claude): self-check line exists only in the spec prompt, not spec-revision — intended per AC-4, which requires the spec-revision golden not to contain it; the revision prompt does carry the rule bullet.
- Dismissed (cold-Codex): no findings returned; nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
