# Implementation Handoff: support-node-26

> Author: Codex | Spec: `tasks/support-node-26/spec.md` | Plan: `tasks/support-node-26/plan.md`

## Changes

| File | What Changed |
|---|---|
| `package.json` | Declared Node `24.x || 26.x` in `engines.node`. |
| `package-lock.json` | Regenerated the root package `engines.node` value. |
| `.github/workflows/ci.yml` | Added a Node 24.x/26.x × three-shard matrix, version-qualified test job names, and updated the required-check comment. The `checks` job remains on 24.x. |
| `.github/dependabot.yml` | Clarified that `@types/node` tracks the `engines` floor. |
| `src/cli/commands/doctor.ts` | Added exported supported Node majors and injectable version checking with pass/warn/fail outcomes. |
| `dist/cli/index.js` | Rebuilt the CLI bundle for the doctor change. |
| `tests/cli.test.ts` | Replaced the host-dependent Node test with the specified verdict table and an engines drift guard. |
| `tests/md-loader-register.mjs` | Registered the synchronous loader with `registerHooks`; retained `CANON_NO_DETACH`. |
| `tests/md-loader-hooks.mjs` | Made `.md` loading synchronous with `readFileSync`. |
| `README.md` | Updated the three supported Node version statements. |
| `CONTRIBUTING.md` | Updated the Node prerequisite. |
| `AGENTS.md` | Updated the Node version in the Commands overview. |
| `docs/architecture.md` | Updated runtime, CI matrix, cross-platform, job, and merge-gate descriptions. |
| `docs/release-process.md` | Updated the required test jobs description to six jobs across Node 24.x and 26.x. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `tasks/support-node-26/status.json` → `canon.upstream_repo` |
| Upstream commit | `tasks/support-node-26/status.json` → `canon.upstream_commit` |
| Orchestrator commit | `tasks/support-node-26/status.json` → `canon.orchestrator_commit` |
| Codex CLI | `tasks/support-node-26/status.json` → `canon.codex_cli` |
| Claude Code | `tasks/support-node-26/status.json` → `canon.claude_code` |

## Intent & Rationale

The manifest, doctor, CI test matrix, and documentation now agree on Node 24 and 26. Doctor keeps the Node 24 build floor, passes on tested majors, warns on untested majors at or above that floor, and fails below it. The test-only `.md` loader now uses synchronous in-thread hooks to avoid the Node 26 `module.register()` deprecation.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Removed the prior administrator-bypass/direct-push explanation from the `docs/architecture.md` merge-gate paragraph while documenting the new ruleset names. | The spec's known-risk mitigation and the plan require the ruleset swap before a normal merge and prohibit describing an admin bypass for this PR. | No AC impact; the required checks and human action are stated explicitly. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: Engines | Met | Both manifests specify `24.x || 26.x`; lockfile regeneration changed only its root engines line and a second run left its SHA-256 unchanged. |
| AC-2: CI test matrix | Met | The workflow matrix is Node 24.x/26.x × shards 1–3; `checks` remains on 24.x. The six rendered job names match the names documented in `docs/architecture.md`. Reporting is checked after PR creation per the spec. |
| AC-3: Single-version jobs stay on 24 | Met | The `checks` job remains on 24.x; neither `.github/workflows/auto-release.yml` nor `.github/workflows/docs-refs-check.yml` is modified. |
| AC-4: Doctor verdict table | Met | All seven inputs have assertions for status and label; fail and warn details are checked. The scoped CLI tests passed. |
| AC-5: Doctor/engines drift guard | Met | The test parses `engines.node` and compares sorted majors with `SUPPORTED_NODE_MAJORS`. Temporarily changing the constant to `[24]` made the test fail with expected `[24, 26]` versus actual `[24]`; the constant was restored. |
| AC-6: Doctor on supported runtimes | Met | The rebuilt `dist/cli/index.js doctor` output showed ✓ for Node 24.21.0 and Node 26.13.0; both commands exited 0. |
| AC-7: Fresh `dist/` | Met | Two builds succeeded; the second build left `dist/cli/index.js` byte-identical to the first (SHA-256 `1e74e3ac0f68b303df74cfca4457ffd58c77320024340aa743478a6a942e6881`). The orchestrator will commit the bundle; CI checks committed freshness. |
| AC-8: Loader uses `registerHooks` | Met | No bare `register` identifier remains in either loader file; `.md` imports passed the full suites on Node 24 and 26, and Node 26 logged zero `DEP0205` lines. |
| AC-9: Build floor unchanged | Met | `tsup.config.ts` still targets `node24`; `package.json` retains `@types/node` `^24.13.3`. |
| AC-10: Docs agree | Met | Supported-version prose, six CI job names, ruleset action, and Dependabot comment were updated. Required greps and `npm run docs-refs-check` passed. |

