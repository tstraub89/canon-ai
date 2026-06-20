# Code Review: adopter-agent-file-redesign

> Reviewer: Claude | Spec: `tasks/adopter-agent-file-redesign/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from two review lenses: an anchored lens that applies the Stage 1 / Stage 2 charter below, and a cold lens that reads only the diff. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: strip — structural post-condition | Pass | git grep over full tree confirms no surviving "read AGENTS.md/CLAUDE.md" instruction or "rule X lives in AGENTS.md/CLAUDE.md" claim in non-allow-listed surfaces. All surviving hits map to categories (a)–(g): operational code (init.ts, doctor.ts, docs-refs-check.mjs), decision records (decisions.md), README adopter recommendation, test files, "adopter-owned, when present" descriptions, canon-ai consolidation artifacts (CLAUDE.md @AGENTS.md import), and accurate operational/CI descriptions. |
| AC-2: reframe rule-home framing | Pass | README, docs/product-context.md, docs/patterns.md, and docs/pipeline-orchestrator.md reframed to auto-load + JIT reality. Lint/TS trigger-table cell in patterns.md repointed to `scripts/run-task/prompts/templates/implement.md`. No surviving prose implies canon/pipeline reads agent files or that a rule lives in them. |
| AC-3: /canon-init scoped to docs corpus | Pass | SKILL.md Phase 0 and write-guide.md drop the read-as-context instruction; README no longer claims /canon-init generates or reads agent files. Built-in /init recommended for agent-file creation. |
| AC-4: README recommendation | Pass | README recommends built-in /init for agent files and documents the optional @AGENTS.md consolidation. RECOMMENDED_NUDGE↔README drift test still passes. |
| AC-5: doctor advisory | Pass | `checkCanonDiscoveryNudge` correctly implements two warn states: absent files → warn with /init guidance; files exist but neither mentions canon → warn with nudge. Never returns fail. Tests in tests/cli.test.ts cover both warn branches and the pass case. |
| AC-6: consolidation — audience-split | Pass | CLAUDE.md = @AGENTS.md import + ## Conversational Operator Norms with exactly four norms (commit consent, default smaller models, don't intervene in spec_review, never self-review). AGENTS.md = shared overview; grep confirms the four operator norms are absent from AGENTS.md. |
| AC-7: not re-managed — structural | Pass | src/lib/canon-owned.ts has neither AGENTS.md nor CLAUDE.md in CANON_OWNED or DELIMITED. |
| AC-8: templates mirrors in lockstep | Pass | All five skill mirrors and docs/pipeline-orchestrator.md mirror updated; sync-templates:check passes. |
| AC-9: decision record | Pass | "reads them as adopter-owned context only" is absent from docs/decisions.md. Existing entry's Rule corrected. New "Agent files come from built-in /init" entry appended. |
| AC-10: build + validation clean | Pass | dist/ rebuilt; lint, type-check, tests, docs-refs-check, sync-templates:check all pass. Prompt golden unchanged. |
| AC-11: init scaffold notice drops read claim | Pass | `existingAgentFilesNoticeLines()` says "adopter-owned; canon does not insert, merge, or read managed content into them" — no read-as-context claim. Tests updated in lockstep. |

### Dropped Sections Check

- [x] Non-goals respected — no prompt-template edits, no delicate orchestrator surfaces, no CANON_OWNED additions
- [x] Known Risks addressed — base-drift gate completeness handled via AC-1 structural grep; operator norm placement enforced by AC-6 audience-split
- [x] Human Test Plan is satisfiable by the implementation (doctor advisory, CLAUDE.md @-import, README guidance, and skills all address test plan steps 1–5; step 6 is a manual session exercise deferred to human_review)

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Implementation is clean and coherent. The strip-and-reframe was executed consistently across docs, skills, runtime banners, source, dist, and tests. All validation checks pass. One dangling cross-reference was missed when write-guide.md was updated: SKILL.md Phase 4's intro still promises that write-guide.md covers "how to use adopter-owned agent files as context" — but that section is no longer in write-guide.md. The remaining findings are low-severity nits.

### Findings

#### Correctness Bugs

**1. SKILL.md:108 — dangling Phase 4 cross-reference to write-guide.md for removed guidance**
*(flagged by both lenses; confirmed)*

`.claude/skills/canon-init/SKILL.md:108` reads:

> "For the section-by-section breakdown of what goes in each doc — `docs/product-context.md`, `docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/lessons-learned.md`, **plus how to use adopter-owned agent files as context** — see [write-guide.md](write-guide.md)."

The diff correctly removed the "read them as project context" guidance from write-guide.md's `## Agent config files — adopter-owned` section (AC-3). But the Phase 4 intro in SKILL.md still promises write-guide.md covers "how to use adopter-owned agent files as context." An agent following Phase 4 and reading write-guide.md will find no such guidance — the referenced content was deleted.

