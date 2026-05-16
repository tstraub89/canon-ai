# Plan: Fix five harness bugs from pipeline refactor

## Spec-review nit addressed

The spec review flagged that `human_review` bundle behavior was underspecified. This plan resolves it:
- **No-push notice**: once per bundle — print one notice listing all task done.md paths, then `process.exit(0)`.
- **Push/pr commit**: once per bundle — stage all task artifact files across all task IDs + `PIPELINE_TELEMETRY_FILES` + `PIPELINE_MANAGED_DOCS`, one commit, one push.
- **PR creation**: once per bundle — one `gh pr create` call.

---

## Step 1 — `scripts/run-task/types.ts`: add `dryRun` to `CliArgs`

Add `dryRun: boolean` to the `CliArgs` type (currently lines 68–77). Insert after `ship: boolean`:

```typescript
export type CliArgs = {
    taskIds: string[];
    interactive: boolean;
    step: boolean;
    expectPhase: string | null;
    push: boolean;
    pr: boolean;
    reroute: boolean;
    ship: boolean;
    dryRun: boolean;     // ← add
};
```

---

## Step 2 — `scripts/run-task/cli.ts`: parse `--dry-run` and update usage

**In `printUsage()`**: add a row after the `--ship` line:
```
  --dry-run           Print each planned phase (agent, model, effort) and exit without spawning any LLM
```

**In `parseArgs()`**:
1. Initialize `let dryRun = false;` alongside the other `let` declarations.
2. Add `case '--dry-run': dryRun = true; break;` in the arg-parsing switch.
3. Add `dryRun` to the returned object: `return { taskIds, interactive, step, expectPhase, push, pr, reroute, ship, dryRun };`

---

## Step 3 — `scripts/run-task/env.ts`: resolve `REPO_ROOT` via `git rev-parse --git-common-dir`

Add `import { spawnSync } from 'node:child_process';` alongside the existing imports.

Replace the current single-line constant:
```typescript
// Before:
export const REPO_ROOT = path.resolve(__dirname, '../..');
```

With a helper called once at module load:
```typescript
// git rev-parse --git-common-dir behaviour:
//   main repo → relative ".git"      → resolve against process.cwd()
//   worktree  → absolute "/path/.git" → use as-is
// dirname of the resolved .git path is the canonical repo root in both cases.
// Falls back to __dirname arithmetic in non-git environments (test runners, CI etc.).
function resolveRepoRoot(): string {
    try {
        const result = spawnSync('git', ['rev-parse', '--git-common-dir'], { encoding: 'utf8' });
        if (result.error || result.status !== 0 || !result.stdout.trim()) {
            throw new Error('git unavailable');
        }
        const gitCommonDir = result.stdout.trim();
        const resolved = path.isAbsolute(gitCommonDir)
            ? gitCommonDir
            : path.resolve(process.cwd(), gitCommonDir);
        return path.dirname(resolved);
    } catch {
        return path.resolve(__dirname, '../..');
    }
}

export const REPO_ROOT = resolveRepoRoot();
```

`TASKS_DIR`, `TASK_SH`, and `WORKTREES_ROOT` all derive from `REPO_ROOT` and require no changes — they pick up the corrected value automatically.

---

## Step 4 — `scripts/run-task/worktree.ts`: add `PIPELINE_MANAGED_DOCS`, fix sync guard, expand flush, add `notes.md`

**4a. Add `PIPELINE_MANAGED_DOCS` constant** — exported, directly below `PIPELINE_TELEMETRY_FILES`:
```typescript
export const PIPELINE_MANAGED_DOCS = [
    'docs/architecture.md',
    'docs/codebase-map.md',
    'docs/decisions.md',
    'docs/patterns.md',
    'docs/product-context.md',
] as const;
```

**4b. Add `notes.md` to `TASK_ARTIFACT_FILES`**:
```typescript
export const TASK_ARTIFACT_FILES = new Set([
    'spec.md', 'spec-review.md', 'plan.md', 'handoff.md', 'review.md', 'done.md', 'notes.md',
]);
```

