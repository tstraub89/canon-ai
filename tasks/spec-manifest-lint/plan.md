# Implementation Plan: spec-manifest-lint

> Written by: Claude | Implements: `tasks/spec-manifest-lint/spec.md` (spec_review verdict: approved, no nits)

## Approach

Build one fence- and comment-aware **manifest scanner** in `markdown-table.ts`. `parseAffectedFilesFromSpec` and a new pure **`lintSpecManifest`** in `validation.ts` both consume it, so the lint and the consumers can't disagree about which tables exist. Wire the lint into three places:

1. `checkPhaseGate(…, 'spec')`, the hard gate on `canon task phase <id> spec done`.
2. A lint pre-check in `tryEvidenceAdvance('spec')`, so recovery parks with a note instead of throwing.
3. One shared pre-flight block at the top of `runPlanPhase` and `runImplementPhase`. It auto-blocks the phase and exits 2, and `--force` turns it into a warning.

Then update the guidance surfaces (AC-13/14) with one canonical contract sentence, pinned by a test.

**Deliberate deviation from the non-binding Implementation Notes.** `extractSectionBodies` is **not** rebuilt on the new scanner. It has four non-manifest callers: the handoff `## Iteration` bodies at `validation.ts:93` and `validation.ts:1091`, the review `## Round` bodies at `validation.ts:880`, and the done.md `## Quality Log` at `quality-log.ts:362`. Making it fence-aware would change their output, which AC-8 forbids ("the only parser output change is AC-6's"). `parseAffectedFilesFromSpec` stops calling `extractSectionBodies` and uses the new scanner. `parseAllTablesH3`, whose only `src/` caller is `parseAffectedFilesFromSpec`, is re-implemented on the shared block scanner, so it gains the same fence and comment exclusion.

### Feasibility check

