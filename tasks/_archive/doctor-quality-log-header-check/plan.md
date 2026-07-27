# Implementation Plan: doctor-quality-log-header-check

> Written by: Claude | Implements: `tasks/doctor-quality-log-header-check/spec.md`
> Spec review verdict: approved with nits — the one nit (explicitly enumerate the AC-9 unreadable-path test alongside AC-3/4/5 in test-file/validation descriptions) is folded into Step 3 below.

## Approach

`checkQualityLog(cwd)` is a thin `canon doctor` check that delegates entirely to the writer's own `locateLogTable()` (newly exported, no logic change) so the check can never drift out of sync with what the writer actually requires. No new parsing logic is written in `doctor.ts`.

## Steps

### Step 1: Export the two symbols

Files: `scripts/run-task/quality-log.ts`

Add `export` to the existing declarations — no other change:

```ts
export const CANON_LOG_HEADERS = [
    'Date',
    'Task',
    'Size',
    'Spec verdict',
    'Spec iter',
    'Review iter',
    'Dropped ACs',
    'Validation gaps',
    'Human reroute?',
    'Notes',
] as const;
```

```ts
export function locateLogTable(lines: readonly string[]): LocatedLogTable | null {
```

Also export the `LocatedLogTable` type (`export type LocatedLogTable = { headerCells: string[]; dataStart: number; dataEnd: number };`) — it's the return type `locateLogTable` produces, and `doctor.ts` needs it to type the result without falling back to `any`/`unknown`. This is still export-only: no signature or logic change, consistent with AC-1.

Verify: `grep -n "^export const CANON_LOG_HEADERS" scripts/run-task/quality-log.ts` and `grep -n "^export function locateLogTable" scripts/run-task/quality-log.ts` both match. Run `npm test -- tests/run-task-quality-log.test.ts` — untouched in behavior, must still pass unchanged.

### Step 2: `checkQualityLog` in `doctor.ts`

Files: `src/cli/commands/doctor.ts`

Add `relative` to the existing `import { join, sep as pathSep } from 'path';` line (becomes `import { join, relative, sep as pathSep } from 'path';`).

Add an import for the writer's exports, grouped with the other `scripts/run-task/*` imports at the top of the file:

```ts
import { getQualityLogFile, locateLogTable } from '../../../scripts/run-task/quality-log.js';
```

Add the check function near the other `check*(cwd)` functions — directly after `checkSkills` is a natural spot, keeping all "Canon setup"-section checks grouped together:

```ts
export function checkQualityLog(cwd: string): Check {
    const label = 'docs/task-quality-log.md';
    const logPath = getQualityLogFile(cwd);

    let content: string;
    try {
        content = readFileSync(logPath, 'utf8');
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code === 'ENOENT') {
            return {
                label,
                status: 'pass',
                detail: 'not present — writer creates it fresh on first qa → done transition',
            };
        }
        const message = error instanceof Error ? error.message : String(error);
        return { label, status: 'warn', detail: `could not read ${logPath}: ${message}` };
    }

    const located = locateLogTable(content.split('\n'));
    if (located === null) {
        return {
            label,
            status: 'warn',
            detail:
                `${relative(cwd, logPath)} has no well-formed '## Log' table with all required columns — ` +
                `the quality-log writer will silently skip rows for this repo until it's fixed. ` +
                `Compare against templates/docs/task-quality-log.md for the reference header shape.`,
        };
    }

    return { label, status: 'pass' };
}
```

Design notes tying back to the spec:
- Reuse `getQualityLogFile(cwd)` rather than hand-joining `docs/task-quality-log.md` — it already encodes the `CANON_QUALITY_LOG_FILE_OVERRIDE` env-var override, so the check and the writer can never look at different files.
- ENOENT vs. other-read-error is a separate branch (AC-9, mirrors `upsertQualityLogRow`'s own ENOENT-vs-other split) — don't collapse them into one catch.
- No local "header contains all required columns" comparison anywhere in this function (AC-2) — `locateLogTable` alone decides pass/warn. Do not import or inspect `CANON_LOG_HEADERS` directly here; that would be exactly the reimplementation AC-2 forbids.

Wire it into `canonChecks` in `doctorCmd` (~line 662-668), appended after `checkSkills(cwd)`:

```ts
const canonChecks: Check[] = [
    checkCanonDiscoveryNudge(cwd),
    ...(codexDeprecated ? [codexDeprecated] : []),
    checkTemplates(cwd),
    checkCanonVersion(cwd),
    checkSkills(cwd),
    checkQualityLog(cwd),
];
```

Satisfies AC-6 — a real `canon doctor` run now includes this check under "Canon setup".

### Step 3: Tests in `tests/cli.test.ts`

Files: `tests/cli.test.ts`

Import `checkQualityLog` in the existing `from '../src/cli/commands/doctor.js'` block (alongside `checkSkills`, `checkCanonVersion`, etc.).

The header/table shape mirrors `tests/run-task-quality-log.test.ts`'s `HEADERS`/`tableDocument()` helpers, but those are file-local (not exported) — inline an equivalent small helper in `cli.test.ts` rather than adding a cross-test-file export (out of this spec's Affected Files):

```ts
// ── checkQualityLog ──────────────────────────────────────────────────────────

