# Implementation Plan: watch-crash-not-step-done

> Written by: Claude | Implements: `tasks/watch-crash-not-step-done/spec.md`

## Approach

Gate the `step_done` return in `classifyIdle()` (`src/cli/commands/watch.ts`, the `pending`/`in_progress` + `findPreviousDonePhase()` branch) on two crash-evidence checks, and classify `death` (with an optional `reason`) when either holds. Marker parsing lives in one exported helper in `src/orchestrator/run-context.ts`. `watchCmd` prints the reason as a stderr diagnostic in the idle `death` case; the stdout summary line is untouched. Spec review verdict: approved, no nits.

**Feasibility check**
- **Exists:** confirmed by reading code: `classifyIdle`, `findPreviousDonePhase`, `summarizeIdle`, `IdleClassification` (`watch.ts`); `RunContext` (has `taskDir`, `statusFile`), `gatherRunContext` (`run-context.ts`); `runLogPathFor(taskDir)` (`detach.ts`, joins `.canon-run.log`); `writeExitMarker` format `■ orchestrator exit code=<N> [reason=<reason>] at <ISO>` (`src/orchestrator/cli.ts`, reason is already newline-collapsed; code is a number or `signal:<NAME>`).
- **Real path:** `watchCmd` poll loop → `orchestratorStillProgressing()` false → grace sleep → `gatherContext` → `classifyIdle(freshCtx, …)` → `emitSummary(summarizeIdle(...))` → switch → `exit`. Existing code on the path: the `changes_requested` branch (unchanged) and the trailing `death` fallbacks. The initial-attach path (`classifyAttach`, `reportInitialFailure`) is a separate path and stays untouched.
- **Callers:** `classifyIdle` is called once in `watch.ts` (the idle block) plus tests. Its return type gains only an optional `reason` on `death`, so `summarizeIdle` and all switches stay valid. `gatherRunContext` is not changed (spec's "additive fields" option is unnecessary: `ctx.taskDir` and `ctx.statusFile` already carry what is needed), so `stop`/`doctor` are unaffected. **Deviation from spec wording, not contradiction:** spec offers RunContext/injectable dep; plan reads from `ctx.taskDir`/`ctx.statusFile` directly and tests use a real temp dir.
- **Tests that can fail:** every new `death` test uses spec_review `done` + plan `in_progress`, so pre-fix code hits the `step_done` branch. The `step_done`-preserving tests (AC-3/4/5) pass pre- and post-fix by design (guards against over-correction). Existing `classifyIdle: step_done shows the transition` uses `taskDir: '/tmp/t1'` (no run log, `ENOENT`) so the helper must return null on a missing file, and the `status.json` stat must tolerate `ENOENT`.
- **Predicates:** (1) runtime-files-left-behind: `ctx.resolvedPid != null && !orchestratorLive` (`orchestratorLive` is already computed in `classifyIdle` with `probeAlive`; default probe is `() => false`). Requiring not-live keeps a live pid on today's behavior. (2) marker code `'0'` → not a crash; any other string incl. `signal:SIGTERM` or `1` → crash. Marker ts: `Date.parse` NaN → treat line as malformed. Crash iff `markerMs >= statusMtimeMs - 1000`; if `status.json` can't be stat'ed, treat the marker as newer (prefer reporting a crash). Empty log, log with no well-formed marker, unreadable log → null.
- **Scope:** files changed are `watch.ts`, `run-context.ts`, `tests/watch.test.ts`, `docs/pipeline-orchestrator.md`, and its regenerated mirror `templates/docs/pipeline-orchestrator.md` — all in Affected Files. (`docs/pipeline-orchestrator.md` is in `CANON_OWNED`; mirror comes from `npm run sync-templates` — declare it in the handoff Changes table.)
- **Async/stateful:** synchronous, read-only fs reads at classification time, no re-entry or cached state. The log is only read after the orchestrator is dead, so no concurrent-writer race beyond a partially flushed last line (handled by the malformed-line rule).

## Steps

### Step 1: Marker parsing helper

Files: `src/orchestrator/run-context.ts`

Add (import `fs`, `runLogPathFor` from `./detach.js`; `readCanonPid` is already imported from there):

```ts
export interface ExitMarker { code: string; reason: string; timestampMs: number }
const EXIT_MARKER_TAIL_BYTES = 64 * 1024;
const EXIT_MARKER_RE = /■ orchestrator exit code=(\S+) \[reason=(.*)\] at (\S+)\s*$/;

export function readLastExitMarker(taskDir: string): ExitMarker | null
```

- Open `runLogPathFor(taskDir)` with `fs.openSync`/`fs.fstatSync`, read only the last `EXIT_MARKER_TAIL_BYTES` (position `max(0, size - N)`), decode utf8, close in `finally`. Any fs error → `null`.
- Split on `\n`, iterate from the last line backwards, return the first line matching `EXIT_MARKER_RE` with `Date.parse(ts)` not NaN. Unanchored at the start (a marker may follow output lacking a newline). A truncated/malformed final line simply doesn't match, so the previous well-formed marker wins; none → `null`.
- Greedy `(.*)` lets reasons contain `]`.

### Step 2: Gate `step_done` in `classifyIdle`

Files: `src/cli/commands/watch.ts`

- `IdleClassification`: `| { kind: 'death'; state: string; pid?: number; reason?: string }`.
- Add a local helper `findCrashEvidence(ctx, orchestratorLive): { reason: string } | null`:
  1. `ctx.resolvedPid != null && !orchestratorLive` → `{ reason: 'orchestrator died without a clean exit (runtime files left behind)' }`.
  2. `const marker = readLastExitMarker(ctx.taskDir)`; if `marker && marker.code !== '0'`: `let statusMs: number | null; try { statusMs = fs.statSync(ctx.statusFile).mtimeMs } catch { statusMs = null }`; if `statusMs == null || marker.timestampMs >= statusMs - 1000` → `{ reason: `orchestrator exited non-zero: ${marker.reason}` }`.
  3. else `null`.
- In the `pending`/`in_progress` branch, after `previousPhase` is found: `const crash = findCrashEvidence(ctx, orchestratorLive); if (crash) return { kind: 'death', state, pid: ctx.resolvedPid ?? undefined, reason: crash.reason };` before the `step_done` return. Leave the `changes_requested` branch and the trailing fallbacks as is.
- `summarizeIdle` stays unchanged (`death` case already ignores extra fields). Import `readLastExitMarker` from `run-context.js`.

### Step 3: stderr diagnostic in `watchCmd`

Files: `src/cli/commands/watch.ts`

`findCrashEvidence` returns the full diagnostic text in `reason`: `orchestrator exited non-zero: <marker reason>` for the marker case, `orchestrator died without a clean exit (runtime files left behind)` for the pid case (update Step 2 accordingly). In the idle block, before `emitSummary(stdout, summarizeIdle(idleResult))`, add:

```ts
if (idleResult.kind === 'death' && idleResult.reason) {
    stderr(`canon watch: ${idleResult.reason}; run \`canon run ${taskId}\` to resume\n`);
}
```

The marker's raw reason text must appear verbatim in it (AC-8). Exit code stays `4` via the existing `death` case.

### Step 4: Tests

Files: `tests/watch.test.ts`

Add a helper `withRunLog(lines, statusAgeMs, fn)` using `withTempDir`: create `<dir>/t1`, write `status.json` (any content) and set its mtime with `fs.utimesSync` to `NOW_REAL - statusAgeMs`; write `.canon-run.log`; build ctx via `makeContext({ taskDir, statusFile, statusResult: ok(spec_review done, plan in_progress) })`. Marker timestamps use real ISO strings relative to the real `Date.now()` (mtime is real-clock), e.g. `new Date(Date.now()).toISOString()`.

- AC-1 (red-first): code=1 marker with the budget-exhaustion reason, newer than status mtime → `kind: 'death'`, `reason` contains the marker text. Fails pre-fix (`step_done`).
- AC-2: no run log, `resolvedPid: 4242`, `canonPid: 4242`, default probe (dead) → `death`. Also a variant with `probeAlive: () => true` is not asserted as death (keeps live-pid behavior).
- AC-3: no run log, no pids → `step_done` (existing test stays; add the temp-dir variant too).
- AC-4: last marker `code=0` → `step_done`.
- AC-5: `code=1` marker whose timestamp is 10s older than status mtime → `step_done`; plus a within-tolerance case (marker 500ms older than mtime) → `death`.
- AC-6 (helper unit tests on `readLastExitMarker`): several markers, last decides; `code=1` followed by final `code=0` → `code '0'`; truncated final line (`■ orchestrator exit code=1 [reas`) ignored in favour of the previous well-formed marker; no well-formed marker → `null`; missing log → `null`; `signal:SIGTERM` code parsed verbatim; reason containing `]`.
- AC-7/AC-8: `watchCmd` via `runWatchCommand(['t1'], …)` following the pattern of the stale-heartbeat test (`gatherContextImpl` returns, in sequence, a live-attach ctx then the crashed ctx — `heartbeatResult` fresh and `resolvedPid` live for the first, `{kind:'missing'}` and null pids for the second; `probeAliveImpl: () => false`, `makeClock()` for `nowImpl`/`sleepImpl`). Assert exit `4`, `stdout` last line matches `^state=plan reason=death$` exactly with no extra keys, stderr contains exactly one `canon watch: orchestrator exited non-zero: ` diagnostic line including the marker reason and `canon run t1`, and stdout has only the summary line. Second case with `■ orchestrator exit code=signal:SIGTERM [reason=terminated by SIGTERM …] at …` → exit `4`, reason on stderr.

Before finalizing the watchCmd test, run it once and confirm the first gather indeed attaches (re-use the exact ctx shape of the existing stale-heartbeat test, lines ~1015–1110).

### Step 5: Docs

Files: `docs/pipeline-orchestrator.md`, then `npm run sync-templates`

- Exit-code table: `0` row → "Healthy stop — checkpoint (`human_review`), complete, or `--step` step-done (reported only when no crash evidence exists)". `4` row → "Crash — orchestrator died, or the run log's last exit marker is non-zero; run `canon run <id>` to resume".
- Summary-line prose: add one sentence that for a crash the failure reason is printed on stderr and the summary line itself is unchanged.
- Run `npm run sync-templates` to regenerate `templates/docs/pipeline-orchestrator.md`; never hand-edit it.

## Testing Plan

- **Unit**: new `classifyIdle` death/step_done cases (AC-1…5) and `readLastExitMarker` parsing cases (AC-6) in `tests/watch.test.ts`.
- **E2E-ish**: two `watchCmd` cases (AC-7/8) asserting exit code, stable stdout line, stderr diagnostic.
- **Validation (spec)**: `npm run lint`, `npm run type-check`, `npm test` (full suite), `npm run build`, `npm run sync-templates:check`, `npm run docs-refs-check`. Note: `dist/` is tracked, so `npm run build` output is part of the change; list changed `dist/` files in the handoff Changes table.
