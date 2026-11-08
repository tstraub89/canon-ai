# Spec: handoff-self-check-evidence — Handoff Self-Check evidence section with pre-flight and anchored verification

> Written by: Claude | Review by: spec reviewer
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

`implementer-blast-radius-map` adds a pre-handoff self-check to the implement prompts: test integrity, restatement sweep, and sibling parity. These checks target the largest tagged classes of round-1 `code_review` findings. For October 2026, `scripts/review-metrics.mjs` counts 0.42 test-integrity findings per task and 0.34 restatement-plus-sibling findings per task. This task runs only after that one has merged.

A prompt-only self-check leaves no trace. Nothing shows whether the implementer ran it, and nothing stops a claim that it did. A checkbox wouldn't fix that: a model ticks it whether or not it did the work, and a gate sees only the tick. What changes behavior is evidence a reviewer can check against the diff. That means naming the test and the assertion that pins its reason, the search pattern that was run, and the sibling paths that were examined. A fabricated row then becomes a falsifiable claim instead of an invisible one.

The pre-flight added here only forces the section to exist and be filled in. Whether the evidence is true is judged solely by the anchored code-review lens.

## Decision

1. **Handoff section.** The handoff template gains a `## Self-Check` section after `## Red-First Evidence`. It holds a two-column table (`Check` | `Evidence`) with exactly three rows: `Test integrity`, `Restatement sweep`, and `Sibling parity`. Each row is prefilled with a placeholder describing the evidence required:
   - **Test integrity:** each behavioral test added or changed, the assertion that pins its failure reason, and how the implementer knows it fails without the change. A Red-First Evidence row counts. Regenerated snapshots and fixture-only edits are exempt and can be summarized in one line.
   - **Restatement sweep:** the search pattern(s) run for each changed contract, and any hits outside Affected Files with how they were handled: updated, or recorded as a Blocker.
   - **Sibling parity:** the parallel paths examined for each added guard or branch, and whether each got the same treatment, or why not.

   Any row may read `N/A — <reason>`. A literal `|` inside an Evidence cell (for example in a search pattern) is written `\|`. Paths in Evidence cells follow the implement prompt's file-citation rule. The iteration template ("On revision rounds") gains an optional `### Self-Check` subsection of the same shape, placed after `### Red-First Evidence` and before `### Re-run validation`. An Iteration subsection holds only the rows the round updates. Each row it holds restates that check's evidence for all work on the branch, not only the round's delta, and supersedes every earlier version of that row (Decision 4).

2. **Prompts.**
   - **Fresh and reroute implement prompts:** the self-check block tells the implementer to record each check's evidence in handoff.md's `## Self-Check` table, and to write the section even when the handoff template in use lacks it.
   - **Reroute prompt:** the rewritten handoff's Self-Check covers all work on the branch. It carries earlier rounds' Self-Check evidence forward, as the reroute prompt already does for Red-First Evidence rows.
   - **Revision prompt:** the implementer appends a `### Self-Check` subsection to its Iteration whenever the round makes an earlier Self-Check row incomplete or untrue: it adds, renames, or changes behavioral tests, contracts, or guards, or a review finding says an earlier row is contradicted. Each row written restates the whole-branch evidence for that check and replaces the earlier version; earlier rows are left in place as history. This is a stated exception to the prompt's "include only the delta" rule, which otherwise stands. The prompt's pre-flight "Fix the handoff" guidance lists the Self-Check table, and says that a Self-Check rejection is fixed by adding or repairing the baseline `## Self-Check` section in place. An Iteration `### Self-Check` does not satisfy the pre-flight.
   - **Interrupted-resume prompt:** its handoff summary line names the Self-Check section.

3. **Pre-flight (presence only).** The deterministic handoff pre-flight before `code_review` rejects a handoff when:
   - the baseline `## Self-Check` section is missing;
   - any of the three rows is missing;
   - any Evidence cell is empty or still the template placeholder;
   - any Evidence cell is a bare `N/A` with no reason.

   These issues go into the same `format` bucket as AC Coverage placeholder issues. That bucket routes to implement under the "Fix the handoff" framing and increments `preflight_rejections_current_loop`. Each message tells the implementer to fix the baseline section in place. The pre-flight never judges whether evidence is true. That keeps it structural, consistent with docs/pipeline-orchestrator.md §"The validation-outcome pre-flight is structural, not spec-matching" and docs/decisions.md §"Red-first evidence is checked in anchored Stage 1, not pre-flight".

