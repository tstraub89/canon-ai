# Plan: upgrade-template-override-nudge

> Written by: Claude | Implements: `tasks/upgrade-template-override-nudge/spec.md`

## Approach

Mirror the existing `cutoverWarnings` / `printDocsRefsCutoverWarning()` pattern exactly: add a field to `UpgradeResult`, populate it in `runUpgrade()`, print it from `upgradeCmd()`. The detection derives its basename set from `CANON_OWNED` (no hand-maintained copy) and resolves the override root through the shared `taskTemplateOverrideRoot()` resolver exported from `src/task/index.ts`. One export added to `task/index.ts`; all detection + print logic lives in `upgrade.ts`.

---

## Step 1 — Export `taskTemplateOverrideRoot()` from `src/task/index.ts`

**File**: `src/task/index.ts`

Change line 81 from:
```ts
function taskTemplateOverrideRoot(): string {
```
to:
```ts
export function taskTemplateOverrideRoot(): string {
```

No other changes. This is an export-only change — the function and its only dependency (`tasksRoot()`) already exist. No import cycle: `upgrade.ts` currently imports only `lib/canon-owned.js` + `lib/canon-block.js`; `task/index.ts` imports `scripts/run-task/*` (none of which import `commands/upgrade`). Confirm `tsc` / `npm run build` stays clean.

---

## Step 2 — Add `staleOverrides` field to `UpgradeResult`

**File**: `src/cli/commands/upgrade.ts`

Add to the `UpgradeResult` interface (after `cutoverWarnings`):
```ts
/** Task-template overrides that differ from canon templates changed by this upgrade run. */
staleOverrides: string[];
```

---

## Step 3 — Update imports in `upgrade.ts`

**File**: `src/cli/commands/upgrade.ts`

1. Add `basename` and `relative` and `resolve` to the existing `path` import:
   ```ts
   import { dirname, join, basename, relative, resolve } from 'path';
   ```
2. Add import of `taskTemplateOverrideRoot`:
   ```ts
   import { taskTemplateOverrideRoot } from '../../task/index.js';
   ```

---

## Step 4 — Compute `staleOverrides` in `runUpgrade()` after the dirty/clean split

**File**: `src/cli/commands/upgrade.ts`

The existing dirty-check section splits `pending` into `dirty` and `clean`. Insert the detection block **immediately after** that split (after the `for (const op of pending)` loop, before `if (options.check)`). Keying off `clean` (not `pending`) ensures that when `.canon/templates/<name>` is dirty and the run refuses, the template op is in `dirty` — absent from `clean` → `changedSet` misses it → `staleOverrides` is empty (AC-7).

```ts
// Detect stale task-template overrides (AC-1 through AC-12).
// Key off clean ops so a dirty .canon/templates/<name> does not trigger the
// nudge on the refusal path (AC-7): the dirty op is in `dirty`, not `clean`.
const staleOverrides: string[] = [];
{
    const templateBasenames = CANON_OWNED
        .filter(f => f.startsWith('.canon/templates/'))
        .map(f => basename(f));

    // path.resolve so an absolute CANON_TASKS_DIR_OVERRIDE is honored verbatim
    // rather than nested under cwd (AC-12 Known Risk).
    const overrideRootAbs = resolve(cwd, taskTemplateOverrideRoot());

    const changedSet = new Set(clean.map(op => op.rel));

    for (const name of templateBasenames) {
        const canonRel = `.canon/templates/${name}`;
        if (!changedSet.has(canonRel)) continue;          // AC-4: only if this run changed it

        const overridePathAbs = join(overrideRootAbs, name);
        if (!existsSync(overridePathAbs)) continue;       // AC-10: absent root or missing file

        const cleanOp = clean.find(op => op.rel === canonRel);
        if (!cleanOp) continue;                           // should not happen given changedSet

        const overrideContent = readFileSync(overridePathAbs, 'utf8');
        if (overrideContent === cleanOp.content) continue; // AC-5: suppress byte-identical

        // Store cwd-relative path so the printed diff command is copy-pasteable.
        staleOverrides.push(relative(cwd, overridePathAbs));
    }
}
```

Then add `staleOverrides` to all three `return` statements in `runUpgrade()`:

1. **`--check` return** (currently ends with `cutoverWarnings }`):
   ```ts
   return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, malformed, cutoverWarnings, staleOverrides };
   ```
2. **dirty-refusal return**:
   ```ts
   return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, malformed, cutoverWarnings, staleOverrides };
   ```
