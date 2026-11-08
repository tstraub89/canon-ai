# Implementation Plan: handoff-self-check-evidence

> Written by: Claude | Implements: `tasks/handoff-self-check-evidence/spec.md`

## Approach

Spec review verdict: **approved**, no nits to carry. This is a delicate gate, so the plan's priority is a tolerant parser that **fails closed**. A section found with zero rows produces three missing-row issues, never a pass.

The work splits into five parts:

1. **Gate.** Add one new pure function, `checkSelfCheckEvidence(handoffContent)`, in `src/orchestrator/validation.ts`. Wire it into both `validateHandoff` and `classifyPreflightBlockers` through a new `selfCheckIssues` field on `PreflightClassificationData`, mapped to the `format` bucket. This follows `checkAcCoveragePlaceholders` and its call sites, and the `*FromData` seam rule in docs/patterns.md §"Validation Gate Discipline".
2. **Template.** Add the `## Self-Check` section and the iteration `### Self-Check` subsection to the handoff template.
3. **Prompts.** Add the evidence-recording rule to the fresh, reroute, revision, and resume prompts.
4. **Lens text.** Add the effective-record rule to the anchored charter, the foreman, and the review checklist.
5. **Follow-through.** Update fixtures, docs, goldens, the `dist/` rebuild, and the template mirrors.

**Rejected alternative:** reusing `parseTable`. It matches `## <heading>` exactly (case-sensitive), keys cells by header text, and does not hide HTML-comment or fenced content. The spec wants a case-insensitive heading and a positional Evidence column. `src/orchestrator/markdown-table.ts` is not in Affected Files, so no new export can go there. Instead the parser composes two exports that already exist: `scanSpecManifest` (visible lines, `hidden[]` mask, and a heading list with levels) and `scanTableBlocks` (raw positional `cells[]`, with escaped `\|` already decoded by `splitTableLine`).

### Feasibility check

- **Exists:** grep confirmed each of these:
  - in `src/orchestrator/validation.ts`: `checkAcCoveragePlaceholders` (line 51), `validateHandoff` (111), `PreflightClassificationData` (409), `classifyPreflightBlockersFromData` (674), `classifyPreflightBlockers` (691);
  - `scanSpecManifest` and `scanTableBlocks`, both exported from `src/orchestrator/markdown-table.ts`;
  - `buildPreflightReviewBlock` and `determinePreflightRoute` in `src/orchestrator/phases/code-review.ts`;
  - `promptImplementResume` in `src/orchestrator/prompts/index.ts:385`;
  - the prerequisite self-check blocks in `implement.md:42-49` (wrapped in `{{#selfCheck}}`), `implement-reroute.md:14-20`, and `implement-revisions.md:8-14`. The Interaction Dependency is satisfied, so no Blocker is needed.
- **Real path:** the live gate is `runCodeReviewPhase` → `classifyPreflightBlockers(t.taskId, changedFiles, taskBundleIssues)` (`src/orchestrator/phases/code-review.ts:329`). From there, `determinePreflightRoute` and `writePreflightReviewArtifacts` → `buildPreflightReviewBlock` write the `### Fix the handoff` bullets for `format` issues. `taskPhasePreflightRejected` then increments `preflight_rejections_current_loop`. All of that routing exists already, so adding issues to the `format` bucket is sufficient.
  - `validateHandoff` has **no** caller in `src/` (only a comment at `src/orchestrator/main.ts:3435`) and no caller in `tests/`. The new AC-2 tests will be its only callers.
- **Callers:** `classifyPreflightBlockersFromData` has three callers: two inside `classifyPreflightBlockers` and the `classifyFixture` helper at `tests/run-task-validation.test.ts:3350`. All three must pass the new required `selfCheckIssues` field; type-check enforces this. `classifyPreflightBlockers` has one caller, at `code-review.ts:329`, and its signature does not change.
  - The revision prompt's "Fix the handoff" list is also restated in `buildPreflightReviewBlock`'s footer ("Fix the handoff structure called out above"). That footer is generic and stays as it is.
