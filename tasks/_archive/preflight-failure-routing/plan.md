# Plan: preflight-failure-routing

## Overview

Three buckets replace the undifferentiated BLOCKED block: **format** (fix the handoff), **regression** (fix the code — you broke `<check>`), and **blocked** (infra unavailable → halt for human triage). The change spans four layers:
1. A new classification helper + suffix-tolerant cited-file extractor + laundering guard in `validation.ts` (with a `*FromData` test seam)
2. Bucket-specific routing and `review.md` framing in `code-review.ts`
3. Bucket-neutral prompt copy in `prompts/index.ts` + `implement-revisions.md`
4. Declared-canon extensions in `CLAUDE.md`, `AGENTS.md`, `code-review-round-1.md`, `implement.md`

---

## Step 1 — `validation.ts`: Add `extractCitedFilePaths` (AC-8 suffix tolerance)

**File**: `scripts/run-task/validation.ts` — add before `isPassResult`

Export a pure function that extracts path-like tokens from freeform Notes text and strips trailing `:line`/`:line:col` suffixes so `e2e/specs/editor.spec.ts:1231` matches `e2e/specs/editor.spec.ts`:

```ts
export function extractCitedFilePaths(notes: string): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const token of notes.split(/\s+/)) {
        // Strip trailing :NNN or :NNN:NNN (line / line:col references)
        const stripped = token.replace(/:[\d]+(?::[\d]+)?$/, '');
        // Keep only tokens that look like paths (contain a slash or a dot-extension)
        if (!stripped || !(stripped.includes('/') || /\.\w+$/.test(stripped))) continue;
        if (!seen.has(stripped)) { seen.add(stripped); result.push(stripped); }
    }
    return result;
}
```

---

## Step 2 — `validation.ts`: Laundering guard in `validateHandoffAgainstSpec` (AC-1, AC-2)

**File**: `scripts/run-task/validation.ts` — `validateHandoffAgainstSpec` (~L455)

Add `changedFiles?: ReadonlySet<string>` as the last parameter. In the `isUnrelatedFailResult` branch, replace the current accept logic with:

```ts
if (isUnrelatedFailResult(row.result)) {
    const hasFileRef = /\w+\.\w+|:\d+/.test(row.notes ?? '');
    if (!hasFileRef) {
        issues.push(`Validation Required item marked Fail – unrelated needs a specific test/file reference in Notes (e.g., \`src/foo.test.ts\` or \`file:42\`; vague prose like "pre-existing flake" is rejected): ${required}`);
        continue;
    }
    // Laundering guard (AC-1): a file this task changed cannot be called "unrelated."
    if (changedFiles && changedFiles.size > 0) {
        const citedPaths = extractCitedFilePaths(row.notes ?? '');
        if (citedPaths.some(p => changedFiles.has(p))) {
            issues.push(
                `Validation Required item ${required} marked "Fail – unrelated" but the cited file is ` +
                `in this task's changed files — a failure in a file you modified is yours to fix. ` +
                `If genuinely unrelated, cite a file outside your diff. (cited: ${row.notes})`,
            );
            continue;
        }
    }
    continue; // genuinely unrelated — accepted; Claude assesses credibility in Stage 1
}
```

---

## Step 3 — `validation.ts`: Thread `changedFiles` through `validateHandoff`

**File**: `scripts/run-task/validation.ts` — `validateHandoff` (~L71)

Change signature to `validateHandoff(taskId: string, changedFiles?: ReadonlySet<string>): string[]`. Pass `changedFiles` into `validateHandoffAgainstSpec`:

```ts
issues.push(...validateHandoffAgainstSpec(specPath, handoffPath, latestResults, changedFiles));
```

The existing `validateHandoff` call sites in tests pass no `changedFiles` and remain correct (laundering guard skips when `changedFiles` is absent or empty).

---

## Step 4 — `validation.ts`: Add `BlockerBucket` types and `classifyPreflightBlockersFromData` (AC-3a/b/c, AC-6, AC-9)

**File**: `scripts/run-task/validation.ts` — add after the `extractCitedFilePaths` function

### 4a. Export types

```ts
export type BlockerBucket = 'format' | 'regression' | 'blocked';
export type ClassifiedBlocker = { bucket: BlockerBucket; message: string };

