# Implementation Plan: reconcile-qa-quality-log-summary

> Written by: Claude | Implements: `tasks/reconcile-qa-quality-log-summary/spec.md`
> Spec review verdict: **approved** (no changes requested; 5 rounds of narrowing before approval — see `notes.md` for the full trajectory). This plan implements the spec as written; no spec gaps found during planning.

## Approach

The write lives **inside `taskPhase()`** (`src/task/index.ts`), triggered when `phaseArg === 'qa' && statusArg === 'done'`. All four qa-done paths already funnel through this one function:

- (a) the agent's rendered `canon task phase <id> qa done` command → `taskCmd()` → `taskPhase()`
- (b) `runQaPhase`'s done.md-salvage branch (`scripts/run-task/phases/qa.ts:48`) → calls `taskPhase(taskId, 'qa', 'done')` directly, **already-existing code, unchanged by this task**
- (c) `tryEvidenceAdvance`'s `case 'qa'` (`scripts/run-task/main.ts`) → calls `taskPhase(taskId, 'qa', 'done')` directly, **already-existing code, unchanged**
- (d) an operator's manual `canon task phase <id> qa done` → `taskCmd()` → `taskPhase()`

Because (b) and (c) already call `taskPhase(taskId, 'qa', 'done')` with no changes needed on their end, this task's only *production* touch points are: a new module (`scripts/run-task/quality-log.ts`), one integration point in `taskPhase()`, two tiny additive exports from `markdown-table.ts`, and the QA prompt contract change. Everything else is tests + docs.

This approach was chosen (over an agent-invoked writer command, or a dedicated qa-done gate) because it's the only design where every qa-completion path — including the undocumented-until-round-3 operator recovery flow in `.claude/skills/canon-pipeline/recovery.md` — gets the row for free, with no agent cooperation and no new rejection path on a load-bearing transition. See spec.md's Decision section and `notes.md`'s round-3 entries for why the two alternatives were rejected.

## Steps

### Step 1: `scripts/run-task/quality-log.ts` (new module)

Files: `scripts/run-task/quality-log.ts` (new)

Model `recordMetric`'s file-creation pattern (`scripts/run-task/metrics.ts`) and the sentinel-upsert shape of `upsertCanonBlock` (`src/lib/canon-block.ts`) for tone only — this module owns considerably more logic (row identity, placement, reconciliation) than either.

**1a. Path resolution (AC-11)**

```ts
export function getQualityLogFile(activeCwd: string): string {
    return process.env.CANON_QUALITY_LOG_FILE_OVERRIDE
        ? path.resolve(process.env.CANON_QUALITY_LOG_FILE_OVERRIDE)
        : path.join(activeCwd, 'docs/task-quality-log.md');
}
```

Mirrors `getMetricsFile()` (`scripts/run-task/metrics.ts:7-11`), except `activeCwd` is **required** (no `REPO_ROOT` fallback) — the caller always has `taskCwd` (from `resolveTaskCwd(id)`) in hand, which is already the worktree-canonical active checkout. Falling back to `REPO_ROOT` here would reintroduce exactly the bug AC-11 exists to prevent: a test without the override would silently hit the real repo's log through `taskCwd`'s own internal `REPO_ROOT` fallback for non-worktree tasks.

**1b. Cell serialization (Decision item 6, AC-4(c))**

```ts
function normalizeCellValue(value: string): string {
    // Step 1 — lossy, declared: the parser reads one row per physical line,
    // so a line break cannot survive inside a cell.
    return value.replace(/\r\n|\n/g, ' ');
}

function escapeCellForRoundTrip(value: string): string {
    // Step 2 — exact round-trip against splitTableLine's odd/even backslash
    // parity (scripts/run-task/markdown-table.ts). Order matters: double
    // every literal backslash FIRST (making any pre-existing backslash run
    // even), THEN prepend one backslash before every literal pipe (making
    // the run immediately preceding it odd). A single pass that escapes
    // pipes only (safeCell's mistake in metrics.ts) leaves an even
    // backslash run before a pipe that followed a backslash, and the
    // parser reads that pipe as an unescaped delimiter — silently
    // truncating the cell. A length-n backslash run doubled then given one
    // more backslash decodes back to exactly n backslashes under
    // splitTableLine's rule.
    return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

export function serializeCell(value: string): string {
    return escapeCellForRoundTrip(normalizeCellValue(value));
}
```

**1c. Local table-line parsing — two tiny additive exports from `markdown-table.ts`**

