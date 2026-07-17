# Plan: allow-comma-separated-multipath-cells

> Author: Claude | Spec: `tasks/allow-comma-separated-multipath-cells/spec.md` | Spec review: approved_with_nits

## Spec-review nits incorporated into this plan

1. **BACKLOG historical tense.** `docs/BACKLOG.md`'s multi-table entry (line 47) is already `[x]` resolved/superseded by the 1.10.0 `parseAllTablesH3` fix — it is **not** an open problem. AC-9's spec text calling it "still-open" is a spec inaccuracy the reviewer flagged; this plan corrects it. Step 7 below rewords lines ~48/49/51 in plain historical tense (describing what the gate *used to* do) and does **not** add any "still open" framing — there is nothing open here to preserve.
2. **Markdown-link generic-annotation regression.** Added as an explicit new test case in Step 9 (AC-2 test group): `` [a.ts](https://example.test/a,b), [b.ts](b.ts) note `` — pins that a comma *inside a link URL* doesn't split the list and a trailing annotation works after a link token too, not just after a backtick token.

## Design: the new cell grammar

### Result shape (replaces the discriminated union)

`HandoffPathCellResult` (exported, `scripts/run-task/validation.ts`) changes from:

```ts
export type HandoffPathCellResult =
    | { kind: 'ok'; path: string }
    | { kind: 'malformed'; reason: string };
```

to a flat shape — no discriminant, since a single cell can now yield **both** valid paths and malformed entries at once (AC-5):

```ts
export type HandoffPathCellResult = {
    paths: string[];
    malformed: Array<{ token: string; reason: string }>;
};
```

- **Structural violation** (no recognized token, prose-prefixed, comma-less juxtaposition, dangling comma, token-in-annotation): `paths: []`, `malformed` has exactly one entry, `token` is the trimmed whole cell, `reason` is the structural message.
- **Fully valid cell**: `paths: ['a.ts', 'b.ts', ...]`, `malformed: []`.
- **Partial** (AC-5 — one sibling path fails per-path validation): `paths` contains the valid siblings, `malformed` contains one entry per failing token (`token` = that specific extracted path, `reason` = the existing per-path reason string e.g. wildcard/placeholder/absolute/traversal).

This is a full shape replacement (sanctioned by spec's Data Model Changes section — "exact shape is an implementation choice"). Every direct caller/test of `parseHandoffPathCell` must migrate from `.kind`/`.path`/`.reason` to `.paths`/`.malformed` — see Step 9 for the exact list of test blocks affected.

`validateExtractedPath` (the private per-path checker at `scripts/run-task/validation.ts:1217`, unexported) keeps its existing signature and logic completely unchanged (wildcard/placeholder/absolute/traversal checks) — only give its return type a new **local, non-exported** alias (e.g. `type SinglePathValidation = { kind: 'ok'; path: string } | { kind: 'malformed'; reason: string }`) so it no longer collides with the redefined exported `HandoffPathCellResult`.

### Tokenizer algorithm

Replace the body of `parseHandoffPathCell` (currently `scripts/run-task/validation.ts:1160-1211`) with a sequential tokenizer. Two small helpers, private to the module:

```ts
function matchTokenAt(s: string, pos: number): { label: string; end: number } | null {
    if (s[pos] === '`') {
        const close = s.indexOf('`', pos + 1);
        if (close === -1) return null;
        return { label: s.slice(pos + 1, close), end: close + 1 };
    }
    if (s[pos] === '[') {
        const labelClose = s.indexOf(']', pos + 1);
        if (labelClose === -1 || s[labelClose + 1] !== '(') return null;
        // Balanced-paren scan for the URL slot — handles nested parens in the
        // destination (AC-2) without ever reading the URL content itself.
        let depth = 0;
        let i = labelClose + 1;
        for (; i < s.length; i += 1) {
            if (s[i] === '(') depth += 1;
            else if (s[i] === ')') {
                depth -= 1;
                if (depth === 0) { i += 1; break; }
            }
        }
        if (depth !== 0) return null;
        const urlStart = labelClose + 2;
        const urlEnd = i - 1;
        if (urlEnd <= urlStart) return null; // empty URL `[foo]()` — not a valid token
        return { label: s.slice(pos + 1, labelClose), end: i };
    }
    return null;
}

