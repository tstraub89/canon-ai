# Implementation Plan: discovery-nudge

> Written by: Claude | Implements: `tasks/discovery-nudge/spec.md`

## Approach

Recommend-only, mirroring the existing `RECOMMENDED_ALLOW` pattern in `src/cli/commands/doctor.ts` exactly: a single-source constant + a `canon doctor` advisory check + README documentation + a constant↔README drift test. Canon never writes the nudge into an adopter's `CLAUDE.md` (AC-6). The new doctor check is loose (case-insensitive `canon` presence) and **warn-only** — it never fails, and is a deliberate near-no-op until Task C strips the canon block.

## Steps

### Step 1: Add the `RECOMMENDED_NUDGE` constant

Files: `src/cli/commands/doctor.ts`

Add an exported `RECOMMENDED_NUDGE` constant adjacent to `RECOMMENDED_ALLOW` (~line 34), with the same "kept in lockstep with README — the test fails CI if they drift" comment style (see the `RECOMMENDED_ALLOW` comment block ~lines 25–33). Content: the ~3-line orientation text from spec AC-1 (this project uses canon; route new features/fixes/refactors through the canon skills, start with `/canon-spec`, rather than implementing directly). Keep it a plain exported string so both the doctor check and the drift test reference one source.

### Step 2: Add the loose, warn-only doctor check

Files: `src/cli/commands/doctor.ts`

Add `export function checkCanonDiscoveryNudge(cwd: string): Check` as a sibling to `checkAgentFile` (~line 187). Read `CLAUDE.md` and `AGENTS.md` (same `process.cwd()`/path resolution the other checks use). Return `{ status: 'pass' }` if **either** file matches `/canon/i`; otherwise `{ status: 'warn', detail: <derived from RECOMMENDED_NUDGE> }`. Never return `'fail'`; never exact-match the nudge text. Read-only (no writes). Register it in the `canonChecks` array (~line 639) immediately after the two `checkAgentFile(cwd, …)` calls.

### Step 3: Document the nudge in the README

Files: `README.md`

Add a short subsection in/near the adoption / `canon init` area (~lines 103–129) documenting the recommended discovery line, showing the exact `RECOMMENDED_NUDGE` text. Mirror how the "Skip the permission prompts" section documents `RECOMMENDED_ALLOW` (so the drift test can extract and compare it).

### Step 4: Tests

Files: `tests/cli.test.ts`

(a) **Doctor check test** — using `withTempDir` (~line 43): a fixture where neither `CLAUDE.md` nor `AGENTS.md` mentions canon → assert `checkCanonDiscoveryNudge` returns `warn`; a fixture where either does → assert `pass`; assert the files are not modified (read-only / AC-6). (b) **Drift test** — mirror the `RECOMMENDED_ALLOW`↔README test (~line 2259): extract the nudge text from the README subsection and assert it equals `RECOMMENDED_NUDGE`.

### Step 5: Build + validate

Files: `dist/cli/index.js`

Run `npm run build` (regenerates `dist/cli/index.js`; declare it in the handoff). Run `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`; confirm `git diff --exit-code -- dist/` is clean after build.

## Testing Plan

- **Unit**: `checkCanonDiscoveryNudge` warn/pass cases + read-only assertion; `RECOMMENDED_NUDGE`↔README drift test (both in `tests/cli.test.ts`).
- **E2E**: N/A (no UI surface).
- **Manual**: `canon doctor` in this repo → nudge check passes (canon is mentioned); in a throwaway no-canon dir → non-blocking warning showing the recommended line.

## Rollback Plan

Trivial and low-risk: revert the single commit. The feature is advisory-only — no state, no schema, no data migration; the worst case of a bug is a spurious/absent `doctor` warning. `canon init`/`upgrade` are untouched (AC-6), so no adopter files are affected.