- **Tests that can fail:** without the change, each AC-2 handoff produces no Self-Check issue, so each AC-2 test fails on its `issues.some(i => i.startsWith('Self-Check'))` assertion. The AC-4 end-to-end test strips the section from a fixture that otherwise passes; without the change the pre-flight passes, the run proceeds to review, and the counter stays 0. The template, charter, foreman, and prompt tests assert text that does not exist yet.
- **Predicates:** these boundary cases are pinned in Step 1:
  - Evidence: empty, whitespace-only, and punctuation-only (`—`) cells; a leading `_(` placeholder; bare `N/A` variants (`N/A`, `n/a`, `N/A —`, `N/A –`, `N/A -`, `N/A:`, `**N/A**`) versus `N/A — reason`.
  - Labels: bold, backticked, a trailing colon, and other case.
  - Heading: `## Self-check` and `## Self Check`.
  - Duplicate label rows: every one is judged.
  - Zero rows, or a header-only table: three missing-row issues.
  - Commented or fenced tables are invisible.
  - An H3 `### Self-Check` is never a baseline.
- **Scope:** every file below is in Affected Files. New test files fall under the `tests/` row. `src/orchestrator/markdown-table.ts` is deliberately not touched.
- **Async/stateful:** N/A. The change is a pure parser plus text. The rejection counter path is existing code.

### Recorded observations (not scope changes; also in notes.md)

- `docs/architecture.md` names `validateHandoff()` as the pre-review gate, but the live gate is `classifyPreflightBlockers`. Both still exist and both gain the check, so the doc stays true. This plan only adds the Self-Check item to it and does not rewrite the gate description.
- `src/orchestrator/main.ts:3435-3436` is a source comment restating the pre-flight list. It is outside Affected Files and is exempt as a comment, so leave it.

## Steps

### Step 1: Self-Check parser and gate wiring

Files: `src/orchestrator/validation.ts`

1. Add `scanSpecManifest` and `scanTableBlocks` to the existing `./markdown-table.js` import on line 6. Both are exported already.

2. Add the parser directly after `checkAcCoveragePlaceholders`:

```ts
export const SELF_CHECK_ROWS = ['Test integrity', 'Restatement sweep', 'Sibling parity'] as const;

const SELF_CHECK_MISSING =
    'Self-Check section is missing — add a baseline `## Self-Check` section to handoff.md in place, after Red-First Evidence ' +
    '(a Check / Evidence table with the rows Test integrity, Restatement sweep and Sibling parity). ' +
    'An Iteration `### Self-Check` subsection does not satisfy this check.';

