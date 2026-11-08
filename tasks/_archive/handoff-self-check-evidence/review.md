# Code Review: handoff-self-check-evidence

> Reviewer: Claude | Spec: `tasks/handoff-self-check-evidence/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored (`STAGE_1: pass`, `OVERALL_SIGNAL: approve`), cold-Claude (`COLD_OVERALL_SIGNAL: approve`, 10 low-severity findings), cold-Codex (no findings; full suite 2,124 pass / 1 skipped, plus type-check, lint, sync-templates, docs-refs).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did the implementer's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (Red-First Evidence row against pre-fix code, a [wrong-premise] Blocker, or the environment-bound escape's outcome) — N/A: the spec states no red-first ACs
- [x] Self-Check evidence in the effective record is not contradicted by the diff (applied from this task's own new checklist item: the anchored lens re-ran the stated restatement searches; the only hits outside Affected Files are the ones the row names, and none restates the gate's check list; the test counts and sibling paths match)

Anchored lens re-ran type-check, lint, `sync-templates:check`, `docs-refs-check` (all pass) and `npm test` (2,124 pass, 1 fail in `tests/run-task-signals.test.ts` "SIGTERM shutdown writes exactly one exit marker" — not touched by this diff, passed 3/3 when run alone; cold-Codex's full-suite run had no failure, so treated as a load-timing flake, not a regression).

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: handoff template Self-Check section + iteration subsection | Pass | `.canon/templates/handoff.md`: `## Self-Check` between Red-First Evidence and Validation Outcomes, three placeholder rows, N/A / `\|` / citation guidance; iteration `### Self-Check` between `### Red-First Evidence` and `### Re-run validation` with the supersession text. Pinned in `tests/red-first-evidence-template.test.ts`. |
| AC-2: invalid handoffs reported by both gates | Pass | `tests/run-task-validation.test.ts`: 18 invalid cases, each through `classifyPreflightBlockers` and `validateHandoff`, asserting identical messages, `format` bucket, and message regex; covers (a)–(f) and all five bare-N/A forms. |
| AC-3: tolerated variants | Pass | 11 valid variants pass both gates, including `## Self-check`, bold labels, escaped `\|`, dash forms, placeholder Iteration rows. |
| AC-4: `format` bucket, "Fix the handoff", counter | Pass | Routing test asserts `format`, implement route, `### Fix the handoff` in review.md, `preflight_rejections_current_loop` = 1; `src/orchestrator/validation.ts` maps `selfCheckIssues` through `format`. |
| AC-5: prompts | Pass | Goldens updated for `promptImplement_fresh`, `promptImplementReroute`, `promptImplementReroute_resumed`, `promptImplementRevisions`; new `promptImplementRevisions_preflight` key; resume assertion added. |
| AC-6: anchored charter | Pass | Stage 1 item 6 follows red-first item 5 with the effective-record rule and both examples; Stage 2 omission rule added; no implement template named; root and mirror identical. |
| AC-7: foreman re-review instruction | Pass | Sentence added beside the red-first instruction; round-2 / roundN / deltaRound goldens updated. |
| AC-8: review template checklist item | Pass | Item added after the red-first item; parse test passes. |
| AC-9: pass-expected fixtures | Pass | Fixtures updated in `tests/run-task-code-review.test.ts`, `tests/recovery-hints.test.ts`, `tests/run-task-safety-helpers.ts`, classifier fixture; suite green (see flake note above). |
| AC-10: docs | Pass | `docs/pipeline-orchestrator.md` + mirror, `docs/architecture.md` (steps + gates), `docs/codebase-map.md`, new `docs/decisions.md` entry; `docs-refs-check` passes. |
| AC-11: template mirrors | Pass | `sync-templates:check` in sync. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work) — `checkImplementEvidence`, cold lenses, foreman verdict rules, QA unchanged
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The gate is small and mirrors the AC Coverage precedent: one `checkSelfCheckEvidence` helper shared by both entry points, fails closed on missing sections and rows, and is covered by a parity matrix that runs every case through both gates. No lens found a correctness bug. The surviving findings are about the parser's handling of edge-case authoring mistakes (misleading messages or a lenient placeholder test). None of them lets an unfilled section through in the template's own shape, and none breaks an AC.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none blocking)

#### Optional Cleanup / Nit

