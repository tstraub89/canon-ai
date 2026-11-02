# Code Review: spec-judgment-calls

> Reviewer: Claude | Spec: `tasks/spec-judgment-calls/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — the implementer reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from its lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below and a cold-Claude lens that reads only the diff. In mixed mode a third, cold-Codex lens, pre-obtained by the orchestrator as an unanchored diff review from a different model family, joins them; Claude mode has the anchored and cold-Claude lenses only. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lenses: anchored-Claude (returned, STAGE_1 pass, signal approve), cold-Claude (returned, signal changes_requested), cold-Codex (injected, one P2).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run (lint, type-check, full `npm test`, build, sync-templates:check, docs-refs-check)
- [x] No required checks were skipped without justification (one sandbox-gated linked-worktree test skipped; unrelated to this diff)
- [x] Red-first evidence recorded for each red-first AC (AC-9: base 972e468 failed on missing D; removing D from the spec-revision prompt failed; restore passed)

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Template section | Pass | `## Judgment Calls` between Decision and Non-Goals in `.canon/templates/spec.md`; D then S, five-column header, `Human`/`Author` with bulk-approval and revision-reset rules, `None — <reason>`. |
| AC-2: Self-check parity | Pass (with code-bug below) | Item present in all three lists; the `promptSpec` copy has an unclosed backtick (Finding 1). |
| AC-3: Pipeline author rules | Pass | Spec prompt bullet: D, S, fast-tier clause. Revision bullet: D, S, Author reset, no fast-tier clause. Neither sits between structural-caps and refactor-audit bullets. |
| AC-4: Skill author rule | Pass | `.claude/skills/canon-spec/SKILL.md` rules of thumb carry D, S, fast-tier clause. |
| AC-5: Grill rule | Pass | Recommended-answer bullet and "Always take a position" kept; runner-up/what-would-flip bullet added. |
| AC-6: Gate presentation | Pass | Phase 5 STOP lists `Author` rows or none; canon-pipeline gate paragraph names them. |
| AC-7: spec_review check | Pass | Prompt bullet has D, S, B, Blocking + `changes_requested`, missing-section-not-a-finding; silence paragraph unchanged. Shape Check in template and `docs/pipeline-orchestrator.md` carry D and S. Agent C item (11) STRONG; ten → eleven. |
| AC-8: QA output | Pass | done.md template section before Decisions Made; qa.md step 1 + output list item 5; step 4 PR-body routing covers no-template / template / appended heading / no rows. |
| AC-9: Canonical-text test | Pass | `tests/run-task-prompts.test.ts:1214`; D/S/B defined once, non-empty lists, files exist, red-first recorded. |
| AC-10: No tooling enforcement | Pass | `Judgment Calls` hits in `src/` only under `src/orchestrator/prompts/`; section-less fixture marked done at `tests/task-cli.test.ts:442-452`. |
| AC-11: Scope bound | Pass | No prohibited path in `git diff main`. |
| AC-12: Goldens and mirrors | Pass | Exactly the 7 named golden keys changed; sync-templates:check passed. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The guidance edits are tight, carry the canonical sentences verbatim across every required carrier, and stay inside the scope bound. One small but real defect slipped through: the `promptSpec` selfCheck string never closes its `None — <reason>` code span, and the regenerated goldens and `dist/` froze it. Everything else is nit-level or spec-intended.

### Findings

#### Correctness Bugs

1. **[code-bug] Unclosed backtick in `promptSpec` selfCheck** — `src/orchestrator/prompts/index.ts:177`. Flagged by 2 lenses (anchored-Claude, cold-Claude); verified. The line ends ``or says `None — <reason>',`` with no closing backtick, so the rendered spec prompt shows a broken code span and diverges from the other two AC-2 self-check carriers, which close it. The typo is frozen into `tests/run-task-prompts.golden.json` (`promptSpec`, `promptSpec_withDocsMap`) and `dist/orchestrator/run-task.js`. Fix: add the closing backtick, `npm run build`, regenerate those two golden keys (AC-12's key set is unchanged).

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `tests/run-task-prompts.test.ts:1253-1254` (anchored): rendered-prompt assertions cover `promptSpec` (D) and `promptSpecReview` (B) but not `promptSpecRevision` (D). Goldens cover rendering, so the gap is small; one `includes(D)` assertion would close it.
- `tests/run-task-prompts.test.ts:1214` (cold-Claude): the parity test pins D/S/B only, not the QA contract (`## Judgment Calls to Confirm` placement, PR-body routing) or the selfCheck line. Goldens cover these prompts; AC-9 asked only for D/S/B. Optional: a small assertion that `promptQa` names `## Judgment Calls to Confirm`.
- `src/orchestrator/prompts/templates/spec-revision.md:23` (cold-Claude, low confidence): a fresh revision session might relabel unchanged `Human` rows as `Author`, since it lacks the question-round context. Optional wording: "leave a row's Decided by unchanged unless its chosen option changes."

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex): [P2] severity mismatch — `.claude/skills/canon-spec-review/SKILL.md:71` says STRONG while the pipeline prompt says Blocking. Spec-intended: spec *Judgment Calls* row "Skill severity" chose STRONG for the skill over BLOCKING, following the skill's existing advisory split (as with the refactor-audit check), and AC-7 requires "item `(11)` at STRONG". This is not a stale restatement under AGENTS.md §Code Review Rules: the two surfaces deliberately carry different severities. Only cold-Codex flagged it, so there is no cross-model agreement to override.
- Dismissed (cold-Claude): `.canon/templates/spec-review.md:13` Shape Check omits bar B, the missing-section rule, and Blocking severity. Spec-intended: AC-7 requires that template's question to contain D and S only, and AC-9 deliberately scopes B's carriers to the pipeline prompt and the review skill. The template is the artifact skeleton; the reviewer's bar comes from the prompt.
- Dismissed (cold-Claude): authoring self-check requires the section, yet review says a missing section alone is not a finding. Spec-intended: spec *Judgment Calls* row "Section-less spec" and "Section required by tooling?" plus Non-Goals (Tooling enforcement), AC-10, and Decision 6.
- Dismissed (cold-Claude): `spec-review-reroute.md` (amendment review) got no judgment-call guidance. Explicit Non-Goal (Amendment-only review), *Judgment Calls* row "Amendment (reroute) spec_review", and AC-11 forbids touching that file.
- Dismissed (cold-Claude): runtime SPEC GATE banners (`src/orchestrator/main.ts` ~3926, `src/orchestrator/phases/spec-review.ts:71`) don't mention `Author` rows. Spec Decision 5 homes gate guidance in the `canon-pipeline` skill, and AC-11 forbids edits under `src/orchestrator/phases/`. A possible follow-up, not a defect against this spec.
- Dismissed (cold-Claude): `src/orchestrator/prompts/templates/qa.md:82` done.md output-format list omits Human Verification Required and Proposed Changelog. This omission predates the diff, and AC-8 required only the inserted item with the existing items kept unchanged.