- **Exists.** All of these were found by grep:
  - `markdown-table.ts`: `splitTableLine`/`normalizeCells`/`isSeparatorRow`/`computeCommentHiddenLines` (private), `extractSectionBodies`, `parseAllTablesH3`, `scanAllTables`. `scanAllTables` holds the only fence logic, at lines 256–279.
  - `validation.ts`: `parseAffectedFilesFromSpec` (l.1107), `parseHandoffPathCell` (l.1301, exported), `validateExtractedPath` (l.1383, private, **not needed**: the lint uses `parseHandoffPathCell`'s `malformed` list, which already carries the per-path reasons), and `checkPhaseGate` (l.937), whose spec config is `{ artifactName: 'spec.md' }`.
  - `main.ts`: `tryEvidenceAdvance` (l.3423, spec case l.3477).
  - `phases/plan.ts`: `runPlanPhase(state, interactive)`.
  - `phases/implement.ts`: `runImplementPhase(state, interactive, resumeId, force)`.
  - `state.ts`: `autoBlockPhase(taskIds, phase, iterationCount, reason, cause?)`.
  - `task/index.ts`: `taskPhase` (l.447) calls `checkPhaseGate` only when `!process.env.CANON_SKIP_PHASE_GATE` (l.470) and appends the "Resolution:" line.
- **Real path.**
  - `canon task phase <id> spec done` → `taskPhase` → `checkPhaseGate(id,'spec',…, taskRootForGate(taskCwd))`. It reads `spec.md` from that dir, then runs `isTemplateUnfilled`, then (new) the lint.
  - Orchestrator recovery: `recoverPhaseForTask` → `tryEvidenceAdvance(id,'spec')` → `taskPhase(id,'spec','done')`, which throws on gate failure. `recoverPhaseForTask` does not catch it (l.3550), hence the pre-check.
  - The plan and implement entries are `runPhase` (`main.ts:3187–3191`) → `runPlanPhase` / `runImplementPhase`. Every route into plan or implement passes through these two functions:
    - normal full-tier flow;
    - resume after any block, because `deriveTopLevelStatus` returns the first non-done phase and `main()`'s loop calls `runPhase` again;
    - full-tier `--reroute`, which resets `spec_review` and `plan`, so it hits the plan pre-flight and then the implement pre-flight;
    - fast-tier `--reroute`, which resumes at implement;
    - spec_gap reroute, which follows the same routes;
    - code_review → implement revision loops;
    - fast tier, where spec+plan are combined, plan is marked done by helpers, and implement is the backstop.

    `rerouteFromHumanReview` itself never runs an agent, so linting at phase entry is sufficient. Part of the work already exists on this path: `parseAffectedFilesFromSpec` reads the active checkout via `taskDirFor` (worktree-resolving), and the lint helper uses the same resolution.
- **Callers.**
  - `parseAffectedFilesFromSpec` is called from `context.ts:18` (implement preload), `validation.ts:1588` (`buildAffectedFilesAllowlist`, which feeds the code_review scope pre-flight, the full-send check and base-drift), and `main.ts:1566` (human_review commit allowlist). The return contract is unchanged; only fenced or commented rows disappear (AC-6, intended).
  - `parseAllTablesH3` is called only from `parseAffectedFilesFromSpec` plus `tests/markdown-table.test.ts`. None of those 5 tests uses fences or comments, so they stay green.
  - `scanAllTables` is called from `validation.ts:1488` (`collectUnscannedTableHits`) and tests. The refactor keeps it byte-for-byte equivalent.
  - `checkPhaseGate`'s contract changes only for `phase === 'spec'`. Its callers are `task/index.ts:471`, `main.ts:2504` and `main.ts:3221`. The two in `main.ts` are human_review only and unaffected.
  - The `runPlanPhase` signature gains `force`. Its callers are `main.ts:3188` and the parity test at `run-task-safety.test.ts:10977`, which calls `handlers[phase](state,false,resume)`. A third positional arg of `null` for plan would be read as `force` and is falsy, so the call stays safe.
- **Tests that can fail.**
  - **AC-6 red-first.** A fenced `example.ts` table before the real `real.ts` table in `## Design` returns `['example.ts']` today. A commented table (header, separator, `old.ts`) next to `real.ts` returns `old.ts` today. Both inputs were confirmed by the spec reviewer's executed probes.
  - **AC-9.** The fused `||` row makes the gate return `ok:false`. Without the change, the spec gate checks only the template.
  - **AC-10.** On pre-change code, `tryEvidenceAdvance('spec')` with a lint-failing spec throws `check-phase-gate:` once AC-9 is in.
  - **AC-11.** With a malformed spec, `runPlanPhase` and `runImplementPhase` today invoke the fake agent and exit 0. After the change they exit 2 with no agent invocation.
- **Predicates.**
  - **Fused cells:** `cells.length > headerCells.length` *and* some extra cell matches `` /`[^`]+`/ ``. Boundaries:
    - an empty extra cell (the `||` gap) on its own is not enough;
    - an escaped `\|` is not a split (`splitTableLine`);
    - a header with 0 cells: the block is skipped exactly as the parser skips it.
  - **Header-less:** a block whose first line is not followed, within the same block, by a separator row. This includes a 1-line block.
  - **Empty first cell:** `cells[0] === ''` and some other cell has a backticked token. A fully empty `| | |` row and a prose-only `| | notes |` row pass.
  - **Ignored heading:** case-insensitive `/affected files/` in the text, at least one table block in its section, and not read by the parser (rules in Step 3).
  - **Section label:** a heading before any H2 gets the label `(before any ## section)`.
  - **Missing `spec.md`:** the lint helper returns no issues, matching `parseAffectedFilesFromSpec`'s empty result. The spec gate already fails earlier on a missing file.
- **Scope:** every file in the steps is in the spec's Affected Files. The `templates/` mirrors are generated by `npm run sync-templates` and the `dist/` bundles by `npm run build`.
- **Async/stateful:** the pre-flights run synchronously before any `taskPhase(…,'in_progress')` or agent spawn, and before `commitTaskArtifactsToBase`/`ensureBranch` in implement. A block writes only `status = 'blocked'` plus an escalation (`autoBlockPhase`), then exits. Re-entry happens on the next `canon run`, which re-lints, and nothing is held in memory across phases. One edge: a lint block at implement entry sets `implement.status = 'blocked'`. In `claude` provider mode with a stored implementer session, outside a revision or reroute, the next run takes the `isParkResume` prompt branch (`implement.ts:93`). That only words the resume prompt differently and is acceptable.

### Spec gaps and plan-level decisions

All of these are recorded in `notes.md` with the `[plan]` prefix.

1. **`--full-send` on a delicate task always carries `--force`.** `main.ts` requires it there (`main.ts:4132`), so the plan/implement manifest backstop is always downgraded to a warning on such runs. The `spec done` gate still applies, and `CANON_SKIP_PHASE_GATE` is its only bypass. This plan does not widen scope to give the pre-flight its own bypass flag. The docs paragraph states the interaction.
2. **New `unclosed-block` issue kind.** This is a small addition the plan makes. The AC-6 fence exclusion creates one new silent-loss shape: a stray unclosed fence or HTML comment that hides the real `### Affected Files`. The lint reports it so this task doesn't trade one silent drop for another.
3. **Duplicate headings (AC-5) and ignored headings (AC-4) report only when the dropped heading's section has a table.** This keeps a false positive off a bare, empty heading. AC-5's tests use tables.
4. **`extractSectionBodies` is not refactored** (see Approach).

## Steps

### Step 1: Shared hidden-line mask and table-block scanner

Files: `src/orchestrator/markdown-table.ts`

1. **Add `computeHiddenLines`.** Add `function computeHiddenLines(lines: readonly string[]): { hidden: boolean[]; unclosed: { kind: 'fence' | 'comment'; start: number } | null }`. It runs `computeCommentHiddenLines` first. It then walks the lines with the fence state machine moved verbatim out of `scanAllTables`: opener `/^\s{0,3}(`{3,}|~{3,})/`, a closer of the same char and length ≥ the opener, nothing else on the line. It considers only lines not already comment-hidden, as `scanAllTables` does today. The opener line, the inner lines and the closer line are all marked hidden.
   - `unclosed`: if the document ends inside a fence, report the fence opener index. Otherwise, if it ends inside a comment (the last line hidden by the comment pass and the comment never closed), report the index of the unclosed `<!--` line. To know the comment is still open at EOF, track `inHtmlComment` at the end of `computeCommentHiddenLines`, for example by returning it alongside the array through a small internal variant.
2. **Refactor `scanAllTables` onto the mask.** It skips `hidden[i]` lines, and the fence branch is deleted. Behavior must be identical, and the existing tests at `tests/markdown-table.test.ts:213–319` prove it.
3. **Add the shared block scanner.** It reproduces `parseAllTablesH3`'s loop exactly, except that hidden lines end a block like any non-`|` line:
   ```ts
   export type RawTableRow = { line: number; cells: string[] };            // line = 1-based source line
   export type RawTableBlock = { header: RawTableRow; hasSeparator: boolean; rows: RawTableRow[] };
   function scanTableBlocks(lines: readonly string[], hidden: readonly boolean[], start: number, end: number): RawTableBlock[]
   ```
   - A header with `normalizeCells(...).length === 0` advances one line and retries, as the parser does at l.201–204.
   - An optional separator immediately after the header sets `hasSeparator`.
   - Separator rows in the data region are skipped.
   - `cells` are the full `normalizeCells` output, **not** truncated to the header width. The lint needs the extra cells.
4. **Add `blocksToRecords(blocks)`.** It returns `Array<Record<string,string>>` using the existing header-name mapping: `row[headerCells[i]] = cells[i] ?? ''`, over the header width only. That keeps `Object.values(row)[0]` semantics, including duplicate-header quirks.
5. **Re-implement `parseAllTablesH3` on the new pieces.** Signature unchanged. Compute the mask over its input and find the first visible line with `trimEnd() === '### ' + heading`. The section ends at the next visible `/^#{1,3}\s/` line. Return `blocksToRecords(scanTableBlocks(...))`. Update its doc comment to say that fenced and commented content is skipped.
6. **Add the manifest scanner.** Both the parser and the lint consume it:
   ```ts
   export type ScannedHeading = { index: number; line: number; level: number; text: string; sectionEnd: number };
   export type ManifestH3 = { heading: ScannedHeading; blocks: RawTableBlock[] };
   export type ManifestSection = { h2: ScannedHeading; kind: 'design' | 'amendment'; affectedFiles: ManifestH3[] };
   export type SpecManifestScan = {
       lines: string[]; hidden: boolean[];
       unclosed: { kind: 'fence' | 'comment'; start: number } | null;
       headings: ScannedHeading[];          // every visible /^(#{1,6})\s/ line
       sections: ManifestSection[];         // document order
   };
   export function scanSpecManifest(markdown: string): SpecManifestScan
   ```
   - `text` is the trimmed line, hashes included.
   - `sectionEnd` is the index of the next visible heading with `level <= Math.max(level, 3)`, or `lines.length`. For an exact H3 this equals the parser's `/^#{1,3}\s/` end. The `max(…,3)` rule keeps an H1 title's section to its own lead-in, so a title containing "Affected Files" is not flagged.
   - `sections` are the visible level-2 headings whose raw line matches `/^## Design\b/` (kind `design`) or `/^## Amendment\b/` (kind `amendment`). These are the same regexes as `parseAffectedFilesFromSpec` today, keeping the `\b` boundaries.
   - An H2 body ends at the next visible heading of level ≤ 2. In it, `affectedFiles` lists **every** visible line with `trimEnd() === '### Affected Files'`, in order. Each entry's blocks come from `scanTableBlocks(lines, hidden, h.index + 1, Math.min(h.sectionEnd, bodyEnd))`.