function normalizeSelfCheckLabel(cell: string): string {
    return cell.replace(/[*_`]/g, '').replace(/:\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Presence-and-fill only. Whether the evidence is TRUE is judged by the
// anchored code-review lens (docs/decisions.md). scanSpecManifest is reused for
// its generic visible-line/heading scan (fences and HTML comments hidden), so
// the template's commented iteration block is never read as a baseline.
export function checkSelfCheckEvidence(handoffContent: string): string[] {
    const { lines, hidden, headings } = scanSpecManifest(handoffContent);
    const baseline = headings.find(h => h.level === 2 && /^##\s+self[- ]check\s*$/i.test(h.text));
    if (!baseline) return [SELF_CHECK_MISSING];
    const end = headings.find(h => h.index > baseline.index && h.level <= 2)?.index ?? lines.length;
    const rows = scanTableBlocks(lines, hidden, baseline.index + 1, end).flatMap(block => block.rows);
    const issues: string[] = [];
    for (const label of SELF_CHECK_ROWS) {
        const matches = rows.filter(row => normalizeSelfCheckLabel(row.cells[0] ?? '') === label.toLowerCase());
        if (matches.length === 0) {
            issues.push(`Self-Check row "${label}" is missing — add it to the baseline \`## Self-Check\` table in place, with its evidence or \`N/A — <reason>\`.`);
            continue;
        }
        for (const row of matches) {
            const evidence = (row.cells[1] ?? '').trim();
            const bare = evidence.replace(/[*_`]/g, '').trim();
            if (!/[\p{L}\p{N}]/u.test(evidence)) {
                issues.push(`Self-Check row "${label}" has an empty Evidence cell — fill it in the baseline \`## Self-Check\` table, or write \`N/A — <reason>\`.`);
            } else if (/^_\(/.test(evidence)) {
                issues.push(`Self-Check row "${label}" still holds the template placeholder — replace it in the baseline \`## Self-Check\` table with the evidence, or \`N/A — <reason>\`.`);
            } else if (/^n\/a[\s.:—–-]*$/i.test(bare)) {
                issues.push(`Self-Check row "${label}" is a bare N/A — give the reason in the baseline \`## Self-Check\` table: \`N/A — <reason>\`.`);
            }
        }
    }
    return issues;
}
```

   Requirements to hold even if Codex restructures the code:
   - Every message starts with `Self-Check`, because the tests filter on that prefix.
   - Case (a) and case (f) share `SELF_CHECK_MISSING`, which names `## Self-Check`, says "baseline", and says the Iteration subsection does not satisfy the check.
   - Row messages name the row.
   - The heading match is case-insensitive.
   - The section ends at the next H1/H2, not at an H3, so an author's `### …` sub-heading before the table cannot cause false missing-row issues.
   - All table blocks in the section are scanned, and label matching ignores extra rows.
   - Placeholder detection keys on the leading `_(` marker, not the wording.
   - Punctuation-only cells count as empty.
   - The bare-N/A test runs on the emphasis-stripped cell, so `**N/A**` is rejected and `N/A — no tests changed` (any dash) passes.

3. In `validateHandoff`, call `issues.push(...checkSelfCheckEvidence(content));` immediately after the `checkAcCoveragePlaceholders` push.

4. Add `selfCheckIssues: string[];` to `PreflightClassificationData`, after `acCoverageIssues`. In `classifyPreflightBlockersFromData`, spread `...data.selfCheckIssues.map(format),` right after the AC Coverage spread.

5. In `classifyPreflightBlockers`, the try branch passes `selfCheckIssues: checkSelfCheckEvidence(content)` and the catch branch passes `selfCheckIssues: []`. The `handoffMissing` early return already covers the catch branch.

### Step 2: Handoff template

Files: `.canon/templates/handoff.md` (then `npm run sync-templates` → `templates/.canon/templates/handoff.md`)

1. Insert this between the `## Red-First Evidence` table and `## Validation Outcomes`:

```markdown
## Self-Check

> One row per pre-handoff self-check, each with evidence a reviewer can check against the diff. **Test integrity:** each behavioral test added or changed, the assertion that pins its failure reason, and how you know it fails without the change (a Red-First Evidence row counts; regenerated snapshots and fixture-only edits are exempt and can be summarized in one line). **Restatement sweep:** the search pattern(s) you ran for each changed contract, and every hit outside Affected Files with how it was handled — updated, or recorded as a Blocker. **Sibling parity:** the parallel paths you examined for each added guard or branch, and whether each got the same treatment, or why not. A row may read `N/A — <reason>`. Write a literal pipe inside a cell as `\|`. Cite paths by the same file-citation rule as the rest of this handoff (full repository-root paths; the markdown-link form for a file that does not exist).

| Check | Evidence |
|---|---|
| Test integrity | _(tests added or changed → the assertion that pins each failure reason → how you know it fails without the change)_ |
| Restatement sweep | _(search pattern(s) run per changed contract → hits outside Affected Files and how each was handled)_ |
| Sibling parity | _(parallel paths examined per added guard or branch → same treatment, or why not)_ |
```

