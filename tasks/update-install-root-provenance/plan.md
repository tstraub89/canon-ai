# Implementation Plan: update-install-root-provenance

> Written by: Claude | Implements: `tasks/update-install-root-provenance/spec.md`

## Approach

Everything lands in `src/cli/commands/update.ts` (rewrite), `src/cli/index.ts` (`printHelp()` only), `tests/cli.test.ts`, `README.md`, and `docs/codebase-map.md`, per the spec's Affected Files table. No new files. `dist/cli/index.js` is a generated rebuild.

The rewrite is additive-in-layers on top of the existing `detectInstallType()`/`updateCmd()` pair:

1. **Install-root detection** (AC-1) — change `detectInstallType()`'s return shape, add realpath canonicalization.
2. **Flag parsing** (part of AC-8) — `parseUpdateArgs()`, mirroring `parseUpgradeArgs()` in `upgrade.ts`.
3. **Effective slug** (Decision item 5) — one call-time helper, reused for resolver remote / npm target / provenance `source`.
4. **Guarded mutation gates** (AC-3, AC-4) — layout then dependency, local-only.
5. **Resolver** (AC-6, AC-7, AC-8) — stable final-tag pin, `main`, named ref, and 40-hex SHA short-circuit, all via an injectable git runner.
6. **Announcement** (AC-5) — no provenance read, ever.
7. **Provenance write** (AC-9) — local always (creates `.canon/` if absent); global only if `.canon/` already exists.
8. **`updateCmd` orchestration + `deps` seam** — wires 1–7 together, matching `stopCmd`'s injectable-exit convention.
9. **Tests** — unit tests for 1–7, then the red-first subprocess fixture for AC-2/AC-6's regression proof.
10. **Docs** — `printHelp()`, README, codebase-map.

Order gates before resolution (fs-only checks fail fast, before any network `git ls-remote` call) — nothing in the spec requires the opposite, and it keeps the "zero npm invocations" and "zero resolver invocations" assertions cheap to satisfy for refusal paths.

Reuse `CANON_UPSTREAM_REPO` (the canonical `'tstraub89/canon-ai'` constant) from `scripts/run-task/canon-snapshot.ts` instead of re-declaring the literal a third time — `src/cli/commands/stop.ts` already imports across the `src/cli/commands/` → `scripts/run-task/` boundary (`'../../../scripts/run-task/detach.js'` etc.), so this is an established pattern, not a new dependency direction. This does **not** touch `canon-snapshot.ts` (Non-Goal: "No changes to task-run provenance").

---

## Steps

### Step 1: `detectInstallType()` returns `{ type, installRoot }` (AC-1)

File: `src/cli/commands/update.ts`

```ts
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'fs';
```

Replace the return type and add realpath canonicalization on the `local` branch:

```ts
export type InstallType = 'local' | 'global' | 'npx';

export interface InstallDetection {
    type: InstallType;
    installRoot: string | null;
}

export function detectInstallType(pkgDirOverride?: string): InstallDetection {
    const dir = pkgDirOverride ?? packageDir;
    if (dir.includes('/_npx/') || dir.includes('\\_npx\\')) return { type: 'npx', installRoot: null };
    const nodeModulesIdx = dir.lastIndexOf('/node_modules/');
    if (nodeModulesIdx !== -1) {
        const projectRoot = dir.slice(0, nodeModulesIdx);
        if (existsSync(join(projectRoot, 'package.json'))) {
            return { type: 'local', installRoot: realpathSync(projectRoot) };
        }
    }
    return { type: 'global', installRoot: null };
}
```

`realpathSync` resolves any symlinked path segment — a linked dev checkout or an npm `--install-links` symlinked package dir yields the *real* install root, not the symlink's apparent parent (this is the spec's AC-1 symlink case, and the same canonicalization habit flagged in `docs/lessons-learned.md` — "Canonicalize real git worktree paths before comparing them" — applies here even though this isn't a worktree: don't let one code path realpath and a comparison-side test not).

Leave the npx-path-substring check and the Windows-backslash npx check as-is (Windows non-npx paths already fall through to `global` today — out of scope, spec doesn't ask for a Windows fix).

### Step 2: Update existing `detectInstallType` tests + add the symlink case (AC-1)

File: `tests/cli.test.ts` (existing block at lines 180–222)

Every existing assertion changes from a bare string to the new shape:

```ts
void test('detectInstallType: unix npx path → npx', () => {
    assert.deepEqual(detectInstallType('/home/user/.npm/_npx/abc123/node_modules/canon-ai'), { type: 'npx', installRoot: null });
});
```

...and so on for all 6 existing cases (windows npx, local, local-from-subdirectory, global-no-package-json, global-no-node_modules, global-node_modules-without-package-json). For the two `local` cases, assert `installRoot` equals `fs.realpathSync(dir)` (the temp dir itself), not just `type: 'local'`.

Add the new symlink case:

```ts
void test('detectInstallType: symlinked package dir resolves to the real install root', () => {
    withTempDir(dir => {
        const realProject = path.join(dir, 'real-project');
        fs.mkdirSync(realProject, { recursive: true });
        fs.writeFileSync(path.join(realProject, 'package.json'), '{"name":"my-project"}');
        const linkedProject = path.join(dir, 'linked-project');
        fs.symlinkSync(realProject, linkedProject, 'dir');
        const pkgDir = path.join(linkedProject, 'node_modules', 'canon-ai');
        const detection = detectInstallType(pkgDir);
        assert.equal(detection.type, 'local');
        assert.equal(detection.installRoot, fs.realpathSync(realProject));
        assert.notEqual(detection.installRoot, linkedProject);
    });
});
```

### Step 3: Flag parsing — `parseUpdateArgs()` (part of AC-8)

File: `src/cli/commands/update.ts`

Mirror `parseUpgradeArgs()`'s shape and error convention exactly (throw, don't return an error union — `updateCmd` catches it):