`scripts/run-task/markdown-table.ts` exports `parseTable`/`parseTableH3`/`scanAllTables`/`extractSectionBodies`, but its cell-splitting internals (`splitTableLine`, `normalizeCells`, `isSeparatorRow`) are not exported, and none of the exported *table* functions fit this module's need: it must capture the actual header cells of one specific table (`## Log`) and then parse arbitrary `|`-prefixed lines *elsewhere in the document* (the stray-row region below `## Periodic Reviews`) against **that same captured header**, rather than inferring a new header from the stray block's own first line (which would misparse — the first stray line is a real task's data row, not a header).

Per spec's Interaction Dependencies ("the writer should read the header through the same convention so reads and writes cannot disagree about column identity"), add two additive, non-breaking exports rather than duplicating the backslash/pipe-splitting logic where it could drift out of sync:

```ts
// in scripts/run-task/markdown-table.ts — add near the other exports
export function splitTableRowCells(line: string): string[] {
    return normalizeCells(line);
}
export function isCanonSeparatorRow(cells: readonly string[]): boolean {
    return isSeparatorRow(cells);
}
```

No existing caller changes. `scripts/run-task/markdown-table.ts` is not in spec.md's Affected Files list — declare it in the handoff Changes table anyway, with a one-line deviation note ("purely additive re-exports of existing private helpers, needed so the quality-log writer parses table rows via the same convention the rest of the codebase already uses"). This is the same "plan discovers one more file" pattern documented repeatedly in `docs/task-quality-log.md`'s own history.

**1d. Canon schema constants**

```ts
const CANON_LOG_HEADERS = [
    'Date', 'Task', 'Size', 'Spec verdict', 'Spec iter', 'Review iter',
    'Dropped ACs', 'Validation gaps', 'Human reroute?', 'Notes',
] as const;
const DERIVED_HEADERS = new Set(['Date', 'Task', 'Size', 'Spec iter', 'Review iter']);
const JUDGMENT_HEADERS = new Set(['Spec verdict', 'Human reroute?', 'Dropped ACs', 'Validation gaps', 'Notes']);
const EARLIEST_WINS_HEADERS = new Set(['Spec verdict']); // every other judgment/adopter column is "latest wins"
```

**1e. Locating the `## Log` table and the stray region**

```ts
type TableRow = { lineIndex: number; cells: Record<string, string> };

function locateLogTable(lines: string[]): {
    headerCells: string[];
    dataStart: number; // first data-row line index
    dataEnd: number;   // exclusive — one past the last contiguous '|' data line
} | 'malformed' {
    const headingIndex = lines.findIndex(l => l.trimEnd() === '## Log');
    if (headingIndex === -1) return 'malformed';
    let headerIndex = -1;
    for (let i = headingIndex + 1; i < lines.length; i += 1) {
        if (/^#{1,2}\s/.test(lines[i])) return 'malformed'; // hit next heading before finding a table
        if (lines[i].trimStart().startsWith('|')) { headerIndex = i; break; }
    }
    if (headerIndex === -1) return 'malformed';
    const headerCells = splitTableRowCells(lines[headerIndex]);
    for (const required of CANON_LOG_HEADERS) {
        if (!headerCells.includes(required)) return 'malformed';
    }
    let dataStart = headerIndex + 1;
    if (dataStart < lines.length && isCanonSeparatorRow(splitTableRowCells(lines[dataStart]))) {
        dataStart += 1;
    }
    let dataEnd = dataStart;
    while (dataEnd < lines.length && lines[dataEnd].trimStart().startsWith('|')) dataEnd += 1;
    return { headerCells, dataStart, dataEnd };
}
```

`'malformed'` covers: no `## Log` heading, no table found before the next heading, or a header row missing any of the 10 canon columns (AC-4b(c)). All three fail the same way at the call site: warn + skip the write entirely, file left untouched.

```ts
function parseLogRows(lines: string[], headerCells: string[], dataStart: number, dataEnd: number): TableRow[] {
    const rows: TableRow[] = [];
    for (let i = dataStart; i < dataEnd; i += 1) {
        const cells = splitTableRowCells(lines[i]);
        if (isCanonSeparatorRow(cells)) continue;
        const row: Record<string, string> = {};
        headerCells.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
        rows.push({ lineIndex: i, cells: row });
    }
    return rows;
}

function parseStrayRows(lines: string[], headerCells: string[]): TableRow[] {
    const periodicIndex = lines.findIndex(l => l.trimEnd() === '## Periodic Reviews');
    if (periodicIndex === -1) return [];
    const rows: TableRow[] = [];
    for (let i = periodicIndex + 1; i < lines.length; i += 1) {
        if (!lines[i].trimStart().startsWith('|')) continue;
        const cells = splitTableRowCells(lines[i]);
        if (isCanonSeparatorRow(cells)) continue;
        if (cells.length !== headerCells.length) continue; // not a Log-shaped row — ignore, don't misparse
        const row: Record<string, string> = {};
        headerCells.forEach((h, idx) => { row[h] = cells[idx] ?? ''; });
        rows.push({ lineIndex: i, cells: row });
    }
    return rows;
}
```

Stray rows are parsed against the real `## Log` table's own header cells, not by inferring a header from the stray block itself — the first stray line is a real task's data row, and treating it as a header would silently drop that task's row and misalign every row after it.

**1f. Reconciliation (Decision item 5)**

```ts
function reconcileHistory(existingRows: TableRow[], headerCells: string[]): Record<string, string> {
    const sorted = [...existingRows].sort((a, b) => a.lineIndex - b.lineIndex); // document order = chronological
    const result: Record<string, string> = {};
    for (const header of headerCells) {
        if (DERIVED_HEADERS.has(header)) continue; // always recomputed, never reconciled
        if (EARLIEST_WINS_HEADERS.has(header)) {
            for (const row of sorted) {
                const v = (row.cells[header] ?? '').trim();
                if (v) { result[header] = v; break; } // first non-empty ascending = earliest
            }
        } else {
            for (const row of sorted) {
                const v = (row.cells[header] ?? '').trim();
                if (v) result[header] = v; // keep overwriting → last non-empty wins
            }
        }
    }
    return result;
}
```

One function handles both the 4 "latest wins" judgment columns and any adopter-added columns uniformly (adopter columns aren't in `EARLIEST_WINS_HEADERS`, so they fall into the "latest wins" branch — matching Decision item 5's table).

**1g. Building the final row**

```ts
function todayUTC(): string {
    return new Date().toISOString().slice(0, 10);
}

function formatSizeCell(taskSize: TaskSize | undefined, delicate: boolean | undefined): string {
    const size = taskSize ?? 'M';
    return delicate ? `${size} delicate` : size;
}

type Derived = {
    taskId: string;
    taskSize?: TaskSize;
    delicate?: boolean;
    specIterTotal?: number;
    reviewIterTotal?: number;
};
type Judgment = Partial<Record<'Spec verdict' | 'Human reroute?' | 'Dropped ACs' | 'Validation gaps' | 'Notes', string>>;

function buildFinalRow(headerCells: string[], derived: Derived, reconciled: Record<string, string>, qaSupplied: Judgment): Record<string, string> {
    const row: Record<string, string> = {};
    for (const h of headerCells) {
        if (h === 'Date') row[h] = todayUTC();
        else if (h === 'Task') row[h] = derived.taskId;
        else if (h === 'Size') row[h] = formatSizeCell(derived.taskSize, derived.delicate);
        else if (h === 'Spec iter') row[h] = String(derived.specIterTotal ?? 0);
        else if (h === 'Review iter') row[h] = String(derived.reviewIterTotal ?? 0);
        else if (JUDGMENT_HEADERS.has(h)) {
            const supplied = (qaSupplied as Record<string, string | undefined>)[h];
            row[h] = supplied && supplied.trim() !== '' ? supplied : (reconciled[h] ?? '');
        } else {
            row[h] = reconciled[h] ?? ''; // adopter column: preserved on update, empty on insert
        }
    }
    return row;
}

function renderRowLine(headerCells: string[], row: Record<string, string>): string {
    return '| ' + headerCells.map(h => serializeCell(row[h] ?? '')).join(' | ') + ' |';
}
```

`Date` deliberately never reads `status.json` — see spec Decision item 3's table. `Derived` has no field for `status.created`/`status.updated`; that omission is itself the guardrail against accidentally wiring it in later.

**1h. File reconstruction — insert-or-replace, relocate, dedupe (Decision items 1, 2, 5; AC-2, AC-3, AC-4c)**

```ts
const STANDARD_QUALITY_LOG_SKELETON = [
    '# Task Quality Log',
    '',
    '## Log',
    '',
    '| Date | Task | Size | Spec verdict | Spec iter | Review iter | Dropped ACs | Validation gaps | Human reroute? | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|',
    '',
    '## Periodic Reviews',
    '',
].join('\n');

export function upsertQualityLogRow(logFilePath: string, derived: Derived, qaSupplied: Judgment): void {
    try {
        let content: string;
        try {
            content = fs.readFileSync(logFilePath, 'utf8');
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
                content = STANDARD_QUALITY_LOG_SKELETON; // falls through to the normal insert path below
            } else {
                warn(`quality-log: could not read ${logFilePath}: ${(err as Error).message}`);
                return;
            }
        }

        const lines = content.split('\n');
        const located = locateLogTable(lines);
        if (located === 'malformed') {
            warn(`quality-log: ${logFilePath} has no well-formed '## Log' table with all required columns — skipping row write for '${derived.taskId}'.`);
            return;
        }
        const { headerCells, dataStart, dataEnd } = located;

        const logRows = parseLogRows(lines, headerCells, dataStart, dataEnd);
        const strayRows = parseStrayRows(lines, headerCells);
        const allRows = [...logRows, ...strayRows];
        const taskRows = allRows.filter(r => (r.cells['Task'] ?? '').trim() === derived.taskId);
        const reconciled = reconcileHistory(taskRows, headerCells);
        const finalRow = buildFinalRow(headerCells, derived, reconciled, qaSupplied);
        const rendered = renderRowLine(headerCells, finalRow);

        const removeSet = new Set(taskRows.map(r => r.lineIndex));
        const insertionIndex = dataEnd; // append at the end of the Log table's own row block

        const newLines: string[] = [];
        for (let i = 0; i < lines.length; i += 1) {
            if (i === insertionIndex) newLines.push(rendered);
            if (!removeSet.has(i)) newLines.push(lines[i]);
        }
        if (insertionIndex >= lines.length) newLines.push(rendered);

        fs.writeFileSync(logFilePath, newLines.join('\n'), 'utf8');
    } catch (err) {
        warn(`quality-log: unexpected error writing row for '${derived.taskId}': ${(err as Error).message}`);
    }
}
```

The outer `try/catch` is belt-and-suspenders around the inner locate/parse/build logic — AC-7 requires that no condition here ever throws out to the caller. `STANDARD_QUALITY_LOG_SKELETON` is the minimal valid structure (not the full prose doc, which already exists checked-in for the real repo) — this fallback is only for a genuinely-absent file (a fresh override path, or a wiped adopter copy).

**1i. done.md judgment-block parsing**

New `done.md` contract section (written by the QA prompt — see Step 3):

```markdown
## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: One-line summary of anything notable.
```

Parser (uses the already-exported `extractSectionBodies` from `markdown-table.ts` — no new export needed for this part):

```ts
const JUDGMENT_LABELS: Record<string, keyof Judgment> = {
    'spec verdict': 'Spec verdict',
    'human reroute?': 'Human reroute?',
    'dropped acs': 'Dropped ACs',
    'validation gaps': 'Validation gaps',
    'notes': 'Notes',
};

export function parseQualityLogJudgmentBlock(doneMdContent: string): Judgment {
    const bodies = extractSectionBodies(doneMdContent, /^## Quality Log\b/);
    if (bodies.length === 0) return {};
    const body = bodies[bodies.length - 1]; // latest, consistent with other cumulative-section reads
    const result: Judgment = {};
    for (const line of body.split('\n')) {
        const match = /^-\s*([^:]+):\s*(.*)$/.exec(line.trim());
        if (!match) continue;
        const key = JUDGMENT_LABELS[match[1].trim().toLowerCase()];
        if (!key) continue;
        const value = match[2].trim();
        if (value) result[key] = value;
    }
    return result;
}
```

An absent block → `{}` (every cell falls back to reconciled history on upsert, or empty on insert — never throws). An absent individual line → that key stays unset, same fallback. Satisfies Implementation Notes' "must tolerate an absent block and an absent individual cell."

**1j. Top-level entry point called from `taskPhase()`**

```ts
export function writeQualityLogForTask(taskId: string, activeCwd: string, donePath: string, status: StatusJson): void {
    try {
        const specReview = status.phases.spec_review;
        const codeReview = status.phases.code_review;
        const derived: Derived = {
            taskId,
            taskSize: status.task_size,
            delicate: status.delicate,
            specIterTotal: specReview?.iterations_total ?? 0,
            reviewIterTotal: codeReview?.iterations_total ?? 0,
        };
        let doneContent = '';
        try { doneContent = fs.readFileSync(donePath, 'utf8'); } catch { /* absent/template done.md — judgment cells all empty */ }
        const judgment = parseQualityLogJudgmentBlock(doneContent);
        upsertQualityLogRow(getQualityLogFile(activeCwd), derived, judgment);
    } catch (err) {
        warn(`quality-log: failed to write row for '${taskId}': ${(err as Error).message}`);
    }
}
```

This outer function is the one `taskPhase()` calls — it has its own try/catch as a second layer of defense (AC-7's "no un-guarded throw path," per spec's Known Risks) even though `upsertQualityLogRow` already catches internally.

### Step 2: `src/task/index.ts` integration

Files: `src/task/index.ts`

In `taskPhase()` (currently lines 418-485), after the existing `writeStatusAtomic(statusPath, status);` call and before the closing `console.log`, add:

```ts
if (phaseArg === 'qa' && statusArg === 'done') {
    const donePath = path.join(taskDirForCwd(taskCwd, id), 'done.md');
    writeQualityLogForTask(id, taskCwd, donePath, status);
}
```

Import: `import { writeQualityLogForTask } from '../../scripts/run-task/quality-log.js';` — matches this file's existing relative-import convention for `../../scripts/run-task/validation.js`, `../../scripts/run-task/state.js`, etc.

Notes:
- Use `taskCwd` (already resolved at the top of `taskPhase` as `const taskCwd = resolveTaskCwd(id);`), **not** `REPO_ROOT` — this is the worktree-canonical active checkout, and is exactly what makes AC-11's override necessary (`resolveTaskCwd` falls back to `REPO_ROOT` for non-worktree tasks, which in a bare test fixture is the real canon-ai checkout).
- Use the already-private `taskDirForCwd(taskCwd, id)` in this same file to compute the done.md path at the call site — do not export it; `quality-log.ts` doesn't need to know about `taskDirForCwd`'s resolution rules.
- Read `status` fields (`task_size`, `delicate`, `phases.spec_review.iterations_total`, `phases.code_review.iterations_total`) from the in-memory `status` object already mutated earlier in this function — none of those fields are touched by this transition (only `status.updated`, `entry.status`, and possibly `entry.verdict` are), so there's no ordering hazard. Do **not** pass `status.updated` or `status.created` into the writer.
- This block only fires on `qa`/`done` — it doesn't touch `updateReviewCounters` or any other branch of `taskPhase`.

### Step 3: `scripts/run-task/prompts/templates/qa.md` (AC-9)

Files: `scripts/run-task/prompts/templates/qa.md`

Replace the current line 47 (`- Append one row per task to docs/task-quality-log.md (see that file for column definitions).`) with a contract describing the new `done.md` block instead of a direct file edit:

```
- Add a `## Quality Log` section to done.md with the five judgment cells the pipeline cannot derive from status.json. Do **not** edit docs/task-quality-log.md directly — the qa → done transition writes/upserts that row automatically from status.json plus this section.

  ```markdown
  ## Quality Log
  - Spec verdict: <the FIRST spec_review verdict this task ever received — approved / approved_with_nits / changes_requested; leave blank only if truly unknown>
  - Human reroute?: <Yes/No — did the human reject at human_review and force a re-implement? Do not infer this from any reroute counter; if this is a fresh QA pass with no human_review rejection yet, answer No>
  - Dropped ACs: <count of ACs the implementation missed, caught in code review>
  - Validation gaps: <count of validation checks that should have run but didn't>
  - Notes: <one-line summary of anything notable — single line, no embedded line breaks>
  ```

  On a re-upsert after a reroute, only fill in cells that changed or that you're correcting — an omitted cell keeps its previously recorded value. In particular, do not overwrite an already-recorded `Spec verdict` with the current status.json verdict; that column means the *first* spec_review verdict, and status.json only retains the latest.
```

After editing, regenerate the golden fixture (`UPDATE_GOLDENS=1 npm test`) per `docs/patterns.md`'s "Prompt-context changes require regenerating the golden snapshot fixtures" pitfall. Check the diff in `tests/run-task-prompts.golden.json` touches only the `qa` prompt fixture.

### Step 4: Rebuild `dist/`

Files: `dist/scripts/run-task.js`, `dist/cli/index.js`

Run `npm run build`. Both entry points bundle `src/task/index.ts` and the new/changed `scripts/run-task/*` sources — declare both dist artifacts in the handoff Changes table.

### Step 5: Tests

**5a. `tests/run-task-quality-log.test.ts` (new)** — unit tests against the module directly (temp-dir fixture files, no git/subprocess needed):

- **AC-1 (derived counters, red-first)**: seed a fixture Log row for `schedule-date-corrections` reading `Spec iter=1, Review iter=1`. Upsert with `specIterTotal=6, reviewIterTotal=2`. Assert the row now reads `6`/`2`. Second case: both counters `undefined` → assert `0`/`0` (not a throw or blank cell).
- **AC-1b (Date/Size binding)**: assert `Date` equals `new Date().toISOString().slice(0,10)` at call time (never derivable from `status.created`/`status.updated` — `Derived` has no such field, so this is structurally guaranteed; still assert the exact format). `Size`: no `taskSize` → `M`; `taskSize: 'XS'` no delicate → `XS`; `taskSize: 'L', delicate: true` → `L delicate`.
- **AC-2 (upsert — exactly one row)**: upsert twice for the same task id (second call simulating a post-reroute pass with different counters). Assert exactly one matching row afterward, reflecting the second call's values.
- **AC-3 (placement + relocation)**: (a) `## Periodic Reviews` present — no data row at/after that heading; (b) anchorless fixture (header+separator, no filler row, no `## Periodic Reviews`) — row appended right after the separator without throwing; (c) task's own row already sits below `## Periodic Reviews` and nowhere else — after the write, exactly one row for that task, inside the table.
- **AC-4 (judgment cells + escaping)**: (a) supply all five — assert they appear alongside derived cells; (b) re-upsert with new counters and all five omitted — counters update, all five retain prior values (including a `Spec verdict` of `changes_requested` not overwritten); (c) `serializeCell` round-trip via the new `splitTableRowCells` export: `a\|b` and a bare `|` recover exactly; a `\n` and a `\r\n` in `Notes` recover the space-flattened form (not the original — assert this explicitly, since normalization is deliberately lossy). Every case preserves the row's 10-cell count.
- **AC-4b (header-driven placement, adopter columns)**: (a) adopter column inserted before a canon column — every canon cell lands under its own header; adopter column's existing value preserved on update; (b) an insert into that same table — adopter column renders empty, not shifted; (c) header missing one canon column — `upsertQualityLogRow` returns without writing; file byte-identical to its original.
- **AC-4c (duplicate convergence)**: (a) two rows inside `## Log` with conflicting `Spec verdict`/`Notes` — earliest `Spec verdict`, latest `Notes` survive; (b) one row inside `## Log` plus a conflicting stray row below `## Periodic Reviews` — same resolution, one surviving in-table row. Both fixtures include another task's row, asserted byte-identical before/after.
- **AC-5 (negative derivation guard)**: reproduce `ship-shared-doc-dirt-preservation`'s shape — a pre-existing row reading `Human reroute? = No`, `qaSupplied` omits that cell. Assert it stays `No` (there is nothing reroute-count-shaped in `Derived` the writer could read to manufacture `Yes` from — the test documents that contract).
- **AC-8 (history untouched)**: after an upsert, assert separately-tracked `status.json`/`spec-review.md`/`review.md`-shaped fixtures in the same temp dir (never passed to the writer) are byte-identical before/after.

**5b. `tests/task-cli.test.ts`** — transition-level tests (AC-6, AC-7, AC-11), using the existing `withEnv` helper (`tests/task-cli.test.ts:33-48`) with `CANON_TASKS_DIR_OVERRIDE` **and** the new `CANON_QUALITY_LOG_FILE_OVERRIDE` so no test ever touches the real repo's log:

- **AC-6 (a)+(d)**: the agent's rendered command and an operator's manual invocation both execute the identical `taskCmd(['phase', id, 'qa', 'done'])` → `taskPhase` path — one test covers both (note the equivalence in a comment rather than duplicating the test). Seed a task at `qa: in_progress` with a filled `done.md` containing a `## Quality Log` block, run the transition, assert a row exists in the overridden file and `phases.qa.status === 'done'`.
- **AC-6 (b)**: `runQaPhase`'s salvage branch (`scripts/run-task/phases/qa.ts:37-53`) has no existing test coverage of any kind (confirmed — no test spawns/mocks `runQaPhase` or `runClaude` for `qa` anywhere in `tests/`). Rather than inventing a new mocking seam for `runQaPhase` (which would require modifying `phases/qa.ts` — not in spec's Affected Files, and unnecessary since the write's correctness doesn't depend on which caller invokes `taskPhase`), write a test that reproduces the salvage branch's exact statement sequence directly: write a template `done.md`, assert `isDoneMdTemplate(donePath) === true`, call `extractDoneMdFromStdout(fakeStdout)` with a fixture stdout string starting with `# QA Summary` and containing a `## Quality Log` block, `fs.writeFileSync(donePath, salvaged)`, then `taskPhase(taskId, 'qa', 'done')` — exactly what `phases/qa.ts:41-49` does. Assert the row appears afterward. Comment in the test explaining why (no existing seam; the write's location inside `taskPhase` makes the calling module irrelevant to correctness).
- **AC-6 (c)**: covered by the `tests/run-task-safety.test.ts` update in 5c below (already drives `tryEvidenceAdvance`'s `qa` case via `checkAndRoute`).
- **AC-7 (fail-soft)**: malformed (override file has no `## Log` heading or is missing a required column — assert byte-unchanged + a warning printed + phase still reaches `done`); unwritable (override path with a nonexistent, uncreatable parent directory — more portable than chmod tricks — assert phase still reaches `done`); absent (override path doesn't exist — assert phase reaches `done` and the file now exists with the skeleton plus the task's row).
- **AC-11**: with the override set, assert the transition writes only to the override path, and the real repository's `docs/task-quality-log.md` is untouched (compare content/mtime before and after) — this proves the override actually prevents the `REPO_ROOT`-fallback path from firing, not just that the test happens not to hit it.

**5c. `tests/run-task-safety.test.ts`** — update the existing `checkAndRoute commits QA artifacts after evidence-advancing qa to done` test (currently lines 4587-4640): it sets only `CANON_TASKS_DIR_OVERRIDE` (plus fake-git env) in the subprocess. Add `CANON_QUALITY_LOG_FILE_OVERRIDE` pointing inside the test's own temp dir, mirroring the existing `CANON_METRICS_FILE_OVERRIDE` subprocess-env pattern used elsewhere in this same file (e.g. around lines 5282-5298). Extend the assertions: after the subprocess exits, read the override file and assert a row now exists for `task-a`. Satisfies AC-11's explicit call-out and doubles as AC-6(c) coverage.

**5d. Golden fixture**: after Step 3's prompt edit, `UPDATE_GOLDENS=1 npm test`; review the `tests/run-task-prompts.golden.json` diff touches only the `qa` fixture; commit it.

### Step 6: Docs (AC-10)

**6a. `docs/task-quality-log.md` (root) and `templates/docs/task-quality-log.md` (hand-maintained seed — not in `CANON_OWNED`, so `sync-templates` will not propagate the root edit; edit both explicitly)**

- Header prose (currently line 3): `> Appended by Claude during the QA/done step. One row per task. Tracks pipeline health signals over time.` → replace "Appended by Claude during the QA/done step" with prose describing the upsert-at-transition behavior, e.g.: `> Upserted by the qa → done phase transition — one row per task, keyed by Task id. QA supplies five judgment cells via done.md; the rest are derived from status.json.`
- Currently line 13: `The QA phase appends a row at the end of every task.` → `The qa → done transition writes (or updates in place, on a re-upsert) this task's row.`
- Columns table, `Size` row (currently line 20): `S / M / L / XL (and delicate: true if applicable)` → add `XS`: `XS / S / M / L / XL (and delicate: true if applicable)`.
- Do **not** rewrite historical data rows — only the header/prose sections above change.

**6b. `docs/architecture.md`** — three sites (grep-verified line numbers as of this plan; re-verify at implement time):

1. Data Flow, QA step summary (currently line 87): `10. **QA**: Claude writes done.md, distills notes.md into lessons-learned.md entries, appends row to task-quality-log.md.` → drop the "appends row to task-quality-log.md" clause from QA's list; note the transition does it instead: `10. **QA**: Claude writes done.md (including judgment cells for the task-quality-log row) and distills notes.md into lessons-learned.md entries. The qa → done transition itself upserts the task's task-quality-log.md row from status.json plus those judgment cells.`
2. Telemetry paragraph (currently line 96): `During QA, Claude appends a row to docs/task-quality-log.md (spec review iterations, dropped ACs, validation gaps). Both files are append-only; rotation is manual.` → `task-quality-log.md` is no longer append-only. Rewrite: `During QA, Claude records five judgment cells in done.md; the qa → done transition derives the rest from status.json and upserts one row per task into docs/task-quality-log.md (docs/pipeline-invocations.md remains append-only).`
3. Auto-block bullet (currently line 174): `Sets phase status to blocked, appends to task-quality-log.md, exits with code 2.` → remove the false clause entirely (confirmed false: `autoBlockPhase()` in `scripts/run-task/state.ts` only sets `blocked`, bumps `auto_block_count`, and pushes an escalation). Corrected: `Sets phase status to blocked, bumps auto_block_count and pushes an escalation, exits with code 2.`

Run `npm run docs-refs-check` after these edits.

**6c. `docs/decisions.md`** — new dated entry, following the file's existing convention (`## <Title> (YYYY-MM)` heading, `**Decision**:`/`**Why**:`/`**Rule**:` paragraphs, separated by `---`):

```markdown
---

## Task quality-log row upserted at the qa → done transition (2026-07)

**Decision**: The task-quality-log row is no longer appended by the QA agent. It is written by a deterministic upsert inside `taskPhase()`'s `qa → done` transition (`src/task/index.ts`, alongside the existing `updateReviewCounters` derived write), keyed by task id. QA supplies five judgment cells (`Spec verdict`, `Human reroute?`, `Dropped ACs`, `Validation gaps`, `Notes`) via a `## Quality Log` section in `done.md`; every other cell is derived from `status.json` at write time. No new gate is added — a missing, misplaced, or duplicated row becomes structurally impossible by construction rather than something to detect.

**Why**: With the old blind-append instruction, nothing revisited a task's row after a reroute, and nothing anchored the write inside the `## Log` table. Only two columns have a sound, monotonic source in `status.json`: `phases.spec_review.iterations_total` and `phases.code_review.iterations_total`. Two more plausible-looking derivations were checked and rejected: `Human reroute?` cannot be derived from `implement.reroute_count`, because `rerouteFromHumanReview()` increments that same counter for both genuine human_review reroutes and blocked `code_review` `spec_gap` recovery (`scripts/run-task/main.ts`) — archived `ship-shared-doc-dirt-preservation` has `reroute_count: 2` alongside a correct `Human reroute? = No`. `Spec verdict` cannot be derived either, because the column means the *first* spec_review verdict while `status.json` retains only the latest (cleared on reset). Adding a persisted first-verdict field or a durable human-reroute flag to `status.json` to close those gaps was considered and declined — schema growth on a delicate, load-bearing surface for low value; both stay QA-authored judgment, refreshed by the upsert instead.

**Rule**: Do not derive `Human reroute?` from any reroute-count-shaped `status.json` field, and do not derive `Spec verdict` from `status.json`'s current verdict (it only holds the latest, not the first). Any future column that seems mechanically derivable from `status.json` must be checked against every caller/reset path that writes the underlying field, not just the discussed one. The writer lives at the `qa → done` transition specifically because all four paths that complete QA (agent-invoked phase command, done.md-salvage, `tryEvidenceAdvance`'s evidence-advance, and operator recovery) already funnel through `taskPhase()`.
```

## Testing Plan

- **Unit**: `tests/run-task-quality-log.test.ts` (new) — see Step 5a; covers AC-1, AC-1b, AC-2, AC-3, AC-4, AC-4b, AC-4c, AC-5, AC-8.
- **Integration/transition-level**: `tests/task-cli.test.ts` additions (Step 5b) — covers AC-6(a)/(b)/(d), AC-7, AC-11. `tests/run-task-safety.test.ts` update (Step 5c) — covers AC-6(c), doubles as AC-11 regression guard on the pre-existing evidence-advance path.
- **Golden**: `tests/run-task-prompts.golden.json` regeneration — covers AC-9's test half.
- **Manual/E2E**: none beyond the spec's Human Test Plan (already written in spec.md) — no UI surface.
- **Full suite**: `npm run lint`, `npm run type-check`, `npm test`, `npm run build`, `npm run docs-refs-check` all green; committed `dist/` matches a fresh build (AC-12). `sync-templates:check` not required — nothing this task edits is in `CANON_OWNED`.

## Cross-cutting checks before handoff

- **Bundle members**: not applicable to this task itself (single task), but the writer's correctness under bundle QA (each member calls `taskPhase(memberId, 'qa', 'done')` independently, each writing its own row from its own `status.json`) falls out of the per-call design in Step 1j — no special-casing or dedicated test needed, per spec's Known Risks ("covered by construction rather than a dedicated AC").
- **Delicate**: this task is `delicate: true` (write sits inside a load-bearing state transition). Any un-guarded throw path surfaced in review is blocking, per spec's Known Risks.
- Handoff Changes table must list: `scripts/run-task/quality-log.ts` (new), `scripts/run-task/markdown-table.ts` (two new exports — documented deviation from spec's Affected Files), `src/task/index.ts`, `scripts/run-task/prompts/templates/qa.md`, `tests/run-task-quality-log.test.ts` (new), `tests/task-cli.test.ts`, `tests/run-task-safety.test.ts`, `tests/run-task-prompts.golden.json`, `dist/scripts/run-task.js`, `dist/cli/index.js`, `docs/task-quality-log.md`, `templates/docs/task-quality-log.md`, `docs/architecture.md`, `docs/decisions.md`.

## Rollback Plan

Low risk: the write is fail-soft by construction (AC-7) and touches only the task-quality-log file and (transiently) in-memory state already present in `taskPhase()` — it never mutates `status.json` counters, `spec-review.md`/`review.md`, or any other task's row (AC-8). If a regression is found post-ship, reverting the commit restores the old blind-append prompt instruction and removes the transition-side write; no data migration is needed since historical rows are never rewritten (only new/updated rows going forward are affected). If a live bug in the writer itself needs a fast mitigation short of a full revert, setting `CANON_QUALITY_LOG_FILE_OVERRIDE` to `/dev/null`-equivalent is not a safe workaround (the writer would still attempt a read/parse cycle); the safer stopgap is reverting `src/task/index.ts`'s single integration block (Step 2), which fully disables the write while leaving the rest of the module inert.
