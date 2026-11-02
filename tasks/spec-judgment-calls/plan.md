# Implementation Plan: spec-judgment-calls

> Written by: Claude | Implements: `tasks/spec-judgment-calls/spec.md`

## Approach

Text-only change across canon's guidance surfaces, plus one parity test and one selfCheck string. The three canonical sentences are copied verbatim (no paraphrase) onto every carrier and pinned by a test that reads them from one definition, following the existing "refactor correctness-audit guidance stays aligned across spec surfaces" test (`tests/run-task-prompts.test.ts:1115`).

Canonical strings (copy byte-for-byte; plain ASCII hyphens/colons, no backticks, no trailing variation):

- **D**: `A judgment call is a choice between two or more defensible options where the choice changes behavior or scope.`
- **S**: `A choice a project doc already settles is not a judgment call: follow the doc and cite it.`
- **B**: `Name the call, a defensible alternative the spec does not record, and the AC or behavior that would differ under it; if you cannot name all three, do not raise it.`

Everywhere D appears, write it immediately followed by one space and S (`D S`), so Decision 2's "S immediately after D" is testable as one contiguous string.

**Spec-review nit (approved_with_nits).** The nit asked to add `docs/pipeline-orchestrator.md` to the D/S parity carriers. The spec gate already applied it (see notes.md `[spec gate]`): AC-7 requires D and S in that doc's Shape Check restatement and AC-9 lists the doc and its mirror. The plan carries it in Steps 5 and 9.

**Feasibility check.**
- **Exists:** confirmed by grep/read: `.canon/templates/spec.md` (`## Decision` then `## Non-Goals`, Spec Quality Checklist at end); `.canon/templates/spec-review.md` Shape Check list lines 9–12; `.canon/templates/done.md` `## Decisions Made` at line 42; `docs/pipeline-orchestrator.md:183` Shape Check restatement; `src/orchestrator/prompts/index.ts:163` `selfCheck` array in `promptSpec`; prompt templates `spec.md` (rules of thumb lines 14–27), `spec-revision.md` (same bullet list), `spec-review.md` (strategic read, "Is the framing right?" bullet), `qa.md` (step 1 line 9, step 4 lines 21–44, output list lines 75–82); `.claude/skills/canon-spec/SKILL.md` (grill bullets :88/:93, Phase 5 self-check :140, rules of thumb :152, STOP :165); `.claude/skills/canon-spec-review/SKILL.md:60` "Check these ten items", item (10) at :70; `.claude/skills/canon-pipeline/SKILL.md:52` "What happens after `canon run`" paragraph. All mirrors exist under `templates/` (`.canon/templates/{spec,spec-review,done}.md`, `docs/pipeline-orchestrator.md`, the three skills). Golden keys `promptSpec`, `promptSpec_withDocsMap`, `promptSpecRevision`, `promptSpecRevision_withDocsMap`, `promptSpecReview`, `promptQa`, `promptQa_withTemplate` exist in `tests/run-task-prompts.golden.json`.
- **Real path:** prompt templates are imported as strings in `src/orchestrator/prompts/index.ts` and rendered by `render()`; `tsup` bundles them into `dist/` (tracked), so `npm run build` is required. Canon-managed root files are mirrored to `templates/` by `npm run sync-templates`. Nothing on the path already does this work: `grep -rn "Judgment Calls" src tests scripts` returns nothing today.
- **Callers:** no function signature or error contract changes. `promptSpec` output changes only through its template and one added selfCheck string; `promptQa` only through `qa.md`. Every rendering of `qa.md` (single and bundle) gets the new text; only `promptQa`/`promptQa_withTemplate` have goldens. `promptArtifactFixup_qa` and the reroute spec-review goldens use other templates and must not change (AC-12).
- **Tests that can fail:** the new parity test fails if D, S, or B is missing from any listed carrier or if `D S` is not contiguous; the red-first demonstration is deleting D from one carrier (e.g. `src/orchestrator/prompts/templates/spec-revision.md`) and re-running. Golden tests fail until `UPDATE_GOLDENS=1` regenerates exactly the seven keys.
- **Predicates:** the test's carrier lists must be non-empty and every path must exist (`fs.existsSync` assertion before `includes`), so a typo'd path or empty list fails rather than passing vacuously. No runtime predicates are added.
- **Scope:** every file below is in the spec's Affected Files. `tests/task-cli.test.ts` is read-only here (its existing test, see Step 10, is the AC-10 evidence); no edit.
- **Async/stateful:** N/A.