```ts
export interface UpdateOptions {
    channel?: 'main';
    ref?: string;
}

export function parseUpdateArgs(args: string[]): UpdateOptions {
    const options: UpdateOptions = {};
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--channel') {
            const value = args[++i];
            if (value !== 'main') {
                throw new Error(`canon update: --channel only supports 'main'. Got '${value ?? '(missing)'}'.`);
            }
            options.channel = 'main';
        } else if (arg === '--ref') {
            const value = args[++i];
            if (!value) throw new Error('canon update: --ref requires a value.');
            options.ref = value;
        } else {
            throw new Error(`canon update: unknown flag '${arg}'. Supported: --channel main, --ref <ref|sha>.`);
        }
    }
    if (options.channel && options.ref) {
        throw new Error('canon update: --channel and --ref are mutually exclusive.');
    }
    return options;
}
```

Test directly (matches the `parseUpgradeArgs` test convention at `tests/cli.test.ts:2126-2137`):

```ts
void test('parseUpdateArgs: accepts no flags, --channel main, --ref <value>', () => { ... });
void test('parseUpdateArgs: rejects --channel with anything but main', () => { ... });
void test('parseUpdateArgs: rejects --channel and --ref together', () => { ... });
void test('parseUpdateArgs: rejects unknown flag', () => { ... });
```

### Step 4: Effective slug helper (Decision item 5)

File: `src/cli/commands/update.ts`

```ts
import { CANON_UPSTREAM_REPO } from '../../../scripts/run-task/canon-snapshot.js';

function resolveEffectiveSlug(): string {
    const envSlug = process.env.CANON_UPSTREAM_REPO?.trim();
    return envSlug ? envSlug : CANON_UPSTREAM_REPO;
}
```

Call-time read (inside the function body), not a module-level `const` — per the lessons-learned "env-override tests must set the env var after import" pitfall (the canonical example is this exact env var in `captureCanonSnapshot()`). The AC-6(iv) test sets `process.env.CANON_UPSTREAM_REPO` via `withEnv(...)` (copy the helper from `tests/run-task-canon-snapshot.test.ts:78-93` into `cli.test.ts`, or share it — check whether `cli.test.ts` already has a local equivalent before duplicating) *after* the module is already imported, then calls the code under test.

This one function is the single source for the slug used in: the resolver's `ls-remote` URL, the npm `github:<slug>#<sha>` target, and the provenance `source` field. Never derive it from the adopter repo's own `origin` remote.

### Step 5: Guarded mutation gates (AC-3, AC-4)

File: `src/cli/commands/update.ts`

```ts
const CANON_AI_DEP_KEYS = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

function layoutGate(installRoot: string): { ok: true } | { ok: false; message: string } {
    if (!existsSync(join(installRoot, 'package.json'))) {
        return {
            ok: false,
            message: `canon update: no package.json found at ${installRoot} — this doesn't look like an install root. Refusing to run npm here.`,
        };
    }
    return { ok: true };
}

