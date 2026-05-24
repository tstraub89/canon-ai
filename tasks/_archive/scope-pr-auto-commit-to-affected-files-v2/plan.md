# Plan: scope-pr-auto-commit-to-affected-files-v2 — Scope `--pr` auto-commit allow-list to spec's Affected Files

> Written by: Claude | Task size: M (full tier)

## Spec-Review Nits Addressed

Three `approved_with_nits` observations from `spec-review.md` are folded into these steps:

1. **Stale test count** (`spec.md:85` said "five cases"): Step 8 lists all seven AC-9 cases explicitly.
2. **Source/test remediation text** (`spec.md:27`): The `PIPELINE_SHARED_DOCS` sync loop only iterates managed docs and telemetry — it cannot dirty a source/test file. Step 5 specifies a corrected die message that says "unexpected late edits or base-drift/branch contamination" instead of "managed-doc sync" for source/test files.
3. **TypeScript readonly tuple** (`spec.md:60`, `spec.md:83`): Step 4 calls out `(PIPELINE_MANAGED_DOCS as readonly string[]).includes(f)`, matching the existing pattern at `worktree.ts:289`.

---

## Implementation Steps

### Step 1 — Add `parseAffectedFilesFromSpec` to `validation.ts` (AC-1, AC-2)

**File**: `scripts/run-task/validation.ts`

Place the new function immediately after `parseHandoffChangesRows` (currently ending ~line 647). The function signature and return type must match exactly:

```ts
export function parseAffectedFilesFromSpec(taskId: string): {
    files: string[];
    malformed: Array<{ cell: string; reason: string }>;
}
```

Implementation body:
1. Compute the spec path: `path.join(taskDirFor(taskId), 'spec.md')`.
2. Read with `fs.readFileSync(..., 'utf8')` wrapped in a `try/catch` that returns `{ files: [], malformed: [] }` on any error (missing file, permission, etc.).
3. Call `extractSectionBodies(content, /^## Design\b/)`. If the result is empty, return `{ files: [], malformed: [] }`.
4. For each returned body string, call `parseTableH3(body, 'Affected Files')`. If all bodies return empty arrays, return `{ files: [], malformed: [] }`.
5. For every row across all bodies, extract `Object.values(row)[0] ?? ''`; skip empty/whitespace-only cells. Call `parseHandoffPathCell(firstColumn)`. Accumulate `files` (a `Set<string>`) from `kind === 'ok'` results and `malformed` from `kind === 'malformed'` results.
6. Return `{ files: [...files], malformed }`.

No new imports needed — `extractSectionBodies`, `parseTableH3`, `parseHandoffPathCell`, `taskDirFor`, `path`, and `fs` are already imported.

---

### Step 2 — Widen `humanReviewAllowedPath` signature (AC-3)

**File**: `scripts/run-task/main.ts` — function at line 637

Change signature from `(taskIds: string[], filePath: string)` to `(taskIds: string[], affectedManagedDocs: ReadonlySet<string>, filePath: string)`.

Replace body:
```ts
return taskIds.some(taskId => filePath === `tasks/${taskId}` || filePath.startsWith(`tasks/${taskId}/`)) ||
    (splitWorktree.PIPELINE_TELEMETRY_FILES as readonly string[]).includes(filePath) ||
    affectedManagedDocs.has(filePath);
```

Remove any reference to `PIPELINE_SHARED_DOCS` from this function. The `as readonly string[]` cast is needed because `PIPELINE_TELEMETRY_FILES` is a `readonly` literal tuple — same pattern used at `worktree.ts:289`.

---

### Step 3 — Widen `buildHumanReviewStagePaths` signature (AC-4)

**File**: `scripts/run-task/main.ts` — exported function at line 660

Change signature from `(taskIds: string[], dirtyEntries: readonly PorcelainEntry[])` to `(taskIds: string[], affectedManagedDocs: ReadonlySet<string>, dirtyEntries: readonly PorcelainEntry[])`.