3. **final (apply) return**:
   ```ts
   return { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, malformed, cutoverWarnings, staleOverrides };
   ```

Grep for `return {` in `runUpgrade()` to confirm exactly three occurrences are updated.

---

## Step 5 — Add `printStaleOverrideNudge()` helper

**File**: `src/cli/commands/upgrade.ts`

Add alongside `printDocsRefsCutoverWarning()`:

```ts
function printStaleOverrideNudge(staleOverrides: string[], check: boolean): void {
    if (staleOverrides.length === 0) return;
    console.log(`Heads-up: the following task-template override(s) differ from canon templates ${check ? 'that would be' : ''} updated this run:`);
    console.log('  Your override files were NOT changed — reconcile manually:\n');
    for (const overridePath of staleOverrides) {
        const name = basename(overridePath);
        console.log(`  ↻ ${overridePath}`);
        console.log(`    diff .canon/templates/${name} ${overridePath}\n`);
    }
}
```

---

## Step 6 — Wire `printStaleOverrideNudge()` into `upgradeCmd()`

**File**: `src/cli/commands/upgrade.ts`

1. Destructure `staleOverrides` from `result`:
   ```ts
   const { upgraded, unchanged, skipped, wouldUpgrade, dirtyRefused, malformed, cutoverWarnings, staleOverrides } = result;
   ```

2. In the `--check` branch, add after the existing `cutoverWarnings` block:
   ```ts
   if (staleOverrides.length > 0) {
       printStaleOverrideNudge(staleOverrides, true);
   }
   ```

3. In the apply branch (after `cutoverWarnings`), add:
   ```ts
   if (staleOverrides.length > 0) {
       printStaleOverrideNudge(staleOverrides, false);
   }
   ```

The dirty-refusal branch calls `process.exit(2)` and `staleOverrides` is empty there per AC-7 — no print needed.

---

## Step 7 — Update `.canon/README.md` (AC-11)

**File**: `.canon/README.md` (root copy only — do not touch `templates/.canon/README.md`)

Replace the "After running `canon upgrade`, check whether structural changes…" paragraph + manual diff example with text explaining the automatic nudge:

```markdown
After running `canon upgrade`, the command automatically flags any task-template
overrides that differ from a canon template changed by that upgrade. For each
flagged override, run the suggested `diff` command to review the delta and
incorporate any structural changes into your customization:
```

Keep the existing `diff .canon/templates/spec.md tasks/_templates/spec.md` example block so users still see the concrete command — it just now illustrates the command the upgrade output prints rather than a step they must remember to do manually.

The pre-commit hook (`npm run sync-templates`) regenerates `templates/.canon/README.md` automatically. `npm run sync-templates:check` in CI validates the mirror.

---

## Step 8 — Tests in `tests/cli.test.ts`

All tests follow the existing double-`withTempDir` fixture pattern. Add a new section:
```
// ── runUpgrade staleOverrides ──────────────────────────────────────────────
```

### Shared helper

```ts
function setupTemplateUpgrade(
    projectDir: string,
    pkgDir: string,
    name: string,
    { oldContent, newContent }: { oldContent: string; newContent: string },
): void {
    const rel = `.canon/templates/${name}`;
    const tmplPath = path.join(pkgDir, 'templates', rel);
    fs.mkdirSync(path.dirname(tmplPath), { recursive: true });
    fs.writeFileSync(tmplPath, newContent);

    const projPath = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(projPath), { recursive: true });
    fs.writeFileSync(projPath, oldContent);

    writeCurrentCanonVersion(projectDir);  // existing helper
}
```

### AC-2 — drift guard

```ts
void test('runUpgrade staleOverrides: drift guard — detected set equals CANON_OWNED template basenames', () => {
    const expectedBasenames = CANON_OWNED
        .filter(f => f.startsWith('.canon/templates/'))
        .map(f => path.basename(f));
    assert.ok(expectedBasenames.length > 0, 'CANON_OWNED must contain at least one template entry');
    // The implementation derives its set from CANON_OWNED; this test guards
    // that CANON_OWNED itself has the expected shape.
    assert.ok(expectedBasenames.includes('spec.md'));
    assert.ok(expectedBasenames.includes('plan.md'));
});
```

### AC-3 — positive case (default override root)

```ts
void test('runUpgrade staleOverrides: override differs from changed template → listed', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: 'old canon spec',
                newContent: 'new canon spec',
            });
            const overrideDir = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(overrideDir, { recursive: true });
            fs.writeFileSync(path.join(overrideDir, 'spec.md'), 'my custom spec');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.staleOverrides.some(p => p.endsWith(path.join('tasks', '_templates', 'spec.md'))));
        });
    });
});
```