2. In the `<!-- On revision rounds … -->` block, insert this between the `### Red-First Evidence` table and `### Re-run validation (only checks that re-ran)`:

```markdown
### Self-Check

_Include only when this round makes an earlier Self-Check row incomplete or untrue, and include only the rows it updates. Each row restates that check's evidence for all work on the branch, not only this round, and supersedes every earlier version of that row (earlier rows stay in place as history). This subsection never replaces the baseline `## Self-Check` section._

| Check | Evidence |
|---|---|
```

Keep the existing `tests/red-first-evidence-template.test.ts` assertions true. `## Red-First Evidence` must stay before `## Validation Outcomes`, and the comment block must still contain the red-first columns.

### Step 3: Implement prompts (fresh, reroute, resume)

Files: `src/orchestrator/prompts/templates/implement.md`, `src/orchestrator/prompts/templates/implement-reroute.md`, `src/orchestrator/prompts/index.ts`

1. **Fresh** (`implement.md`): inside `{{#selfCheck}}`, after item 3 and before the "If a check finds an edit needed…" line, add this paragraph verbatim. Call it the **record paragraph**:

   > Record each check's evidence in handoff.md's `## Self-Check` table (`Check` | `Evidence`, one row each for `Test integrity`, `Restatement sweep` and `Sibling parity`): the tests and the assertion that pins each one's failure reason, and how you know it fails without the change; the search pattern(s) you ran for each changed contract, and how each hit outside Affected Files was handled; the parallel paths you examined, and whether each got the same treatment. Write `N/A — <reason>` for a check that does not apply, and `\|` for a literal pipe. Write the section even if the handoff template you are using lacks it: code review rejects a handoff without a filled `## Self-Check` section, and the reviewer checks each row against the diff.

2. **Reroute** (`implement-reroute.md`): add the same record paragraph verbatim at the same position in its self-check block. Then change step 7's sentence "Carry existing Red-First Evidence rows forward." to:

   > Carry existing Red-First Evidence rows forward. The rewritten `## Self-Check` table covers all work on the branch: carry earlier rounds' Self-Check evidence forward (the baseline rows and any Iteration `### Self-Check` rows), updated to the current diff.

   The existing assertion `/Carry existing Red-First Evidence rows forward/` stays true.

3. **Resume** (`promptImplementResume` in `index.ts`): change line 2 of the returned array to:

   `'2. Write handoff.md for each task (intent/rationale, deviations, AC coverage, the `## Self-Check` evidence table — test integrity, restatement sweep, sibling parity, each with evidence or `N/A — <reason>` — and validation outcomes).'`

   This matters because resume mode renders `selfCheck: false`, so the summary is the only place this session sees the section.

Wording constraint (CLAUDE.md "Adopter Scope"): name no canon-ai paths and no function names in these prompts. The text above complies.

### Step 4: Revision prompt

Files: `src/orchestrator/prompts/templates/implement-revisions.md`

1. **Findings branch, step 4.** Replace "Include only the delta: findings addressed, AC deltas, re-run validation results." with:

   > Include only the delta: findings addressed, AC deltas, re-run validation results. One exception: a `### Self-Check` subsection (see the Self-Check rule below) restates whole-branch evidence rather than this round's delta.

2. **Pre-flight branch, step 1.** Change the "Fix the handoff" bullet to:

   > **"Fix the handoff"** items → fix `handoff.md` (Validation Outcomes rows, AC Coverage table, Self-Check table, Changes table). Fix a Self-Check item by adding or repairing the baseline `## Self-Check` section in place — an Iteration `### Self-Check` subsection does not satisfy the pre-flight.

   The existing test still matches `/fix the handoff, fix the code, or both/`. That phrase comes from the state header, so do not touch it.

