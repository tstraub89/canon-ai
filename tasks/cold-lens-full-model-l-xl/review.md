# Code Review: cold-lens-full-model-l-xl

> Reviewer: Claude | Spec: `tasks/cold-lens-full-model-l-xl/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored (`STAGE_1: pass`, signal approve), cold-Claude (8 low-severity findings, signal approve), cold-Codex (no findings; "bundle behavior, model overrides, generated output, tests, and documentation are consistent").

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did the implementer's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (no AC is red-first; voluntary pre-fix rows for AC-1–AC-3 are recorded against e8e520f)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Policy cells | Pass | `src/lib/pipeline-policy.ts:259-260` L/XL → `codexModelFull`/high; XS/S/M stay mini/high. `tests/pipeline-policy.test.ts:253-254` pin `full`; spec_review/implement rows untouched. Focused run 22/22. |
| AC-2: Delicate and bundle promotion | Pass | Delicate-M test expects `full` (`tests/pipeline-policy.test.ts:268`); [S, L], [S, S-delicate] → full, [XS, M] → mini at `:271-279`. |
| AC-3: Invocation uses the resolved model | Pass | `tests/run-task-code-review.test.ts:1784` spawns a fresh process with distinct explicit `CODEX_MODEL_MINI`/`CODEX_MODEL_FULL`, drives the real `agentBackendFor('cold_reviewer', …)`, and asserts literal argv full/full/mini with `model_reasoning_effort=high`. Handoff records the pre-fix failure. |
| AC-4: No stale "flat mini" claim | Pass | Anchored lens re-ran the exact grep: sole hit `docs/decisions.md:358`, covered by the inline Superseded pointer. |
| AC-5: Named surfaces state the split | Pass | Policy comment, orchestrator matrix row, model prose, cold-lens paragraph, invocation placeholder (`<model>`), both env-var rows, both delicate passages, README rows, and `recovery.md` M→L note all updated; mirrors match. |
| AC-6: Decision recorded | Pass | New `## Cold-Codex lens uses the full model at L and XL/delicate (2026-11)` with Decision/Why/Rule, evidence caveat, model-clause-only supersession, previous-release rollback; no heading renamed; `docs-refs-check` passes. |
| AC-7: BACKLOG follow-up | Pass | Entry keeps the baseline numbers, both measures, and the M question; privacy grep clean on the entry and on added decisions/CHANGELOG lines. |
| AC-8: Changelog | Pass | `[Unreleased]` → `### Changed` bullet covers cells, `CODEX_MODEL_FULL` reach, bundle promotion, rollback. |
| AC-9: Mirror and build parity | Pass | `sync-templates:check` passes; fresh `npm run build` leaves `dist/` clean against HEAD. `dist/cli/index.js` contains no `codexMatrix` (only env defaults), so its byte-identical rebuild is correct; the spec's expectation that both bundles change was an over-assumption, not a gap. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

A two-cell policy change with strong coverage: pure-matrix tests for every cell and the promotion cases, plus a fresh-process test through the real backend that would fail on the old cells. All three lenses agree the code path resolves the cold-lens model only through the matrix, and no runtime restatement of "mini at every size" remains. Surviving findings are doc wording and measurement-hygiene nits; none changes behavior.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nit

- **N1 — earlier measurement cohort now confounded at L** (anchored; `docs/decisions.md:460`, code-bug altitude, nit). The 2026-10 entry's still-open measurement compares non-delicate XS–L `code_review` rounds before/after its date and excludes delicate "because their model also changed." Post-release non-delicate L tasks now also change the cold-lens model. A one-line note in the 2026-11 Rule (cut the L cohort at this release) would keep that comparison interpretable.
- **N2 — `CODEX_MODEL_MINI` purpose text is ambiguous for delicate** (cold-Claude; `docs/pipeline-orchestrator.md:310` + mirror). "non-delicate `spec_review` and `implement` at XS–L, and the cold-Codex review lens at XS–M" can read as delicate XS–M lens using mini. Suggest "the non-delicate cold-Codex review lens at XS–M".
- **N3 — CHANGELOG omits the deprecated `CODEX_MODEL_DELICATE` fallback** (cold-Claude; `CHANGELOG.md:9`). `src/orchestrator/policy.ts:31` makes it reach the lens too; `docs/decisions.md` names it, the adopter-facing bullet does not.
- **N4 — Rule's loop-count sentence omits delicate XS** (cold-Claude; `docs/decisions.md:631`). Delicate XS also resolves to XL with nominal cap 3; "delicate XS/S/M" would be exact. Hard-fail retries can also re-run the lens outside the loop cap, so "up to" is approximate.
- **N5 — curly apostrophes in new text** (flagged by 2 lenses: anchored + cold-Claude; `docs/decisions.md:358`, `:629`, `docs/pipeline-orchestrator.md:239`). `invocation’s`, `bot’s`, `replay’s`, `bundle’s` mix with the files' straight-quote style; the orchestrator doc ships to adopters.
- **N6 — doubled "in mixed mode" qualifier** (cold-Claude; `README.md:67`, `:100`). Wording only.
- **N7 — superseded 2026-09 entry still says "every XS–L phase to the mini model"** (flagged by 2 lenses; `docs/decisions.md:442`). That entry is already fully superseded by the 2026-10 entry, and spec Non-Goals forbid edits to superseded entries beyond supersession pointers, so no change is required; recorded for completeness.
- **N8 — no end-to-end bundle invocation case** (cold-Claude; `tests/run-task-code-review.test.ts:1784`). The real-backend test covers L, delicate M, and M but not a multi-task bundle; bundle promotion is pinned only at the policy level (which is where AC-2 assigns it, and `toPolicyInputs` is unchanged code). Not a test-integrity defect; optional strengthening.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): `docs/product-context.md:91` full-tier summary omits the cold-lens cells - the passage lists only implementation cells and points to the authoritative matrix; it states nothing false, and the spec's Docs Impact explicitly assessed it as "still accurate."
- Dismissed (anchored, self-flagged): new subprocess test vs. `docs/patterns.md` slow-test discipline - the spec's AC-3 explicitly requires a spawned process (env freezes at module load) and names the parity harness as the template; the test batches three cases into one spawn.

Cold-Codex returned no findings; nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.
-->
