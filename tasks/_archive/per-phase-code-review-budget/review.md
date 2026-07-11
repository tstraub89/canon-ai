# Code Review: per-phase-code-review-budget

> Reviewer: Claude | Spec: `tasks/per-phase-code-review-budget/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens independently re-ran the full required suite in the worktree: `npm run lint` clean, `npm run type-check` clean, `npm test` (939 pass / 0 fail), `npm run build` + `git diff --exit-code -- dist/` clean, `npm run docs-refs-check` "All refs OK". Note: the handoff records `npm test` as "938 pass, 1 skipped" while the independent re-run shows "939 pass, 0 skipped" — the delta is an environment-conditional skipped test, not a dropped or broken one, and **there is no `Fail` either way**, so the gate is unaffected. Recorded as an informational discrepancy only.

### Acceptance Criteria Check

Cross-reference **every** AC from the spec. Missing an AC from this table is itself a Stage 1 failure.

| AC | Status | Notes |
|---|---|---|
| AC-1: `code_review` budget curve by size (XS $5, S $10, M $15, L $20, XL $40) | Pass | `CODE_REVIEW_BUDGET_BY_SIZE` (`scripts/pipeline-policy.ts:76-82`); `CODE_REVIEW_TABLE` `deepEqual` rows + `BUDGET_TABLE.codeReview` column assert every cell (`tests/pipeline-policy.test.ts:191-197` and `tests/pipeline-policy.test.ts:103-110`). |
| AC-2: `spec`/`plan`/`qa` unchanged ($5 XS/S, $10 M/L, $20 XL) | Pass | `SINGLE_PASS_BUDGET_BY_SIZE` is byte-identical to the prior `BUDGET_BY_SIZE`; `BUDGET_TABLE` now asserts `spec`, `plan`, **and** `qa` per-row (`tests/pipeline-policy.test.ts:112-120`); `CLAUDE_TABLE` still pins per-phase model/effort. |
| AC-3: delicate task → `code_review` $40 (XL), `spec`/`plan`/`qa` $20 | Pass | `M delicate` `BUDGET_TABLE` row (singlePass 20.00 / codeReview 40.00) + delicate-M `deepEqual` `{opus, xhigh, budget '40.00'}` (`tests/pipeline-policy.test.ts:109` and `tests/pipeline-policy.test.ts:206-209`). Delicate→XL promotion applies on both axes. |
| AC-4: `CLAUDE_BUDGET=<n>` flat override across all four phases | Pass | Override test sets `claudeBudget: '20.00'` and asserts `spec`/`plan`/`qa`/`code_review` all return `20.00` for every row (`tests/pipeline-policy.test.ts:122-131`); `resolveBudget` short-circuits `claudeBudget ??` before the table (`scripts/pipeline-policy.ts:104`). |
| AC-5: `resolveBudget()` gains `phase: ClaudePhase`; no phase-less call site | Pass | Signature `(phase, effectiveSize, claudeBudget)` (`scripts/pipeline-policy.ts:103`); sole call site is the `claude(phase)` closure (`:261`), passing `phase`. No other invocation exists. |
| AC-6: `docs/pipeline-orchestrator.md` matrix table + flat-override note | Pass | New `## Claude Budget Matrix` in Codex-matrix style with the `spec`/`plan`/`qa` vs `code_review` split across all sizes + flat-override note; `CLAUDE_BUDGET` env row updated to point at it. `templates/` mirror is identical. |
| AC-7: rebuilt `dist/` committed, no build diff | Pass | Anchored lens ran `npm run build && git diff --exit-code -- dist/`: no diff. `dist/scripts/run-task.js` carries the phase-aware `resolveBudget`. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work) — no new env var; Codex arm (`codex: (phase) => matrix[phase][effectiveSize]`) untouched; `MAX_REVIEW_LOOPS`/model/effort unchanged; no budget-exhaustion detection added; `spec`/`plan`/`qa` numbers byte-identical.
- [x] Known Risks addressed or documented as accepted — 10-cell transcription verified exact (no off-by-one); call-site relocation leaves the Codex arm untouched; delicate promotion verified on both axes; S/L/XL-as-extrapolations recorded in `docs/decisions.md` as a follow-up tuning concern, not a bug.
- [x] Human Test Plan is satisfiable by the implementation — the per-phase budget log line, the M=$15 headroom, the documented matrix, and the flat `CLAUDE_BUDGET` override are all exercisable.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

