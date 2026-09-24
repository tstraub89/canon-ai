# Code Review: default-codex-models-to-gpt-6-generation

> Reviewer: Claude | Spec: `tasks/default-codex-models-to-gpt-6-generation/spec.md`
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

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Defaults bumped in both config copies | Pass | `env.ts`/`policy.ts` fall back to `gpt-6-luna`/`gpt-6-sol`; override chains byte-identical. Grep returns exactly 4 lines. |
| AC-2: No current-state surface names retired defaults | Pass | Required grep returns zero results; `docs/pipeline-orchestrator.md` + synced `templates/` mirror show GPT-6 defaults; `sync-templates:check` passes. |
| AC-3: Headless paragraph present | Pass | `CODEX_STARTUP` conveys all four required elements (non-interactive, ambiguity → artifact + `[ambiguity]` Blocker, finish authorized work without scope expansion, always end by writing artifact + running phase command). New resume-strip test covers `promptSpecReview`, fresh `promptImplement`, `promptImplementRevisions`. |
| AC-4: Narrow ask/approval precedence | Pass | Line present, scoped to ask/wait-for-approval only; `git grep "AGENTS.md\|CLAUDE.md" -- src/orchestrator/prompts/helpers.ts` returns zero results. |
| AC-5: Dead branch-sync instruction replaced | Pass | "Branch sync", `git fetch`, `git pull` all removed; replaced with the orchestrator-manages-branch-state sentence. Git-ownership rule and `[pipeline]` Blocker text unchanged. |
| AC-6: Three "stop" instructions reworded | Pass | All three literal phrases removed (grep confirms); each now says don't make the edit/fix, record the labelled Blocker, finish remaining in-scope work, handoff, and phase command. Surrounding rules (no-fabricated-outcome, environment-bound escape, no-silent-scope-expansion) preserved verbatim. |
| AC-7: Resume stripping test | Pass | New test asserts `toResumePrompt` strips `CODEX_STARTUP` and output starts with `[Resumed session` for the three named prompt types; passes. |
| AC-8: Stale "5.6-generation" pointers updated | Pass | `docs/product-context.md` and `pipeline-policy.ts` comment both say GPT-6-generation; product-context points at the new decisions.md heading. Grep returns zero results. |
| AC-9: Dated decisions.md entry | Pass | New entry covers all seven required sub-points (a)–(g); 2026-07 entry left intact as history. |
| AC-10: Build and goldens current | Pass | `npm run build` produces no dist drift; `UPDATE_GOLDENS=1 npm test` then `npm test` both clean (1223/1223); only the 7 expected golden keys changed. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work — effort tiers, reviewer prompts, `implement-reroute.md`, Claude models, CHANGELOG, adopter-file assertions, historical `5.6` references all untouched)
- [x] Known Risks addressed or documented as accepted (bias-to-action wording ties completion to *authorized* work; precedence line is narrowly scoped per AC-4; goldens diff was checked, not blindly trusted)
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

A narrow, mechanical rebaseline: two duplicated config fallback strings updated identically in both source copies and both `dist/` bundles, one shared `CODEX_STARTUP` prompt block rewritten and correctly propagated into every golden-tested prompt variant that includes it, three "stop"-worded escape hatches reworded consistently across two templates, and docs/decisions updated to match. Anchored, cold-Claude, and cold-Codex lenses all agree the change is correct and well-scoped; the only surviving finding is a cosmetic markdown-structure slip introduced alongside an otherwise-correct wording edit.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **List-nesting slip in `src/orchestrator/prompts/templates/implement-revisions.md:43`** (flagged by 2 lenses: anchored + cold-Claude). The reworded "Bug/flake-fix red-first checkpoint" bullet gained a 3-space indent it didn't have before, nesting it under the unrelated "Rerouted / revised tasks — the pre-flight diff is cumulative" bullet on line 42, instead of remaining a sibling top-level item in the "Iteration rules" list. The spec only asked for a wording change to the "stop" phrase (AC-6); this indentation shift wasn't requested and isn't covered by any AC's grep check. Low severity: this is a plain-text prompt Codex reads verbatim, not rendered HTML, so the model is unlikely to misparse the rule's applicability — but it's an unintended structural diff that degrades the template's own markdown correctness for human readers and should be fixed to keep the bullet at the top level.

#### Spec Gaps

(none)

### Dismissed Cold Findings

(none — cold-Codex reported no actionable issues; cold-Claude's sole finding is the nit above, kept rather than dismissed)

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
