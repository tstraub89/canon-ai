# Spec: support-node-26 — Support Node 26 alongside Node 24

> Written by: Claude | Review by: spec reviewer
> Status: draft

## Problem

Node 26 became the Active LTS line in October 2026. canon-ai declares only Node 24:

- `package.json` `engines.node` is `"24.x"`, mirrored in the `package-lock.json` root entry. Installing canon on Node 26 prints an `EBADENGINE` warning, and fails outright under npm `engine-strict`.
- `canon doctor`'s `checkNodeVersion()` (`src/cli/commands/doctor.ts`) passes any major `>= 24`, so it already approves Node 26, 25, 27 and so on while `engines` rejects them. Doctor and `engines` disagree today.
- CI (`.github/workflows/ci.yml`) runs every job on Node 24.x only, so nothing guards Node 26 against regressions.
- README, CONTRIBUTING, AGENTS.md and `docs/architecture.md` state "Node 24.x" as the only supported version.

Evidence that the code already works on Node 26: on 2026-11-08 the full `npm test` suite passed on Node 26.13.0 (2090/2090, nothing skipped), and `npm run type-check` and `canon doctor` passed. The only Node 26 difference was a `DEP0205` deprecation warning, once per test file: `` `module.register()` is deprecated. Use `module.registerHooks()` instead. `` A `--trace-deprecation` run traced every occurrence to `tests/md-loader-register.mjs:3`. tsx 4.23.15 (latest) already uses `registerHooks` on Node ≥24.11.1 and emits nothing. `module.registerHooks` exists without an ExperimentalWarning on every installed Node 24 version (24.14.0 through 24.21.0) and on 26.13.0. A throwaway synchronous version of the loader passed `tests/run-task-prompts.test.ts` and `tests/validation-matrix-sync.test.ts` on both 24.14.0 and 26.13.0, with zero DEP0205.

## Decision

Declare Node 24 and Node 26 (the two current LTS lines) as the supported runtimes, and make every surface agree:

1. **Engines:** `engines.node` becomes `24.x || 26.x`, in both `package.json` and the lockfile root entry.
2. **CI:** the test shards run on both Node 24.x and Node 26.x. That makes six test jobs, each named with its Node version. The single-version jobs (`checks` in `ci.yml`, `auto-release.yml`, `docs-refs-check.yml`) stay on Node 24.x, the oldest supported version.
3. **Doctor:** `canon doctor`'s Node check reports:
   - **pass** on a supported major (24 or 26);
   - **warn** on any other major ≥ 24: the non-LTS odd majors (25, 27, …) and even majors newer than the tested set (28+). Doctor still exits 0.
   - **fail** below 24 or on an unparseable version string, as today.

   Doctor's supported set and the `engines` majors come from one source of truth, which a test guards.
4. **Test loader:** the test-only `.md` loader moves from `module.register()` to `module.registerHooks()`, which removes the Node 26 deprecation warning.
5. **Docs:** prose that states the supported Node version, CI job names or the required-check list is updated to match.

The build floor stays at Node 24: tsup `target: 'node24'` and `@types/node ^24`. Types that match the oldest supported runtime keep 26-only APIs out of the code.

## Judgment Calls

