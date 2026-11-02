# Spec: spec-judgment-calls — Surface judgment calls in specs

> Written by: Claude | Review by: spec reviewer
> Status: draft

## Problem

Specs make judgment calls without listing them. A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. Examples are warn versus block, default on versus off, and which surface owns a rule. The template's `## Decision` section asks "What are we building?", so in practice it describes the chosen behavior as plain fact. When a rejected alternative is recorded at all, it lands in Non-Goals, Problem, Known Risks, or an amendment's "Why" paragraph written after the fact.

An audit of 30 recent S/M/L archived specs (15 from canon-ai, 15 from one adopter) found:

- Every sampled spec made judgment calls, with a median of 5–7. None would honestly have an empty list.
- About 12 of 15 canon-ai specs and 10 of 15 adopter specs had a call contested later: in a spec_review round, an amendment, a code_review `spec_gap`, or at human review. In the adopter corpus, roughly 10 of about 14 contested calls had no recorded alternative.
- Two canon-ai examples:
  - `tasks/_archive/spec-manifest-lint/spec.md` declared "A spec with no Affected Files table stays valid" with no alternative or rationale. An amendment reversed it.
  - `tasks/_archive/full-send-tail-push-and-watch/spec.md` never framed commit provenance as an option. It took seven spec_review iterations (six `changes_requested`) before the text read "considered and rejected".
- About 5 of the 30 already do this well inline. One example is the "Why block at `--pr` rather than leave it to the forge" paragraph in `tasks/_archive/base-drift-conflicts-only/spec.md`.

The human's side of the problem: a published study of analysts working with a coding agent (anthropic.com/research/agents-judgment-calls) gave the agent a coin-flipped lean on calls where both options were defensible. Analysts adopted the agent's lean 86% of the time, and the agents rarely argued the other side. Canon's grill rule "Always take a position" has the same shape: a recommendation with no counter-case. The recommendation is valuable and stays. Two things are missing: the strongest case for the runner-up, and a record of which calls the human actually made versus accepted as the author's lean.

The main value of a dedicated section is not the record itself. It forces the author to enumerate the calls, which surfaces the silent ones before review rather than at an amendment.

## Decision

1. **New spec section.** The spec template gains a `## Judgment Calls` H2 immediately after `## Decision`.
   - It is a table with one row per call and five columns: call, chosen option, strongest alternative, why the choice fits, and decided by.
   - The decided-by cell takes exactly one of two literal values:
     - `Human` — the human explicitly chose this option, either during the question round or by redirecting at a spec gate.
     - `Author` — the author's recommendation, not explicitly chosen by the human.
   - Approving a spec as a whole does not turn an `Author` row into `Human`.
   - A revision that changes a row's chosen option sets that row to `Author`.
   - A spec with no genuine calls writes `None — <reason>`.
2. **Canonical definition.** Every carrier that instructs an author or reviewer about judgment calls uses this exact sentence, D:
   `A judgment call is a choice between two or more defensible options where the choice changes behavior or scope.`
   Every such carrier also states this exact sentence, S, immediately after D:
   `A choice a project doc already settles is not a judgment call: follow the doc and cite it.`
   An agent that substitutes its own reasonable choice for a documented house rule produces a defensible answer that is still wrong for the project. S keeps settled choices out of the table and stops specs from re-deciding them.
3. **Author obligation, on every authoring surface.** The skill, the pipeline spec prompt (full and fast tier), and the spec-revision prompt tell the author to list every judgment call in *Judgment Calls*. They frame this as the author's own obligation. The spec prompt also states that on fast-tier tasks `spec_review` does not run.
4. **Grill mode.** `canon-spec` grill keeps "Always state your recommended answer". On a judgment call, the author also gives the strongest case for the runner-up and what would flip the call.
5. **Both spec gates name the `Author` rows.**
   - At the skill's spec-approval stop, which comes before `spec_review`, the author lists the `Author` rows.
   - At the pipeline's human spec gate, which comes after `spec_review` approves, the `canon-pipeline` skill's gate guidance tells the operator to review the `Author` rows, including any that spec_review revisions added.
