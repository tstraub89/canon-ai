# Plan: canon-self-contained — Bundle orchestrator + task CLI into dist/, drop bash/jq/tsx from runtime requirements

> Written by: Claude | Phase: plan

## Spec review nit incorporated

The `approved_with_nits` verdict flagged that **Human Test Plan step 2** does not say the directory must be canon-initialized before running `canon doctor`. The `doctorCmd()` canon-checks block (`src/cli/commands/doctor.ts:265-270`) will fail with missing `AGENTS.md`/`.canon/templates/` in a bare tempdir. This plan carries that clarification into the `done.md` QA artifact: note beneath step 2 that `canon init` must run first (consistent with AC-25 and the local smoke which already does `canon init` before `doctor`).

## Sequencing rationale

The Bootstrap & Self-Repair constraint (spec §Bootstrap, AC-27) controls sequencing: `scripts/task.sh` **must not be deleted** until (a) the TS task module is complete, (b) all callers of `runTaskShFor` are updated, (c) `phaseCommands()` emits `canon task phase` instead of the bash path, and (d) `npm run build` is clean. Delete the bash script and `task-sh.ts` last — if anything is missed, the pipeline can still fall back to bash during the implement iteration.

Sidecar decision (AC-6 open question): `canon-snapshot.ts` and `check-phase-gate.ts` **fold into the main bundle as in-process imports**. Neither relies on process-isolation properties (exit-code-as-signal, independent cwd) — they expose exported functions (`refreshCanonSnapshotAtPath`, `checkPhaseGate`) that the TS task module calls directly. Removing their standalone entry-point guards and calling them in-process is cleaner than maintaining two sidecar bundles. Document this decision in `handoff.md`.