**Interaction constraints the implementer must respect** (from spec §Interaction Dependencies, verified):
- No new text may contain the phrase `correctness audit` (the existing parity test takes the *first* such line in `src/orchestrator/prompts/index.ts` and in the spec-review prompt).
- Nothing new goes between the "Refactor specs need structural caps" bullet and the "Refactor specs need a correctness audit" bullet in either prompt template (the test asserts adjacency at `tests/run-task-prompts.test.ts:1180-1184`).
- No new line in `.claude/skills/canon-spec-review/SKILL.md` may mention `Non-Goals` or `explicitly exclude` (`tests/run-task-prompts.test.ts:740-742` would then require `verif... unaffected` on that line). Items (1)–(10) keep number and text; the lens test splits on `(3) **Affected Files**` / `\n(4)`.
- Canon-managed text (`.canon/templates/*`, skills, `docs/pipeline-orchestrator.md`) must not backtick `src/orchestrator/...` paths or internal-only prompt basenames such as `qa.md` / `spec-revision.md` (sync-templates leak guard). `spec-review.md`, `spec.md`, `done.md`, `pr-body.md` are adopter artifacts and are fine.
- In `done.md` guidance, no line may begin with `Acknowledged:`.
- In the spec template, show table rows as table cells; never use the `- [ ] AC-n:` form.

## Steps

### Step 1: Spec template section and checklist item

Files: `.canon/templates/spec.md`

Insert after the `## Decision` body and before `## Non-Goals`:

```markdown
## Judgment Calls

List each judgment call this spec makes. A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. A choice a project doc already settles is not a judgment call: follow the doc and cite it.

Decided by takes exactly one of two values:
- `Human` — the human explicitly chose this option, during the question round or by redirecting at a spec gate. Approving the spec as a whole does not make a row `Human`.
- `Author` — the author's recommendation, not explicitly chosen by the human. A revision that changes a row's chosen option resets that row to `Author`.

If the spec makes no genuine calls, write `None — <reason>` instead of the table.

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| ... | ... | ... | ... | `Author` |
```

Append to the Spec Quality Checklist (after the refactor item, as the last item):

```markdown
- [ ] *Judgment Calls* lists every judgment call the spec makes, each with its strongest alternative and a Decided by value (`Human` or `Author`), or says `None — <reason>`
```

Do not touch the Validation Required matrix (pinned by `tests/validation-matrix-sync.test.ts`).

### Step 2: Spec-review template Shape Check question

Files: `.canon/templates/spec-review.md`

Add a fifth bullet after line 12 (the AC-decomposition bullet):

```markdown
- Does the spec list every judgment call it makes? A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. A choice a project doc already settles is not a judgment call: follow the doc and cite it.
```

### Step 3: done.md template section

Files: `.canon/templates/done.md`

Insert immediately before `## Decisions Made`:

```markdown
## Judgment Calls to Confirm

List every row in the spec's *Judgment Calls* section whose Decided by value is `Author`: the call, the chosen option, and the strongest alternative. These are calls the human did not explicitly make. If there are no `Author` rows, or the spec has no such section, write "None."

- (call — chosen option; alternative: …)
```

### Step 4: canon-spec skill (AC-2, AC-4, AC-5, AC-6)

Files: `.claude/skills/canon-spec/SKILL.md`