6. **spec_review blocks on an unlisted call, under a concrete bar.** The pipeline `spec_review` prompt raises a **Blocking** finding when the spec makes a judgment call that *Judgment Calls* does not list. The reviewer must meet this exact bar, B:
   `Name the call, a defensible alternative the spec does not record, and the AC or behavior that would differ under it; if you cannot name all three, do not raise it.`
   - A missing or empty section is not, by itself, a finding. A spec without the section that makes a call meeting B still draws the finding, and the fix is to add the section.
   - `/canon-spec-review` adds the same check as Agent C item (11) at **STRONG**.
   - The Shape Check restatements in `.canon/templates/spec-review.md` and `docs/pipeline-orchestrator.md` gain the matching question.
7. **QA surfaces the `Author` rows.**
   - QA lists every `Author` row in `done.md` under a new `## Judgment Calls to Confirm` section, placed immediately before `## Decisions Made` (spec-time calls first, then implementation-time choices). `done.md` is written for every task, bundles included.
   - For single tasks QA also adds the rows to `pr-body.md`, phrased in the engineer's voice as calls not explicitly confirmed during spec review.
   - With no `Author` rows, or no section, `done.md` says `None.` and the PR body adds nothing.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Where calls live | Separate `## Judgment Calls` H2 after Decision | Rewrite Decision's prompt to require alternatives inline: no new section, less checklist churn | Decision's "describe the behavior" framing anchors the ACs; mixing the roles is what scattered alternatives in the audit | Human |
| Downstream consumers | Author, spec gates, spec_review, QA output | Stop at spec_review, which needs no QA prompt change and makes a smaller task | Full-send runs have no human spec read, so QA output is the first place the human meets the agent's leans | Human |
| spec_review severity for an unlisted call | Blocking, with bar B | No spec_review check (author-only), to avoid reintroducing manufactured blockers | A nit goes to plan, which may not edit the spec, so the row would never be written; the bar keeps findings concrete | Human |
| QA output surface | `done.md` (all tasks) plus `pr-body.md` (single tasks) | PR body only, as originally scoped | QA skips `pr-body.md` for bundles, so a bundled full-send run would drop the leans; `done.md` covers every task | Author |
| Does bulk spec approval confirm `Author` rows? | No: only an explicit choice makes a row `Human` | Approval after seeing the listed rows counts as confirmation, so the PR shows fewer rows | Counting bulk approval would recreate the adopt-the-lean pattern the Problem cites | Author |
| Section-less spec (e.g. adopter template override) that makes a call | Review still blocks; the fix is adding the section | Gate the check on the section existing, which turns omitting it into an opt-out | An opt-out would let exactly the silent calls through; adding an H2 is cheap | Author |
| Choices a project doc already settles | Not judgment calls: follow and cite the doc (S) | List them as rows with a third decided-by value naming the doc | A row invites re-deciding; a citation in Decision is enough and keeps the table to real forks | Human |
| Code review | Out of scope | Anchored lens checks the implementation honors each chosen option | The chosen option is already in the ACs, which Stage 1 checks | Author |
| Amendment (reroute) spec_review | Unchanged | Apply the same check to amendment-only review | Keeps the reroute prompt and its three goldens out of scope; revisit if silent calls recur in amendments | Author |
| Section required by tooling? | No parser, lint, or pre-flight requires it | Lint at `spec done` that the heading exists | Adopters who override the template won't have it; guidance plus review is enough | Author |
| Skill severity | STRONG in `/canon-spec-review` | BLOCKING, matching the pipeline | Follows the skill's existing split (pipeline Blocking forces a revision; the advisory skill says STRONG), as with the refactor-audit check | Author |

## Non-Goals