**Fix**: Update the Phase 4 intro sentence to remove the "plus how to use adopter-owned agent files as context" clause. The sentence can simply enumerate the docs corpus files without promising agent-file guidance that no longer exists in write-guide.md.

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

**2. `§"Human Reroute."` banner format does not match actual section heading**
*(cold lens only)*

`scripts/run-task/cli.ts:159` and `src/cli/index.ts:99` both print `§"Human Reroute."` (with surrounding double-quotes and a trailing period). The actual heading in `docs/pipeline-orchestrator.md:415` is `## Human Reroute` — no quotes, no period. An operator trying to locate the section via Ctrl+F won't get an exact match on the quoted form. Low severity; the section is identifiable. The dist files mirror the source correctly — no source/dist divergence.

**3. docs/patterns.md:56 step 8 directs to CLAUDE.md for conversational-operator implications**
*(anchored lens)*

Step 8 of Phase Addition Discipline says to document "conversational-operator implications in CLAUDE.md." This remains accurate for canon-ai's thinned CLAUDE.md (the Conversational Operator Norms section is the right home for new operator norms), but the reference is now somewhat opaque since CLAUDE.md is an 8-line file. Not blocking — the pointer is technically correct.

#### Spec Gaps

(none — the SKILL.md:108 gap is an implementation oversight, not a spec ambiguity)

### Dismissed Cold Findings

- **Dismissed (cold): "doctor.ts warn detail says 'add this to CLAUDE.md' even when only AGENTS.md exists"** — This behavior is pre-existing (the `RECOMMENDED_NUDGE` constant and the "add this to CLAUDE.md:" message were present before this diff). The diff only added the new early-return branch for the absent-files case; the silent-files warn path was not changed. Not a regression introduced by this diff.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** — root cause is the spec, not the code; halt for human instead of routing to implement

**One-line fix required**: remove the "plus how to use adopter-owned agent files as context" clause from `.claude/skills/canon-init/SKILL.md:108` Phase 4 intro. The template mirror `templates/.claude/skills/canon-init/SKILL.md` must be updated in lockstep. No other changes are required.

---

## Round 2 — verifying Iteration 2's response to Round 1

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from Round 1) | Iteration 2 touched only SKILL.md/template Phase 4 intro — no AC-1 grep surfaces changed. |
| AC-2 | Met (unchanged from Round 1) | README, docs/product-context.md, docs/patterns.md, docs/pipeline-orchestrator.md reframing not touched. |
| AC-3 | Met | SKILL.md Phase 4 intro and both write-guide.md copies contain no claim that /canon-init generates or reads agent files. "Adopter-owned agent files as context" clause fully absent from both canonical and template copies; byte-identical confirmed. |
| AC-4 | Met (unchanged from Round 1) | README /init recommendation not touched. |
| AC-5 | Met (unchanged from Round 1) | checkCanonDiscoveryNudge and tests not touched. |
| AC-6 | Met (unchanged from Round 1) | CLAUDE.md and AGENTS.md content not touched. |
| AC-7 | Met (unchanged from Round 1) | CANON_OWNED/DELIMITED exclusions not touched. |
| AC-8 | Met | Both canonical SKILL.md and template mirror are byte-identical after Iteration 2 fix; lockstep confirmed. |
| AC-9 | Met (unchanged from Round 1) | decisions.md not touched. |
| AC-10 | Met (unchanged from Round 1) | Iteration 2 changes are pure .md text edits; build artifacts, lint, type-check, tests re-verified as described in handoff Iteration 2 (docs-refs Pass, sync-templates:check Pass). |
| AC-11 | Met (unchanged from Round 1) | existingAgentFilesNoticeLines() not touched. |

### Verifying Round 1 findings

- _correctness bug:_ "dangling Phase 4 cross-reference — SKILL.md promised write-guide.md covers 'how to use adopter-owned agent files as context' but that section was removed" → fixed at `.claude/skills/canon-init/SKILL.md:105` and `templates/.claude/skills/canon-init/SKILL.md:105`; clause confirmed absent from both files ✓

### Dismissed Cold Findings (Round 2)