// Require a NON-EMPTY URL slot so `[foo]()` doesn't count as "a link exists
// here" — mirrors the old mdLinkGroups regex's `[^)]+` requirement exactly.
function containsToken(s: string): boolean {
    return /`[^`]+`/.test(s) || /\[[^\]]+\]\([^)]+\)/.test(s);
}
```

Main function:

```ts
export function parseHandoffPathCell(cell: string): HandoffPathCellResult {
    const trimmed = cell.trim();
    if (!trimmed) {
        return { paths: [], malformed: [{ token: trimmed, reason: 'empty cell' }] };
    }

    const first = matchTokenAt(trimmed, 0);
    if (!first) {
        // Prose-prefixed backtick/link (`AC-9: \`sitemap.xml\` regenerated`) gets a
        // more specific message than "no recognized path" — preserves the exact
        // UX of today's prose-embedded-path rejection (spec Non-Goals).
        if (/`[^`]+`/.test(trimmed)) {
            return { paths: [], malformed: [{ token: trimmed, reason: `backticked path must be at the start of the cell, optionally followed by an annotation — got: ${snippet(trimmed)}` }] };
        }
        if (/\[[^\]]+\]\([^)]+\)/.test(trimmed)) {
            return { paths: [], malformed: [{ token: trimmed, reason: `markdown link must be at the start of the cell — got: ${snippet(trimmed)}` }] };
        }
        return { paths: [], malformed: [{ token: trimmed, reason: `no recognized path — first column must be \`backtick-path\` or [markdown-link](url): ${snippet(trimmed)}` }] };
    }

    const tokens = [first];
    let pos = first.end;
    for (;;) {
        const commaMatch = /^\s*,\s*/.exec(trimmed.slice(pos));
        if (!commaMatch) break;
        const afterComma = pos + commaMatch[0].length;
        const next = matchTokenAt(trimmed, afterComma);
        if (!next) {
            return { paths: [], malformed: [{ token: trimmed, reason: `comma must be followed by another path token — got: ${snippet(trimmed)}` }] };
        }
        tokens.push(next);
        pos = next.end;
    }

    const rest = trimmed.slice(pos);
    if (containsToken(rest)) {
        const restTrimmed = rest.replace(/^\s+/, '');
        if (restTrimmed.startsWith('`') || restTrimmed.startsWith('[')) {
            // Juxtaposed directly against the previous token, no comma at all.
            return { paths: [], malformed: [{ token: trimmed, reason: `path tokens must be comma-separated — got: ${snippet(trimmed)}` }] };
        }
        // Prose sits between the previous token and this one (AC-4a), OR this
        // token trails what looked like an annotation (AC-4c). Same underlying
        // bug — an extra path silently reinterpreted as prose — same reason class.
        return { paths: [], malformed: [{ token: trimmed, reason: `extra path token found — join it with a comma into the list, not left as prose or trailing annotation: ${snippet(trimmed)}` }] };
    }

    const paths: string[] = [];
    const malformed: Array<{ token: string; reason: string }> = [];
    for (const t of tokens) {
        const validated = validateExtractedPath(t.label.trim());
        if (validated.kind === 'ok') paths.push(validated.path);
        else malformed.push({ token: t.label.trim(), reason: validated.reason });
    }
    return { paths, malformed };
}
```

Trace through every AC to confirm this is correct before implementing further:

- **AC-1** `` `a.ts`, `b.ts` `` → two backtick tokens, comma-joined, empty rest → `paths: ['a.ts','b.ts']`, `malformed: []`.
- **AC-2** mixed kinds and nested-paren URL list: the balanced-paren scan in `matchTokenAt` consumes the whole `(...)` span including inner `(x)`, so the first link's `end` lands correctly after its own closing paren, and the tokenizer's comma-lookup starts from there — nesting never leaks into "is there a separator" decisions.
- **AC-3** trailing annotation, with or without a comma inside it: `rest` after the last token has no backtick/link substring, so `containsToken(rest)` is false → accepted as prose regardless of internal commas.
- **AC-4(a)/(c)** prose/extra-token cases land in the `extra path token found` branch (rest contains a token, but doesn't start with one after trimming).
- **AC-4(b)** juxtaposed tokens land in the `must be comma-separated` branch (rest starts with a token immediately).
- **AC-4(d)** dangling comma / comma-then-prose is caught **inside** the comma loop, when `matchTokenAt` fails right after a matched comma — never reaches the `rest` checks at all.
- **AC-5** per-path failures: tokenization succeeds structurally (all tokens comma-joined), so we reach the final per-token loop; a failing sibling contributes to `malformed`, a passing one to `paths` — both from the *same* call.
- **AC-6** `` `a,b.ts` `` — a single backtick token; `matchTokenAt` finds the *first* backtick after the opening one as the label boundary, so the internal comma never becomes a separator (separators are only recognized *between* tokens, never scanned for inside a token's span).
- **AC-14** — no change needed to the algorithm; `collectUnscannedTableHits` just needs to iterate `result.paths` (see Step 3).

## Implementation steps

### Step 1 — Rewrite `parseHandoffPathCell` in `scripts/run-task/validation.ts`

- Replace lines 1144-1211 (`HandoffPathCellResult` type + `parseHandoffPathCell` body) with the design above.
- Add the two private helpers (`matchTokenAt`, `containsToken`) near `parseHandoffPathCell`, following the existing placement convention (helpers like `snippet` already live right after the function at line 1213).
- Update `validateExtractedPath` (line 1217) to return a new **unexported** type alias instead of the now-redefined `HandoffPathCellResult` (see Design section). Its internal logic (lines 1218-1256) is unchanged.
- Rewrite the docstring above `parseHandoffPathCell` (currently lines 1148-1159) to describe the new grammar: one-or-more comma-separated tokens, optional trailing annotation, per-path validation applied independently, structural violations reported with a single reason and zero paths. Explicitly state *why* the old strictness (reject on sight) is gone: extracting the full list removes the silent-drop failure mode that motivated it, while per-path validation still catches wildcards/placeholders/absolute/traversal on every extracted path.

### Step 2 — Delete `extractHandoffPath` (AC-8)

- Remove the function at `scripts/run-task/validation.ts:1258-1266` (the `/** Lenient wrapper ... */` block plus the function body) entirely. Zero non-test callers confirmed by grep across `scripts/` and `src/`.
- After Step 9's test deletions, confirm `grep -rn "extractHandoffPath" scripts/ src/ tests/` returns zero hits.

### Step 3 — Update the three call sites inside `validation.ts`

All three currently branch on `result.kind === 'ok'` and read a singular `.path`. Change each to iterate the new `.paths` / `.malformed` arrays:

**`parseHandoffChangesRows`** (`scripts/run-task/validation.ts:1068-1098`, the per-row loop at ~1086-1095):

```ts
const result = parseHandoffPathCell(firstColumn);
for (const p of result.paths) files.add(p);
for (const m of result.malformed) {
    malformed.push({ cell: firstColumn.trim(), reason: m.reason });
}
```

Also update its docstring (lines 1036-1067): the "combined rows like `` `a.ts`, `b.ts` `` (parser picked the first backtick and silently dropped the rest...)" bullet in the "Malformed covers the failure classes..." list (~1058-1062) must be removed or reworded — that failure class no longer exists as a rejection; it's now the accepted case. Keep the other three bullets (prose-with-embedded-paths, wildcards, template placeholders) — those are still rejected.

**`parseAffectedFilesFromSpec`** (`scripts/run-task/validation.ts:1100-1142`, the per-row loop at ~1127-1138): identical pattern change.

**`collectUnscannedTableHits`** (`scripts/run-task/validation.ts:1330-1345`):

```ts
for (const row of table.rows) {
    const firstColumn = Object.values(row)[0] ?? '';
    const parsed = parseHandoffPathCell(firstColumn);
    for (const path of parsed.paths) {
        const where = `'${table.heading ?? '(no heading)'}' (first column header '${firstHeader}')`;
        const existing = hits.get(path) ?? [];
        if (!existing.includes(where)) existing.push(where);
        hits.set(path, existing);
    }
}
```

This satisfies AC-14 automatically — iterating `parsed.paths` retains every path in a comma cell, not just the first.

### Step 4 — Reword the `autoCommitCode` die message in `scripts/run-task/main.ts`

Lines 433-440 currently:

```ts
if (allMalformed.length > 0) {
    const lines = allMalformed.map(m => `    [${m.taskId}] '${m.cell}': ${m.reason}`);
    splitCli.die(
        `Auto-commit aborted: handoff.md Changes table has malformed rows.\n` +
        lines.join('\n') +
        `\n  Fix each row to one path per line in the form \`path/to/file.ext\` (or [path/to/file.ext](url)),\n` +
        `  then re-run. Combined paths, wildcards, and unfilled \`<placeholder>\` rows are not accepted.`
    );
}
```

Change the trailing two lines to describe the accepted format instead of "one path per line":

```ts
        `\n  Fix each row to a comma-separated list of paths in the form \`path/to/file.ext\` (or [path/to/file.ext](url)),\n` +
        `  optionally followed by a short note after the last path. Wildcards and unfilled \`<placeholder>\` rows are not accepted.`
