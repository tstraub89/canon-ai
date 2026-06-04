# Implementation Plan: qa-drafts-pr-body — QA drafts a filled PR body for --pr

> Written by: Claude | Implements: `tasks/qa-drafts-pr-body/spec.md`
> Spec review verdict: approved_with_nits
> Nit incorporated: `TASK_ARTIFACT_FILES` update in `worktree.ts` is registry hygiene only — commit coverage comes from `commitTaskArtifactsToBase` staging the whole `tasks/<id>/` tree. Positioned accordingly in step 4.

## Approach

Three independent threads wired together:

1. **Stub detector** (`validation.ts`) — `isPrBodyTemplate` mirrors `isDoneMdTemplate`, using sentinels that appear in the new `.canon/templates/pr-body.md` stub and would never appear in a filled PR body.

2. **QA phase extension** (`phases/qa.ts` → `prompts/index.ts` → `qa.md`) — the QA phase resolves the repo's PR template (worktree-first, mirroring `--pr` precedence), reads its content, and passes it to `promptQa`. The `qa.md` template gains a new instruction step with a Mustache conditional: if a template was found, inject it for QA to fill; if not, use a default skeleton. QA writes the result to `tasks/<id>/pr-body.md`. To avoid a circular import (main.ts already imports phases/qa.ts), the PR template resolution happens in main.ts's `runPhase` dispatch and is passed down as a parameter — `findPullRequestTemplate` stays in main.ts.

3. **`--pr` body-resolution chain** (`main.ts`) — `createDraftPRForTask` gains a `resolveQaPrBody` helper (exported for unit testing) that slots populated `pr-body.md` between `CANON_PR_BODY` and the existing template/`--fill` fallback. Single-task only; bundles log + fall back unchanged.

## Steps

### Step 1 — `scripts/run-task/validation.ts`: Add `isPrBodyTemplate`

Add alongside the existing `DONE_MD_TEMPLATE_SENTINELS` / `isDoneMdTemplate` block (~line 606):

```typescript
const PR_BODY_TEMPLATE_SENTINELS = [
    '[pr-body-stub]',
    '[TASK' + '-ID]',
];

export function isPrBodyTemplate(prBodyPath: string): boolean {
    let content: string;
    try {
        content = fs.readFileSync(prBodyPath, 'utf8');
    } catch {
        return true;  // absent → treat as stub
    }
    return PR_BODY_TEMPLATE_SENTINELS.some(s => content.includes(s));
}
```

`[pr-body-stub]` is unique to this template. `[TASK` + `-ID]` is the universal unfilled-artifact marker present in every canon template header. Both sentinels must appear in the stub created in step 2.

### Step 2 — `.canon/templates/pr-body.md`: New artifact template stub

Create with both `PR_BODY_TEMPLATE_SENTINELS` present:

```markdown
<!-- [pr-body-stub] QA fills this file during the qa phase. Do not edit manually before QA runs. -->

# PR Body: [TASK` + `-ID]

> Stub — QA will replace this entire file with the filled PR body.
```

After QA writes the real PR body, neither `[pr-body-stub]` nor `[TASK` + `-ID]` appear, so `isPrBodyTemplate` returns false.

### Step 3 — `src/lib/canon-owned.ts`: Register the new template

Append `'.canon/templates/pr-body.md'` to `CANON_OWNED` after the existing `'.canon/templates/notes.md'` entry. This is the entire upgrade-sync mechanism — `canon upgrade` iterates `CANON_OWNED` generically; no upgrade-path code change is needed.

### Step 4 — `scripts/run-task/worktree.ts`: Registry hygiene

Add `'pr-body.md'` to the `TASK_ARTIFACT_FILES` set:

```typescript
export const TASK_ARTIFACT_FILES = new Set([
    'spec.md', 'spec-review.md', 'plan.md', 'handoff.md', 'review.md', 'done.md', 'notes.md', 'pr-body.md',
]);
```

Commit coverage for `--pr` comes from `commitTaskArtifactsToBase` staging the whole `tasks/<id>/` tree — this change is recognition-consistency bookkeeping only, not the commit mechanism.

### Step 5 — `scripts/run-task/prompts/index.ts`: Extend `promptQa` signature

Change the signature and render call:

```typescript
export function promptQa(state: PipelineState, prTemplate?: string | null): string {
    const { tasks } = state;
    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" → tasks/${t.taskId}/`
    ).join('\n');

    return render('qa.md', {
        projectName: config.projectName,
        docsScope: tasks.length > 1 ? 'these tasks' : 'this task',
        startup: QA_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        taskLines,
        isBundle: tasks.length > 1,
        prTemplate: prTemplate ?? null,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'qa', 'done'),
    });
}
```

`prTemplate: null` renders the `{{^prTemplate}}` block (default skeleton) in Mustache. Non-null renders `{{#prTemplate}}` (template-fill path).

### Step 6 — `scripts/run-task/prompts/templates/qa.md`: Add pr-body.md instruction

Insert a new step **before** the existing "After writing all done.md files:" paragraph. Number it as a new step (e.g., step 4 if you renumber, or insert with clear placement). Use Mustache conditionals for the template/skeleton split:

```mustache
4. **For single tasks only — use the Write tool** to create `tasks/<id>/pr-body.md` — the outward-facing PR body draft for `--pr`. Write it as if a human wrote it after doing the work.
   {{#prTemplate}}
   The repo has this PR template — fill every section with specifics from what shipped (read spec.md, handoff.md, review.md for substance). Keep all section headings; replace every placeholder:

   {{{prTemplate}}}
   {{/prTemplate}}
   {{^prTemplate}}
   No PR template found. Use this structure:

   ## Summary
   1–3 bullets: what changed and why.

   ## Changes
   Key files or areas touched, described for a reviewer.

   ## How to Test
   Steps a reviewer can follow to verify the change.

   ## Notes for Reviewer
   Any context, caveats, or follow-up items.
   {{/prTemplate}}
   ⚠️ The body must NOT contain any mention of "canon", "Claude", "AI", "generated", or any attribution to tooling. **Skip this step entirely for bundle tasks — per-task bodies are not combined for bundle PRs.**
```

Use `{{{prTemplate}}}` (triple mustache) for unescaped injection of the template content (preserves backticks, angle brackets, etc.).

### Step 7 — `scripts/run-task/main.ts`: Resolve PR template before `runQaPhase` dispatch

At the `qa` phase dispatch (~line 2032):

```typescript
if ((phase as Phase) === 'qa') {
    const taskIds = tasks.map(t => t.taskId);
    const activeCwd = splitWorktree.getActiveCwd(taskIds);
    const qaTemplatePath =
        findPullRequestTemplate(activeCwd) ?? findPullRequestTemplate(REPO_ROOT);
    const resolvedPrTemplate = qaTemplatePath
        ? fs.readFileSync(qaTemplatePath, 'utf8')
        : null;
    return runQaPhase(state, cliArgs.interactive, resolvedPrTemplate);
}
```

`findPullRequestTemplate` stays in main.ts — this avoids a circular import (`main.ts` → `phases/qa.ts` → `main.ts`). The resolution uses the same worktree-first precedence as `--pr`.

### Step 8 — `scripts/run-task/phases/qa.ts`: Accept and forward `resolvedPrTemplate`

Change signature and forward to `promptQa`:

```typescript
export async function runQaPhase(
    state: PipelineState,
    interactive: boolean,
    resolvedPrTemplate?: string | null,
): Promise<PhaseRunResult> {
    // ... existing body ...
    const result = await runClaude(
        promptQa(state, resolvedPrTemplate),
        interactive, null, cfg.model, cfg.effort, { ... }, activeCwd
    );
    // ... rest unchanged ...
}
```

No other logic change in this function.

### Step 9 — `scripts/run-task/main.ts`: Add `resolveQaPrBody` helper + update `createDraftPRForTask`

Export a resolution helper for unit testability:

```typescript
/**
 * Returns the path to a populated pr-body.md for a single task, or a fallback
 * descriptor for absent/stub/bundle cases.
 * Exported for unit testing.
 */
export function resolveQaPrBody(
    taskIds: readonly string[],
    activeCwd: string,
    repoRoot: string,
): { type: 'prBody'; path: string } | { type: 'fallback'; reason: string } {
    if (taskIds.length !== 1) {
        return { type: 'fallback', reason: 'bundle: per-task pr-body.md files are not combined in this version' };
    }
    const prBodyPath = path.join(activeCwd, 'tasks', taskIds[0], 'pr-body.md');
    if (!splitValidation.isPrBodyTemplate(prBodyPath)) {
        return { type: 'prBody', path: prBodyPath };
    }
    const reason = fs.existsSync(prBodyPath)
        ? 'pr-body.md is still the stub template'
        : 'pr-body.md not found';
    return { type: 'fallback', reason };
}
```

Update `createDraftPRForTask` to use this helper in the `body === null` branch:

```typescript
const body = resolveCanonPrBody(taskIds, title);
if (body !== null) {
    args.push('--body', body);
} else {
    const activeCwd = splitWorktree.getActiveCwd(taskIds);
    const prBodyResult = resolveQaPrBody(taskIds, activeCwd, REPO_ROOT);
    if (prBodyResult.type === 'prBody') {
        args.push('--body-file', prBodyResult.path);
    } else {
        if (taskIds.length > 1) {
            warn(`Bundle PR: ${prBodyResult.reason} — falling back to repo PR template or --fill`);
        } else {
            warn(`PR body fallback (${prBodyResult.reason}) — falling back to repo PR template or --fill`);
        }
        const templatePath =
            findPullRequestTemplate(activeCwd) ?? findPullRequestTemplate(REPO_ROOT);
        if (templatePath) {
            args.push('--body-file', templatePath);
        } else {
            args.push('--fill');
        }
    }
}
```

**Inspect the existing `activeCwd` usage in `createDraftPRForTask`**: if `getActiveCwd(taskIds)` is already called earlier in the function, consolidate into one declaration rather than calling it twice.

**AC-8 regression**: When `CANON_PR_BODY` is set, `resolveCanonPrBody` returns non-null → takes the `body !== null` branch → `resolveQaPrBody` is never reached. The `done.md` hard gate is untouched.

### Step 10 — `tests/run-task-validation.test.ts`: `isPrBodyTemplate` tests

Import `isPrBodyTemplate` and add three test cases. Use the same `withTempDir` helper pattern present in the file:

```typescript
// ── isPrBodyTemplate ─────────────────────────────────────────────────────────
void test('isPrBodyTemplate: returns true for stub (both sentinels present)', () => {
    withTempDir('pr-body-stub-', dir => {
        const p = path.join(dir, 'pr-body.md');
        fs.writeFileSync(p, '<!-- [pr-body-stub] -->\n# PR Body: [TASK' + '-ID]\n');
        assert.equal(isPrBodyTemplate(p), true);
    });
});

void test('isPrBodyTemplate: returns false for populated body (no sentinels)', () => {
    withTempDir('pr-body-filled-', dir => {
        const p = path.join(dir, 'pr-body.md');
        fs.writeFileSync(p, '## Summary\n\nFixes the hover bug.\n\n## How to Test\n\n1. Hover.\n');
        assert.equal(isPrBodyTemplate(p), false);
    });
});

void test('isPrBodyTemplate: returns true when file is absent', () => {
    withTempDir('pr-body-absent-', dir => {
        const p = path.join(dir, 'pr-body.md');
        // file not written
        assert.equal(isPrBodyTemplate(p), true);
    });
});
```

### Step 11 — `tests/run-task-safety.test.ts`: `resolveQaPrBody` tests

Import `resolveQaPrBody` at the top of the file alongside the existing imports. Add four test cases after the existing `resolveCanonPrBody` tests:

```typescript
// ── resolveQaPrBody (QA pr-body.md → --pr body resolution) ──────────────────
void test('resolveQaPrBody: bundle always returns fallback with reason', () => {
    withTempDir('pr-body-', dir => {
        const result = resolveQaPrBody(['a', 'b'], dir, dir);
        assert.equal(result.type, 'fallback');
        assert.ok(result.type === 'fallback' && /bundle/.test(result.reason));
    });
});

void test('resolveQaPrBody: single task, absent pr-body.md → fallback "not found"', () => {
    withTempDir('pr-body-', dir => {
        const result = resolveQaPrBody(['mytask'], dir, dir);
        assert.equal(result.type, 'fallback');
        assert.ok(result.type === 'fallback' && /not found/.test(result.reason));
    });
});

void test('resolveQaPrBody: single task, stub pr-body.md → fallback "stub"', () => {
    withTempDir('pr-body-', dir => {
        const taskDir = path.join(dir, 'tasks', 'mytask');
        fs.mkdirSync(taskDir, { recursive: true });
        fs.writeFileSync(
            path.join(taskDir, 'pr-body.md'),
            '<!-- [pr-body-stub] -->\n# PR Body: [TASK' + '-ID]\n',
        );
        const result = resolveQaPrBody(['mytask'], dir, dir);
        assert.equal(result.type, 'fallback');
        assert.ok(result.type === 'fallback' && /stub/.test(result.reason));
    });
});

void test('resolveQaPrBody: single task, populated pr-body.md → prBody path', () => {
    withTempDir('pr-body-', dir => {
        const taskDir = path.join(dir, 'tasks', 'mytask');
        fs.mkdirSync(taskDir, { recursive: true });
        const p = path.join(taskDir, 'pr-body.md');
        fs.writeFileSync(p, '## Summary\n\nFixed the hover bug.\n');
        const result = resolveQaPrBody(['mytask'], dir, dir);
        assert.equal(result.type, 'prBody');
        assert.ok(result.type === 'prBody' && result.path === p);
    });
});
```

### Step 12 — `tests/run-task-prompts.golden.json`: Regenerate `promptQa` snapshot

After the `qa.md` template changes (step 6) and `promptQa` signature extension (step 5), regenerate the golden:

```bash
UPDATE_GOLDENS=1 npm test
```

The test harness writes the golden when `UPDATE_GOLDENS=1`. The `promptQa` golden entry will show the new qa.md content with the `{{^prTemplate}}` block rendered (since the test calls `promptQa(baseState)` with no second arg, `prTemplate` is null). Commit the regenerated `tests/run-task-prompts.golden.json`.

### Step 13 — `tests/cli.test.ts`: Add to `ADOPTER_SHIPPED_PATHS`

In the `ADOPTER_SHIPPED_PATHS` array (~line 2021–2028), add:

```typescript
'templates/.canon/templates/pr-body.md',
```

alongside the existing `'templates/.canon/templates/done.md'` entry. This covers the auto-synced mirror under `templates/`.

### Step 14 — Documentation updates

**`AGENTS.md`** — File-Based Handoff Protocol task-dir listing (~line 80, the `tasks/TASK-ID/` code block). Add after `done.md`:
```
    pr-body.md         # QA writes (single-task PR body draft for --pr)
```

**`CLAUDE.md`** — "Writing QA Summary" section. After the existing step that writes `done.md`, add:
> Also write `tasks/<id>/pr-body.md` (single-task only): a filled, outward-facing PR body. Fill the repo's PR template structure if one exists, or use a default Summary / Changes / How to Test / Notes skeleton. No canon/AI attribution — write as if a human authored it.

**`docs/pipeline-orchestrator.md`** — `--pr` body-resolution section. Update to document the new precedence order:
1. `CANON_PR_BODY` env var (unchanged)
2. Populated `tasks/<id>/pr-body.md` — single-task only; `isPrBodyTemplate` (in `validation.ts`) detects stub
3. Repo PR template file (`findPullRequestTemplate`, worktree-first)
4. `--fill` (no template found)

Also add `pr-body.md` to wherever the task artifact list appears in this file.

**`docs/codebase-map.md`** — task-artifact-templates table (~line 60–69). Add a `pr-body.md` row after the `done.md` row, matching the table's column format.

### Step 15 — `npm run build` (regenerate `dist/`)

Source changes touch `scripts/run-task/**` and `src/**`, both of which emit into `dist/`. Run `npm run build` and commit the regenerated bundle. The `--pr` base-drift allow-list accepts `dist/` entries for this task because `dist/` is in the spec's Affected Files.

### Step 16 — Validation sequence

```
npm run lint
npm run type-check
npm test
npm run build
npm run docs-refs-check
npm run sync-templates:check
```

`sync-templates:check` validates that the new `.canon/templates/pr-body.md` has an aligned mirror under `templates/.canon/templates/pr-body.md`. The pre-commit hook auto-syncs on commit; running the check confirms the mirror is current.

---

## Dependency order

```
Step 1 (validation.ts — sentinel strings)
  → sentinels inform
Step 2 (.canon/templates/pr-body.md — uses same sentinels)

Steps 3, 4 (canon-owned.ts, worktree.ts — independent registry hygiene)

Step 5 (prompts/index.ts — promptQa signature)
  → depends on Step 1 indirectly (prTemplate semantics)
Step 6 (qa.md template — new pr-body.md instruction)

Steps 7, 8 (main.ts QA dispatch + qa.ts phase — wire prTemplate)
  → depend on Steps 5, 6

Step 9 (main.ts resolveQaPrBody + createDraftPRForTask)
  → depends on Step 1 (isPrBodyTemplate)

Tests 10–13 — after production changes for the component they test
Docs 14 — parallel with tests
Steps 15–16 (build + validate) — last
```