4. **Anchored lens (truth).** The anchored code-review lens reads every Self-Check block (the baseline section and each Iteration subsection) and judges the *effective record* against the current cumulative diff.
   - **Effective record (supersession).** For each of the three checks, the effective row is the one in the latest block that contains a filled row for it; the baseline counts as the earliest block. A row that is empty or still a placeholder in an Iteration subsection supersedes nothing. Superseded rows are history: they are never judged, so a claim that was true when written, or a false claim a later row corrects, cannot fail a later round. Two cases are named in the charter as examples:
     - The baseline row reads `N/A — no tests changed`; a revision round adds a behavioral test and its Iteration row names that test. The Iteration row is effective and the baseline `N/A` is not a gap.
     - Review round 1 finds a baseline row contradicted; the next Iteration row restates corrected evidence. In round 2 only the corrected row is judged.
   - **Stage 1 gap:** an effective row the diff *contradicts*. A named test is absent, or doesn't assert what the evidence claims. Re-running the stated restatement search finds a hit outside Affected Files that was neither updated nor recorded as a Blocker. A named sibling path doesn't exist, or its treatment differs from the claim. An `N/A` reason the diff contradicts.
   - **Stage 2 `risk/guardrail` finding:** an *omission*, such as a behavioral test file changed in the diff but not mentioned in any Self-Check evidence. An omission is not a Stage 1 gap, so incomplete bookkeeping doesn't discard the round's Stage 2 review.

   An effective row that is no longer true because a later round changed the code without appending an updated row is still a contradiction: the record as it stands asserts something false. The fix is one appended row, so it cannot repeat.

   On re-review rounds, the foreman tells the anchored lens to read Self-Check evidence across the whole handoff and judge the effective record, next to the existing red-first instruction.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Form of the self-check record | Evidence rows a reviewer can falsify | Checkboxes | A checked box records only that a box was checked | `Human` |
| Enforcement split | Pre-flight checks presence and fill; the anchored lens judges truth | Anchored lens only, no pre-flight | The human asked to reject handoffs that skip the check; presence and fill are judgeable from the handoff alone | `Human` |
| Contradiction vs omission | A contradicted claim is a Stage 1 gap; an unmentioned changed test is a Stage 2 `risk/guardrail` | All mismatches in Stage 1 | A Stage 1 failure skips Stage 2 and costs a round; a false claim deserves that, incomplete bookkeeping doesn't | `Author` |
| Grandfathering in-flight tasks | None: the first pre-flight after upgrade rejects a handoff without the section, and the message says to add the baseline section in place | Gate only tasks created after the release | Version gating adds a second path on a delicate gate; the fix-in-place message makes it a one-round cost | `Author` |
| Adopter handoff-template overrides | The prompts always instruct writing `## Self-Check` | Skip the gate when an override template lacks the section | Skipping would make the gate opt-out by accident | `Author` |
| Iteration subsections in the pre-flight | Not checked by the pre-flight; checked by the anchored lens | Require `### Self-Check` in every iteration | Many rounds change only handoff text or one line | `Author` |
| Implement-done evidence guard | Unchanged; the check runs in `classifyPreflightBlockers` (the live gate) and `validateHandoff` (test-only parity), like AC Coverage | Also block implement auto-advance | Matches the AC Coverage precedent; the pre-flight already feeds rejections back to implement | `Author` |
| Revision-round Self-Check semantics | Latest filled row per check wins; each written row restates whole-branch evidence; superseded rows are never judged | Judge each block against the diff as it stood at the end of its own iteration | Per-iteration diffs need per-round commit archaeology that the lens does not do reliably; latest-wins needs only the handoff and the current diff, and matches how a reroute's rewritten baseline already covers all branch work | `Author` |
| Stale effective row (true when written, false after a later round) | Stage 1 contradiction | Stage 2 omission, because the later round just forgot bookkeeping | The effective record reads as a false claim, and the revision prompt requires the update; the fix is one appended row, so it costs at most one round | `Author` |
| Test-integrity scope | Behavioral tests; regenerated snapshots and fixture-only edits exempt | Every changed test file | Mechanical fixture sweeps have no fails-without-the-change premise | `Author` |