```

No other logic in `autoCommitCode` changes — it already just forwards whatever `parseHandoffChangesRows` reports.

### Step 5 — `.canon/templates/handoff.md` (AC-10)

Two notes need rewriting; both currently say "one path per row" is the only format. Edit the **root** file only — the pre-commit sync hook regenerates `templates/.canon/templates/handoff.md` from it (do not hand-edit the mirror; verify via `npm run sync-templates:check` at the end).

**Baseline `## Changes` note** (lines 7-13), replace the first two sentences of the blockquote (keep the "pre-flight coverage check reads rows ONLY from..." and "Deleting a file?" paragraphs unchanged — they're unaffected by this grammar change):

```
> One row per file changed — or a comma-separated list of files in the first column when they're tightly coupled (e.g. a canon-managed root file with its `templates/` mirror, or a generated artifact with its source script). The first column holds one or more tokens — each either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — separated by commas, with an optional short note after the last token (e.g. `` `a.ts`, `b.ts` regenerated ``). No wildcards, no unfilled `<placeholder>` text. Group only files that change together for the same reason; unrelated files read better on separate rows.
```

**Per-iteration `### Changes` note** (lines 93-95):

```
> One row per file changed in this iteration, or a comma-separated list when files are tightly coupled — see the baseline Changes note above for the grouping guidance and token format. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)
```

