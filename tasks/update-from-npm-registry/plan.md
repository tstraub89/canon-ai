# Plan: update-from-npm-registry

> Spec: `tasks/update-from-npm-registry/spec.md` | Spec review: `approved_with_nits`

Nit incorporated below: the registry-selection predicate tracks **both** `channel === 'stable'` **and** "no `CANON_UPSTREAM_REPO` override" as separate booleans — never inferred from the slug string alone — so an explicit override whose value happens to equal `tstraub89/canon-ai` still takes the git path.

## 1. `src/cli/commands/update.ts` — registry check + registry install path

### 1.1 Track override-vs-canonical explicitly

Replace the single-purpose `resolveEffectiveSlug()` call site in `updateCmd` with two separately-read facts:

```ts
const upstreamOverride = process.env.CANON_UPSTREAM_REPO?.trim();
const slug = upstreamOverride ? upstreamOverride : CANON_UPSTREAM_REPO;
```

Add a boolean used everywhere the registry-vs-git branch is decided:

```ts
const usesRegistry = channel === 'stable' && !upstreamOverride;
```

`usesRegistry` — not a slug comparison — is the single predicate gating: the registry existence check, the `npm install` argv shape, and the `Provenance.source` shape. This directly satisfies the spec-review nit: an override set to exactly `tstraub89/canon-ai` still has `upstreamOverride` truthy, so `usesRegistry` is `false` and the git path runs.

### 1.2 Resolve canon's own package name (for the registry spec and provenance)

Add a small helper near `bakedVersion()`:

```ts
function ownPackageName(pkgDir: string): string {
    try {
        const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')) as Record<string, unknown>;
        return typeof manifest.name === 'string' && manifest.name ? manifest.name : 'canon-ai';
    } catch {
        return 'canon-ai';
    }
}
```

