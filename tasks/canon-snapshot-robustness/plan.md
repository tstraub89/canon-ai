# Plan: canon-snapshot-robustness — upstream-repo override + non-submodule vendored detection

> Authored by: Claude | Implemented by: Codex

## Approach

Two independent changes inside `captureCanonSnapshot()` in `scripts/run-task/canon-snapshot.ts`, plus new test fixtures. The function already accepts a `runGitAt` injectable runner, so every new git call stays test-seamable at zero extra cost. No new exported symbols, no shape changes to `CanonStamp`.

**Spec-review nit resolved**: the Affected Files table in the spec listed the env-override resolution as `process.env.CANON_UPSTREAM_REPO ?? CANON_UPSTREAM_REPO`, but AC-1 requires the trimmed-non-empty rule (empty/whitespace falls back to the const). This plan uses the correct form throughout — Codex must **not** use the raw `??` form.

## Steps

### Step 1 — Upstream-repo override in `captureCanonSnapshot()` (AC-1)

**File**: `scripts/run-task/canon-snapshot.ts`

Locate the `return { ... }` object literal where `upstream_repo: CANON_UPSTREAM_REPO` is assigned (~line 58). Change to call-time resolution:

```typescript
const envRepo = process.env.CANON_UPSTREAM_REPO?.trim();
const upstreamRepo = envRepo ? envRepo : CANON_UPSTREAM_REPO;

return {
    upstream_repo: upstreamRepo,
    upstream_commit: upstreamCommit,
    orchestrator_commit: orchestratorCommit,
    codex_cli: captureVersion('codex', runCommand),
    claude_code: captureVersion('claude', runCommand),
};
```

The read happens inside `captureCanonSnapshot()`, not at module load time. A test that mutates `process.env.CANON_UPSTREAM_REPO` **after** import and then calls `captureCanonSnapshot()` must observe the new value. The exported `CANON_UPSTREAM_REPO` const stays in place and unchanged.

---

### Step 2 — Non-submodule vendored detection (AC-3, AC-4, AC-5)

**File**: `scripts/run-task/canon-snapshot.ts`

Extract a helper function `resolveOrchestratorCommit` (module-private) and call it from the existing `else` branch:

```typescript
function resolveOrchestratorCommit(repoRoot: string, upstreamCommit: string, runGitAt: GitRunner): string {
    // Probe canon's own toplevel and the parent directory's toplevel.
    const ownToplevel = captureGitOutput(repoRoot, ['rev-parse', '--show-toplevel'], runGitAt);
    const parentDir = path.dirname(repoRoot);
    const parentToplevel = captureGitOutput(parentDir, ['rev-parse', '--show-toplevel'], runGitAt);

    // If both resolve and are distinct repos (after path normalization), canon is a
    // self-contained clone nested inside a distinct host repo.
    if (
        ownToplevel &&
        parentToplevel &&
        path.resolve(parentToplevel) !== path.resolve(ownToplevel)
    ) {
        const hostHead = captureGitOutput(path.resolve(parentToplevel), ['rev-parse', 'HEAD'], runGitAt);
        return hostHead || upstreamCommit; // probe failure → native fallback (AC-5)
    }

    // No enclosing repo, or parent resolves to same toplevel (monorepo subdir) → native.
    return upstreamCommit;
}
```

Update the `orchestratorCommit` computation in `captureCanonSnapshot()`:

```typescript
const superprojectWorkingTree = captureGitOutput(repoRoot, ['rev-parse', '--show-superproject-working-tree'], runGitAt);
const upstreamCommit = captureGitOutput(repoRoot, ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>';

const orchestratorCommit = superprojectWorkingTree
    ? captureGitOutput(path.resolve(superprojectWorkingTree), ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>'
    : resolveOrchestratorCommit(repoRoot, upstreamCommit, runGitAt);
```

**Key constraints**:
- All three new git calls go through `runGitAt` — fully injectable, no real-git dependency in tests.
- `captureGitOutput` returns `''` on failure (existing pattern). The `||` and falsy checks handle probe errors transparently without throwing (AC-5).
- `path.resolve()` normalization before comparison prevents trailing-slash or relative-path false "distinct" results (spec Known Risks).
- `parentDir = path.dirname(repoRoot)` — one level up from canon's own checkout root.
- The helper is placed before `captureCanonSnapshot` in the file.

