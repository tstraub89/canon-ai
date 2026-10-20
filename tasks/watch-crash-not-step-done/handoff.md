# Implementation Handoff: watch-crash-not-step-done

> Author: Codex | Spec: `tasks/watch-crash-not-step-done/spec.md` | Plan: `tasks/watch-crash-not-step-done/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/cli/commands/watch.ts` | Classify pending/in-progress-after-done as death when dead PID evidence or a fresh non-zero exit marker exists; print crash reason to stderr. |
| `src/orchestrator/run-context.ts` | Add bounded last exit-marker parser. Marker text may follow unterminated output, but the ISO timestamp must end the line/file. |
| `tests/watch.test.ts` | Cover marker parsing, classification, watch command output, truncated tails, mid-line markers, and exact mtime tolerance boundary. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Clarify exit codes and stderr reason behavior; regenerated template mirror, with reason sentence after the summary code block. |
| `dist/cli/index.js` | Rebuilt tracked CLI bundle. |

## Intent & Rationale

Use the detached run log and surviving dead PID evidence to distinguish crashes from clean `--step` completion. Compare marker time to `status.json` mtime using the one-second tolerance. Keep summary stdout stable and send crash details to stderr. The Round 2 amendment permits the marker prefix to follow unterminated agent output while retaining the required end-of-line timestamp shape.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| `classifyIdle` reads existing `RunContext.taskDir` and `statusFile` directly. | These fields already provide the needed paths; no context shape change was needed. | None. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Pre-fix regression returned `step_done` instead of `death`; passes after fix. |
| AC-2 | Met | Dead resolved PID test returns death. |
| AC-3 | Met | Existing clean step_done test remains unchanged and passes. |
| AC-4 | Met | Final code=0 marker remains step_done. |
| AC-5 | Met | Marker older than status mtime by 20 seconds remains step_done. |
| AC-6 | Met | Parser tests cover last marker, code=0 winning, truncated final marker, no valid marker, absent log, signal code, and bracket in reason. |
| AC-7 | Met | watchCmd exits 4 and emits exactly `state=plan reason=death`. |
| AC-8 | Met | Stderr has one crash diagnostic with reason/resume hint; signal marker also reports reason. |
| AC-9 | Met | Exit-code prose updated and template sync check passes. |
| AC-10 | Partial | Required checks were run. Targeted watch suite passes. Full suite has one unrelated failure listed below. |
| AC-11 | Partial | Both builds succeeded and `git status --porcelain -- dist` was unchanged between builds. The bundle remains a working-tree change until the pipeline-owned commit; the post-commit `git diff --exit-code -- dist/` check must run after that commit. `dist/orchestrator/run-task.js` did not change. |
| AC-12′ | Met | Red-first command `npx tsx --test --test-name-pattern='accepts unterminated output' tests/watch.test.ts` failed pre-fix with null instead of the code=1 marker; passes after removing the start anchor. Tests also reject a truncated tail and a marker followed by trailing output. |
| AC-12 docs placement | Met | Stderr reason sentence follows the summary code block. |

## Edge Cases Considered

- Exit markers are read only from the final 64 KiB of the run log.
- Malformed/truncated marker lines are skipped; absent or unreadable logs produce no marker evidence.
- Signal markers count as non-zero.
- A live resolved PID does not count as runtime-file crash evidence.
- If status mtime cannot be read, a non-zero marker is treated as fresh.
- Mid-line marker prefixes are accepted only when the ISO timestamp terminates the line/file; marker text followed by more output is rejected.
- Exact tolerance boundary (1000 ms older) counts as crash; 1001 ms older is stale.

## Blockers

- [pipeline] The amended Affected Files requires committing `dist/cli/index.js`. The pipeline owns staging/commit; after that commit, rerun the CI freshness check (`npm run build && git diff --exit-code -- dist/`). The bundle is currently regenerated and stable across consecutive builds.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Fail – unrelated | `tests/run-task-signals.test.ts:314`, “SIGTERM shutdown writes exactly one exit marker before the re-raise”; outside this task's affected files. Repro hint: `npm test`. |
| `npm run build` | Pass | Ran twice; `git status --porcelain -- dist` stayed stable. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npx tsx --test tests/watch.test.ts` | Pass | 46 tests passed. |

## Ready for Review

- [ ] All spec ACs met (AC-10 has an unrelated full-suite failure; AC-11 awaits pipeline-owned commit and post-commit freshness check)
- [x] Validation outcomes recorded; unrelated full-suite failure is outside the affected files
- [x] All deviations from plan documented with rationale