3. **Iteration rules.** Add this bullet after the red-first checkpoint bullet. It is shared by both branches, so a "Fix the code" pre-flight round that changes tests is covered too:

   > - **Self-Check evidence on revision rounds**: append a `### Self-Check` subsection to this round's Iteration section whenever the round makes an earlier Self-Check row incomplete or untrue — it adds, renames, or changes behavioral tests, contracts, or guards, or a review finding says an earlier row is contradicted. Include only the rows that change. Each row you write restates that check's evidence for all work on the branch, not only this round, and supersedes the earlier version of that row; leave earlier rows in place as history. Never write a round-scoped row such as `N/A — no tests changed this round`: it supersedes the branch's real evidence and reads as false.

### Step 5: Anchored charter, foreman, review template

Files: `.claude/agents/code-review-anchored.md`, `src/orchestrator/prompts/templates/code-review-foreman.md`, `.canon/templates/review.md` (then sync → `templates/.claude/agents/code-review-anchored.md`, `templates/.canon/templates/review.md`)

1. **Charter, Stage 1.** Insert a new item 6 after the red-first item 5, and renumber "If Stage 1 fails…" to 7:

   > 6. Check the Self-Check evidence in `handoff.md` against the current cumulative diff. Read every Self-Check block — the baseline `## Self-Check` section and each Iteration `### Self-Check` subsection — and judge only the *effective record*. For each check (Test integrity, Restatement sweep, Sibling parity), the effective row is the one in the latest block that has a filled row for that check; the baseline counts as the earliest block, and an Iteration row that is empty or still a placeholder supersedes nothing. Superseded rows are history and are not judged. For example, if the baseline row reads `N/A — no tests changed` and a later Iteration row names a behavioral test the revision added, the Iteration row is effective and the baseline `N/A` is not a gap. Likewise, if a review round found a baseline row contradicted and the next Iteration row restates corrected evidence, judge only the corrected row. An effective row the diff contradicts is a Stage 1 gap: a named test is absent or does not assert what the evidence claims; re-running a stated restatement search finds a hit outside Affected Files that was neither updated nor recorded as a Blocker; a named sibling path does not exist, or its treatment differs from the claim; or the diff contradicts an `N/A` reason. An effective row that was true when written but that a later round's change made untrue is still a contradiction. Only contradictions are Stage 1 gaps; omissions belong in Stage 2.

   Do not name any implement prompt template file, so the existing `doesNotMatch(stage1, /implement(?:-revisions|-reroute)?\.md/)` stays true.

2. **Charter, Stage 2.** Add this paragraph after "Find correctness bugs, … where applicable.":

   > **Self-Check omissions.** A behavioral test file the diff changes that no Self-Check evidence mentions is a `risk/guardrail` finding, not a Stage 1 gap. Regenerated snapshots and fixture-only edits are exempt.

3. **Foreman** (`{{^isRound1}}` paragraph). Append this after the red-first sentence:

   > Also tell the anchored lens to read Self-Check evidence across the baseline `## Self-Check` section and every Iteration `### Self-Check` subsection, and to judge the effective record: for each check, the latest filled row; superseded rows are history and are not judged.

4. **Review template, Stage 1 Validation Gate list.** Add this directly after the red-first checkbox:

   `- [ ] Self-Check evidence not contradicted by the diff (the effective row per check — the latest filled row across the baseline Self-Check section and Iteration Self-Check subsections)`

   Keep `#` out of this line so the heading parser pitfall cannot apply.

### Step 6: Docs

Files: `docs/pipeline-orchestrator.md` (then sync → `templates/docs/pipeline-orchestrator.md`), `docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`

1. **`docs/pipeline-orchestrator.md:451`**, "The validation-outcome pre-flight is structural, not spec-matching." Append:

   > The same gate checks the handoff's `## Self-Check` section for presence and fill only: the section exists, its three rows (Test integrity, Restatement sweep, Sibling parity) are present, and no Evidence cell is empty, the template placeholder, or a bare `N/A` with no reason. An Iteration `### Self-Check` subsection does not satisfy it. Whether the evidence is true is judged by the anchored code-review lens in Stage 1, against the effective record (the latest filled row per check).

2. **`docs/architecture.md`.**
   - Line 88: the pre-flight parenthetical becomes `(no `Fail` rows, AC coverage table populated, Self-Check section present with three filled rows, all required validations present)`.
   - Line 188 (`validateHandoff()` gate bullet): add "a missing or unfilled `## Self-Check` section" to the rejection list. This also applies to `classifyPreflightBlockers`, which the live pre-flight calls; add that note in one short clause.

3. **`docs/codebase-map.md:60`.** The row label becomes `Pre-flight gate before code review (validation outcomes, AC coverage, Self-Check presence)`.

4. **`docs/decisions.md`.** Add a new entry directly after "Red-first evidence is checked in anchored Stage 1, not pre-flight", in the same three-part shape:

   > ## Self-Check evidence: presence at pre-flight, truth at the anchored lens
   >
   > **Decision**: The code_review pre-flight rejects a handoff whose baseline `## Self-Check` section is missing, lacks one of its three rows, or has an empty, placeholder, or bare-`N/A` Evidence cell. Whether the evidence is true is judged only by the anchored code-review lens in Stage 1.
   >
   > **Why**: The pre-flight is structural (`docs/pipeline-orchestrator.md`, "The validation-outcome pre-flight is structural, not spec-matching"). Presence and fill are judgeable from the handoff alone; truth needs the diff and the spec. Evidence rows, unlike checkboxes, are falsifiable against the diff.
   >
   > **Rule**: The lens judges the effective record (the latest filled row per check across the baseline section and Iteration subsections), not superseded rows. A contradicted claim is a Stage 1 gap; an omission is a Stage 2 `risk/guardrail` finding.

   `docs/decisions.md` is root-only, with no mirror. Do not add a `templates/docs/decisions.md` row (docs/patterns.md §"Declare `templates/` mirrors…").

### Step 7: Fixtures that must pass pre-flight (AC-9)

Files: `tests/run-task-code-review.test.ts`, `tests/recovery-hints.test.ts`, `tests/run-task-safety-helpers.ts`, `tests/run-task-validation.test.ts`

Grep `AC Coverage` under `tests/` to get the work set. Any handoff without a filled AC Coverage table already fails pre-flight, so these four files are the complete set. In each handoff fixture that has a filled AC Coverage table, append a filled section after it:

```
'## Self-Check', '', '| Check | Evidence |', '|---|---|',
'| Test integrity | fixture: no behavioral tests |', '| Restatement sweep | fixture: none |', '| Sibling parity | fixture: none |', '',
```

The four fixtures:
- `tests/run-task-code-review.test.ts:93` (`writeTask`)
- `tests/recovery-hints.test.ts:619`
- `tests/run-task-safety-helpers.ts:1730` (the appended AC Coverage block)
- the `classifyFixture` helper in `tests/run-task-validation.test.ts:3350`, which only needs `selfCheckIssues: []` added

Then run `npm test`. Any newly failing test whose fixture expects a pre-flight pass gets the same block. Do not change the expected values of tests that assert other issues.

### Step 8: New tests

Files: `tests/run-task-validation.test.ts`, `tests/run-task-code-review.test.ts`, `tests/run-task-prompts.test.ts`, new `tests/self-check-evidence-template.test.ts`

1. **`run-task-validation.test.ts`, AC-2/AC-3 pure.** Add a `selfCheckHandoff(rows, { heading = '## Self-Check' })` builder and a fully filled `VALID_SELF_CHECK` constant. Add:
   - one `void test` per AC-2 case (a)–(f) asserting `checkSelfCheckEvidence(...)`. For (a) and (f), assert the exact `SELF_CHECK_MISSING` text: it contains `## Self-Check`, `baseline`, and `does not satisfy`. For (b)–(e), assert a message that names the row.
   - one test per bare-N/A variant in (e): `N/A`, `n/a`, `N/A —`, `N/A –`, `N/A -`.
   - AC-3: one test each asserting `[]` for real evidence, `N/A — no tests changed`, `N/A – x`, `N/A - x`, `## Self-check`, bold labels (`**Test integrity**`), an Evidence cell containing `` `a\|b` ``, and a valid baseline plus an Iteration `### Self-Check` still holding placeholders.
   - fail-closed tests: a section with a header-only table and a section with prose only each yield three missing-row issues. A `## Self-Check` that exists only inside `<!-- -->` yields the missing-section issue.