Task module location: **`src/task/index.ts`** (spec's example). This gets bundled into `dist/cli/index.js`. Phase handlers import it via relative paths from `scripts/run-task/phases/` (3 levels up to project root: `../../../src/task/index.js`). `src/cli/commands/task.ts` imports it simply as `'../task/index.js'`. Both work because tsup resolves imports statically across the whole source tree.

## Implementation steps

---

### Step 1 — Build config: add orchestrator entry + `.md` loader (AC-6, AC-7, AC-7a)

**File: `tsup.config.ts`**

Change `entry` from a single-key object to include the orchestrator wrapper:

```ts
entry: {
    'cli/index': 'src/cli/index.ts',
    'scripts/run-task': 'scripts/run-task.ts',   // add this
},
```

Add a `loader` option so `.md` imports resolve as text strings at build time:

```ts
loader: { '.md': 'text' },
```

**File: `scripts/run-task/prompts/md-modules.d.ts` (new)**

```ts
declare module '*.md' {
    const content: string;
    export default content;
}
```

**File: `tsconfig.json`**

The existing `include` glob `"scripts/**/*.ts"` does not match `.d.ts` files. Add a second glob so tsc picks up the declaration:

```json
"include": ["scripts/**/*.ts", "scripts/**/*.d.ts", "tests/**/*.ts", "src/**/*.ts"]
```

Verify: `npm run type-check` must pass after Step 2 adds the static `.md` imports.

---

### Step 2 — Replace runtime template loading with static imports (AC-8, AC-9)

**File: `scripts/run-task/prompts/index.ts`**

At the top of the file, add 10 static imports (one per template file) and a lookup record:

```ts
import codeReviewRound1 from './templates/code-review-round-1.md';
import codeReviewRoundN from './templates/code-review-round-n.md';
import implementTmpl from './templates/implement.md';
import implementRevisions from './templates/implement-revisions.md';
import implementReroute from './templates/implement-reroute.md';
import planTmpl from './templates/plan.md';
import qaTmpl from './templates/qa.md';
import specTmpl from './templates/spec.md';
import specRevision from './templates/spec-revision.md';
import specReview from './templates/spec-review.md';

const TEMPLATES: Record<string, string> = {
    'code-review-round-1.md': codeReviewRound1,
    'code-review-round-n.md': codeReviewRoundN,
    'implement.md': implementTmpl,
    'implement-revisions.md': implementRevisions,
    'implement-reroute.md': implementReroute,
    'plan.md': planTmpl,
    'qa.md': qaTmpl,
    'spec.md': specTmpl,
    'spec-revision.md': specRevision,
    'spec-review.md': specReview,
};
```

Remove these declarations (no longer needed):
- `import fs from 'node:fs'`
- `import path from 'node:path'`
- `import { fileURLToPath } from 'node:url'`
- `const __filename = ...` and `const __dirname = ...`
- `const TEMPLATE_DIR = path.join(__dirname, 'templates')`
- `const TEMPLATE_CACHE = new Map<string, string>()`

Rewrite `loadTemplate()` to use the static map:

```ts
function loadTemplate(name: string): string {
    const tmpl = TEMPLATES[name];
    if (!tmpl) throw new Error(`Unknown template: ${name}`);
    return tmpl;
}
```

The `render()` helper and all 11 `render(...)` call sites remain unchanged (AC-9 satisfied).

---

### Step 3 — Create TS task module (AC-11, AC-12, AC-13, AC-14, AC-15)

**New file: `src/task/index.ts`**

This module is the 1:1 TypeScript port of `scripts/task.sh`. It exports one function per subcommand plus a `taskCmd(args: string[]): void` dispatcher.

#### 3a — Module-level helpers

```ts
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveTaskCwd } from '../../scripts/run-task/state.js';
import { checkPhaseGate } from '../../scripts/run-task/validation.js';
import { refreshCanonSnapshotAtPath } from '../../scripts/run-task/canon-snapshot.js';
import type { Phase } from '../../scripts/run-task/types.js';
```

Constants (mirrors `task.sh` validation):

```ts
const PHASE_ORDER_LIST = ['spec','spec_review','plan','implement','code_review','qa','human_review'] as const;
const VALID_PHASES = new Set<string>(PHASE_ORDER_LIST);
const VALID_STATUSES = new Set(['pending','in_progress','done','changes_requested','blocked']);
const VALID_VERDICTS = new Set(['approved','approved_with_nits','changes_requested','needs_re_review']);
const REVIEW_PHASES = new Set(['spec_review','code_review']);
```

Task ID validation (mirrors `validate_task_id`):

```ts
function validateTaskId(id: string): void {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(id))
        throw new Error(`invalid task ID '${id}'. Must be lowercase alphanumeric, hyphens, dots, or underscores. No slashes, spaces, or leading special characters.`);
    if (id.includes('..'))
        throw new Error(`invalid task ID '${id}'. Must not contain '..'`);
}
```

Atomic status.json write (mirrors `jq … > tmp && mv tmp file`):

```ts
function writeStatusAtomic(filePath: string, data: unknown): void {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, filePath);
}
```

Top-level status derivation (mirrors `derive_top_level` in the jq of `cmd_phase`):

```ts
function deriveTopLevel(phases: Record<string, { status?: string }>): string {
    return PHASE_ORDER_LIST.find(p => (phases[p]?.status ?? 'pending') !== 'done') ?? 'complete';
}
```

Tasks directory resolution (honors `CANON_TASKS_DIR_OVERRIDE` the way `resolveTaskCwd` does):

```ts
function tasksDir(): string {
    return process.env.CANON_TASKS_DIR_OVERRIDE ?? 'tasks';
}
```

Git helper (runs a git command, returns trimmed stdout, throws on error):

```ts
function git(args: string[], opts?: { cwd?: string }): string {
    const r = spawnSync('git', args, { encoding: 'utf8', cwd: opts?.cwd ?? process.cwd() });
    if (r.error || r.status !== 0)
        throw new Error(r.stderr?.trim() || `git ${args[0]} failed`);
    return r.stdout.trim();
}
```

Today's date:

```ts
function today(): string {
    return new Date().toISOString().slice(0, 10);
}
```

#### 3b — `taskNew(id, title, baseBranch?)` (mirrors `cmd_new`)

1. Validate task ID; reject embedded newline in title.
2. Auto-detect `baseBranch` from `git branch --show-current` if not provided; default `'main'`.
3. Compute `taskDir = path.join(tasksDir(), id)`. Reject if already exists.
4. `fs.mkdirSync(taskDir, { recursive: true })`.
5. Copy templates: iterate `.canon/templates/*.md` and `.canon/templates/*.json`. For each, check `tasks/_templates/<basename>` override first. Replace the `TASK-ID` and `Title` template placeholders (bracket-delimited, as present in the template files) with `String.replace(...)` (global replace — not sed).
6. Read `tasks/<id>/status.json`, parse, set `.id`, `.title`, `.created = today()`, `.updated = today()`, `.base_branch = baseBranch`. Write atomically.
7. Call `refreshCanonSnapshotAtPath(path.join(taskDir, 'status.json'))`. Wrap in try/catch — on failure, print warning to stderr (mirrors bash `else echo Warning`).
8. Print output verbatim to match bash: `"Created task: ${taskDir}"`, file listing, next-steps block.

#### 3c — `taskList()` (mirrors `cmd_list`)

1. Glob `tasks/*/status.json`. Skip `tasks/_archive/`.
2. For each: parse status.json, derive phase via `deriveTopLevel(data.phases ?? {})`.
3. Print header and rows with same column widths (25/40/remaining) using `String.padEnd`.
4. If no tasks found, print `"No tasks found."`.

#### 3d — `taskStatus(id)` (mirrors `cmd_status`)

1. Validate task ID.
2. Route to worktree: `const cwd = resolveTaskCwd(id)`.
3. Compute `statusFile = path.join(cwd, tasksDir(), id, 'status.json')`. Error if missing.
4. Print `JSON.stringify(JSON.parse(fs.readFileSync(statusFile, 'utf8')), null, 2)`.

#### 3e — `taskPhase(id, phase, status, verdict?)` (mirrors `cmd_phase`, AC-13)

This is the most complex subcommand. Follow `cmd_phase` exactly:

1. Validate task ID, phase, status. Validate verdict usage (review phases only, valid set).
2. Route to worktree: `const cwd = resolveTaskCwd(id)`.
3. Compute `statusFile = path.join(cwd, tasksDir(), id, 'status.json')`. Error if missing.
4. Out-of-order guard (when status ≠ `'pending'`): find this phase's index; collect prior phases whose status ≠ `'done'`; throw if any.
5. Phase gate (when status === `'done'` and `!process.env.CANON_SKIP_PHASE_GATE`): call `checkPhaseGate(id, phase as Phase, verdict)`. The function throws on rejection.
6. Read and parse `status.json`.
7. Init the phase entry if absent: `data.phases[phase] ??= { status: 'pending', agent: '' }`.
8. Set `data.phases[phase].status = status`, `data.updated = today()`.
9. If verdict provided and the phase entry already has a `verdict` key: set it.
10. Counter updates for review phases — mirror the jq logic from `cmd_phase` lines 412-427:
    ```ts
    if (REVIEW_PHASES.has(phase)) {
        const p = data.phases[phase];
        p.iterations_current_loop ??= p.iterations ?? 0;
        p.iterations_total ??= p.iterations ?? 0;
        p.changes_requested_total ??= 0;
        p.auto_block_count ??= 0;
        if (verdict === 'changes_requested' || verdict === 'needs_re_review') {
            p.iterations_current_loop += 1;
            p.iterations_total += 1;
            p.changes_requested_total += 1;
            p.iterations = p.iterations_current_loop;
        } else if (verdict === 'approved' || verdict === 'approved_with_nits') {
            p.iterations_total += 1;
            p.iterations_current_loop = 0;
            p.iterations = 0;
        }
    }
    ```
11. Set `data.status = deriveTopLevel(data.phases)`.
12. Write atomically.
13. Print `"Updated ${id}: ${phase} → ${status}"` (with `" (verdict: ${verdict})"` suffix if verdict provided).

For testability: `CANON_SKIP_PHASE_GATE=1` env-var already bypasses the gate (same as bash). `CANON_TASKS_DIR_OVERRIDE` env-var is honored by `resolveTaskCwd` for worktree routing in tests.

#### 3f — `taskResetSpecReview(id)` (mirrors `cmd_reset_spec_review`)

1. Validate task ID. Route to worktree.
2. Archive existing `spec-review.md`: find first unused `spec-review-prior-N.md` slot, `fs.renameSync`.
3. Read/parse status.json.
4. Set: `phases.spec.status = 'done'`, `phases.spec_review.status = 'pending'`, `phases.spec_review.iterations = 0`, `phases.spec_review.iterations_current_loop = 0`, `phases.spec_review.verdict = ''`.
5. Delete `sessions.claude_spec` if `data.sessions` has the key.
6. Set `updated = today()`. Derive and set top-level status.
7. Write atomically. Print confirmation message matching bash output verbatim.

#### 3g — `taskPostMergeSync(branch?)` (mirrors `cmd_post_merge_sync`)

Port directly — pure git operations using the `git()` helper:
1. Resolve target branch (`git branch --show-current` or throw if detached).
2. Verify current branch matches target.
3. Check working tree is clean (`git status --porcelain`).
4. `git fetch origin <branch>`.
5. Compute ahead/behind using `git rev-list --count`.
6. Handle: in-sync → print; behind only → fast-forward pull; ahead with only telemetry changes → hard-reset; ahead with real changes → refuse.
7. Telemetry path regex (same as bash): `/^(docs\/pipeline-invocations\.md|docs\/task-quality-log\.md|docs\/lessons-learned\.md|tasks\/)/`.

#### 3h — `taskReleaseInit(version, opts?)` (mirrors `cmd_release_init`, AC-15)

Inject the push call for testability:

```ts
export function taskReleaseInit(
    version: string,
    opts?: { pushFn?: (branch: string) => void }
): void
```

Default push: `spawnSync('git', ['push', '-u', 'origin', branch], { stdio: 'inherit' })`.

Logic (mirror `cmd_release_init` exactly):
1. Validate version matches `/^\d+\.\d+\.\d+$/`; error if not.
2. Compute `short = 'v' + version.replace(/\.0$/, '')`, `branch = 'release/' + short`.
3. Verify on `main` (`git branch --show-current`); working tree is clean.
4. `git fetch origin main`; verify not behind.
5. Check local branch absent: `spawnSync('git', ['rev-parse', '--verify', branch])` — if exits 0, throw `"branch '${branch}' already exists locally."`.
6. Check remote branch absent: same for `origin/${branch}` — if exits 0, throw `"branch '${branch}' already exists on origin."`.
7. `git checkout -b <branch> main`.
8. Bump `package.json` and `package-lock.json` if present (atomic write).
9. Insert changelog block if `CHANGELOG.md` exists (same format as bash `awk` block: line 1 → line 1 + blank + `## <short> - unreleased` + blank + comment).
10. `git add` + `git commit`.
11. Call `opts?.pushFn?.(branch) ?? defaultPush(branch)`.
12. Print success message.

**Error message fidelity** (AC-15): the second-run guard throws messages matching bash exactly — `"Error: branch '${branch}' already exists locally."` / `"Error: branch '${branch}' already exists on origin."`. These are caught by `taskCmd` dispatcher and printed to stderr before `process.exit(1)`.

#### 3i — `taskCmd(args)` dispatcher

```ts
export function taskCmd(args: string[]): void {
    const [sub, ...rest] = args;
    try {
        switch (sub) {
            case 'new': { /* parse id/title/--base and call taskNew */ break; }
            case 'list': taskList(); break;
            case 'status': taskStatus(rest[0] ?? ''); break;
            case 'phase': taskPhase(rest[0] ?? '', rest[1] ?? '', rest[2] ?? '', rest[3]); break;
            case 'reset-spec-review': taskResetSpecReview(rest[0] ?? ''); break;
            case 'post-merge-sync': taskPostMergeSync(rest[0]); break;
            case 'release-init': taskReleaseInit(rest[0] ?? ''); break;
            default:
                console.error(`Unknown subcommand: ${sub ?? '(none)'}\nUsage: canon task <new|list|status|phase|reset-spec-review|post-merge-sync|release-init>`);
                process.exit(1);
        }
    } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}
```

---

### Step 4 — Update `phaseCommands()` in helpers.ts (AC-16a)

**File: `scripts/run-task/prompts/helpers.ts`**

Replace the entire `phaseCommands` function body. Before changing: verify `REPO_ROOT` is only used in `phaseCommands` (it is — the import is at line 1 of the file). Remove the `REPO_ROOT` import after the change.

New function:

```ts
export function phaseCommands(taskIds: string[], phase: string, status: string, verdict = ''): string {
    return taskIds.map(id => {
        const cmd = verdict
            ? `canon task phase ${id} ${phase} ${status} ${verdict}`
            : `canon task phase ${id} ${phase} ${status}`;
        return `(cd '${resolveTaskCwd(id)}' && ${cmd})`;
    }).join('\n');
}
```

Verify post-change: `grep -rn "scripts/task.sh" scripts/ src/` returns zero matches (AC-16a).

---

### Step 5 — Replace `runTaskShFor` calls in phase handlers and main.ts (AC-16)

**Files**:
- `scripts/run-task/phases/implement.ts` — `runTaskShFor` imported at line 9
- `scripts/run-task/phases/spec.ts`
- `scripts/run-task/phases/spec-review.ts`
- `scripts/run-task/phases/plan.ts`
- `scripts/run-task/phases/code-review.ts`
- `scripts/run-task/phases/qa.ts`
- `scripts/run-task/main.ts` — line 20 imports `task-sh.js`

In each file:

1. Remove: `import { runTaskShFor } from '../task-sh.js';`
2. Add: `import { taskPhase } from '../../../src/task/index.js';` (phases/) or `import { taskPhase } from '../../src/task/index.js';` (main.ts — 2 levels from `scripts/run-task/` to project root).
3. Replace `runTaskShFor(taskId, 'phase', taskId, phaseArg, statusArg)` with `taskPhase(taskId, phaseArg, statusArg)`.

Verify post-change: `grep -rn "runTaskShFor" scripts/ src/` returns zero matches (AC-16).

---

### Step 6 — Remove entry-point guards (AC-18)

**File: `scripts/run-task/main.ts`** (line 1715)

Remove the block:
```ts
if (process.argv[1] === __filename) {
    main().catch((err) => {
        console.error(err instanceof Error ? err.stack ?? err.message : err);
        process.exit(1);
    });
}
```

The `scripts/run-task.ts` wrapper is the sole invoker and the bundle entry. Also remove any now-unused `__filename` ESM imports from this file.

**File: `scripts/run-task/canon-snapshot.ts`** (line 94)

Remove:
```ts
const isMain = process.argv[1] ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false;
if (isMain) { ... }
```

This file is now a pure library module called in-process from `src/task/index.ts`.

**File: `scripts/run-task/check-phase-gate.ts`**

Remove the shebang line (`#!/usr/bin/env node --import tsx`) and the standalone `process.argv` parsing + invocation at the bottom of the file. Keep only the exports. This file is now called in-process from `src/task/index.ts` via `checkPhaseGate()`.

---

### Step 7 — Delete `TASK_SH` from env.ts (AC-17)

**File: `scripts/run-task/env.ts`**

Delete line 45:
```ts
export const TASK_SH = path.join(REPO_ROOT, 'scripts/task.sh');
```

Verify: `grep -rn "TASK_SH" scripts/ src/` returns zero matches (AC-17).

---

### Step 8 — Update `run-task.ts` CLI command (AC-10)

**File: `src/cli/commands/run-task.ts`**

Replace:
```ts
const runTaskScript = join(packageDir, 'scripts/run-task.ts');
function resolveTsx(): string { ... }
// spawnSync(resolveTsx(), [runTaskScript, ...args], ...)
```

With:
```ts
const runTaskScript = join(packageDir, 'dist/scripts/run-task.js');
// spawnSync(process.execPath, [runTaskScript, ...args], { stdio: 'inherit', cwd: process.cwd() })
```

Delete the `resolveTsx()` function entirely. Remove `existsSync` import if it is no longer used elsewhere in the file.

---

### Step 9 — Rewrite `task.ts` CLI command (AC-11)

**File: `src/cli/commands/task.ts`**

Replace the entire file with an in-process dispatcher. The existing export is `taskCmd(args: string[]): void` — keep the same export name. The new task module exports `taskCmd` too, so name the import differently to avoid shadowing:

```ts
import { taskCmd as runTask } from '../task/index.js';

export function taskCmd(args: string[]): void {
    runTask(args);
}
```

Delete: `taskScript` constant, `existsSync` import, `spawnSync` import, `fileURLToPath`/`dirname`/`join` imports if no longer needed.

---

### Step 10 — Doctor and deps cleanup (AC-19, AC-19a)

**File: `src/cli/commands/doctor.ts`**

In `RECOMMENDED_ALLOW` array (lines 21-43):
- Remove `'Bash(jq *)'` (line 24).
- Remove `'Bash(npx tsx *)'` (line 32).

In `doctorCmd()` body (line 259):
- Remove the `checkBinary('jq', true, 'brew install jq  (or https://jqlang.github.io/jq/)')` call entirely.

**File: `src/cli/deps.ts`**

In `HARD_DEPS` array (line 8-13):
- Remove the `{ cmd: 'jq', installHint: 'brew install jq  (or https://jqlang.github.io/jq/)' }` entry.

---

### Step 11 — `package.json` + `package-lock.json` (AC-1, AC-2, AC-3)

**File: `package.json`**

1. `files`: `["dist/", "templates/"]` — drop `"scripts/"` and `"public/"`.
2. `dependencies`: remove `"tsx": "^4.21.0"`.
3. `devDependencies`: add `"tsx": "^4.21.0"`.
4. `scripts`: remove `"task"` and `"run-task"` entries. Keep `"build"`, `"test"`, `"type-check"`, `"lint"`.

Run `npm install` to regenerate `package-lock.json` reflecting tsx moved to devDependencies. Commit the updated lock file.

---

### Step 12 — Delete bash script and task-sh.ts (AC-4, AC-5)

**Only after Steps 1–11 are complete and `npm run type-check` passes.**

```bash
git rm scripts/task.sh
git rm scripts/run-task/task-sh.ts
```

---

### Step 13 — Build and commit dist (AC-23, AC-24)

```bash
npm run build
```

Expected dist layout:
- `dist/cli/index.js` — CLI bundle (with shebang)
- `dist/scripts/run-task.js` — orchestrator bundle (with shebang)

```bash
git diff --exit-code -- dist/
```

If non-empty, stage and commit the updated `dist/` files. The committed dist must match a fresh build.

---

### Step 14 — Tests (AC-12 through AC-18)

**New file: `tests/task-cli.test.ts`**

Test structure follows the `node --test` + `tsx` pattern (see `tests/pipeline-policy.test.ts` for the pattern — uses `node:test` `describe`/`it` and `node:assert`).

#### AC-12 — Subcommand parity (happy path + at least one error path per subcommand)

Use a temp directory with a minimal `.canon/templates/` fixture (copy from `fixtures/` or create inline). Set `CANON_TASKS_DIR_OVERRIDE` and `CANON_SKIP_PHASE_GATE=1` in the test environment to control paths and bypass gate artifact checks.

**`new`**: valid id + title → `tasks/<id>/` created; `status.json` has `.id`, `.title`, `.base_branch`, `.created`. Error: existing dir → throws. Error: invalid ID → throws.

**`list`**: two tasks in fixture → prints table; empty → "No tasks found."

**`status`**: valid task → JSON printed. Missing task → throws.

**`phase`** (also AC-13): `taskPhase(id, 'spec', 'done')` → `status.json` top-level `status` becomes `'spec_review'`. Error: invalid phase name → throws. Error: out-of-order transition (marking `plan` done before `spec_review` is done) → throws with names of blocking phases.

**`reset-spec-review`**: creates `spec-review.md` first → archived as `spec-review-prior-1.md`; `status.json` reset. Missing task → throws.

**`post-merge-sync`**: dirty working tree guard → throws error. (Full git round-trip: use a tmp git repo if practical; otherwise mock git output.)

**`release-init`** (AC-15): use a temp git repo initialized with `main` + one commit + `package.json` + `CHANGELOG.md`. Inject `pushFn: () => {}`. Happy path: branch created, files bumped. Second-run (local branch exists): throws exact message `"branch 'release/v1.6' already exists locally."` and exits 1. Second-run (remote branch exists): throws `"branch 'release/v1.6' already exists on origin."` (mock `git rev-parse --verify origin/...` to succeed). Assert non-zero process exit code in both guard cases.

#### AC-14 — Worktree routing

1. Create a temp git repo with a linked worktree for `task/<id>`.
2. Call `taskPhase(id, 'spec', 'done')` with `CANON_SKIP_PHASE_GATE=1`.
3. Assert the worktree's `tasks/<id>/status.json` was updated (not the main checkout's copy).