### Step 2: Switch `parseAffectedFilesFromSpec` to the scanner

Files: `src/orchestrator/validation.ts`

Replace the `extractSectionBodies` + `parseAllTablesH3` pair at l.1126–1137 with `scanSpecManifest(content)`. Keep the output order identical to today:
- iterate `sections.filter(s => s.kind === 'design')`, then `sections.filter(s => s.kind === 'amendment')`, as today's two spread calls do;
- for each section, use only `affectedFiles[0]`, as today's `findIndex` does;
- rows come from `blocksToRecords(h3.blocks)`, then the existing `Object.values(row)[0]` / `parseHandoffPathCell` loop runs unchanged.

Update the comment to note the fence and comment exclusion. Drop the `parseAllTablesH3` import if it is no longer used in `validation.ts`; keep `extractSectionBodies`, which has other callers.

### Step 3: The pure lint and its formatter

Files: `src/orchestrator/validation.ts`

```ts
export type ManifestLintKind =
    | 'fused-cells' | 'header-less-block' | 'malformed-path' | 'empty-first-cell'
    | 'ignored-heading' | 'duplicate-heading' | 'unclosed-block';
export type ManifestLintIssue = { section: string; kind: ManifestLintKind; row?: number; line?: number; message: string };
export function lintSpecManifest(markdown: string): ManifestLintIssue[]
```

`section` is the containing H2's trimmed text, e.g. `## Design` or `## Amendment Round 2`. `row` is the 1-based data-row index across all blocks of that H3, counting data rows only. `line` is the 1-based `spec.md` line. Messages are self-contained and adopter-safe (AC-12): never name `src/`, a file of canon's own, or a function.

Rules, from `scanSpecManifest(markdown)`:

1. **Parsed tables (the first exact H3 of each section).** For each block, in order:
   - **Header-less block (AC-2).** If `!block.hasSeparator`, report `header-less-block` at `block.header.line`: "line N is read as a table header, so its path is not in scope. Keep each table contiguous (no blank or note lines between rows), and start it with a header row followed by a `|---|---|` separator." Do not cell-check the header line itself.
   - **For each data row:**
     - **Fused cells (AC-1).** If `cells.length > header.cells.length` and some extra cell contains a backticked token: "row R has N cells but its table header has M; the extra cell's path is not read. Put one file per row; to list several paths for one change, comma-join them in the first column."
     - **Empty first cell (AC-7).** If `cells[0] === ''` and some other cell has a backticked token: "row R has an empty first column, so the path in another cell is not read. Put the path in the first column."
     - **Malformed path (AC-3).** Otherwise, if `cells[0]` is non-empty, run `parseHandoffPathCell(cells[0])` and report one `malformed-path` issue per `malformed` entry: "row R first-column cell <cell> is not read: <reason>. Start the cell with the path(s) in backticks, comma-joined for several, and move notes to the Change column."
2. **Duplicate heading (AC-5).** For each section, each `affectedFiles[k]` with k ≥ 1 that has at least one block gets a `duplicate-heading` issue at its line: "a second `### Affected Files` heading in <section> is not read; merge its rows into the first `### Affected Files` table of this section."
3. **Ignored heading (AC-4).** Check each `headings` entry whose text matches `/affected files/i` and that has at least one block in `scanTableBlocks(lines, hidden, h.index + 1, h.sectionEnd)`.

   **Skip** the heading if any of these holds:
   - it is one of the `sections[*].affectedFiles` entries, whether first or duplicate;
   - it is a level ≥ 4 heading inside the range `[exact.index, exact.sectionEnd)` of one of those entries, because the parser reads those rows.

   Otherwise report `ignored-heading` at its line: "heading `<text>` is not read as scope. Use exactly `### Affected Files` directly under `## Design` or an `## Amendment…` section." The `section` is the nearest preceding visible H2, or `(before any ## section)`.

   Expected verdicts (these are AC-4's cases):

   | Heading | Verdict |
   |---|---|
   | `### Affected files` | fail |
   | `#### Affected Files` outside an exact section | fail |
   | `### Amendment Affected Files` | fail |
   | exact heading under `## Scope` | fail |
   | exact heading under `## Amendments` (no `\b` match) | fail |
   | H1 title containing "Affected Files" (section ends at the first `##`) | pass |
4. **Unclosed block (plan addition, see "Spec gaps" 2).** If `scan.unclosed` is set and any line in `[unclosed.start, lines.length)` matches `/^#{1,6}\s.*affected files/i`, report `unclosed-block` at the opener line: "an unclosed code fence (or HTML comment) opened at line N hides an Affected Files heading; close it so the table is read."

```ts
export function formatManifestLintIssues(issues: readonly ManifestLintIssue[]): string
```

The output is one header line, "spec.md's Affected Files table has N problem(s):", followed by one `  - <section>[, row R][ (line L)]: <message>` line per issue.

### Step 4: Spec-phase gate (AC-9)

Files: `src/orchestrator/validation.ts`

In `checkPhaseGate`, immediately after the `isTemplate` early return (l.957–959), add:

```ts
if (phase === 'spec') {
    const issues = lintSpecManifest(content);
    if (issues.length > 0) {
        return { ok: false, reason:
            `${formatManifestLintIssues(issues)}\n` +
            `Fix the \`### Affected Files\` table in spec.md, then rerun \`canon task phase ${taskId} spec done\`.` };
    }
}
```

`content` is already read from `resolveTaskDirForValidation(taskId, taskDirOverride)`, so the override is honored. `CANON_SKIP_PHASE_GATE` already short-circuits the call in `taskPhase`, and no change is needed there.

### Step 5: Evidence recovery parks (AC-10)

Files: `src/orchestrator/main.ts`

In `tryEvidenceAdvance`, `case 'spec'` (l.3477), add the following between the template check and `taskPhase(taskId, 'spec', 'done')`:

```ts
if (!process.env.CANON_SKIP_PHASE_GATE) {
    const issues = splitValidation.lintSpecManifest(content!);
    if (issues.length > 0) return { advanced: false, note: splitValidation.formatManifestLintIssues(issues) };
}
```

The env check mirrors `taskPhase`, so the pre-check and the gate agree. The note flows into `retryAgentForPhase`'s "Evidence check:" line, so the retried agent sees the issues. `readArtifact(taskId,'spec.md')` resolves the same task dir `taskPhase` uses.

### Step 6: Plan and implement entry pre-flights (AC-11)

Files: `src/orchestrator/validation.ts`, `src/orchestrator/phases/plan.ts`, `src/orchestrator/phases/implement.ts`, `src/orchestrator/main.ts`

1. **`validation.ts`: add the shared helpers.**
   ```ts
   export function lintSpecManifestForTasks(taskIds: readonly string[]): Array<{ taskId: string; specPath: string; issues: ManifestLintIssue[] }>
   export function manifestPreflightMessage(phase: 'plan' | 'implement', taskIds: readonly string[], failures: ReturnType<typeof lintSpecManifestForTasks>, forced: boolean): string
   ```
   - `lintSpecManifestForTasks` reads `path.join(taskDirFor(id), 'spec.md')`, which is the active checkout, worktree-resolved like `parseAffectedFilesFromSpec`. It returns only tasks with issues. An unreadable spec yields no entry. It lints **every** task passed, which covers spec_gap-exempt siblings.
   - **Unforced message:** "Spec manifest pre-flight: canon stopped before the <phase> phase started. Each listed spec has Affected Files problems:", then, per task, `<taskId> (<specPath>):` followed by `formatManifestLintIssues`. It ends with: "Fix the `### Affected Files` table in each listed spec.md (the task worktree's copy when the task has one), then rerun `canon run <ids>`. Use --force to proceed anyway."
   - **Forced message:** "--force: spec manifest pre-flight found problems (bypassed); these paths may be out of scope at code review:" followed by the same per-task list.
   - Use no `--reroute`, `reset-*` or `canon task accept` text, so `tests/recovery-hints.test.ts` needs no new registration. If the wording ends up containing one of those tokens, register the site there.