1. **Two-cell rule is a fifth rejection rule beyond Decision 3** — `src/orchestrator/validation.ts:274` — flagged by 2 lenses (anchored, cold-Claude). An unescaped `|` in a Restatement sweep pattern (`grep -E 'a|b'`) gets rejected and uses up a pre-flight round. **Accepted as-is:** the handoff records it as a deviation, AC-1 and the template require `\|` for literal pipes, AC-3 only requires the *escaped* form to pass, and the rejection message names the row and the escape. Without the rule, an unescaped pipe silently cuts off the evidence, so cell-level rejection matches the implement prompt's "Parsing Structured Input" rule. If the rejection rate turns out high in practice, a follow-up could read `cells.slice(1).join('|')` as the evidence instead. Altitude: nit (not `code-bug` — the behavior matches the spec's pipe contract).
2. **Placeholder detection is leading-`_(` only** — `src/orchestrator/validation.ts:278` — flagged by 2 lenses (anchored, cold-Claude). Wrapped placeholders (`**_(…)_**`, `` `_(…)` ``) and a literal `N/A — <reason>` copy pass as filled. The bare-N/A check strips `*_` but the placeholder check does not. The spec's Implementation Notes endorse the leading-marker approach, and judging truth is the anchored lens's job, so this is low impact. Applying the same `*_\`` strip before the `_(` test would make the two checks consistent.
3. **Heading anchored at both ends gives a misleading "missing" message** — `src/orchestrator/validation.ts:260` (anchored). `## Self-Check (evidence)` or `## Self-Check Evidence` gets "section is missing". The gate still fails closed, but the message points at the wrong fix.
4. **A table with no header row loses its first data row** — `src/orchestrator/validation.ts:263` (cold-Claude). `scanTableBlocks` treats `| Test integrity | … |` as the header, so the gate reports that row as missing. Fails closed, with a misleading message.
5. **First `## Self-Check` H2 anywhere is treated as the baseline** — `src/orchestrator/validation.ts:260` (cold-Claude). A filled H2 `## Self-Check` that a revision appends *after* `## Iteration N` passes the gate, and a second H2 is ignored. Structurally it is an H2 section and the evidence exists, so the anchored lens can still judge it. This only conflicts with the "repair in place" wording, so it stays a nit.
6. **`scanSpecManifest` reused for handoff parsing** — `src/orchestrator/validation.ts:259` (anchored). The name says spec, and a comment explains the reuse. A neutral alias would read more clearly.
7. **`docs/architecture.md:88,188` name `validateHandoff()` as the live pre-flight** (cold-Claude). The live gate is `classifyPreflightBlockers`, and `validateHandoff` is now test-only parity. The naming predates this task (the diff only adds a list item), but the line could be corrected the next time someone touches it.
8. **AC-4 counter asserted at the helper level** — `tests/run-task-validation.test.ts:4780` (anchored). The test checks `taskPhasePreflightRejected` directly rather than driving `runCodeReviewPhase` end to end. The phase code doesn't branch on the bucket, so the risk is small. AC-4's wording ("a test that drives pre-flight classification … asserts the bucket and the framing") is met.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): Review-findings revision branch never tells an upgraded in-flight task to add a missing baseline `## Self-Check` - the spec accepts this cost explicitly: Judgment Calls "Grandfathering in-flight tasks" chose "the first pre-flight after upgrade rejects … the fix-in-place message makes it a one-round cost", and AC-5 puts the in-place baseline repair in the pre-flight branch, which is where the rejection lands.
- Dismissed (cold-Claude): `checkImplementEvidence` (implement-exit gate) doesn't run `checkSelfCheckEvidence` - spec Non-Goals "`checkImplementEvidence` is unchanged" and Judgment Calls "Implement-done evidence guard … Matches the AC Coverage precedent". This is deliberate, not a missed sibling. The stale `main.ts:3435` comment it mentions predates this task and is outside Affected Files.
- Dismissed (cold-Claude): Resume path (`promptImplementResume`) drops the `{{#selfCheck}}` block - AC-5 scopes the resume change to "the prompt's handoff summary names the Self-Check section", which the diff does and a test pins. A resumed session continues a session that got the fresh prompt, and canon's own handoff template carries the table shape. The adopter-override edge case still fails closed with a row-named message.
- Dismissed (cold-Claude): Round N review-template section lacks a Self-Check re-check item - AC-8 scopes the template change to the Stage 1 checklist, and the per-round re-check is carried by the foreman's Round N instruction (AC-7) and the anchored charter. Red-first uses the same split, so this is a consistent design choice, not a gap.
- Dismissed (cold-Claude): No CHANGELOG entry - canon-ai writes CHANGELOG entries at release time (the canon-changelog flow), not per task branch.
- Dismissed (cold-Codex): (no findings returned)

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

## Round N — verifying iteration N-1's response to round N-1

**Scope:** Full | Delta — base `<baseBranch or prevSHA>` — reason: <trigger reason, or "delta">

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
