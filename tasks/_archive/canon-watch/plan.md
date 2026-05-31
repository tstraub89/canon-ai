# Plan: canon-watch

> Addresses all 13 ACs. Incorporates spec-review nit (AC-5 symbol export).

## Spec-review nit resolution

**Nit (AC-5 symbols)**: `STOP_WAIT_DEFAULT_MS` and `STOP_WAIT_POLL_INTERVAL_MS` are currently unexported in `stop.ts`. The plan exports them explicitly in Step 3 so `watch.ts` imports them without reimplementing the timeout value.

---

## Step 1 — `scripts/run-task/state.ts`: export `validateStatus` + add `readStatusFromPath` (AC-9)

Change `validateStatus` from a private `function` declaration to an `export function`. No logic change.

Add a new export below `validateStatus`:
```ts
export function readStatusFromPath(statusFile: string, taskIdForErrors = '<unknown>'): StatusJson {
    const parsed = JSON.parse(fs.readFileSync(statusFile, 'utf8')) as StatusJson;
    validateStatus(taskIdForErrors, parsed);
    return parsed;
}
```

Refactor `readStatus` to delegate:
```ts
export function readStatus(taskId: string): StatusJson {
    return readStatusFromPath(statusFileFor(taskId), taskId);
}
```

No behavior change for any existing caller.

**Files touched**: `scripts/run-task/state.ts`

---

## Step 2 — New `scripts/run-task/run-context.ts`: shared resolver (AC-9)

Create the file from scratch. It is the single audited home for orphan-tolerant task-dir resolution, EPERM-tolerant pid liveness, and run-context assembly. It imports from `state.ts`, `heartbeat.ts`, and `detach.ts`. It does NOT import from `stop.ts` or `doctor.ts` (they migrate onto it, not the other way).

### 2a — `tolerantTaskDir(taskId: string): string`

Mirrors the private `taskDirFor` in `stop.ts` and `resolveHeartbeatDir` in `doctor.ts`:
```ts
export function tolerantTaskDir(taskId: string): string {
    if (isOrphanedWorktreeState(taskId)) return taskDirForRepoRoot(taskId);
    return path.dirname(statusFileFor(taskId));
}
```
`statusFileFor` calls `resolveTaskCwd` which can `die()` on a missing worktree. The `isOrphanedWorktreeState` guard ensures that path is only taken when the worktree actually exists; the guard mirrors the one already in `stop.ts`'s `taskDirFor`.

### 2b — `RunContext` type

```ts
export type StatusReadResult =
    | { kind: 'ok'; status: StatusJson }
    | { kind: 'missing' }
    | { kind: 'error'; reason: string };

export interface RunContext {
    taskDir: string;
    statusResult: StatusReadResult;
    heartbeatResult: HeartbeatReadResult;   // from heartbeat.ts
    resolvedPid: number | null;             // best pid for liveness probe
    launchWindow: boolean;                  // canon-pid alive, heartbeat absent
}
```

### 2c — `gatherRunContext` + injectable deps

```ts
export interface GatherRunContextDeps {
    readStatusImpl?: (file: string) => StatusJson;
    readHeartbeatImpl?: (dir: string) => HeartbeatReadResult;
    readCanonPidImpl?: (dir: string) => number | null;
    probeAliveImpl?: (pid: number) => boolean;
}

export function gatherRunContext(taskId: string, deps?: GatherRunContextDeps): RunContext
```