2. **`phases/plan.ts`.** Add a `force = false` parameter to `runPlanPhase`. Before the `info('Phase: plan …')` line and the `taskPhase(…,'in_progress')` loop, run:
   ```ts
   const manifestFailures = lintSpecManifestForTasks(taskIds);
   if (manifestFailures.length > 0) {
       const message = manifestPreflightMessage('plan', taskIds, manifestFailures, force);
       warn(message);
       if (!force) { autoBlockPhase(taskIds, 'plan', 0, message); process.exit(2); }
   }
   ```
   This needs imports of `autoBlockPhase` from `../state.js` and the two helpers from `../validation.js`.
3. **`phases/implement.ts`.** Add the same block right after the code-review loop-cap check (l.53–57) and **before** `commitTaskArtifactsToBase` and `ensureBranch`. A first-entry block then leaves no scaffold commit or worktree behind, and the operator fixes the REPO_ROOT copy. Use `autoBlockPhase(taskIds, 'implement', tasks[0].iterations_current_loop, message)`. `force` is already a parameter.
4. **`main.ts` `runPhase`.** Change the plan call to `return runPlanPhase(state, cliArgs.interactive, cliArgs.force);`.

### Step 7: CLI help (AC-13)

Files: `src/orchestrator/cli.ts`

Extend the `--force` help (l.35–38) to say "(currently: --full-send on delicate tasks, reroute amendment gate, base-drift gate, dirty REPO_ROOT worktree-start gate, and the spec manifest pre-flight before plan/implement)". Keep the column alignment.

### Step 8: Guidance surfaces with one canonical sentence (AC-13)

Files: `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/spec-revision.md`, `.canon/templates/spec.md`, `.claude/skills/canon-spec/SKILL.md`, `.claude/skills/canon-spec-review/SKILL.md`

Define the contract once. In `prompts/index.ts`, export:

```ts
export const SPEC_MANIFEST_CONTRACT =
    'Affected Files uses exactly one `### Affected Files` heading per `## Design` or `## Amendment…` section and one file per row: ' +
    'comma-join extra paths for the same change in the first column, put notes in the Change column, and never put a second backticked token in a first-column note ' +
    '(directory entries ending in `/` are fine). Marking the spec done enforces this format, and canon re-checks it before planning and implementation.';
```

Copy that string **verbatim** to each carrier:

- **`prompts/index.ts` `selfCheck`.** Replace `'- Affected Files lists specific files (not directories) with specific, actionable change descriptions'` with `` `- ${SPEC_MANIFEST_CONTRACT} Each row has a specific, actionable change description.` ``
- **`.canon/templates/spec.md`.**
  - Replace the checklist line 96 with `- [ ] <contract> Each row has a specific change description.`
  - Add one line under "List files that will need changes…" (l.37): `One file per row; comma-join extra paths for one change in the first column; notes go in the Change column.`
  - Don't add the bracketed task-id template sentinel.
- **`.claude/skills/canon-spec/SKILL.md` l.142.** Replace with `- [ ] <contract> Each row has a specific change description.`
- **`spec-revision.md`.** Add a line after the rules-of-thumb list, before "When done, run:": `- **Scope manifest** — <contract>`.
- **`canon-spec-review` item (3).** Narrow it to completeness, keeping the pinned tokens `### Affected Files`, `## Design` and "generated"/"rebuilt". For example: "(3) **Affected Files** — completeness only: it lists every file the change writes, including generated mirrors and rebuilt outputs, under `### Affected Files` in `## Design` or an amendment section; files only read for context stay out. A missing generated or rebuilt output is BLOCKING. Heading and row format is enforced when the spec is marked done, so don't re-check it here."

Afterwards, `grep -rn "not directories" src .canon/templates .claude/skills` must return nothing. Archived specs and other worktrees are out of scope.

### Step 9: Docs (AC-13, AC-14)

Files: `docs/pipeline-orchestrator.md`, `docs/codebase-map.md`, `docs/lessons-learned.md`, `docs/BACKLOG.md`