#### AC-18 — Single invocation

After Step 13 builds `dist/scripts/run-task.js`, add a test that spawns:
```ts
spawnSync(process.execPath, ['dist/scripts/run-task.js', '--help'], { encoding: 'utf8' })
```
and asserts `status === 0` (or that stderr does not contain a double-invocation error). This verifies the entry-point guard removal did not break invocation.

#### Update existing tests

- Grep `tests/` for any imports of `task-sh.js` or references to `runTaskShFor` — replace with direct `taskPhase()` calls from the new module.
- If any test shells out to `scripts/task.sh` directly, replace with the TS equivalent.

---

### Step 15 — Docs updates

**`docs/codebase-map.md`**:
- "Task management helper" row: change `scripts/task.sh` → `src/task/index.ts`; update function list to `taskNew`, `taskList`, `taskStatus`, `taskPhase`, `taskResetSpecReview`, `taskPostMergeSync`, `taskReleaseInit`.

**`docs/patterns.md`**:
- "State Schema Discipline" → replace `scripts/task.sh` `cmd_phase()` reference with `taskPhase()` in `src/task/index.ts`.
- Trigger Table row for "Modifying `status.json` shape": replace `scripts/task.sh` with `src/task/index.ts`.

**`AGENTS.md`** (lines 112-117):
- Update code block from `./scripts/task.sh new <TASK-ID> <title>` etc. to `canon task new <TASK-ID> <title>` as the primary form (keeping the flag syntax: `canon task new <id> <title> [--base <branch>]`).