### AC-4 — unchanged template → no nudge

```ts
void test('runUpgrade staleOverrides: unchanged canon template → override not listed', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const content = 'identical content';
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: content,
                newContent: content,  // unchanged → lands in unchanged, not pending
            });
            const overrideDir = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(overrideDir, { recursive: true });
            fs.writeFileSync(path.join(overrideDir, 'spec.md'), 'my custom spec');

            const result = runUpgrade(projectDir, pkgDir);

            assert.deepEqual(result.staleOverrides, []);
        });
    });
});
```

### AC-5 — override identical to new template → suppressed

```ts
void test('runUpgrade staleOverrides: override byte-identical to new template → not listed', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const newContent = 'new canon spec';
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: 'old canon spec',
                newContent,
            });
            const overrideDir = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(overrideDir, { recursive: true });
            fs.writeFileSync(path.join(overrideDir, 'spec.md'), newContent);  // same as new

            const result = runUpgrade(projectDir, pkgDir);

            assert.deepEqual(result.staleOverrides, []);
        });
    });
});
```

### AC-6 — `--check` parity

```ts
void test('runUpgrade --check staleOverrides: parity with apply mode', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: 'old canon spec',
                newContent: 'new canon spec',
            });
            const overrideDir = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(overrideDir, { recursive: true });
            fs.writeFileSync(path.join(overrideDir, 'spec.md'), 'my custom spec');

            const result = runUpgrade(projectDir, pkgDir, { check: true });

            assert.ok(result.staleOverrides.some(p => p.endsWith(path.join('tasks', '_templates', 'spec.md'))));
            // No files written (dry-run guarantee).
            const projPath = path.join(projectDir, '.canon', 'templates', 'spec.md');
            assert.equal(fs.readFileSync(projPath, 'utf8'), 'old canon spec');
        });
    });
});
```

### AC-7 — dirty-refusal → empty `staleOverrides`

```ts
void test('runUpgrade staleOverrides: dirty canon template + differing override → empty on refusal', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: 'committed spec',
                newContent: 'new canon spec',
            });
            const overrideDir = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(overrideDir, { recursive: true });
            fs.writeFileSync(path.join(overrideDir, 'spec.md'), 'my custom spec');
            gitAddCommit(projectDir, 'initial');

            // Dirty the canon template (tracked modification, not staged).
            fs.writeFileSync(path.join(projectDir, '.canon', 'templates', 'spec.md'), 'dirty local edit');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.dirtyRefused.includes('.canon/templates/spec.md'));
            assert.deepEqual(result.staleOverrides, []);
        });
    });
});
```

### AC-8 — informational only

```ts
void test('runUpgrade staleOverrides: non-empty staleOverrides does not prevent upgrade', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: 'old canon spec',
                newContent: 'new canon spec',
            });
            const overrideDir = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(overrideDir, { recursive: true });
            fs.writeFileSync(path.join(overrideDir, 'spec.md'), 'my custom spec');

            const result = runUpgrade(projectDir, pkgDir);

            assert.ok(result.staleOverrides.length > 0);
            assert.ok(result.upgraded.includes('.canon/templates/spec.md'));
            // No exit(2) — verified by the test completing normally.
        });
    });
});
```

### AC-9 — output

Test via `upgradeCmd` stdout capture — match the pattern used by existing `upgradeCmd` output tests (search for `console.log` spying in the test file; if none exist, use a simple stdout capture via monkey-patching `console.log` or call `runCanonCli` with a fixture dir). If there's no existing console capture pattern, add a minimal one:

```ts
void test('runUpgrade staleOverrides: output lists override path and diff command', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: 'old canon spec',
                newContent: 'new canon spec',
            });
            const overrideDir = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(overrideDir, { recursive: true });
            fs.writeFileSync(path.join(overrideDir, 'spec.md'), 'my custom spec');

            const lines: string[] = [];
            const orig = console.log;
            console.log = (...args: unknown[]) => lines.push(args.join(' '));
            try {
                runUpgrade(projectDir, pkgDir);
                // Note: output is printed in upgradeCmd, not runUpgrade.
                // Test the helper indirectly via re-calling printStaleOverrideNudge
                // or by checking result.staleOverrides and trusting the print path.
            } finally {
                console.log = orig;
            }
        });
    });
});
```