---

### Step 3 — Update `tests/run-task-canon-snapshot.test.ts`

The new probe adds three git call keys per fixture: `${repoRoot} :: rev-parse --show-toplevel`, `${parentDir} :: rev-parse --show-toplevel`, and `${resolvedParentToplevel} :: rev-parse HEAD`. **Existing tests that use `fakeGitRunner` with the superproject query returning empty will now receive these new calls and fail with "Missing fake git response" unless their fixtures are updated.**

#### 3a — Update existing fixtures

**`'captureCanonSnapshot records unavailable CLIs without failing'`** — superproject is empty, probe fires. Add fixture keys that degrade to native (no enclosing repo shape):

```typescript
const repoRoot = '/tmp/native/canon-ai';
const parentDir = path.dirname(repoRoot); // '/tmp/native'
// Add to fakeGitRunner:
[`${repoRoot} :: rev-parse --show-toplevel`]: { ok: true, stdout: repoRoot, stderr: '' },
[`${parentDir} :: rev-parse --show-toplevel`]: { ok: false, stdout: '', stderr: '' },
// existing assertions unchanged: orchestrator_commit === upstream_commit
```

**`'refreshCanonSnapshotAtPath stamps an older task...'`** — calls `captureCanonSnapshot(REPO_ROOT, ...)`. `REPO_ROOT` is the real canon-ai checkout root. Add:

```typescript
import path from 'node:path';  // already imported
// Add to fakeGitRunner:
[`${REPO_ROOT} :: rev-parse --show-toplevel`]: { ok: true, stdout: REPO_ROOT, stderr: '' },
[`${path.dirname(REPO_ROOT)} :: rev-parse --show-toplevel`]: { ok: false, stdout: '', stderr: '' },
// existing assertions unchanged
```

**`'captureCanonSnapshot uses the superproject SHA when canon is vendored'`** — superproject query returns non-empty path, so `resolveOrchestratorCommit` is **never called**. No fixture update needed.

**`'captureCanonSnapshot uses the current checkout SHA for native canon'`** — calls `captureCanonSnapshot(REPO_ROOT)` with no fake runner (uses real git). The real git probe will run against the real canon-ai checkout: `dirname(REPO_ROOT)` likely has no git repo → empty → native → `orchestrator_commit === upstream_commit`. Existing assertion holds. No change needed.

**`'taskNew stamps canon provenance...'`** — calls the real `captureCanonSnapshot` with no fake runner. Same reasoning as above. No change needed.

#### 3b — Add `withEnv` helper

Copy the pattern from `tests/task-cli.test.ts` (lines 33–49):

```typescript
function withEnv<T>(updates: Record<string, string | undefined>, fn: () => T): T {
    const previous = new Map<string, string | undefined>();
    for (const key of Object.keys(updates)) {
        previous.set(key, process.env[key]);
        const val = updates[key];
        if (val === undefined) delete process.env[key];
        else process.env[key] = val;
    }
    try { return fn(); }
    finally {
        for (const [k, v] of previous) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    }
}
```

#### 3c — New tests: AC-1 (env override)

Helper to build a "native" fake runner for a given `repoRoot` (superproject empty, probe → native):

