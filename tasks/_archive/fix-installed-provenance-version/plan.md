# Implementation Plan: fix-installed-provenance-version

> Written by: Claude | Implements: `tasks/fix-installed-provenance-version/spec.md`

## Approach

`captureCanonSnapshot()` (`scripts/run-task/canon-snapshot.ts:63`) currently has two branches: vendored (a non-empty `--show-superproject-working-tree` at `repoRoot`) and native (everything else, via `resolveOrchestratorCommit`). Installed-package canon falls through to the native branch and stamps the adopter's own `HEAD` as `upstream_commit`, because nothing in the function inspects *where canon's own code is running from* — only `repoRoot` (always the adopter/host checkout).

The fix adds a third branch, checked **first**: classify canon's own executing source path (`__dirname`, already exported by `scripts/run-task/env.ts`) as installed-package or not. If installed, force `upstream_commit = '<unavailable>'` but still run the existing superproject probe at `repoRoot` to correctly attribute `orchestrator_commit` (host HEAD if the adopter is itself a submodule, adopter HEAD otherwise) — this is what makes AC-5b's "installed inside a submodule adopter" case resolve `orchestrator_commit` to the host, not the adopter, and never blanks it. Native and vendored logic are otherwise untouched. A new `canon_version` field is computed unconditionally in all three branches from the same expression `bakedVersion()` uses (`process.env.CANON_VERSION ?? 'dev'`), via an injectable option so tests stay hermetic.

This is a pure branch-reordering + one-new-branch change inside one function, plus a type field addition and a template field addition. No new files, no new modules.

## Steps

### Step 1: Add the two new injectable seams to `CanonSnapshotOptions`

Files: `scripts/run-task/canon-snapshot.ts`

Add to the `CanonSnapshotOptions` type (currently `runGitAt?`, `runCommand?`):

```ts
export type CanonSnapshotOptions = {
    runGitAt?: GitRunner;
    runCommand?: CommandRunner;
    canonSourcePath?: string;
    canonVersion?: string;
};
```