Since `printStaleOverrideNudge` is private, test output by calling `upgradeCmd` in a temp dir using `runCanonCli` (the existing subprocess helper), or by exporting the helper. Prefer the subprocess approach for output tests — it matches how the existing `upgradeCmd` output is tested in the suite. Check the test file around line 400–500 for any `upgradeCmd` output tests using `runCanonCli`. If none exist, keep it simple: assert `result.staleOverrides` contains the path (ACs 3–7 cover correctness), and add one subprocess test for the printed diff command format.

### AC-10 — no overrides / strays

```ts
void test('runUpgrade staleOverrides: no override root → empty, no throw', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: 'old', newContent: 'new',
            });
            // No tasks/_templates/ created.
            const result = runUpgrade(projectDir, pkgDir);
            assert.deepEqual(result.staleOverrides, []);
        });
    });
});

void test('runUpgrade staleOverrides: stray non-template file in override root → not listed', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: 'old', newContent: 'new',
            });
            const overrideDir = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(overrideDir, { recursive: true });
            fs.writeFileSync(path.join(overrideDir, 'random.txt'), 'stray');
            const result = runUpgrade(projectDir, pkgDir);
            assert.deepEqual(result.staleOverrides, []);
        });
    });
});
```

### AC-12 — `CANON_TASKS_DIR_OVERRIDE` resolution

```ts
void test('runUpgrade staleOverrides: CANON_TASKS_DIR_OVERRIDE custom root is used, not tasks/_templates/', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            const customTasksDir = path.join(projectDir, 'custom-tasks');
            const savedEnv = process.env['CANON_TASKS_DIR_OVERRIDE'];
            process.env['CANON_TASKS_DIR_OVERRIDE'] = customTasksDir;
            try {
                setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                    oldContent: 'old', newContent: 'new',
                });

                // Override under custom root.
                const customOverrideDir = path.join(customTasksDir, '_templates');
                fs.mkdirSync(customOverrideDir, { recursive: true });
                fs.writeFileSync(path.join(customOverrideDir, 'spec.md'), 'my override');

                // Stray file under default tasks/_templates/ (should NOT be consulted).
                const defaultOverrideDir = path.join(projectDir, 'tasks', '_templates');
                fs.mkdirSync(defaultOverrideDir, { recursive: true });
                fs.writeFileSync(path.join(defaultOverrideDir, 'spec.md'), 'default stray');

                const result = runUpgrade(projectDir, pkgDir);

                // Custom root path is listed.
                assert.ok(
                    result.staleOverrides.some(p => p.includes(path.join('custom-tasks', '_templates'))),
                    `expected custom-tasks/_templates in staleOverrides, got: ${JSON.stringify(result.staleOverrides)}`,
                );
                // Default tasks/_templates path is NOT listed.
                assert.ok(
                    !result.staleOverrides.some(p => p.includes(path.join('tasks', '_templates'))),
                    `tasks/_templates should not appear when CANON_TASKS_DIR_OVERRIDE is set`,
                );
            } finally {
                if (savedEnv === undefined) {
                    delete process.env['CANON_TASKS_DIR_OVERRIDE'];
                } else {
                    process.env['CANON_TASKS_DIR_OVERRIDE'] = savedEnv;
                }
            }
        });
    });
});
```

---

## Step 9 — `npm run build` and commit `dist/cli/index.js`

After all source and test changes are complete:
```bash
npm run build
```
Verify `dist/cli/index.js` is the only artifact emitted for this change. Commit it alongside the source changes so CI's `git diff --exit-code -- dist/` gate passes.

---

## Step 10 — Run all validation

```bash
npm run lint
npm run type-check
npm test
npm run build          # already done in Step 9; verify dist/ is clean
npm run sync-templates:check
npm run docs-refs-check
```

All must pass before marking the task done.

---

## Implementation order summary

1. Export `taskTemplateOverrideRoot` in `src/task/index.ts`
2. `UpgradeResult` field + imports in `upgrade.ts`
3. Detection block (after dirty/clean split)
4. `printStaleOverrideNudge()` helper
5. `upgradeCmd()` wiring
6. `.canon/README.md` update
7. Tests in `tests/cli.test.ts`
8. `npm run build`
9. Validation

---

## Reroute Plan Round 2

### Delta

Amendment Round 2 addresses the dirty-refusal companion bug (P2 at `src/cli/commands/upgrade.ts:376`): `staleOverrides` is currently computed from `clean[]` *before* the dirty-refusal early return, so a mixed run (one template clean+would-change with a differing override, another template dirty) can return a non-empty `staleOverrides` on the refusal path — violating the changed-set contract from Amendment Round 1 ("`staleOverrides` iff in `upgraded`/`wouldUpgrade`"). The fix is ordering: move or guard the computation so the refusal path always returns `[]`.