Implementation:
1. `taskDir = tolerantTaskDir(taskId)`
2. Read `statusResult` via `readStatusFromPath(path.join(taskDir, 'status.json'), taskId)` wrapped in try/catch (ENOENT → `missing`, any parse/validate error → `error: reason`). Use `deps.readStatusImpl` when injected (tests pass a function that reads from a temp file).
3. `heartbeatResult = (deps.readHeartbeatImpl ?? readHeartbeatStatus)(taskDir)`
4. `canonPid = (deps.readCanonPidImpl ?? readCanonPid)(taskDir)`
5. `probe = deps.probeAliveImpl ?? defaultProbeAlive` where `defaultProbeAlive` is EPERM-tolerant (`process.kill(pid, 0)` → true; EPERM → true; ESRCH/other → false).
6. **Compute `resolvedPid`** (matching stop's CASE C + CASE D pid selection):
   - CASE A (neither): `null`
   - CASE B (canonPid only): `canonPid`
   - CASE C (heartbeat only): `heartbeat.pid`
   - CASE D same pid: `canonPid`
   - CASE D-disagree (both present, pids differ): if canonPid dead AND heartbeat pid alive AND heartbeat fresh → `heartbeat.pid`; else → `canonPid` (primary)
7. **Compute `launchWindow`**: `canonPid != null && probe(canonPid) && heartbeatResult.kind === 'missing'`

---

## Step 3 — `src/cli/commands/stop.ts`: export constants + migrate to shared resolver (AC-11)

**Export the wait constants** (nit resolution):
```ts
export const STOP_WAIT_DEFAULT_MS = 30_000;
export const STOP_WAIT_POLL_INTERVAL_MS = 250;
```

**Replace private `taskDirFor`** with an import of `tolerantTaskDir` from `run-context.ts`:
- Delete the private `taskDirFor` function.
- In `stopCmd`, replace `deps.dirOverride ?? taskDirFor(taskId)` with `deps.dirOverride ?? tolerantTaskDir(taskId)`.
- Update the import from `state.ts` — remove `isOrphanedWorktreeState`, `taskDirForRepoRoot` if they're no longer used directly in this file (they move to `run-context.ts`).

**The `probeAlive` closure stays local** to `stopCmd` (it uses the injected `kill` dep for testability — the EPERM-tolerant pattern it uses is now shared by being the same pattern in `run-context.ts`, but the closure is not replaced because its injected-kill seam is load-bearing for the existing stop tests). No change to `decideStopAction`, `waitForHeartbeat`, or the SIGTERM/SIGKILL escalation.

**Verify**: `tests/stop.test.ts` must pass completely unmodified (behavioral assertions only — mechanical reference updates to renamed exports are acceptable if any helper names changed, but no behavioral assertion should change).

**Files touched**: `src/cli/commands/stop.ts`

---

## Step 4 — `src/cli/commands/doctor.ts`: migrate to shared resolver (AC-10)

**Delete** the private `readStatusForCheck` and `resolveHeartbeatDir` functions.

**Rewrite `checkActiveOrchestrators`** to use `gatherRunContext` from `run-context.ts`:
- Where it previously called `readStatusForCheck(id)` to check `hasInProgressPhase`, call `gatherRunContext(id)` and use `ctx.statusResult`.
- Where it previously called `resolveHeartbeatDir(id)` then `readHeartbeat(taskDir)`, use `ctx.heartbeatResult` (already a `HeartbeatReadResult` — extract the record when `kind === 'found'`).
- The `checkActiveOrchestrators` function's logic, output wording, pass/warn/fail thresholds, and detail messages must be **byte-identical** to before. Only the internal helper calls change.
- `formatAge` stays in `doctor.ts` and continues to be exported (stop.ts imports it; watch.ts will import it too for heartbeat-age ticks).

**Verify**: `tests/cli.test.ts` doctor coverage passes unmodified.

**Files touched**: `src/cli/commands/doctor.ts`

---

## Step 5 — New `src/cli/commands/watch.ts` (AC-1 through AC-8, AC-12)

### 5a — Pure decision core (fully unit-testable)

**Attach-time classification** (AC-2). Takes a `RunContext` + a `now: number` + `probeAlive: (pid: number) => boolean` and returns a tagged result. No disk/process/timer access — all state is in the resolved context.

```ts
type AttachResult =
    | { kind: 'auto_block'; phase: string }
    | { kind: 'live'; pid: number }
    | { kind: 'launch_window' }
    | { kind: 'death'; hint: string }
    | { kind: 'nothing_to_watch'; hint: string }
    | { kind: 'read_error'; file: string; reason: string };

export function classifyAttach(
    ctx: RunContext,
    taskId: string,
    probeAlive: (pid: number) => boolean,
    now: number,
): AttachResult
```

Precedence (AC-2 ordering — most-specific real state first):
1. If `ctx.statusResult.kind === 'error'` → `read_error` (exit 2, `reason=read_error`)
2. `ctx.statusResult.kind === 'ok'` and any phase `status === 'blocked'` → `auto_block` (exit 3), even if orchestrator is mid-shutdown
3. `ctx.resolvedPid != null && probeAlive(ctx.resolvedPid) && !isHeartbeatStale(heartbeatRecord, now)` → `live`
4. `ctx.launchWindow` → `launch_window`
5. `ctx.statusResult.kind === 'ok'` and any phase `status === 'in_progress'` but no live resolvedPid → `death` (exit 4) with hint `run \`canon run <id>\` to resume`
6. otherwise → `nothing_to_watch` (exit 2) with hint pointing at `canon task status`

**Idle classification** (AC-3). After the orchestrator goes idle (pid dead or heartbeat removed/gone), classify the settled `status.json` state.

```ts
type IdleResult =
    | { kind: 'checkpoint'; phase: string }
    | { kind: 'complete' }
    | { kind: 'auto_block'; phase: string }
    | { kind: 'step_done'; phase: string; verdict?: string }
    | { kind: 'death' }
    | { kind: 'read_error'; file: string; reason: string };

export function classifyIdle(ctx: RunContext, taskId: string): IdleResult
```

Logic (pure — inputs from a re-resolved RunContext):
- `read_error` if statusResult is error or missing and unreadable
- `auto_block` if any phase `status === 'blocked'`
- `complete` if `status.status === 'complete'`
- `checkpoint` if the current phase is `human_review` with status `done`
- `step_done` if an intermediate phase is `done` or `changes_requested` (carry the verdict when `changes_requested`) and later phases still `pending`
- `death` if status still shows any phase `in_progress` after the grace re-read

**`--until` phase check** (AC-4). Pure helper: given a `RunContext` and a target phase name, returns `true` when that phase has settled (`done`/`changes_requested`/`blocked`).

**Summary line formatter** (AC-7). Pure function: takes a result kind + optional fields (`phase`, `verdict`, `pid`) and returns a `key=value` string with keys `state` + `reason` (+ `phase`/`verdict`/`pid` when applicable). All `reason` vocabulary: `checkpoint`, `complete`, `auto_block`, `step_done`, `death`, `timeout`, `until`, `nothing_to_watch`, `launch_window_timeout`, `read_error`, `usage_error`.

**Duration parser** (AC-8). Pure: accepts `<int>s` / `<int>m` / bare integer seconds; returns milliseconds or throws with `reason=usage_error`.

### 5b — Impure poll loop

`watchCmd(args: string[], deps: WatchCmdDeps = {}): void`

**`WatchCmdDeps`** (injectable — same pattern as `StopCmdDeps` in `stop.ts`):
- `exit?: (code: number) => never`
- `stdout?: (s: string) => void`
- `stderr?: (s: string) => void`
- `sleepImpl?: (ms: number) => void`
- `nowImpl?: () => number`
- `gatherContextImpl?: (taskId: string) => RunContext`
- `probeAliveImpl?: (pid: number) => boolean`
- `readHeartbeatImpl?: (dir: string) => HeartbeatReadResult` (passed into `gatherRunContext` + `waitForHeartbeat`)
- `readCanonPidImpl?: (dir: string) => number | null`
- `waitTimeoutMs?: number` (launch-window budget, defaults to `STOP_WAIT_DEFAULT_MS` from `stop.ts`)
- `pollIntervalMs?: number` (main poll interval, default 3000)

**Arg parsing**:
- `taskId = args[0]` — if missing, emit usage to stderr and exit 2 with `reason=usage_error`
- `--until <phase>` — if the phase is not in `PHASE_ORDER`, exit 2 `reason=usage_error` **before** attaching (AC-4)
- `--timeout <dur>` — parse via duration parser; if invalid, exit 2 `reason=usage_error`
- `--follow` / `-f` — flag for live log streaming to stderr

**Attach sequence**:
1. Gather context: `ctx = gatherContext(taskId)`
2. `result = classifyAttach(ctx, taskId, probe, now())`
3. Dispatch:
   - `read_error` → stderr the file + cause + recovery hint; emit summary to stdout; exit 2
   - `auto_block` → emit summary to stdout; exit 3
   - `live` → emit attach line to stderr (`Attached to orchestrator pid=…, task=…`); proceed to poll loop
   - `launch_window` → emit "Waiting for orchestrator's first heartbeat…" to stderr; use `waitForHeartbeat` from `stop.ts` with `STOP_WAIT_DEFAULT_MS` + `STOP_WAIT_POLL_INTERVAL_MS`; on outcomes:
     - `found` → re-gather context, resume attach classification (typically → live → poll loop)
     - `pid-died` → emit summary `reason=death` to stdout; exit 4
     - `timeout` → emit summary `reason=launch_window_timeout` to stdout; exit 2 with startup-crash hint to stderr
     - `corrupt` / `unreadable` → emit summary `reason=read_error` to stdout; exit 2
   - `death` → emit summary to stdout; exit 4
   - `nothing_to_watch` → emit summary to stdout; exit 2

**Poll loop**:
- Every `pollIntervalMs` (~3s): sleep, re-gather context, re-classify.
- **`--until` early return**: after each re-gather, check `phaseSettled(ctx, untilPhase)`; if settled → emit summary `reason=until` to stdout; exit 0.
- **Orchestrator went idle**: detect by `resolvedPid` dead/null AND (`heartbeatResult.kind === 'missing'` OR `heartbeatResult.kind !== 'found'` after being previously live):
  - Emit "orchestrator idle, re-reading…" to stderr.
  - **Grace re-read** (AC-3): sleep one poll interval, re-gather context once more before concluding.
  - Call `classifyIdle(freshCtx, taskId)`.
  - Emit summary to stdout; exit per exit-code table.
- **Heartbeat age ticks**: every poll iteration while still live, emit a `heartbeat Ns ago` line to stderr using `formatAge` from `doctor.ts`.
- **`--timeout`**: if `now() >= timeoutDeadline` → emit summary `reason=timeout` to stdout; exit 5.
- **`--follow`**: on attach, read the run-log path via `runLogPathFor(ctx.taskDir)` (from `detach.ts`). Open the file, seek to end, and on each poll iteration emit new bytes to stderr. Skip gracefully if the file does not exist yet. Clean up on exit.

**Output discipline** (AC-6):
- `stdout` receives **exactly one line**: the summary line emitted at the very end via `emitSummary(stdout, ...)`. All other output (progress, attach line, heartbeat ticks, log stream) goes to `stderr`. The poll loop never writes to stdout.

**Exit-code mapping**:
- `0` = `checkpoint` / `complete` / `step_done` / `until`
- `2` = `nothing_to_watch` / `usage_error` / `read_error` / `launch_window_timeout`
- `3` = `auto_block`
- `4` = `death`
- `5` = `timeout`

**Read-only contract** (AC-12): no writes to `status.json`, no git working-tree mutations, no signals. The only `process.kill` call is the `0`-signal liveness probe via `probeAliveImpl`.

**Files touched**: `src/cli/commands/watch.ts` (new)

---

## Step 6 — `src/cli/index.ts`: dispatch + help (AC-1)

Add to the imports:
```ts
import { watchCmd } from './commands/watch.js';
```

Add to the switch after `case 'stop'`:
```ts
case 'watch':
    watchCmd(args);
    break;
```

Add to `printHelp()`, in the command listing after the `canon stop` block:
```
  canon watch <id> [opts]     Attach to a detached run; block until it stops.
                                Exit: 0=healthy stop · 2=nothing to watch /
                                  usage error · 3=auto-block · 4=death · 5=timeout
                                Last stdout line: stable key=value summary.
                                  --until <phase>  Return early when phase settles
                                  --timeout <dur>  Cap (30s/10m/120)
                                  -f, --follow     Stream run log to stderr
```

`canon watch` with no id must exit 2 with a usage message (handled by the `taskId` guard in `watchCmd`); the existing `default` unknown-command path is unchanged.

**Files touched**: `src/cli/index.ts`

---

## Step 7 — New `tests/run-context.test.ts` (AC-9)

Pure unit tests using injected deps. Cases from the Testing Matrix:
- Orphaned-worktree state → `tolerantTaskDir` returns REPO_ROOT path, `gatherRunContext` does not throw.
- Pid fallback: `.canon-pid` missing + heartbeat has `pid` → `resolvedPid = heartbeat.pid` (CASE C).
- Pid fallback: `.canon-pid` present + dead + heartbeat alive + fresh → `resolvedPid = heartbeat.pid` (CASE D-disagree).
- Launch-window: `.canon-pid` present + alive + heartbeat missing → `launchWindow = true`, `resolvedPid = canonPid`.
- EPERM from probe → treated as alive (probe returns `true`), does not misclassify as dead.
- Status read error → `statusResult.kind === 'error'` with non-empty reason string.
- Status missing (ENOENT) → `statusResult.kind === 'missing'`.

---

## Step 8 — New `tests/watch.test.ts` (AC-1–AC-8)

Pure unit tests for `classifyAttach`, `classifyIdle`, and `watchCmd` via `WatchCmdDeps`. Follow the `StopCmdDeps` pattern from `tests/stop.test.ts`.

**Attach-time branches** (AC-2):
- blocked phase in status → `auto_block`, exit 3
- resolvedPid alive + heartbeat fresh → `live`, poll loop entered
- launchWindow flag → `launch_window` → waitForHeartbeat path
- status shows `in_progress`, no live pid → `death`, exit 4
- all-pending or complete status, no pid → `nothing_to_watch`, exit 2

**Idle branches** (AC-3):
- phase `human_review` done → `checkpoint`, exit 0
- `status.status === 'complete'` → `complete`, exit 0
- any phase `blocked` → `auto_block`, exit 3
- intermediate phase `done`, later phases `pending` → `step_done`, exit 0
- intermediate phase `changes_requested` → `step_done` with `verdict=changes_requested`, exit 0
- status still `in_progress` after grace re-read → `death`, exit 4

**Grace re-read** (AC-3):
- heartbeat gone + status `in_progress` on first idle check, settled on grace re-read → classifies as settled result, NOT death

**Launch-window wait** (AC-5):
- heartbeat appears during wait → re-classify → live → poll loop
- pid dies during wait → exit 4, `reason=death`
- deadline elapses with no heartbeat → exit 2, `reason=launch_window_timeout`

**Read-failure** (AC-7):
- unreadable status.json → exit 2, `reason=read_error`, stderr names the file and cause
- corrupt heartbeat → exit 2, `reason=read_error`

**`--until`** (AC-4):
- target phase settles during polling → exit 0, `reason=until`
- invalid phase (not in `PHASE_ORDER`) → exit 2, `reason=usage_error` before any attaching

**`--timeout`** (AC-8):
- valid forms parse correctly: `30s` → 30000, `10m` → 600000, bare `120` → 120000
- invalid form → exit 2, `reason=usage_error`
- deadline reached while still attached → exit 5, `reason=timeout`

**Summary-line format** (AC-6/AC-7):
- stdout receives exactly one line per invocation across all branches
- stable `key=value` pairs; all `reason` vocabulary values appear across the test suite

**Bundle** (Testing Matrix):
- heartbeat `task_ids[0]` resolves the shared log path for `--follow` when watching a non-primary bundle member

---

## Step 9 — Migration regression gate (AC-10, AC-11)

Run `npm test`. Must pass **unmodified** (no behavioral assertion changes):
- `tests/stop.test.ts` — all CASE A–D tests, launch-window wait, refuse paths, signal escalation, SIGKILL escalation
- `tests/cli.test.ts` — `checkActiveOrchestrators` doctor coverage

If any stop/doctor test requires a mechanical reference update (e.g. import of a constant that changed from unexported to exported), apply only that rename — no behavioral assertion changes.

---

## Step 10 — Build (AC-13)

```bash
npm run lint
npm run type-check
npm test
npm run build
git diff --exit-code -- dist/
```

Stage and commit `dist/**` as part of the implementation commit. The `--pr` base-drift gate requires `dist/` to be committed alongside the source changes.

Also CI-gated if docs/templates change: `npm run sync-templates:check`, `npm run docs-refs-check`. Docs updates (`docs/pipeline-orchestrator.md`, `docs/codebase-map.md`, `CLAUDE.md`) are deferred to the QA phase per the spec's Affected Files table.

---

## Implementation order

1. `scripts/run-task/state.ts` — export + add `readStatusFromPath`
2. `scripts/run-task/run-context.ts` — new; foundation everything else builds on
3. `tests/run-context.test.ts` — write + verify resolver tests pass before migrating consumers
4. `src/cli/commands/stop.ts` — export constants + swap `taskDirFor`; verify stop tests still pass
5. `src/cli/commands/doctor.ts` — swap private helpers with shared resolver; verify cli tests pass
6. `src/cli/commands/watch.ts` — new
7. `src/cli/index.ts` — dispatch + help
8. `tests/watch.test.ts` — write + verify
9. Full suite: `npm run lint && npm run type-check && npm test`
10. `npm run build`, commit `dist/`

---

## Affected Files (summary)

| File | Action |
|---|---|
| `scripts/run-task/state.ts` | Modify: export `validateStatus`, add `readStatusFromPath` |
| `scripts/run-task/run-context.ts` | **New** |
| `src/cli/commands/stop.ts` | Modify: export constants, swap `taskDirFor` |
| `src/cli/commands/doctor.ts` | Modify: swap private helpers with shared resolver |
| `src/cli/commands/watch.ts` | **New** |
| `src/cli/index.ts` | Modify: dispatch + printHelp |
| `tests/run-context.test.ts` | **New** |
| `tests/watch.test.ts` | **New** |
| `tests/stop.test.ts` | Modify only if mechanical reference renames required |
| `tests/cli.test.ts` | Modify only if mechanical reference renames required |
| `dist/**` | Rebuilt |