2. **`run-task-validation.test.ts`, AC-2 through both entry points.** For each AC-2 case (a)–(f), use `withTempTasks` to write `tasks/<id>/spec.md` (with `## Validation Required\n\n- [x] \`npm test\``) and a `handoff.md` that is otherwise valid: Changes, filled AC Coverage, a Pass Validation Outcomes row, and the case's Self-Check variant. Assert that both `validateHandoff(id)` and `classifyPreflightBlockers(id, new Set())` contain an issue starting with `Self-Check`. Also assert the case's specific message. Writing spec.md matters: if it is missing, `validateHandoff`'s catch reports "handoff.md not found" and masks the result.
3. **`run-task-validation.test.ts`, AC-4 pure.**
   - `classifyPreflightBlockers` for a handoff missing the section returns the Self-Check issue with `bucket: 'format'`.
   - `buildPreflightReviewBlock(classified, determinePreflightRoute([{ taskId, classified }]))` contains `### Fix the handoff`, followed by `- Self-Check section is missing`, with no `### Fix the code`.
   - `classifyFixture([{ result: 'Pass' }], [], { selfCheckIssues: ['Self-Check row "Sibling parity" is missing'] })` maps to `['format']`.
4. **`run-task-code-review.test.ts`, AC-4 end-to-end.** Copy the shape of 'pre-flight rejection writes no cold-Codex archive':
   - `writeTask(tasksRoot, 'selfcheck')`, then rewrite its handoff without the `## Self-Check` block;
   - `runCodeReviewPhase(makeState(['selfcheck']), false, null, deps)` returns `agent: null`;
   - `readStatus('selfcheck').phases.code_review?.preflight_rejections_current_loop === 1`;
   - `review.md` contains `### Fix the handoff` and `Self-Check section is missing`.
5. **`run-task-prompts.test.ts`, AC-5 and AC-7.**
   - Define `const SELF_CHECK_RECORD = 'Record each check's evidence in handoff.md's `## Self-Check` table'` and the record paragraph's closing sentence. Assert that `promptImplement(baseState,'fresh',[],'main')` and `promptImplementReroute(rerouteState)` both include them.
   - The reroute prompt matches `/carry earlier rounds' Self-Check evidence forward/`.
   - The revision prompt (findings branch, `iterState`) matches `/append a `### Self-Check` subsection/`, `/restates that check's evidence for all work on the branch/`, `/supersedes the earlier version/`, and `/leave earlier rows in place as history/`.
   - Hoist the `preflightTask` construction from the existing 'selects pre-flight branch' test into a module-level helper. Add a `void test('promptImplementRevisions_preflight', …)` that calls `recordOrAssert('promptImplementRevisions_preflight', normalize(promptImplementRevisions(makeState(preflightTask()), [], 'main')))` and asserts it contains `Self-Check table` and `repairing the baseline `## Self-Check` section in place`.
   - `promptImplementResume(baseState)` matches `/the `## Self-Check` evidence table/`.
   - Foreman: `promptCodeReview(codeReviewRoundNState)` matches `/read Self-Check evidence across the baseline `## Self-Check` section and every Iteration `### Self-Check` subsection/` and `/judge the effective record/`. `promptCodeReview(baseState)` (round 1) does not.