The three nit cleanups (B.1–B.3) fold into the same pass; none change behavior.

**Prior plan steps that still apply**: Steps 1–7 (export, UpgradeResult field, detection block, print helper, upgradeCmd wiring, README, existing tests) are already shipped. Only the targeted changes below are new work.

#### Step R2-1 — Move/guard `staleOverrides` computation past the dirty-refusal branch (`src/cli/commands/upgrade.ts`)

AC-14 requires that on the no-`--force` dirty-refusal path, `staleOverrides` is `[]` even when a clean would-change template has a differing override.

Two valid approaches — pick whichever matches the current function structure:

- **Option A (preferred if the dirty-refusal return is a compact early-return block):** Move the entire `getStaleOverrides(...)` call and assignment to after the dirty-refusal block. The dirty-refusal return then explicitly returns `staleOverrides: []` (or the variable initialized to `[]` before the call). Confirm by grepping `return {` in `runUpgrade()` that exactly three returns exist and only the two non-refusal returns can produce a non-empty list.

- **Option B (if moving the computation is impractical):** Leave the computation in place but on the dirty-refusal return explicitly override: `return { ..., staleOverrides: [] }`. Add a comment referencing AC-14.

Either way: verify that the dirty-refusal return cannot surface a non-empty `staleOverrides` to `upgradeCmd()`. The CLI already exits `2` before printing, so this is a programmatic-caller correctness fix — not a user-visible change.

#### Step R2-2 — Rename `getStaleOverrides` parameter (`src/cli/commands/upgrade.ts`)

The parameter currently named `clean` can receive `pending` when `--force` is active (from Iteration 2's fix). Rename it to a force-neutral name — `writtenOps` or `changedOps` — so the name accurately describes what it holds under both `--force` and normal mode.

Also update the block comment near the changed-set source that states "only clean writes count" — revise it to describe the actual contract: "the changed set is the ops the run reports as written — `clean` in normal mode, `pending` under `--force`."

#### Step R2-3 — Remove dead-code fallback (`src/cli/commands/upgrade.ts`)

Drop the unreachable `|| overridePathAbs` in the `relative(cwd, overridePathAbs) || overridePathAbs` expression. `relative()` never returns `''` for a file path under the root, so the fallback branch is dead. Remove it for clarity. (Left optional in Amendment Round 1 section E; Round 2 resolves it.)

#### Step R2-4 — Add AC-14 test (`tests/cli.test.ts`)

Add a test that exercises the mixed dirty-refusal scenario:

```ts
void test('runUpgrade staleOverrides: mixed run (clean would-change + dirty, no --force) → dirty-refusal returns empty staleOverrides', () => {
    withTempDir(projectDir => {
        withTempDir(pkgDir => {
            gitInit(projectDir);

            // Template A: clean, would change this run, has differing override.
            setupTemplateUpgrade(projectDir, pkgDir, 'spec.md', {
                oldContent: 'committed spec',
                newContent: 'new canon spec',
            });
            const overrideDir = path.join(projectDir, 'tasks', '_templates');
            fs.mkdirSync(overrideDir, { recursive: true });
            fs.writeFileSync(path.join(overrideDir, 'spec.md'), 'my custom spec');

            // Template B: dirty — makes the run refuse.
            setupTemplateUpgrade(projectDir, pkgDir, 'plan.md', {
                oldContent: 'committed plan',
                newContent: 'new canon plan',
            });
            gitAddCommit(projectDir, 'initial');
            fs.writeFileSync(
                path.join(projectDir, '.canon', 'templates', 'plan.md'),
                'dirty local edit',
            );

            const result = runUpgrade(projectDir, pkgDir);  // no --force

            assert.ok(result.dirtyRefused.includes('.canon/templates/plan.md'), 'should refuse');
            assert.deepEqual(result.upgraded, []);
            assert.deepEqual(result.wouldUpgrade, []);
            assert.deepEqual(result.staleOverrides, [], 'staleOverrides must be empty on dirty-refusal path');
        });
    });
});
```

#### Step R2-5 — `npm run build` and validation

```bash
npm run build
npm run lint
npm run type-check
npm test
npm run sync-templates:check
npm run docs-refs-check
```

Only `src/cli/commands/upgrade.ts`, `tests/cli.test.ts`, and `dist/cli/index.js` are expected to change. No new files.
