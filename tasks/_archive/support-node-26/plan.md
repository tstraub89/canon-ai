# Implementation Plan: support-node-26

> Written by: Claude | Implements: `tasks/support-node-26/spec.md`

## Approach

Declare Node `24.x || 26.x` everywhere: engines, CI test matrix, doctor, the test `.md` loader, and docs. Single-version jobs and the build floor (tsup `node24`, `@types/node ^24`) stay on 24.

**Feasibility check** (found by reading the code, not recalled):

- **Exists:** `checkNodeVersion()` at `src/cli/commands/doctor.ts:237`; `Check` type with `label`/`status`/`detail`; `checkClaudeVersion(runner)` as the injectable-param precedent (line 261); `ci.yml` test job at lines ~140-170 (`name: test (shard ${{ matrix.shard }}/3)`, setup-node `'24.x'` at line ~151); `tests/md-loader-register.mjs` (uses `register`) and `tests/md-loader-hooks.mjs` (async `load` with `readFile`); `package-lock.json` root entry `engines` at line 25-27; `.github/dependabot.yml` `@types/node` comment lines 35-38.
- **Real path:** `canonDoctor` builds `envChecks` and calls `checkNodeVersion()` at `doctor.ts:847`. The warn status flows through the existing generic warn/fail tally (exit 0 on warn); no change there. Loader: `--import ./tests/md-loader-register.mjs` is passed to the test runner and ~15 spawned subprocesses; the file name is unchanged, so all pick it up.
- **Callers:** `checkNodeVersion` has exactly two: `doctor.ts:847` (no args, so the new default `process.version` keeps behavior) and `tests/cli.test.ts:1176` (replaced). The old `load` export is imported only by `md-loader-register.mjs` (grep of `md-loader-hooks`).
- **Tests that can fail:** the AC-4 table feeds injected strings (`v25.1.0` → `warn` fails against the old `>= 24 → pass` code; `v26.13.0`/`v27.0.0` likewise). The AC-5 drift test fails if the constant and `engines` disagree. Loader correctness is covered by the many existing `.md`-importing prompt tests; AC-8 greps cover the `register` removal.
- **Predicates:** `parseInt` of the major: `garbage` → no match → `0` → below floor → `fail`. `v24.0.0` (boundary) → pass. `v23.11.0` → fail. `v25` and `v27`/`v28` → warn. The floor is the literal `24`, deliberately separate from `SUPPORTED_NODE_MAJORS`. Engines parse for AC-5: split `engines.node` on `||`, take `/(\d+)/` from each part, map to numbers, compare as a sorted array.
- **Scope:** every file below is in the spec's Affected Files. `docs/codebase-map.md` is not edited (spec says it stays accurate). `auto-release.yml` and `docs-refs-check.yml` are not touched.
- **Async/stateful:** `registerHooks` hooks are synchronous and run in-thread, last-registered first; tsx's `load` (from the later `--import tsx`) sees `.md` URLs first and passes them to ours. Make `load` fully synchronous: a `readFileSync` and a plain `nextLoad(...)` return (no `await`, no `async`). N/A otherwise.

**Spec nit incorporated:** the first Judgment Calls row mentions an admin bypass, but Known Risks and the Human Test Plan say the human swaps the ruleset checks *before* merge, and `--ship` uses plain `gh pr merge`. No spec edit; the plan follows the Known Risks path. The implementer must not describe an admin bypass in any doc or handoff, and QA's `done.md` must list the ruleset swap as a pending human step before `--ship`. Recorded in `notes.md` with `[plan]`.

**Local observation:** `tasks/support-node-26/` already contains `handoff.md`, `done.md`, `review.md`, etc. from an earlier attempt, and `plan.md` was still the stub. Treat them as stale, don't read them as truth, and don't delete them.

## Steps

### Step 1: Engines and lockfile

Files: `package.json`, `package-lock.json`

Set `"engines": { "node": "24.x || 26.x" }` in `package.json`. Then run `npm install --package-lock-only` to regenerate the lockfile root entry. Never hand-edit or `sed` it. Confirm `git diff package-lock.json` shows only the root `engines.node` line changed, and a second `npm install --package-lock-only` leaves it byte-identical. Don't touch `@types/node` or `tsup.config.ts` (AC-9).

### Step 2: Doctor check and constant

Files: `src/cli/commands/doctor.ts`

```ts
/** Node majors canon is tested on; must equal the majors in package.json engines.node (guarded by a test). */
export const SUPPORTED_NODE_MAJORS: readonly number[] = [24, 26];
/** Build floor (tsup target node24). Deliberately not derived from SUPPORTED_NODE_MAJORS. */
const NODE_BUILD_FLOOR = 24;

export function checkNodeVersion(version: string = process.version): Check {
    const label = `node ${version}`;
    const match = version.match(/^v(\d+)/);
    const major = match ? parseInt(match[1], 10) : 0;
    if (major < NODE_BUILD_FLOOR) {
        return { label, status: 'fail', detail: 'node 24+ required — https://nodejs.org' };
    }
    if (SUPPORTED_NODE_MAJORS.includes(major)) return { label, status: 'pass' };
    return {
        label,
        status: 'warn',
        detail: `untested Node major; canon supports ${SUPPORTED_NODE_MAJORS.join(' and ')} — https://nodejs.org`,
    };
}
```

Keep the fail detail text exactly `node 24+ required — https://nodejs.org`. Warn detail must name 24 and 26 (it does via the constant). Leave the call at line ~847 unchanged.

### Step 3: Doctor tests

Files: `tests/cli.test.ts`

Add `SUPPORTED_NODE_MAJORS` to the existing `doctor.js` import (the block containing `checkNodeVersion`, line ~27-53). Replace the host-dependent `checkNodeVersion: current process is ≥24 → pass` test (line ~1175) with:

- A table-driven loop over the AC-4 rows (`v23.11.0` fail, `v24.0.0` pass, `v25.1.0` warn, `v26.13.0` pass, `v27.0.0` warn, `v28.0.0` warn, `garbage` fail). Assert `status`, assert `label === 'node ' + input`, assert fail rows' `detail` is `node 24+ required — https://nodejs.org`, and assert warn rows' detail matches `/24/` and `/26/`.
- A drift test: read `package.json` via `path.join(REPO_ROOT, 'package.json')`? **No**: per the worktree pitfall in `docs/patterns.md`, build the path from `process.cwd()` (`path.join(process.cwd(), 'package.json')`), since `REPO_ROOT` is the supervising checkout in a worktree and would read the stale file. Parse `engines.node`, split on `||`, extract the digits, sort, and `assert.deepEqual` against `[...SUPPORTED_NODE_MAJORS].sort((a, b) => a - b)`.