Confirm neither note (nor any other doc-example path you add) invents a new example path that would trip `docs-refs-check` — reuse the existing `path/to/file.ext` placeholder convention already in the template, don't introduce a real-looking new path.

### Step 6 — `docs/codebase-map.md` line 54 (freshness fix)

Root-only doc, not in `CANON_OWNED` — **no** `templates/` mirror row for this edit (already correctly reflected in spec's Affected Files).

Change line 54 from:

```
| Handoff Changes-table parser | `scripts/run-task/validation.ts` | Regex-based; extracts backtick-wrapped paths |
```

to:

```
| Handoff Changes-table parser | `scripts/run-task/validation.ts` | Regex-based; extracts comma-separated backtick-path / markdown-link tokens per cell |
```

### Step 7 — `docs/BACKLOG.md` (AC-9)

The entry at line 47 is **already** `[x]` resolved/superseded — do not add or preserve any "still open" framing for the multi-table problem; it isn't open. Reword only the stale one-path-per-cell phrasing in three spots, keeping everything else (including the resolved-status framing) exactly as-is:

- **Line 48**, change `` `parseHandoffPathCell` rejects >1 backtick `` (present tense) to past tense reflecting the parser's behavior *at the time this entry was filed*, e.g.: `` `parseHandoffPathCell` rejected more than one path per cell `` — and adjust the surrounding verb tense in that sentence to match ("The gate *did* warn on multi-path *cells*... but was silent about whole unreachable tables, so the failure presented as...").
- **Line 49**, drop the now-inaccurate `(one path per row)` parenthetical from the proposed warn-message text — the sentence reads fine without it: `...consolidate into ONE contiguous table. Rows in tables 2+ are NOT in the allow-list.\``.
- **Line 51**, change `write \`### Affected Files\` as ONE contiguous single-path-per-row table` to `write \`### Affected Files\` as ONE contiguous table` (drop `single-path-per-row`; the rest of the sentence — directory-form guidance — is unaffected).

Do **not** touch lines 789-790 (the deletion-handling entry) — it describes the markdown-link-for-deletions workaround, which this task doesn't change, and it doesn't contain any of the retired phrases anyway.

After editing, run: `grep -rnE "multiple paths in one cell|one path per (row|line)|single-path-per-row|no combined paths|rejects >1 backtick" scripts/ src/ tests/ docs/ .canon/ templates/ .github/` — expect zero hits (excluding `tasks/`, which is out of scope per the spec).

### Step 8 — Rebuild dist (AC-12)

Run `npm run build` after all source changes land (Steps 1-4 touch `scripts/run-task/validation.ts` and `scripts/run-task/main.ts`, both bundled into `dist/cli/index.js` and `dist/scripts/run-task.js`). Commit the resulting `dist/` diff — CI enforces `git diff --exit-code -- dist/`.

### Step 9 — `tests/run-task-validation.test.ts` rewrite

**(a) Delete the five `extractHandoffPath` tests** (AC-8) and remove `extractHandoffPath` from the import list at line 31:

- `extractHandoffPath: backtick-quoted path` (1229-1232)
- `extractHandoffPath: markdown-link path` (1234-1237)
- `extractHandoffPath: rejects multiple paths in a single cell (combined row)` (1239-1246)
- `extractHandoffPath: markdown-link URL with parens still captures the path` (1325-1337)
- `extractHandoffPath: returns null for no recognized format` (1339-1342)

The nested-parens regression these covered (`[src/foo.ts](/tmp/build(foo)/src/foo.ts)`) is preserved by folding it into the AC-2 list-context test below (per spec AC-2's explicit note) plus a single-token version alongside the other single-path `parseHandoffPathCell` tests.

**(b) Migrate every remaining direct `parseHandoffPathCell` test from `.kind`/`.path`/`.reason` to `.paths`/`.malformed`.** These existing blocks all need a shape rewrite (behavior unchanged, only the accessor pattern changes):

- `parseHandoffPathCell rejects markdown links with empty URL` (1248-1254) → assert `result.paths.length === 0 && result.malformed.length === 1`.
- `parseHandoffPathCell rejects absolute paths` (1256-1268) → assert `result.paths` is `[]`, `result.malformed[0].reason` matches `/absolute path/` (both posix and windows sub-cases).
- `parseHandoffPathCell rejects parent-directory traversal paths` (1270-1278) → same pattern, `/parent-directory traversal/`.
- `parseHandoffPathCell allows bracketed filenames like src/foo[beta].ts` (1280-1286) → assert `result.paths` deep-equals `['src/foo[beta].ts']`, `result.malformed` is `[]`.
- `parseHandoffPathCell surfaces the specific rejection reason` (1288-1323) → keep the wildcard, placeholder, prose-prefix, and valid-single-path sub-cases (rewriting each to the new shape; the prose-prefix sub-case (~1312) still asserts a reason matching `/at the start of the cell/` — unchanged text). **Flip** the first sub-case (1290-1296, `` `src/a.ts`, `src/b.ts` ``): it now must assert `result.paths` deep-equals `['src/a.ts', 'src/b.ts']` and `result.malformed` is `[]`, not a malformed rejection.

**(c) Add new `parseHandoffPathCell` unit tests** for every AC not already covered by (b):

- **AC-1**: `` `a.ts`, `b.ts` `` → `paths: ['a.ts','b.ts']`, `malformed: []`.
- **AC-2**:
  - `` [a.ts](a.ts), `b.ts` `` → `paths: ['a.ts','b.ts']` (mixed token kinds).
  - `` [a.ts](/tmp/build(x)/a.ts), [b.ts](b.ts) `` → `paths: ['a.ts','b.ts']` (nested-paren boundary — this is the case that used to be covered by the deleted `extractHandoffPath: markdown-link URL with parens` test, now exercised in list context).
  - New regression from spec review: `` [a.ts](https://example.test/a,b), [b.ts](b.ts) note `` → `paths: ['a.ts','b.ts']`, confirms a comma *inside* a link URL doesn't split the list and a trailing annotation works after a link token (not just after a backtick token).
- **AC-3**: `` `a.ts`, `b.ts` + mirrors `` → `paths: ['a.ts','b.ts']`. And `` `a.ts` fixes gate, message `` → `paths: ['a.ts']` (comma inside the annotation doesn't create a phantom token).
- **AC-4** — four sub-cases, each asserting `paths: []` and a distinct `malformed[0].reason`:
  - (a) `` `a.ts` regenerated, `b.ts` `` → reason matches `/comma-joined/` (the shared prose/extra-token bucket).
  - (b) `` `a.ts` `b.ts` `` → reason matches `/comma-separated/`.
  - (c) `` `a.ts`, `b.ts` and `c.ts` `` **and** `` `a.ts` see [b.ts](b.ts) `` → both reasons match `/comma-joined/` — assert the cell does **not** parse to a subset (`paths` must be `[]`, not `['a.ts']` or `['a.ts','b.ts']`), pinning the no-silent-drop invariant.
  - (d) `` `a.ts`, `` **and** `` `a.ts`, `b.ts`, plus mirrors `` → both reasons match `/comma must be followed by another path token/`.
- **AC-5**: `` `a.ts`, `src/*.ts` `` → `paths: ['a.ts']`, `malformed: [{ reason: /wildcard not allowed.*src\/\*\.ts/ }]`. One representative sibling each for placeholder (`` `a.ts`, `<b.ts>` ``), absolute (`` `a.ts`, `/etc/passwd` ``), and traversal (`` `a.ts`, `../b.ts` ``) — same pattern, asserting the valid sibling still lands in `paths` and the specific reason names the failing token.
- **AC-6**: `` `a,b.ts` `` → `paths: ['a,b.ts']`, `malformed: []`.

**(d) `parseHandoffChangesRows surfaces malformed rows from baseline + iteration Changes tables`** (1360-1389): the iteration-table fixture row `` `src/iter.ts`, `src/also-iter.ts` `` (line 1378) is now **valid**, not malformed. Replace it with a genuinely malformed row so this test still covers "malformed rows across baseline + iteration tables" (e.g. `` `src/iter.ts` and `src/also-iter.ts` `` — prose-style juxtaposition) and update the assertions: `malformed.length` stays `3`, the third `reasons` match changes from `/multiple paths in one cell/` to whatever reason string case (a)/(b) above produces for that fixture's exact shape. Do **not** just delete this coverage — add a *separate* new test (or extend an existing AC-1 test) asserting the comma-accepted case flows through `parseHandoffChangesRows` end-to-end (both paths land in `files`, `malformed` empty for that row).

**(e) AC-7** — add a `parseAffectedFilesFromSpec` test with a comma-separated cell in a `### Affected Files` table under `## Design` (following the `withTempTaskSpec` pattern used by the existing test at line 904), and confirm the same works under `## Amendment` (can extend the existing amendment tests at 1024+ rather than adding a wholly new one, since those already exercise the Amendment-section code path).

**(f) AC-14** — add a `collectUnscannedTableHits` test: a handoff whose only file-list table sits under a non-coverage heading (mirror the existing test's shape at 1545-1565) with a row `` `a.ts`, `b.ts` ``, asserting `hits.get('a.ts')` and `hits.get('b.ts')` are **both** present (red on a `paths[0]`-only implementation).

### Step 10 — `tests/task-cli.test.ts` rewrite (AC-13)

The existing test `task accept refuses malformed handoff rows without --force` (lines 1311-1341) fixtures the now-valid comma row `` `src.txt`, `extra.txt` ``. Split into two tests:

**(a) New acceptance test** — same fixture shape (both files committed to the work tree), but the comma row must now flow through `taskAccept` without throwing:

```ts
void test('task accept accepts a comma-separated multi-path Changes row', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `src.txt`, `extra.txt` | grouped — tightly coupled |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(work, 'src.txt'), 'work\n', 'utf8');
        fs.writeFileSync(path.join(work, 'extra.txt'), 'work\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'implement']);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.doesNotThrow(() => taskAccept(['accept-task'], 'implement'));
                const updated = readStatusFile(taskDir);
                assert.equal(updated.phases.implement?.operator_accepted, true);
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
```

(Mirrors the `readStatusFile`/`updated.phases.implement?.operator_accepted` assertion style already used by the neighboring `task accept exempts gitignored handoff entries...` test at line ~1343+.)

**(b) Retained refusal test**, same name (`task accept refuses malformed handoff rows without --force`) and same `/malformed Changes rows/` assertion, but with a **genuinely malformed** fixture (prose between tokens, not a comma list):

```ts
void test('task accept refuses malformed handoff rows without --force', () => {
    const { root, work, tasksRoot, taskDir } = setupAcceptRepo();
    try {
        writeAcceptTaskStatus(taskDir);
        fs.writeFileSync(path.join(taskDir, 'handoff.md'), [
            '# Implementation Handoff: accept-task',
            '',
            '## Changes',
            '',
            '| File | What Changed |',
            '|---|---|',
            '| `src.txt` and then `extra.txt` | prose between tokens — malformed |',
            '',
        ].join('\n'), 'utf8');
        fs.writeFileSync(path.join(work, 'src.txt'), 'work\n', 'utf8');
        fs.writeFileSync(path.join(work, 'extra.txt'), 'work\n', 'utf8');
        git(work, ['add', '-A']);
        git(work, ['commit', '-m', 'implement']);

        withCwd(work, () => {
            withEnv({ CANON_TASKS_DIR_OVERRIDE: tasksRoot, CANON_SKIP_PHASE_GATE: '1' }, () => {
                assert.throws(
                    () => taskAccept(['accept-task'], 'implement'),
                    /malformed Changes rows/,
                );
            });
        });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
```

Both `src.txt` and `extra.txt` must exist and be committed in **both** fixtures so the diff→handoff coverage check itself doesn't fail for an unrelated reason (per AC-13).

### Step 11 — Full validation pass

Run in order, fixing forward on any failure before moving to the next:

1. `npm run lint`
2. `npm run type-check`
3. `npm test` — full suite (`tests/run-task-validation.test.ts`, `tests/task-cli.test.ts`, and everything else; watch for any other test file that happens to import `extractHandoffPath` or construct a `HandoffPathCellResult`-shaped literal — grep to be sure none were missed: `grep -rln "extractHandoffPath\|HandoffPathCellResult" tests/`)
4. `npm run build` — commit `dist/cli/index.js`, `dist/scripts/run-task.js`
5. `npm run sync-templates:check` — confirms `templates/.canon/templates/handoff.md` mirror regenerated correctly from Step 5's edit
6. `npm run docs-refs-check` — required because this task edits `docs/BACKLOG.md`, `docs/codebase-map.md`, `.canon/templates/handoff.md`, and its `templates/` mirror
7. Final grep sweep (AC-9): `grep -rnE "multiple paths in one cell|one path per (row|line)|single-path-per-row|no combined paths|rejects >1 backtick" scripts/ src/ tests/ docs/ .canon/ templates/ .github/` → zero hits
8. Final grep sweep (AC-8): `grep -rn "extractHandoffPath" scripts/ src/ tests/` → zero hits

## Notes for the handoff

- No changes to `scripts/run-task/prompts/helpers.ts`, `scripts/run-task/prompts/index.ts`, or any prompt template, and `tests/run-task-prompts.golden.json` must not change (spec Non-Goals) — this plan touches none of those files.
- No changes to `parseDiffNameStatus` or rename-pair handling — renames never come from cell parsing (spec Non-Goals).
- `.claude/skills/canon-*` are out of scope (spec Non-Goals) — do not touch.