6. **New `tests/self-check-evidence-template.test.ts`, AC-1, AC-6, AC-8.** Copy `tests/red-first-evidence-template.test.ts`.
   - **AC-1:**
     - Exactly one `^## Self-Check$`, after `## Red-First Evidence` and before `## Validation Outcomes`.
     - Parse the template with `checkSelfCheckEvidence` and assert three "placeholder" issues, one per row (no missing-row issue). This proves the parser finds all three rows.
     - The text contains `N/A — <reason>`, `\|`, and `file-citation rule`.
     - In the `<!--` comment: index of `### Red-First Evidence` < `### Self-Check` < `### Re-run validation`, and the subsection text matches `/only the rows it updates/`, `/all work on the branch/`, and `/supersedes every earlier version/`.
   - **AC-6:** `stage1 = charter.split('## Stage 2')[0]`. Split the numbered items with `/^\d+\. /m`, find the item containing `Red-First Evidence`, and assert the next item contains `Self-Check`, `effective`, `supersedes nothing`, `not judged`, `N/A — no tests changed`, and `corrected`. Assert `doesNotMatch(stage1, /implement(?:-revisions|-reroute)?\.md/)`. Assert the Stage 2 part matches `/Self-Check omissions[\s\S]*risk\/guardrail/`.
   - **AC-8:**
     - The review template matches `/^- \[ \] Self-Check evidence not contradicted by the diff/m`, located after the red-first checkbox.
     - Parse check: `extractCheckedVerdict(template)` is `null`. With `- [ ] **Approved** — ship as-is` replaced by `- [x] **Approved** — ship as-is`, it returns `'approved'`.

### Step 9: Regenerate, build, sync, validate

1. Run `UPDATE_GOLDENS=1 node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-prompts.test.ts`. This regenerates `tests/run-task-prompts.golden.json` and adds `promptImplementRevisions_preflight`.
2. Review the golden diff. Changes are expected only in these keys:
   - `promptImplement_fresh`
   - `promptImplementReroute` and `promptImplementReroute_resumed`
   - `promptImplementRevisions` and the new `_preflight`
   - `promptCodeReview_roundN`, `promptCodeReview_deltaRound`, `claude_code_review_round2`, and any other round-N foreman key
   
   A change anywhere else is a bug.
3. Run `npm run sync-templates`. This writes the mirrors for `handoff.md`, `review.md`, the anchored charter, and `pipeline-orchestrator.md`.
4. Run `npm run build`. This rebuilds the tracked `dist/`, which bundles the prompt templates. List the changed `dist/` files in the handoff Changes table.
5. Run every Validation Required check: lint, type-check, test, build, docs-refs-check, and sync-templates:check.

## Testing Plan

- **Unit:**
  - AC-2 (each case through the pure function and through both entry points) and AC-3 tolerance plus fail-closed cases in `tests/run-task-validation.test.ts`;
  - AC-4 bucket and framing (pure) there too, and end-to-end counter plus `review.md` in `tests/run-task-code-review.test.ts`;
  - AC-5/AC-7 prompt assertions and goldens in `tests/run-task-prompts.test.ts`;
  - AC-1/AC-6/AC-8 structure in `tests/self-check-evidence-template.test.ts`.
- **E2E:** N/A. The project has no browser E2E. The `runCodeReviewPhase` test is the integration path.
- **Manual:** this is the spec's Human Test Plan. On the next real task, check that the handoff has three evidence rows. Deleting a row before review should produce a pre-flight rejection naming that row.

## Rollback Plan

Revert the commit. There is no data or state migration: `status.json` is unchanged, and handoffs that already have a `## Self-Check` section remain valid markdown for older engines, which ignore it. One risk worth knowing: in-flight tasks are deliberately not grandfathered. After upgrading, their first pre-flight rejects a handoff that has no section, and the implementer adds the baseline in place, costing one round. If that cost proves unacceptable, the fast fix is removing the `selfCheckIssues` spread in `classifyPreflightBlockersFromData`. That leaves the lens text in place and disables only the gate.