```typescript
function nativeFakeRunner(repoRoot: string, sha: string): NonNullable<CanonSnapshotOptions['runGitAt']> {
    const parentDir = path.dirname(repoRoot);
    return fakeGitRunner({
        [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
        [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: sha, stderr: '' },
        [`${repoRoot} :: rev-parse --show-toplevel`]: { ok: true, stdout: repoRoot, stderr: '' },
        [`${parentDir} :: rev-parse --show-toplevel`]: { ok: false, stdout: '', stderr: '' },
    });
}

const nativeCommandRunner = fakeCommandRunner({
    ['codex :: --version']: { ok: false, stdout: '', stderr: '' },
    ['claude :: --version']: { ok: false, stdout: '', stderr: '' },
});

void test('captureCanonSnapshot uses CANON_UPSTREAM_REPO env var when non-empty', () => {
    const repoRoot = '/tmp/env-override/canon-ai';
    withEnv({ CANON_UPSTREAM_REPO: 'my-fork/canon-ai' }, () => {
        const snapshot = captureCanonSnapshot(repoRoot, {
            runGitAt: nativeFakeRunner(repoRoot, 'abc123'),
            runCommand: nativeCommandRunner,
        });
        assert.equal(snapshot.upstream_repo, 'my-fork/canon-ai');
    });
});

void test('captureCanonSnapshot falls back to const when CANON_UPSTREAM_REPO is unset', () => {
    const repoRoot = '/tmp/env-unset/canon-ai';
    withEnv({ CANON_UPSTREAM_REPO: undefined }, () => {
        const snapshot = captureCanonSnapshot(repoRoot, {
            runGitAt: nativeFakeRunner(repoRoot, 'def456'),
            runCommand: nativeCommandRunner,
        });
        assert.equal(snapshot.upstream_repo, CANON_UPSTREAM_REPO);
    });
});

void test('captureCanonSnapshot falls back to const when CANON_UPSTREAM_REPO is empty string', () => {
    const repoRoot = '/tmp/env-empty/canon-ai';
    withEnv({ CANON_UPSTREAM_REPO: '' }, () => {
        const snapshot = captureCanonSnapshot(repoRoot, {
            runGitAt: nativeFakeRunner(repoRoot, 'ghi789'),
            runCommand: nativeCommandRunner,
        });
        assert.equal(snapshot.upstream_repo, CANON_UPSTREAM_REPO);
    });
});

void test('captureCanonSnapshot falls back to const when CANON_UPSTREAM_REPO is whitespace-only', () => {
    const repoRoot = '/tmp/env-ws/canon-ai';
    withEnv({ CANON_UPSTREAM_REPO: '   ' }, () => {
        const snapshot = captureCanonSnapshot(repoRoot, {
            runGitAt: nativeFakeRunner(repoRoot, 'jkl000'),
            runCommand: nativeCommandRunner,
        });
        assert.equal(snapshot.upstream_repo, CANON_UPSTREAM_REPO);
    });
});
```

**Call-time verification**: the tests above mutate `process.env` after module import. If the read were hoisted to module load, all four tests would produce the value at import time. They pass only if the read is call-time.

#### 3d — New test: AC-3 (plain-vendored detection)

```typescript
void test('captureCanonSnapshot uses host HEAD when canon is a plain vendored clone', () => {
    const repoRoot = '/tmp/host/vendor/canon-ai';
    const parentDir = path.dirname(repoRoot);          // '/tmp/host/vendor'
    const parentToplevel = '/tmp/host';

    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'canon-sha', stderr: '' },
            [`${repoRoot} :: rev-parse --show-toplevel`]: { ok: true, stdout: repoRoot, stderr: '' },
            [`${parentDir} :: rev-parse --show-toplevel`]: { ok: true, stdout: parentToplevel, stderr: '' },
            [`${parentToplevel} :: rev-parse HEAD`]: { ok: true, stdout: 'host-sha', stderr: '' },
        }),
        runCommand: nativeCommandRunner,
    });
    assert.equal(snapshot.upstream_commit, 'canon-sha');
    assert.equal(snapshot.orchestrator_commit, 'host-sha');
    assert.notEqual(snapshot.orchestrator_commit, snapshot.upstream_commit);
});
```

#### 3e — New tests: AC-4 (native — two cases)

**Case A: no enclosing repo (parent `rev-parse` returns error)**

```typescript
void test('captureCanonSnapshot is native when no enclosing repo exists', () => {
    const repoRoot = '/tmp/standalone/canon-ai';
    const parentDir = path.dirname(repoRoot);
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'standalone-sha', stderr: '' },
            [`${repoRoot} :: rev-parse --show-toplevel`]: { ok: true, stdout: repoRoot, stderr: '' },
            [`${parentDir} :: rev-parse --show-toplevel`]: { ok: false, stdout: '', stderr: '' },
        }),
        runCommand: nativeCommandRunner,
    });
    assert.equal(snapshot.orchestrator_commit, snapshot.upstream_commit);
    assert.equal(snapshot.orchestrator_commit, 'standalone-sha');
});
```