`pkgDir` here is the same variable `updateCmd` already resolves (`deps.packageDir ?? packageDir` — the *canon package's own* install directory, e.g. `<installRoot>/node_modules/canon-ai` or the global equivalent), not the adopter's manifest read by `dependencyGate`. This mirrors the Implementation Notes: the registry spec's package name comes from canon's own `package.json`, not a second `'canon-ai'` literal — so a fork publishing under another name is not silently pointed at the upstream package. The `catch` fallback to `'canon-ai'` covers both real edge cases (a stripped/missing manifest) and test fixtures that don't lay down a `package.json` inside the mocked package dir — no fixture changes are required for this to keep working.

Call it once in `updateCmd` right after `pkgDir` is resolved: `const pkgName = ownPackageName(pkgDir);`. Use `pkgName` for the npx message (1.6), the registry check (1.3), and the registry install/provenance (1.4).

### 1.3 Registry existence check

Add an injected runner mirroring `GitRunner`:

```ts
export type NpmViewRunner = (args: string[]) => { status: number | null; stdout: string; stderr: string };

const NPM_VIEW_TIMEOUT_MS = 30_000;

export function defaultNpmViewRunner(args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('npm', args, { encoding: 'utf8', timeout: NPM_VIEW_TIMEOUT_MS });
    if (result.error) return { status: null, stdout: '', stderr: result.error.message };
    return { status: result.status, stdout: result.stdout ?? '', stderr: (result.stderr ?? '').trim() };
}
```

Add `npmViewRunner?: NpmViewRunner` to `UpdateCmdDeps`, defaulted the same way `gitRunner` is: `const npmView = deps.npmViewRunner ?? defaultNpmViewRunner;`.

Add the check function. **Verified against real npm 2026-09-04**: `npm view <pkg>@<version> version --json` exits non-zero (1) for both "package exists, version doesn't" and "package doesn't exist at all" — but in *both* cases `--json` still writes a parseable JSON error object (`{"error":{"code":"E404", ...}}`) to **stdout** (not just stderr). A successful lookup writes the version as a bare JSON string (`"3.0.0"`) to stdout with exit 0. This is why the spec's Implementation Note ("treat any non-zero exit as check failed, empty/mismatched as absent") needs refining — a non-zero exit is exactly the *normal* shape of the "absent" case, not a proxy for "check failed". Parse stdout regardless of exit code and branch on its shape:

```ts
export type RegistryCheckResult =
    | { ok: true }
    | { ok: false; absent: true; message: string }
    | { ok: false; absent: false; message: string };

export function checkRegistryVersion(pkgName: string, version: string, runner: NpmViewRunner): RegistryCheckResult {
    const result = runner(['view', `${pkgName}@${version}`, 'version', '--json']);

    let parsed: unknown;
    try { parsed = JSON.parse(result.stdout); } catch { parsed = undefined; }

    if (result.status === 0 && typeof parsed === 'string' && parsed === version) {
        return { ok: true };
    }
    if (typeof parsed === 'object' && parsed !== null && (parsed as { error?: { code?: unknown } }).error?.code === 'E404') {
        return {
            ok: false,
            absent: true,
            message: `canon update: ${pkgName}@${version} is not yet on the npm registry. This release exists on GitHub but has not reached npm yet — retry shortly, or install it directly with \`canon update --ref v${version}\`.`,
        };
    }
    return {
        ok: false,
        absent: false,
        message: `canon update: could not verify ${pkgName}@${version} on the npm registry (${result.stderr || 'no output'}). Aborting — no npm install run.`,
    };
}
```

Message check against AC-2's four required substrings: contains `X.Y.Z` (twice), the phrase `not yet on the npm registry`, the words `retry shortly`, and the fallback `canon update --ref vX.Y.Z` — all present verbatim.

### 1.4 Wire the check and the registry install into `updateCmd`

Right after `stableVersion` is set in the `channel = 'stable'` branch (i.e. once `resolveStable` has returned `ok: true`), add the gated check:

```ts
if (usesRegistry) {
    const registryCheck = checkRegistryVersion(pkgName, stableVersion as string, npmView);
    if (!registryCheck.ok) {
        stderr(registryCheck.message);
        return exit(1);
    }
}
```

Place this before `formatAnnouncement` is built, so a refusal prints nothing else and runs no `npm install` (AC-2's "no install spawn" requirement falls out naturally — the function returns before reaching the `spawn(...)` calls).

Change the `target` computation and both install branches to depend on `usesRegistry`:

```ts
const target = usesRegistry ? `${pkgName}@${stableVersion}` : `github:${slug}#${resolvedSha}`;
```

Local branch install call becomes:

```ts
const installArgs = usesRegistry
    ? ['install', saveFlag, target]
    : ['install', saveFlag, '--install-links', target];
const result = spawn('npm', installArgs, { cwd: installRoot });
```

Global branch symmetrically:

```ts
const installArgs = usesRegistry ? ['install', '-g', target] : ['install', '-g', '--install-links', target];
const result = spawn('npm', installArgs, { cwd });
```

`Provenance.source` already reads `target`, so it becomes `canon-ai@X.Y.Z` for registry installs and the unchanged `github:<slug>#<sha>` for git-path installs with no further change needed — `resolved_sha` and `version` are already populated from `resolvedSha`/`stableVersion` exactly as today (AC-4 is satisfied by the existing provenance-object construction once `target` is registry-shaped).

### 1.5 Confirm non-registry paths are untouched

`--channel main`, `--ref <ref-or-sha>`, and any `CANON_UPSTREAM_REPO` override all have `usesRegistry === false` (channel is `'main'` or `'ref'` in the first two cases; `upstreamOverride` is truthy in the third even if channel is `'stable'`). No call to `checkRegistryVersion` happens for any of them — satisfies AC-3's "no registry check on git channels" and the spec-review nit in one predicate.

### 1.6 npx message (AC-5)

Delete `CANONICAL_NPX_SOURCE` (`update.ts:108`) entirely. In the npx branch:

```ts
stdout(`  npx ${pkgName}@latest upgrade\n`);
```

