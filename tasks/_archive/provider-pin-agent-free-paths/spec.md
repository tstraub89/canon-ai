# Spec: provider-pin-agent-free-paths — Don't let an invalid provider pin block agent-free paths

> Written by: Claude | Review by: spec reviewer
> Status: draft

## Problem

Two places resolve a provider they do not need, and fail or mislead because of it.

**1. `canon run <id> --ship` refuses a task whose provider pin is invalid.** `main()` in `src/orchestrator/main.ts` (the `runProvider = splitPolicy.resolveBundleProvider(...)` block right after the worktree-root guards) resolves every task's `status.json.provider` for every run mode and calls `die()` on any error. `resolveTaskProvider` (`src/orchestrator/policy.ts`) throws `Task '<id>' status.json: Invalid provider '<v>'. Accepted values: mixed, claude.` for an unrecognised value, and `resolveBundleProvider` throws `Cannot run a mixed-provider bundle: ...` when bundle members disagree. `--ship` never spawns an agent: `shipTasks()` makes no call to `providerForTasks`, `assignmentForTasks`, `roleName`, `buildPipelineState`, or `state.provider`, and `checkDeps` already skips agent dependencies for ship (`skipAgentDeps = cliArgs.ship || cliArgs.dryRun`). So a task whose pin was hand-edited to a bad value, or a bundle whose pins disagree, cannot be merged and archived through canon even though nothing on that path uses the provider.

Mechanism class: deterministic. Confirmed by trace. Any `provider` value other than absent, `mixed` or `claude` reaches the `die()` at startup before the `if (cliArgs.ship) { shipTasks(...) }` branch, regardless of mode.

The same startup try block also reads and validates each task's `status.json` (`readStatusFromPath` plus `validateStatus`) and turns a malformed file into a clean `die()`. That part must keep running on `--ship`: the ship path's own reads (`readShipStatus` inside `shipTasks()`) are not wrapped, so skipping the whole block would turn today's clean refusal of a malformed `status.json` into an uncaught error with a stack.

**2. `canon doctor` with an invalid `CANON_PROVIDER` checks Codex as if the provider were `mixed`.** `doctorCmd` in `src/cli/commands/doctor.ts` initialises `provider = 'mixed'`, catches the parse error from `resolveProviderSetting()` into a failing provider check, and then computes `requiredAgentBackends(roleAssignmentFor(provider))` with the guessed `mixed`. It runs the Codex binary check and the Codex project-trust check against a provider the user did not select. Confirmed by execution on main: `CANON_PROVIDER=bogus canon doctor` prints `✗ Provider (CANON_PROVIDER setting) — Invalid provider 'bogus'...` followed by `✓ codex` and `✓ codex project trust — ... is trusted`. On a machine without Codex the same command would add a second, misleading Codex failure.

`--dry-run` is deliberately left out, including `--ship --dry-run`. A dry run previews the pipeline phases a real run would execute (it takes the dry-run branch before the ship branch, so `--ship --dry-run` is a pipeline preview, not a ship preview). It refuses an invalid pin at the same startup point with the same clean message, which matches what a real run would do; a preview that refuses where the run refuses is correct behavior, not a bug.

## Decision

- `canon run --ship` without `--dry-run` does not resolve or validate provider pins. A task with an invalid pin, or a bundle with disagreeing pins, ships (merges, archives, cleans up) exactly as a valid task would, with no new output about the pin.
- On that path the startup `status.json` read and validation still run, so a malformed `status.json` still refuses cleanly (exit 1, no stack) as it does today.
- Every other `canon run` mode, `--dry-run` and `--ship --dry-run` included, keeps the current startup refusal unchanged: same message, exit 1, no stack, before any task mutation or agent spawn.
- `canon doctor` with an invalid `CANON_PROVIDER` reports the failing provider check and runs only the checks every supported provider needs. Claude Code is required by both `mixed` and `claude`, so its presence and version checks still run. The Codex binary check and the Codex project-trust check do not appear. The exit code stays 1 because the provider check fails.
- Doctor with a valid or unset setting is unchanged.

## Non-Goals

- No change to `--dry-run` (alone or with `--ship`), `--push`, `--pr`, `--step`, `--expect`, `--reroute`, or a plain run. They keep refusing an invalid pin or mixed bundle at startup.
- No change to how `--ship` handles a malformed `status.json`; it keeps the clean startup refusal.
- No warning or notice about the invalid pin on `--ship`.
- No new doctor check status (such as "skipped"); provider-dependent checks are simply omitted when the setting is invalid.
- No change to `canon init`, `canon task new`, or `canon task set`, which already refuse an invalid setting without guessing.
- No change to the provider parser, accepted values, or error message text.
- No change to `checkRecommendedPermissions` or any other provider-independent doctor check.

## Acceptance Criteria

- [ ] AC-1 (red-first): A test runs `canon run <id> --ship` (through the existing ship-test harness with stubbed `gh`/git as the ship tests already do) on a task whose `status.json.provider` is an invalid value, and asserts exit 0, no `Invalid provider` output, and the task archived (the same end state the existing successful ship tests assert). The same test fails on pre-fix code with the `Invalid provider` refusal.
- [ ] AC-2 (red-first): A test runs `--ship` on a two-task bundle whose pins differ (`claude` and absent/`mixed`) and asserts exit 0, no `Cannot run a mixed-provider bundle` output, and both tasks archived. Fails on pre-fix code with the mixed-bundle refusal.
- [ ] AC-3: The existing test `provider validation refuses invalid pins and mixed bundles before task mutation or agent spawn` in `tests/run-task-safety.test.ts` still passes unchanged.
- [ ] AC-4: A test runs `canon run <id> --dry-run` on an invalid-pin task and asserts exit 1, the `Invalid provider` message, and no stack trace (no `    at ` frame lines).
- [ ] AC-5: A test runs `canon run <id> --ship --dry-run` on an invalid-pin task and asserts exit 1, the `Invalid provider` message, no stack trace, and the task not archived.
- [ ] AC-6: A test runs `canon run <id> --ship` on a task whose `status.json` fails validation and asserts exit 1 with the existing clean validation message and no stack trace. (Passes on pre-fix code; guards against skipping the whole startup block.)
- [ ] AC-7 (red-first): A test runs `canon doctor` with `CANON_PROVIDER=bogus` and asserts: exit status 1; the provider check fails with `Accepted values: mixed, claude`; a check line labelled `claude` is present; no line names the Codex binary check (`codex`) or `codex project trust`. Fails on pre-fix code because both Codex lines appear.
- [ ] AC-8: The existing doctor/init provider test in `tests/cli.test.ts` (`doctor and init resolve provider dependencies without Codex and report invalid settings cleanly`) still passes, including its mixed-mode assertion that Codex checks appear when the setting is empty.
- [ ] AC-9: `docs/pipeline-orchestrator.md` states, next to the sentence that a run resolves each task's pin once at startup and refuses mixed bundles, that `--ship` (without `--dry-run`) does not resolve provider pins.
- [ ] AC-10: `docs/pipeline-orchestrator.md` states that doctor with an invalid `CANON_PROVIDER` skips the Codex checks.
- [ ] AC-11: `docs/architecture.md` (the `status.json` `provider` bullet: "`canon run` resolves it once per run and refuses mixed-provider bundles") and `docs/decisions.md` (§"Per-task provider pins and backend-tagged sessions (2026-10)": "A run resolves its bundle's pin once before phases start and refuses different providers in one bundle") each gain a clause that `--ship` skips this resolution.
- [ ] AC-12: `npm run sync-templates:check` passes.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/main.ts` | In the startup block, keep the `status.json` read and validation for every mode; skip only the provider resolution and refusal when `cliArgs.ship && !cliArgs.dryRun`, leaving `runProvider` unset on that path. Other modes unchanged. |
| `src/cli/commands/doctor.ts` | When the provider setting is invalid, compute required agent checks from what every supported provider needs instead of a guessed `mixed`; omit the Codex binary and Codex project-trust checks. |
| `tests/run-task-ship.test.ts` | AC-1, AC-2, AC-6 ship tests; extend the ship fixture helpers to set a provider pin. |
| `tests/run-task-safety.test.ts` | AC-4 and AC-5 dry-run invalid-pin tests. |
| `tests/cli.test.ts` | AC-7 doctor invalid-setting test. |
| `docs/pipeline-orchestrator.md` | AC-9 and AC-10 wording. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror of the above. |
| `docs/architecture.md` | AC-11 `--ship` clause on the `provider` bullet (not canon-owned; no mirror). |
| `docs/decisions.md` | AC-11 `--ship` clause in the provider-pins decision (root only; no mirror). |
| `dist/cli/index.js` | Rebuilt output. |
| `dist/orchestrator/run-task.js` | Rebuilt output. |

### Implementation Notes (non-binding; plan owns these)

- Nothing on the ship path re-resolves the provider when `runProvider` is null: `shipTasks()` has no provider calls and `checkDeps` skips agent deps for ship. Verify this still holds before relying on it.
- `--ship --dry-run` takes the dry-run branch today (the dry-run check comes before the ship check), and `buildPipelineState` re-resolves the provider outside the startup try block. That is why the gate must exclude dry-run: with `runProvider` unset, an invalid pin there would throw with a stack instead of the clean refusal.
- The ship fixture helpers in `tests/run-task-ship.test.ts` (`makeStatus`, `prepareShipFixture`) have no provider parameter today; add one. The existing safety test drives `runReviewLoopMain` with `--step` by default, so the dry-run assertions need their own non-`--step` invocation.
- `PROVIDERS` lives in `src/lib/pipeline-policy.ts` and is not re-exported by `src/orchestrator/policy.ts`; import it directly or re-export it. The intersection of `requiredAgentBackends` over the supported providers is `{claude}` today; derive it rather than hard-coding.
- Doctor's `checkBinary` labels the Claude check with the bare command name `claude`.

### Interaction Dependencies

- `shipTasks()` and the early heartbeat/guards that run before it.
- `printDryRunPlan` / `buildPipelineState`, which must keep refusing via the startup die rather than throwing later with a stack.
- Doctor's summary line and exit code computation.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite runs clean
- [x] `npm run build`
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check`

## Docs Impact

`docs/pipeline-orchestrator.md`, `docs/architecture.md`, and `docs/decisions.md` are edited (Affected Files). README's doctor lines describe valid settings only and stay accurate.

## Known Risks

- **A later change adds a provider read to the ship path.** With `runProvider` null, `providerForTasks` would re-resolve from `readStatus` and throw an uncaught error with a stack. AC-1/AC-2 cover the current path; the plan should confirm no provider consumer is reachable from `shipTasks()`.
- **Over-broad skip.** Gating on `skipAgentDeps` or on `cliArgs.ship` alone would drop the dry-run refusal or turn `--ship --dry-run` into a stack trace. AC-4 and AC-5 pin both.
- **Skipping the whole startup block.** Dropping the `status.json` read and validation along with provider resolution would turn a malformed file on `--ship` into a stack trace. AC-6 pins the clean refusal.
- **Doctor drops the Claude check.** Omitting all agent checks on an invalid setting would hide a missing Claude Code install. AC-7 requires the `claude` line.

## Human Test Plan

1. Take a finished task whose PR is ready to merge, change its saved provider to a made-up value, and ship it. Expected: it merges and archives normally, with no complaint about the provider.
2. On that same kind of task, ask for a dry run instead (with and without the ship option). Expected: it refuses with the invalid-provider message, as before, and nothing is archived.
3. Set the provider environment setting to a made-up value and run the environment check. Expected: the provider line fails, the Claude Code line still appears, and nothing about Codex is listed.
4. Unset the provider setting and run the environment check again. Expected: Codex lines are back, as before.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed; red-first ACs AC-1, AC-2, AC-7
- [x] (Refactors) N/A