function dependencyGate(installRoot: string): { ok: true; manifest: Record<string, unknown> } | { ok: false; message: string } {
    const manifestPath = join(installRoot, 'package.json');
    let manifest: unknown;
    try {
        manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
        return {
            ok: false,
            message: `canon update: ${manifestPath} could not be parsed as JSON — refusing to update. Fix the manifest and retry.`,
        };
    }
    if (typeof manifest !== 'object' || manifest === null) {
        return { ok: false, message: `canon update: ${manifestPath} is not a JSON object — refusing to update.` };
    }
    const obj = manifest as Record<string, unknown>;
    const listsCanonAi = CANON_AI_DEP_KEYS.some(key => {
        const block = obj[key];
        return typeof block === 'object' && block !== null && 'canon-ai' in (block as Record<string, unknown>);
    });
    if (!listsCanonAi) {
        return {
            ok: false,
            message: `canon update: ${manifestPath} does not list canon-ai in dependencies, devDependencies, or optionalDependencies — refusing to run npm install here.`,
        };
    }
    return { ok: true, manifest: obj };
}
```

Gate 1 (`layoutGate`) runs first; on failure return its message and stop — `dependencyGate` (gate 2) never runs, so a missing manifest can never be misreported as a dependency-listing refusal. Both messages must stay textually distinct (AC-3/AC-4 require it) — they already are ("doesn't look like an install root" vs. "does not list canon-ai").

Unit tests (`tests/cli.test.ts`), each via `withTempDir`:
- AC-4: no `package.json` at root → `layoutGate` refuses.
- AC-3: `package.json` present but unparseable (`{not json`) → `dependencyGate` refuses with the parse message.
- AC-3: `package.json` present, valid JSON, no `canon-ai` anywhere → refuses with the dependency message.
- AC-3: `canon-ai` present in each of the three blocks individually → all three pass.

### Step 6: Resolver — stable / main / named-ref / SHA short-circuit (AC-6, AC-7, AC-8)

File: `src/cli/commands/update.ts`

Explicit result shape first (closes the spec-review nit: "define the resolver result shape explicitly"):

```ts
export type ResolveResult =
    | { ok: true; sha: string; version?: string }   // version present only for the stable channel
    | { ok: false; message: string };

export type GitRunner = (args: string[]) => { ok: boolean; stdout: string; stderr: string };

function defaultGitRunner(args: string[]): { ok: boolean; stdout: string; stderr: string } {
    const result = spawnSync('git', args, {
        encoding: 'utf8',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    if (result.error) return { ok: false, stdout: '', stderr: result.error.message };
    return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: (result.stderr ?? '').trim() };
}
```

`GIT_TERMINAL_PROMPT=0` is set on every real invocation so an auth prompt can never block; it's baked into `defaultGitRunner`, not exposed through the injected `GitRunner` type (unit tests fake the whole runner and don't need to see env; the red-first *subprocess* fixture's fake `git` script is what actually observes this — see Step 10).

Strict-tag parsing and comparison:

```ts
const STRICT_FINAL_TAG_RE = /^v(\d+)\.(\d+)\.(\d+)$/;

interface TagEntry { sha: string; peeledSha?: string; }

function parseLsRemoteTags(stdout: string): Map<string, TagEntry> {
    const tags = new Map<string, TagEntry>();
    for (const rawLine of stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const tabIdx = line.indexOf('\t');
        if (tabIdx === -1) continue;
        const sha = line.slice(0, tabIdx);
        let ref = line.slice(tabIdx + 1);
        const isPeeled = ref.endsWith('^{}');
        if (isPeeled) ref = ref.slice(0, -3);
        if (!ref.startsWith('refs/tags/')) continue;
        const name = ref.slice('refs/tags/'.length);
        const entry = tags.get(name) ?? { sha };
        if (isPeeled) entry.peeledSha = sha; else entry.sha = sha;
        tags.set(name, entry);
    }
    return tags;
}

function compareSemver(a: string, b: string): number {
    const pa = a.split('.').map(Number);
    const pb = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] !== pb[i]) return pa[i] - pb[i];
    }
    return 0;
}

function resolveStable(slug: string, runGit: GitRunner): ResolveResult {
    const result = runGit(['ls-remote', '--tags', `https://github.com/${slug}.git`]);
    if (!result.ok) {
        return {
            ok: false,
            message: `canon update: could not list release tags for ${slug}${result.stderr ? ` (${result.stderr})` : ''}. Check network access and GitHub auth. Aborting — no npm install run.`,
        };
    }
    const tags = parseLsRemoteTags(result.stdout);
    const finalTagNames = [...tags.keys()].filter(name => STRICT_FINAL_TAG_RE.test(name));
    if (finalTagNames.length === 0) {
        return {
            ok: false,
            message: `canon update: no final release tags (vX.Y.Z) found on ${slug}. Aborting — no npm install run, no fallback to an unpinned source.`,
        };
    }
    finalTagNames.sort((a, b) => compareSemver(a.slice(1), b.slice(1)));
    const chosen = finalTagNames[finalTagNames.length - 1];
    const entry = tags.get(chosen)!;
    return { ok: true, sha: entry.peeledSha ?? entry.sha, version: chosen.slice(1) };
}
```

Named-ref resolution (used for both `--channel main` with a fixed refspec, and `--ref <name>` with the raw user-supplied ref):

```ts
function resolveNamedRef(slug: string, refspec: string, runGit: GitRunner): ResolveResult {
    const result = runGit(['ls-remote', `https://github.com/${slug}.git`, refspec]);
    if (!result.ok) {
        return {
            ok: false,
            message: `canon update: could not resolve '${refspec}' on ${slug}${result.stderr ? ` (${result.stderr})` : ''}. Aborting — no npm install run.`,
        };
    }
    const byRef = new Map<string, { sha: string; peeled?: string }>();
    for (const rawLine of result.stdout.split('\n')) {
        const line = rawLine.trim();
        if (!line) continue;
        const tabIdx = line.indexOf('\t');
        if (tabIdx === -1) continue;
        const sha = line.slice(0, tabIdx);
        let ref = line.slice(tabIdx + 1);
        const isPeeled = ref.endsWith('^{}');
        if (isPeeled) ref = ref.slice(0, -3);
        const entry = byRef.get(ref) ?? { sha };
        if (isPeeled) entry.peeled = sha; else entry.sha = sha;
        byRef.set(ref, entry);
    }
    const distinctShas = new Set([...byRef.values()].map(e => e.peeled ?? e.sha));
    if (distinctShas.size === 0) {
        return { ok: false, message: `canon update: no remote ref matched '${refspec}' on ${slug}. Aborting — no npm install run.` };
    }
    if (distinctShas.size > 1) {
        return { ok: false, message: `canon update: '${refspec}' matched ${distinctShas.size} distinct commits on ${slug} — ambiguous. Aborting — no npm install run.` };
    }
    return { ok: true, sha: [...distinctShas][0] };
}