Do this step **first, before touching branch logic** (per the spec's red-first staging note) — it lets the AC-2 regression test compile against the typed interface immediately, and fail at runtime (still stamping adopter HEAD) until Step 2 lands.

Import `__dirname` from `./env.js` (it's already exported there — `scripts/run-task/env.ts:6`) for the default `canonSourcePath`.

### Step 2: Add the installed-source-path predicate

Files: `scripts/run-task/canon-snapshot.ts`

Add a small standalone predicate — do **not** import from `src/cli/commands/update.ts`'s `detectInstallType` (its no-match branch defaults to `'global'`, which would misreport native dev as installed; see spec Implementation Notes). Duplicate the segment check, scoped to exactly what's needed here:

```ts
function isInstalledSourcePath(sourcePath: string): boolean {
    return sourcePath.includes('/node_modules/') || sourcePath.includes('\\node_modules\\')
        || sourcePath.includes('/_npx/') || sourcePath.includes('\\_npx\\');
}
```

This covers: local `node_modules` installs, pnpm's nested/virtual store (still a `/node_modules/` segment), global npm installs (`<prefix>/lib/node_modules/canon-ai/...`), and npx caches. It does **not** match a native checkout's `dist/scripts` or `scripts/run-task` path, nor a linked worktree's `dev-worktrees/<task>/scripts/run-task` path, nor a vendored submodule path like `vendor/canon-ai/dist/scripts` — none of those contain a `node_modules` or `_npx` segment. This is what makes AC-4b (linked worktree) and AC-5/AC-5b (vendored / installed-in-submodule-adopter) classify correctly without any special-casing of those situations.

Why `__dirname` and not `repoRoot`: `env.ts` anchors `REPO_ROOT` at the *supervising* checkout via `--git-common-dir`, so native canon running from a linked worktree has `__dirname` under `dev-worktrees/…`, legitimately outside `REPO_ROOT` — but neither path contains `node_modules`/`_npx`, so the predicate is correct in both places. Testing "does `__dirname` differ from `repoRoot`" (rather than testing `__dirname`'s content directly) would misclassify the linked-worktree case as installed; don't build the check that way.

### Step 3: Add the version-reading helper

Files: `scripts/run-task/canon-snapshot.ts`

```ts
function resolveCanonVersion(explicit: string | undefined): string {
    return explicit ?? process.env.CANON_VERSION ?? 'dev';
}
```

This mirrors `bakedVersion()` in `src/cli/commands/update.ts:313`. Do not import across from `update.ts` — same layering as Step 2 (no new cross-module dependency for a two-line expression); note in a one-line comment that it mirrors `bakedVersion()` so a future reader doesn't wonder if the two should be unified.

### Step 4: Restructure `captureCanonSnapshot()` — installed-package branch first

Files: `scripts/run-task/canon-snapshot.ts`

Current structure (lines 63–79):

```ts
export function captureCanonSnapshot(repoRoot = REPO_ROOT, options: CanonSnapshotOptions = {}): CanonStamp {
    const runGitAt = options.runGitAt ?? gitSafeAt;
    const runCommand = options.runCommand ?? defaultRunCommand;

    const superprojectWorkingTree = captureGitOutput(repoRoot, ['rev-parse', '--show-superproject-working-tree'], runGitAt);
    const upstreamCommit = captureGitOutput(repoRoot, ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>';
    const orchestratorCommit = superprojectWorkingTree
        ? captureGitOutput(path.resolve(superprojectWorkingTree), ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>'
        : resolveOrchestratorCommit(repoRoot, upstreamCommit, runGitAt);
    const envUpstreamRepo = process.env.CANON_UPSTREAM_REPO?.trim();
    const upstreamRepo = envUpstreamRepo ? envUpstreamRepo : CANON_UPSTREAM_REPO;

    return {
        upstream_repo: upstreamRepo,
        upstream_commit: upstreamCommit,
        orchestrator_commit: orchestratorCommit,
        codex_cli: captureVersion('codex', runCommand),
        claude_code: captureVersion('claude', runCommand),
    };
}
```

Replace with:

```ts
export function captureCanonSnapshot(repoRoot = REPO_ROOT, options: CanonSnapshotOptions = {}): CanonStamp {
    const runGitAt = options.runGitAt ?? gitSafeAt;
    const runCommand = options.runCommand ?? defaultRunCommand;
    const canonSourcePath = options.canonSourcePath ?? __dirname;
    const isInstalled = isInstalledSourcePath(canonSourcePath);

    const superprojectWorkingTree = captureGitOutput(repoRoot, ['rev-parse', '--show-superproject-working-tree'], runGitAt);
    const drivingCommit = captureGitOutput(repoRoot, ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>';
    const hostCommit = superprojectWorkingTree
        ? captureGitOutput(path.resolve(superprojectWorkingTree), ['rev-parse', 'HEAD'], runGitAt) || '<unavailable>'
        : null;

    let upstreamCommit: string;
    let orchestratorCommit: string;
    if (isInstalled) {
        upstreamCommit = '<unavailable>';
        orchestratorCommit = hostCommit ?? drivingCommit;
    } else if (superprojectWorkingTree) {
        upstreamCommit = drivingCommit;
        orchestratorCommit = hostCommit ?? '<unavailable>';
    } else {
        upstreamCommit = drivingCommit;
        orchestratorCommit = resolveOrchestratorCommit(repoRoot, upstreamCommit, runGitAt);
    }

    const envUpstreamRepo = process.env.CANON_UPSTREAM_REPO?.trim();
    const upstreamRepo = envUpstreamRepo ? envUpstreamRepo : CANON_UPSTREAM_REPO;

    return {
        upstream_repo: upstreamRepo,
        upstream_commit: upstreamCommit,
        orchestrator_commit: orchestratorCommit,
        canon_version: resolveCanonVersion(options.canonVersion),
        codex_cli: captureVersion('codex', runCommand),
        claude_code: captureVersion('claude', runCommand),
    };
}
```

Notes on this restructure:
- `drivingCommit` is exactly the old `upstreamCommit` (repoRoot's own `HEAD`), renamed because in installed mode it is no longer canon's identity — it's just an input to computing `orchestratorCommit`.
- `hostCommit` factors out the "resolve HEAD at the superproject working tree" computation that both the installed and vendored branches now share (previously only the vendored path used it inline).
- Vendored branch behavior is byte-identical to today: `upstreamCommit = drivingCommit` (repoRoot's HEAD, i.e. the submodule SHA), `orchestratorCommit = hostCommit` — same values as the old inline ternary, just named. This satisfies AC-5 (no behavior change to the existing synthetic-seam vendored test) without needing to solve the pre-existing live-submodule root-resolution gap the spec's Non-Goals explicitly excludes.
- Native branch is byte-identical to today: unchanged call to `resolveOrchestratorCommit`.
- Installed branch is new: `upstreamCommit` forced to `<unavailable>` regardless of `drivingCommit`; `orchestratorCommit` prefers `hostCommit` (adopter-is-submodule case, AC-5b) and falls back to `drivingCommit` (plain adopter case, AC-1b) — never falls back to `resolveOrchestratorCommit`, since that function's own fallback logic (comparing toplevels) has no meaning once canon's source path is known to be installed rather than a real sibling checkout.

### Step 5: Add `canon_version` to `CanonStamp`

Files: `scripts/run-task/types.ts`

```ts
export type CanonStamp = {
    upstream_repo: string;
    upstream_commit: string;
    orchestrator_commit: string;
    canon_version: string;
    codex_cli: string;
    claude_code: string;
};
```

Field order matches the Design section's snake_case grouping (repo/commit fields, then the new identity field, then CLI versions) — order has no runtime meaning but keep it consistent with the spec's Data Model Changes section.

### Step 6: Add the field to the scaffolded template

Files: `.canon/templates/status.json`

```json
"canon": {
    "upstream_repo": "tstraub89/canon-ai",
    "upstream_commit": "",
    "orchestrator_commit": "",
    "canon_version": "",
    "codex_cli": "",
    "claude_code": ""
},
```

Edit the root copy only. The pre-commit hook regenerates the mirror at `templates/.canon/templates/status.json` via `sync-canon-templates.mjs`; do not hand-edit it. Run `npm run sync-templates:check` after building to confirm.

### Step 7: Tests

Files: `tests/run-task-canon-snapshot.test.ts`

Add fixtures/tests for each new AC. Follow the existing file's patterns: `fakeGitRunner`, `fakeCommandRunner`, `nativeGitResponses(repoRoot, sha)`, `withEnv`.

**AC-1 / AC-1b — plain installed-package run:**

```ts
void test('captureCanonSnapshot marks canon commit unavailable for an installed-package run', () => {
    const repoRoot = '/tmp/adopter/project';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'adopter-sha', stderr: '' },
        }),
        runCommand: fakeCommandRunner({
            ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
            ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
        }),
        canonSourcePath: '/tmp/adopter/project/node_modules/canon-ai/dist/scripts',
        canonVersion: '2.2.0',
    });
    assert.equal(snapshot.upstream_commit, '<unavailable>');
    assert.notEqual(snapshot.upstream_commit, 'adopter-sha');
    assert.equal(snapshot.upstream_repo, CANON_UPSTREAM_REPO);
    assert.equal(snapshot.orchestrator_commit, 'adopter-sha');
    assert.equal(snapshot.canon_version, '2.2.0');
});
```

Note: no `rev-parse --show-toplevel` fake responses are needed here — the installed branch never calls `resolveOrchestratorCommit`, so those keys aren't looked up. If the test throws "Missing fake git response," that's a signal the branch reordering in Step 4 regressed and fell through to the native path — leave the fixture without those keys deliberately so it fails loudly in that case.

**AC-2 — red-first regression (the #196 bug):** stage this test to prove the pre-fix behavior would have failed it. Since Step 1's seam addition happens before Step 4's branch logic, running this exact test against the codebase after Step 1 alone (before Step 4) reproduces the bug: the installed run still falls into the native branch and `upstream_commit` becomes the adopter SHA. Implement the test itself only once (post Step 4); the plan's ordering (seam first, branch second) is what makes it "red-first" during development — no separate throwaway test file needed. Reviewers/QA can verify red-first by temporarily reverting Step 4's branch (keep Step 1) and confirming this test fails, per the spec's Implementation Notes:

```ts
void test('captureCanonSnapshot never stamps the adopter commit as canon commit for an installed run (regression, #196)', () => {
    const repoRoot = '/tmp/adopter/other-project';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'p0-quick-fixes-sha', stderr: '' },
        }),
        runCommand: fakeCommandRunner({
            ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
            ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
        }),
        canonSourcePath: '/tmp/adopter/other-project/node_modules/canon-ai/dist/scripts',
        canonVersion: '3.0.0',
    });
    assert.equal(snapshot.upstream_commit, '<unavailable>');
    assert.notEqual(snapshot.upstream_commit, 'p0-quick-fixes-sha');
    assert.equal(snapshot.canon_version, '3.0.0');
});
```

**AC-3 — version recorded in every mode:** extend the three existing mode tests (native `'captureCanonSnapshot uses the current checkout SHA for native canon'`, vendored `'... uses the superproject SHA when canon is vendored'`, and the `<unavailable>` CLI test) with a `canonVersion` option and an assertion, e.g.:

```ts
assert.equal(snapshot.canon_version, '2.2.0');
```

passed via `canonVersion: '2.2.0'` in each call's options. Also add one test with no `canonVersion` option and no `CANON_VERSION` env var set, asserting `snapshot.canon_version === 'dev'` (use `withEnv({ CANON_VERSION: undefined }, ...)` to guarantee it's unset regardless of the ambient test environment).

**AC-4 — native regression guard:** the existing native test (`'captureCanonSnapshot uses the current checkout SHA for native canon'`, calls `captureCanonSnapshot(REPO_ROOT)` with no options) already exercises real `REPO_ROOT`. Add a `canon_version` assertion; since it uses the real environment, assert only `typeof snapshot.canon_version === 'string' && snapshot.canon_version.length > 0` (either the baked version or `'dev'`, both non-empty) rather than a specific value, since CI may or may not have `CANON_VERSION` baked.

**AC-4b — linked-worktree classification guard:**

```ts
void test('captureCanonSnapshot classifies a linked-worktree source path as native, not installed', () => {
    const repoRoot = '/tmp/native/canon-ai';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner(nativeGitResponses(repoRoot, 'worktree-native-sha')),
        runCommand: fakeCommandRunner({
            ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
            ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
        }),
        canonSourcePath: '/Users/dev/canon-ai/dev-worktrees/some-task/scripts/run-task',
        canonVersion: 'dev',
    });
    assert.equal(snapshot.upstream_commit, 'worktree-native-sha');
    assert.notEqual(snapshot.upstream_commit, '<unavailable>');
    assert.equal(snapshot.orchestrator_commit, 'worktree-native-sha');
    assert.equal(snapshot.canon_version, 'dev');
});
```

`nativeGitResponses` already provides the `--show-toplevel` fakes `resolveOrchestratorCommit` needs, so this exercises the exact same native code path as today, just with a `canonSourcePath` that lives outside `repoRoot` — proving the predicate doesn't misfire on that mismatch.

**AC-5 — vendored regression guard:** add a `canon_version` assertion to the existing `'captureCanonSnapshot uses the superproject SHA when canon is vendored'` test (pass `canonVersion: '1.5.0'`, assert `snapshot.canon_version === '1.5.0'`). No other change — this is the guard that the restructured vendored branch in Step 4 produces byte-identical `upstream_commit`/`orchestrator_commit` values.

**AC-5b — installed inside a submodule adopter:**

```ts
void test('captureCanonSnapshot records host commit and unavailable canon commit when installed inside a submodule adopter', () => {
    const repoRoot = '/tmp/host/adopter-submodule';
    const snapshot = captureCanonSnapshot(repoRoot, {
        runGitAt: fakeGitRunner({
            [`${repoRoot} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '/tmp/host', stderr: '' },
            [`${repoRoot} :: rev-parse HEAD`]: { ok: true, stdout: 'adopter-submodule-sha', stderr: '' },
            ['/tmp/host :: rev-parse HEAD']: { ok: true, stdout: 'host-sha', stderr: '' },
        }),
        runCommand: fakeCommandRunner({
            ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
            ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
        }),
        canonSourcePath: '/tmp/host/adopter-submodule/node_modules/canon-ai/dist/scripts',
        canonVersion: '2.2.0',
    });
    assert.equal(snapshot.upstream_commit, '<unavailable>');
    assert.notEqual(snapshot.upstream_commit, 'adopter-submodule-sha');
    assert.notEqual(snapshot.upstream_commit, 'host-sha');
    assert.equal(snapshot.upstream_repo, CANON_UPSTREAM_REPO);
    assert.equal(snapshot.canon_version, '2.2.0');
    assert.equal(snapshot.orchestrator_commit, 'host-sha');
});
```

Distinct SHAs for adopter (`adopter-submodule-sha`) and host (`host-sha`), per spec's AC-5b instruction, so the assertion can't pass by accident if the branch collapses the two.

**AC-6 — refresh immutability:**

```ts
void test('refreshCanonSnapshotAtPath keeps canon identity stable across refreshes while orchestrator commit tracks the adopter', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-snapshot-refresh-installed-'));
    try {
        const taskId = 'stale-installed-task';
        const taskDir = path.join(root, 'tasks', taskId);
        fs.mkdirSync(taskDir, { recursive: true });
        const statusFile = path.join(taskDir, 'status.json');
        fs.writeFileSync(statusFile, `${JSON.stringify(makeStatus(taskId, { canon: undefined }), null, 2)}\n`, 'utf8');

        const commandOpts = {
            runCommand: fakeCommandRunner({
                ['codex :: --version']: { ok: true, stdout: 'codex 1.0.0', stderr: '' },
                ['claude :: --version']: { ok: true, stdout: 'claude 1.0.0', stderr: '' },
            }),
            canonSourcePath: '/tmp/adopter/refresh/node_modules/canon-ai/dist/scripts',
            canonVersion: '2.2.0',
        };

        refreshCanonSnapshotAtPath(statusFile, {
            ...commandOpts,
            runGitAt: fakeGitRunner({
                [`${REPO_ROOT} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
                [`${REPO_ROOT} :: rev-parse HEAD`]: { ok: true, stdout: 'adopter-sha-1', stderr: '' },
            }),
        });
        const first = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as StatusJson;

        refreshCanonSnapshotAtPath(statusFile, {
            ...commandOpts,
            runGitAt: fakeGitRunner({
                [`${REPO_ROOT} :: rev-parse --show-superproject-working-tree`]: { ok: true, stdout: '', stderr: '' },
                [`${REPO_ROOT} :: rev-parse HEAD`]: { ok: true, stdout: 'adopter-sha-2', stderr: '' },
            }),
        });
        const second = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as StatusJson;

        assert.equal(first.canon?.upstream_commit, '<unavailable>');
        assert.equal(second.canon?.upstream_commit, '<unavailable>');
        assert.equal(first.canon?.upstream_repo, second.canon?.upstream_repo);
        assert.equal(first.canon?.canon_version, second.canon?.canon_version);
        assert.equal(first.canon?.orchestrator_commit, 'adopter-sha-1');
        assert.equal(second.canon?.orchestrator_commit, 'adopter-sha-2');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
```

Note `refreshCanonSnapshotAtPath` always calls `captureCanonSnapshot(REPO_ROOT, options)` (hardcoded `REPO_ROOT`, not the passed `statusFilePath`'s directory — see `canon-snapshot.ts:96`), so the git fakes must key off the real `REPO_ROOT` constant, matching the existing `'refreshCanonSnapshotAtPath stamps an older task...'` test's approach.

**Other existing tests** (`'... falls back to native mode when no enclosing repo exists'`, `'... falls back to native mode when parent resolves to own toplevel'`, `'... uses CANON_UPSTREAM_REPO env var...'`, `'... falls back to the const when CANON_UPSTREAM_REPO is unset...'`, `'taskNew stamps canon provenance...'`) need no behavioral changes — they don't pass `canonSourcePath`, so they default to the real `__dirname` (this test file's own process, running from a non-`node_modules` dev path), correctly classifying as non-installed. Optionally add a loose `assert.ok(typeof status.canon?.canon_version === 'string')` to the `taskNew` test since it reads the real seeded status.json.

### Step 8: Build and validation

```bash
npm run lint
npm run type-check
npm test
npm run build     # rebuilds dist/cli/index.js and dist/scripts/run-task.js — commit both
npm run docs-refs-check
npm run sync-templates:check
```

### Step 9: Docs

Files: `docs/pipeline-orchestrator.md`

In §"Canon Snapshot Stamping" (`docs/pipeline-orchestrator.md:292`), after the existing native/vendored bullets, add:

```markdown
- Installed-package runs (canon executing as a published npm artifact — global CLI or project dependency) record `<unavailable>` for `upstream_commit` — never the adopter's own commit — while `orchestrator_commit` still tracks the driving repository's commit (the adopter, or its host when the adopter is itself a submodule).
- Every mode additionally records the executing canon's version in `canon_version`.
```

Files: `docs/decisions.md`

In §"Canon provenance stamp" (`docs/decisions.md:31`), after the existing **Rule** paragraph, add a short note: installed-package mode identifies canon by version (`canon_version`) rather than a borrowed adopter commit, since no canon commit is recoverable in that mode; and record the two relevant non-goals from the spec (no SHA-baking into `dist` — blocked by the reproducible-`dist` CI gate — and no reading `.canon/provenance.json` for a canon SHA, since that file is a write-time receipt that drifts from the executing binary in the default global-install topology).

## Testing Plan

- **Unit**: all of Step 7 above, in `tests/run-task-canon-snapshot.test.ts`. This is the entire test surface for this change — no other test file references `CanonStamp` or `captureCanonSnapshot`.
- **E2E**: none needed; `taskNew stamps canon provenance...` already exercises the real end-to-end `canon task new` → `status.json` path and needs no new scenario, just the loose version assertion noted above.
- **Manual**: none required beyond `npm test`; the Human Test Plan in the spec is documentation-level (describes what an adopter would observe), not a manual verification step for this implementation.

## Rollback Plan

Single self-contained change (one function, one type field, one template field). Revert is a straight `git revert` of the task's commits. No data migration: `canon_version` is a new field with no prior meaning: reverting a task whose `status.json` already gained the field on disk leaves a harmless extra key that older code ignores (it doesn't read `canon` blocks structurally — see spec's Interaction Dependencies note that `validation.ts` never inspects the `CanonStamp` block).