## Non-Goals

- The pre-flight does not judge evidence quality or truth.
- No change to the cold-Claude or cold-Codex lenses, the foreman's synthesis or verdict rules, or QA.
- No version-based exemption for in-flight tasks.
- No change to the blast-radius map.
- `checkImplementEvidence` is unchanged.

## Acceptance Criteria

- [ ] AC-1: The handoff template has a `## Self-Check` section after `## Red-First Evidence`. It contains a `Check` | `Evidence` table with exactly the rows `Test integrity`, `Restatement sweep`, and `Sibling parity`, each with a placeholder Evidence cell. A short instruction permits `N/A — <reason>`, requires `\|` for literal pipes, and points to the file-citation rule. The iteration block gains an optional `### Self-Check` subsection between `### Red-First Evidence` and `### Re-run validation`, whose instruction says to include only updated rows, that each row restates evidence for all branch work, and that it supersedes earlier versions of that row. Verify by reading it and with a test that parses the template's Self-Check table and finds the three rows, and asserts the iteration subsection's position and its supersession instruction.
- [ ] AC-2: `classifyPreflightBlockers` and `validateHandoff` each report a Self-Check issue for each of these handoffs:
  - (a) no baseline `## Self-Check` section;
  - (b) a missing row;
  - (c) an empty Evidence cell;
  - (d) an Evidence cell still holding the template placeholder;
  - (e) an Evidence cell that is bare `N/A`, `n/a`, `N/A —`, `N/A –`, or `N/A -`;
  - (f) no baseline section, but an Iteration `### Self-Check` that is fully filled in.
  
  The case (a) and (f) messages name the section, and say to add it as a baseline `## Self-Check` section and that an Iteration `### Self-Check` does not satisfy the check. The other messages name the row. Verify with one unit test per case in `tests/run-task-validation.test.ts`.
- [ ] AC-3: These handoffs produce no Self-Check issue:
  - three rows holding real evidence;
  - an `N/A — no tests changed` row, with any dash form followed by reason text;
  - a section heading in a different case (`## Self-check`);
  - bold row labels;
  - an Evidence cell containing an escaped `\|`;
  - a valid baseline section plus an Iteration `### Self-Check` still holding placeholders.
  
  Verify with unit tests.
- [ ] AC-4: Self-Check issues are classified in the `format` bucket, the same bucket as AC Coverage issues. The pre-flight block written to `review.md` lists them under "Fix the handoff", and the rejection increments `preflight_rejections_current_loop`. Verify with a test that drives pre-flight classification for a handoff missing the section, and asserts the bucket and the framing.
- [ ] AC-5: Prompts:
  - **Fresh and reroute:** the prompts instruct recording evidence in `## Self-Check` and writing the section even if the template lacks it. The reroute prompt instructs covering all branch work and carrying earlier Self-Check evidence forward.
  - **Revision prompt, findings branch:** instructs appending `### Self-Check` when the round adds, renames, or changes behavioral tests, contracts, or guards, or when a finding says an earlier row is contradicted; says each row written restates whole-branch evidence and supersedes the earlier version, which stays in place.
  - **Revision prompt, pre-flight branch:** the "Fix the handoff" guidance lists the Self-Check table, and says to repair the baseline section in place.
  - **Interrupted resume:** the prompt's handoff summary names the Self-Check section.
  
  Verify via golden snapshots for `promptImplement_fresh`, `promptImplementReroute`, the existing revision key, and a new golden key that renders the revision prompt's pre-flight branch. Verify resume with a prompt assertion.