const HEX_SHA_RE = /^[0-9a-f]{40}$/i;
```

`--channel main` calls `resolveNamedRef(slug, 'refs/heads/main', runGit)`. `--ref <name>` (non-hex) calls `resolveNamedRef(slug, ref, runGit)` with the raw user string as the refspec — matches git's own partial-ref matching, so ambiguity is possible and must be handled (the `distinctShas.size > 1` branch). `--ref <40-hex>` never calls the resolver at all — see Step 9's short-circuit.

Unit tests (inject a fake `GitRunner`, following the `fakeGitRunner`/`fakeCommandRunner`-by-string-key pattern already used in `tests/run-task-canon-snapshot.test.ts:46-55`):
- AC-6(i): a `main` commit ahead of the newest tag doesn't change the stable pick (the fake `--tags` response simply doesn't include whatever `main` points at).
- AC-6(ii): an annotated tag's `^{}` peeled line wins over its own tag-object sha.
- AC-6(iii): `v9.0.0-rc.1` present and newer than `v8.2.0` → stable still picks `v8.2.0`.
- AC-6(iv): `withEnv({ CANON_UPSTREAM_REPO: 'my-fork/canon-ai' }, ...)` set after import → resolver URL, npm target, and provenance `source` all carry `my-fork/canon-ai`.
- AC-7: fake runner returns `{ ok: false, ... }` → resolution-error refusal; empty tag map → "no final release tags" refusal; tag map with only `v9.0.0-rc.1` (no final tag) → same refusal.
- AC-8: `resolveNamedRef` with zero matching lines → refusal; two lines with different peeled shas → ambiguity refusal; one match → success.
- SHA short-circuit: call the top-level dispatch (Step 9) with `--ref <40-hex>` and a `GitRunner` fake that throws on any call — assert it's never invoked.

### Step 7: Current-pin parsing + announcement (AC-5)

File: `src/cli/commands/update.ts`

```ts
function currentPinFromManifest(manifest: Record<string, unknown>): string {
    for (const key of CANON_AI_DEP_KEYS) {
        const block = manifest[key];
        if (typeof block !== 'object' || block === null) continue;
        const value = (block as Record<string, unknown>)['canon-ai'];
        if (typeof value === 'string') {
            const match = /#([0-9a-f]{40})$/i.exec(value.trim());
            if (match) return match[1].toLowerCase();
        }
    }
    return 'unknown';
}

function bakedVersion(): string {
    return process.env.CANON_VERSION ?? 'dev';
}

interface AnnouncementInput {
    installType: 'local' | 'global';
    installRoot: string | null;
    currentVersion: string;
    currentSha: string;
    channel: 'stable' | 'main' | 'ref';
    targetVersion: string;   // bare X.Y.Z for stable, 'unknown' for dev channels
    targetSha: string;
}

function formatAnnouncement(input: AnnouncementInput): string {
    const where = input.installType === 'local' ? `local install at ${input.installRoot}` : 'global install';
    const targetLabel = input.channel === 'stable'
        ? `v${input.targetVersion} (stable)`
        : `${input.channel} (development)`;
    return [
        '',
        `canon update — ${where}`,
        `  current: v${input.currentVersion} @ ${input.currentSha}`,
        `  target:  ${targetLabel} @ ${input.targetSha}`,
        '',
    ].join('\n');
}
```

`process.env.CANON_VERSION` is resolved by tsup's `define` at build time (see `src/cli/index.ts:110-113`, `tsup.config.ts`'s `define: { 'process.env.CANON_VERSION': JSON.stringify(version) }`) — in the built `dist/cli/index.js` this is a literal, not a real env read, which is exactly the "running executable's own baked version" the spec means. `currentPinFromManifest` reads the *value already fetched* for gate 2 (the manifest object) — it is never a second read of `.canon/provenance.json`, and nothing in this function touches that path.

Unit tests:
- Stable run, pinned manifest (`"canon-ai": "github:tstraub89/canon-ai#<40hex>"`) → current SHA shown, matches the pin.
- Stable run, unpinned manifest (`"canon-ai": "^2.2.0"` or similar, no `#<sha>`) → current SHA `unknown`.
- `--channel main` run → target version `unknown`, target SHA shown.
- No-provenance-read assertion: build two otherwise-identical fixtures, one with a `.canon/provenance.json` file present (arbitrary content) and one without; assert `formatAnnouncement`'s output (or the full stdout capture from an injected `updateCmd` run) is byte-identical between them.