Replace the single `PIPELINE_SHARED_DOCS` loop with two loops:
```ts
for (const relPath of splitWorktree.PIPELINE_TELEMETRY_FILES) {
    if (dirtyEntries.some(entry => entry.paths.some(p => p === relPath))) {
        stagePaths.add(relPath);
    }
}
for (const relPath of affectedManagedDocs) {
    if (dirtyEntries.some(entry => entry.paths.some(p => p === relPath))) {
        stagePaths.add(relPath);
    }
}
```

The task-dir loop above these is unchanged.

---

### Step 4 — Build and thread `affectedManagedDocs` in `commitHumanReviewFiles` (AC-5)

**File**: `scripts/run-task/main.ts` — function at line 887

Insert the following block **after** `mirrorHumanReviewDocsToCwd(cwd)` (line 891) and **before** the porcelain query (line 893):

```ts
const affectedManagedDocs = new Set<string>();
for (const taskId of taskIds) {
    const parsed = splitValidation.parseAffectedFilesFromSpec(taskId);
    for (const f of parsed.files) {
        if ((splitWorktree.PIPELINE_MANAGED_DOCS as readonly string[]).includes(f)) {
            affectedManagedDocs.add(f);
        }
    }
    parsed.malformed.forEach(m =>
        splitCli.warn(`${taskId} spec.md Affected Files row malformed: ${m.reason}`)
    );
}
```

The `(PIPELINE_MANAGED_DOCS as readonly string[]).includes(f)` cast is required (nit #3 from spec-review — same pattern as `worktree.ts:289`). Non-managed paths from Affected Files are intentionally dropped here; the Affected Files carve-out cannot widen the allow-list to source/test files.

Update the **four** downstream call sites:
- **Line 938** (unexpected check): `humanReviewAllowedPath(taskIds, filePath)` → `humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath)` (inside the `.every(pathName => ...)` predicate).
- **Line 947** (stage paths): `buildHumanReviewStagePaths(taskIds, dirtyEntries)` → `buildHumanReviewStagePaths(taskIds, affectedManagedDocs, dirtyEntries)`.
- **Line 961** (pre-stage check): `humanReviewAllowedPath(taskIds, filePath)` → `humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath)`.
- **Line 985** (post-stage check): `humanReviewAllowedPath(taskIds, filePath)` → `humanReviewAllowedPath(taskIds, affectedManagedDocs, filePath)`.

---

### Step 5 — Update the die message at the unexpected-dirty gate (AC-6)

**File**: `scripts/run-task/main.ts` — die block at lines 940–944

Replace the existing `die(...)` call body with:

```ts
die(
    `Human review commit aborted: working tree has dirty files outside the human_review allowlist.\n` +
    unexpected.map(entry => `  ${entry.raw}`).join('\n') + `\n` +
    `The allowlist is: tasks/<id>/, PIPELINE_TELEMETRY_FILES, and PIPELINE_MANAGED_DOCS entries listed in your spec's '### Affected Files' table.\n` +
    `If this is a managed doc this task legitimately edits, add it to spec.md '### Affected Files' and rerun.\n` +
    `If this is a source or test file, it should have been committed during the implement phase — ` +
    `investigate why it is dirty now (unexpected late edits or base-drift/branch contamination are possible causes) ` +
    `and revert with: git checkout HEAD -- <path>`
);
```

AC-6 requires the message to contain all five substrings: "allowlist", "PIPELINE_MANAGED_DOCS", "Affected Files", "implement phase", "git checkout HEAD --". The source/test line says "unexpected late edits or base-drift/branch contamination" — NOT "managed-doc sync" (nit #2 from spec-review; the sync loop only touches managed docs and telemetry, not source files).

The other three die blocks (lines 949, 961, 985) keep their **existing** messages exactly — no changes.

---

### Step 6 — Emit advisory warnings for committed managed docs (AC-7)

**File**: `scripts/run-task/main.ts`

After `const stagePaths = new Set(buildHumanReviewStagePaths(...))` (updated per step 3) and **before** the `stagePaths.size === 0` check at line 949, insert:

```ts
for (const relPath of stagePaths) {
    if (affectedManagedDocs.has(relPath)) {
        splitCli.warn(
            `WARNING: ${relPath} has uncommitted edits and is in PIPELINE_MANAGED_DOCS — ` +
            `run \`git diff HEAD -- ${relPath}\` to verify these are this task's work before --ship.`
        );
    }
}
```

`affectedManagedDocs` is already filtered to `PIPELINE_MANAGED_DOCS` at construction (step 4), so no re-check is needed. Fires once per matching path (Set iteration).

---

### Step 7 — Tests for `parseAffectedFilesFromSpec` (AC-2, AC-8)

**File**: `tests/run-task-validation.test.ts`

Add `parseAffectedFilesFromSpec` to the import from `'../scripts/run-task/validation.js'`.

Add a `describe('parseAffectedFilesFromSpec', () => { ... })` block with six test cases. Use `fs.mkdtempSync(path.join(os.tmpdir(), 'affected-files-spec-'))` for isolated fixture dirs. Because `parseAffectedFilesFromSpec` calls `taskDirFor(taskId)` which reads `CANON_TASKS_DIR_OVERRIDE`, each test should:
1. Create `<tmpdir>/tasks/<taskId>/spec.md` with fixture content.
2. Set `process.env.CANON_TASKS_DIR_OVERRIDE` to `<tmpdir>/tasks` before calling.
3. Restore (or delete) `CANON_TASKS_DIR_OVERRIDE` in a `finally` block.
4. `fs.rmSync(tmpdir, { recursive: true, force: true })` in the same `finally`.

**Six test cases** (AC-2 a–d + AC-8 e–f):

a. **Positive — three valid rows**: spec with `## Design\n### Affected Files` table containing one backtick path, one markdown-link path, one bare-backtick path → `files` has three paths, `malformed` is empty.

