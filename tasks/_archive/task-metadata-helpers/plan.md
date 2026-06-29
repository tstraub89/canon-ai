# Plan: task-metadata-helpers — `canon task set` metadata helper

> Authored by: Claude | Implemented by: Codex

## Approach

Add a `taskSet()` function to `src/task/index.ts` following the identical shape as every other mutator in that file (`readJsonFile` → validate → mutate → `writeStatusAtomic`). The three-category field taxonomy (settable / redirect / immutable) is encoded as two sets and one map so each field dispatches to exactly one outcome with a deterministic message. Export `validateBranchField` from `scripts/run-task/state.ts` to keep a single validation home for `base_branch`.

## Steps

### Step 1 — Export `validateBranchField` from `scripts/run-task/state.ts`

**File**: `scripts/run-task/state.ts`, line 117.

Change `function validateBranchField(...)` → `export function validateBranchField(...)`.

Currently module-private. `taskSet` needs the same leading-dash / control-char / `:` rejections for `base_branch`. Exporting keeps one validation home per the spec Design note. The function signature and behavior are unchanged; all existing call sites within `state.ts` are unaffected.

> **Addendum for `base_branch` in `taskSet`**: `validateBranchField` tolerates empty string (it returns early when `trimmed === ''`, because at parse time an empty branch is valid). For `set`, an empty or whitespace-only value must be rejected — `set` is an explicit write. Add an explicit empty-string check **before** calling `validateBranchField` inside `taskSet`, not inside the exported function itself (which would break parse-time callers).

---

### Step 2 — Implement `taskSet()` in `src/task/index.ts`

Add at the bottom of the file, before `taskCmd()`. Reuse existing module-level helpers: `readJsonFile`, `writeStatusAtomic`, `today`, `validateTaskId`, `taskDirFromRoot`. Import `TaskSize` from `scripts/pipeline-policy.ts` and `validateBranchField` from `scripts/run-task/state.ts`.

#### 2a — Field taxonomy

Define as module-level constants (or inside the function — keep them collocated with `taskSet` for readability):

```typescript
const SETTABLE_FIELDS = new Set(['title', 'task_size', 'delicate', 'worktree', 'base_branch']);

const REDIRECT_FIELDS: Record<string, string> = {
    full_send:
        'a per-run stance, not durable metadata. Enable it with `canon run --full-send <id>`, which also clears the spec gate and enforces the delicate→`--force` guard.',
    human_spec_gate:
        'the spec gate is self-clearing. Re-run `canon run <id>` to proceed past it, or `canon run --full-send <id>` to skip it entirely.',
    status:
        'derived from phase states. Use `canon task phase <id> <phase> <status>`.',
    branch:
        'load-bearing git identity; retargeting it desyncs the worktree. Not settable via `canon task set`.',
    phases:
        'nested orchestrator-owned state. Use `canon task phase` / `reset-spec-review` / `reset-code-review` / `accept`; review/iteration counters are durable signal and must not be hand-reset.',
    sessions:
        'nested orchestrator-owned state. Use `canon task phase` / `reset-spec-review` / `reset-code-review` / `accept`; review/iteration counters are durable signal and must not be hand-reset.',
    canon:
        'nested orchestrator-owned state. Use `canon task phase` / `reset-spec-review` / `reset-code-review` / `accept`; review/iteration counters are durable signal and must not be hand-reset.',
    escalations:
        'nested orchestrator-owned state. Use `canon task phase` / `reset-spec-review` / `reset-code-review` / `accept`; review/iteration counters are durable signal and must not be hand-reset.',
};

const IMMUTABLE_FIELDS = new Set(['id', 'created', 'updated']);
const VALID_SIZES: readonly string[] = ['XS', 'S', 'M', 'L', 'XL'];
```

#### 2b — Function signature and argument parsing

```typescript
export function taskSet(args: string[]): void {
    const [id, field, value] = args;
    if (!id || !field || value === undefined) {
        throw new Error('Error: usage: canon task set <TASK-ID> <field> <value>');
    }
    validateTaskId(id);
    // ... routing below
}
```

`value` may legitimately be `'false'` or `''` at the CLI level, so check `value === undefined`, not `!value`.

#### 2c — Field routing (in order)

```typescript
    if (IMMUTABLE_FIELDS.has(field) || field.startsWith('_')) {
        throw new Error(`'${field}' is immutable and cannot be edited.`);
    }
    if (field in REDIRECT_FIELDS) {
        throw new Error(`'${field}' is ${REDIRECT_FIELDS[field]}`);
    }
    if (!SETTABLE_FIELDS.has(field)) {
        throw new Error(
            `Unknown field '${field}'. Settable fields: ${[...SETTABLE_FIELDS].join(', ')}. ` +
            `Some fields have redirect guidance — try \`canon task set <id> <field> <value>\` on a guarded field to see it.`
        );
    }