**`CLAUDE.md`**:
- Search for `task.sh` or `npx tsx scripts/run-task.ts` — update any found to `canon task` / `canon run`.

**`CODEX.md`**:
- Same search and update.

**`docs/architecture.md`**:
- "Tech Stack → Shell helpers" bullet (currently "bash + `jq` for status.json updates (`scripts/task.sh`)"): update to "TypeScript (`src/task/index.ts`) — no bash or jq required".
- Data flow step 1 (One-task lifecycle): change `./scripts/task.sh new <id> <title>` to `canon task new <id> <title>`.
- Data flow step 3: change `npx tsx scripts/run-task.ts <id>` to `canon run <id>`.

---

### Step 16 — Bootstrap & Self-Repair (AC-27)

Codex must mark implement phase done using the freshly-built bundle — not the prompt's pre-baked command (which points at the deleted `task.sh`):

```bash
node "$WORKTREE/dist/cli/index.js" task phase canon-self-contained implement done
```

Where `$WORKTREE` is the absolute path to the task's worktree. Document the exact invocation used in `handoff.md` under *Decisions made during implementation*, along with confirmation that `scripts/task.sh` was deleted last (after all other AC work completed).

---

## Validation sequence

Run in this order (each depends on prior steps):

1. After steps 1–11: `npm run lint` (AC-20), `npm run type-check` (AC-21)
2. After step 13 (build): `npm test` (AC-22), verify `dist/scripts/run-task.js` and `dist/cli/index.js` exist with shebangs (AC-23)
3. `git diff --exit-code -- dist/` (AC-24)
4. Local tarball smoke in a tmpdir (AC-26):
   - `npm pack` → extract → `node package/dist/cli/index.js --version` exits 0
   - `node package/dist/cli/index.js init` exits 0 (without `jq` on PATH — AC-19a)
   - `node package/dist/cli/index.js doctor` exits 0 or warn-only; jq absent from required list
   - `node package/dist/cli/index.js task new smoke "Smoke"` exits 0; creates `tasks/smoke/`
   - `node package/dist/scripts/run-task.js --help` exits 0
5. Structural greps confirming zero matches:
   - `grep -r "runTaskShFor" scripts/ src/` — AC-16
   - `grep -r "scripts/task.sh" scripts/ src/` — AC-16a
   - `grep -r "TASK_SH" scripts/ src/` — AC-17

---

## QA/done.md note (spec-review nit)

When writing `done.md`, add a callout beneath Human Test Plan step 2: **"The test directory must have already run `canon init` (or be an initialized canon project). Running `canon doctor` in a bare directory fails on the canon-setup checks (`AGENTS.md`, `.canon/templates/`, etc.) — not because of this task's changes, but because the doctor's canon-setup block requires these files. AC-25 and the local smoke correctly run `canon init` before `canon doctor`."**