export type PreflightClassificationData = {
    latestResults: Map<string, ValidationOutcomeRow>;
    requiredChecks: string[] | null;    // null = section missing from spec
    changedFiles: ReadonlySet<string>;
    acCoverageIssues: string[];          // from checkAcCoveragePlaceholders
    changesTableIssues: string[];        // from parseHandoffChangesRows malformed entries
    bundleDiffIssues: string[];          // from verifyHandoffAgainstDiff (always format-class)
    handoffMissing: boolean;
};
```

### 4b. `classifyPreflightBlockersFromData` — pure `*FromData` seam

This function mirrors the `validateHandoff` / `validateHandoffAgainstSpec` classification logic but assigns a bucket to every issue. No I/O.

```ts
export function classifyPreflightBlockersFromData(data: PreflightClassificationData): ClassifiedBlocker[] {
    const f = (m: string): ClassifiedBlocker => ({ bucket: 'format', message: m });
    const r = (m: string): ClassifiedBlocker => ({ bucket: 'regression', message: m });
    const b = (m: string): ClassifiedBlocker => ({ bucket: 'blocked', message: m });
    const out: ClassifiedBlocker[] = [];

    if (data.handoffMissing) return [f('handoff.md not found')];

    for (const msg of data.acCoverageIssues) out.push(f(msg));
    for (const msg of data.changesTableIssues) out.push(f(msg));
    for (const msg of data.bundleDiffIssues) out.push(f(msg));

    const { requiredChecks, latestResults, changedFiles } = data;

    if (requiredChecks === null) {
        out.push(f('Validation Required section is missing from spec.md'));
        return out;
    }
    if (requiredChecks.length === 0) {
        out.push(f(
            'Validation Required section in spec.md has no `[x]`-checked items — ' +
            'mark at least one required check `[x]`.',
        ));
        return out;
    }

    for (const required of requiredChecks) {
        const canonical = canonicalizeValidationCheck(required);
        const row = latestResults.get(canonical);
        if (!row) {
            const present = [...latestResults.keys()];
            const hint = present.length > 0
                ? ` Handoff has rows for: ${present.join(', ')}.`
                : ' Handoff has no Validation Outcomes rows.';
            out.push(f(`Validation Required item missing from handoff.md: ${required}.${hint}`));
            continue;
        }
        if (isPendingResult(row.result)) {
            out.push(f(`Validation Required item present but unfilled: ${required}.`));
            continue;
        }
        if (isNAResult(row.result) || isNotConfiguredResult(row.result)) {
            out.push(f(`Validation Required item marked ${row.result}: ${required}`));
            continue;
        }
        if (isDeferredBySpecResult(row.result)) {
            if (!/spec[:.-]/i.test(row.notes ?? '')) {
                out.push(f(`Validation Required item marked deferred_by_spec without spec citation: ${required}`));
            }
            continue;
        }
        if (isHumanPendingResult(row.result)) continue;
        if (isBlockedResult(row.result)) {
            const note = row.notes ? ` (${row.notes})` : '';
            out.push(b(`Validation Required item marked blocked: ${required}${note} — triage required`));
            continue;
        }
        if (isUnrelatedFailResult(row.result)) {
            const hasFileRef = /\w+\.\w+|:\d+/.test(row.notes ?? '');
            if (!hasFileRef) {
                out.push(f(`Validation Required item marked Fail – unrelated needs a file reference in Notes: ${required}`));
                continue;
            }
            if (changedFiles.size > 0) {
                const citedPaths = extractCitedFilePaths(row.notes ?? '');
                if (citedPaths.some(p => changedFiles.has(p))) {
                    out.push(r(
                        `Validation Required item ${required} marked "Fail – unrelated" but the cited file is in this task's changed files — ` +
                        `fix the failure or cite a file outside your diff (cited: ${row.notes})`,
                    ));
                    continue;
                }
            }
            continue; // accepted — genuinely unrelated
        }
        if (!isPassResult(row.result)) {
            const note = row.notes ? ` (${row.notes})` : '';
            out.push(r(`Validation Required item did not pass: ${required} — ${row.result}${note}`));
        }
    }
    return out;
}
```

### 4c. `classifyPreflightBlockers` — live wrapper

```ts
export function classifyPreflightBlockers(
    taskId: string,
    changedFiles: ReadonlySet<string>,
    bundleDiffIssues: string[],
): ClassifiedBlocker[] {
    const handoffPath = path.join(taskDirFor(taskId), 'handoff.md');
    const specPath = path.join(taskDirFor(taskId), 'spec.md');
    let content: string;
    try {
        content = fs.readFileSync(handoffPath, 'utf8');
    } catch {
        return classifyPreflightBlockersFromData({
            latestResults: new Map(),
            requiredChecks: null,
            changedFiles,
            acCoverageIssues: [],
            changesTableIssues: [],
            bundleDiffIssues,
            handoffMissing: true,
        });
    }
    const latestResults = computeLatestValidationResults(content);
    const requiredChecks = parseValidationRequiredChecks(specPath);
    const acCoverageIssues = checkAcCoveragePlaceholders(content);
    const { malformed } = parseHandoffChangesRows(taskId);
    const changesTableIssues = malformed.map(e => `Changes table row '${e.cell}': ${e.reason}`);
    return classifyPreflightBlockersFromData({
        latestResults,
        requiredChecks,
        changedFiles,
        acCoverageIssues,
        changesTableIssues,
        bundleDiffIssues,
        handoffMissing: false,
    });
}
```

Export `classifyPreflightBlockers`, `classifyPreflightBlockersFromData`, `BlockerBucket`, `ClassifiedBlocker`, `PreflightClassificationData` from the module.

---

## Step 5 — `code-review.ts`: Compute `changedFiles`, classify, route by bucket (AC-3a/b/c, AC-4, AC-5, AC-6)

**File**: `scripts/run-task/phases/code-review.ts`

### 5a. Imports

Add `getAffectedFiles` to the existing `../git.js` import.  
Add `classifyPreflightBlockers`, `ClassifiedBlocker` to the existing `../validation.js` import.  
Remove `validateHandoff` from the import (it is superseded in this file by `classifyPreflightBlockers`).

### 5b. Compute `changedFiles` once before the pre-flight loop

After the `baseBranch` / `activeCwd` lines, add:
```ts
const changedFiles = new Set(getAffectedFiles(baseBranch, activeCwd));
```

`getAffectedFiles` uses three-dot diff semantics (what this branch contributed) — correct for the in-diff guard.

### 5c. Replace the pre-flight per-task loop

Change `preflightFailed` type to `Array<{ taskId: string; classified: ClassifiedBlocker[] }>`.

Replace:
```ts
const issues = validateHandoff(t.taskId);
if (issues.length > 0) preflightFailed.push({ taskId: t.taskId, issues });
```
With:
```ts
const classified = classifyPreflightBlockers(t.taskId, changedFiles, []);
if (classified.length > 0) preflightFailed.push({ taskId: t.taskId, classified });
```

### 5d. Fold bundle-level diff issues (format-class) into each task's classified list

Replace the current bundle-fold block with:
```ts
if (bundleIssues.length > 0) {
    const bundleClassified: ClassifiedBlocker[] = bundleIssues.map(msg => ({
        bucket: 'format' as const,
        message: msg,
    }));
    for (const taskId of taskIds) {
        const existing = preflightFailed.find(e => e.taskId === taskId);
        if (existing) {
            existing.classified = [...existing.classified, ...bundleClassified];
        } else {
            preflightFailed.push({ taskId, classified: bundleClassified });
        }
    }
}
```

### 5e. Replace the undifferentiated BLOCKED block with bucket-specific routing

Replace the entire `if (preflightFailed.length > 0)` block with the new logic below. Preserve:
- `## Validation Gate` heading name (AC-10 neutral prompt points here)
- `## Pre-Flight Rejection` heading name (same reason)
- No `## Round`-prefixed headings (would break `extractCheckedVerdict`)
- Append-not-overwrite behavior when a prior real review exists
- `taskPhasePreflightRejected` for format/regression routes (counter mechanic unchanged, AC-4)
- `autoBlockPhase` + `process.exit(2)` for blocked-only halt (AC-5)