### Step 8: Provenance write (AC-9)

File: `src/cli/commands/update.ts`

```ts
export interface Provenance {
    source: string;
    channel: 'stable' | 'main' | 'ref';
    resolved_sha: string;
    updated_at: string;
    version?: string;
}

function writeProvenance(root: string, provenance: Provenance): void {
    const dir = join(root, '.canon');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
}
```

`mkdirSync(..., { recursive: true })` before the write — same idiom as `runUpgrade()`'s `mkdirSync(dirname(op.projectPath), { recursive: true })` in `upgrade.ts`. This closes the spec-review nit about the AC-2/AC-6 fixture not seeding `install/.canon/`: the writer creates it, so the fixture doesn't need to pre-seed it (note this explicitly in the fixture, Step 10, so nobody adds a redundant `mkdir` there).

For **local**, always call `writeProvenance(installRoot, ...)` after a successful install. For **global**, only write if `existsSync(join(cwd, '.canon'))` is already true *before* the write (do not create `.canon/` fresh for a global install — the spec's "when present, else print-only with a note" is a presence check, not an invitation to scaffold):

```ts
if (existsSync(join(cwd, '.canon'))) {
    writeProvenance(cwd, provenance);
} else {
    stdout('(no .canon/ directory found in the current repo — provenance not recorded. Run `canon init` here first to persist it on future updates.)');
}
```

Unit tests:
- Stable write: assert `version` is bare `X.Y.Z` (no leading `v`) — matches `.canon/version`'s existing format (`upgrade.ts:414`, `newVersion = process.env.CANON_VERSION ?? 'dev'`, written bare).
- `main` write: no `version` key at all (not `undefined` — literally absent from the serialized JSON; `JSON.stringify` already drops `undefined` values, so this falls out naturally as long as `version` is only set when defined, not set to `undefined` explicitly).
- `--ref <sha>` write: `resolved_sha` equals the given SHA.
- global-with-`.canon`: written to `cwd`.
- global-without-`.canon`: no file written, note printed.
- failed install (fake `spawnRunner` returns non-zero status): assert `writeProvenance` never called / no file appears.

### Step 9: `updateCmd` orchestration + `deps` seam

File: `src/cli/commands/update.ts`

```ts
export interface UpdateCmdDeps {
    packageDir?: string;
    cwd?: string;
    spawnRunner?: (cmd: string, args: string[], opts: { cwd: string }) => { status: number | null };
    gitRunner?: GitRunner;
    exit?: (code: number) => never;
    stdout?: (s: string) => void;
    stderr?: (s: string) => void;
    now?: () => string;
}

const CANONICAL_NPX_SOURCE = 'github:tstraub89/canon-ai'; // keep the existing npx-message text verbatim (Non-Goal)

export function updateCmd(args: string[], deps: UpdateCmdDeps = {}): void {
    const exit = deps.exit ?? ((code: number): never => process.exit(code));
    const stdout = deps.stdout ?? ((s: string): void => { console.log(s); });
    const stderr = deps.stderr ?? ((s: string): void => { console.error(s); });
    const pkgDir = deps.packageDir ?? packageDir;
    const cwd = deps.cwd ?? process.cwd();
    const spawn = deps.spawnRunner ?? ((cmd, cmdArgs, opts) => spawnSync(cmd, cmdArgs, { stdio: 'inherit', cwd: opts.cwd }));
    const runGit = deps.gitRunner ?? defaultGitRunner;
    const nowIso = deps.now ?? ((): string => new Date().toISOString());

    let options: UpdateOptions;
    try {
        options = parseUpdateArgs(args);
    } catch (err) {
        stderr((err as Error).message);
        return exit(1);
    }

    const detection = detectInstallType(pkgDir);

    if (detection.type === 'npx') {
        stdout('\nRunning via npx — no persistent install to update.');
        stdout('To apply the latest templates, re-run from the latest source:\n');
        stdout(`  npx --install-links ${CANONICAL_NPX_SOURCE} upgrade\n`);
        return;
    }

    // Gates (local only) — before resolution, so a refusal never triggers a network call.
    let manifest: Record<string, unknown> | null = null;
    if (detection.type === 'local') {
        const installRoot = detection.installRoot!;
        const layout = layoutGate(installRoot);
        if (!layout.ok) { stderr(layout.message); return exit(1); }
        const dep = dependencyGate(installRoot);
        if (!dep.ok) { stderr(dep.message); return exit(1); }
        manifest = dep.manifest;
    }

    const slug = resolveEffectiveSlug();
    let channel: 'stable' | 'main' | 'ref';
    let resolvedSha: string;
    let stableVersion: string | undefined;

    if (options.ref && HEX_SHA_RE.test(options.ref)) {
        channel = 'ref';
        resolvedSha = options.ref.toLowerCase();
    } else if (options.channel === 'main') {
        channel = 'main';
        const result = resolveNamedRef(slug, 'refs/heads/main', runGit);
        if (!result.ok) { stderr(result.message); return exit(1); }
        resolvedSha = result.sha;
    } else if (options.ref) {
        channel = 'ref';
        const result = resolveNamedRef(slug, options.ref, runGit);
        if (!result.ok) { stderr(result.message); return exit(1); }
        resolvedSha = result.sha;
    } else {
        channel = 'stable';
        const result = resolveStable(slug, runGit);
        if (!result.ok) { stderr(result.message); return exit(1); }
        resolvedSha = result.sha;
        stableVersion = result.version;
    }

    const target = `github:${slug}#${resolvedSha}`;
    const currentSha = manifest ? currentPinFromManifest(manifest) : 'unknown';

    stdout(formatAnnouncement({
        installType: detection.type,
        installRoot: detection.installRoot,
        currentVersion: bakedVersion(),
        currentSha,
        channel,
        targetVersion: stableVersion ?? 'unknown',
        targetSha: resolvedSha,
    }));

    const provenance: Provenance = {
        source: target,
        channel,
        resolved_sha: resolvedSha,
        updated_at: nowIso(),
        ...(stableVersion ? { version: stableVersion } : {}),
    };

    if (detection.type === 'local') {
        const installRoot = detection.installRoot!;
        const result = spawn('npm', ['install', '--save-dev', '--install-links', target], { cwd: installRoot });
        if (result.status !== 0) return exit(result.status ?? 1);
        writeProvenance(installRoot, provenance);
        stdout('\ncanon-ai updated. Run `canon upgrade` to sync vendored files in this repo.\n');
    } else {
        const result = spawn('npm', ['install', '-g', '--install-links', target], { cwd });
        if (result.status !== 0) return exit(result.status ?? 1);
        if (existsSync(join(cwd, '.canon'))) {
            writeProvenance(cwd, provenance);
        } else {
            stdout('(no .canon/ directory found in the current repo — provenance not recorded. Run `canon init` here first to persist it on future updates.)');
        }
        stdout('\ncanon-ai updated. Run `canon upgrade` to sync vendored files in this repo.\n');
    }
}
```

This follows `stopCmd`'s `deps` convention exactly (`exit = deps.exit ?? ((code): never => process.exit(code))`, injected `stdout`/`stderr`, production defaults preserve real behavior, the seam is unreachable from the CLI arg surface). `src/cli/index.ts:135` (`updateCmd(args)`) needs **no change** — `deps` defaults to `{}`.

### Step 10: Red-first regression fixture (AC-2, AC-6's base case)

File: `tests/cli.test.ts`

This is the one part of the suite that must run against the **real committed `dist/`**, not source-level injection — per the spec's red-first strategy and the `docs/patterns.md` Test-writing-pitfalls entry on subprocess tests needing the active worktree's build.

Reuse the existing `writeExecutable`-style PATH-shim convention from `tests/run-task-safety.test.ts:46-48` (`#!/bin/sh`, `set -eu`, mode `0o755`) rather than inventing a new one:

```ts
function writeExecutable(scriptDir: string, name: string, body: string[]): void {
    fs.writeFileSync(path.join(scriptDir, name), ['#!/bin/sh', 'set -eu', ...body, ''].join('\n'), { mode: 0o755 });
}

function buildRedFirstFixture(dir: string): {
    installRoot: string;
    adopterDir: string;
    cliEntry: string;
    binDir: string;
    npmLogPath: string;
    gitLogPath: string;
    envPromptLogPath: string;
} {
    const installRoot = path.join(dir, 'install');
    const adopterDir = path.join(dir, 'adopter');
    const binDir = path.join(dir, 'bin');
    fs.mkdirSync(installRoot, { recursive: true });
    fs.mkdirSync(adopterDir, { recursive: true });
    fs.mkdirSync(binDir, { recursive: true });

    // install/: has canon-ai as a devDependency, and the REAL committed package under node_modules.
    fs.writeFileSync(path.join(installRoot, 'package.json'), JSON.stringify({
        name: 'install-project',
        devDependencies: { 'canon-ai': 'github:tstraub89/canon-ai' },
    }, null, 2));
    const pkgTarget = path.join(installRoot, 'node_modules', 'canon-ai');
    fs.mkdirSync(pkgTarget, { recursive: true });
    fs.cpSync(path.join(WORKTREE_ROOT, 'dist'), path.join(pkgTarget, 'dist'), { recursive: true });
    fs.cpSync(path.join(WORKTREE_ROOT, 'package.json'), path.join(pkgTarget, 'package.json'));

    // adopter/: unrelated project, no canon-ai anywhere.
    fs.writeFileSync(path.join(adopterDir, 'package.json'), JSON.stringify({
        name: 'unrelated-adopter-project',
        dependencies: { express: '^4.0.0' },
    }, null, 2));
    fs.writeFileSync(path.join(adopterDir, 'package-lock.json'), JSON.stringify({ name: 'unrelated-adopter-project', lockfileVersion: 3 }, null, 2));

    const npmLogPath = path.join(dir, 'npm.log');
    writeExecutable(binDir, 'npm', [
        `printf '%s\\t%s\\n' "$(pwd)" "$*" >> ${JSON.stringify(npmLogPath)}`,
        'exit 0',
    ]);

    const gitLogPath = path.join(dir, 'git.log');
    const envPromptLogPath = path.join(dir, 'git-env.log');
    writeExecutable(binDir, 'git', [
        `printf '%s\\n' "$*" >> ${JSON.stringify(gitLogPath)}`,
        `printf '%s\\n' "GIT_TERMINAL_PROMPT=${'${GIT_TERMINAL_PROMPT:-unset}'}" >> ${JSON.stringify(envPromptLogPath)}`,
        'if [ "$1" = "ls-remote" ] && [ "$2" = "--tags" ]; then',
        '  cat <<TAGS',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v8.1.0',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v8.2.0',
        'cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v8.2.0^{}',
        'TAGS',
        '  exit 0',
        'fi',
        'exit 1',
    ]);

    return {
        installRoot,
        adopterDir,
        cliEntry: path.join(pkgTarget, 'dist', 'cli', 'index.js'),
        binDir,
        npmLogPath,
        gitLogPath,
        envPromptLogPath,
    };
}
```