```

#### 2d — Per-field validation (only reached for settable fields)

```typescript
    switch (field) {
        case 'task_size':
            if (!VALID_SIZES.includes(value)) {
                throw new Error(`Invalid task_size '${value}'. Must be one of: ${VALID_SIZES.join(', ')}.`);
            }
            break;
        case 'delicate':
        case 'worktree': {
            const lower = value.toLowerCase();
            if (lower !== 'true' && lower !== 'false') {
                throw new Error(`Invalid ${field} '${value}'. Must be 'true' or 'false'.`);
            }
            break;
        }
        case 'base_branch':
            if (!value.trim()) {
                throw new Error(`Invalid base_branch: value must not be empty or whitespace-only.`);
            }
            validateBranchField(value, id, 'base_branch');
            break;
        case 'title':
            if (value.includes('\n')) {
                throw new Error(`Invalid title: must be single-line (no embedded newlines).`);
            }
            break;
    }
```

#### 2e — Read status, check past-pending, write

```typescript
    const statusPath = path.join(taskDirFromRoot(id), 'status.json');
    const status = readJsonFile<StatusJson>(statusPath);

    const started = Object.values(status.phases).some(
        p => p?.status === 'in_progress' || p?.status === 'done'
    );
    if (started) {
        console.warn(
            `Warning: '${field}' updated. This change takes effect on the next \`canon run\` — phases already dispatched used the previous value.`
        );
    }

    // Apply the validated value.
    switch (field) {
        case 'task_size':
            (status as Record<string, unknown>).task_size = value;
            break;
        case 'delicate':
            (status as Record<string, unknown>).delicate = value.toLowerCase() === 'true';
            break;
        case 'worktree':
            (status as Record<string, unknown>).worktree = value.toLowerCase() === 'true';
            break;
        case 'base_branch':
            (status as Record<string, unknown>).base_branch = value;
            break;
        case 'title':
            (status as Record<string, unknown>).title = value;
            break;
    }

    status.updated = today();
    writeStatusAtomic(statusPath, status);
    console.log(`Set ${field}=${value} on task ${id}.`);
```

> Use `(status as Record<string, unknown>).field = value` to avoid `noUncheckedIndexedAccess` TS complaints on the StatusJson type. Alternatively, cast through the specific field types — match whatever TypeScript approach the codebase already uses in existing mutators.

---

### Step 3 — Register in `taskCmd()`

Add `case 'set':` before `default:`:

```typescript
case 'set':
    taskSet(rest);
    break;
```

The existing `try/catch` in `taskCmd()` propagates the throw from `taskSet` and exits non-zero, which is the correct behavior for all refusal paths.

---

### Step 4 — Update `usage()`

Insert after the `accept` line (keeping logical grouping with mutation commands):

```typescript
'  set <TASK-ID> <field> <value>',
```

---

### Step 5 — Update `src/cli/index.ts`

Find the `canon task subcommands` help block. Add a `set` line:

```
  set <TASK-ID> <field> <value>   Set a task metadata field (title, task_size, delicate, worktree, base_branch)