| Call | Chosen | Strongest alternative | Why | Decided by |
|---|---|---|---|---|
| Node 26 test shards as required checks | Rename all six shard jobs to carry the Node version. All six become required once the human updates the `main` ruleset. | Keep the Node 24 shards' exact names (`test (shard N/3)`) and add Node 26 shards as non-required jobs. No out-of-repo step, and no PR can strand on "Expected" checks. | If `engines` claims 26, a Node 26 regression must not be able to merge. The ruleset edit is a one-time step, done before this PR merges (see Known Risks), so `--ship` merges it without any bypass. | `Human` |
| Doctor's verdict on unsupported majors ≥ 24 | Pass on 24 and 26. Warn on any other major ≥ 24 (non-LTS odd majors and untested newer evens). Fail below 24. | Fail on Node 25, since it is EOL and excluded from `engines`. | Fail means "known not to work" (below the build floor). Warn means "untested". One rule with no per-version special cases. | `Human` |
| Runtime for single-version CI jobs | Keep `checks`, `auto-release` and `docs-refs-check` on Node 24.x. | Move them to 26.x to track the current Active LTS. | Running lint, type-check, the `dist/` freshness diff and the completion tests on the oldest supported version catches accidental 26-only usage. Both versions bundle npm 12.2.2, so 26 adds no strictness. Local timing was too noisy (load average ~28) to show a speed gain. | `Human` |
| `engines` range form | `24.x \|\| 26.x` | `>=24`, matching doctor's old rule. | List exactly what CI tests. `>=24` claims support for Node 28+ before anything has run on it. | `Author` |
| Build floor | Keep tsup `target: 'node24'` and `@types/node ^24`. | Bump `@types/node` to ^26 to "match the newest runtime". | Types for the newest runtime would let 26-only APIs type-check and then break on 24. | `Author` |
| Doctor fail floor | Hard-code the fail threshold at 24, tied to the build floor (tsup `node24`), separate from the supported-majors constant. | Derive the floor as the minimum of the constant, so one edit moves everything. | Fail means "below what the bundle targets". Dropping 24 from `engines` later should be a deliberate floor change (tsup target, `@types/node`, doctor) made together, not a side effect. | `Author` |
| Doctor/engines drift guard | Doctor's supported majors come from one exported source of truth, and a test asserts it equals the majors parsed from `package.json` `engines`. | No guard; rely on review. | Drift between doctor and `engines` is the inconsistency this task found. A cheap unit test prevents it recurring. | `Author` |

## Non-Goals

- Supporting Node 22 or older. Doctor keeps failing them, and `engines` excludes them.
- Raising tsup `target` or `@types/node` above 24 (AC-9 backs this).
- Moving `checks`, `auto-release.yml` or `docs-refs-check.yml` to Node 26 (AC-3 backs this).
- Giving `tests/completion.test.ts` Node 26 coverage. It stays in the Node 24 `checks` job only.
- The version bump and CHANGELOG entry. Per `docs/decisions.md` §"Versioning and release policy", the release step proposes the bump tier, and QA contributes entry text only.
- Editing the GitHub `main` ruleset. That is a manual human step (see Known Risks and Human Test Plan); no file in the repo controls it.
- Changing `canon init`, which does not run the Node check.

## Acceptance Criteria

- [ ] **AC-1: Engines.** `package.json` `engines.node` is exactly `24.x || 26.x`, and so is the `package-lock.json` root (`""`) package entry. Verify:
  - read both files;
  - `npm install --package-lock-only` leaves `package-lock.json` byte-identical (`git diff --exit-code package-lock.json`). This is the same gate the CI `checks` job and `auto-release.yml` run.
- [ ] **AC-2: CI test matrix.** In `.github/workflows/ci.yml`:
  - the test job's matrix crosses Node `24.x` and `26.x` with shards `1, 2, 3` (six jobs);
  - `actions/setup-node` takes its `node-version` from the matrix;
  - the job name renders as `test (node 24.x, shard 1/3)` … `test (node 26.x, shard 3/3)`. These exact strings are the new required-check names the human will enter in the ruleset.

  Shard count, `fail-fast: false`, the test command and the excluded `completion.test.ts` are otherwise unchanged. Verify by reading the workflow. Whether the PR's own CI run shows all six jobs reporting is checked after `--pr`, in Human Test Plan step 4, not during implement.
- [ ] **AC-3: Single-version jobs stay on 24.** `ci.yml`'s `checks` job still uses `node-version: '24.x'`. `.github/workflows/auto-release.yml` and `.github/workflows/docs-refs-check.yml` are not modified. Verify: `git diff --stat <base>... -- .github/workflows/auto-release.yml .github/workflows/docs-refs-check.yml` is empty, and `checks` still reads `24.x`.
- [ ] **AC-4: Doctor verdict table.** The Node check takes the version string as an optional parameter that defaults to `process.version`. This is the same testability pattern as `checkClaudeVersion`'s injectable runner in the same file, but it takes the string directly, not a function. A unit test in `tests/cli.test.ts` asserts this literal table:

  | Input | Status |
  |---|---|
  | `v23.11.0` | `fail` |
  | `v24.0.0` | `pass` |
  | `v25.1.0` | `warn` |
  | `v26.13.0` | `pass` |
  | `v27.0.0` | `warn` |
  | `v28.0.0` | `warn` |
  | `garbage` | `fail` |

  Every row's label starts with `node ` followed by the input. Fail rows keep the existing detail (`node 24+ required — https://nodejs.org`). Warn rows carry a detail naming the supported majors 24 and 26. The existing host-dependent test (`'checkNodeVersion: current process is ≥24 → pass'`) is replaced by this table, so no Node check test depends on the host Node's version. Verify with a scoped run of `tests/cli.test.ts`.