- **`pipeline-orchestrator.md`, `## Phase Routing + Auto-Block`.** Add a **Spec manifest lint.** paragraph covering:
  - the seven checks, in one sentence;
  - that `canon task phase <id> spec done` refuses on any issue, and that `CANON_SKIP_PHASE_GATE=1` is its bypass;
  - that evidence recovery returns "not advanced" with the issues, so the one-shot retry sees them;
  - the plan and implement pre-flights: auto-block, exit 2, the recovery (fix the active checkout's spec.md, then `canon run <id>`), and `--force` warning instead;
  - why the pre-flights exist: `reset-spec-review`, human-gate edits and `--reroute` amendments bypass `spec done`;
  - that fenced and commented content is never read as scope;
  - the full-send-on-delicate interaction (`--force` is mandatory there, so only the `spec done` gate enforces).

  Add "spec manifest pre-flight before plan/implement" to the `--force` row (l.103).
- **`codebase-map.md` l.61.** Mention `scanSpecManifest` (`markdown-table.ts`), which skips fences and comments, plus `lintSpecManifest` / `lintSpecManifestForTasks` and the spec gate and plan/implement pre-flights.
- **`lessons-learned.md`.** Delete the entry "Put one Affected Files entry per table row; the scope parser drops a fused second entry silently" (l.188–194) together with one adjacent `---` separator.
- **`BACKLOG.md` l.26.** Rewrite item (b) as follows: "(b) the Affected-Files half is **done** (`spec-manifest-lint`: lint at `spec done` plus plan/implement pre-flights); the docs-refs half (run docs-refs validation at spec or pre-implement) stays open."

### Step 10: Sync, build, golden

Run `npm run sync-templates` to regenerate the three `templates/` mirrors. Run `npm run build` to rebuild `dist/cli/index.js` and `dist/orchestrator/run-task.js`. Regenerate `tests/run-task-prompts.golden.json` with `UPDATE_GOLDENS=1` on the prompts test (`tests/run-task-prompts.test.ts:186`). Only the `promptSpec*` selfCheck strings should change, plus `spec-revision` renders.

### Step 11: Archive calibration (AC-15)

Write a throwaway script outside the repo (scratch, not committed) that runs `lintSpecManifest` over every `tasks/_archive/*/spec.md`, for example with `npx tsx` importing `src/orchestrator/validation.ts`. In `handoff.md`, under a `## Archive Calibration` section, record:
- the number of specs flagged per kind;
- up to three sampled hits per kind, each classified as a real silent loss or a false positive.

Fix any false positive in the lint before handoff. Archived specs are not edited.

A pre-plan grep predicts true-positive `ignored-heading` hits: `### Affected Files delta`, `### Affected Files (amendment)`, `## Affected Files`, `### Amended Affected Files`. H1 titles containing "Affected Files" must **not** be flagged. If they are, the `max(level, 3)` section rule is wrong.

## Testing Plan

**Unit tests, `tests/markdown-table.test.ts` (AC-6 and scanner):**
- **AC-6 red-first, written first.** Run both against the unchanged `parseAllTablesH3`/`parseAffectedFilesFromSpec` path, and record the failing output with the received value in `handoff.md`:
  - (a) a `## Design` body with a fenced `### Affected Files` table listing `example.ts`, then the real heading and table listing `real.ts`; assert the result is exactly `['real.ts']`. It fails pre-fix with `['example.ts']`.
  - (b) a real `real.ts` table plus a `<!-- … -->`-wrapped table with its own header, separator and `old.ts` row, under the same heading; assert `old.ts` is absent. It fails pre-fix. Cover it both before and after the live table.
  - Because `parseAffectedFilesFromSpec` reads from disk, put the end-to-end versions in `tests/run-task-validation.test.ts` with a temp `CANON_TASKS_DIR_OVERRIDE` dir, the same pattern as the existing `parseAffectedFilesFromSpec` tests there. Keep scanner-level versions in `markdown-table.test.ts`.
- **`scanSpecManifest`:**
  - a fenced `## Design` in Problem does not open a section;
  - `## Design Notes` matches and `## Amendments` does not;
  - two exact H3s in one Design body both appear in `affectedFiles`;
  - an unclosed fence sets `unclosed`.
- **`scanAllTables`:** the existing tests stay green unchanged, which proves the refactor.

**Unit tests, `tests/run-task-validation.test.ts`:**
- **AC-1:** `||` fused row fails, naming `## Design` and row 2; extra cell with prose only passes; escaped `\|` in the Change column passes.
- **AC-2:** a table with no separator fails; a table split by a blank line fails, and so does one split by a note line, on the second block's first row.
- **AC-3:** each listed case fails, with the parser's reason in the message:
  - prose before the path;
  - `` `old.ts` → `new.ts` ``;
  - `` `dist/` (rebuilt by `npm run build`) ``;
  - `` `a.ts` (also `b.ts`) ``;
  - `` `<path>` ``;
  - `` `/abs.ts` ``;
  - `` `src/*.ts` ``.

  Two cases pass: `` `a.ts`, `b.ts` `` and `` `dist/` rebuilt by build ``.
- **AC-4:** the fail and pass list from Step 3 rule 3, plus `#### Affected Files` nested inside an exact section (pass).
- **AC-5:** a second exact heading with a table in `## Design` fails; Design plus `## Amendment Round 2` passes.
- **AC-7:** `` | | `x.ts` | `` fails with its row number; `| | |` and `| | prose note |` pass.
- **AC-8:** no issues for:
  - no table;
  - the canonical table;
  - comma-joined paths;
  - directory entries;
  - Design plus Amendment Round 2;
  - **this task's own `spec.md`**, read via `process.cwd()`, not `REPO_ROOT`, per the patterns rule.

  Also assert that `parseAffectedFilesFromSpec` output for a fence-free and comment-free fixture is unchanged, compared against a literal expected array.
- **AC-9:**
  - `checkPhaseGate(id,'spec')` on a fused-row spec returns `ok:false`, and the reason lists every issue (use a spec with two issues) and contains `canon task phase <id> spec done`;
  - a clean spec returns `ok:true`;
  - a `taskDirOverride` pointing at a dir whose spec is malformed while the default dir's spec is clean returns `ok:false`;
  - with `CANON_SKIP_PHASE_GATE=1`, `taskPhase(id,'spec','done')` advances. Set the env after import, per patterns.
- **AC-12:** format one issue of each of the seven kinds with `formatManifestLintIssues`, plus `manifestPreflightMessage` for both phases, forced and unforced. Assert none contains `src/`, `markdown-table`, `validation.ts`, `parseHandoffPathCell`, `parseAllTablesH3`, `extractSectionBodies`, `parseAffectedFilesFromSpec`, `scanSpecManifest` or `lintSpecManifest`.

**Integration tests, `tests/run-task-safety.test.ts`:**
- **AC-10:** use the `runTryEvidenceAdvance`-style subprocess pattern (`tests/run-task-reroute-preflight.test.ts:2444`). With a filled, non-template spec that has a fused row and spec `in_progress`, `tryEvidenceAdvance(id,'spec')` returns `{advanced:false}`. The note must contain the row issue, the subprocess must exit 0 (no throw), and `status.json` must still show `spec` not done.
- **AC-11 plan entry:** reuse `prepareReviewEntryMainFixture` + `runNodeInline`, as in the parity test at l.10930. Set spec, spec_review (approved) and `human_spec_gate` as after a human-gate edit, with plan pending, and write a malformed row into the fixture spec.
  - `await runPlanPhase(state,false)` exits 2. The output names the issue and `canon run`. `plan.status === 'blocked'` with an escalation, and the fake agent log is empty or absent.
  - `runPlanPhase(state,false,true)` proceeds: the warning is printed and the agent is invoked.
  - With a clean spec, there is no warning and the agent is invoked.
- **AC-11 implement entry:** same harness. Set `implement.rerouted = true` and write the malformed table under `## Amendment` in the **worktree** spec.
  - `runImplementPhase(state,false,null)` exits 2, `implement.status === 'blocked'`, and no agent runs.
  - With `force=true` it proceeds with the warning.

**Integration tests, `tests/run-task-reroute-preflight.test.ts` (AC-11 reroute routing):**
- A fast-tier reroute with a clean REPO_ROOT spec and a worktree spec whose `## Amendment` table is malformed: after `runReroute` succeeds, because the amendment-heading gate is satisfied, a subprocess call to `lintSpecManifestForTasks([id])` reports the amendment issue from the worktree copy. Follow the "rerouteFromHumanReview reads worktree spec.md" pattern at l.707. This proves the implement pre-flight reads the active checkout.

**Prompt pins, `tests/run-task-prompts.test.ts`:**
- Import `SPEC_MANIFEST_CONTRACT` and assert that each of the four carriers `includes()` it verbatim: rendered `promptSpec`, `.canon/templates/spec.md`, `.claude/skills/canon-spec/SKILL.md` and `src/orchestrator/prompts/templates/spec-revision.md`. Read the files via `process.cwd()`.
- Assert none of those four files contains `not directories`.
- The existing item-(3) pins must still pass.

**Prove each red test can fail.** After the suite is green:
- remove the Step 4 lint call and confirm the AC-9 tests turn red;
- remove the Step 5 pre-check and confirm AC-10 turns red, with a throw;
- remove each Step 6 block and confirm the matching AC-11 test turns red.

Note each check in the handoff.

**E2E:** N/A (CLI).

## Validation

Run in the task worktree, after `npm ci`:

`npm run build && npm run type-check && npm run lint && npm test && npm run sync-templates:check && npm run docs-refs-check`

## Risks / Notes for Implementer

- **False positives are the top risk.** Every predicate is gated as listed in Step 3. If AC-15 shows a false-positive class, tighten the predicate rather than deleting the check, and record the change in the handoff.
- **Order and parity of `parseAffectedFilesFromSpec` output.** Design sections come before Amendment sections, and only the first exact H3 per section is read. Any drift here changes allowlists silently, which is why AC-8 includes a literal-array parity test.
- **Don't touch `extractSectionBodies`** or `parseTableH3`/`parseTable`. Their callers are outside this task.
- **Worktree reads.** Pre-flights use `taskDirFor` (active checkout). Tests that read this task's own spec use `process.cwd()`.

## Reroute Plan

### Round Scope

**Feasibility (checked against the worktree at `2f7889c`, round-1 implementation complete and approved with nits):**
- **Exists:** `visibleMarkdownLines` (private) and `scanSpecManifest` in `src/orchestrator/markdown-table.ts`; `ManifestLintKind`, `lintSpecManifest`, `formatManifestLintIssues`, `lintSpecManifestForTasks`, `manifestPreflightMessage` in `src/orchestrator/validation.ts` (~l.1929–1995); `SPEC_MANIFEST_CONTRACT` in `src/orchestrator/prompts/index.ts:139`; the `{{#hasOutOfScopeFiles}}` block with the two amendment bullets in `src/orchestrator/prompts/templates/code-review-foreman.md`; the "scope manifest contract agrees across authoring surfaces" test in `tests/run-task-prompts.test.ts`; the "Spec manifest lint" paragraph at `docs/pipeline-orchestrator.md:414`. All found by grep. The round-1 plan's `computeHiddenLines`/`unclosed` field was **not** implemented (handoff "Deviations"; notes `[implement]`), so open state is still discarded at return.
- **Real path:** every gate reaches the new kinds through `lintSpecManifest` alone — `checkPhaseGate(…,'spec')` (`validation.ts:963`), `tryEvidenceAdvance('spec')` (`main.ts:3481`), and `lintSpecManifestForTasks` in `runPlanPhase`/`runImplementPhase`. No caller wiring changes. The foreman text is static template text inside `{{#hasOutOfScopeFiles}}`, rendered by `promptCodeReview(…, outOfScopeFiles)`.
- **Callers:** `scanSpecManifest`'s return type gains a field: callers are `lintSpecManifest` and `parseAffectedFilesFromSpec` (`validation.ts`, ~l.1131) and scanner tests — additive, no behavior change for consumers. `lintSpecManifest`'s contract widens (two new kinds): its callers are the four gate sites above, all of which treat any issue as failure — intended (AC-A1/A2). `parseAllTablesH3` also calls `visibleMarkdownLines`; destructuring keeps it unchanged.
- **Tests that can fail:** AC-A1 — a `## Design` with prose and no table, and a spec with no `## Design`, return `[]` today. AC-A2 red-first — an unclosed fence on line 1 followed by a canonical manifest, and a canonical manifest followed by an unclosed `<!--`, both return `[]` today (amendment reviewer probes). AC-A3 — the rendered foreman prompt with out-of-scope files does not contain `SPEC_MANIFEST_CONTRACT` today. AC-A4 — the grep hits `docs/pipeline-orchestrator.md:414` and its mirror today.
- **Predicates:** `missing-manifest` fires when no `design`-kind section has a first exact `### Affected Files` whose blocks hold ≥1 data row (boundaries: no `## Design` at all; `## Design` without the heading; heading with no table; header+separator with zero rows; a header-less single line, which yields zero rows and so is *also* `missing-manifest` in addition to `header-less-block`; a table only under `## Amendment` → still missing). `## Design Notes` counts as design (same `\b` regex the consumers use). `unclosed-block` fires when the scan ends with `fence !== null` or `comment === true` — regardless of what the hidden region contains (the amendment's rule, superseding the round-1 plan's "only if it hides an Affected Files heading" idea). An inline `<!--` that the scanner already treats as literal text (not at line start, no closer on the line) never sets `comment`, so it cannot trigger.
- **Scope:** all source/doc/test files below are in the Affected Files union, **except `tests/task-cli.test.ts`** (see Step 6 and the contradiction note). `src/orchestrator/prompts/index.ts` needs no change (the contract is copied verbatim into the template, matching how `spec-revision.md` carries it); it stays declared but untouched.
- **Async/stateful:** N/A — pure functions and static template text; the gates' blocking/resume behavior is unchanged from round 1.

**Archived review (`review-prior-1.md`):** final round 3 verdict was `approved_with_nits` with no unresolved correctness bugs or spec gaps; nothing from it is binding beyond what the amendment absorbs. The amendment absorbs two of its human follow-ups: the unterminated fence (round 1 R3) → item 2 / AC-A2, and the foreman full-send prompt (round 1 R4) → item 3 / AC-A3. The other follow-ups (AC-4 predicate breadth, `docs/patterns.md:209` wording) are out of this round's scope. One consequence: the round-3 dismissal of the "resume test rewrites spec.md to `# Spec: fixed`" finding no longer holds — that fixture has no table, so after AC-A1 the resumed phase blocks again (Step 6).

**Already implemented (round 1, not re-planned):** Steps 1–11 of the original plan as adjusted in the handoff's "Deviations from Plan" — shared visibility scan, AC-1…AC-15, gates, pre-flights, `--force`, guidance carriers, docs, lessons/backlog, archive calibration.

**Contradiction recorded (also in `notes.md` as `[plan]`):** AC-A1 makes a table-less spec fail `spec done`, but `tests/task-cli.test.ts` (outside both Affected Files tables) marks a `# Filled spec` table-less spec done and asserts exit 0 (~l.442–453). Fixing it is required for `npm test` (a Validation Required item) and cannot be done inside the declared scope. Not resolved by changing the spec. See Step 6 for the handling.

### Step R1: Report open fence/comment state from the shared scan

Files: `src/orchestrator/markdown-table.ts`

- In `visibleMarkdownLines`, track where the open construct started: set `fenceStart = index` when a fence opener is accepted, and `commentStart = index` when the `comment = true` branch fires (only when transitioning from not-in-comment; a line that closes and reopens updates it). Use the `map` callback's index argument.
- Return `unclosed: { kind: 'fence' | 'comment'; line: number } | null` (1-based line) alongside `lines`/`hidden`: `fence` wins if both somehow apply (a fence can't open inside a comment, so at most one is set).
- Export the type, e.g. `export type UnclosedBlock = { kind: 'fence' | 'comment'; line: number }`, and add `unclosed` to `scanSpecManifest`'s return. `parseAllTablesH3` ignores it.
- Do not change hiding: content after an unclosed opener stays hidden (amendment item 2: "Hiding the content stays").

### Step R2: `missing-manifest` and `unclosed-block` lint kinds

Files: `src/orchestrator/validation.ts`

- Extend `ManifestLintKind` with `'missing-manifest' | 'unclosed-block'`.
- At the end of `lintSpecManifest`:
  - **unclosed-block:** if `scan.unclosed`, push `{ section: <nearest visible H2 at or before the opener, else '(before any ## section)'>, line: unclosed.line, kind: 'unclosed-block', message }`. Messages (adopter-safe, name the construct and line): fence — "An unclosed code fence opened at line N hides everything after it, including any Affected Files table. Close it with a matching fence line."; comment — "An unclosed HTML comment (<!--) opened at line N hides everything after it, including any Affected Files table. Close it with -->." Because `section`/`line` already print via `formatManifestLintIssues`, the line number appearing in both the prefix and message is acceptable; keep it in the message so the issue reads alone.
  - **missing-manifest:** if no `scan.sections` entry with `kind === 'design'` has `affectedFiles[0]?.blocks.some(b => b.rows.length > 0)`, push `{ section: <first design section's h2.text, else '(no ## Design section)'>, kind: 'missing-manifest', message: 'No `### Affected Files` table under ## Design, so nothing is in scope. Add one under ## Design: a header row, a |---|---| separator, then one file per row.' }` (match the existing messages' style; they print headings without backticks).
  - Order: emit `unclosed-block` before `missing-manifest`, so when an unclosed construct before `## Design` causes both, the root cause prints first.
- `## Amendment…` sections stay optional: nothing here inspects amendment sections for absence.

### Step R3: Foreman full-send amendment contract (AC-A3)

Files: `src/orchestrator/prompts/templates/code-review-foreman.md`

Inside `{{#hasOutOfScopeFiles}}`, after bullet 2 (before bullet 3 or as an indented sub-paragraph shared by bullets 1–2), add:

```
   Table rows must follow the scope manifest contract: <SPEC_MANIFEST_CONTRACT verbatim>
   Example row (path in the first column, reason in the Change column):

   | File | Change |
   |---|---|
   | `path/to/changed-file.ts` | Full-send scope expansion: needed to meet AC-2. |
```

- Copy the constant's text verbatim (same pattern as `spec-revision.md:30`); do not template it, so `prompts/index.ts` stays untouched.
- Use a neutral example path (`path/to/changed-file.ts`): no `src/`, no `<…>` placeholder (that is a `malformed-path`), no glob.
- Check the render engine does not alter backticks in literal template text (it shouldn't — only `{{…}}` is substituted); the AC-A3 test confirms.

### Step R4: Docs (AC-A4)

Files: `docs/pipeline-orchestrator.md` (then `npm run sync-templates` for `templates/docs/pipeline-orchestrator.md`)

At l.414, replace "a spec with no scope table is valid" with: a `### Affected Files` table under `## Design` is required (an `## Amendment…` section may omit one); and add the two new rejections to the list — a missing Design manifest, and an unclosed code fence or HTML comment (which would otherwise hide the rest of the spec). Keep the paragraph's existing wording otherwise. Then `grep -rn "a spec with no scope table is valid" docs templates src` must return nothing.

### Step R5: Tests

Files: `tests/markdown-table.test.ts`, `tests/run-task-validation.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`

- **AC-A2 red-first, written first** (`tests/run-task-validation.test.ts`), run against current HEAD before Steps R1–R2 and recorded in `handoff.md` with the received value (`[]`):
  1. unclosed ```` ``` ```` on line 1, then a canonical `## Design` / `### Affected Files` table → post-fix kinds include `unclosed-block` with `line: 1` (and `missing-manifest`, since the Design is hidden — assert the `unclosed-block` entry specifically, not just non-empty).
  2. canonical manifest, then a trailing unclosed `<!--` at line N → post-fix issues are **exactly** one `unclosed-block` naming the comment and line N (this is the case the amendment reviewer required so `missing-manifest` can't satisfy the test).
  Also: canonical manifest then an unclosed `~~~` fence → exactly one `unclosed-block` (fence); well-formed fence and comment around a canonical manifest → `[]`.
- **AC-A1** (`tests/run-task-validation.test.ts`): `## Design` with prose only → one `missing-manifest`; no `## Design` → one `missing-manifest`; `## Design` with the exact heading but no table → `missing-manifest`; valid Design table plus an `## Amendment` with prose and no table → `[]`. Replace the AC-8 "no Affected Files table" passing case with the AC-A1 failing case (amendment item 1 supersedes it).
- **AC-A1 gate coverage:** add one `checkPhaseGate(id,'spec')` case on a table-less spec → `ok:false` with `missing-manifest` text; the pre-flights need no new test (same `lintSpecManifest` call), but Step R6 fixture updates must keep their existing assertions meaningful.
- **AC-12:** extend the "one issue of each kind" message test to include `missing-manifest` and `unclosed-block` (both fence and comment variants).
- **Scanner** (`tests/markdown-table.test.ts`): `scanSpecManifest` reports `unclosed` `{kind:'fence', line}` / `{kind:'comment', line}` at EOF and `null` for closed constructs, an inline literal `<!--` mid-cell, and the `<!-->` short forms.
- **AC-A3** (`tests/run-task-prompts.test.ts`): render `promptCodeReview(baseState, 'main', null, null, null, ['src/extra-helper.ts'])` (the existing call shape at `tests/run-task-prompts.test.ts:661` and `:796`; the latter feeds the golden) and assert it `includes(SPEC_MANIFEST_CONTRACT)`. Extract the example row from the rendered text (the line starting `` | `path/to/changed-file.ts` ``), embed it in a spec `## Design` canonical table + `## Amendment (full-send scope)` / `### Affected Files` header/separator/that row, and assert `lintSpecManifest` returns `[]` and `parseAffectedFilesFromSpec`-equivalent scan includes `path/to/changed-file.ts`. Also add the foreman template to the raw-file carriers in "scope manifest contract agrees across authoring surfaces".
- **Golden:** regenerate with `UPDATE_GOLDENS=1` on the prompts test; only the full-send foreman render should change.

### Step R6: Update fixtures that relied on a table-less spec passing

Files: `tests/run-task-safety.test.ts` (in scope), `tests/run-task-validation.test.ts`, `tests/run-task-reroute-preflight.test.ts`, `tests/recovery-hints.test.ts` (round-1 scope), and `tests/task-cli.test.ts` (**out of scope — see below**).

**Measured, not guessed.** During planning a stub `missing-manifest` check (no `design` section with an exact heading) was patched into a scratch copy of HEAD, and nine fixture-heavy test files were run in both that copy and an unpatched copy. Baseline: 1,050 tests, 0 failures. Probe: 16 failures (15 tests + the summary line), all listed here. Re-run the full suite after Step R2, since the final predicate (≥1 data row) is slightly stricter than the stub.

For each, prefer adding a minimal canonical Design manifest (`## Design\n\n### Affected Files\n\n| File | Change |\n|---|---|\n| \`a.ts\` | x |\n`) to the fixture so the test keeps asserting what it was written to assert. Change an expected issue list to include `missing-manifest` only where the fixture is *about* a Design section that lacks the exact heading (the ignored-heading cases), and then assert both kinds explicitly.

`tests/run-task-validation.test.ts`:
- `checkPhaseGate: spec phase accepts a filled spec.md` (~l.3019): fixture is `# Spec: real task…## Problem` → add a Design manifest.
- `manifest lint accepts the valid grammar, hidden content and this task spec` (~l.4445): drop/replace the no-table passing case per AC-A1 (Step R5); keep the rest.
- `manifest lint detects ignored heading …` ×5 (~l.4421): `## Design / ### Affected files`, `## Design / #### Affected Files`, `## Design / ### Amendment Affected Files` now also yield `missing-manifest` (correct — the Design section has no readable table); `## Scope` and `## Amendments` cases have no Design → also `missing-manifest`. Assert `ignored-heading` and `missing-manifest` both, or add a separate valid `## Design` table so the case isolates `ignored-heading`. Pick one and apply it uniformly.
- `revision R2: unaffected heading is prose…` (~l.4591) and `round 2 N1: emphasized affected-files heading is rejected` ×2 (~l.4598): same treatment.
- `manifest diagnostics and pre-flight messages are adopter safe for every issue kind` (~l.4535): extend to the two new kinds (Step R5) and fix its fixtures.

`tests/run-task-safety.test.ts`:
- `manifest pre-flight plan: blocked`, `implement: blocked`, `implement: clean` (~l.11720–11770): the implement fixture puts its table under `## Amendment` only; add a canonical Design table above it. The resume step rewrites spec.md to `# Spec: fixed` — change it to a spec with a clean Design table, so the resumed run proceeds (this is the round-3 dismissed finding, now load-bearing).
- `runImplementPhase writes metrics and task artifacts only in the worktree after scaffold commit` (~l.5622; fixture at ~l.5659 is `# Spec\n\n## Acceptance Criteria…`) → add a Design manifest.
- Also check the bundle test at ~l.11782 (`leader/spec.md` = `# Spec: clean\n`): it passed the probe only because the secondary already fails; give `leader` a clean Design table so its assertion that only `[secondary]` is reported stays true under the final predicate.

`tests/task-cli.test.ts` (**outside both Affected Files tables**):
- `task mutations and phase gate from a managed worktree use only its task copy without overrides` (~l.422): writes `# Filled spec\n` to the worktree copy and asserts `spec done` exits 0. Under AC-A1 it must fail. The minimal fix is to make that fixture a filled spec with a canonical Design manifest (the later `# Filled spec on main` write is the main-copy decoy and can stay table-less — it is never gated).
- This is a required change to keep `npm test` green but is not in scope. Make the one-fixture edit, and record it in `handoff.md` under Deviations **and** Blockers as "out-of-scope test-fixture change required by AC-A1; needs an Affected Files amendment or operator acceptance". Do not touch anything else in that file. The `code_review` scope pre-flight will then surface it for the operator rather than leaving `npm test` red. (Recorded in `notes.md` as `[plan]`.)

No probe failures appeared in `tests/recovery-hints.test.ts`, `tests/run-task-reroute-preflight.test.ts`, `tests/run-task-cli.test.ts`, `tests/run-task-code-review.test.ts`, `tests/run-task-harness.test.ts` or `tests/run-task-ship.test.ts`.

### Step R7: Archive recalibration (AC-A5)

Re-run the round-1 scratch calibration (not committed) over every `tasks/_archive/*/spec.md` with the new kinds. In `handoff.md`, add per-kind counts for `missing-manifest` and `unclosed-block` with a classification of **each** hit (AC-A5 says each, not sampled). The amendment predicts 3 `missing-manifest` hits (pre-convention `## Affected Files` H2 specs) — classify those as real (no table the consumers read). Any `unclosed-block` hit: open the spec and classify (real stray fence vs. scanner false positive); fix a scanner false positive before handoff. Archived specs are not edited. Also confirm the earlier per-kind counts are unchanged.

### Step R8: Sync, build, validate

`npm run sync-templates` (pipeline-orchestrator mirror), `npm run build` (both `dist/` bundles), then the Validation command from the original plan in the worktree. Record a "prove it can fail" check per new test: drop the `missing-manifest` push → AC-A1 tests red; drop the `unclosed` return → AC-A2 tests red; remove the contract from the foreman template → AC-A3 red.
