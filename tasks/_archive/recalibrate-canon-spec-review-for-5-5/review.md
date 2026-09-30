# Code Review: recalibrate-canon-spec-review-for-5-5

> Reviewer: Claude | Spec: `tasks/recalibrate-canon-spec-review-for-5-5/spec.md`

Code review synthesized by a foreman from three lenses: anchored Claude, cold-Claude, and pre-obtained cold-Codex (reported no actionable defects).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The one skipped test (`tests/run-task-safety.test.ts:2522`) is unrelated to the diff and recorded in the handoff as unverified, not passing.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Charter tools bound delegation and writes | Pass | `name: spec-review-lens`; `tools: Read, Grep, Glob, Bash`; test parses the list and rejects Agent/Skill/Edit/Write. |
| AC-2: Charter body carries the lens contract | Pass | Read-only Bash, no sub-agents/skills/writes, `file:line` citation, coverage-first, `[NO FINDINGS]` all present and tested. |
| AC-3: Severity and scope boundary in both files | Pass | Both files define BLOCKING/STRONG/NIT and state the scope boundary with both conjuncts and all three exclusions; test checks both files. |
| AC-4: Skill dispatches only to the charter | Pass | `subagent_type: spec-review-lens`; `canon upgrade` stop; no general-purpose/Explore/Shape Check; Agent C tokens preserved. |
| AC-5: Silence default moved to synthesis | Pass | Calibration line removed; step 3 names uncited-drop, scope-boundary downgrade, de-dupe. |
| AC-6: C3 matches the parser | Pass | Names `### Affected Files`, `## Design`, generated/rebuilt outputs. |
| AC-7: Smaller drift | Pass | `effort: high` kept; `/canon-inline-review`; XS row; war story and `~15-min` removed. |
| AC-8: Registration and mirrors | Pass | `CANON_OWNED` entry present; both mirrors identical to root; `dist/cli/index.js` contains the path. |
| AC-9: Decision record | Pass | Paragraph at `docs/decisions.md:469-471`, inside the calibration-audit section. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality

### Summary

The change is small and coherent: a tool-bounded charter, a skill that dispatches to it and carries matching severity/scope text, registration, mirrors, and a structural test. All three lenses found no correctness bugs or spec gaps; only low-severity nits survive.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `tests/run-task-prompts.test.ts` (new test, `trivialRow`): takes the first table line matching `/trivial|XS/` and asserts `/XS/`, so it could pick the wrong row if an earlier row mentions "trivial". Works today. (flagged by anchored + cold-Claude)
- `tests/run-task-prompts.test.ts` (scope-boundary loop): the per-line one-conjunct check fires only on lines matching `Non-Goals`/`explicitly exclude`; the file-wide verification regex could be satisfied elsewhere. Weak but meets AC-3 as written. (cold-Claude)
- `.claude/skills/canon-spec-review/SKILL.md:23`: the "When to use" trivial-patch sentence does not mention XS; AC-7 requires only the anti-pattern row. (anchored)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): Bash is unrestricted, so read-only is prose-only — this is the spec's explicitly accepted Known Risk (Bash stays for surfaces lacking Grep/Glob; structural bound covers delegation and Edit/Write).
- Dismissed (cold-Claude): skill no longer carries the finding output schema, so a stale or missing charter breaks synthesis — the spec assigns the format to the charter (Decision §1) and the missing-charter stop is the designed loud failure.
- Dismissed (cold-Claude): no `canon doctor` check for the charter — the spec's Non-Goals exclude it.
- Dismissed (anchored): the `tools:` syntax and Agent-rejects-unknown-type behavior are unverified by the structural test — covered by the spec's Human Test Plan and Known Risks, not a code defect.
- Dismissed (cold-Codex): no findings returned.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
