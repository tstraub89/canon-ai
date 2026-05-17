# Implementation Plan: claude-min-version

> Written by: Claude | Implements: `tasks/claude-min-version/spec.md`

## Approach

Mirror the existing `checkNodeVersion()` pattern in `src/cli/commands/doctor.ts:87-97`: a small pure-parsing helper paired with a `Check` function that calls the helper and produces a verdict. The parser is exported so unit tests can exercise it directly without spawning `claude`. The `Check` function takes an injectable runner argument that defaults to `execSync('claude --version', ...).toString()` — tests pass a stub function that returns canned version strings.

For the `claude.ts` stderr-pattern catch: extend the existing spawn-failure branch (around `:134-140` for the `-p` path, around `:40` for the interactive path). Define a module-level regex constant alongside the existing `CLAUDE_RESUME_NOT_FOUND_RE` (`:9`). Print the hint to `console.error` immediately before `process.exit(...)`.

No new files; all edits land in `src/cli/commands/doctor.ts`, `scripts/run-task/agents/claude.ts`, `tests/cli.test.ts`, `README.md`, `CHANGELOG.md`, plus the regenerated `dist/`.

## Steps

### Step 1: Add `MIN_CLAUDE_VERSION` + `parseClaudeVersion` helper in doctor.ts

Files: `src/cli/commands/doctor.ts`

Add near the top of the file (alongside `RECOMMENDED_ALLOW` around `:21-41`):

```ts
export const MIN_CLAUDE_VERSION = { major: 2, minor: 1, patch: 72 };

export interface ParsedVersion { major: number; minor: number; patch: number; }

export function parseClaudeVersion(raw: string): ParsedVersion | null {
    const match = raw.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return {
        major: parseInt(match[1], 10),
        minor: parseInt(match[2], 10),
        patch: parseInt(match[3], 10),
    };
}
```

The regex anchors at the start of the trimmed input so the canonical `2.1.143 (Claude Code)` parses cleanly while non-semver shapes return null.

### Step 2: Add `checkClaudeVersion` in doctor.ts

Files: `src/cli/commands/doctor.ts`

Add after `checkBinary` (around `:106`), matching the `checkNodeVersion` shape:

```ts
type VersionRunner = () => string;

const defaultClaudeVersionRunner: VersionRunner = () =>
    execSync('claude --version', { encoding: 'utf8' });

export function checkClaudeVersion(runner: VersionRunner = defaultClaudeVersionRunner): Check {
    let raw: string;
    try {
        raw = runner();
    } catch {
        return {
            label: 'claude (version unreadable)',
            status: 'warn',
            detail: 'Could not read `claude --version` — verify your Claude Code install',
        };
    }
    const parsed = parseClaudeVersion(raw);
    if (!parsed) {
        return {
            label: `claude (unparseable: ${raw.trim().slice(0, 40)})`,
            status: 'warn',
            detail: 'Could not parse `claude --version` output — verify your Claude Code install',
        };
    }
    const { major, minor, patch } = parsed;
    const label = `claude ${major}.${minor}.${patch}`;
    const m = MIN_CLAUDE_VERSION;
    const tooOld =
        major < m.major ||
        (major === m.major && minor < m.minor) ||
        (major === m.major && minor === m.minor && patch < m.patch);
    if (tooOld) {
        return {
            label,
            status: 'fail',
            detail: `Claude Code ${m.major}.${m.minor}.${m.patch}+ required — npm install -g @anthropic-ai/claude-code`,
        };
    }
    return { label, status: 'pass' };
}
```

Add an `execSync` import: `import { execSync } from 'child_process';` at the top of `doctor.ts` (the existing imports use `isAvailable` from `deps.ts`; this needs the direct import).

### Step 3: Wire `checkClaudeVersion` into `doctorCmd`'s `envChecks`

Files: `src/cli/commands/doctor.ts`

In `doctorCmd` (`:279`), update the `envChecks` array. Insert immediately after the existing `claude` binary check at `:286`:

```ts
const envChecks: Check[] = [
    checkPlatform(),
    checkNodeVersion(),
    checkBinary('git', true, 'https://git-scm.com/downloads'),
    checkBinary('claude', true, 'npm install -g @anthropic-ai/claude-code'),
    ...(isAvailable('claude') ? [checkClaudeVersion()] : []),
    checkBinary('codex', true, 'npm install -g @openai/codex'),
    checkBinary('gh', false, 'brew install gh && gh auth login  (required for --pr / --push)'),
];
```

The conditional spread avoids printing a redundant warn line when claude isn't installed — `checkBinary` already covers the missing-binary case loudly. (Satisfies AC-1's "skip when claude not available" qualifier.)

### Step 4: Add unit tests for `parseClaudeVersion` and `checkClaudeVersion`

Files: `tests/cli.test.ts`

Extend the existing doctor-imports block (around `:10-19`) to add `checkClaudeVersion`, `parseClaudeVersion`, `MIN_CLAUDE_VERSION`.

Append a new test section after the existing retired-phase test (around `:800`):

```ts
// ── parseClaudeVersion ───────────────────────────────────────────────────────

void test('parseClaudeVersion: parses "2.1.143 (Claude Code)" → 2.1.143', () => {
    assert.deepEqual(parseClaudeVersion('2.1.143 (Claude Code)'), { major: 2, minor: 1, patch: 143 });
});

void test('parseClaudeVersion: parses bare "2.1.72"', () => {
    assert.deepEqual(parseClaudeVersion('2.1.72'), { major: 2, minor: 1, patch: 72 });
});

void test('parseClaudeVersion: returns null for empty string', () => {
    assert.equal(parseClaudeVersion(''), null);
});

void test('parseClaudeVersion: returns null for non-semver "Claude Code v??"', () => {
    assert.equal(parseClaudeVersion('Claude Code v??'), null);
});

// ── checkClaudeVersion ───────────────────────────────────────────────────────

void test('checkClaudeVersion: pass for 2.1.143', () => {
    const check = checkClaudeVersion(() => '2.1.143 (Claude Code)');
    assert.equal(check.status, 'pass');
    assert.equal(check.label, 'claude 2.1.143');
});

void test('checkClaudeVersion: pass for 2.1.72 (exact minimum)', () => {
    const check = checkClaudeVersion(() => '2.1.72 (Claude Code)');
    assert.equal(check.status, 'pass');
});

void test('checkClaudeVersion: fail for 2.1.71 (one below minimum)', () => {
    const check = checkClaudeVersion(() => '2.1.71 (Claude Code)');
    assert.equal(check.status, 'fail');
    assert.match(check.detail ?? '', /2\.1\.72\+ required/);
});

void test('checkClaudeVersion: fail for 2.1.34 (James reported)', () => {
    const check = checkClaudeVersion(() => '2.1.34 (Claude Code)');
    assert.equal(check.status, 'fail');
});

void test('checkClaudeVersion: pass for 3.0.0 (future major)', () => {
    const check = checkClaudeVersion(() => '3.0.0 (Claude Code)');
    assert.equal(check.status, 'pass');
});

void test('checkClaudeVersion: warn for unparseable output', () => {
    const check = checkClaudeVersion(() => 'garbage output');
    assert.equal(check.status, 'warn');
});

void test('checkClaudeVersion: warn when runner throws', () => {
    const check = checkClaudeVersion(() => { throw new Error('spawn failed'); });
    assert.equal(check.status, 'warn');
});

void test('MIN_CLAUDE_VERSION is exactly 2.1.72', () => {
    assert.deepEqual(MIN_CLAUDE_VERSION, { major: 2, minor: 1, patch: 72 });
});
```

Twelve tests total. The spec asked for at least ten; the two extras (explicit boundary at 2.1.72 and the constant assertion) guard the threshold against accidental drift.

### Step 5: Add stderr-pattern catch in claude.ts

Files: `scripts/run-task/agents/claude.ts`

Add module-level constants alongside `CLAUDE_RESUME_NOT_FOUND_RE` (`:9`):

```ts
export const CLAUDE_UNKNOWN_EFFORT_RE = /unknown\s+option[^\n]*--effort/i;

const TOO_OLD_HINT = 'Claude Code is too old for canon — run `canon doctor` to verify (canon requires Claude Code 2.1.72+).';
```

For the `-p` streaming path, update the exit-code branch at `:136-139`:

```ts
if (typeof result.exitCode === 'number' && result.exitCode !== 0) {
    if (CLAUDE_UNKNOWN_EFFORT_RE.test(result.capturedStderr)) {
        console.error(TOO_OLD_HINT);
    }
    status = 'failed';
    process.exit(result.exitCode);
}
```

For the interactive path (around `:40`): `runCommandOrDie` exits the process on non-zero with `stdio: 'inherit'`, which means stderr streams directly to the terminal and isn't captured by the orchestrator. The hint can still be emitted **after** spawn but **before** `runCommandOrDie` returns control by switching to `spawnSync('claude', args, { stdio: ['inherit','inherit','pipe'] })` and inspecting the captured stderr on non-zero exit. **Implementer's call** which form is cleaner — either:

- (a) Swap `runCommandOrDie` for a local `spawnSync` with piped stderr in the interactive path. Inspect captured stderr against `CLAUDE_UNKNOWN_EFFORT_RE` on non-zero; print the hint; then `process.exit(exitCode)`.
- (b) Leave the interactive path unchanged. The `-p` path is the primary defense; document in handoff that the interactive hint is intentionally not wired because `runCommandOrDie`'s `stdio: 'inherit'` doesn't capture stderr.

If (a) requires reworking `runCommandOrDie`'s contract or duplicating non-trivial logic, prefer (b) and note the tradeoff in handoff. The doctor check is the load-bearing guard either way.

**If the regex turns out not to match Claude's real error format** (per spec Known Risks): reproduce the failure locally — easiest path is to pass a guaranteed-bogus flag to current Claude (e.g., `claude --print --bogus-flag-test=1 hi`) and observe how stderr renders. Adjust the regex to match the observed pattern. If the format varies across Claude versions in a way that no single regex catches reliably, drop AC-6 and document in handoff. The doctor check remains.

### Step 6: Update README Prerequisites

Files: `README.md`

Line 79 currently reads:

```md
- **Claude Code** — `npm install -g @anthropic-ai/claude-code`
```

Change to:

```md
- **Claude Code (≥ 2.1.72)** — `npm install -g @anthropic-ai/claude-code`
```

### Step 7: Add CHANGELOG entry

Files: `CHANGELOG.md`

Check whether `## [1.1.4] — unreleased` already exists. If not, insert it above `## [1.1.3]` with the standard Keep-a-Changelog shape. Add a `### Fixed` entry:

```md
### Fixed

- **Require Claude Code ≥ 2.1.72.** canon's orchestrator unconditionally passes `--effort` to every Claude spawn, but the flag didn't exist before Claude Code 2.1.72 — every Claude pipeline phase (spec / plan / code_review / qa) crashes immediately on older installs with an opaque "unknown option" error. `canon doctor` now enforces the minimum and reports a clear upgrade message. As defense-in-depth, the orchestrator's Claude spawn-failure path detects the unknown-`--effort` error pattern and prints a one-line hint pointing the user at `canon doctor`. No change to runtime `--effort` argument construction — the doctor check is the gate. Reported by James in [#70](https://github.com/tstraub89/canon-ai/issues/70).
```

### Step 8: Rebuild `dist/`

Files: `dist/cli/index.js`, `dist/scripts/run-task.js`

Run `npm run build`. CI's "Verify committed dist/ matches a fresh build" step will fail otherwise.

## Testing Plan

- **Unit**: 12 new tests in `tests/cli.test.ts` per Step 4. Full suite runs via `npm test` — must remain at 258 baseline + 12 new = 270 passes (or +13 etc. depending on whether tests stub a runner that triggers the warn fallback differently — implementer adjusts).
- **Lint**: `npm run lint` — no new patterns expected; the new `Check` returns use existing shapes.
- **Type-check**: `npm run type-check` — `ParsedVersion` and `VersionRunner` types must satisfy `tsc`.
- **Build**: `npm run build` — `dist/` regenerated. The `Verify committed dist/ matches a fresh build` CI step enforces freshness.
- **Manual smoke** (Human Test Plan, also achievable by implementer): `node dist/cli/index.js doctor` on canon-ai-dev with installed Claude shows the new line; the `SHIM_DIR` recipe in the spec's Human Test Plan exercises the fail path.
- **E2E**: N/A — no UI surface.