**4c. Fix `syncWorktreeTelemetry` byte-length guard** — in the `needsCopy` block inside the `if (!needsCopy)` branch, replace:
```typescript
// Before:
needsCopy = !a.equals(b);
// After (append-only guard — only overwrite when worktree has strictly more bytes):
needsCopy = a.length > b.length;
```
The `let needsCopy = !fs.existsSync(dest);` initializer (first-copy-when-dest-absent) remains unchanged.

**4d. Expand `flushWorktreeTelemetry` to also flush `PIPELINE_MANAGED_DOCS`** — replace the first line of the function body:
```typescript
// Before:
const present = PIPELINE_TELEMETRY_FILES.filter(f => fs.existsSync(path.join(REPO_ROOT, f)));
// After:
const allFiles = [...PIPELINE_TELEMETRY_FILES, ...PIPELINE_MANAGED_DOCS];
const present = allFiles.filter(f => fs.existsSync(path.join(REPO_ROOT, f)));
```
The rest of the function body (porcelain status check, `gitSafe('add')`, staged check, commit) is unchanged.

---

## Step 5 — `scripts/run-task/validation.ts`: replace regex AC check with table parser

**5a. Add exported `checkAcCoveragePlaceholders(handoffContent: string): string[]`** — pure function, no disk I/O, placed just above `validateHandoff()`:

```typescript
export function checkAcCoveragePlaceholders(handoffContent: string): string[] {
    const acSectionMatch = handoffContent.match(/## AC Coverage[\s\S]*?(?=\n## |$)/);
    if (!acSectionMatch) return ['AC Coverage section is missing'];

    const section = acSectionMatch[0];
    // Collect only pipe-delimited table lines within the section.
    const tableLines = section.split('\n').filter(l => l.trim().startsWith('|'));
    if (tableLines.length === 0) return ['AC Coverage table is missing or contains no AC rows'];

    // Locate Status column by header name (position may vary across projects).
    const headerLine = tableLines[0];
    const headers = headerLine.split('|').map(h => h.trim()).filter(Boolean);
    const statusColIdx = headers.findIndex(h => h.toLowerCase() === 'status');
    if (statusColIdx === -1) return []; // no Status column — can't check; treat as clean

    // tableLines[1] is the separator row; data rows start at index 2.
    const dataRows = tableLines.slice(2);
    if (dataRows.length === 0) return ['AC Coverage table is missing or contains no AC rows'];

    const PLACEHOLDER = 'Met / Partial / Not met';
    const allPlaceholder = dataRows.every(line => {
        const cells = line.split('|').map(c => c.trim()).filter(Boolean);
        return (cells[statusColIdx] ?? '') === PLACEHOLDER;
    });

    if (allPlaceholder) {
        return [
            'AC Coverage table only contains template placeholder rows (Status "Met / Partial / Not met") — fill in actual AC statuses',
        ];
    }
    return [];
}
```

**5b. Update `validateHandoff()`** — delete the existing `acSectionMatch` block (the `if (!acSectionMatch)` branch and the `else { const section = ...` block that follow it) and replace with a single call:
```typescript
issues.push(...checkAcCoveragePlaceholders(content));
```
The `Fail` result check (`if (/\|\s*Fail\s*\|/i.test(content))`) and the outer `try/catch` remain unchanged.

---

## Step 6 — `scripts/run-task/main.ts`: dry-run early exit, extend `skipAgentDeps`, add `human_review` case

**6a. Update the `cliArgs` default** (currently lines 66–75) — add `dryRun: false`:
```typescript
let cliArgs: CliArgs = {
    taskIds: [],
    interactive: false,
    step: false,
    expectPhase: null,
    push: false,
    pr: false,
    reroute: false,
    ship: false,
    dryRun: false,
};
```

**6b. Extend `skipAgentDeps`** (currently line 1293):
```typescript
// Before:
const skipAgentDeps = cliArgs.ship;
// After:
const skipAgentDeps = cliArgs.ship || cliArgs.dryRun;
```

**6c. Add dry-run early-exit block** — insert immediately after `checkDeps(cliArgs.taskIds, skipAgentDeps);` and before the `if (cliArgs.ship)` block:

```typescript
if (cliArgs.dryRun) {
    const state = buildPipelineState(cliArgs.taskIds);
    const label = state.isBundle
        ? `bundle (${state.tier} tier): ${cliArgs.taskIds.join(', ')}`
        : `${cliArgs.taskIds[0]} — ${state.tasks[0].title} (${state.tier} tier)`;
    console.log(`Dry run — ${label}`);
    console.log('');
    const tierSkipsSpecReview = state.tier === 'fast';
    for (const phaseKey of PHASE_ORDER) {
        if (phaseKey === 'human_review') {
            console.log(`  ${'human_review'.padEnd(13)} agent=none  (commit/push via --push/--pr)`);
            continue;
        }
        if (tierSkipsSpecReview && phaseKey === 'spec_review') {
            console.log(`  ${'spec_review'.padEnd(13)} [skipped — fast tier]`);
            continue;
        }
        const isClaudePhase = (
            phaseKey === 'spec' || phaseKey === 'plan' ||
            phaseKey === 'code_review' || phaseKey === 'qa'
        );
        if (isClaudePhase) {
            const cfg = splitPolicy.getClaudeConfig(
                phaseKey as splitTypes.ClaudePhase, state.tasks,
            );
            console.log(`  ${phaseKey.padEnd(13)} agent=claude  model=${cfg.model}  effort=${cfg.effort}`);
        } else {
            const cfg = splitPolicy.getCodexConfig(
                phaseKey as splitTypes.CodexPhase, state.tasks,
            );
            console.log(`  ${phaseKey.padEnd(13)} agent=codex   model=${cfg.model}  effort=${cfg.effort}`);
        }
    }
    process.exit(0);
}
```

**6d. Add `'human_review'` case to `runPhase()`** — insert before the final `die('Unknown phase: ...')`:

```typescript
if ((phase as string) === 'human_review') {
    const taskIds = tasks.map(t => t.taskId);
    const doneFiles = taskIds.map(id => `  tasks/${id}/done.md`).join('\n');

    if (!cliArgs.push && !cliArgs.pr) {
        // No-push path: notify and exit cleanly (once per bundle).
        console.log('');
        console.log('════════════════════════════════════════════════════════');
        console.log('  ✅  HUMAN REVIEW — Pipeline complete. Test manually:');
        console.log('');
        console.log(doneFiles);
        console.log('');
        console.log('  Re-run with --push or --pr when ready to ship.');
        console.log('════════════════════════════════════════════════════════');
        console.log('');
        process.exit(0);
    }

    // Push/PR path: commit all dirty pipeline-managed files, push, optionally create PR.
    // All of this happens once per bundle (taskIds contains all bundle members).
    const artifactPaths: string[] = taskIds.flatMap(id => {
        const dir = `tasks/${id}`;
        return [...splitWorktree.TASK_ARTIFACT_FILES].map(f => `${dir}/${f}`);
    });
    const managedFiles: string[] = [
        ...splitWorktree.PIPELINE_TELEMETRY_FILES,
        ...splitWorktree.PIPELINE_MANAGED_DOCS,
    ];
    const allFiles = [...artifactPaths, ...managedFiles];

    // Stage only files that exist and are dirty; committing an empty set is a hard abort.
    const statusResult = gitSafe('status', '--porcelain', ...allFiles);
    if (statusResult.ok && statusResult.stdout.trim()) {
        for (const f of allFiles) gitSafe('add', '--', f);
        const staged = gitSafe('diff', '--cached', '--name-only');
        if (staged.stdout.trim()) {
            const label = taskIds.length === 1 ? taskIds[0] : taskIds.join(', ');
            const commitResult = gitSafe('commit', '-m', `chore: task artifacts for ${label}`);
            if (!commitResult.ok) die(`Artifact commit failed: ${commitResult.stderr}`);
        }
    }

    // Push the task branch.
    const branch = splitGit.getCurrentBranch();
    info(`Pushing ${branch}...`);
    git('push', '-u', 'origin', branch);

    // Create draft PR if --pr (guarded by ghAvailable, already checked in checkDeps).
    if (cliArgs.pr) {
        if (!ghAvailable) die('--pr requires gh CLI. Install gh or use --push instead.');
        const title = tasks.length === 1
            ? tasks[0].title
            : `[bundle] ${taskIds.join(', ')}`;
        const body = taskIds.map(id => `- tasks/${id}/done.md`).join('\n');
        const prResult = splitGit.runCommand('gh', [
            'pr', 'create', '--draft',
            '--title', title,
            '--body', body,
        ]);
        if (!prResult.ok) die(`gh pr create failed: ${prResult.stderr}`);
        info(`Draft PR created: ${prResult.stdout.trim()}`);
    }

    process.exit(0);
}
```