- **Code review of judgment calls.** `.canon/templates/review.md` and `.claude/agents/code-review-anchored.md` are unchanged (AC-11).
- **Plan-phase handling** of spec contradictions or plan-made calls, tracked in issue #150.
- **Amendment-only review.** `src/orchestrator/prompts/templates/spec-review-reroute.md` is unchanged (AC-11).
- **Tooling enforcement.** No parser, lint, pre-flight, or required-heading check for `## Judgment Calls` or `## Judgment Calls to Confirm` (AC-10).
- **Content migration.** Nothing moves out of Non-Goals or Known Risks, and archived specs are not backfilled.
- **`canon-init`'s grill** is unchanged.
- **Injecting *Judgment Calls* into the implement prompt** the way Known Risks is injected.
- **A `docs/decisions.md` entry.** QA may not write decisions.md, so recording the new Blocking category there is a human follow-up after merge.

## Acceptance Criteria

- [ ] AC-1: **Template section.** `.canon/templates/spec.md` contains `## Judgment Calls` directly after `## Decision` and before `## Non-Goals`. Its guidance text contains:
  - D followed by S;
  - a table header with the five columns from Decision 1;
  - the two literal decided-by values `Human` and `Author` with their meanings, including the rules that bulk approval does not confirm a row and that a revision changing an option resets the row to `Author`;
  - that `None — <reason>` is acceptable.

  Verify by reading the file. AC-9 asserts D.
- [ ] AC-2: **Self-check parity.** All three self-check lists gain an item requiring every judgment call to be listed with its alternative and decided-by value:
  - the template's Spec Quality Checklist;
  - the `canon-spec` skill's "Self-check before presenting" list;
  - the `promptSpec` selfCheck in `src/orchestrator/prompts/index.ts`.

  Verify by reading the three lists and the regenerated `promptSpec` golden.
- [ ] AC-3: **Author rule on pipeline prompts.**
  - `src/orchestrator/prompts/templates/spec.md` carries a rules-of-thumb bullet that contains D, tells the author to list every judgment call in *Judgment Calls*, and states that on fast-tier (XS, non-delicate) tasks `spec_review` is skipped, so the author's list is the only check.
  - `src/orchestrator/prompts/templates/spec-revision.md` carries a bullet that contains D, tells the author to list every judgment call, and says a revision that changes a row's chosen option sets that row to `Author`. It has no fast-tier clause, since revisions never run on the fast tier.
  - Neither bullet sits between the "Refactor specs need structural caps" bullet and the refactor correctness-audit bullet.

  Verify in the regenerated `promptSpec` and `promptSpecRevision` goldens. AC-9 asserts D.
- [ ] AC-4: **Author rule in the skill.** `.claude/skills/canon-spec/SKILL.md` rules of thumb carry the same author obligation as the spec prompt in AC-3, including D and the fast-tier clause. Verify by reading the skill. AC-9 asserts D.
- [ ] AC-5: **Grill rule.** In the `canon-spec` grill mode, the "recommended answer" bullet and "Always take a position" stay. A new instruction says that on a judgment call the author also states the strongest case for the runner-up and what would flip the call. Verify by reading the skill.
- [ ] AC-6: **Gate presentation.**
  - The skill's Phase 5 spec-approval STOP tells the author to list the `Author` rows when presenting the spec, or to say there are none.
  - The `canon-pipeline` skill's human-spec-gate guidance (the "What happens after `canon run`" paragraph) tells the operator to review the `Author` rows in *Judgment Calls* alongside `spec.md` and `spec-review.md`.

  Verify by reading both skills.
- [ ] AC-7: **spec_review check.**
  - `src/orchestrator/prompts/templates/spec-review.md` adds a strategic-read bullet containing D and B. It states that an unlisted call meeting B is a Blocking finding requiring `changes_requested`, and that a missing or empty section alone is not a finding. The existing "Silence is the default" paragraph is unchanged.
  - The Shape Check list in `.canon/templates/spec-review.md` and the Shape Check restatement in `docs/pipeline-orchestrator.md` §human spec gate gain a matching question. Both contain D and S.
  - `.claude/skills/canon-spec-review/SKILL.md` Agent C gains item `(11)` at STRONG, containing D and B. "Check these ten items" becomes eleven, and items (1)–(10) keep their numbers and text.

  Verify in the regenerated `promptSpecReview` golden and by reading the files. AC-9 asserts D and B.