- **Dismissed (cold): "write-guide.md `## Agent config files — adopter-owned` section still present but no longer mentioned in Phase 4 intro"** — The remaining section correctly states the files are adopter-owned and directs agents to use built-in /init. The Phase 4 intro no longer promises "how to use them as context" because that guidance (read them) was intentionally removed by this task. The section that remains is accurate and appropriate. Behavior is spec-intended.
- **Dismissed (cold): "Phase 0 no longer instructs agents to read agent files"** — This is the core purpose of the task: the spec explicitly requires canon to stop instructing agents to read adopter agent files (AC-3, spec Decision 1). The behavioral delta is intentional.
- **Carry-over nit: `§"Human Reroute."` format** — Deferred (unchanged from Round 1 nit; not blocking).

### New findings (Iteration 2 only)

(none)

### Verdict for this round

- [ ] Approved
- [x] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

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

## Round 3 — verifying Iteration 3's response to Amendment ACs

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from Round 2) | Iteration 3 adds AGENTS.md opener describing canon — no new rule-home or read-as-context framing; anchored lens re-ran the strip grep and confirmed clean. |
| AC-2 | Met (unchanged from Round 2) | Not touched by Iteration 3. |
| AC-3 | Met (unchanged from Round 2) | Not touched by Iteration 3. |
| AC-4 | Met (unchanged from Round 2) | Not touched by Iteration 3. |
| AC-5 | Met (unchanged from Round 2) | Not touched by Iteration 3. |
| AC-6 | Met — content; Partial — test | AGENTS.md content is clean: anchored lens grep confirms all four operator norm texts absent. But `tests/cli.test.ts` audience-split test only asserts `doesNotMatch(agents, /Always-On Operator Norms/)` — it does not assert absence of the four actual norm texts. If any norm were re-introduced to AGENTS.md, the test would pass falsely. See finding below. |
| AC-7 | Met (unchanged from Round 2) | Not touched by Iteration 3. |
| AC-8 | Met | Iteration 3 changes only AGENTS.md and README.md (neither is canon-owned); no mirror update needed; sync-templates:check passes. |
| AC-9 | Met (unchanged from Round 2) | Not touched by Iteration 3. |
| AC-10 | Met | Iteration 3 is pure doc/test edits; no source change; no dist rebuild required. lint, type-check, tests, docs-refs-check, sync-templates:check all reported Pass in handoff. |
| AC-11 | Met (unchanged from Round 2) | Not touched by Iteration 3. |
| A1 | Met | README has `@AGENTS.md` consolidation at the /init guidance section (the `### Generate your agent files with the built-in /init` block, distinct from the discovery-nudge block); handoff confirms A1 grep re-verified. |
| A2 | Met | AGENTS.md opener (lines 3–5): TypeScript/Node CLI, npm package, scaffolds pipeline, dogfoods on itself — all three orientation facts present. |
| A3 | Met | AGENTS.md line 45: "`AGENTS.md` and `CLAUDE.md` are not part of the managed set; they have no `templates/` mirror and need no sync." |
| A4 | Met | AGENTS.md Stack section (line 31): `npm run build`, `npm test`, `npm run lint`, `npm run type-check`. |
| A5 | Met | AGENTS.md Where to Go Deeper (line 55): `docs/release-process.md` present. |
| A6 | Met | AGENTS.md Conventions (line 48): "The managed set lives in `src/lib/canon-owned.ts` as `CANON_OWNED` and `DELIMITED`; add managed files there, not here." |

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2 / findings
- [ ] **Fail** — skip Stage 2, final verdict is `Changes requested`

### Verifying Round 2 findings

Round 2 verdict was **Approved with nits** — no blocking findings; carry-over nit (`§"Human Reroute."` banner format) remains deferred and is not blocking.

### New findings (Iteration 3 only)

#### Correctness Bugs

**1. `tests/cli.test.ts` — AC-6 audience-split test guards old header, not the four operator norm texts** *(code-bug; test integrity; flagged by anchored lens)*

`tests/cli.test.ts` audience-split test asserts `doesNotMatch(agents, /Always-On Operator Norms/)` to verify AC-6's requirement that "none of the four operator norms appear in `AGENTS.md`." This guards the old section heading that no longer exists — it does not assert the absence of the four actual norm texts. If any of the following were re-introduced to `AGENTS.md`, the test would pass falsely:

- "Ask before committing"
- "Default to the smallest model"
- "Do not intervene in full-tier `spec_review` auto-revision"
- "Never self-review inline work"

AGENTS.md is currently clean (anchored lens confirmed via grep). The gap is forward-looking test coverage, not a current content failure.

**Fix**: In `tests/cli.test.ts`, after the existing `doesNotMatch(agents, /Always-On Operator Norms/)` assertion, add:

```typescript
assert.doesNotMatch(agents, /Ask before committing/);
assert.doesNotMatch(agents, /Default to the smallest model/);
assert.doesNotMatch(agents, /Do not intervene in full-tier/);
assert.doesNotMatch(agents, /Never self-review inline work/);
```

### Dismissed Cold Findings (Round 3)

- **Dismissed (cold): "`canon run --pr` and `canon run --ship` in Commands section missing `<id>` argument"** — Pre-existing from Iteration 1; reviewed and not flagged in Rounds 1–2; Commands section is an abbreviated quick-reference (none of the other commands show `<id>`); consistent with the doc's overview-level abstraction. Not raised per Round 3+ guidance (wording-only; not a new bug introduced by Iteration 3).
- **Dismissed (cold): "`doesNotMatch(claude, /## Role/)` regex matches `## Roles`"** — Nit; CLAUDE.md has no `## Roles`; not raised per Round 3+ guidance.
- **Dismissed (cold): "`assert.match(agents, /Communication/)` too broad"** — Nit; dismissed per Round 3+ guidance.
- **Dismissed (cold): WORKTREE_ROOT coupling in new tests"** — Pre-existing pattern from `tests/cli.test.ts`; established by prior review/lessons-learned as the correct approach for worktree-isolated runs.
- **Dismissed (cold): "Codex's init produces AGENTS.md — unverifiable external claim"** — Intentional product decision documented in spec and `docs/decisions.md`; low confidence finding.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

**One-line fix required**: add four `doesNotMatch` assertions for the four operator norm texts to the AGENTS.md audience-split test in `tests/cli.test.ts`. No other changes required.

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.

## Round 4 — verifying Iteration 4's response to Round 3

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged from Round 3) | Iteration 4 touches only tests/cli.test.ts; no new AGENTS.md/CLAUDE.md references introduced. |
| AC-2 | Met (unchanged from Round 3) | Not touched by Iteration 4. |
| AC-3 | Met (unchanged from Round 3) | Anchored lens confirmed "plus how to use adopter-owned agent files as context" remains absent from `.claude/skills/canon-init/SKILL.md`. |
| AC-4 | Met (unchanged from Round 3) | Not touched by Iteration 4. |
| AC-5 | Met (unchanged from Round 3) | Not touched by Iteration 4. |
| AC-6 | Met | Four new `doesNotMatch` assertions at `tests/cli.test.ts:881–884` guard the actual operator norm texts in addition to the retired heading. AGENTS.md confirmed clean of all four strings. Symmetric `assert.match` assertions on CLAUDE.md at lines 889–892 confirm the norms remain there. |
| AC-7 | Met (unchanged from Round 3) | Not touched by Iteration 4. |
| AC-8 | Met (unchanged from Round 3) | Not touched by Iteration 4. |
| AC-9 | Met (unchanged from Round 3) | Not touched by Iteration 4. |
| AC-10 | Met | Iteration 4 adds 4 test assertions; lint, type-check, unit tests re-ran and passed per handoff. |
| AC-11 | Met (unchanged from Round 3) | Not touched by Iteration 4. |
| A1–A6 | Met (unchanged from Round 3) | Not touched by Iteration 4. |

### Verifying Round 3 findings

- _correctness bug:_ "AC-6 audience-split test guards retired `Always-On Operator Norms` header but not the four operator norm texts — false-green if any norm re-introduced to AGENTS.md" → fixed at `tests/cli.test.ts:881–884`; four `doesNotMatch` assertions for the actual norm texts confirmed present ✓

### New findings (Iteration 4 only)

(none — both lenses returned approve signals; all cold findings were low-severity nits dismissed per Round 4+ guidance)

### Dismissed Cold Findings (Round 4)

- **Dismissed (cold): "Case-sensitive patterns could miss rephrased norms"** — Substring patterns targeting exact human-authored prose are standard for this guard type; deliberate rephrase is an out-of-scope regression vector. Nit; dismissed per Round 4+ guidance.
- **Dismissed (cold): "Pattern 3 backtick-specificity vs. patterns 1, 2, 4"** — Targets the exact CLAUDE.md phrasing; asymmetry is harmless. Nit; dismissed per Round 4+ guidance.
- **Dismissed (cold): "WORKTREE_ROOT reads live dogfood files, not scaffolded templates"** — Pre-existing pattern; intentional and established by lessons-learned.md. Dismissed.
- **Dismissed (cold): "`doesNotMatch`/`match` symmetry limits independent signal"** — Observation only; patterns syntactically valid and correctly targeted. Dismissed.

### Verdict for this round

- [x] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap
