# Implementation Plan: ship-followup-capture

> Written by: Claude | Implements: `tasks/ship-followup-capture/spec.md`

## Approach

The work has four parts:

1. Add a pure Follow-ups parser in `src/orchestrator/followups.ts`, built on the exported fence- and comment-aware scanners in `src/orchestrator/markdown-table.ts`.
2. Wire the parser into the qa phase gate (`checkPhaseGate`) and into the qa evidence auto-advance (`tryEvidenceAdvance`).
3. Read rows in `shipTasks` after merge proof and before the fold and archive, and print them after the final "Shipped" line.
4. Update the template, prompt, skill and docs.

The spec review verdict was `approved` with no nits, so nothing from review is carried in.

### Feasibility check

- **Exists:** all of the following exist in the code.
  - In `markdown-table.ts`: `scanSpecManifest(markdown)`, which returns `{ lines, hidden, headings }` and is exported and fence/comment-aware; `scanTableBlocks(lines, hidden, start, end)`, which returns raw cells per row, so cell counts survive.
  - `isValidTaskId` in `src/lib/project-root.ts:54` (`/^[a-z0-9][a-z0-9._-]*$/`, no `..`).
  - `checkPhaseGate` and `PHASE_GATE_CONFIG.qa` at `src/orchestrator/validation.ts:977`.
  - `tryEvidenceAdvance`, qa case, at `src/orchestrator/main.ts:~3635`.
  - `shipTasks` at `main.ts:2527`.
  - `info` and `warn` at `src/orchestrator/cli.ts:176/180`, writing to stdout and stderr.
  - The `taskFiles` option of `prepareShipFixture`, which already writes custom files into both the task branch and the simulated origin merge.
  - `visibleMarkdownLines` is not exported, and `markdown-table.ts` is not in Affected Files. Use `scanSpecManifest` for lines, hidden and headings. It works on any document and is not specific to specs.
  - `scanAllTables` pads and drops cells per header, so it cannot detect a wrong cell count. Don't use it.
- **Real path:**
  - qa gate: QA's own `canon task phase <id> qa done` → `taskPhase` (`src/task/index.ts:470`) → `checkPhaseGate`. When the gate rejects, the error reaches the QA session, which repairs the file in the same turn.
  - If QA ends with qa still not done, `checkAndRoute` → `recoverPhaseForTask` → `tryEvidenceAdvance('qa')` → `taskPhase`. Today the qa case there only checks `isDoneMdTemplate`, and `recoverPhaseForTask` does not catch throws. The new check must therefore also run in `tryEvidenceAdvance` and return `{ advanced: false, note }`. That note feeds `retryAgentForPhase`, which is the repair route.
  - ship: both merge paths (`merged` true, or `merged` false meaning externally merged) meet at the proof loop (`main.ts:~2795`). The read goes right after the `proofFailures` check, before `foldTelemetryFragments`.
- **Override and stderr:** `taskDirForRepoRoot` (`state.ts:283`) honors `CANON_TASKS_DIR_OVERRIDE`. The search for empty-stderr assertions covered only `tests/run-task-ship*.ts`.
- **Callers:**
  - `checkPhaseGate` is called by `taskPhase` (all `canon task phase … done`), `shipTasks` (human_review only), and `main.ts:3368` (human_review only). Only the qa branch changes.
  - `taskPhase(…,'qa','done')` writers:
    - the QA agent itself;
    - `tryEvidenceAdvance` (patched in Step 3);
    - the stdout salvage in `src/orchestrator/phases/qa.ts:58`. This one is not in Affected Files; see Contradictions.
    - `canon task accept` covers implement, spec_review and code_review only, so it does not apply.
- **Tests that can fail:**
  - AC-3 parser tests feed literal markdown, and each failure case sends a distinct input.
  - AC-4 writes a real-content done.md with no section, then with a broken table. With the check removed, both would pass the gate.
  - AC-5/6/7/9 use `taskFiles` to put a Follow-ups table in done.md. With the ship read removed, the block assertions fail.
  - AC-8 uses the default stub (`# Done: <id>`), a broken table, and an omitted file.
- **Predicates:** pinned in Step 1 (section states, Tracked-cell boundaries).
- **Scope:** every step's file is in Affected Files, except the fixture edits listed under Contradictions.
- **Async/stateful:** the ship read is synchronous and read-only. Rows live in memory between the read and the final print. If ship dies in between, the rows are lost (accepted Known Risk). No status or session state is involved.

### Contradictions with the spec (also in notes.md as `[plan]`)

1. **The qa.ts salvage path will throw.** `runQaPhase` salvages a stdout-streamed done.md, then calls `taskPhase(taskId,'qa','done')` directly (`src/orchestrator/phases/qa.ts:58`).
   - A salvaged done.md with no valid Follow-ups section now makes `taskPhase` throw. Nothing in `runQaPhase` catches it, so the run aborts with the `check-phase-gate:` error, leaving qa `in_progress` and the salvaged done.md on disk. A re-run repeats QA.
   - The fix is a one-line guard in qa.ts: check `doneMdFollowupsProblem` before `taskPhase`, warn and fall through on a problem so `recoverPhaseForTask` handles it. qa.ts is not in Affected Files, though.
   - **Implementer: do not edit qa.ts.** Record this in the handoff as a known gap. The operator decides whether to amend.
2. **Test fixtures outside Affected Files will fail.** `tests/run-task-safety-base-drift.test.ts:~1848` writes done.md as `# QA Summary: task-a\n\nReady.\n` and asserts `Auto-advanced 'qa' for 'task-a'` (line 1876). After Step 3, evidence advance refuses that done.md, so the test fails.
   - The minimal fix: append `\n## Follow-ups\n\nNone.\n` to that fixture's done.md string.
   - The fake agent completer in `tests/run-task-safety-helpers.ts` writes status.json directly with no gate, and the `tests/task-cli.test.ts` qa-done tests set `CANON_SKIP_PHASE_GATE`, so neither breaks.
   - **Implementer:** `implement.md` makes Affected Files the scope cap, so **do not edit this file**. Record it under handoff *Blockers*, naming the file, the line, and the one-line fix. Run the full suite and record any other out-of-manifest failure the same way. The expected outcome is that the operator amends Affected Files, so a review halt over this is anticipated, not a loop to fight.

### Choices the spec left open (recorded in notes.md)

- **Section body states:**
  - Exactly one table block, with a separator row and the right header, gives rows. A header-only table gives zero rows and is valid.
  - No table, plus a visible line that is exactly `None.` (trimmed, case-insensitive, with or without the period) gives zero rows.
  - Prose only, or an empty body, is `unparseable`, because prose is the loss this task targets.
  - Two or more table blocks, or a table plus a `None.` line, is `unparseable`.
- **Tracked-cell boundaries:**
  - `#42, #43` counts as untracked, because the spec allows exactly `#<n>`. So does `owner/repo#42`.
  - `dropped (reason)` counts as untracked; only an exact `dropped` is dropped.
  - `TASK:foo` is tracked, because the whole cell is lowercased before matching and the id must be valid lowercase.

## Steps

### Step 1: Follow-ups parser

Files: `src/orchestrator/followups.ts` (new)

```ts
import { scanSpecManifest, scanTableBlocks } from './markdown-table.js';
import { isValidTaskId } from '../lib/project-root.js';

export const FOLLOWUP_CATEGORIES = ['correctness', 'risk', 'spec-gap', 'nit', 'scope', 'observation'] as const;
export type FollowupTracked = 'untracked' | 'dropped' | 'post-ship' | 'tracked';
export type FollowupRow = { category: string; text: string; tracked: FollowupTracked };
export type FollowupsParse =
    | { kind: 'rows'; rows: FollowupRow[] }      // valid table (0+ rows) or `None.`
    | { kind: 'missing' }
    | { kind: 'unparseable'; reason: string };    // reason names the line number

export function classifyTracked(cell: string): FollowupTracked
export function parseFollowups(markdown: string): FollowupsParse
export function followupsProblem(markdown: string): string | null   // null when kind === 'rows'
export function formatShipFollowups(byTask: ReadonlyArray<{ taskId: string; rows: readonly FollowupRow[] }>): string[]
```

`parseFollowups`:

1. Call `const { lines, hidden, headings } = scanSpecManifest(markdown)`.
2. Pick the **last** heading with `level === 2` and `/^## follow-ups\s*$/i.test(text)`. If there is none, return `missing`.
3. The body runs from `heading.index + 1` to the index of the next heading with `level <= 2` (or `lines.length`). Compute this yourself; don't use `sectionEnd`, which stops at H3.
4. Call `scanTableBlocks(lines, hidden, start, end)`. Then:
   - More than one block: unparseable ("more than one table").
   - One block:
     - The header cells, lowercased, must equal `['category','follow-up','tracked']`. Otherwise unparseable, naming the header line.
     - `hasSeparator` must be true.
     - Each row's `cells.length` must be 3. Otherwise unparseable: `line N has K cells, expected 3 (escape a literal pipe as \|)`.
     - If any visible body line matches `None.`, unparseable.
   - Zero blocks: if some visible body line, trimmed, matches `/^none\.?$/i`, return `{ kind:'rows', rows:[] }`. Otherwise unparseable ("no table and no `None.` line").
5. Rows are `{ category: cells[0], text: cells[1], tracked: classifyTracked(cells[2]) }`. Keep an unknown category as written. `splitTableLine` already unescapes `\|`.

`classifyTracked`:

1. Strip whitespace and backticks repeatedly from both ends (`/^[\s`]+|[\s`]+$/g`), then lowercase. Call the result `v`.
2. `v === 'dropped'` → dropped. `v === 'post-ship'` → post-ship.
3. Tracked if any of these match:
   - `/^https?:\/\/\S+$/`
   - `/^#\d+$/`
   - `/^\[[^\]]+\]\([^)\s]+\)$/` (markdown link)
   - `v.startsWith('task:') && isValidTaskId(v.slice(5))`
4. Everything else is untracked, including empty values.

Gate messages from `followupsProblem`, one per failure class:

- missing: ``done.md has no `## Follow-ups` section. Add it after `## Open Questions` with a `| Category | Follow-up | Tracked |` table, or the line `None.` ``
- unparseable: `` done.md `## Follow-ups` cannot be parsed: <reason> ``

`formatShipFollowups` takes the per-task rows that ship collected and returns lines:

- Post-ship block: the heading `Post-ship follow-ups:`, then for each task with post-ship rows a line `  <taskId>:` and rows `    - [<category>] <text>`, then `  Write these in the post-ship docs commit (backlog entries or doc fixes).`
- Untracked block: the same shape with heading `Untracked follow-ups:` and the instruction `  Put these to the human: file now, write post-ship, or drop.`
- Omit a block that has no rows. Return `[]` when both are empty.

### Step 2: qa phase gate

Files: `src/orchestrator/validation.ts`

In `checkPhaseGate`, after the template check (`isTemplate` block) and before the spec lint, add:

```ts
if (phase === 'qa') {
    const problem = followupsProblem(content);
    if (problem) return { ok: false, reason: `${problem}. Fix done.md, then rerun \`canon task phase ${taskId} qa done\`.` };
}
```

Import `followupsProblem` from `./followups.js`. Re-export it from validation.ts (`export { followupsProblem } from './followups.js';`) so main.ts reaches it through `splitValidation`. `CANON_SKIP_PHASE_GATE` already bypasses the whole gate in `taskPhase`, so nothing else is needed for the skip.

### Step 3: evidence auto-advance

Files: `src/orchestrator/main.ts`

In `tryEvidenceAdvance` `case 'qa'`, after the `isDoneMdTemplate` check, mirror the `spec` case:

```ts
if (!process.env.CANON_SKIP_PHASE_GATE) {
    const problem = splitValidation.followupsProblem(fs.readFileSync(donePath, 'utf8'));
    if (problem) return { advanced: false, note: problem };
}
```

`isDoneMdTemplate` already returned early if the file is unreadable, but wrap the read in try/catch and return `{ advanced:false, note:'done.md unreadable' }`, because a throw here kills recovery.

Test (AC-4 support): in `tests/run-task-validation.test.ts`, which already imports from `../src/orchestrator/main.js`, add a case where `tryEvidenceAdvance(id,'qa')` on a real-content done.md with no Follow-ups section returns `advanced:false` with a note matching `/Follow-ups/` and does not throw. Without Step 3 it throws, so the test fails.

### Step 4: ship listing

Files: `src/orchestrator/main.ts`

1. Right after the `proofFailures` die block and before `foldTelemetryFragments`, read each task's done.md:

```ts
const followupsByTask: Array<{ taskId: string; rows: FollowupRow[] }> = [];
for (const taskId of taskIds) {
    let parsed: FollowupsParse;
    try { parsed = parseFollowups(fs.readFileSync(path.join(taskDirForRepoRoot(taskId), 'done.md'), 'utf8')); }
    catch { warn(`Follow-ups for '${taskId}' not listed: done.md is missing.`); continue; }
    if (parsed.kind === 'missing') warn(`Follow-ups for '${taskId}' not listed: done.md has no \`## Follow-ups\` section.`);
    else if (parsed.kind === 'unparseable') warn(`Follow-ups for '${taskId}' not listed: ${parsed.reason}.`);
    else followupsByTask.push({ taskId, rows: parsed.rows });
}
```

   - `taskDirForRepoRoot` honors `CANON_TASKS_DIR_OVERRIDE` like the archive loop that follows, and it is the directory the archive renames. On both merge paths the base was pulled before proof, so the merged done.md is there.
   - Keep the warning prefix `Follow-ups for '<id>' not listed` identical in all three messages, so tests can count occurrences.
   - Never call `die` in this step. Import `parseFollowups`, `FollowupRow` and `FollowupsParse` directly from `./followups.js`.
2. After `info(\`Shipped …\`)` and before `process.exit(0)`, print each line of `formatShipFollowups(followupsByTask)` with `console.log`. Print a blank line first if any lines exist.

### Step 5: done.md template

Files: `.canon/templates/done.md`, then `npm run sync-templates` (mirror `templates/.canon/templates/done.md`)

- Replace the Open Questions guidance with: `Decisions that still need your input. Work recommended for later goes in the next section, not here.` AC-1 requires that a case-insensitive search for `follow-up` in this section finds nothing, so don't name the section.
- Insert immediately after Open Questions:

```markdown
## Follow-ups

Work that should happen after this task ships. One row per item, or write `None.` alone in place of the table. Write a literal pipe inside a cell as `\|`.

- Category: `correctness`, `risk`, `spec-gap`, `nit`, `scope`, or `observation`.
- Tracked: `untracked` (not yet decided), `dropped` (decided not to do), `post-ship` (written on base after the merge as a backlog entry or doc fix), or a reference: a link, an issue reference such as `#42`, or another canon task as `task:<id>`. A bare task id is not a reference.

| Category | Follow-up | Tracked |
|---|---|---|
| (category) | (what remains and why it matters) | untracked |
```

- Constraints:
  - No line may begin with `Acknowledged:`.
  - Don't write the bracketed task-id placeholder anywhere new; the header already has it.
  - Don't reintroduce the other sentinel strings.
  - The existing tests that keep this file template-detected must stay green.

### Step 6: QA prompt and goldens

Files: `src/orchestrator/prompts/templates/qa.md`, `tests/run-task-prompts.golden.json`, `tests/run-task-prompts.test.ts`

- Step 1 list (line 9): add "follow-ups" after "open questions".
- Add a sub-bullet under item 1 (next to the Judgment Calls bullet): **Follow-ups**: add `## Follow-ups` immediately after `## Open Questions`. The rest of the bullet carries Decision items 3 and 1 verbatim in substance:
  - The four sources:
    - handoff Blockers outside scope, and Partial ACs → `scope`; a `[spec-gap]` Blocker → `spec-gap`
    - every code-review finding not resolved by the final round, including deferred ones, mapped by the review.md label (Correctness Bugs/`correctness bug` → `correctness`, Risk / Guardrails/`risk/guardrail` → `risk`, Spec Gaps → `spec-gap`, Optional Cleanup / Nit → `nit`; an unlabelled later-round finding → the closest of these, default `risk`), with nits included and no filtering by worth
    - every out-of-scope edit left for the operator, including each Docs drift item → `scope` / `post-ship`
    - later work QA itself recommends → `observation`
  - Starting Tracked values: `untracked`; `post-ship` for operator edits; a reference (URL, `#<n>`, markdown link, or `task:<id>`) only when the item is already tracked.
  - `\|` escaping; `None.` when there is nothing to list.
  - "Never phrase later work as an Open Question; Open Questions holds only decisions for the human."
  - "The qa gate rejects done.md without a parseable Follow-ups section."
- Docs drift bullet (line 96): append "Also add each item as a `scope` / `post-ship` row in `## Follow-ups`."
- Output Format list: insert `8. Follow-ups after this task ships (`## Follow-ups`)` and renumber Root Cause to 9. Change item 7 to "Open questions needing a human decision".
- Never write the bracketed task-id sentinel in the prompt.
- Test: add a `void test('promptQa names the Follow-ups section and its post-ship and nit values', …)` that asserts `promptQa(baseState)` matches `/## Follow-ups/`, `/`post-ship`/` and `/`nit`/`. Then regenerate the goldens with `UPDATE_GOLDENS=1 npm test`, and diff the golden to confirm only qa entries changed (`promptQa`, `promptQa_withTemplate`, and any bundle QA key).

### Step 7: parser unit tests (AC-3)

Files: `tests/followups.test.ts` (new)

Table-driven `parseFollowups` and `classifyTracked` cases:

- A valid table with one row per Tracked form: `untracked`, `dropped`, `post-ship`, `https://x/y`, `#42`, `[issue](https://x/1)`, `task:follow-up-task`.
- `None.` gives `{kind:'rows', rows:[]}`.
- A missing section gives `missing`.
- A header mismatch gives unparseable.
- A row with 4 cells gives unparseable, and the reason names the line.
- Classification:
  - `` `POST-SHIP` `` and ` Dropped ` are recognized.
  - These are untracked: an empty cell, `untracked (needs issue)`, `follow-up-task`, `tbd`, `task:`, `task:Foo Bar`, `#42, #43`, `dropped (reason)`.
  - `wontfix-category` stays as written.
- `a \| b` in the text cell gives `a | b`.
- Tables inside a ``` fence and inside `<!-- -->` under the heading are ignored. Fence-only gives unparseable; a fenced table plus `None.` gives rows `[]`.
- Two `## Follow-ups` headings: the last one wins. Make the first valid and the second `None.`, and expect 0 rows.
- Prose-only body gives unparseable. Two tables give unparseable. A table plus a `None.` line gives unparseable.
- `formatShipFollowups`: both blocks, single-block omission, and empty input.

### Step 8: gate tests (AC-4)

Files: `tests/run-task-validation.test.ts`

Next to the existing `checkPhaseGate: qa rejects done.md template…` test (line ~3297), using `withTempTaskDir`, write a real-content done.md (no template sentinels):

- no Follow-ups: `ok:false`, reason matches `/no `## Follow-ups` section/`
- broken table (a row with 4 cells): `ok:false`, reason matches `/cannot be parsed/`
- valid table: `ok:true`
- `None.`: `ok:true`

For the `canon task phase` path, call `taskPhase(taskId,'qa','done')` in the same file under `CANON_TASKS_DIR_OVERRIDE`, with a status that has every prior phase done:

- the missing case must throw `/check-phase-gate:.*Follow-ups/`
- the `None.` case must succeed

Check how the file already imports or drives `taskPhase`; if it doesn't, import it from `../src/task/index.js` the way `tests/task-cli.test.ts` does. Leave `CANON_QUALITY_LOG_FILE_OVERRIDE` pointing at a temp file so the qa→done quality-log write doesn't touch the repo docs.

### Step 9: ship fixtures and integration tests (AC-5 to AC-10)

Files: `tests/run-task-ship-helpers.ts`, `tests/run-task-ship-docs-fold.test.ts`

Helper changes:

- Add an `omitTaskFiles?: string[]` option to `prepareShipFixture`. These are repo-relative paths deleted after `writeTaskFiles`, both in `localDir` before the commit and in the origin merge clone.
- Thread the option into `simulateMergeOnOrigin` as a new optional last parameter (`omit: readonly string[] = []`) that calls `fs.rmSync(path, { force: true })` after writing.
- Unlinking after setup would not work: origin main holds the stub, and ship pulls it.
- Custom done.md content goes through the existing `taskFiles` option.

Tests. Follow Slow Test Discipline and reuse fixtures:

1. **AC-5 + AC-10, normal merge path.** Use the `--ship merges with ${method}` fixture shape (`deleteRemote:false`, `FAKE_GH_OPEN_PR_NUMBER`, `FAKE_GH_LOG`), with `taskFiles['tasks/<id>/done.md']` set to a table holding one row of each kind (untracked, post-ship, dropped, `#7`).
   - Assert exit 0 and `expectArchivedAndDeleted`.
   - stdout after the `Shipped 1 task` index contains `Post-ship follow-ups`, followed by exactly the post-ship row and its instruction line. It also contains `Untracked follow-ups`, followed by exactly the untracked row and its instruction line. Neither the dropped row's nor the reference row's text appears.
   - AC-10: `fs.readFileSync(archive/<id>/done.md)` equals `gitIn(localDir,'show',`${tip}:tasks/<id>/done.md`)`. Compare raw, using `gitRawIn` if `gitIn` trims. The gh log has no line matching `/^issue\b/m`.
2. **AC-6:** a table-driven loop over two done.md variants, `None.` and all dropped plus reference rows. Neither block heading appears, and stderr has no `Follow-ups for`.
3. **AC-7, bundle:** `prepareShipFixture(dir, [a, b], { taskFiles: {…both done.md with untracked rows…} })`. Assert one `Untracked follow-ups` heading, `  a:` before its rows, `  b:` before its rows, and the heading counted once.
4. **AC-8:** a table-driven loop over three states:
   - default stub (no section)
   - broken table via `taskFiles`
   - `omitTaskFiles: ['tasks/<id>/done.md']`

   For each, assert exit 0, the task archived, and `(stderr.match(/Follow-ups for '<id>' not listed/g) ?? []).length === 1`. Before writing the omit case, confirm the handoff/`--ship` path tolerates a missing done.md: the `human_review` gate reads done.md only when human_pending rows exist, and the fixture handoff has none.
5. **AC-9, externally merged:** the default `prepareShipFixture` (merged to origin, remote deleted, no open PR) with an untracked row. `Untracked follow-ups` is shown.

### Step 10: skill

Files: `.claude/skills/canon-pipeline/SKILL.md`, then `npm run sync-templates`

Insert a new subsection before "### 3. Open a draft PR". Either renumber (3→4 …) or title it "### 2b. Decide follow-ups at human review"; choose whichever keeps cross-references intact (grep the skill and `recovery.md` for "§3"/"step 3").

Content:

- For each `untracked` row in `tasks/<id>/done.md` `## Follow-ups`, put it to the human with four options:
  - file it now
  - write it after merge (`post-ship`)
  - drop it
  - fix it in this task (`canon run <id> --reroute` with an `## Amendment`)
- Offer all `nit` rows as one batch.
- Before filing, confirm the item is still open in the current tree.
- File it the project's way, such as its issue tracker or backlog; if no convention is evident, ask the human where.
- Record each outcome in the Tracked cell (`dropped`, `post-ship`, a link, `#<n>`, or `task:<id>`) before `--pr`. In worktree mode, edit the worktree's copy; `--pr` commits task artifacts from the active checkout.
- Full-send skips this stop, so its rows first surface at `--ship`.

In "### 4. Ship", add:

- **Post-ship follow-ups** block: write those items, as backlog entries or doc fixes, in the post-ship docs commit on base.
- **Untracked follow-ups** block: put them to the human now.
- A "Follow-ups … not listed" warning means the done.md section is missing or broken; read the archived done.md by hand.

Two notes on the manual-paperwork recipe in "### 4. Ship" (`canon task phase <id> qa done`):

- Add one line saying the done.md must now carry a `## Follow-ups` section (`None.` or the table) before that command, or the gate rejects it.
- `recovery.md` restates the same recipe (line ~103) but is out of manifest. Leave it alone; it is recorded in notes.

Add "Follow-ups decided (no `untracked` rows) or deliberately left" to the pre-flight checklist before `--pr`. Name no canon-internal source paths (the leak gate in `sync-templates:check`).

### Step 11: CLI usage and docs

Files: `src/orchestrator/cli.ts`, `docs/pipeline-orchestrator.md` (then sync for `templates/docs/pipeline-orchestrator.md`), `README.md`, `docs/codebase-map.md`, `docs/product-context.md`, `docs/decisions.md`

- `cli.ts` `--ship` usage (lines 47–52): append a line such as `After the Shipped line, lists done.md follow-ups still to write (post-ship) or decide (untracked).`
- `pipeline-orchestrator.md`:
  - Line 106 flag row: add the same clause.
  - Line 587 numbered order: insert the new step `(8) read each task's done.md Follow-ups table (warn, never fail, when missing or unparseable)` after proof (7), and renumber fold→9, teardown→10, archive→11, commit→12. Add as the last step "(13) print the Post-ship and Untracked follow-up blocks after the Shipped line".
  - Grep the doc for "(8)" through "(11)" references to the old numbers and fix them.
- `README.md`: in the `--ship` descriptions at lines ~108 and ~352, add "and lists done.md follow-ups left to write or decide". Line 311 is about git side effects, and the listing makes no git change, so leave it.
- `docs/codebase-map.md`: add a row near line 83: `| Follow-ups parser | `src/orchestrator/followups.ts` | Parses done.md `## Follow-ups`; qa gate (`checkPhaseGate`) and `--ship` listing |`. Add a test row near line 153 for `tests/followups.test.ts`.
- `docs/product-context.md` Flow 2, step 4: add "and, with Claude, decides each untracked follow-up in `done.md` (file, post-ship, drop, or reroute), recording the outcome in its Tracked cell". Step 5: add "`--ship` lists the post-ship follow-ups to write in the post-ship docs commit".
- `docs/decisions.md`: append `## Follow-ups are a done.md table, decided at human review (2026-11)`, with **Decision** and **Why** paragraphs covering the four AC-14 points. Use the existing entry format (see `## --ship merge method…`).

### Step 12: build and validate

Run:

```
npm run build && npm run type-check && npm run lint && npm test
npm run sync-templates:check
npm run docs-refs-check
```

Also run `grep -rn "'issue'" src`. It returns no hits today and must still return none (AC-12). AC-12's config check: confirm the existing unknown-key config test still passes (`unknown docs config key warns once…` in `tests/run-task-ship-docs-fold.test.ts:317`, or the docs-freshness unit test).

Commit the rebuilt `dist/`. The new module is bundled into `dist/orchestrator/run-task.js`.

## Testing Plan

- **Unit:** `tests/followups.test.ts` (parser, classification, formatter); `tests/run-task-validation.test.ts` (qa gate, plus the `taskPhase` path); the `tests/run-task-prompts.test.ts` assertion and goldens.
- **Integration:** `tests/run-task-ship-docs-fold.test.ts`, covering ship on both merge paths, a bundle, the warn-only states, and the read-only checks.
- **Regression to confirm:** the existing ship tests now emit one missing-section warning each. No test asserts an empty stderr (grepped). `run-task-safety-base-drift.test.ts` qa auto-advance needs the fixture edit (Contradiction 2).
- **Manual:** Human Test Plan items 1–5 in the spec. Item 5, the QA replay, happens after merge.

## Rollback Plan

Revert the commit. done.md files written with a Follow-ups section stay harmless, because nothing else parses them. No status.json or config change is involved.