**Case B: parent resolves to canon's own toplevel (monorepo subdir)**

```typescript
void test('captureCanonSnapshot is native when parent resolves to same toplevel', () => {
    const repoRoot = '/tmp/monorepo/packages/canon-ai';
    const parentDir = path.dirname(repoRoot);   // '/tmp/monorepo/packages'
    const sharedToplevel = '/tmp/monorepo';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'mono-sha', stderr: '' },
            [`${repoRoot} :: rev-parse --show-toplevel`]: { ok: true, stdout: sharedToplevel, stderr: '' },
            [`${parentDir} :: rev-parse --show-toplevel`]: { ok: true, stdout: sharedToplevel, stderr: '' },
        }),
        runCommand: nativeCommandRunner,
    });
    // Both resolve to sharedToplevel — paths are equal → native
    assert.equal(snapshot.orchestrator_commit, snapshot.upstream_commit);
    assert.equal(snapshot.orchestrator_commit, 'mono-sha');
});
```

#### 3f — New test: AC-5 (probe failure → native, no throw)

```typescript
void test('captureCanonSnapshot degrades to native when host HEAD probe fails', () => {
    const repoRoot = '/tmp/host2/vendor/canon-ai';
    const parentDir = path.dirname(repoRoot);
    const parentToplevel = '/tmp/host2';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'canon-sha2', stderr: '' },
            [`${repoRoot} :: rev-parse --show-toplevel`]: { ok: true, stdout: repoRoot, stderr: '' },
            [`${parentDir} :: rev-parse --show-toplevel`]: { ok: true, stdout: parentToplevel, stderr: '' },
            [`${parentToplevel} :: rev-parse HEAD`]: { ok: false, stdout: '', stderr: 'error' },
        }),
        runCommand: nativeCommandRunner,
    });
    // Host HEAD probe failed → hostHead = '' → falls back to upstreamCommit
    assert.equal(snapshot.orchestrator_commit, snapshot.upstream_commit);
    assert.equal(snapshot.orchestrator_commit, 'canon-sha2');
});
```

---

### Step 4 — Update `docs/decisions.md`

Find the existing `CANON_UPSTREAM_REPO` provenance Rule (~line 37). Append an in-place clause on the existing Rule (do **not** add a new section):

> **Override**: The stamped value can be overridden at call time by setting the `CANON_UPSTREAM_REPO` environment variable to a non-empty, non-whitespace string before calling `captureCanonSnapshot()`. An empty or whitespace-only env var is treated as "not set" and falls back to the const. The const remains the single canonical source for the default slug; the env var only overrides the value written into the stamp.

---

### Step 5 — Build and validation (in order)

1. `npm run build` — rewrites `dist/scripts/run-task.js` (imports `canon-snapshot.ts`) and `dist/cli/index.js` (imports via `src/task/index.ts`)
2. `npm run lint`
3. `npm run type-check`
4. `npm test` — existing snapshot tests (with fixture updates from 3a) plus new tests must all pass
5. `npm run docs-refs-check` — touches `docs/decisions.md`

> `sync-templates:check` is N/A — `docs/decisions.md` is not a canon-managed/template-mirrored file.

Declare in handoff Changes table:
- `dist/scripts/run-task.js` (generated)
- `dist/cli/index.js` (generated)

---

## Affected Files Summary

| File | Role |
|---|---|
| `scripts/run-task/canon-snapshot.ts` | Env override (AC-1) + `resolveOrchestratorCommit` helper (AC-3/4/5) |
| `tests/run-task-canon-snapshot.test.ts` | Fixture updates for existing tests + new AC-1/AC-3/AC-4/AC-5 tests |
| `docs/decisions.md` | In-place env-override clause on existing `CANON_UPSTREAM_REPO` Rule |
| `dist/scripts/run-task.js` | Generated — `npm run build` |
| `dist/cli/index.js` | Generated — `npm run build` |