- [ ] **AC-5: Doctor/engines drift guard.**
  - Doctor's supported-major set is one exported constant in `src/cli/commands/doctor.ts`, and both the pass decision and the warn detail read from it.
  - A unit test parses the majors out of `package.json` `engines.node` and asserts they equal that constant, so changing one without the other fails the suite.
  - Verify: temporarily editing the constant makes the test fail. Report the observation in the handoff; don't commit the edit.
  - The fail floor (below 24, with detail `node 24+ required`) is deliberately not derived from this constant. It tracks the build floor (tsup `target: 'node24'`), not `engines`; see Judgment Calls.
- [ ] **AC-6: Doctor shows ✓ on supported runtimes.** On Node 24 and Node 26, `canon doctor` (the committed `dist/cli/index.js`) shows the Node check as ✓. Verify:
  - the existing `runDistCli` doctor exit-code tests (`tests/cli.test.ts`) pass;
  - `node dist/cli/index.js doctor` shows `✓ node v24…` on Node 24;
  - it shows `✓ node v26…` on Node 26 when a binary is available. Otherwise record that as unverified in the handoff.

  A warn verdict exits 0 with the "canon should work; review above" summary through `doctorCmd`'s existing generic warn/fail tally. This task doesn't change that tally and needs no new test for it.
- [ ] **AC-7: `dist/` is fresh.** `npm run build` followed by `git diff --exit-code -- dist/` is clean after the change is committed. `dist/cli/index.js` is the only bundle that contains `checkNodeVersion`.
- [ ] **AC-8: Loader moved to `registerHooks`.** Replace the `module.register()` call in `tests/md-loader-register.mjs` with `module.registerHooks()`. Keep both files: `tests/md-loader-hooks.mjs` keeps exporting `load`, now synchronous, and the register file imports it and passes it to `registerHooks`. After the change, `module.register()` must not exist in the loader:
  - `grep -nw 'register' tests/md-loader-register.mjs tests/md-loader-hooks.mjs` returns zero lines. `-w` does not match `registerHooks`.
  - `grep -n 'registerHooks' tests/md-loader-register.mjs` returns at least one line.
  - The file name `tests/md-loader-register.mjs` and its `process.env.CANON_NO_DETACH = '1'` side effect are unchanged.
  - `.md` imports still resolve to the file's text as a default export.

  Verify:
  - the full suite passes on Node 24;
  - the full suite on Node 26 (e.g. `~/.nvm/versions/node/v26.*/bin/node` when present) prints zero `DEP0205` lines (`… 2>&1 | grep -c DEP0205` → `0`).

  If no Node 26 binary is available to the implementer, record that in the handoff as unverified. The Node 26 CI shards (AC-2) are the backstop, and a skipped check must not be reported as passing.
- [ ] **AC-9: Build floor unchanged.** `tsup.config.ts` still has `target: 'node24'`, and `package.json` `devDependencies['@types/node']` keeps a `^24` range. Verify by reading both files.
- [ ] **AC-10: Docs agree.** Update every prose statement of the supported Node version, the CI test job names, or the required-check list so it matches AC-1 and AC-2. That covers:
  - `README.md` (three sites);
  - `CONTRIBUTING.md` (prerequisites);
  - `AGENTS.md` (the Commands line);
  - `docs/architecture.md` (Runtime, CI summary, cross-platform row, the "Jobs" paragraph and job description, and the "Merge gate" required-check list, which must name `checks` plus the six new shard names);
  - `docs/release-process.md` (the "all three `test` shards" required-check wording);
  - the `ci.yml` comments that describe required checks;
  - the `@types/node` comment in `.github/dependabot.yml`, which must say the types track the `engines` floor (oldest supported major), not "the CI matrix".

  Verify:
  - **Supported-runtime statements name both majors.** `grep -n '24\.x' README.md CONTRIBUTING.md | grep -v '26'` returns nothing; these files have no single-version job prose. Reading confirms the same for the AGENTS.md Commands line and the `docs/architecture.md` Runtime and Cross-platform rows.
  - **Single-version job prose stays accurate.** The architecture "Jobs" paragraph and the `checks` description may and should say `checks` runs on Node 24.x only. The supported-runtime grep deliberately does not scan `docs/architecture.md`.
  - **Old test-job names are gone from the docs.** `grep -rnE 'test \(shard [0-9N]/3\)|three .test. shards' docs/ README.md CONTRIBUTING.md AGENTS.md` returns nothing.
  - **Sites these greps cannot see are verified by reading:** the `ci.yml` job name (AC-2), the `ci.yml` required-check comments, and the `dependabot.yml` comment.

  Permitted to remain: the historical bullet in `CHANGELOG.md` (not scanned), and the `auto-release.yml` Trusted Publishing comment about Node 24's npm, which stays accurate because that job stays on 24.

## Design

### Affected Files

| File | Change |
|---|---|
| `package.json` | `engines.node` → `24.x \|\| 26.x` |
| `package-lock.json` | Root package `engines` regenerated via `npm install --package-lock-only` (never hand-edited, never `sed`) |
| `.github/workflows/ci.yml` | Test job: Node × shard matrix, version-qualified job name, setup-node from matrix; update required-check comments. `checks` job stays on 24.x |
| `.github/dependabot.yml` | Reword the `@types/node` comment: types track the `engines` floor |
| `src/cli/commands/doctor.ts` | `checkNodeVersion` takes an injectable version; exported supported-majors constant; pass/warn/fail per AC-4 |
| `dist/cli/index.js` | Rebuilt bundle for the doctor change |
| `tests/cli.test.ts` | Replace the host-dependent Node check test with the AC-4 table; add the AC-5 drift test |
| `tests/md-loader-register.mjs` | `register()` → `registerHooks({ load })`, importing `load` from the hooks file; keep `CANON_NO_DETACH` |
| `tests/md-loader-hooks.mjs` | Keep the file; make the exported `load` synchronous (`readFileSync`, synchronous `nextLoad`) |
| `README.md` | Node version prose (three sites) → 24.x or 26.x |
| `CONTRIBUTING.md` | Prerequisites → Node 24.x or 26.x |
| `AGENTS.md` | Commands line → Node 24 or 26 (`engines`) |
| `docs/architecture.md` | Runtime, CI summary, cross-platform row, Jobs paragraph, test job description, Merge gate check list |
| `docs/release-process.md` | Required-check wording: six test shards across Node 24.x and 26.x |

### Implementation Notes (non-binding; plan/implement own these)

- **Hook order:** in-thread hooks run last-registered first, so tsx's `load` (registered by the later `--import tsx`) sees `.md` URLs first and passes them through `nextLoad` to ours. The throwaway prototype confirmed this works.
- **Engines parsing for AC-5:** a simple split on `||` with a major-number match is enough. No semver dependency.
- **Docs-refs gate:** `docs/architecture.md` is in `.canon/config.json` `docs_freshness.protected`, and it is listed above because the implementer must edit it.

### Interaction Dependencies

- **GitHub `main` ruleset (out of repo).** It currently requires `checks`, `test (shard 1/3)`, `test (shard 2/3)` and `test (shard 3/3)`. After this lands, those three shard names never report again. The human must replace them with the six new names (see Known Risks).
- **Spawned-subprocess tests.** About 15 tests pass `--import ./tests/md-loader-register.mjs` to child processes (for example `tests/agent-backend.test.ts` and `tests/run-task-ship-helpers.ts`). They pick up the new loader automatically because the file name is unchanged.
- **The CI git-install smoke test** runs `canon doctor` on Node 24 and must still exit 0 (pass).

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added". Also run it on Node 26 for AC-8 when a binary is available.
- [x] `npm run build` — commit the rebuilt `dist/cli/index.js`; `git diff --exit-code -- dist/` must be clean
- [x] `npm run docs-refs-check` — README, AGENTS.md, CONTRIBUTING and `docs/` change
- [ ] `<E2E>` — N/A (no UI surface)

