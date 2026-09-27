# Code Review: anchored-lens-patterns-check

> Reviewer: Claude | Spec: `tasks/anchored-lens-patterns-check/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification (`npm run build` and E2E are correctly marked N/A per spec — agent charter files are not bundled into `dist/`)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `.claude/agents/code-review-anchored.md` Stage 2 adds the conditional patterns-check instruction naming `docs/patterns.md`, `Trigger Table`, and `TODO[canon]`; new test in `tests/run-task-prompts.test.ts` asserts all three tokens plus `_example_` phrasing is present in the added text. |
| AC-2 | Pass | The Return Format's category line (`- [correctness bug \| risk/guardrail \| optional cleanup/nit \| spec gap] ...`) is untouched by the diff hunk (added text lands above it); the new test pins this line verbatim via `assert.ok(anchored.includes(...))`. |
| AC-3 | Pass | Added text opens with "If the project keeps `docs/patterns.md`" — conditional, adopter-safe phrasing satisfying the Adopter Scope rule in AGENTS.md. |
| AC-4 | Pass | `.claude/agents/code-review-cold.md` has zero `patterns.md` matches (asserted by the new test); `git diff --name-only main...HEAD` touches only `.claude/agents/code-review-anchored.md`, its `templates/` mirror, and the test file — `src/orchestrator/prompts/templates/code-review-foreman.md` and `.canon/templates/review.md` are untouched. |
| AC-5 | Pass | `templates/.claude/agents/code-review-anchored.md` is byte-identical to the root file (confirmed via diff; `npm run sync-templates:check` passed per handoff). |

### Dropped Sections Check

- [x] Non-goals respected (no new finding category, no foreman/cold-lens/`review.md`-template edits, no `docs/patterns.md` content changes)
- [x] Known Risks addressed or documented as accepted (review cost, noise, and canon-on-canon self-application risks are all inherent to the design and not mitigated further — correctly left as accepted tradeoffs per spec)
- [x] Human Test Plan is satisfiable by the implementation (conditional guidance and placeholder-skipping are both present in the charter text)

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

A small, well-scoped charter-text change: one paragraph added to the anchored lens's Stage 2 instructions, mirrored to the adopter template, with a structural regression test. All three lenses (anchored, cold-Claude, cold-Codex) independently reached an approve signal with no correctness bugs. Two low-severity, low-confidence cold-Claude observations survive as nits below; neither holds up as a blocking defect against the current spec and code.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Trigger Table staleness not covered by the fallback clause** (cold-Claude; low severity, low confidence) — `.claude/agents/code-review-anchored.md:30` only instructs a full-file skim when the Trigger Table is entirely absent ("or skim the file if it has none"), with no explicit fallback for a Trigger Table that exists but omits a row for the touched files. Verified against the spec: the Decision section's wording is "use its Trigger Table (or skim the file if there is none)" — the charter text matches the spec's own phrasing exactly, so this is inherited from the spec's chosen design, not an implementation slip. Kept as a nit rather than a spec-gap because the risk is speculative (a stale-but-present Trigger Table is a real but unaddressed edge case already implicit in "use the Trigger Table," not a concrete failure the spec got wrong).
- **New test only pins substrings, not full instruction semantics** (cold-Claude; low severity, medium confidence) — `tests/run-task-prompts.test.ts:702-712` asserts presence of `docs/patterns.md`, `Trigger Table`, `TODO[canon]`, and the category line, but doesn't assert the round-scoping clause ("Apply this check in every round, limited to code changed by the diff") or the placeholder-skipping behavior beyond the bare token. A future edit could narrow that guidance while keeping the asserted substrings and the test would still pass. This is a coverage-thoroughness observation about the test's blast radius, not a case of the test currently passing against broken behavior (AC-1's own verify text only requires the three tokens, so the test satisfies its AC as written).

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): "Foreman template not updated to mention the new patterns.md check" (`src/orchestrator/prompts/templates/code-review-foreman.md:82-90` vs. the anchored charter) - the cold lens itself flagged this as likely a non-issue given the charter is self-contained; verified against the spec, AC-4 explicitly requires the foreman template be left untouched (it's designed to delegate entirely to the anchored charter file, which every lens invocation reads fresh), so this is spec-intended scoping, not a missed duplicate-surface update.

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