Per Slow Test Discipline, these are pure unit tests (no subprocess). After writing, temporarily change the constant to `[24]` and confirm the drift test and the table go red; revert it and report the observation in the handoff (don't commit the edit).

### Step 4: Loader to `registerHooks`

Files: `tests/md-loader-hooks.mjs`, `tests/md-loader-register.mjs`

`md-loader-hooks.mjs`: keep the file and the `load` export, make it synchronous:

```js
import { readFileSync } from 'node:fs';

export function load(url, context, nextLoad) {
    if (url.endsWith('.md')) {
        const content = readFileSync(new URL(url), 'utf8');
        return { format: 'module', shortCircuit: true, source: `export default ${JSON.stringify(content)};` };
    }
    return nextLoad(url, context);
}
```

`md-loader-register.mjs`: `import { registerHooks } from 'node:module'; import { load } from './md-loader-hooks.mjs'; registerHooks({ load });`. Keep the `CANON_NO_DETACH = '1'` block and its comment unchanged. Check: `grep -nw 'register' tests/md-loader-register.mjs tests/md-loader-hooks.mjs` must return nothing; the word "register" inside the existing comment would match with `-w`, so reword any comment lines if they contain the bare word (the current comment doesn't).

### Step 5: CI workflow

Files: `.github/workflows/ci.yml`

Test job: `name: test (node ${{ matrix.node }}, shard ${{ matrix.shard }}/3)`, matrix `node: ['24.x', '26.x']` and `shard: [1, 2, 3]`, keep `fail-fast: false`, and set setup-node `node-version: ${{ matrix.node }}`. This renders `test (node 24.x, shard 1/3)` … `test (node 26.x, shard 3/3)`. Leave the `checks` job (`node-version: '24.x'`), the shard test command and the `completion.test.ts` exclusion unchanged. Update the comment at lines ~24-26 ("requires `checks` and the `test` shards") to say it requires `checks` and the six `test` jobs (Node 24.x and 26.x × 3 shards), and the comment at line ~37 if it needs it. Do not edit `auto-release.yml` or `docs-refs-check.yml`.

### Step 6: Dependabot comment

Files: `.github/dependabot.yml`

Reword lines ~35-38: `@types/node` must track the `engines` floor (the oldest supported major), not "the CI matrix"; a types major ahead of the floor describes APIs that aren't there on the oldest runtime. Comment only; no config change.

### Step 7: Docs

Files: `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/architecture.md`, `docs/release-process.md`

- `README.md` lines ~35, ~116, ~491: "Node 24.x or 26.x". The doctor sentence near line ~192 can stay.
- `CONTRIBUTING.md` line ~20: "Node 24.x or 26.x".
- `AGENTS.md` line 9: "Node 24 or 26 (`engines`)". This is a root-only file (not a canon-managed mirror, so no `templates/` edit).
- `docs/architecture.md`: line ~23 Runtime → "Node.js 24.x or 26.x"; line ~32 CI summary (runs `checks` on Node 24.x and the test shards on Node 24.x and 26.x, six test jobs); line ~148 cross-platform row; Jobs paragraph at line ~158 (replace "Node 24.x only" with: `checks` runs on 24.x only, the oldest supported version, so accidental 26-only usage fails there); line ~161 test job description → `test (node N, shard M/3)` six-job matrix; line ~169 Merge gate → names `checks` plus the six new names `test (node 24.x, shard 1/3)` … `test (node 26.x, shard 3/3)`. Add that the swap in the ruleset is a one-time manual human step done before merge.
- `docs/release-process.md` line ~78: "all three `test` shards" → "all six `test` jobs (Node 24.x and 26.x, three shards each)".
- Is `docs/release-process.md` in `CANON_OWNED`? Check with `grep release-process src/lib/canon-owned.ts` before editing; per the spec it is root-only and has no mirror. If it is managed, run `npm run sync-templates` and declare the mirror in the handoff.

Don't write about an admin bypass for this PR. Don't touch `CHANGELOG.md`.

### Step 8: Rebuild and verify

Files: `dist/cli/index.js`

Run `npm run build` and commit-ready `dist/cli/index.js`. `git diff --exit-code -- dist/` after a second build must be clean. Then run the verification greps from AC-8 and AC-10:

- `grep -n '24\.x' README.md CONTRIBUTING.md | grep -v '26'` → nothing
- `grep -rnE 'test \(shard [0-9N]/3\)|three .test. shards' docs/ README.md CONTRIBUTING.md AGENTS.md` → nothing
- `grep -nw 'register' tests/md-loader-register.mjs tests/md-loader-hooks.mjs` → nothing; `grep -n registerHooks tests/md-loader-register.mjs` → ≥ 1 line
- `git diff --stat main... -- .github/workflows/auto-release.yml .github/workflows/docs-refs-check.yml` → empty

## Testing Plan

- **Unit:** the AC-4 table and AC-5 drift test in `tests/cli.test.ts` (scoped run: `node --import tsx --import ./tests/md-loader-register.mjs --test tests/cli.test.ts`, or match the invocation `package.json`'s `test` script uses).
- **Full suite:** `npm run lint && npm run type-check && npm test && npm run docs-refs-check && npm run build`; then `git diff --exit-code -- dist/ package-lock.json`.
- **Node 26 (AC-6, AC-8):** if a binary exists (`ls ~/.nvm/versions/node/v26.*/bin/node`), run the full suite with it and `2>&1 | grep -c DEP0205` → `0`; run `node dist/cli/index.js doctor` on 26 and 24 to see `✓ node v…`. If no 26 binary is available, record AC-6's 26 check and AC-8's Node 26 run as **unverified** in the handoff; do not report them as passing. The Node 26 CI shards are the backstop.
- **E2E:** N/A.

## Notes for implement/QA

- Pre-commit hook mirrors managed files to `templates/` automatically; none of the files above are expected to be managed (verify `AGENTS.md`, `docs/architecture.md`, `docs/release-process.md` against `src/lib/canon-owned.ts`). If a mirror appears in the diff, declare it in the handoff Changes table.
- Handoff Changes table must list `dist/cli/index.js` and `package-lock.json`.
- QA `done.md`: surface the GitHub `main` ruleset swap (three old shard names → six new names, keep `checks`) as a pending human step **before** `--ship`.