- **Grill (AC-5):** keep the `recommended answer` bullet (:88) and "**Always take a position.**" (:93) unchanged. After the grill bullet list, add a bullet: `- On a judgment call, also state the strongest case for the runner-up and what would flip the call, so the user decides between two argued options rather than adopting your lean`.
- **Self-check (AC-2):** append as last item of "Self-check before presenting": `- [ ] *Judgment Calls* lists every judgment call the spec makes, each with its strongest alternative and a Decided by value (\`Human\` or \`Author\`), or says \`None — <reason>\``.
- **Rules of thumb (AC-4):** insert after the "**Behavioral contracts, not mechanics**" bullet (not between the two refactor bullets):

  ```markdown
  - **List every judgment call in *Judgment Calls*.** A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. A choice a project doc already settles is not a judgment call: follow the doc and cite it. For each call record the chosen option, the strongest alternative, why the choice fits, and Decided by: `Human` only when the human explicitly chose it, otherwise `Author`. Listing them is your own obligation as author: on fast-tier (XS, non-delicate) tasks the `spec_review` checkpoint is skipped, so no reviewer will catch an unlisted call.
  ```
- **Phase 5 STOP (AC-6):** in the STOP paragraph at :165, after "present the spec", add a sentence: `When presenting, list the *Judgment Calls* rows marked \`Author\` (calls you made that the human did not explicitly choose), or say there are none.` Keep the rest of the paragraph intact.

### Step 5: Shape Check restatement in docs (AC-7, nit)

Files: `docs/pipeline-orchestrator.md`

At line 183, after the parenthetical list, add: `It also asks whether the spec lists every judgment call it makes. A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. A choice a project doc already settles is not a judgment call: follow the doc and cite it.` Keep it on the same bullet. No backticked paths.

### Step 6: canon-spec-review skill Agent C item (11) (AC-7)

Files: `.claude/skills/canon-spec-review/SKILL.md`

- Line 60: `Check these ten items:` → `Check these eleven items:`.
- Insert directly after item (10), before the blank line and `Constraints:`:

  ```markdown
  (11) **Unlisted judgment calls** — A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. A choice a project doc already settles is not a judgment call: follow the doc and cite it. Does the spec make a judgment call that its *Judgment Calls* section does not list? Name the call, a defensible alternative the spec does not record, and the AC or behavior that would differ under it; if you cannot name all three, do not raise it. A missing or empty section is not, by itself, a finding. An unlisted call that meets this bar is STRONG.
  ```
- Don't mention Non-Goals. Then `grep -n -i "ten items\|\bten\b" .claude/skills/canon-spec-review/SKILL.md` must show no stale count.

### Step 7: canon-pipeline skill gate guidance (AC-6)

Files: `.claude/skills/canon-pipeline/SKILL.md`

In the "What happens after `canon run`" paragraph (:52), change "Review `spec.md` + `spec-review.md`, then re-run …" to "Review `spec.md` + `spec-review.md`, including the `Author` rows in the spec's *Judgment Calls* section (calls the human has not explicitly made, including any the spec reviewer's revisions added), then re-run …".

### Step 8: Pipeline prompt templates and selfCheck (AC-2, AC-3, AC-7, AC-8)

Files: `src/orchestrator/prompts/templates/spec.md`, `src/orchestrator/prompts/templates/spec-revision.md`, `src/orchestrator/prompts/templates/spec-review.md`, `src/orchestrator/prompts/templates/qa.md`, `src/orchestrator/prompts/index.ts`

- **spec.md prompt (AC-3):** insert after the "**Behavioral contracts, not mechanics**" bullet (line 21):

  ```markdown
  - **List every judgment call in *Judgment Calls*** — A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. A choice a project doc already settles is not a judgment call: follow the doc and cite it. For each call record the chosen option, the strongest alternative, why the choice fits, and Decided by: `Human` only when the human explicitly chose it, otherwise `Author`. Listing them is your own obligation as author: on fast-tier (XS, non-delicate) tasks the `spec_review` checkpoint is skipped, so your list is the only check.
  ```
- **spec-revision.md prompt (AC-3):** same position (after "Behavioral contracts"), no fast-tier clause:

  ```markdown
  - **List every judgment call in *Judgment Calls*** — A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. A choice a project doc already settles is not a judgment call: follow the doc and cite it. Add a row for any call the revision introduces. A revision that changes a row's chosen option sets that row's Decided by to `Author`, even if it was `Human`.
  ```