```

---

### Step 6 — Update `docs/pipeline-orchestrator.md`

In the task-subcommand reference table (~line 119, near `reset-spec-review` / `reset-code-review`), add a `set` row:

| `set` | `<id> <field> <value>` | Set a flat top-level metadata field. **Settable:** `title`, `task_size` (`XS`/`S`/`M`/`L`/`XL`), `delicate` (`true`/`false`), `worktree` (`true`/`false`), `base_branch`. **Redirected:** `full_send` → `canon run --full-send`; `human_spec_gate` → re-run `canon run`; `status` → `canon task phase`; `branch` → git identity, not via set; `phases`/`sessions`/`canon`/`escalations` → their owning commands. **Immutable:** `id`, `created`, `updated`, `_*` keys. A write on a task past `pending` succeeds but warns the change takes effect on the next `canon run`. |

---

### Step 7 — Update `AGENTS.md`

In the `canon task` command list (line 37), add `set` between `accept` and `reset-spec-review`:

```
`canon task new`, `list`, `status`, `phase`, `accept`, `set`, `reset-spec-review`, `reset-code-review`, `post-merge-sync`
```

---

### Step 8 — Tests (`tests/task-cli.test.ts`)

Use the existing `withTempDir`, `withCwd`, `makeStatus`, `captureStdout`, and `withEnv` harness. Write fixture status files via `CANON_TASKS_DIR_OVERRIDE`. Import and call `taskSet` directly (it throws on failure; `taskCmd` wraps into `process.exit(1)` but tests can assert on the thrown error from `taskSet` itself).

**AC-1 — settable write + derived state:**
```typescript
void test('taskSet: task_size write updates on-disk field and refreshes updated timestamp', () => {
    withTempDir('task-set-', dir => {
        const taskDir = path.join(dir, 'test-task');
        fs.mkdirSync(taskDir, { recursive: true });
        const statusFile = path.join(taskDir, 'status.json');
        const original = makeStatus('test-task', { task_size: 'S' });
        fs.writeFileSync(statusFile, JSON.stringify(original, null, 2) + '\n');
        withEnv({ CANON_TASKS_DIR_OVERRIDE: dir }, () => {
            taskSet(['test-task', 'task_size', 'L']);
        });
        const updated = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
        assert.equal(updated.task_size, 'L');
        assert.equal(updated.updated, new Date().toISOString().slice(0, 10));
        // status.status is consistent with phases (all pending → 'spec')
        assert.equal(updated.status, 'spec');
    });
});
```

**AC-2 — per-field validation:**

Cover each invalid shape with `assert.throws`. For `base_branch`, test: empty string, whitespace-only, leading-dash, embedded space, embedded `:`. For each, assert `throws` and then assert the file is byte-unchanged.

For valid values, assert the write succeeds (no throw).

**AC-3 — guarded fields (full_send, human_spec_gate):**
```typescript
assert.throws(() => taskSet(['t1', 'full_send', 'true']), /canon run --full-send/);
// assert file is byte-unchanged
assert.throws(() => taskSet(['t1', 'human_spec_gate', 'false']), /canon run/);
// assert file is byte-unchanged
```

**AC-4 — redirect group and immutable group:**
```typescript
// redirect group
assert.throws(() => taskSet(['t1', 'status', 'done']), /canon task phase/);
assert.throws(() => taskSet(['t1', 'branch', 'main']), /desyncs the worktree/);
assert.throws(() => taskSet(['t1', 'phases', 'x']), /canon task phase/);
// immutable group — message distinct from redirect (no sanctioned mechanism named)
assert.throws(() => taskSet(['t1', 'id', 'new-id']), /immutable/);
assert.throws(() => taskSet(['t1', 'created', '2026-01-01']), /immutable/);
assert.throws(() => taskSet(['t1', '_doc_note', 'x']), /immutable/);
```

**AC-5 — unknown field:**
```typescript
assert.throws(() => taskSet(['t1', 'nope', '1']), /task_size.*delicate.*worktree.*base_branch.*title/);
```
(Use a regex or check `message.includes('task_size')` etc.)

**AC-6 — past-pending warning:**
```typescript
// Started task: spec is 'done'
const startedStatus = makeStatus('t1', { phases: { ...makeStatus('t1').phases, spec: { status: 'done', agent: 'claude' } } });
// Seed, call taskSet, capture stderr/stdout, assert Warning line present.