**Priority rule (AC-6)**: compute `hasFixable` first:
```ts
const allClassified = preflightFailed.flatMap(e => e.classified);
const hasFixable = allClassified.some(b => b.bucket === 'format' || b.bucket === 'regression');
const isBlockedOnly = !hasFixable && allClassified.some(b => b.bucket === 'blocked');
```

**Blocked-only path (AC-5)**:
- Write a triage message to `review.md` under `## Validation Gate` (no "fix and resubmit" verdict)
- Call `autoBlockPhase(taskIds, 'code_review', worstTask.combined, reason)` with a message that says infrastructure was unavailable, re-implementation cannot resolve it, and how to recover (reset `phases.code_review.status = "pending"` and re-run)
- `process.exit(2)`

**Fixable path (AC-3a/b/c)**:

For each `{ taskId, classified }` in `preflightFailed`:
1. Partition into `formatIssues`, `regressionIssues`, `blockedIssues`
2. Build `review.md` block under `## Validation Gate` / `**BLOCKED — pre-flight rejected handoff before full review:**`:
   - **Format section** (if `formatIssues.length > 0`): `### Fix the handoff\n\n<bullet list>` — "fix your handoff, name the structural problem" framing
   - **Regression section** (if `regressionIssues.length > 0`): `### Fix the code\n\n<bullet list>\n\nYou broke one or more required checks. Fix the regression. If genuinely outside your changed files, record as \`Fail – unrelated\` with a specific file/line reference — only if the cited file is NOT in your diff.`
   - **Blocked note** (if `blockedIssues.length > 0` but fixable work also present): `### Infra note (address the above first)\n\n<bullet list>\n\nAddress the fixable items above; blocked rows will be re-evaluated on the next pre-flight.`
3. Verdict line: `- [x] **Changes requested** — address the items above and resubmit.`
4. Append-or-create `review.md` with the same logic as today (check `hasPriorRealReview`)
5. Call `taskPhasePreflightRejected(taskId, 'code_review')` (unchanged, AC-4)