- **spec-review.md prompt (AC-7):** insert a strategic-read bullet directly after "- Is the framing right? …":

  ```markdown
  - Judgment calls: A judgment call is a choice between two or more defensible options where the choice changes behavior or scope. A choice a project doc already settles is not a judgment call: follow the doc and cite it. If the spec makes a judgment call that its *Judgment Calls* section does not list, that is a Blocking finding (requires a changes_requested verdict). Name the call, a defensible alternative the spec does not record, and the AC or behavior that would differ under it; if you cannot name all three, do not raise it. A missing or empty section is not, by itself, a finding; when a spec without the section makes a call that meets this bar, the fix is to add the section.
  ```
  Leave the "Silence is the default" paragraph and the refactor bullet untouched.
- **qa.md (AC-8):**
  - Step 1 (line 9): change the contents list to "… human verification required, judgment calls to confirm, decisions made, open questions." and append a sub-bullet under step 1 (after the ⚠️ line): `- **Judgment Calls to Confirm**: list every row in the spec's *Judgment Calls* section whose Decided by is \`Author\` (call, chosen option, strongest alternative), in a \`## Judgment Calls to Confirm\` section placed immediately before \`## Decisions Made\`. If there are no \`Author\` rows, or the spec has no such section, write \`None.\``
  - Step 4: after the `{{/prTemplate}}` line and before the ⚠️ engineer-voice line, add: `If the spec's *Judgment Calls* has \`Author\` rows, add them to the PR body as calls not explicitly confirmed during spec review, written in the engineer's voice (e.g. "Calls I made that weren't explicitly confirmed in spec review: …"). With no PR template, put them under "Notes for Reviewer". With a PR template, put them under its closest notes-like section, or append a short \`Judgment calls\` heading at the end if it has none. With no \`Author\` rows, add nothing.` Keep this outside the `{{#prTemplate}}`/`{{^prTemplate}}` blocks so both goldens get it once.
  - Output Format list: insert a new item before "Decisions made during implementation" — `Judgment calls to confirm: the spec's \`Author\` rows, or None. (\`## Judgment Calls to Confirm\`)` — and renumber the following items (5→6, 6→7, 7→8). Keep each existing item's text, including `## Root Cause`.
- **index.ts selfCheck (AC-2):** append to the `selfCheck` array in `promptSpec` (after the refactor line at :176): `'- *Judgment Calls* lists every judgment call the spec makes, each with its strongest alternative and a Decided by value (Human or Author), or says None — <reason>'`. No `correctness audit` phrase.

### Step 9: Canonical-text parity test (AC-9)

Files: `tests/run-task-prompts.test.ts`

Add after the refactor parity test (ends ~line 1211), same `readRepoFile` helper shape:

```ts
void test('judgment-call guidance stays aligned across spec surfaces', () => {
    const worktreeRoot = process.cwd();
    const repoPath = (relPath: string): string => path.join(worktreeRoot, relPath);
    const readRepoFile = (relPath: string): string => fs.readFileSync(repoPath(relPath), 'utf8');
    const D = 'A judgment call is a choice between two or more defensible options where the choice changes behavior or scope.';
    const S = 'A choice a project doc already settles is not a judgment call: follow the doc and cite it.';
    const B = 'Name the call, a defensible alternative the spec does not record, and the AC or behavior that would differ under it; if you cannot name all three, do not raise it.';
    const carriersWithDS = [
        '.canon/templates/spec.md',
        '.canon/templates/spec-review.md',
        '.claude/skills/canon-spec/SKILL.md',
        '.claude/skills/canon-spec-review/SKILL.md',
        'src/orchestrator/prompts/templates/spec.md',
        'src/orchestrator/prompts/templates/spec-revision.md',
        'src/orchestrator/prompts/templates/spec-review.md',
        'docs/pipeline-orchestrator.md',
        'templates/.canon/templates/spec.md',
        'templates/.canon/templates/spec-review.md',
        'templates/.claude/skills/canon-spec/SKILL.md',
        'templates/.claude/skills/canon-spec-review/SKILL.md',
        'templates/docs/pipeline-orchestrator.md',
    ];
    const carriersWithB = [
        'src/orchestrator/prompts/templates/spec-review.md',
        '.claude/skills/canon-spec-review/SKILL.md',
        'templates/.claude/skills/canon-spec-review/SKILL.md',
    ];
    for (const list of [carriersWithDS, carriersWithB]) {
        assert.ok(list.length > 0);
        for (const file of list) assert.ok(fs.existsSync(repoPath(file)), `${file} does not exist`);
    }
    for (const file of carriersWithDS) {
        const content = readRepoFile(file);
        assert.ok(content.includes(D), `${file} is missing canonical definition D`);
        assert.ok(content.includes(S), `${file} is missing canonical settled-choice rule S`);
        assert.ok(content.includes(`${D} ${S}`), `${file} must state S immediately after D`);
    }
    for (const file of carriersWithB) {
        assert.ok(readRepoFile(file).includes(B), `${file} is missing canonical review bar B`);
    }
});
```