- [ ] AC-6: The anchored lens charter's Stage 1 list gains the contradiction check after the red-first check. The check is stated against the effective record: it defines the effective row (latest block with a filled row for that check; placeholder Iteration rows supersede nothing), says superseded rows are not judged, and includes both Decision 4 examples (an initially valid `N/A` superseded by a revision's Iteration row is not a gap; a contradicted row corrected by a later Iteration row is judged only in its corrected form). Its Stage 2 guidance gains the omission rule (an unmentioned changed behavioral test is a `risk/guardrail` finding). The new text names no implement prompt template file. Verify by reading the charter, with a test asserting the Stage 1 item follows the red-first item and contains the supersession rule and both examples, and by the existing charter test that Stage 1 names no implement template still passing.
- [ ] AC-7: The foreman prompt's re-review instruction tells the anchored lens to read Self-Check evidence across the baseline section and every Iteration subsection and to judge the effective record, next to the existing red-first instruction. Verify via the round-2 code-review golden snapshot.
- [ ] AC-8: The review template's Stage 1 checklist gains an unchecked item for Self-Check evidence not contradicted by the diff, next to the red-first item. Verify by reading it and with a test that the review template still parses.
- [ ] AC-9: Every test fixture that builds a handoff expected to pass the pre-flight includes a filled Self-Check section. This includes the fixtures in `tests/run-task-code-review.test.ts`, `tests/recovery-hints.test.ts`, `tests/run-task-safety-helpers.ts`, and the classifier fixture in `tests/run-task-validation.test.ts`. The full suite passes. Verify with `npm test`.
- [ ] AC-10: Docs that list the pre-flight checks name the Self-Check presence check:
  - `docs/pipeline-orchestrator.md` §"The validation-outcome pre-flight is structural, not spec-matching" (and its mirror), stating that the anchored lens judges truth;
  - `docs/architecture.md`, in the implement-to-review steps and the gates list;
  - `docs/codebase-map.md`, in the pre-flight gate row.
  
  `docs/decisions.md` gains an entry recording the presence-at-pre-flight, truth-at-anchored-lens split. Verify by reading them and with `npm run docs-refs-check`.
- [ ] AC-11: Root canon-managed files and their `templates/` mirrors match. Verify with `npm run sync-templates:check`.

## Design

### Affected Files

| File | Change |
|---|---|
| `.canon/templates/handoff.md`, `templates/.canon/templates/handoff.md` | `## Self-Check` section and optional iteration `### Self-Check` subsection |
| `.canon/templates/review.md`, `templates/.canon/templates/review.md` | Stage 1 checklist item |
| `.claude/agents/code-review-anchored.md`, `templates/.claude/agents/code-review-anchored.md` | Stage 1 contradiction check; Stage 2 omission rule |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Re-review instruction: read Self-Check evidence across the whole handoff |
| `src/orchestrator/validation.ts` | Self-Check presence/fill check in `validateHandoff` and `classifyPreflightBlockers` (`format` bucket) |
| `src/orchestrator/prompts/templates/implement.md` | Self-check block records evidence in `## Self-Check` |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Same; covers all branch work and carries Self-Check evidence forward |
| `src/orchestrator/prompts/templates/implement-revisions.md` | Iteration `### Self-Check`; pre-flight "Fix the handoff" guidance names the table and in-place baseline repair |
| `src/orchestrator/prompts/index.ts` | `promptImplementResume` handoff summary names the Self-Check section |
| `tests/run-task-validation.test.ts` | AC-2 through AC-4 unit tests; classifier fixture update |
| `tests/run-task-prompts.test.ts` | New golden key for the revision prompt's pre-flight branch; resume assertion |
| `tests/run-task-prompts.golden.json` | Regenerated snapshots |
| `tests/` | Fixture handoffs expected to pass pre-flight gain a filled Self-Check section (AC-9 files); new template, charter, and supersession-text structure tests for AC-1, AC-6, and AC-8, alongside the existing red-first template test |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Pre-flight structural-checks paragraph |
| `docs/architecture.md` | Pre-flight check lists in the implement-to-review steps and gates list |
| `docs/codebase-map.md` | Pre-flight gate row |
| `docs/decisions.md` | New entry: Self-Check presence at pre-flight, truth at the anchored lens |
| `dist/` | Rebuilt bundle (prompt templates are bundled by tsup; `dist/` is tracked) |