- [ ] AC-8: **QA output.**
  - `.canon/templates/done.md` gains a `## Judgment Calls to Confirm` section immediately before `## Decisions Made`. Its guidance says to list every `Author` row from the spec's *Judgment Calls*, or `None.`
  - `src/orchestrator/prompts/templates/qa.md` step 1 lists the section among done.md's contents and gives the same rule, and the numbered done.md output-format list gains a matching item placed before "Decisions made during implementation". The existing items, including `## Root Cause`, keep their text.
  - Step 4 (single tasks) tells QA to add the `Author` rows to `pr-body.md`, phrased in the engineer's voice as calls not explicitly confirmed during spec review. With no PR template they go under "Notes for Reviewer". With a PR template they go under its closest notes-like section, or a short `Judgment calls` heading appended at the end if it has none. With no `Author` rows, the PR body adds nothing.

  Verify in the regenerated `promptQa` and `promptQa_withTemplate` goldens and by reading the template.
- [ ] AC-9: **Canonical-text test.** A new test in `tests/run-task-prompts.test.ts`, modeled on "refactor correctness-audit guidance stays aligned across spec surfaces", defines D, S, and B once each and asserts that:
  - D and S each appear verbatim in:
    - `.canon/templates/spec.md`
    - `.canon/templates/spec-review.md`
    - `.claude/skills/canon-spec/SKILL.md`
    - `.claude/skills/canon-spec-review/SKILL.md`
    - `src/orchestrator/prompts/templates/spec.md`
    - `src/orchestrator/prompts/templates/spec-revision.md`
    - `src/orchestrator/prompts/templates/spec-review.md`
    - `docs/pipeline-orchestrator.md` (its Shape Check restatement from AC-7)
    - the `templates/` mirror of each canon-managed file in this list;
  - B appears verbatim in `src/orchestrator/prompts/templates/spec-review.md`, `.claude/skills/canon-spec-review/SKILL.md`, and the latter's mirror;
  - each carrier list is non-empty, and every listed file exists, so the test cannot pass vacuously.

  The handoff shows the test failing when D is removed from one carrier and passing when it is restored.
- [ ] AC-10: **No tooling enforcement.**
  - `grep -rn "Judgment Calls" src/` returns hits only under `src/orchestrator/prompts/`; no validation, parser, or lint file matches.
  - A spec without the section can still be marked `spec done`. Existing spec-done tests pass unchanged, and the handoff records marking a section-less fixture spec done, or the equivalent unit test.
- [ ] AC-11: **Scope bound.** The branch diff against the task's base commit touches none of:
  - `.canon/templates/review.md`
  - `.claude/agents/code-review-anchored.md`
  - `src/orchestrator/prompts/templates/spec-review-reroute.md`
  - `.claude/skills/canon-init/` and `templates/.claude/skills/canon-init/`
  - any file under `src/orchestrator/phases/`
  - `src/orchestrator/validation.ts`
