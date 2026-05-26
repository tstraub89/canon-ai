# Code Review: preflight-exempt-telemetry

> Reviewer: Claude | Spec: `tasks/preflight-exempt-telemetry/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All six required checks (lint, type-check, test, build, docs-refs-check, sync-templates:check) show Pass.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `HANDOFF_DIFF_EXEMPT_PATHS` uses `PIPELINE_TELEMETRY_FILES` by name, typed `ReadonlySet<string>` | Pass | `new Set<string>(PIPELINE_TELEMETRY_FILES)` in diff |
| AC-2: diff→handoff loop and rename loop structurally unchanged | Pass | Only the constant initializer and comment changed; no loop modifications in diff |
| AC-3: Comment explains QA/orchestrator provenance and references PR #107 | Pass | 7-line comment added; rationale and PR #107 citation both present |
| AC-4: Test `'verifyHandoffAgainstDiffFromData exempts PIPELINE_TELEMETRY_FILES from diff→handoff check'` with exact inputs and `assert.deepEqual(issues, [])` | Pass | Exact name, correct diffFiles, correct assertion |
| AC-5: Test `'verifyHandoffAgainstDiffFromData still rejects non-telemetry diff files missing from handoff when telemetry is also present'` with negative-control logic | Pass | Exact name; asserts 1 issue containing `'src/baz.ts'`, not containing `'lessons-learned'` |
| AC-6: Both dist files regenerated with `PIPELINE_TELEMETRY_FILES` in `HANDOFF_DIFF_EXEMPT_PATHS` | Pass | `new Set(PIPELINE_TELEMETRY_FILES)` visible in both dist files |
| AC-7: All six validation commands pass | Pass | All report Pass in handoff Validation Outcomes |

### Dropped Sections Check

- [x] Non-goals respected: no `PIPELINE_MANAGED_DOCS` changes, no reroute changes, no implement-baseline-SHA mechanism
- [x] Known Risks addressed in handoff Edge Cases section
- [x] Human Test Plan satisfiable by the committed artifacts

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Minimal, correct implementation. Single-line widening of an existing exemption set, with an explanatory comment and two targeted regression tests. No new control flow, no string list duplication, no scope creep.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

(none)

**Observational note** (not a finding): the dist diff removes the `/* @__PURE__ */` annotation from `HANDOFF_DIFF_EXEMPT_PATHS`. This is correct bundler behavior — `new Set(PIPELINE_TELEMETRY_FILES)` reads a module-level variable and is not a pure expression, so esbuild correctly drops the annotation.

## Final Verdict

- [x] **Approved** — ship as-is

---

<!--
On re-review, append below this line:

## Round N — verifying iteration N's response to round N-1

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