`pkgName` here comes from 1.2, computed against the npx-resolved `pkgDir` — reuses the same "no second literal" mechanism the spec calls for on the registry install path, and still renders exactly `npx canon-ai@latest upgrade` for the canonical package (satisfies AC-5's literal text).

After this change, verify: `grep -n 'install-links' src/cli/commands/update.ts` returns only the two git-path spawn call sites (1.4) — no comments reference it elsewhere; `grep -rn 'npx --install-links' src/` and `grep -rn 'CANONICAL_NPX_SOURCE' src/ tests/` both return nothing (test-file references are removed in step 2).

## 2. `tests/cli.test.ts`

### 2.1 Shared test fixtures

Add a default stable-path `NpmViewRunner` stub next to `stableUpdateGitRunner` (~line 184), used by every test that doesn't care about the registry-check outcome:

```ts
function stableNpmViewRunner(args: string[]): { status: number; stdout: string; stderr: string } {
    const spec = args[1] ?? '';
    const atIdx = spec.lastIndexOf('@');
    const version = atIdx > 0 ? spec.slice(atIdx + 1) : '';
    return { status: 0, stdout: JSON.stringify(version), stderr: '' };
}
```

It echoes back whatever version was requested as a successful lookup — generic across every stable-tag fixture in this file without needing to hardcode `8.2.0`.

Update `runLocalUpdate` (~line 195) to pass it through by default: add `npmViewRunner: stableUpdateGitRunner ? stableNpmViewRunner : undefined` — concretely, just add `npmViewRunner: stableNpmViewRunner,` to the `updateCmd(args, { ... })` call alongside `gitRunner: stableUpdateGitRunner`.

### 2.2 The four argv-pinning tests (AC-1) — update to registry argv

All four currently assert the resolved tag is `v8.2.0` (`UPDATE_SHA_C` peeled). Under the registry path the argv drops `--install-links` and the `github:` spec, replacing the target with `canon-ai@8.2.0`.

- **`canon update (red-first): pins to installRoot cwd and the highest final-tag commit`** (~line 411): this test spawns the real built CLI via `buildUpdateRedFirstFixture`'s mocked `npm`/`git` binaries, so the mock `npm` script itself must branch on subcommand. Update `writeExecutable(binDir, 'npm', [...])` (~line 115) to:

  ```ts
  writeExecutable(binDir, 'npm', [
      `printf '%s\\t%s\\n' "$(pwd)" "$*" >> ${JSON.stringify(npmLogPath)}`,
      'if [ "$1" = "view" ]; then',
      '  case "$2" in',
      '    *@*) version="${2##*@}" ;;',
      '    *) version="" ;;',
      '  esac',
      '  printf \'"%s"\' "$version"',
      'fi',
      'exit 0',
  ]);
  ```

  (echoes the requested version back as a JSON string, exit 0 — mirrors `stableNpmViewRunner` at the shell level.) Then change the assertion at line 432 from
  `/^install --save-dev --install-links github:tstraub89\/canon-ai#cccc...$/`
  to
  `/^install --save-dev canon-ai@8\.2\.0$/`. Also assert the npm log now has **two** entries (the `view` call and the `install` call) instead of one: `assert.equal(npmLog.length, 2);` and index the install call specifically (`npmLog[1]`) for the argv match, since `view` happens first.

- **`canon update (red-first): falls back to SSH when HTTPS resolution fails (AC-12b, stable path)`** (~line 442): same mock-npm update as above (shared script). Change the assertion at line 459 from the `github:...cccc` pattern to `/^install --save-dev canon-ai@8\.2\.0$/` (and update the npm-log indexing the same way — the `view` call is unaffected by the HTTPS/SSH git fallback, which only concerns tag resolution).

- **`canon update: canon-ai in each supported dependency block proceeds`** (~line 529): `runLocalUpdate` now carries `npmViewRunner` by default (2.1). Change line 540 from
  `` new RegExp(`^install ${expectedSaveFlags[block]} --install-links`) ``
  to
  `` new RegExp(`^install ${expectedSaveFlags[block]} canon-ai@8\\.2\\.0$`) ``.

- **`canon update: global provenance uses an existing invoking-repo .canon only`** (~line 839, first `withTempDir` block): add `npmViewRunner: stableNpmViewRunner` to the `updateCmd` call (~line 847). Change line 855 from
  `assert.deepEqual(npmArgs[0].slice(0, 3), ['install', '-g', '--install-links']);`
  to
  `assert.deepEqual(npmArgs[0], ['install', '-g', 'canon-ai@8.2.0']);`.
  The second `withTempDir` block in the same test (~line 858) does not assert argv — no change needed there beyond adding `npmViewRunner: stableNpmViewRunner` to its `updateCmd` call so it doesn't throw (its `spawnRunner` handles both `view` and `install` the same way already, since it just returns `{ status: 0 }` unconditionally — but that call goes through `spawnRunner`, not `npmViewRunner`; the registry check must go through the new `npmViewRunner` seam, so add it there too even though nothing new is asserted).

### 2.3 New AC-1 assertion: also verify the registry check ran with the right spec

For at least one of the four tests above (suggest the three-flags-loop test, since it's the cheapest to extend), add an assertion that the injected `npmViewRunner` was actually called with `['view', 'canon-ai@8.2.0', 'version', '--json']` — capture calls via a local array the same way `npmArgs`/`gitArgs` are captured elsewhere in this file, rather than relying only on the argv side-effect.

### 2.4 AC-2 — two new tests: registry absent, registry check failed

Add two new tests near the other stable-path tests (after 2.2's group, ~line 544):

```ts
void test('canon update: registry-absent version refuses with the ref fallback, no install spawn', () => {
    withTempDir(dir => {
        const errors: string[] = [];
        const npmCalls: string[] = [];
        assert.throws(() => updateCmd([], {
            packageDir: path.join(dir, 'node_modules', 'canon-ai'),
            cwd: dir,
            gitRunner: stableUpdateGitRunner,
            npmViewRunner: () => ({ status: 1, stdout: JSON.stringify({ error: { code: 'E404' } }), stderr: 'npm error 404' }),
            spawnRunner: () => { npmCalls.push('called'); return { status: 0 }; },
            stderr: message => errors.push(message),
            exit: code => { throw new UpdateExitError(code); },
        }), (error: unknown) => error instanceof UpdateExitError && error.code === 1);
        assert.match(errors[0], /8\.2\.0/);
        assert.match(errors[0], /not yet on the npm registry/);
        assert.match(errors[0], /retry shortly/);
        assert.match(errors[0], /canon update --ref v8\.2\.0/);
        assert.deepEqual(npmCalls, []);
    });
});

void test('canon update: registry check failure (network) refuses, no install spawn', () => {
    withTempDir(dir => {
        const errors: string[] = [];
        const npmCalls: string[] = [];
        assert.throws(() => updateCmd([], {
            packageDir: path.join(dir, 'node_modules', 'canon-ai'),
            cwd: dir,
            gitRunner: stableUpdateGitRunner,
            npmViewRunner: () => ({ status: null, stdout: '', stderr: 'getaddrinfo ENOTFOUND registry.npmjs.org' }),
            spawnRunner: () => { npmCalls.push('called'); return { status: 0 }; },
            stderr: message => errors.push(message),
            exit: code => { throw new UpdateExitError(code); },
        }), (error: unknown) => error instanceof UpdateExitError && error.code === 1);
        assert.match(errors[0], /could not verify/);
        assert.match(errors[0], /ENOTFOUND/);
        assert.deepEqual(npmCalls, []);
    });
});
```

Both use the *global* branch shape (`packageDir`/`cwd` with no local `package.json`) so `detectInstallType` resolves to `'global'` and skips `layoutGate`/`dependencyGate` entirely — simplest fixture that still reaches the registry check. (`detectInstallType` treats any path with no `node_modules` ancestor whose parent has a `package.json` as global; passing a bare `dir` with no `package.json` at all satisfies that today — confirm by running the two tests once added, and if `detectInstallType` needs a real dir structure, fall back to the `local`-shape fixture used by `makeLocalUpdateRoot` instead.)

### 2.5 AC-3 — extend existing git-path tests to assert no registry check ran

For the existing `--channel main` test (~line 738), the fork-slug test (~line 767), and the full-SHA `--ref` test (~line 789), add `npmViewRunner: () => { throw new Error('registry check must not run'); }` to each `updateCmd` call. These already assert success (no throw reaches the test body), so a thrown error from `npmViewRunner` firing would fail the test — proving the registry check is skipped for all three non-registry channels.

### 2.6 New npx test (AC-5)

Add a test for the npx branch (there is none today — only `detectInstallType`'s npx-path unit tests exist at ~line 337):

```ts
void test('canon update: npx branch recommends the registry package, not a github spec', () => {
    const output: string[] = [];
    updateCmd([], {
        packageDir: '/home/user/.npm/_npx/abc123/node_modules/canon-ai',
        stdout: message => output.push(message),
        exit: code => { throw new UpdateExitError(code); },
    });
    assert.match(output.join('\n'), /npx canon-ai@latest upgrade/);
    assert.doesNotMatch(output.join('\n'), /--install-links/);
    assert.doesNotMatch(output.join('\n'), /github:/);
});
```

No `gitRunner`/`npmViewRunner` needed — the npx branch returns before either resolver runs (matches today's early-return structure at `update.ts:391-396`).

### 2.7 Grep-based dead-code assertions (AC-5, read not test)

No test needed here beyond what 2.6 already covers structurally; the AC's grep commands are run manually/by CI as stated, not encoded as a `node:test` case.

## 3. `package.json` — drop install scripts, add dev-only hook script

- Remove the `"postinstall": "node scripts/install-git-hooks.mjs",` line entirely.
- Remove `"scripts/install-git-hooks.mjs",` from the `files` array.
- Add `"hooks": "node scripts/install-git-hooks.mjs"` to `scripts` (alphabetical-ish placement next to `sync-templates` scripts is fine, no enforced ordering in this file today).

No change to `scripts/install-git-hooks.mjs` itself — its guard logic (skip gracefully with no `.git/`) is unchanged; it just stops being invoked automatically.

## 4. `CONTRIBUTING.md` — document `npm run hooks`

In `## Development setup` (~line 18-29), insert `npm run hooks` into the fenced command block right after `npm ci`, plus one explanatory sentence before or after the block:

```bash
git clone https://github.com/tstraub89/canon-ai.git
cd canon-ai
npm ci
npm run hooks
npm run build
npm test
```

Add a sentence: "`npm run hooks` installs canon-ai's own contributor pre-commit hook (template-mirror sync); skipping it still works, but CI's `sync-templates:check` catches a skipped step at PR time."

## 5. `README.md` — registry-first install/update language

Update the "Updating" callout at `README.md:101` to state the registry-vs-GitHub split. Replace:

> "...it resolves the exact install this binary is running from, pins to the latest tagged release by default (or a labeled development commit via `--channel main` / `--ref <ref|sha>`)..."

with something like:

> "...it resolves the exact install this binary is running from and installs the latest tagged release **from the npm registry** by default, or a labeled development commit **from GitHub** via `--channel main` / `--ref <ref|sha>`..."

Update the CLI reference table row at `README.md:257` similarly — "pins to the latest final release by default" → "installs the latest final release from the npm registry by default"; keep the rest of that row (the git-path description for `--channel main` / `--ref`) as is.

## 6. `src/cli/commands/init.ts` — rewrite the stale comment

Replace the comment block at lines 85-93 (currently: "Package.json mutation disabled — canon-ai isn't on the npm registry..."). New comment content, same shape (explains why the `if (isJsProject) { updatePackageJson(pkgPath); }` stays commented out):

```ts
// Package.json mutation disabled — canon-ai is on the npm registry, but a
// per-project devDependency write is still unnecessary: adopters install
// canon globally (`npm install -g canon-ai`), and `canon update` already
// resolves and updates that global install directly. Writing
// `"canon-ai": "^<ver>"` into an adopter's devDependencies would just be a
// second, unmaintained pin. The `"canon": "canon"` script alias was also a
// no-op once canon is on PATH. Re-enable if canon-ai ever needs a
// per-project devDependency story.
// See `updatePackageJson()` below — body preserved for that future revival.
// if (isJsProject) {
//     updatePackageJson(pkgPath);
// }
```

No logic changes — `isJsProject` (line 84) has another live use at line 107 (`if (!isJsProject) { ... }`), so it stays exactly as declared; only the comment block (lines 85-93) and the still-commented-out `if (isJsProject) { updatePackageJson(pkgPath); }` body's surrounding prose change.

## 7. `CHANGELOG.md` — `[Unreleased]` entries (AC-10)

Add under `## [Unreleased]` (currently empty at line 5):

```markdown
### Changed

- **`canon update` installs stable releases from the npm registry, not GitHub.** After resolving the latest release tag, it now installs `canon-ai@<version>` from npm instead of a `github:<slug>#<sha>` spec — adopters who installed via `npm install -g canon-ai` stay on the registry package. If a tagged release hasn't reached the registry yet, `canon update` refuses with the version, a note that it's not on npm yet, and a `--ref v<version>` fallback to install it from GitHub directly. `--channel main`, `--ref <ref|sha>`, and `CANON_UPSTREAM_REPO` fork overrides are unchanged — they still install from GitHub.

### Removed

- **The published package no longer runs a `postinstall` script.** `scripts/install-git-hooks.mjs` only ever did anything for canon-ai's own contributors (installing the pre-commit hook); it exited as a no-op in every adopter install while still triggering npm's install-scripts warning. Contributors now run `npm run hooks` once after cloning (documented in `CONTRIBUTING.md`).
```

## 8. `docs/codebase-map.md` — update two rows

- Line 50, `canon update` command row. Current text: "Resolves the running install's root (`local`/`global`/`npx`, realpath-canonicalized); gates on manifest presence + `canon-ai` dependency listing; pins to the latest final release (or a labeled `main`/ref/SHA dev channel) via `git ls-remote`; writes `provenance.json` in `.canon` (write-only — no reader yet)". Change "pins to the latest final release (or a labeled `main`/ref/SHA dev channel) via `git ls-remote`" to "pins to the latest final release, installed from the npm registry (or a labeled `main`/ref/SHA dev channel installed from GitHub) — both resolved via `git ls-remote`".
- Line 150, "Postinstall git-hooks setup" row: reword the right cell from "Conditional `simple-git-hooks` wrapper; skips gracefully when no `.git/` present (e.g. adopter CI)" to "Contributor-only `simple-git-hooks` wrapper, run via `npm run hooks`; no longer wired to `postinstall`" — and rename the left cell from "Postinstall git-hooks setup" to "Contributor git-hooks setup".

## 9. Build artifacts

- `dist/cli/index.js` — rebuild via `npm run build` after 1.x and 6 land (bundles `update.ts` and `init.ts`).
- `dist/orchestrator/run-task.js` — the spec notes this may or may not change; run the build and check `git status` on it before deciding whether to include it in the handoff Changes table (declare it either way per the spec's Affected Files row so the `code_review` handoff-diff preflight doesn't reject an undeclared rebuild).

## Order of implementation

1. `src/cli/commands/update.ts` (section 1) — the only behavior change.
2. `tests/cli.test.ts` (section 2) — make `npm test` green against the new behavior.
3. `package.json` + `CONTRIBUTING.md` (sections 3-4) — postinstall removal, independent of 1/2.
4. `README.md` + `src/cli/commands/init.ts` comment + `docs/codebase-map.md` (sections 5-6-8) — docs.
5. `CHANGELOG.md` (section 7).
6. `npm run build` and commit `dist/` (section 9).
7. Run the full validation set from `docs/architecture.md` (lint, type-check, test, build, sync-templates:check, docs-refs-check) before handoff.

## Known plan-level deviations from the spec's non-binding Implementation Notes

- The registry-check classification logic (1.3) does **not** literally follow "treat any non-zero exit as check failed" — verified against real `npm view --json` output that a non-zero exit is the *normal* shape for "absent" (E404 in a still-parseable stdout JSON object), so the plan parses stdout content instead of branching on exit status alone. This is a refinement within the Implementation Notes' explicitly non-binding scope, not a spec change — no `notes.md` entry needed.

## Reroute Plan

> Amendment: Round 1, 2026-09-04 (`--save-exact` on local registry installs). Amendment review verdict: `approved_with_nits`. Codex has already implemented rounds 1-3 of the original spec (registry check, install path, npx message, provenance, docs, postinstall removal — see `handoff.md` Iterations 1-3); `update.ts` currently reads exactly as sections 1.1-1.6 of the plan above describe, confirmed at `src/cli/commands/update.ts:464` (`usesRegistry`), `:509` (`target`), `:536-539` (local install args, no `--save-exact` yet), `:548-549` (global install args). This section plans only the amendment delta: AC-1 (amended), AC-11 (new), and the two carried nits (lockfile regen, hook-header rewrite). Prior plan steps 2.1-2.7 (test fixtures), 3-9 (package.json, CONTRIBUTING, README, init.ts comment, CHANGELOG, codebase-map, build) still apply as already executed; only the deltas below are new work.

### Delta

1. **`src/cli/commands/update.ts` — `--save-exact` on the local registry install only.** At `:536-538`, change the local `installArgs` ternary so the registry branch adds the flag:
   ```ts
   const installArgs = usesRegistry
       ? ['install', saveFlag, '--save-exact', target]
       : ['install', saveFlag, '--install-links', target];
   ```
   Leave the global branch (`:548-549`) untouched — the amendment is explicit that no manifest is written for global installs, so `--save-exact` does not belong there. Leave every git-path branch (`else` arms above) untouched.

2. **`tests/cli.test.ts` — AC-1 amended argv assertions.** Three existing local-path assertions must gain `--save-exact` in the matched pattern (the fourth, global, must positively confirm its *absence* — already true today since the global assertion (`:943`) matches the unchanged `['install', '-g', 'canon-ai@8.2.0']` array exactly, so no edit needed there beyond a confirming read):
   - `:460` (red-first fixture, "pins to installRoot cwd..."): `/^install --save-dev canon-ai@8\.2\.0$/` → `/^install --save-dev --save-exact canon-ai@8\.2\.0$/`.
   - `:487` (red-first fixture, SSH-fallback test): same pattern change.
   - `:568` (three-save-flags loop test): `` new RegExp(`^install ${expectedSaveFlags[block]} canon-ai@8\\.2\\.0$`) `` → `` new RegExp(`^install ${expectedSaveFlags[block]} --save-exact canon-ai@8\\.2\\.0$`) ``.

   Since the mock `npm` binary in `buildUpdateRedFirstFixture` (`:115-122`) and the unit-level `spawnRunner`/`npmArgs` capture used by the loop test (`:568`) both echo argv verbatim rather than parsing individual flags, no mock-script logic changes — only the three regex/pattern literals above.

3. **AC-11 (new) — manifest pin assertion, in the red-first fixture.** The spec-review amendment nit says AC-11 must name the fixture or dependency block so the exact-pin check can't be satisfied by the announcement test alone; use the same red-first fixture as step 2's first two bullets (`buildUpdateRedFirstFixture`, exercised by the `"pins to installRoot cwd and the highest final-tag commit"` test at `:438-464`) since it is the one local-path test that runs against a real `installRoot/package.json` on disk (`devDependencies: { 'canon-ai': 'github:tstraub89/canon-ai' }` seeded at `:97-99`).

   The fixture's mock `npm` (`:115-122`) currently only logs invocations — it never mutates `installRoot/package.json`, so a real manifest-pin assertion needs the mock extended to simulate npm's actual effect for an `install <saveFlag> --save-exact <pkg>@<version>` call: when `$1 = install` and args include a `--save-exact`-adjacent bare `pkg@version` target, rewrite the `canon-ai` entry under the save-flag's corresponding manifest block (`devDependencies` for `--save-dev`, matching this fixture's seeded block) to the bare `<version>` string via a small inline `node -e` or `sed` step in the mock script, alongside the existing `printf`/log lines. Keep the `view` branch and `exit 0` untouched.

   Then in the `"pins to installRoot cwd and the highest final-tag commit"` test body, after the existing `assert.match(recordedArgs, ...)` line (now updated per step 2), add:
   ```ts
   const installRootManifest = JSON.parse(fs.readFileSync(path.join(fixture.installRoot, 'package.json'), 'utf8'));
   assert.equal(installRootManifest.devDependencies['canon-ai'], '8.2.0');
   ```
   This is red-first exactly as the amendment states: today's `--save-dev canon-ai@8.2.0` argv (pre-delta) has no `--save-exact`, so a real `npm install` against it would write `^8.2.0`; the assertion fails until both the mock's simulated write and the production argv change (step 1) land together.

4. **AC-4 announcement path — exact-pin manifest case.** In `"canon update: announces current and target pins without reading provenance"` (`:778-814`), add one more nested `withTempDir` block alongside the existing `registryDir`/`unpinnedDir` blocks (after `:796`), using a bare-exact manifest value to prove `currentPinFromManifest()` already renders a no-prefix version without change:
   ```ts
   withTempDir(exactDir => {
       const exact = runLocalUpdate(exactDir, [], {
           name: 'local-project',
           devDependencies: { 'canon-ai': '8.2.0' },
       });
       assert.match(exact.output[0], /current: .* @ 8\.2\.0/);
   });
   ```
   No production change needed here — `currentPinFromManifest()` already accepts a bare `X.Y.Z` value per the amendment review's own finding; this is a regression-pinning test only.

5. **Carried nit — regenerate `package-lock.json`.** Run `npm install --package-lock-only` after step 1 lands (needs `package.json`'s `postinstall` already removed from the prior round, which it is per `handoff.md` Iteration 1). Confirm via `git diff package-lock.json` that only `hasInstallScript` fields flip from `true` to absent/`false` at the root entry (`:10`) and any other canon-ai self-entries (`:1545`, `:1857`, `:2409`, `:3044` today — line numbers will shift) — no dependency version churn. If the diff touches anything beyond `hasInstallScript`, stop and investigate before committing (a version bump there would be an unrelated, undeclared change).

6. **Carried nit — rewrite `scripts/install-git-hooks.mjs` header.** The header comment (currently: *"Postinstall wrapper around `simple-git-hooks`..."*) still calls itself a postinstall script. Reword to describe it as the contributor-only script invoked by `npm run hooks` (no longer autorun), consistent with the `package.json`/`CONTRIBUTING.md`/`docs/codebase-map.md` changes already shipped in the prior round. Comment-only — the skip-case logic below it (no `.git/`, no devDependencies, worktree `.git` file) is unchanged and still accurate since a contributor invoking the script manually can still hit those same guards.

7. **`README.md` — note the exact pin.** The "Updating" callout at `README.md:101` (already rewritten in the prior round to say registry-vs-GitHub) gets one added clause stating that a project-local update pins the exact version, e.g. append after the existing sentence: "A project-local update pins the exact version (`--save-exact`); a global update has no manifest to pin." Keep the existing registry/GitHub split sentence unchanged.

8. **`dist/cli/index.js` — rebuild.** After step 1, `npm run build` to pick up the `--save-exact` argv change; recommit alongside the source and test changes.

### Order of implementation (delta only)

1. `src/cli/commands/update.ts` (delta 1).
2. `tests/cli.test.ts` (deltas 2-4) — make `npm test` green against the new argv and manifest behavior.
3. `package-lock.json` regen (delta 5) and `scripts/install-git-hooks.mjs` header (delta 6) — independent of 1-2.
4. `README.md` (delta 7) — independent, docs only.
5. `npm run build` and commit `dist/cli/index.js` (delta 8).
6. Re-run the full validation set (lint, type-check, test, build, sync-templates:check, docs-refs-check, `npm pack --dry-run`) before handoff — same set already green per `handoff.md` Iteration 3, must stay green after this delta.