// Pending task: all pending
// Call taskSet, assert no Warning line.
```

Use `captureStdout` (or mirror it for `console.warn`) to capture the warning output.

**AC-7 — dispatch routing:**
```typescript
// taskCmd(['set', 't1', 'task_size', 'M']) reaches taskSet and mutates the file.
// Assert on-disk task_size === 'M'.
```

---

### Step 9 — Build and validation (in order)

1. `npm run build`
2. `npm run sync-templates:check` — `docs/pipeline-orchestrator.md` is canon-managed; mirror must stay aligned
3. `npm run lint`
4. `npm run type-check`
5. `npm test`
6. `npm run docs-refs-check`

Declare in handoff Changes table:
- `templates/docs/pipeline-orchestrator.md` (generated — pre-commit sync hook)
- `dist/cli/index.js` (generated — `npm run build`)

---

## Affected Files Summary

| File | Role |
|---|---|
| `scripts/run-task/state.ts` | Export `validateBranchField` |
| `src/task/index.ts` | Add `taskSet()`, `case 'set':` in `taskCmd()`, update `usage()` |
| `src/cli/index.ts` | Add `set` to help text |
| `tests/task-cli.test.ts` | Tests for AC-1 through AC-7 |
| `docs/pipeline-orchestrator.md` | Add `set` row to subcommand table |
| `AGENTS.md` | Add `set` to command list |
| `templates/docs/pipeline-orchestrator.md` | Generated — pre-commit sync hook |
| `dist/cli/index.js` | Generated — `npm run build` |

---

## Reroute Plan

### Delta

The amendment adds two safety improvements (AC-A1 through AC-A5) surfaced by PR-level code review. The prior implementation (Iterations 1–2) already shipped the worktree-routing fix; this reroute implements the amendment-only delta plus clears the pre-existing docs-ref breakage that blocks the full test suite.

#### Step 1 — `args.length > 3` rejection in `taskSet()` (`src/task/index.ts`)

The amendment says "Retain the `args.length > 3` rejection" (amended Affected Files). Verify the guard is present in `taskSet()` immediately after argument destructuring. If it is absent, add it before the `IMMUTABLE_FIELDS` check:

```typescript
if (args.length > 3) {
    throw new Error('Unexpected argument. For multi-word values, quote the value: canon task set <id> title "My New Title"');
}
```

This matches `taskNew`'s reject-unexpected-positional contract (AC-A1). The test for this case is noted as "already covered" in the amended spec — confirm the test exists in `tests/task-cli.test.ts`; add it if missing.

#### Step 2 — Topology lock in `taskSet()` (`src/task/index.ts`, AC-A2/A3/A4)

After the existing redirect/immutable/unknown-field routing (which is unchanged) but **before** value parsing, add a topology guard for `worktree` and `base_branch`. The guard must read `status.branch` from the same `status.json` the mutator already resolves (via `resolveTaskCwd` → `taskDirFor(id)` path added in Iteration 2):

```typescript
if (field === 'worktree' || field === 'base_branch') {
    const statusPath = path.join(taskDirFor(id), 'status.json');
    const status = readJsonFile<StatusJson>(statusPath);
    if (status.branch) {
        throw new Error(
            `'${field}' is a topology field locked once a branch is recorded. ` +
            `Recorded branch: '${status.branch}'. ` +
            `To change the topology, recreate the task or migrate status.json manually.`
        );
    }
}
```

AC-A4 requires this guard fires before value parsing — place it before the per-field `switch` validation block, not inside it. AC-A3 is satisfied by not touching the metadata field paths (`title`, `task_size`, `delicate`).

Note on load ordering: the topology guard reads `status.json` before the main read at Step 2e. Either unify into a single early read or accept the double-read (both are safe since the file is not modified between them). Prefer unifying — read `status.json` once at the top of `taskSet()` and pass the loaded object to both the topology guard and the write path.

#### Step 3 — Tests for AC-A2/A3/A4 (`tests/task-cli.test.ts`)

Add the following test cases using the existing `withTempDir`/`makeStatus`/`CANON_TASKS_DIR_OVERRIDE` harness:

- **AC-A2 rejected when branched**: fixture with `branch: 'task/foo'` in status; assert `taskSet([id, 'worktree', 'false'])` throws and message names the field and recorded branch; assert `status.json` byte-unchanged. Repeat for `base_branch`.
- **AC-A2 succeeds when pre-branch**: fixture with `branch: ''` (or absent); assert write succeeds.
- **AC-A3**: fixture with `branch: 'task/foo'`; assert `taskSet([id, 'task_size', 'M'])` succeeds and warns (past-pending behavior, not the topology lock).
- **AC-A4**: fixture with `branch: 'task/foo'`; `taskSet([id, 'worktree', 'true'])` — value is valid, but topology guard fires first → throws lock error, not a validation error.

#### Step 4 — Docs update (`docs/pipeline-orchestrator.md` + `templates/` mirror, AC-A5)

Update the `set` row added in the prior iteration to document the two-class model. Add a **Topology lock** clause to the existing row, e.g.:

> **Topology fields** (`worktree`, `base_branch`) are locked once `branch` is recorded in `status.json`; further `set` calls on these fields are rejected with a message naming the recorded branch. Set them only in the pre-branch window (before `canon run` claims a branch).

The `templates/docs/pipeline-orchestrator.md` mirror is regenerated by the pre-commit sync hook; declare it in the handoff Changes table.

#### Step 5 — Fix broken docs-refs in review artifacts

The full test suite fails at `tests/run-task-safety.test.ts` due to broken refs in `tasks/task-metadata-helpers/review.md:71` and `tasks/canon-snapshot-robustness/review.md:35`. Locate and repair the broken path references in those review artifact files before the final validation run. Run `npm run docs-refs-check` to confirm clean.

#### Step 6 — Build and validate (in order)

1. `npm run build`
2. `npm run sync-templates:check`
3. `npm run lint`
4. `npm run type-check`
5. `npm test`
6. `npm run docs-refs-check`

Declare in handoff Changes table: `templates/docs/pipeline-orchestrator.md` (generated), `dist/cli/index.js` (generated), and any review artifact files repaired in Step 5.
