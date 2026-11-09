# Code Review: spec-prompts-term-renames-rule

**Scope:** Full — base `main` — reason: Round 1 (initial review).

## Stage 1 — Spec Compliance (gate)

| AC | Result | Note |
|---|---|---|
| AC-1 | Met | Bullet in `src/orchestrator/prompts/templates/spec.md` and `src/orchestrator/prompts/templates/spec-revision.md`, between the refactor-audit and UI bullets, matching the spec Decision. |
| AC-2 | Met | Golden diff touches only the four spec-prompt keys; `tests/completion.golden.json` is untouched. |
| AC-3 | Met | Parity test covers both skill copies, both templates, bullet identity, and both rendered outputs; red-first row recorded against `288499c`. |
| AC-4 | Met | Diff outside task artifacts is exactly the five Affected Files. |
| AC-5 | Met | `dist/orchestrator/run-task.js` carries the phrase; the handoff records an identical repeat build. |

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded
- [x] Self-Check evidence is not contradicted by the diff
- [x] Non-goals respected
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

**Gate result**

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2

## Stage 2 — Code Quality

Findings: none surviving. All three lenses returned approve.

Nits (non-blocking, no action needed):
- Anchored: the rendered-prompt assertions pin only the title phrase; the full bullet is pinned in the raw templates, and the goldens cover the rendered body.

## Dismissed Cold Findings

- Dismissed (cold-Claude): `tests/run-task-prompts.test.ts:1455` reads carrier files relative to `process.cwd()` — the same pattern is used by neighbouring tests in the same file (lines 1178, 1190, 1299, 1398, 1639), so it is the established convention. Flagged by anchored lens too; dismissed there for the same reason.
- Dismissed (cold-Claude): the bullet is not carried by spec-review or plan prompts — intended; spec Non-Goals scope the rule to the two spec-authoring prompts.
- Dismissed (cold-Codex): no actionable regressions reported; nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested**
- [ ] **Spec gap**
