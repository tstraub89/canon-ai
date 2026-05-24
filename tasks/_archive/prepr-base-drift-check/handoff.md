# Implementation Handoff: prepr-base-drift-check

> Author: Codex | Spec: `tasks/prepr-base-drift-check/spec.md` | Plan: `tasks/prepr-base-drift-check/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N - addressing review round N-1` section near the bottom rather than rewriting the file.

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/git.ts` | Added `getTreeDriftFiles(baseRef, cwd)` using two-dot `git diff <baseRef> HEAD --name-status -M -z` and `parseNameStatusOutput`. |
| `scripts/run-task/validation.ts` | Added `verifyBaseDriftFromData` plus `verifyBaseDrift`, including fetch tolerance, diff-failure reporting, telemetry/spec allow-list union, malformed-cell warnings, and task-dir exemptions. |
| `scripts/run-task/main.ts` | Wired one base-drift gate into `commitHumanReviewFiles()` immediately after `mirrorHumanReviewDocsToCwd(cwd)` and before dirty-tree inspection; added hard die, force warning, and recovery guidance branches. |
| `scripts/run-task/cli.ts` | Updated `canon run --help` text for `--pr` and `--push` to mention base-drift and `--force`. |
| `src/cli/index.ts` | Updated top-level `canon --help` text for `--pr` and `--push` to mention base-drift and `--force`. |
| `dist/cli/index.js` | Regenerated from `src/cli/index.ts` via `npm run build`. |
| `dist/scripts/run-task.js` | Regenerated from `scripts/run-task/**` via `npm run build`. |
| `tests/run-task-validation.test.ts` | Added pure-data base-drift cases, wrapper fetch/diff/malformed tests, and a real-git two-dot Mode 1 proof. |
| `tests/run-task-safety.test.ts` | Extended the fake git harness and added `commitHumanReviewFiles` base-drift integration coverage, including `--force`, diff failure, and real-git base-advance drift. |
| `docs/pipeline-orchestrator.md` | Documented the `--pr`/`--push` base-drift gate, complementary dirty-tree gate behavior, rename-both-sides requirement, and `--force` limits. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Implemented base-drift as an additive safety gate at the existing human-review commit chokepoint. The data path mirrors the existing handoff diff validator: a pure `*FromData` seam handles allow-list filtering, while the wrapper handles git fetch/diff and spec parsing. The gate uses a two-dot tree diff against `origin/<base>` so it catches files changed only on the advanced base branch, which the existing three-dot helper intentionally does not report.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Tested the `--force` bypass through `main()` with `--push --force` instead of calling `commitHumanReviewFiles()` directly. | `commitHumanReviewFiles()` reads module-level `cliArgs`; direct helper imports do not parse argv. Routing through `main()` is the existing production path that populates `cliArgs.force`. | None. AC-8/AC-11 force semantics are covered through the real caller path. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `verifyBaseDriftFromData(diffFiles, allowedPaths, taskIds)` is exported from `validation.ts` and uses `Set.has` plus `tasks/<id>/` prefix checks. |
| AC-2 | Met | `getTreeDriftFiles(baseRef, cwd)` is exported from `git.ts`, calls `gitSafeAtRaw(cwd, 'diff', baseRef, 'HEAD', '--name-status', '-M', '-z')`, preserves stderr on failure, and leaves `getAffectedFiles` unchanged. |
| AC-3 | Met | `verifyBaseDrift(taskIds, baseBranch, cwd)` fetches `origin <base>`, warns/skips on fetch failure, fails closed on diff failure, unions telemetry plus spec Affected Files, and warns on malformed cells. |
| AC-4 | Met | `commitHumanReviewFiles()` calls `verifyBaseDrift(taskIds, splitGit.getBaseBranch(taskIds), cwd)` once immediately after `mirrorHumanReviewDocsToCwd(cwd)` and handles fetch failure, diff failure, drift die, force warn, and clean continue. |
| AC-5 | Met | Base-drift die message lists each drift path on its own line, names `tasks/<id>/**`, `PIPELINE_TELEMETRY_FILES`, and `Affected Files`, includes rebase/checkout/revert recovery, rename guidance, and `--force`. The base-drift message does not include `git checkout HEAD --`; the pre-existing dirty-tree allow-list message is unchanged. |
| AC-6 | Met | `verifyBaseDriftFromData` bundle test accepts disjoint allowed paths across `task-a` and `task-b`. |
| AC-7 | Met | Added eight `verifyBaseDriftFromData` tests: empty diff, allowed spec path, drift path, task-dir path, telemetry path, bundle union, deleted path, and rename old-path drift. |
| AC-8 | Met | Added `commitHumanReviewFiles base-drift gate` tests for allowed path, drift die, force warn/proceed, diff-failure fail-closed, and real-git base-advance Mode 1 drift. |
| AC-9 | Met | Added `verifyBaseDrift: fetch failure warns and returns fetchFailed without drift`. |
| AC-10 | Met | Added wrapper diff-failure test and `commitHumanReviewFiles base-drift gate fails closed when tree diff fails`. |
| AC-11 | Met | `parseArgs` is unchanged; `cliArgs.force` remains used for full-send-on-delicate and now gates base-drift bypass. Diff failure is not bypassed. |
| AC-12 | Met | `node dist/cli/index.js --help` and `node dist/cli/index.js run --help` show the base-drift sentence for `--pr` and `--push`. |
| AC-13 | Met | `docs/pipeline-orchestrator.md` documents base-drift, where it fires, what it catches, dirty-tree complementarity, rename requirements, and `--force` limits. |

## Edge Cases Considered

- Fetch failure is offline-tolerant and returns `fetchFailed: true`; caller continues after the warning.
- Diff failure after a successful fetch is fail-closed and cannot be bypassed with `--force`.
- Renames surface both old and new paths via `--name-status -M -z`; listing only one side leaves the other as drift.
- Bundle mode uses the union of all tasks' Affected Files and all active task directories.
- Malformed Affected Files cells warn and do not enter the allow-list.
- The base-advance Mode 1 case is covered with a real bare-origin fixture: `origin/main` advances on a file the task branch never touched, and the two-dot diff flags it.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Ran `npm run lint`; exited 0. |
| `type-check` (`npm run type-check`) | Pass | Ran `npm run type-check`; exited 0. |
| `unit tests` (`npm test`) - full suite passes | Pass | Ran after `npm run build`; 407 tests, 406 pass, 1 skipped. |
| `build` (`npm run build`) - rebuilds dist; required per the corrected architecture.md binding because the change touches `scripts/run-task/main.ts`, `scripts/run-task/validation.ts`, `scripts/run-task/cli.ts`, and `src/cli/index.ts` (all bundled into `dist/`). Committed `dist/` must match a fresh build (CI gates on `git diff --exit-code -- dist/`). | Pass | Ran `npm run build`; tsup succeeded and `normalize-dist-paths` completed. |
| `E2E` - N/A; no UI | not_configured | Spec marks E2E as N/A because this is a CLI/orchestrator change with no UI. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>` for the available remote-tracking ref (`HEAD...origin/release/v1.4` reported 1 ahead / 0 behind)

---

<!--
On revision rounds, append below this line:

## Iteration N - addressing review round N-1

### Changes

| File | What Changed |
|---|---|

### Findings addressed

- _correctness bug:_ "<one-line summary>" -> fixed at file:line
- _risk/guardrail:_ ... -> ...
- _spec gap:_ ... -> ...
- _optional cleanup/nit:_ ... -> addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial -> now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
