# Implementation Plan: watch-late-attach-crash

> Written by: Claude | Implements: `tasks/watch-late-attach-crash/spec.md`

## Approach

Extract the #76 crash-evidence block from `classifyIdle()` into one exported helper in `src/cli/commands/watch.ts`, call it from both classifiers, and print the reason from `reportInitialFailure()`. Spec review verdict is `approved`, with no nits to fold in.

**Feasibility check** (searched in the code, not recalled):

- **Exists:** `classifyIdle` (`watch.ts:383`), `classifyAttach` (`:324`), `reportInitialFailure` (`:668`), and `readNewestExitMarker` / `runLogCandidateDirs` (imported from `run-context.ts`) all exist. `IdleClassification` already has `death.reason?`. The tests have `makeContext`, `makeStatus`, `makeCrashStatus`, `writeExitLog`, `exitLine`, `runWatchCommand`, `makeClock` and `withTempDir`.
- **Real path:**
  - Late attach goes `watchCmd` → `gatherContext` → `classifyAttach` (`:723`) → `reportInitialFailure`.
  - `classifyAttach` is also called at `:764` (post launch-wait; `death` goes to `reportInitialFailure`) and `:805` (poll loop).
  - At `:805` a non-live `death` or `nothing_to_watch` is not matched by the live, `read_error` or `ambiguous_pid` branches, so it falls through to the idle grace path. Both kinds behave identically there, and the new reason is ignored. No change is needed at `:805`.
  - The existing `in_progress` → `death` return at `:365-374` already sits on this path. The helper call goes before it.
- **Callers:**
  - `classifyAttach` has 3 call sites in `watch.ts` and many in `tests/watch.test.ts`. Adding an optional `reason` to the `death` variant is source-compatible.
  - `reportInitialFailure` is the only `switch` over `AttachClassification`. `death` is also built at `:369` only.
  - `classifyIdle` has one production caller (`:871`) and keeps its output byte-for-byte.
- **Tests that can fail:**
  - AC-1 fails on current code because the pending-after-done path with no heartbeat or pid reaches `nothing_to_watch`.
  - AC-4's marker-reason test fails today because the `in_progress` return carries no reason.
  - AC-5 fails today because `reportInitialFailure` prints only the hint, with no marker reason.
- **Predicates:**
  - Current phase = first phase in `PHASE_ORDER` whose status is not `done`, treating a missing entry as `pending`.
  - The helper runs only when that phase is `pending` or `in_progress`. This excludes `blocked` (already handled above), `changes_requested`, and "all done" (no current phase).
  - **`human_review` is also excluded** from the helper gate. A task parked at the `human_review` checkpoint has `human_review: pending` and today reports `nothing_to_watch`. The spec's non-goal "not changing `human_review` handling on attach" forbids routing it through crash evidence. This is a reading of the non-goal, not a contradiction, so it's recorded in `notes.md`.
  - Marker boundaries:
    - `code` is a string, and `'0'` is clean. `signal:SIGTERM` counts as non-zero.
    - Freshness is `statusMtimeMs == null || marker.timestampMs >= statusMtimeMs - 1_000`, with the existing 1s tolerance and a missing `status.json` meaning "not stale".
    - `resolvedPid` is `null` → skip rule (a). `0` is not a realistic pid, and the existing code uses `!= null`, which is preserved.
- **Scope:** every file below is in the spec's Affected Files. `tests/watch.test.ts`, `docs/pipeline-orchestrator.md`, the generated `templates/docs/pipeline-orchestrator.md`, and `dist/cli/index.js` are the only other files touched.
- **Async/stateful:** N/A. The helper is synchronous and reads files per call. It holds no state, and nothing caches or re-enters.

Contradictions with the spec: none.

## Steps

### Step 1: Shared helper and `classifyIdle` refactor

Files: `src/cli/commands/watch.ts`

Add above `classifyAttach`, exported:

```ts
export function findCrashEvidence(
    ctx: RunContext,
    taskId: string,
    probeAlive: (pid: number) => boolean,
    primaryTaskId?: string,
): string | null {
    if (ctx.resolvedPid != null && !probeAlive(ctx.resolvedPid)) {
        return 'orchestrator died without a clean exit (runtime files left behind)';
    }
    const marker = readNewestExitMarker(runLogCandidateDirs(ctx.taskDir, taskId, primaryTaskId ?? taskId));
    if (marker && marker.code !== '0') {
        let statusMtimeMs: number | null = null;
        try {
            statusMtimeMs = fs.statSync(ctx.statusFile).mtimeMs;
        } catch {
            // Missing state cannot establish that the marker is stale.
        }
        if (statusMtimeMs == null || marker.timestampMs >= statusMtimeMs - 1_000) {
            return `orchestrator exited non-zero: ${marker.reason}`;
        }
    }
    return null;
}
```

In `classifyIdle()`, replace the inline block at `:444-458` with:

```ts
const crashReason = findCrashEvidence(ctx, taskId, probeAlive, primaryTaskId);
if (crashReason) {
    return { kind: 'death', state, pid: ctx.resolvedPid ?? undefined, reason: crashReason };
}
```

The old rule-(a) return passed `pid: ctx.resolvedPid`, and `?? undefined` is equivalent there because the pid is non-null. The `step_done` return after it is unchanged. Rule (a) reuses the `probeAlive` argument, so `orchestratorLive` is not needed here (it is still used earlier in the function).

### Step 2: Use the helper in `classifyAttach`

Files: `src/cli/commands/watch.ts`

1. Widen the type: `| { kind: 'death'; state: string; hint: string; reason?: string }`.
2. Inside `if (status) { ... }`, before the `inProgress` check, add:

```ts
const currentPhase = PHASE_ORDER.find(phase => (status.phases[phase]?.status ?? 'pending') !== 'done');
const currentStatus = currentPhase ? (status.phases[currentPhase]?.status ?? 'pending') : null;
if (currentPhase && currentPhase !== 'human_review' && (currentStatus === 'pending' || currentStatus === 'in_progress')) {
    const heartbeatPrimary = ctx.heartbeatResult.kind === 'found' ? ctx.heartbeatResult.record.task_ids[0] : undefined;
    const primaryId = typeof heartbeatPrimary === 'string' && heartbeatPrimary.length > 0 ? heartbeatPrimary : taskId;
    const reason = findCrashEvidence(ctx, taskId, probeAlive, primaryId);
    if (reason) {
        return { kind: 'death', state, hint: `run \`canon run ${taskId}\` to resume`, reason };
    }
}
```

Keep the existing `inProgress` → `death` (generic hint) and final `nothing_to_watch` returns exactly as they are. Match the `rememberPrimary` guard (`typeof === 'string' && length > 0`) from `watchCmd`.

### Step 3: Print the reason

Files: `src/cli/commands/watch.ts`

In `reportInitialFailure()`'s `death` case:

```ts
case 'death':
    stderr(result.reason
        ? `canon watch: ${result.reason}; run \`canon run ${taskId}\` to resume\n`
        : `canon watch: ${result.hint}\n`);
    emitSummary(stdout, { state: result.state, reason: 'death' });
    return exit(4);
```

The summary line and exit code `4` are unchanged. The reason line matches the idle path's `canon watch: <reason>; run \`canon run <id>\` to resume` shape. It uses `taskId`, which is already in scope.

### Step 4: Tests (red-first)

Files: `tests/watch.test.ts`

Write the AC-1 test first and confirm it fails on the pre-change code, then implement Steps 1-3. Use a `makePendingAfterDoneContext(taskDir)` helper next to `makeCrashStatus` (spec_review `done`, plan `pending`, no heartbeat, `canonPid` and `resolvedPid` null), plus the existing `writeExitLog` / `exitLine`.

`writeExitLog` writes `status.json` before the log. `exitLine` defaults to `new Date()`, so it is fresh. Add the tests after the existing `classifyAttach` tests, grouped as follows:

- **AC-1:** `exitLine('1', 'claude session exited 1 (budget)')` → `kind: 'death'`, and `reason` matches `/orchestrator exited non-zero: .*budget/`. The hint is still `run \`canon run t1\` to resume`.
- **AC-2:** no log, no pid → `nothing_to_watch`.
- **AC-3, `code=0`:** `exitLine('0', 'clean')` → `nothing_to_watch`.
- **AC-3, stale:** a non-zero marker timestamped >1s before the `status.json` mtime. Use `fs.utimesSync` to set the `status.json` mtime to a future time, or give the marker an ISO timestamp from 1 hour ago while the `status.json` mtime is "now". → `nothing_to_watch`.
- **AC-4 (reason):** plan `in_progress` + fresh non-zero marker → `death`, and `reason` is set.
- **AC-4 (generic):** plan `in_progress`, no evidence → `death`, and `reason` is `undefined`. Assert the `hint`.
- **Extra, boundary:** the same shape with `human_review` pending after `qa` `done` and a fresh non-zero marker → `nothing_to_watch`. This pins the `human_review` exclusion.
- **Extra, rule (a):** `resolvedPid: 4242`, `probeAlive: () => false`, pending-after-done → `death` with `reason` matching `/runtime files left behind/`. Rule (a) has no attach coverage otherwise.
- **AC-5:** a `watchCmd` test with `gatherContextImpl: () => ctx`, using `runWatchCommand(['t1'], { nowImpl: clock.now, sleepImpl: clock.sleep, ... })` and the AC-1 context. The first and only gathered context is the dead one, so `classifyAttach` returns `death`. Assert:
  - `exitCode === 4`
  - `stdout` deepEquals `['state=plan reason=death\n']`
  - `stderr` joined matches both the marker reason and `/canon run t1/`
  - exactly one stderr line starts with `canon watch: orchestrator exited non-zero:`

  `state` comes from `status.status`, so build the status with `makeStatus('plan', ...)`.

The existing `makeContext` default `taskDir: '/tmp/t1'` matters here. Always pass the temp `taskDir` and `statusFile`, or `runLogCandidateDirs` would read the real `/tmp/t1`.

### Step 5: Docs

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` (generated)

Edit only the root. In the exit-code `4` row (`:40`), append: "Both checks apply whether `canon watch` attached before the run exited or after it had already died." Optionally adjust the sentence after the summary block ("For a crash, the failure reason is printed on stderr") to say the same. Then run `npm run sync-templates`. Do not hand-edit the mirror.

### Step 6: Validate and build

Run, in order:

```
npm run lint && npm run type-check && npm test
npm run build
npm run sync-templates:check
npm run docs-refs-check
```

`dist/cli/index.js` must be rebuilt by `npm run build` and kept in the diff.

In the handoff, include the AC-6 grep proof. The freshness comparison must appear once:

```
grep -n "timestampMs >= statusMtimeMs" src/cli/commands/watch.ts
```

Also show that `classifyIdle` and `classifyAttach` both call `findCrashEvidence`.

## Testing Plan

- **Unit** (`tests/watch.test.ts`): Step 4's `classifyAttach` cases (AC-1 to AC-4 plus the two extras).
- **E2E** (`tests/watch.test.ts`): the `watchCmd` late-attach test (AC-5).
- **Regression:** all existing `tests/watch.test.ts` tests pass unchanged (AC-6). In particular, the #76 `classifyIdle` and `watchCmd` crash tests cover the Step 1 refactor.
- **Full suite:** `npm test` runs clean (AC-8).