### Implementation Notes (non-binding; plan and implement own these)

- Follow `checkAcCoveragePlaceholders` and its call sites. `parseTable` matches its heading exactly and keys cells by header text, so the Self-Check parser should find the section case-insensitively and read the second column positionally.
- Detect placeholders by the template's placeholder marker (for example a leading `_(`) rather than its exact wording.
- The baseline section is the `## Self-Check` H2. Iteration subsections are H3s under `## Iteration N` headings.

### Interaction Dependencies

- Requires `implementer-blast-radius-map` merged: it adds the self-check block that this task rewords. If the block is absent when this task runs, record a Blocker instead of adding a second copy.
- Self-Check rejections share the code-review loop budget, the same mechanism as other handoff rejections.
- Recovery paths are unchanged. `canon task accept` and `--reroute` do not consult the pre-flight, and a reroute re-enters implement, whose prompt asks for the section.

### Data Model Changes

None. The handoff markdown gains a section; `status.json` is unchanged.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`

## Docs Impact

- Docs listed in Affected Files.
- `docs/patterns.md` "Validation Gate Discipline" may want a pointer. QA checks it.

## Known Risks

- **Gate false positives.** This is the delicate risk. A strict parser would reject real handoffs. AC-3 pins the tolerated variants: heading case, bold labels, dash forms, escaped pipes.
- **Fail-open parsing.** A parser that finds zero rows and passes would disable the gate. Missing rows must produce issues (AC-2b).
- **Repeated rejections on revision rounds.** If the fix guidance pointed at Iteration sections, a rejection would repeat until auto-block. AC-2(f) and AC-5 make the baseline in-place fix explicit.
- **Anchored-lens false positives.** A strict reading of "contradicted" could fail Stage 1 on a judgment difference. Stage 1 covers only claims the diff contradicts. Omissions go to Stage 2.
- **Historical evidence failing later rounds.** Revision handoffs are cumulative, so an earlier row that was true when written, or a false row already corrected, could keep failing Stage 1. The effective-record rule (Decision 4, AC-6, AC-7) judges only the latest filled row per check. The lens applies this rule by reading prose, so no unit test can execute it; the tests pin the rule and both examples in the charter, revision prompt, and foreman instruction, which is the same verification the red-first rule has.
- **Iteration row scoped to the round.** An implementer could write `N/A — no tests changed this round` in an Iteration row. Under latest-wins that supersedes real baseline evidence and reads as false for the branch, so it fails Stage 1. The template and revision prompt say each row covers all branch work (AC-1, AC-5); the failure is caught, not silent.
- **Reroute evidence loss.** A rewritten handoff could drop earlier evidence. AC-5 requires carrying it forward.
- **Evidence theater.** Plausible but unverified evidence. The anchored re-run of the stated search pattern is the main counter.
- **Template mirror drift.** `sync-templates:check` covers it (AC-11).

## Human Test Plan

1. Run a small task through the pipeline.
2. Open its handoff after implementation.
3. Expected: a Self-Check section with three rows, naming the tests and what they assert, the searches run for changed wording, and the parallel paths checked.
4. On a throwaway task, wait for implementation to finish, delete one Self-Check row from the handoff before review starts, and continue the run.
5. Expected: the handoff is sent back before review, with a message naming the missing row.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, with one file per row. Each row has a specific change description.
- [x] Plan steps (fast tier) reference actual function/file names from the codebase (N/A: full tier)
- [x] If this spec replaces existing behavior: frame it as one replacement (N/A: additive gate)
- [x] Non-Goals rules out the most tempting scope expansions; load-bearing exclusions are backed by ACs (AC-3, AC-6)
- [x] Symbols named in ACs actually exist in the codebase (`classifyPreflightBlockers`, `validateHandoff`, `checkAcCoveragePlaceholders`, `checkImplementEvidence`, `promptImplementResume`, `preflight_rejections_current_loop` grep-verified)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A: feature
- [x] (Refactors) N/A: feature
- [x] *Judgment Calls* lists every judgment call the spec makes
