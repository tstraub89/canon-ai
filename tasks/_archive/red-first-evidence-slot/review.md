# Code Review: red-first-evidence-slot

> Reviewer: Claude (foreman) | Spec: `tasks/red-first-evidence-slot/spec.md`

Synthesized from three lenses: anchored Claude, cold-Claude, and pre-obtained cold-Codex (which returned a clean summary with no findings and confirmed the template mirror check passes).

**Scope:** Full — base `main` — reason: Round 1 (initial review)

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification
- [x] Red-first evidence recorded for each red-first AC (none required: the spec states no red-first test applies to this task; handoff Edge Cases says the same)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: handoff template `## Red-First Evidence` section | Pass | Single H2 between Blockers and Validation Outcomes, guidance note, five columns, "none" placeholder row; asserted in `tests/red-first-evidence-template.test.ts`. |
| AC-2: `[wrong-premise]` in Blockers + Iteration skeleton subsection | Pass | Blockers names both labels; commented skeleton has `### Red-First Evidence` with the same five columns. |
| AC-3: three implement prompts | Pass | Each names the section and pre-fix state (base commit / branch HEAD before this round's edits); revisions recovery and reroute carry-forward present; old "Report the red run" gone; goldens regenerated. Anchored lens ran the prompt tests: 57 pass. |
| AC-4: anchored charter Stage 1 item | Pass | Item 5 implements Decision 3 including late-evidence acceptance; no internal template named; sync check passes. |
| AC-5: foreman round-2+ directive + review template checkbox | Pass | Directive keeps the Iteration pointer and adds the whole-handoff sentence; checkbox present at `.canon/templates/review.md:22`. |
| AC-6: no orchestrator code reads the section/label | Pass | Grep matches only `src/orchestrator/prompts/index.ts:157`, under `src/orchestrator/prompts/`. |
| AC-7: mirrors in sync, dist rebuilt | Pass | `sync-templates:check` passes; rebuild leaves `dist/` unchanged; bundle carries the new text. |
| AC-8: `docs/decisions.md` entry | Pass | Cites "The validation-outcome pre-flight is structural, not spec-matching" (matches `docs/pipeline-orchestrator.md:399`); Stage 1 scope list updated. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The change is small, consistent across template, charter, prompts, goldens, and dist, and respects the no-pre-flight decision. No surviving correctness bugs. Remaining items are low-severity nits.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Reroute prompt placement ambiguity** (flagged by 2 lenses: anchored, cold-Claude; low severity). `src/orchestrator/prompts/templates/implement-reroute.md:22,28` — step 7 says to rewrite handoff.md wholesale, while line 28 says to record new rows in "this round's Iteration subsection". A rewritten handoff may have no Iteration section, so the implementer must invent one or use the baseline table. This is spec-mandated wording (AC-3 and the handoff Deviations row), and the anchored charter reads across both locations, so the failure mode is mild ambiguity, not a missed check. Not blocking.
- **Charter test is loose** (anchored + cold-Claude; low). `tests/red-first-evidence-template.test.ts` uses independent substring matches (`/pre-fix/`, `/Red-First Evidence/`) over all of Stage 1; dropping the late-evidence clause would not fail it. The test's `handoff.slice(indexOf('<!--'))` also takes the first HTML comment, which breaks if an earlier comment is added. Consider tightening both.
- **Typographic apostrophes** (cold-Claude; low). The new text in the implement prompts uses `’` where neighbouring text uses `'`, and the test regexes depend on the curly character. Cosmetic; normalize with the test in the same edit if touched again.
- **Iteration skeleton lacks revision-recovery note** (anchored; low). The `### Red-First Evidence` skeleton note says only "Include only when…", while the revisions prompt covers adding missing evidence. Consistent with the spec.
- **Docs mention** (anchored; low confidence). `docs/pipeline-orchestrator.md` does not mention red-first evidence in Stage 1; the spec's Docs Impact leaves this to QA.

#### Spec Gaps

(none surviving; the reroute placement ambiguity above stems from the spec's own wording but is low severity and does not block.)

### Dismissed Cold Findings

- Dismissed (cold-Claude): reroute carry-forward appears only in step 7 and nothing checks rows are preserved - the spec adds no mechanical check by design (Non-Goals, `docs/decisions.md`); the anchored lens's missing-row check is the backstop.
- Dismissed (cold-Claude): round-1 foreman prompt does not repeat "read across the whole handoff" - the charter carries it, and AC-5 scopes the directive to round 2+; a test pins the asymmetry deliberately.
- Dismissed (cold-Claude): fresh-implement prompt gives no way to identify the base commit - the status.json/git history names it, and the spec states the pre-fix state as the base commit; a recorded branch-HEAD hash equal to base is acceptable.
- Cold-Codex: no findings returned; nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement
