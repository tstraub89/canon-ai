# Implementation Handoff: watch-crash-not-step-done

> Author: Codex | Spec: `tasks/watch-crash-not-step-done/spec.md` | Plan: `tasks/watch-crash-not-step-done/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/cli/commands/watch.ts` | Classify pending/in-progress-after-done as death when dead PID evidence or a fresh non-zero marker exists; remember heartbeat primary id and use candidate logs for idle classification and `--follow`. |
| `src/orchestrator/run-context.ts` | Add bounded marker parser, newest-marker selection, and deduplicated main-checkout/resolved log candidate paths. |
| `tests/watch.test.ts` | Cover marker parsing, classification, tolerance, primary/worktree lookup, bundles, and follow-mode streaming. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Clarify exit codes and stderr reason behavior; regenerated mirror with reason sentence after the summary code block. |
| `dist/cli/index.js` | Rebuilt tracked CLI bundle. |

## Intent & Rationale

Use the detached run log and surviving dead PID evidence to distinguish crashes from clean `--step` completion. Detached logs stay in the primary task directory where the run launched, even after task resolution moves to a worktree. Remember the primary task id from the last live heartbeat and search candidate locations, selecting the newest valid marker. Use the same remembered primary for `--follow`. Keep summary stdout stable and send crash details to stderr.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Candidate order prioritizes main-checkout primary paths before the current context directory. | Existing follow-mode coverage switches the heartbeat primary id during polling; selecting the primary candidate first preserves its expected log switch behavior while searching all required locations. | None. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Original fresh-marker regression returns death with marker reason. |
| AC-2 | Met | Dead resolved PID test returns death. |
| AC-3 | Met | Existing clean step_done test remains unchanged and passes. |
| AC-4 | Met | Final code=0 marker remains step_done. |
| AC-5 | Met | Marker older than status mtime by 20 seconds remains step_done. |
| AC-6 | Met | Parser tests cover last marker, code=0 winning, malformed/truncated tails, no valid marker, absent log, signal code, and bracket in reason. |
| AC-7 | Met | watchCmd emits the stable `state=... reason=death` summary without extra keys. |
| AC-8 | Met | Stderr includes exactly one crash diagnostic and resume hint; signal marker reason is surfaced. |
| AC-9 | Met | Exit-code prose and synced mirror are correct. |
| AC-10 | Met | Full suite passed: 1499 passed, 1 skipped, 0 failed. |
| AC-11 | Partial | Both builds succeed and `git status --porcelain -- dist` is stable across builds. `dist/cli/index.js` is modified; the post-commit `git diff --exit-code -- dist/` freshness check must run after pipeline-owned commit. `dist/orchestrator/run-task.js` is unchanged. |
| AC-12′ | Met | Pre-fix targeted test failed with null instead of the mid-line code=1 marker; passes after tail-anchored matching. Truncated tails and trailing output are rejected. |
| AC-12 docs placement | Met | Stderr reason sentence follows the summary code block. |
| AC-13 | Met | Candidate logs cover main-checkout primary, resolved primary, and when different, main/resolved watched task dirs; newest well-formed timestamp wins. |
| AC-14 | Met | Red-first watchCmd regression failed pre-fix (exit 0 instead of 4); passes with main-checkout primary log lookup. |
| AC-15 | Met | Secondary bundle watch remembers primary from heartbeat and reports death from primary-only log; no-heartbeat fallback uses watched id. |
| AC-16 | Met | `--follow` streams appended output from the main-checkout primary log when context is in a worktree. |

## Edge Cases Considered

- Exit markers are read only from the final 64 KiB of each log.
- Malformed/truncated marker lines are skipped; absent or unreadable logs produce no marker evidence.
- Signal markers count as non-zero.
- A live resolved PID does not count as runtime-file crash evidence.
- If status mtime cannot be read, a non-zero marker is treated as fresh.
- Mid-line marker prefixes are accepted only when the ISO timestamp terminates the line/file; marker text followed by more output is rejected.
- Exact tolerance boundary (1000 ms older) counts as crash; 1001 ms older is stale.
- Primary id is remembered only from a non-empty heartbeat task id and retained after the heartbeat disappears; no heartbeat falls back to the watched task id.
- Candidate resolver errors are caught so one unavailable worktree path does not prevent checking other candidates.

## Blockers

- [pipeline] `dist/cli/index.js` is required by the amended Affected Files and is rebuilt/stable, but remains dirty until the pipeline-owned commit. Run `npm run build && git diff --exit-code -- dist/` after that commit.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1499 passed, 1 skipped. |
| `npm run build` | Pass | Repeated build; `git status --porcelain -- dist` unchanged between builds. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npx tsx --test tests/watch.test.ts` | Pass | 51 tests passed. |
| `npx tsx --test --test-name-pattern='SIGTERM shutdown writes exactly one exit marker' tests/run-task-signals.test.ts` | Pass | Previously flaky signal test passed in isolation. |

## Ready for Review

- [ ] AC-11 awaits pipeline-owned commit and post-commit freshness check
- [x] All other spec ACs met and applicable validation checks pass
- [x] All deviations from plan documented with rationale
