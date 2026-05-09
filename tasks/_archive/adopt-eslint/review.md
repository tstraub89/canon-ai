# Code Review: adopt-eslint

> Reviewer: Claude | Spec: `tasks/adopt-eslint/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

Verified by running all three checks locally (worktree had no `node_modules`; ran `npm install` first):

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Exits 0, no errors or warnings |
| `npm run type-check` | Pass | Exits 0 |
| `npm test` | Pass | 66 tests, 0 failures |
| Full build | N/A | Per spec — no build step |
| End-to-end | N/A | Per spec — no UI surface |

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: `eslint`, `typescript-eslint` in `devDependencies` | Pass | Both in `package.json` diff |
| AC-2: `eslint.config.mjs` at repo root with specified shape | Pass | File matches spec exactly — ignores, `recommendedTypeChecked`, `projectService: true` |
| AC-3: `"lint"` script: `eslint scripts/ tests/` | Pass | Verified in `package.json` diff |
| AC-4: `npm run lint` exits 0 | Pass | Verified locally |
| AC-5: `npm test` passes with 66 tests | Pass | Verified locally |
| AC-6: `npm run type-check` passes | Pass | Verified locally |
| AC-7: `docs/architecture.md` linting row rewritten to `npm run lint` | Pass | Diff uses exact spec text |
| AC-8: `docs/codebase-map.md` configuration table has `eslint.config.mjs` entry | Pass | Row added correctly |

### Dropped Sections Check

- [x] Non-goals respected — no `eslint-disable` suppressions, no extra lint rules, no CI wiring, no pre-commit hook
- [x] Known Risks addressed — both `onLine` closures fixed, `_` prefix and `typeof` references updated atomically, `void` on outer `test()` calls only, nested calls untouched
- [x] Human Test Plan satisfiable — all three commands pass

### Documented Deviation

One documented deviation: Codex added `isPhaseStatus()` / `isVerdict()` runtime guards in addition to the `_`-prefix fix. The `_` prefix IS still present; the guards also give the const arrays a runtime use. Deviation is documented with rationale; all ACs remain met; the resulting code is strictly safer (malformed `status.json` values fall back to defaults rather than passing through). Evaluated as a sound design decision — no AC impact.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean implementation. All seven `run-task.ts` violations are fixed exactly as prescribed. Test files have `void` on every top-level `test()` registration and nowhere else. The `eslint.config.mjs` is a verbatim match of the spec shape. The `isPhaseStatus` / `isVerdict` guards are a well-reasoned addition that improves robustness without affecting any ACs.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

`optional cleanup/nit`: `isVerdict` type guard returns `false` for `''`, but `Verdict` includes `''` as a valid value. The callers' usage in `getVerdict` is correct regardless (both `''` and `undefined` fall to the `''` default), so there is no behavioral issue. No action required.

#### Spec Gaps

(none)

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