- [ ] AC-12: **Goldens and mirrors.** Against the task's base commit, `UPDATE_GOLDENS=1 npm test` changes exactly these golden keys and no others: `promptSpec`, `promptSpec_withDocsMap`, `promptSpecRevision`, `promptSpecRevision_withDocsMap`, `promptSpecReview`, `promptQa`, `promptQa_withTemplate`. `npm run sync-templates:check` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `.canon/templates/spec.md` | `## Judgment Calls` section after Decision (AC-1); checklist item (AC-2) |
| `templates/.canon/templates/spec.md` | Generated mirror |
| `.canon/templates/spec-review.md` | Shape Check question with D (AC-7) |
| `templates/.canon/templates/spec-review.md` | Generated mirror |
| `.canon/templates/done.md` | `## Judgment Calls to Confirm` section (AC-8) |
| `templates/.canon/templates/done.md` | Generated mirror |
| `.claude/skills/canon-spec/SKILL.md` | Rules-of-thumb obligation (AC-4), grill rule (AC-5), self-check item (AC-2), Phase 5 presentation (AC-6) |
| `templates/.claude/skills/canon-spec/SKILL.md` | Generated mirror |
| `.claude/skills/canon-spec-review/SKILL.md` | Agent C item (11); ten → eleven (AC-7) |
| `templates/.claude/skills/canon-spec-review/SKILL.md` | Generated mirror |
| `.claude/skills/canon-pipeline/SKILL.md` | Human-spec-gate guidance names the `Author` rows (AC-6) |
| `templates/.claude/skills/canon-pipeline/SKILL.md` | Generated mirror |
| `docs/pipeline-orchestrator.md` | Shape Check restatement gains the question (AC-7) |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror |
| `src/orchestrator/prompts/index.ts` | `promptSpec` selfCheck item (AC-2) |
| `src/orchestrator/prompts/templates/spec.md` | Author-obligation bullet (AC-3) |
| `src/orchestrator/prompts/templates/spec-revision.md` | Author-obligation and relabel bullet (AC-3) |
| `src/orchestrator/prompts/templates/spec-review.md` | Strategic-read Blocking bullet with D and B (AC-7) |
| `src/orchestrator/prompts/templates/qa.md` | done.md section and PR-body instructions (AC-8) |
| `tests/run-task-prompts.test.ts` | Canonical-text parity test (AC-9) |
| `tests/run-task-prompts.golden.json` | Regenerated keys listed in AC-12 |
| `dist/` | Rebuilt bundle (prompt templates are bundled by tsup; `dist/` is tracked) |

### Interaction Dependencies

- **Refactor correctness-audit parity test** (`tests/run-task-prompts.test.ts`):
  - It reads the **first** line containing "correctness audit" in `prompts/index.ts` and `spec-review.md`, so new text must not contain that phrase.
  - It requires the structural-caps bullet to directly precede the refactor bullet, so nothing new may be inserted between them.
- **spec-review-lens structural test:**
  - It checks for `(n) **` markers for n=1..9 and splits on `'(3) **Affected Files**'` / `'\n(4)'`. Appending `(11)` is safe; renumbering is not.
  - Any new line mentioning "Non-Goals" in the lens or review skill must also match `/verif\w* (as )?unaffected/`. Avoid mentioning Non-Goals in the new text.
- **Validation Matrix:** `tests/validation-matrix-sync.test.ts` pins the template's matrix. Don't touch it.
- **Adopter-neutral text.** Canon-managed text must make sense in an adopter repo (AGENTS.md §Adopter Scope), and three checks enforce parts of this:
  - The sync-templates leak guard rejects backticked `src/orchestrator/` references in canon-managed content.
  - It also rejects backticked bare basenames of internal prompt templates, such as `qa.md` and `spec-revision.md` (`INTERNAL_ONLY_TEMPLATE_BASENAMES` in `scripts/sync-canon-templates.mjs`).
  - The `tests/cli.test.ts` token-leak checks cover the shipped templates.

  The study URL may be cited.
- **Spec parsers.** Every spec parser (`buildKnownRisks`, `extractValidationChecks`, `scanSpecManifest`, `lintSpecManifest`) is bounded by the next H2. A new H2 between Decision and Non-Goals sits outside every parsed window. Template guidance should show rows as table cells; the `- [ ] AC-n:` checkbox form is scanned file-wide by `extractAcSummary`.
- **done.md checks.** The waiver check (`src/orchestrator/validation.ts`) matches lines beginning `Acknowledged:` anywhere in the file, so the new section's guidance must not start a line with that word.

### Data Model Changes

None.

### Implementation Notes (non-binding; owned by plan/implement)