Return `{ agent: 'claude', sessionId: null, exitCode: 0 }`.

---

## Step 6 — `prompts/index.ts`: Bucket-neutral copy (AC-10)

**File**: `scripts/run-task/prompts/index.ts` — `promptImplementRevisions`

### 6a. Drop "handoff" from `iterBanner`
```ts
// Before:
`[ITERATION ${iterationN} — addressing pre-flight handoff rejection (no Claude review yet)]`
// After:
`[ITERATION ${iterationN} — addressing pre-flight rejection]`
```

### 6b. Drop "handoff" from `handoffAppend`
```ts
// Before:
`## Iteration ${iterationN} — addressing pre-flight handoff rejection`
// After:
`## Iteration ${iterationN} — addressing pre-flight rejection`
```

### 6c. Replace `reviewLines` pre-flight text (bucket-neutral)
```ts
// Before:
`- \`${t.taskId}\` → read \`tasks/${t.taskId}/review.md\` (\`## Pre-Flight Rejection\` block lists handoff-format issues; no Claude review ran). Address every listed item — usually a malformed Validation Outcomes table or missing AC Coverage rows.`
// After:
`- \`${t.taskId}\` → read \`tasks/${t.taskId}/review.md\` (\`## Validation Gate\` / \`## Pre-Flight Rejection\` block). Follow whichever framing it carries: fix the handoff, fix the code, or both.`
```

---

## Step 7 — `implement-revisions.md` template: Bucket-neutral copy (AC-10)

**File**: `scripts/run-task/prompts/templates/implement-revisions.md`

Replace the `{{#hasPreflightFindings}}` … `{{/hasPreflightFindings}}` block with:

```
{{#hasPreflightFindings}}
Your prior iteration's handoff was rejected by the orchestrator's pre-flight gate **before any Claude review ran**. The rejection details are in `review.md` under `## Validation Gate` / `## Pre-Flight Rejection`.

Tasks with pre-flight rejection feedback:
{{{reviewLines}}}

For each task:
1. Read the pre-flight block in `tasks/<id>/review.md` and follow **whichever framing it carries**:
   - **"Fix the handoff"** items → fix `handoff.md` (Validation Outcomes rows, AC Coverage table, Changes table).
   - **"Fix the code"** items → a required check failed on a file you changed. Fix the regression, re-run the check, update the handoff.
   - Both framings may be present — address all items from both before resubmitting.
2. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}`. Include the delta: which items you addressed and how.
{{/hasPreflightFindings}}
```

---

## Step 8 — `CLAUDE.md`: Extend Stage 1 validation-gate rule (AC-7)

**File**: `CLAUDE.md` — Stage 1 validation-gate rule at line 113

After the existing sentence ending in "Missing or unexplained failure = Stage 1 fail.", add:

> Additionally, a `Fail – unrelated` entry citing a file the task itself modified is not valid — a failure in a file you changed is the task's to fix regardless of the label. The pre-flight gate enforces this deterministically; Stage 1 catches subtler cases where the file changed indirectly.

---

## Step 9 — `AGENTS.md`: Extend `Fail – unrelated` result-state rule (AC-7)

**File**: `AGENTS.md` — `Fail – unrelated` result-state rule at line 107

After the existing sentence ending in "an implausible explanation is a Stage 1 fail.", add:

> A `Fail – unrelated` entry whose cited file is in the task's branch diff is invalid — the pre-flight gate rejects it deterministically, and Stage 1 flags any that slip through.

---

## Step 10 — Prompt templates: Add in-diff clause (AC-7)

### 10a. `code-review-round-1.md` (~L29)

**File**: `scripts/run-task/prompts/templates/code-review-round-1.md`

After the line ending "assess whether the explanation is credible and the failure is genuinely outside the task's Affected Files.", add:

> A `Fail – unrelated` row that cites a file this task changed is not valid — flag it as `correctness bug`.

### 10b. `implement.md` (~L22)

**File**: `scripts/run-task/prompts/templates/implement.md`

After "Note the observed test name, file, line, and a one-line repro hint in handoff.md → Blockers (or "Validation Outcomes" Notes column with status `Fail – unrelated`), then continue.", add:

> `Fail – unrelated` is only valid for failures in files **outside your Affected Files**. A failure in a file you changed is yours to fix.

---

## Step 11 — Tests: `run-task-validation.test.ts` (AC-1, AC-2, AC-8, AC-9)

**File**: `tests/run-task-validation.test.ts`

Add the following test groups (use the existing `makeHandoff` / `makeSpec` helper patterns where they exist; otherwise build fixture strings inline):

**`extractCitedFilePaths`** (AC-8 prerequisites):
- `'e2e/specs/editor.spec.ts:1231'` → `['e2e/specs/editor.spec.ts']`
- `'src/foo.ts:42:7'` → `['src/foo.ts']`
- Multiple tokens: `'tests/a.test.ts:10 tests/b.test.ts:20'` → `['tests/a.test.ts', 'tests/b.test.ts']`
- No-path token `'some prose'` → `[]`

**`classifyPreflightBlockersFromData` — laundering guard** (AC-1, AC-2, AC-8):
- `Fail – unrelated` row, Notes = `'e2e/specs/editor.spec.ts:1231 (Editor flake)'`, file `'e2e/specs/editor.spec.ts'` IN `changedFiles` → one `regression` issue
- Same row, file NOT in `changedFiles` → no issue (AC-2: accept path preserved)
- `Fail – unrelated` row, Notes = `'e2e/specs/editor.spec.ts'` (no line suffix), file in `changedFiles` → `regression` issue (AC-8: suffix tolerance)

**`classifyPreflightBlockersFromData` — bucket assignment** (AC-3a/b/c, AC-5, AC-6, AC-9):
- Missing AC Coverage → single `format` blocker (AC-3a)
- Plain `Fail` row → single `regression` blocker (AC-3b)
- Malformed Changes row + plain `Fail` → one `format` + one `regression` (AC-3c: both framings)
- Single `blocked` row, no other blockers → single `blocked` blocker (AC-5)
- `blocked` row + `regression` row → one `blocked` + one `regression` (AC-6: not blocked-only)
- Empty `changedFiles`, `Fail – unrelated` with file ref → no issue (laundering guard skips when `changedFiles.size === 0`)

**`validateHandoffAgainstSpec` with `changedFiles`** (AC-1, AC-2 at the lower-level gate):
- In-diff `Fail – unrelated` (file in diff) → issue pushed (regression framing message text)
- Not-in-diff `Fail – unrelated` with valid ref → no issue (existing accept behavior)

---

## Step 12 — Tests: `run-task-prompts.test.ts` (AC-10)

**File**: `tests/run-task-prompts.test.ts` — existing test at line ~356

Replace the single `assert.match(output, /addressing pre-flight handoff rejection/)` assertion with:

```ts
// Banner: "handoff" dropped
assert.match(output, /addressing pre-flight rejection/);
assert.doesNotMatch(output, /addressing pre-flight handoff rejection/);
// Retired phrases must not appear (AC-10)
assert.doesNotMatch(output, /input-validation failure/);
assert.doesNotMatch(output, /Fix the handoff itself/);
assert.doesNotMatch(output, /Source-code changes are usually unnecessary/);
// Neutral authority: defers to review.md pre-flight block
assert.match(output, /review\.md/);
assert.match(output, /Validation Gate|Pre-Flight Rejection/);
```

---

## Step 13 — Regenerate prompt goldens (AC-7)

After steps 10a and 10b (template edits to `code-review-round-1.md` + `implement.md`), regenerate:

```bash
UPDATE_GOLDENS=1 npm test
```

The `promptCodeReview_round1` and `promptImplement` golden entries will have diffs. Commit the updated `tests/run-task-prompts.golden.json`.

If `promptImplementRevisions` golden shows a diff: investigate before committing — AC-10 changes only the pre-flight branch, which the golden does NOT render (it renders the review-findings branch). An unexpected diff there is a bug.

---

## Step 14 — Build artifacts

```bash
npm run build
```

`scripts/run-task/validation.ts` and `scripts/run-task/phases/code-review.ts` and `scripts/run-task/prompts/index.ts` all compile into `dist/scripts/run-task.js`. `validation.ts` also bundles into `dist/cli/index.js`. Commit both dist deltas.

---

## Step 15 — Sync templates and final validation

```bash
npm run sync-templates
```

Commit `templates/CLAUDE.md` and `templates/AGENTS.md` (synced from the root edits in steps 8–9).

```bash
npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check
```

All checks must pass clean. If `npm test` fails on a stale golden, re-run `UPDATE_GOLDENS=1 npm test` and verify the diff is expected before committing.

---

## Rollback Plan

No data migration. No new `status.json` fields. The changes are behavioral: routing and messaging in `code-review.ts`, new helpers in `validation.ts`, copy changes in prompts and templates. Reverting the commit reverts the behavior. In-flight tasks that hit a pre-flight rejection mid-pipeline are not affected by the routing change retroactively — they re-enter `code_review` from the top on re-run.

---

## Reroute Plan

### Context

Steps 1–15 of the original plan are implemented and committed. The reroute implements the **Amendment** section of `spec.md`: two targeted fixes to `validation.ts` that close the absolute-path and bare-basename bypass gaps in the `Fail – unrelated` laundering guard (AC-1a, AC-1b). No prompt templates, no canon docs, no routing logic, no counters change — this is a pure `validation.ts` + test delta.

The `approved_with_nits` amendment review flag: if Windows drive-letter path support is kept in scope (the spec amendment names it), AC-1a test coverage must include a drive-letter variant or explicitly scope it out.

### Delta

<!-- per-round append shape:
## Reroute Plan [Round N]
### Delta
- ...ordered steps for the amendment delta only...
-->

**Step R1 — `validation.ts`: Tighten `hasFileRef` regex (AC-1b)**

Two sites contain `const hasFileRef = /\w+\.\w+|:\d+/.test(row.notes ?? '')`:
- `validateHandoffAgainstSpec` — `isUnrelatedFailResult` branch (plan Step 2, ~L571)
- `classifyPreflightBlockersFromData` — same branch (plan Step 4b)

Change both to:
```ts
const hasFileRef = /\/\S+|:\d+/.test(row.notes ?? '');
```
This requires either a `/` path separator **or** a `:\d+` line reference. Effect:
- `editor.spec.ts` (no `/`, no `:\d+`) → `hasFileRef = false` → row rejected (AC-1b)
- `editor.spec.ts:1231` (has `:\d+`) → `hasFileRef = true` → proceeds to in-diff guard / Stage 1 (AC-1b: line-ref form still passes)
- `e2e/specs/editor.spec.ts` (has `/`) → `hasFileRef = true` → unchanged behavior
- `/abs/path/to/repo/e2e/specs/editor.spec.ts:1231` (has both) → `hasFileRef = true` → proceeds to in-diff guard (AC-1a)

**Step R2 — `validation.ts`: Add `matchAgainstChangedFiles` helper (AC-1a)**

Add a new exported pure helper immediately after `extractCitedFilePaths`:

```ts
export function matchAgainstChangedFiles(
    citedPath: string,
    changedFiles: ReadonlySet<string>,
): boolean {
    const isAbsolute = citedPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(citedPath);
    if (!isAbsolute) return changedFiles.has(citedPath);
    // Absolute path: split on both / and \, walk suffixes right-to-left,
    // join with / to match git-diff repo-relative paths.
    const parts = citedPath.split(/[/\\]/);
    for (let i = 1; i < parts.length; i++) {
        const suffix = parts.slice(i).join('/');
        if (suffix && changedFiles.has(suffix)) return true;
    }
    return false;
}
```

Replace `citedPaths.some(p => changedFiles.has(p))` with `citedPaths.some(p => matchAgainstChangedFiles(p, changedFiles))` in both:
- `validateHandoffAgainstSpec` (plan Step 2 call site)
- `classifyPreflightBlockersFromData` (plan Step 4b call site)

Splitting on both `/` and `\\` handles POSIX absolute paths (e.g. `/workspace/repo/e2e/specs/editor.spec.ts`) and Windows drive-letter paths (e.g. `C:\workspace\repo\e2e\specs\editor.spec.ts`) — the suffix is always joined with `/` so it matches the git-diff repo-relative key.

**Step R3 — `tests/run-task-validation.test.ts`: AC-1a and AC-1b tests**

Add two test groups after the existing `extractCitedFilePaths` tests (plan Step 11):

**`matchAgainstChangedFiles`** (new pure helper):
- Relative path in `changedFiles` → `true`
- Relative path not in `changedFiles` → `false`
- POSIX absolute path whose suffix matches → `true` (AC-1a core case)
- POSIX absolute path whose suffix does not match → `false`
- Windows drive-letter path whose suffix matches (e.g. `C:\workspace\repo\e2e\specs\editor.spec.ts`, `changedFiles` has `e2e/specs/editor.spec.ts`) → `true` (addresses `approved_with_nits` flag)

**`classifyPreflightBlockersFromData` — AC-1a and AC-1b integration:**
- `Fail – unrelated` Notes = `'/workspace/repo/e2e/specs/editor.spec.ts:1231'`, `changedFiles` has `'e2e/specs/editor.spec.ts'` → one `regression` issue (AC-1a)
- `Fail – unrelated` Notes = `'editor.spec.ts'` (bare basename, no `/`, no `:\d+`) → `hasFileRef` check fails → the row is rejected as format-class (no `Fail – unrelated` accept) — **not** silently accepted (AC-1b outer rejection)
- `Fail – unrelated` Notes = `'editor.spec.ts:1231'` (bare basename + line ref) → `hasFileRef` passes; cited path `'editor.spec.ts'` does not match `'e2e/specs/editor.spec.ts'` in `changedFiles` → no regression issue raised (proceeds to Stage 1 credibility review — the safe/conservative behavior)

**Step R4 — Build artifacts**

```bash
npm run build
```

`validation.ts` changes recompile into **both** `dist/scripts/run-task.js` and `dist/cli/index.js`. The original handoff noted `dist/cli/index.js` was byte-identical in round 1; it will change this round. Commit both dist deltas.

**Step R5 — Final validation**

```bash
npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check
```

No prompt template edits → no golden regeneration needed. If `npm test` shows unexpected golden diffs, investigate before committing.

---

## Reroute Plan Round 2

### Context

Reroute Round 1 (Steps R1–R5) is implemented and committed. The missing case: `editor.spec.ts:1231` (bare basename + `:line`) still bypasses the guard. After Round 1, `matchAgainstChangedFiles` has two branches — absolute-path suffix walk and exact match — but the exact-match branch (`changedFiles.has(citedPath)`) returns false for a bare basename when `changedFiles` contains `e2e/specs/editor.spec.ts`. The fix is a third branch in `matchAgainstChangedFiles` that scans `changedFiles` by last segment when the cited path has no path separator.

No prompt templates, no canon docs, no routing, no counters change.

**Approved-with-nits flag**: A stale sentence in Amendment 1 prose (spec.md:147) says `filename.ext:line` "proceeds to Claude Stage 1 review" — Round 2 supersedes that behavior. Non-blocking; no code action required.

### Delta

**Step R2.1 — `validation.ts`: Extend `matchAgainstChangedFiles` with bare-basename last-segment scan (AC-1c)**

**File**: `scripts/run-task/validation.ts` — `matchAgainstChangedFiles`

The current non-absolute branch is:
```ts
if (!isAbsolute) return changedFiles.has(citedPath);
```

Replace it with:
```ts
if (!isAbsolute) {
    // Relative path with a separator: exact match works.
    if (citedPath.includes('/') || citedPath.includes('\\')) {
        return changedFiles.has(citedPath);
    }
    // Bare basename (no separator): scan for any changed file whose last segment matches.
    for (const file of changedFiles) {
        const lastSeg = file.split('/').pop() ?? '';
        if (lastSeg === citedPath) return true;
    }
    return false;
}
```

This closes `editor.spec.ts:1231`: `extractCitedFilePaths` emits `editor.spec.ts` (stripped of `:1231`), the new branch finds `e2e/specs/editor.spec.ts` in `changedFiles` whose last segment is `editor.spec.ts`, and returns `true` — regression blocker emitted.

The documented same-basename false positive (AC-1d / Known Risks) fires in the safe direction — two changed files with the same basename both trigger the guard. Existing Known Risks entry already covers this.

**Step R2.2 — `tests/run-task-validation.test.ts`: AC-1c tests**

Add two rows to the `matchAgainstChangedFiles` group (after the existing AC-1a rows from Reroute Round 1):

- **Positive (AC-1c)**: `citedPath = 'editor.spec.ts'`, `changedFiles = new Set(['e2e/specs/editor.spec.ts'])` → `matchAgainstChangedFiles` returns `true`
- **Negative (AC-1c)**: `citedPath = 'foo.spec.ts'`, `changedFiles = new Set(['e2e/specs/editor.spec.ts'])` → returns `false` (basename not in any changed file's last segment)

Also add two integration rows to the `classifyPreflightBlockersFromData` group:

- **AC-1c positive**: `Fail – unrelated` Notes = `'editor.spec.ts:1231'`, `changedFiles` has `'e2e/specs/editor.spec.ts'` → one `regression` issue emitted
- **AC-1c negative**: `Fail – unrelated` Notes = `'foo.spec.ts:1231'`, `changedFiles` has `'e2e/specs/editor.spec.ts'` → no regression issue (genuinely-unrelated accept path preserved)

**Step R2.3 — AC-1d: Known Risks verification (no code change)**

AC-1d requires the Known Risks section of `spec.md` to document the three remaining gaps. The spec's existing Known Risks section (lines 117–124) already enumerates all three: `:line`-only reference with no filename, same-basename false positive, and URL-style citations — each with safe-direction rationale. AC-1d is satisfied; no edit needed.

**Step R2.4 — Build artifacts**

```bash
npm run build
```

`validation.ts` change recompiles into **both** `dist/scripts/run-task.js` and `dist/cli/index.js`. Commit both deltas.

**Step R2.5 — Final validation**

```bash
npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check
```

No prompt template edits → no golden regeneration needed.

---

## Reroute Plan Round 3

### Context

Reroute Rounds 1–2 (Steps R1–R5, R2.1–R2.5) are implemented and committed. The regression: the refactor replaced the old `validateHandoff`'s unconditional `hasFail` all-row scan with `classifyValidationChecks`, which iterates only the spec's `[x]`-checked `requiredChecks` items. Non-required rows with a plain `Fail` result are now silently ignored — a task can reach Claude review with an explicitly-failed non-required check. Only plain `Fail` is the gap; all other result states on non-required rows (`Fail – unrelated`, `blocked`, `Pass`, `pending`) were never flagged by the old `hasFail` scan and remain consistent.

The spec renames the new AC label to **AC-11** (the original draft used AC-10, which is already taken by the implement-revision prompt requirement).

No prompt templates, no canon docs, no routing changes, no counter changes — pure `validation.ts` + test delta.

### Delta

**Step R3.1 — `validation.ts`: Add non-required plain-Fail scan in `classifyPreflightBlockersFromData` (AC-11)**

**File**: `scripts/run-task/validation.ts` — `classifyPreflightBlockersFromData` (L643–652)

The current function body is:

```ts
export function classifyPreflightBlockersFromData(data: PreflightClassificationData): ClassifiedBlocker[] {
    const format = (message: string): ClassifiedBlocker => ({ bucket: 'format', message });
    if (data.handoffMissing) return [format('handoff.md not found')];
    return [
        ...data.acCoverageIssues.map(format),
        ...data.changesTableIssues.map(format),
        ...data.bundleDiffIssues.map(format),
        ...classifyValidationChecks(data.requiredChecks, data.latestResults, data.changedFiles),
    ];
}
```

Replace with an expanded body that adds the non-required plain-Fail scan after `classifyValidationChecks` runs:

```ts
export function classifyPreflightBlockersFromData(data: PreflightClassificationData): ClassifiedBlocker[] {
    const format = (message: string): ClassifiedBlocker => ({ bucket: 'format', message });
    const regression = (message: string): ClassifiedBlocker => ({ bucket: 'regression', message });
    if (data.handoffMissing) return [format('handoff.md not found')];

    const fromRequired = classifyValidationChecks(data.requiredChecks, data.latestResults, data.changedFiles);

    // Pre-compute the set of canonical keys already covered by requiredChecks so
    // the non-required scan does not double-count them.
    const requiredCanonicalKeys = new Set(
        (data.requiredChecks ?? []).map(r => canonicalizeValidationCheck(r)),
    );

    // Restore the old validateHandoff all-row plain-Fail scan for non-required rows.
    // Fail – unrelated on non-required rows remains on the accept path (unchanged behavior).
    const fromNonRequired: ClassifiedBlocker[] = [];
    for (const [canonical, row] of data.latestResults) {
        if (requiredCanonicalKeys.has(canonical)) continue;
        if (isFailResult(row.result) && !isUnrelatedFailResult(row.result)) {
            const note = row.notes ? ` (${row.notes})` : '';
            fromNonRequired.push(regression(
                `Validation Outcomes row not in spec's required checks has a plain Fail: ${canonical}${note} — fix the regression.`,
            ));
        }
    }

    return [
        ...data.acCoverageIssues.map(format),
        ...data.changesTableIssues.map(format),
        ...data.bundleDiffIssues.map(format),
        ...fromRequired,
        ...fromNonRequired,
    ];
}
```

Key points:
- `isFailResult` at L502 is `/^fail/i` — matches both `Fail` and `Fail – unrelated`. Guarding with `!isUnrelatedFailResult(row.result)` (L513) restricts to plain `Fail` only, consistent with the spec's stated boundary.
- `canonicalizeValidationCheck` at L90 is the same normalizer used inside `classifyValidationChecks`, so the canonical keys match.
- `data.requiredChecks` may be `null` (missing section). The `?? []` coercion makes `requiredCanonicalKeys` an empty set, which is safe — if the required section is missing, `classifyValidationChecks` already returns a format blocker and the non-required scan runs over all rows (over-inclusive in the safe direction; the format blocker takes priority anyway).

**Step R3.2 — `tests/run-task-validation.test.ts`: AC-11 tests**

**File**: `tests/run-task-validation.test.ts`

Add four test rows to the `classifyPreflightBlockersFromData` group (after the existing R2.x integration tests), covering all four AC-11 verify clauses:

- **(a) Non-required plain `Fail` → regression blocker**: a `latestResults` map with a `Fail` row for a key NOT in `requiredChecks` → one `regression`-bucket blocker emitted.
- **(b) Non-required `Pass` → no blocker**: a `latestResults` map with a `Pass` row for a non-required key → no blocker from this rule.
- **(c) Non-required `Fail – unrelated` with valid file ref → no regression blocker**: a `Fail – unrelated` row for a non-required key (Notes with a valid file ref, file NOT in `changedFiles`) → no regression blocker emitted (row remains on accept path — proceeds to Claude Stage 1).
- **(d) Required `Fail` not double-counted**: a `Fail` row whose key appears in both `latestResults` AND `requiredChecks` → only one `regression` blocker total (one from `classifyValidationChecks`, zero from the non-required scan).

**Step R3.3 — Build artifacts**

```bash
npm run build
```

`validation.ts` change recompiles into **both** `dist/scripts/run-task.js` and `dist/cli/index.js`. Commit both deltas.

**Step R3.4 — Final validation**

```bash
npm run lint && npm run type-check && npm test && npm run sync-templates:check && npm run docs-refs-check
```

No prompt template edits → no golden regeneration needed.