b. **Missing spec.md** → `{ files: [], malformed: [] }` without throw (do not create the spec file; just call).

c. **spec.md without `## Design`** → `{ files: [], malformed: [] }`.

d. **spec.md with `## Design` but no `### Affected Files` H3** → `{ files: [], malformed: [] }`.

e. **Malformed row**: spec with one valid row + one row containing `` `<path>` `` (template placeholder) → `malformed` has one entry whose `reason` includes "template placeholder"; `files` has one entry (the valid row).

f. **Both path formats**: one row with `` `path/foo.ts` `` and one with `[path/bar.ts](url)` → both appear in `files`.

---

### Step 8 — Tests for `commitHumanReviewFiles` allow-list semantics (AC-9)

**File**: `tests/run-task-safety.test.ts`

Add a `describe('commitHumanReviewFiles allow-list', () => { ... })` block with **seven** test cases. Follow the existing fixture pattern at line 1428: `setupFakeGit`, `setupFakeCliTools`, `writeTaskStatus`, populate `tasks/<id>/spec.md`, use `FAKE_GIT_STATUS_OUTPUT` to control dirty state, invoke via `runNodeInline` with `commitHumanReviewFiles(['task-a'], dir, false)`.

For each test, write a `tasks/<taskId>/spec.md` whose `### Affected Files` table matches the scenario. Use non-gitignored fixture file names per `docs/patterns.md` "Test-writing pitfalls".

**Seven test cases** (AC-9 a–g):

a. **Out-of-scope managed doc dies**: spec lists no Affected Files, `FAKE_GIT_STATUS_OUTPUT = ' M docs/codebase-map.md'`. Assert `result.status !== 0`; assert `result.stderr` contains all five required substrings: "allowlist", "PIPELINE_MANAGED_DOCS", "Affected Files", "implement phase", "git checkout HEAD --".

b. **In-scope managed doc commits + advisory**: spec lists `docs/codebase-map.md` in Affected Files, `FAKE_GIT_STATUS_OUTPUT = ' M docs/codebase-map.md'`. Assert `result.status === 0`, git log shows a commit, and `result.stdout` (or combined output) contains `"WARNING: docs/codebase-map.md"` exactly once.

c. **Telemetry file commits without advisory**: no Affected Files in spec, `FAKE_GIT_STATUS_OUTPUT = ' M docs/lessons-learned.md'`. Assert `result.status === 0`, git log shows a commit, and output does NOT contain `"WARNING"`.