## Docs Impact

`docs/architecture.md` (protected) changes and is in Affected Files. `docs/codebase-map.md` already describes `ci.yml` generically as having a "matrix", so it should stay accurate; QA should confirm. No other protected doc mentions the Node version.

## Known Risks

- **Stranded required checks.** The `main` ruleset requires `test (shard N/3)`, which this PR and every later one never report. `canon run --ship` merges with plain `gh pr merge` (no `--admin`, `src/orchestrator/main.ts`), so it would likely be refused on this very PR. Non-admin PRs would sit at "Expected — waiting" forever. Mitigation:
  - **before merge**, after the PR's CI is green with the six new job names reporting, the human swaps the three old names for the six new ones in the ruleset;
  - `--ship` then merges normally, with no bypass;
  - other open PRs must rebase onto the new `main` to report the new names;
  - QA's `done.md` must surface the swap as a pending human step that comes before `--ship`.
- **Lockfile gate.** Editing `package.json` without regenerating the lockfile turns CI `checks` and `auto-release` red. AC-1 verifies this with the same command CI uses.
- **Stale `dist/`.** The doctor change must be rebuilt and committed, or the CI freshness gate fails. The doctor exit-code tests run the committed bundle, so with a stale `dist/` they would silently test old logic. AC-7 covers this.
- **Loader regression.** A broken synchronous hook breaks every test that imports a `.md` prompt template, plus every spawned subprocess that uses the loader. Failure would be loud (prompt tests fail), not silent. If `registerHooks` emitted an ExperimentalWarning on the runner's Node 24 minor, tests that assert on a subprocess's empty stderr could break. No such warning appeared on any 24.x minor from 24.14.0 to 24.21.0, and CI installs the latest 24.x.
- **Platform gap.** The local Node 26 pass was on macOS; CI runs Linux. A Linux-only Node 26 difference would surface first in the new shards. That is the point of adding them, but it could add a fix-up round.
- **Host-dependent test.** The old Node check test asserted `pass` on whatever Node ran the suite. Under the new rule it would fail on a Node 27 dev machine. AC-4 replaces it with injected versions.

## Human Test Plan

1. On Node 24, run the canon health check. Expected: the Node line shows a checkmark, and the check finishes with no failures.
2. Switch to Node 26, install canon from the PR build, and run the health check. Expected: no "unsupported engine" warning during install, and the Node line shows a checkmark.
3. If Node 25 is handy, run the health check on it. Expected: the Node line shows a warning that names 24 and 26 as supported, and the summary still says canon should work.
4. On the PR, look at the CI checks. Expected: six test jobs, three labelled Node 24.x and three labelled Node 26.x, plus the main checks job, all green.
5. Before merging, once step 4 is green, open GitHub's branch rules for `main`. Replace the three old required test checks with the six new Node-labelled ones, and keep the main checks job required. Expected: the PR now shows all seven required checks passing and merges normally with no override, and later PRs show none stuck waiting.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files uses exactly one `### Affected Files` heading under `## Design`, one file per row, specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] If this spec replaces existing behavior: framed as replacement (AC-4 replaces the host-dependent test; AC-8 replaces `register` with `registerHooks`, with a grep AC)
- [x] Non-Goals rules out the most tempting scope expansions; load-bearing exclusions backed by AC-3 and AC-9
- [x] Symbols named in ACs actually exist in the codebase (`checkNodeVersion`, `checkClaudeVersion`, `runDistCli`, `tests/md-loader-register.mjs`, `tests/md-loader-hooks.mjs`)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) N/A — feature
- [x] (Refactors) N/A — feature
- [x] *Judgment Calls* lists every judgment call with strongest alternative and Decided by