A tight, table-driven routing change executed exactly as the spec's "Pure Policy + Test Discipline" pattern prescribes: `BUDGET_BY_SIZE` becomes `BUDGET_BY_PHASE_AND_SIZE: Record<ClaudePhase, Record<TaskSize, string>>`, `resolveBudget()` gains a `phase` parameter, and budget resolution moves into the per-phase `claude` closure. The map is total over `ClaudePhase`, so a future missing phase is a compile error, not a runtime `undefined`. All three budget tables (code, test, docs) are mutually consistent — no off-by-one across the 10 cells — confirmed independently by all three lenses. Tests are non-vacuous: `singlePass` and `codeReview` expected columns diverge at S/M/L/XL, so a mis-route in either direction fails. No correctness or spec findings survive.

### Findings

#### Correctness Bugs

> Items that will cause incorrect behavior if shipped.

(none)

#### Risk / Guardrails

> Items that could cause problems under certain conditions or violate repo conventions.

- **Stale base — branch is 2 commits behind `main`** _(cold-Claude, foreman-verified; operational, non-blocking)_. `git rev-list --left-right --count main...HEAD` → `2  1`; `main` carries `697154b` (CHANGELOG #190 correction) and `bb84242` (BACKLOG triage #187–#193) that HEAD lacks. Consequence: a **two-dot** `git diff main HEAD` shows `CHANGELOG.md` and `docs/BACKLOG.md` as reverted/re-added — but the **three-dot** `git diff main...HEAD` (the task's actual contribution) contains only the 6 declared files and touches neither. This is a stale-base artifact, **not** a change this task made. A normal 3-way/squash merge into `main` will not revert those commits; a fast-forward replay of the two-dot diff or a stale-base merge would clobber them. **Action for the human at PR/merge time:** update the branch onto current `main` before merging. Not a code defect and not fixable by re-implementation, so it does not block this phase.

#### Optional Cleanup / Nit

> Style, naming, or minor improvements. Not blocking.

- **`resolveBudget()` now recomputes per `claude(phase)` call** _(flagged by anchored + cold-Claude, 2 lenses)_ instead of once via the prior `const budget` (`scripts/pipeline-policy.ts:259-262`). This is **spec-intended** — the spec's Decision section explicitly directs moving resolution "from a single call before the `claude: (phase) => …` closure … to inside that closure, since the result now varies per phase." `resolveBudget` is pure and O(1), the closure is called a handful of times per run, so the dropped memoization is negligible. No action needed; noted for completeness.

#### Spec Gaps

> Things Codex had to guess at because the spec was ambiguous, silent, or wrong.

(none)

### Dismissed Cold Findings

> Cold-lens findings dropped after verification.

- **Dismissed (cold-Claude): `BUDGET_BY_PHASE_AND_SIZE` type-totality / runtime-`undefined` risk** — verified non-issue. The map is `Record<ClaudePhase, Record<TaskSize, string>>` with all four `ClaudePhase` keys present, and `phase` is typed `ClaudePhase` end-to-end (call sites at `phases/{spec,plan,qa,code-review}.ts` and the two dynamic sites in `main.ts`), so no invalid phase reaches the lookup. Totality is a compile-time guarantee, not a runtime gap.
- **Dismissed (cold-Claude): budget-table off-by-one across code/test/docs** — verified non-issue; all three tables match cell-for-cell. Recorded as a clearing note, not a defect.
- **Dismissed (cold-Codex): no actionable regressions** — cold-Codex reviewed the branch diff adversarially and reported the split is implemented consistently across policy module, runtime wiring, docs, and tests with the full suite passing; no findings to adjudicate.
- **Dismissed (anchored): `docs/BACKLOG.md` / `docs/task-quality-log.md` carry the older flat-per-phase `CLAUDE_BUDGET` description** — out of scope and not stale. These are dated, append-only historical log/cut-decision records, not the current contract; the authoritative current description lives in the (updated) `docs/pipeline-orchestrator.md` matrix and the policy code. The spec's Docs Impact does not list them, and rewriting historical entries would falsify the record. (`docs/BACKLOG.md`'s appearance in the two-dot diff is the same stale-base artifact noted above.)
- **Dismissed (anchored): `npm test` count discrepancy (938+1 skip vs 939)** — informational only; no `Fail` in either run, so the validation gate is unaffected. Captured in the Validation Gate note above.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

The implementation is correct and complete against all 7 ACs with no code-bugs or spec-gaps. The one item warranting human attention is operational, not a code change: **update the branch onto current `main` before merge** so the two-dot diff's unrelated `CHANGELOG.md`/`docs/BACKLOG.md` reversions can't clobber `main` commits `697154b`/`bb84242`.