d. **Bundle union**: `task-a` spec lists `docs/codebase-map.md`, `task-b` spec lists `docs/patterns.md`, `FAKE_GIT_STATUS_OUTPUT` has both dirty. Invoke with `commitHumanReviewFiles(['task-a', 'task-b'], dir, false)`. Assert both files committed and `result.status === 0`.

e. **Malformed row warning**: spec has one valid Affected Files row (`docs/codebase-map.md`) + one placeholder row (`` `<path>` ``). `FAKE_GIT_STATUS_OUTPUT = ' M docs/codebase-map.md'`. Assert `result.status === 0` and output contains `"task-a spec.md Affected Files row malformed"`. Assert placeholder path does NOT appear in the commit.

f. **Non-managed Affected Files entry dies**: spec lists `scripts/run-task/main.ts` (source file, not in `PIPELINE_MANAGED_DOCS`) in Affected Files, `FAKE_GIT_STATUS_OUTPUT = ' M scripts/run-task/main.ts'`. Assert `result.status !== 0` (died, file not committed). This proves the `PIPELINE_MANAGED_DOCS` intersection filter prevents source files from entering the allow-list.

g. **Mixed managed + non-managed** — two sub-assertions in one test:
  - spec lists both `docs/codebase-map.md` and `tests/run-task-safety.test.ts` in Affected Files. First run: only `docs/codebase-map.md` dirty → `status === 0`, advisory fires, commit succeeds.
  - Second run (separate `runNodeInline` call with fresh status): only `tests/run-task-safety.test.ts` dirty → `status !== 0` (dies). Proves per-path filtering, not all-or-nothing.

---

### Step 9 — Update both spec templates (AC-10)

**Files** (edit in the same commit per `feedback_canon_delimited_files_template_parallel_edit`):
- `.canon/templates/spec.md`
- `templates/.canon/templates/spec.md`

In each file, locate the `### Affected Files` H3 under `## Design`. Insert the following blockquote immediately after the `### Affected Files` heading, before the `| File | Change |` table row:

```
> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.
```

Both files receive the identical edit in the same commit. Verify by reading both files after edit.

---

### Step 10 — Update `docs/pipeline-orchestrator.md` `## Auto-Branch + Auto-Commit` section (AC-11)

**File**: `docs/pipeline-orchestrator.md`

Locate line 216: `"At human_review with --push or --pr, the orchestrator auto-commits task artifacts, telemetry, and the managed docs listed in PIPELINE_MANAGED_DOCS before pushing."` Replace that sentence with the following prose (fits within the existing `## Auto-Branch + Auto-Commit` section):

```
At `human_review` with `--push` or `--pr`, the orchestrator auto-commits a scoped allow-list before pushing:

- **`tasks/<id>/`** — task artifacts (spec, plan, handoff, review, done, notes).
- **`PIPELINE_TELEMETRY_FILES`** (`docs/lessons-learned.md`, `docs/task-quality-log.md`, `docs/pipeline-invocations.md`) — always auto-committed.
- **`PIPELINE_MANAGED_DOCS` ∩ spec's `### Affected Files`** — a managed doc (`docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/pipeline-orchestrator.md`, `docs/product-context.md`) is auto-committed **only** if the task's `spec.md` `### Affected Files` table lists it. Tasks that legitimately edit a managed doc must list it in Affected Files.

If a dirty file falls outside this union, the pipeline dies with an actionable message describing the allow-list, suggesting either adding the file to `spec.md '### Affected Files'` (for managed docs) or reverting with `git checkout HEAD -- <path>` (for source/test files that should have been committed in the implement phase).

Note: non-managed Affected Files entries (source files, test files, fixtures) do **not** enter the human_review allow-list. The Affected Files carve-out at human_review is restricted to `PIPELINE_MANAGED_DOCS` only.

When a managed doc is committed via the Affected Files allow-list, an advisory warning fires per file inviting the operator to `git diff HEAD -- <path>` to verify the content before `--ship` (residual guard against same-file sibling-pipeline overlap).
```

---

## Validation Checklist (for Codex to run before handoff)

- `npm run lint`
- `npm run type-check`
- `npm test` — full suite; new `parseAffectedFilesFromSpec` and `commitHumanReviewFiles allow-list` describe-blocks must all pass