- Possible template guidance: "List each judgment call this spec makes. <D> Set Decided by to `Human` only when the human explicitly chose the option; otherwise `Author`. Write `None — <reason>` if there are none."
- The spec_review bullet can sit after the "Is the framing right?" bullet in the strategic read.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` (full suite)
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/pipeline-orchestrator.md` restates the Shape Check questions and is edited by this task (Affected Files). No other protected doc enumerates spec sections. A `docs/decisions.md` entry for the new Blocking category is a human follow-up (Non-Goals).

## Known Risks

- **spec_review round inflation.** A new Blocking category could bring back the "manufactured findings" pattern that the spec_review recalibration removed (`docs/decisions.md`, guardrail-prompt entry).
  - Mitigations: bar B, the explicit "a missing or empty section is not a finding", and the unchanged silence default.
  - Guardrail (cost): compare `spec_review` iterations in `docs/task-quality-log.md` over the next ~10 S+ tasks against the prior baseline, and downgrade the check if rounds inflate.
  - Success signal (benefit): over the same tasks, the `spec-gap` and `unrequested-change` lines in each `done.md` `## Root Cause` section should fall. If rounds rise and those lines don't fall, the check costs more than it buys.
- **Adopter template overrides.** Adopters with `tasks/_templates/spec.md` don't get the section, but they do get the prompt guidance. A spec that makes a call meeting B draws a Blocking finding whose fix is to add the section. This is intended (Judgment Calls row). What they are never blocked for is the section's absence alone.
- **Ceremony drift.** Authors may pad the table with non-calls, such as mechanics or obvious choices. The filter is D's two conjuncts, "defensible options" and "changes behavior or scope". Each carrier must state D in full, since dropping a conjunct on one surface widens it (`docs/patterns.md`, multi-surface homing).
- **Predicate integrity of the AC-9 test.** A parity test can pass vacuously if a carrier list is empty or a path is wrong. AC-9 requires non-empty lists and existing files, and a red-first demonstration.
- **Decided-by honesty.** The author fills this column itself. A row mislabeled `Human` hides exactly the lean QA output is meant to surface. The explicit-choice rule and the revision reset narrow this, but cannot verify it.
- **PR templates with no notes section.** QA appends a short heading rather than dropping the rows (AC-8). An adopter whose template forbids extra headings would still see the rows in `done.md`.
- **Golden churn.** Seven golden keys change. An unexpected eighth key means the edit leaked into a shared fragment.

## Human Test Plan

1. Start a new spec with the spec skill for a small feature that has an obvious fork, such as whether a new warning should block or only warn.
2. During the question round, check that for that fork the assistant gives its recommendation, the best argument for the other option, and what would change its mind.
3. Check that the finished spec has a "Judgment Calls" section after "Decision" that lists that fork with the alternative and who decided.
4. At the approval stop, check that the assistant names the calls it made that you didn't explicitly choose.
5. Remove one row from the section and run the pipeline's spec review. Expected: the review requests changes and names the call, the alternative, and what would differ.
6. Run the pipeline's spec review on a small spec that has no Judgment Calls section and makes no contested choice. Expected: no change request about the missing section.
7. Let a task finish QA. Expected: the completion summary has a "Judgment Calls to Confirm" section listing the assistant's own calls, and the draft PR description lists them too.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files: one heading under Design, one file per row, mirrors and rebuilt outputs listed
- [x] Plan steps (fast tier): N/A (full tier)
- [x] Replacement framing: N/A (additive guidance; "Always take a position" is kept, not replaced)
- [x] Non-Goals rule out tempting expansions; AC-10 and AC-11 back them structurally
- [x] Symbols named in ACs exist (`promptSpec`, `promptSpecRevision`, `promptSpecReview`, `promptQa`, `promptQa_withTemplate`, `INTERNAL_ONLY_TEMPLATE_BASENAMES`, `extractAcSummary`, golden keys verified by grep)
- [x] Known Risks covers the trickiest ACs (AC-7 calibration, AC-9 predicate integrity, AC-8 template placement)
- [x] Human Test Plan uses product language only
- [x] Validation Required has checked entries
- [x] Bug/flake evidence: N/A (feature)
- [x] Refactor correctness audit: N/A (feature)