(The 40-char hex strings above must be exactly 40 characters — `a` × 40, `b` × 40, `c` × 40 — so the `HEX_SHA_RE`/shape assertions pass.)

The test itself:

```ts
void test('canon update (red-first): pins to installRoot cwd and the highest final-tag commit', () => {
    withTempDir(dir => {
        const fx = buildRedFirstFixture(dir);
        const result = spawnSync(process.execPath, [fx.cliEntry, 'update'], {
            cwd: fx.adopterDir,
            encoding: 'utf8',
            env: { ...process.env, PATH: `${fx.binDir}${path.delimiter}${process.env.PATH ?? ''}` },
        });
        assert.equal(result.status, 0, result.stderr);

        const npmLog = fs.readFileSync(fx.npmLogPath, 'utf8').trim().split('\n');
        assert.equal(npmLog.length, 1);
        const [recordedCwd, recordedArgs] = npmLog[0].split('\t');
        assert.equal(fs.realpathSync(recordedCwd), fs.realpathSync(fx.installRoot)); // (a) cwd = install root, not adopter
        // (a2) AC-6 base case: pinned to the highest final tag's PEELED commit (cccc..., not the tag-object bbbb...)
        assert.match(recordedArgs, /^install --save-dev --install-links github:tstraub89\/canon-ai#cccccccccccccccccccccccccccccccccccccccc$/);

        // (b) adopter manifest + lockfile untouched
        const adopterPkg = fs.readFileSync(path.join(fx.adopterDir, 'package.json'), 'utf8');
        assert.doesNotMatch(adopterPkg, /canon-ai/);
        assert.doesNotMatch(fs.readFileSync(path.join(fx.adopterDir, 'package-lock.json'), 'utf8'), /canon-ai/);

        // GIT_TERMINAL_PROMPT=0 observed on every git invocation (closes the spec-review nit)
        const envLines = fs.readFileSync(fx.envPromptLogPath, 'utf8').trim().split('\n');
        assert.ok(envLines.length > 0 && envLines.every(line => line === 'GIT_TERMINAL_PROMPT=0'));
    });
});
```

**Red-first execution order (do this before writing a single line of the fix):**
1. Write this test (and `buildRedFirstFixture`) against the **current, unmodified** `src/cli/commands/update.ts`.
2. Run `npm run build` (so `dist/` reflects the pre-fix source), then run this one test. It must fail: assertion (a) fails because the recorder observes `cwd` = the adopter dir, not the install root (today's `update.ts:27`, `const cwd = process.cwd();`), and the npm-args assertion fails because the recorded source has no `#<sha>` (today's unqualified `CANON_GITHUB_SOURCE`).
3. Record this red run (command + failure output) in `handoff.md`'s Iteration 1 notes — the AC requires it.
4. Implement Steps 1–9, run `npm run build` again, rerun this test — it must now pass.

AC-6(ii) (annotated-tag-peels-to-commit) is already exercised by this same fixture (the response includes both `v8.2.0` and its `^{}` peeled line; the assertion targets the peeled `cccc...`, not the tag-object `bbbb...`). AC-6(i), (iii), (iv) are unit-tested against `resolveStable`/`resolveNamedRef` directly per Step 6 — don't try to cram every resolver permutation into subprocess fixtures; only the base regression case needs the real dist.

### Step 11: `printHelp()` update (AC-10)

