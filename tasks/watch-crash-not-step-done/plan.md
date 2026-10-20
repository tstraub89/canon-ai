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

## Reroute Plan

### Delta

Amendment round 1 (review: approved): add `dist/` to Affected Files (AC-11), anchor the marker regex and fix doc placement (AC-12). Steps 1–5 above still apply; the shipped behavior (classification, stderr diagnostic, tests AC-1…8) is unchanged except where noted.

- Feasibility:
  - Exists: `EXIT_MARKER_RE` (`src/orchestrator/run-context.ts:35`, unanchored: `/■ orchestrator exit code=…/`), `readLastExitMarker` (:37, already splits the tail on `\r?\n` and matches per line), `tests/watch.test.ts` marker tests (~:546/:554), the stray sentence at `docs/pipeline-orchestrator.md:45` between the "Summary line" lead-in and its code block. `dist/cli/index.js` and `dist/orchestrator/run-task.js` are tracked; `git status` shows them clean at HEAD (the prior round restored them).
  - Real path: `classifyIdle` → `findCrashEvidence` → `readLastExitMarker`; per-line matching means a `^` anchor (no `m` flag needed) is equivalent to the spec's "multiline" anchoring. A tail cut mid-line yields a first fragment that cannot start with `■ orchestrator exit`, or is a complete marker; a cut inside the marker's end fails the `at (\S+)\s*$` tail, so it is rejected already.
  - Callers: `readLastExitMarker` is only called from `watch.ts` `findCrashEvidence` (grep to confirm at implement time); the regex is module-private. No contract change to the function's return type.
  - Tests that can fail: new test writes a log whose only match is mid-line (e.g. `error: saw "■ orchestrator exit code=1 [reason=x] at 2026-01-01T00:00:00.000Z" in output` plus a line with a quoted marker after other text). Pre-change the unanchored regex returns a marker; post-change null. Fails without the change.
  - Predicates: anchor `^` at index 0 of each split line; a leading `\r` is removed by the split; leading whitespace is NOT permitted (matches the spec's line-start). Existing well-formed-marker tests start at column 0 and keep passing.
  - Scope: `dist/cli/index.js`, `dist/orchestrator/run-task.js` now in Affected Files; all other files already were.
  - Async/stateful: N/A (sync fs read).
  - **Risk recorded (not a contradiction):** `writeExitMarker` (`src/orchestrator/cli.ts:28`) writes no leading newline, so if earlier stderr output ended without `\n`, the real marker sits mid-line and the anchored regex misses it (falls back to `step_done`). The spec mandates line-start anchoring and forbids changing the writer (Non-Goals), so implement as specced; noted in `notes.md` as `[plan]`.

### Steps

1. **Anchor the regex** — `src/orchestrator/run-context.ts:35`: change to `/^■ orchestrator exit code=(\S+) \[reason=(.*)\] at (\S+)\s*$/`. Nothing else in the helper changes.
2. **Mid-line test** — `tests/watch.test.ts`, next to the `readLastExitMarker` null/absent test: log containing the marker text only mid-line (quoted in other output) → `readLastExitMarker` returns `null`. Add a second assertion: same mid-line text followed by a genuine line-start marker returns the genuine one.
3. **Doc placement** — `docs/pipeline-orchestrator.md`: move the "For a crash, the failure reason is printed on stderr; the summary line itself is unchanged." sentence to after the closing fence of the summary-line code block; the lead-in `**Summary line** — … key=value:` must be immediately followed by the block. Then `npm run sync-templates` (never hand-edit `templates/docs/pipeline-orchestrator.md`).
4. **Rebuild dist** — `npm run build`, then commit-ready: keep the regenerated `dist/cli/index.js` (and `dist/orchestrator/run-task.js` if changed) in the working tree; do NOT restore them. Verify `git diff --exit-code -- dist/` is clean *after staging/committing the rebuild* by running build twice (idempotent) and confirming `git status --porcelain dist` shows only the intended modifications; list both dist files in the handoff Changes table.
5. **Validation** — `npm run lint`, `type-check`, `npm test` (full), `build`, `sync-templates:check`, `docs-refs-check`; targeted `npx tsx --test tests/watch.test.ts`.

Append `[plan]` note to `tasks/watch-crash-not-step-done/notes.md` for the leading-newline risk.

## Reroute Plan Round 2

### Delta

Amendment round 2 (review: approved): `writeExitMarker` emits no leading newline, so a marker can land mid-line after unterminated agent stderr; Round 1's `^` anchor hides it and revives the false `step_done`. Replace line-start anchoring with a tail-anchored match (AC-12′). Round 1 steps for dist (AC-11) and doc placement still apply and are already done; only the regex and its tests change. The writer stays untouched (Non-Goal).

- Feasibility:
  - Exists: `EXIT_MARKER_RE` at `src/orchestrator/run-context.ts:35` (currently `^`-anchored, per-line match in `readLastExitMarker`), `writeExitMarker` at `src/orchestrator/cli.ts:17` (line ends `at ${timestamp}\n`), helpers `writeExitLog`/`exitLine` at `tests/watch.test.ts:536/542`, tests at :546, :554, :569, :582. All found by grep, not recalled.
  - Real path: `classifyIdle` (`watch.ts:~440`) → `readLastExitMarker(ctx.taskDir)` → regex per split line, scanning from the last line backwards. Dropping `^` means the leftmost `■ orchestrator exit code=` on a line starts the match. The mandatory `at (\S+)\s*$` tail is what rejects a tail cut mid-marker, and what rejects quoted text followed by more output (`… at <ISO> in output`).
  - Callers: `readLastExitMarker` has one caller (`watch.ts:445`); return type and null contract unchanged. The regex is module-private.
  - Tests that can fail: (i) `partial agent output with no newline■ orchestrator exit code=1 [reason=…] at <ISO>` returns null under the Round 1 `^` regex, a marker after the change. (ii) A truncated final marker is already ignored today, so (ii) is a guard, not a red test; it must still be added per the amendment. **Finding:** the existing test at `tests/watch.test.ts:569` builds `'error: saw ' + exitLine(...)`. That line ends with the ISO timestamp, so it is a valid mid-line marker under the new rule and its `null` assertion fails after the regex change. The amendment says to replace it. Do so; don't leave it behind.
  - Predicates: the timestamp must end the line or file (`\s*$` allows trailing `\r`/spaces); unparseable ISO still `continue`s to the previous line (existing `Number.isFinite` check). The reason group stays greedy `(.*)`, so a reason containing `]` or ` at ` parses up to the last `] at <token>$`. Empty prefix (marker at column 0) still matches. A tail cut at the 64 KiB boundary inside the prefix text is harmless; a cut inside the marker fails the tail. Residual: if the prefix itself contains a quoted marker, the leftmost `■` wins and the reason carries that junk; the code and timestamp still come from the real tail, so classification is unaffected. Accepted, not worth a second parse.
  - Tolerance boundary (optional nit): `watch.ts` treats `marker.timestampMs >= statusMtimeMs - 1_000` as death, so a marker exactly 1000 ms older than the mtime is death and 1001 ms older is `step_done`. Use an integer-second mtime `S` (`fs.utimesSync(statusFile, S, S)`) with marker ms `S*1000 - 1000` (death) and `S*1000 - 1001` (`step_done`). That avoids float noise in `mtimeMs`; no sub-second mtime is needed.
  - Scope: touches only `src/orchestrator/run-context.ts`, `tests/watch.test.ts`, and the rebuilt `dist/cli/index.js` (and `dist/orchestrator/run-task.js` if changed). All are in Affected Files.
  - Async/stateful: N/A (sync fs read).
  - Contradiction check: none. The Round 1 `[plan]` risk note in `notes.md` is resolved by this amendment; append a one-line `[plan]` note saying so.

### Steps

1. **Drop the anchor**: `src/orchestrator/run-context.ts:35` becomes `/■ orchestrator exit code=(\S+) \[reason=(.*)\] at (\S+)\s*$/`. Update the helper's neighbouring comment, if any, to say the marker may follow unterminated output. No other change to `readLastExitMarker`.
2. **Replace the mid-line test**: `tests/watch.test.ts:569`, the `ignores marker text embedded in output…` test. Rename it to cover AC-12′:
   - (i) log whose final line is `partial agent output with no newline` + `exitLine('1', 'claude session exited 1', ISO)` → `readLastExitMarker` returns code `'1'`, reason `claude session exited 1`. Write it with `fs.writeFileSync` directly, since `writeExitLog` joins with `\n` and that is still fine.
   - (ii) final line is a truncated marker (`■ orchestrator exit code=1 [reason=x]`, no ` at <ISO>`) after a well-formed `exitLine('0', 'prev', …)` → returns the previous marker; with no earlier marker → `null`.
   - (iii) quoted marker followed by more text on the same line (`error: saw <marker> in output`) → `null`, to pin the tail anchor.
3. **Split the combined classifyIdle test** (nit): `tests/watch.test.ts:582` into three tests: fresh non-zero → `death` with reason; `code=0` marker → `step_done` (own test); stale marker → `step_done`. Add the exact-boundary pair from the Feasibility note (1000 ms → `death`, 1001 ms → `step_done`). Reuse `makeCrashStatus` and `exitLine`; keep the existing assertions unchanged.
4. **Rebuild dist**: `npm run build`; keep the regenerated `dist/cli/index.js` (and `dist/orchestrator/run-task.js` if changed). Do not revert. Run build twice and confirm `git status --porcelain dist` is stable. List the dist files in the handoff Changes table.
5. **Validation**: `npx tsx --test tests/watch.test.ts`, then `npm run lint`, `type-check`, `npm test` (full), `build`, `sync-templates:check`, `docs-refs-check`. The docs and mirror are untouched this round; `sync-templates:check` should stay clean.