Note: `splitGit.getCurrentBranch` is already imported via `splitGit`. `gitSafe`, `git`, `ghAvailable`, `die`, `info` are all in scope in `main.ts`.

---

## Step 7 — `tests/run-task-validation.test.ts`: add AC Coverage table-parser tests

Update the import to add `checkAcCoveragePlaceholders`:
```typescript
import {
    validateHandoffAgainstSpec,
    verifyHandoffAgainstDiffFromData,
    checkAcCoveragePlaceholders,
} from '../scripts/run-task/validation.js';
```

Add two test cases at the end of the file:

**Test (a) — prose line with placeholder text in AC Coverage does not false-positive**:
```typescript
void test('checkAcCoveragePlaceholders: prose in AC Coverage with placeholder text does not fire', () => {
    const content = [
        '## AC Coverage',
        '',
        'See AC-1 for the Met / Partial / Not met breakdown.',
        '',
        '| AC | Description | Status |',
        '|---|---|---|',
        '| AC-1 | Does X | Met |',
        '',
    ].join('\n');
    const issues = checkAcCoveragePlaceholders(content);
    assert.deepEqual(issues, []);
});
```

**Test (b) — all-placeholder Status cells fires the issue**:
```typescript
void test('checkAcCoveragePlaceholders: all-placeholder Status cells fires issue', () => {
    const content = [
        '## AC Coverage',
        '',
        '| AC | Description | Status |',
        '|---|---|---|',
        '| AC-1 | Does X | Met / Partial / Not met |',
        '| AC-2 | Does Y | Met / Partial / Not met |',
        '',
    ].join('\n');
    const issues = checkAcCoveragePlaceholders(content);
    assert.equal(issues.length, 1);
    assert.ok(issues[0].includes('placeholder'));
});
```

---

## Step 8 — `docs/pipeline-orchestrator.md`: update Flags table and Auto-Commit section

**Flags table** (in the `### Flags` section): add a `--dry-run` row after `--ship`:
```markdown
| `--dry-run` | — | Print each planned phase (agent, model, effort) and exit — no LLM is spawned. Skips `claude`/`codex` dep check; still requires `jq` and a valid task ID. |
```

**Auto-Commit section** (wherever it describes what `--push`/`--pr` commits at `human_review`): add a sentence noting that `PIPELINE_MANAGED_DOCS` (the five protected docs: `docs/architecture.md`, `docs/codebase-map.md`, `docs/decisions.md`, `docs/patterns.md`, `docs/product-context.md`) are staged alongside task artifacts and telemetry, so QA-phase Docs Freshness edits land in the same artifact commit rather than left dirty post-push.

---

## Step 9 — Validate

Run in order:
```bash
npm run lint
npm run type-check
npm test
```

All three must pass before marking done.

---

## Implementation order summary

1. `types.ts` (Step 1) — unblocks Steps 2 and 6a/6b/6c.
2. `cli.ts` (Step 2) — no behavior change until main.ts consumes `dryRun`.
3. `env.ts` (Step 3) — independent; can be done in any order.
4. `worktree.ts` (Step 4) — independent; must be done before Step 6d (human_review handler uses the new exports).
5. `validation.ts` (Step 5) — independent; must be done before Step 7.
6. `main.ts` (Step 6) — depends on Steps 1, 2, 4.
7. `tests/run-task-validation.test.ts` (Step 7) — depends on Step 5.
8. `docs/pipeline-orchestrator.md` (Step 8) — independent; do last.
9. Validate (Step 9).