File: `src/cli/index.ts`

Replace line 33 (`canon update                Update the canon-ai package itself`) with a block documenting pinning + flags:

```
  canon update                Update the canon-ai package itself. Resolves the install root
                                (never the invocation cwd) and pins to the latest final release
                                by default — refuses rather than falling back to an unpinned
                                source. Writes .canon/provenance.json after a successful install
                                (written for future tooling; nothing reads it yet).
                                Flags: --channel main       pin to main's latest commit (dev)
                                       --ref <ref>           pin to a named ref's resolved commit (dev)
                                       --ref <40-hex-sha>    pin directly, skip resolution
                                --channel and --ref are mutually exclusive.
```

### Step 12: README.md (AC-10)

File: `README.md`

Two edits, both "written for future tooling" — no sentence may claim anything currently reads `.canon/provenance.json`, and the `canon doctor` row (line 221) is untouched (structural check: `git diff` must show no hunk touching that row).

1. **Key commands table, line 236** — replace:
   ```
   | `canon update` | Update the canon-ai package itself |
   ```
   with something like:
   ```
   | `canon update` | Update the canon-ai package itself. Targets the install's own root (never the invocation directory) and pins to the latest final release by default; refuses rather than installing an unpinned branch. `--channel main` / `--ref <ref\|sha>` pin a labeled development commit instead. Writes `.canon/provenance.json` after a successful install — recorded for future tooling, nothing reads it yet. |
   ```

2. **Install section, after the `--install-links` explanation (~line 95)** — add a short paragraph:
   ```
   > **Updating.** Once installed, use `canon update` rather than re-running `npm install` by hand — it resolves the exact install this binary is running from, pins to the latest tagged release by default (or a labeled development commit via `--channel main` / `--ref <ref|sha>`), and records what it installed to `.canon/provenance.json` for future tooling to read.
   ```

Run `npm run docs-refs-check` after — it validates path/doc references; neither edit introduces a broken reference, but confirm.

### Step 13: `docs/codebase-map.md` (Docs Impact)

File: `docs/codebase-map.md`, line 50

Replace:
```
| `canon update` command | `src/cli/commands/update.ts` | Detects install type (`local`/`global`/`npx`); drives adopter update checks |
```
with:
```
| `canon update` command | `src/cli/commands/update.ts` | Resolves the running install's root (`local`/`global`/`npx`, realpath-canonicalized); gates on manifest presence + `canon-ai` dependency listing; pins to the latest final release (or a labeled `main`/ref/SHA dev channel) via `git ls-remote`; writes `.canon/provenance.json` (write-only — no reader yet) |
```

This is the one "Protected doc, QA touch" row from the spec's Affected Files table — not canon-owned (confirmed: `src/cli/commands/update.ts` and `src/cli/index.ts` do not appear in `src/lib/canon-owned.ts`'s `CANON_OWNED`/`DELIMITED`), so no `templates/` mirror obligation for this task.

### Step 14: Build + validate

```bash
npm run lint
npm run type-check
npm run build          # rebuilds dist/cli/index.js — required before running Step 10's test
npm test               # full suite, including the red-first fixture (post-fix, must be green)
npm run docs-refs-check
```

Since `dist/` is committed and consumed directly by the red-first test, run `npm run build` immediately before the final `npm test` pass so the fixture reflects the real fix — a stale local `dist/` is the one documented way this test can mislead (Known Risks in the spec).

---

## Testing Plan

| AC | Covered by |
|---|---|
| AC-1 | Step 2 (updated existing tests + new symlink case) |
| AC-2 | Step 10 (red-first subprocess fixture, assertions (a)/(b)) |
| AC-3 | Step 5 unit tests (unparseable, missing-dep, all-three-blocks-pass) |
| AC-4 | Step 5 unit tests (missing manifest) |
| AC-5 | Step 7 unit tests (pinned/unpinned manifest, `--channel main`, no-provenance-read) |
| AC-6 | Step 10 (base case + peeled-tag), Step 6 unit tests (i, iii, iv) |
| AC-7 | Step 6 unit tests (resolver error, empty tags, only-prerelease-tags) |
| AC-8 | Step 6 unit tests (zero-match, ambiguous, SHA short-circuit) + Step 3 (flag errors) |
| AC-9 | Step 8 unit tests (stable/main/ref/global-with/global-without/failed-no-write) |
| AC-10 | Step 11 (printHelp), Step 12 (README) — verify via `npm run docs-refs-check` + manual diff read for consumption-claim language |
| AC-11 | Step 14 (`npm run build`, committed dist matches fresh build) |

## Rollback Plan

Single-file rewrite (`update.ts`) plus a `printHelp()` string change and two doc edits — revertable with `git revert` on the implementation commit. No data migration: `.canon/provenance.json` is a new file this task starts writing — an adopter who reverts to an older canon-ai simply stops getting it written (nothing reads it yet, so there's no consumer to break). No `status.json` schema, no pipeline-phase, no orchestrator-state involvement.
