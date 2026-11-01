# Implementation Handoff: provider-pin-agent-free-paths

> Author: implementer | Spec: `tasks/provider-pin-agent-free-paths/spec.md` | Plan: `tasks/provider-pin-agent-free-paths/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Startup block maps every task through the `status.json` read and validation, then resolves the bundle provider only when `!cliArgs.ship \|\| cliArgs.dryRun`. |
| `src/cli/commands/doctor.ts` | Invalid `CANON_PROVIDER` now requires only the agent backends every provider needs (derived from `PROVIDERS`), so Codex checks drop and Claude checks stay. |
| `tests/run-task-ship.test.ts` | `makeStatus` and `prepareShipFixture` gain a provider pin; AC-1, AC-2, AC-6 tests. |
| `tests/run-task-safety.test.ts` | AC-4 and AC-5 dry-run invalid-pin tests. |
| `tests/cli.test.ts` | AC-7 doctor invalid-setting test. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | AC-9 and AC-10 wording; synced mirror. |
| `docs/architecture.md` | AC-11 `--ship` clause on the `provider` bullet. |
| `docs/decisions.md` | AC-11 `--ship` clause in the provider-pins decision. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt output. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

`--ship` spawns no agent, so a bad pin should not block merge/archive. The gate is `cliArgs.ship && !cliArgs.dryRun`: `--ship --dry-run` takes the dry-run branch, and `buildPipelineState` re-resolves the provider outside the startup try block, so skipping there would produce a stack instead of the clean refusal. The `status.json` read and validation still run for every mode. I grepped `shipTasks()` and found no `providerForTasks`, `assignmentForTasks`, `roleName` or `buildPipelineState` call, so `runProvider` staying null on ship is safe today. Doctor derives the intersection of required backends over `PROVIDERS` rather than hard-coding `claude`.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| AC-6 fixture uses `branch: 'bad branch'` | `validateStatus` only checks `branch`, `base_branch` and numeric counters; a bad `task_size` is not rejected. | None |
| Plan's temporary "widen gate to `cliArgs.ship`, confirm AC-5 red" check not run | Not required by the spec; AC-4/5 pass on the final gate. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `--ship does not resolve an invalid provider pin` |
| AC-2 | Met | `--ship does not refuse a bundle whose provider pins differ` |
| AC-3 | Met | Existing test unchanged and passing in the full suite. |
| AC-4 | Met | `--dry-run refuses an invalid provider pin cleanly without archiving` |
| AC-5 | Met | `--ship --dry-run refuses ...`; task dir kept, not archived. |
| AC-6 | Met | `--ship still refuses a malformed status.json cleanly` |
| AC-7 | Met | `doctor with an invalid provider setting skips Codex checks but keeps Claude` |
| AC-8 | Met | Existing test unchanged and passing. |
| AC-9 | Met | `docs/pipeline-orchestrator.md` provider paragraph. |
| AC-10 | Met | Same paragraph. |
| AC-11 | Met | `docs/architecture.md` and `docs/decisions.md`. |
| AC-12 | Met | `npm run sync-templates:check` passes. |

## Edge Cases Considered

- Empty `taskIds`: the map yields `[]`; skipping resolution is harmless.
- Mixed bundle on `--ship`: ships; on `--dry-run` it still refuses.
- Doctor with unset or valid setting: unchanged path.

## Blockers

- (none)

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-1 | `node --import tsx --test --test-name-pattern="provider pin" tests/run-task-ship.test.ts` | 4ddd790 | exit 1: `Invalid provider 'bogus'. Accepted values: mixed, claude.` | Pass |
| AC-2 | `node --import tsx --test --test-name-pattern="pins differ" tests/run-task-ship.test.ts` | 4ddd790 | exit 1: `Cannot run a mixed-provider bundle: ship-pins-a: claude, ship-pins-b: mixed.` | Pass |
| AC-7 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern="invalid provider setting skips" tests/cli.test.ts` | 4ddd790 (pre-fix dist) | `✓ codex` and `! codex project trust` lines present | Pass after rebuild |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | |
| `type-check` (`npm run type-check`) | Pass | |
| `build` (`npm run build`) | Pass | dist rebuilt |
| `test` (`npm test`) | Pass | 1868 tests; one timing flake (`shutdown waits for resistant descendant after leader exit before cleanup`) failed once in the full run and passed on rerun (37/37 in that pattern run). |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | |
| `docs-refs-check` (`npm run docs-refs-check`) | Pass | |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
