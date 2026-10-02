# Code Review: refactor-spec-correctness-audit-ac

> Reviewer: Claude | Spec: `tasks/refactor-spec-correctness-audit-ac/spec.md`

Synthesized by the foreman from the anchored Claude lens, the cold-Claude lens, and the pre-obtained cold-Codex lens.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | Skill bullet directly after structural-caps bullet; names all three outcomes; gated self-check added. |
| AC-2 | Pass | Refactor note under Acceptance Criteria plus gated checklist line; no new section. |
| AC-3 | Pass | Spec and spec-revision bullets byte-identical and adjacent to caps bullet; test asserts equality and adjacency. |
| AC-4 | Pass | Builder self-check is refactor-gated and says "correctness audit"; spec golden has it, spec-revision golden does not. |
| AC-5 | Pass | Question bullet beside bug-fix bullet; STRONG, never BLOCKING; silence default untouched. |
| AC-6 | Pass | Check (10) after (9); scope line says ten; no stray "nine" in skill or mirror. |
| AC-7 | Pass | Phrase present in all six carriers and the builder line; test covers them. |
| AC-8 | Pass | Only Affected Files, Generated Artifacts, telemetry (`docs/pipeline-invocations.md`) and task artifacts changed. |
| AC-9 | Pass | No backticks or canon-internal paths in added lines; test asserts no backticks. Anchored lens did not itself run `sync-templates:check`; handoff records Pass. |
| AC-10 | Pass | Mirrors byte-identical; three goldens regenerated; only the orchestrator bundle changed in `dist/`. Reproducibility was verified by consecutive-build hash comparison (documented deviation), not `git diff --exit-code -- dist/`. |
| AC-11 | Pass | Only the one BACKLOG candidate line removed. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Prose-only guidance edits across the author, reviewer, and template carriers, plus a structural test and regenerated goldens and bundle. All three lenses returned approve; cold-Codex found no actionable regressions. Surviving items are low-severity test-robustness nits only.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `tests/run-task-prompts.test.ts:973-1026` — substring-only presence check; deleting the gated checklist line, check (10), or reverting "ten" would not fail the test since the phrase remains elsewhere in each file. Spec assigns placement/gating to review under AC-1..AC-6, so within spec. (anchored lens)
- `tests/run-task-prompts.test.ts:~1017-1021` — self-check line found via first `find` match for "correctness audit" in `index.ts`; an earlier unrelated occurrence would shadow it. Exactly one today. (anchored lens + cold-Claude, flagged by 2 lenses)
- `src/orchestrator/prompts/index.ts:117` — self-check wording is shorter than the skill and template versions (omits "in Problem" / "before any preserve AC"); minor drift, not an AC violation. (cold-Claude)
- `.canon/templates/spec.md:25-26` — the refactor note directly follows the bug-fix note as adjacent blockquote lines, which render as one paragraph; agents read it correctly. (anchored lens)

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): test reads sources relative to `process.cwd()` — the existing test file already uses the same pattern (2 prior uses on `main`, 3 now), so this follows the file's convention.
- Dismissed (cold-Claude): test pins that spec-revision lacks the self-check line — that asymmetry is required by AC-4 (spec-revision does not render the self-check list), so the assertion is intentional.
- Dismissed (cold-Claude): committed `dist/` not verified against a fresh build — the handoff records two consecutive builds with identical bundle hash and only `dist/orchestrator/run-task.js` changed; the anchored lens confirmed the bundle carries the new text (4 occurrences: three prompts plus the self-check).
- Dismissed (cold-Codex): no findings reported — nothing to adjudicate.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