Also add one rendered-output assertion so a template edit that never reaches the prompt builder is caught: `assert.ok(promptSpecReview(baseState).includes(B))` and `assert.ok(promptSpec(baseState).includes(D))` — `baseState` is the module-level fixture the `promptSpecReview` golden test already uses (`tests/run-task-prompts.test.ts:245`). Do not assert on the reroute variants: amendment-only review is out of scope and must not carry B.

Red-first: delete D from `src/orchestrator/prompts/templates/spec-revision.md`, run `npx tsx --test tests/run-task-prompts.test.ts` (or the repo's single-file test invocation), record the failing assertion message in the handoff, restore, re-run green.

### Step 10: Mirrors, build, goldens, validation (AC-10, AC-11, AC-12)

1. `npm run sync-templates` then `npm run sync-templates:check`.
2. `npm run build` (dist/ is tracked; prompt templates are bundled).
3. `UPDATE_GOLDENS=1 npm test`, then `git diff --stat tests/run-task-prompts.golden.json` and confirm the changed keys are exactly the seven in AC-12 (a quick `node -e` diff of old vs new key values against `git show HEAD:tests/run-task-prompts.golden.json` is the reliable check). An eighth key means a shared fragment leaked — stop and fix the edit, don't accept it. `tests/completion.test.ts` has its own golden; it must not change.
4. AC-10: `grep -rn "Judgment Calls" src/` → hits only under `src/orchestrator/prompts/`. Evidence that a section-less spec can still be marked `spec done`: the existing test in `tests/task-cli.test.ts` (around line 442–452) writes a spec with no `## Judgment Calls` section and asserts `canon task phase rt spec done` exits 0; cite it in the handoff (no edit).
5. AC-11: `git diff --name-only <base>...HEAD` must not include `.canon/templates/review.md`, `.claude/agents/code-review-anchored.md`, `src/orchestrator/prompts/templates/spec-review-reroute.md`, anything under `.claude/skills/canon-init/` or `templates/.claude/skills/canon-init/`, `src/orchestrator/phases/`, or `src/orchestrator/validation.ts`.
6. Full Validation Required: `npm run lint`, `npm run type-check`, `npm test`, `npm run build`, `npm run sync-templates:check`, `npm run docs-refs-check`.

## Testing Plan

- **Unit**: new parity test (Step 9) with red-first demonstration; existing refactor parity test and spec-review-lens structural test must stay green unchanged; regenerated goldens for the seven keys.
- **E2E**: N/A.
- **Manual**: the spec's Human Test Plan (post-merge, human).

## Rollback Plan

Pure guidance/text plus one test; revert the commit and rebuild `dist/`. No data or state migration. Specs written with a `## Judgment Calls` section remain valid after a revert because no parser reads it.

## Open questions recorded (unattended)

- None blocking. Wording of the non-canonical parts of each bullet (grill line, gate sentences, QA phrasing) is the plan's proposal; the implementer may adjust wording as long as D, S, B stay verbatim and the AC-named elements are present.