Dismissed (anchored, nit): qa.md "Keep the headings" vs. appending a `Judgment calls` heading. Spec-intended (AC-8, Known Risks "PR templates with no notes section").

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Delta — base `5f0fd5d59f03cdac8725d68f68d8952caea5d9a8` — reason: small fix within the files already under review

Lenses: anchored-Claude (full diff `main...HEAD`, STAGE_1 pass, signal approve), cold-Claude (delta only, signal approve), cold-Codex (delta only, no actionable findings).

### Stage 1 — Acceptance Criteria Re-Check

Validation: the anchored lens re-ran `tests/run-task-prompts.test.ts` (71/71 pass) and `npm run sync-templates:check` (pass) itself. Red-first evidence for AC-9 is in the baseline `## Red-First Evidence` table: it failed on base 972e468, failed again when D was removed, and passed when D was restored.

| AC | Status | Notes |
|---|---|---|
| AC-1: Template section | Met (unchanged from round 1) | `.canon/templates/spec.md` untouched by the iteration. |
| AC-2: Self-check parity | Met | `src/orchestrator/prompts/index.ts:177` now closes the code span; `dist/` rebuilt; a rendered-prompt assertion pins it. |
| AC-3: Pipeline author rules | Met | `src/orchestrator/prompts/templates/spec-revision.md:23` keeps D, S, and the reset-on-change rule and adds keep-when-unchanged. It still has no fast-tier clause and its placement is unchanged. |
| AC-4: Skill author rule | Met (unchanged from round 1) | — |
| AC-5: Grill rule | Met (unchanged from round 1) | — |
| AC-6: Gate presentation | Met (unchanged from round 1) | — |
| AC-7: spec_review check | Met (unchanged from round 1) | — |
| AC-8: QA output | Met (unchanged from round 1) | The rendered `promptQa` is now also asserted to contain `## Judgment Calls to Confirm`. |
| AC-9: Canonical-text test | Met | Adds a rendered-D check on `promptSpecRevision` and the closed-span assertion; red-first evidence is in the baseline handoff. |
| AC-10: No tooling enforcement | Met (unchanged from round 1) | No validation, parser, or lint code touched. |
| AC-11: Scope bound | Met | Delta touches only the prompt index, `spec-revision.md`, test, goldens, and `dist/`. |
| AC-12: Goldens and mirrors | Met | `main...HEAD` golden diff still changes exactly the 7 named keys; sync-templates:check passes. |

### Verifying Round 1 findings

- _correctness bug:_ "Unclosed backtick in `promptSpec` selfCheck" → addressed (`src/orchestrator/prompts/index.ts:177`, `dist/orchestrator/run-task.js`, goldens `promptSpec`/`promptSpec_withDocsMap`; AC-2 Met) ✓
- _nit:_ "No rendered check of `promptSpecRevision`" → addressed (`tests/run-task-prompts.test.ts:1254-1258`) ✓
- _nit:_ "Revision session may relabel unchanged `Human` rows" → addressed (`spec-revision.md:23`) ✓
- _nit:_ "Parity test does not pin QA contract" → partly addressed (heading assertion added) ✓

### New findings (only NEW issues introduced by Iteration 1's changes)

#### Optional Cleanup / Nit

- **Keep-when-unchanged rule lives only in the revision prompt.** Flagged by 2 lenses (anchored, cold-Claude). `src/orchestrator/prompts/templates/spec-revision.md:23` says to keep an unchanged row's Decided by value. The template's `Author` definition (`.canon/templates/spec.md:22`) states only the reset half. The two are consistent. Cold-Claude's edge case is that a literal reading forbids relabeling `Author` → `Human` when the human confirms an unchanged option during a revision round. Spec Decision 1 has a row become `Human` only from the question round or a redirect at a spec gate, and the auto-revision loop has no human in it, so the edge is not reachable in practice. Optional symmetry edit; does not block.
- **New `promptSpecRevision` assertion checks D, not the new keep/reset wording** (cold-Claude, `tests/run-task-prompts.test.ts:1257`). The `promptSpecRevision` golden snapshot covers the exact wording, and AC-9 pins only D/S/B. This is extra coverage beyond the spec, not compromised test integrity. Optional.

### Dismissed Cold Findings

- Cold-Codex: no findings this round.
- No cold-Claude findings dismissed; both were downgraded to nits above.

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