const QUALITY_LOG_HEADERS = [
    'Date', 'Task', 'Size', 'Spec verdict', 'Spec iter',
    'Review iter', 'Dropped ACs', 'Validation gaps', 'Human reroute?', 'Notes',
];

function writeQualityLogFixture(dir: string, headers: readonly string[]): void {
    const docsDir = path.join(dir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    const lines = [
        '# Task Quality Log',
        '',
        '## Log',
        '',
        `| ${headers.join(' | ')} |`,
        `|${headers.map(() => '---').join('|')}|`,
        '',
        '## Periodic Reviews',
        '',
    ];
    fs.writeFileSync(path.join(docsDir, 'task-quality-log.md'), lines.join('\n'), 'utf8');
}

void test('checkQualityLog: missing docs/task-quality-log.md → pass (AC-3)', () => {
    withTempDir(dir => {
        assert.equal(checkQualityLog(dir).status, 'pass');
    });
});

void test('checkQualityLog: well-formed header → pass (AC-4)', () => {
    withTempDir(dir => {
        writeQualityLogFixture(dir, QUALITY_LOG_HEADERS);
        assert.equal(checkQualityLog(dir).status, 'pass');
    });
});

void test('checkQualityLog: well-formed header in different column order → pass (AC-4)', () => {
    withTempDir(dir => {
        writeQualityLogFixture(dir, [...QUALITY_LOG_HEADERS].reverse());
        assert.equal(checkQualityLog(dir).status, 'pass');
    });
});

void test('checkQualityLog: header missing a required column → warn naming file and template (AC-5)', () => {
    withTempDir(dir => {
        writeQualityLogFixture(dir, QUALITY_LOG_HEADERS.filter(h => h !== 'Notes'));
        const check = checkQualityLog(dir);
        assert.equal(check.status, 'warn');
        assert.match(check.detail ?? '', /task-quality-log\.md/);
        assert.match(check.detail ?? '', /templates\/docs\/task-quality-log\.md/);
    });
});

void test('checkQualityLog: unreadable path (directory in place of file) → warn, does not throw (AC-9)', () => {
    withTempDir(dir => {
        const docsDir = path.join(dir, 'docs');
        fs.mkdirSync(docsDir, { recursive: true });
        fs.mkdirSync(path.join(docsDir, 'task-quality-log.md')); // directory, not a file — read throws EISDIR
        assert.doesNotThrow(() => {
            assert.equal(checkQualityLog(dir).status, 'warn');
        });
    });
});
```

The last case is the spec-review nit's target — it's now named and colocated with the AC-3/4/5 cases rather than left implicit.

Verify: `npm test -- tests/cli.test.ts` (or full `npm test`) passes with all five new cases green.

### Step 4: `docs/codebase-map.md`

Files: `docs/codebase-map.md`

1. Add a new row for the writer module (currently absent — only the doc artifact itself has a row, at the existing `docs/task-quality-log.md` line). Place it near the other `scripts/run-task/*` rows (e.g. next to the Heartbeat monitor / run-context rows):

   ```
   | Quality-log writer | `scripts/run-task/quality-log.ts` | `upsertQualityLogRow()` — fail-soft row upsert at `qa → done`; exports `CANON_LOG_HEADERS` and `locateLogTable()` (pure header-detection) consumed by `canon doctor`'s quality-log header check |
   ```

2. Update the existing `canon doctor` command row's description to mention the new check:

   ```
   | `canon doctor` command | `src/cli/commands/doctor.ts` | Point-in-time health check: active orchestrators, stale heartbeats, worktree state, canon discovery nudge, and `docs/task-quality-log.md` header validity |
   ```

Verify: `grep -n "quality-log.ts" docs/codebase-map.md` matches the new row; the doctor row mentions the quality-log check.

### Step 5: Full validation pass

Run in order:
1. `npm run lint`
2. `npm run type-check`
3. `npm test` (full suite)
4. `npm run docs-refs-check` (this task edits `docs/codebase-map.md`)
5. `npm run build`, then confirm `git diff --exit-code -- dist/` — stage whatever `dist/` delta the fresh build produces (at minimum `dist/cli/index.js`, since `doctor.ts` changed and newly imports `quality-log.ts`; `dist/scripts/run-task.js` may or may not change).

`npm run sync-templates:check` is not applicable — none of the edited files are in `CANON_OWNED`/`DELIMITED`.

## Testing Plan

- **Unit**: 5 new cases in `tests/cli.test.ts` (Step 3) covering AC-3/4/5/9, plus a reordered-headers pass case for AC-4's "any order" clause. `tests/run-task-quality-log.test.ts` stays unchanged and must still pass (export-only change to the source it tests).
- **E2E**: N/A — no UI surface; Human Test Plan in the spec covers the manual `canon doctor` walkthrough.
- **Manual**: follow the spec's 4-step Human Test Plan (delete/restore/malform/restore `docs/task-quality-log.md`, observing `canon doctor` output each time).

## Rollback Plan

Additive, read-only check with no state or schema changes. Revert is a plain revert of the four source/doc files plus the regenerated `dist/` files — no data migration, no impact on any in-flight task or the writer's existing behavior.