## Edge Cases Considered

- Node 23 and an unparseable version fail; Node 24 and 26 pass; Node 25, 27, and 28 warn and name both supported majors.
- `checkNodeVersion()` still defaults to `process.version`, so the production doctor call needs no change.
- The loader returns `.md` file contents as the default export and delegates non-`.md` URLs to `nextLoad`.
- Node 24 and Node 26 full-suite runs each had one sandbox skip: `REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree` skips because `.git/` writes are restricted. Both runs had zero failures.

## Blockers

- `[human_pending]` Before merge, after CI reports the six Node-labelled test jobs green, a human must replace the three old shard checks in the GitHub `main` ruleset with `test (node 24.x, shard 1/3)` through `test (node 26.x, shard 3/3)`, keeping `checks` required. The ruleset is outside the repository; the change must happen before `--ship`. Other open PRs need to rebase to report the new check names.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| None — this feature spec has no red-first AC. | | | | |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | `tests/cli.test.ts` now asserts the exact seven-version verdict table, labels, and detail strings. The drift test reads the active checkout's `package.json` via `process.cwd()`; mutating `SUPPORTED_NODE_MAJORS` to `[24]` caused the filtered drift test to fail for the expected missing 26. Both tests passed after restoring `[24, 26]`, under Node 24 and Node 26. The full suites also exercised `.md` imports through the loader. |
| Restatement sweep | Searched for `Node 24`, `24.x`, old `test (shard N/3)` names, and three-shard wording across the docs, README, CONTRIBUTING, AGENTS, CI, and Dependabot surfaces. All canon runtime and job-name hits are updated. Retained the `tsup.config.ts` `node24` target and `@types/node` `^24` range per AC-9; transitive engine declarations in `package-lock.json` are dependency metadata, not canon's engine range. `CHANGELOG.md` is historical and was not changed. |
| Sibling parity | `checkNodeVersion()` has one production caller, which uses the default `process.version`; the tests inject each version. In CI, only the test job uses the new matrix, while `checks` stays on 24.x. The two out-of-scope single-version workflows were verified unchanged. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Passed after the final test edit. |
| `npm run type-check` | Pass | Passed after the final test edit. |
| `npm test` — Node 24.21.0 | Pass | 2,147 passed, 1 sandbox skip, 0 failed. |
| `npm test` — Node 26.13.0 | Pass | 2,147 passed, 1 sandbox skip, 0 failed; `DEP0205` count was 0. |
| Scoped Node-check tests — Node 24 and 26 | Pass | The verdict table and drift guard passed on both runtimes after the final test edit. |
| `node dist/cli/index.js doctor` — Node 24.21.0 and 26.13.0 | Pass | Both showed ✓ for the Node line and exited 0. |
| `npm run build` | Pass | Built twice; second build kept `dist/cli/index.js` byte-identical. |
| Lockfile regeneration | Pass | `npm install --package-lock-only` regenerated the root engines field; a second run left `package-lock.json` byte-identical. |
| `npm run docs-refs-check` | Pass | `All refs OK`. |
| E2E | deferred_by_spec | `tasks/support-node-26/spec.md` states N/A because there is no UI surface. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
