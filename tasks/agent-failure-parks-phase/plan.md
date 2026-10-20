# Implementation Plan: agent-failure-parks-phase

> Written by: Claude | Implements: `tasks/agent-failure-parks-phase/spec.md`

## Approach

Add a typed `AgentSessionError`. The non-interactive failure branches of the agent wrappers and the cold-Codex branch of `runCodeReviewPhase()` throw it instead of calling `process.exit`. `main()`'s phase loop gets one exported boundary helper, `withAgentSessionPark()`, which wraps `runPhase()` + session storage + `checkAndRoute()`. It catches only `AgentSessionError`, parks the full bundle with `autoBlockPhase()`, prints a stop banner, sets the exit reason and exits `2`. Any other error is rethrown unchanged. The crashed-`spec_review` branch in `checkAndRoute()` gains the same durable `autoBlockPhase()` write before its existing `process.exit(2)`. No phase runner catches the error, so a failed session never reaches post-processing (QA salvage stays unreachable).

Spec review verdict: **approved**, no nits, so nothing to fold in.

### Feasibility check

- **Exists:** confirmed by grep. Ladder `process.exit` sites are `src/orchestrator/agents/claude.ts:189-210` (spawnError / stalled / exitCode / signal) and `src/orchestrator/agents/codex.ts:112-127` (spawnError / stalled / signal). The cold-Codex exit is `src/orchestrator/phases/code-review.ts:435-442`. Also confirmed: `autoBlockPhase()` at `src/orchestrator/state.ts:459`, `shouldParkCrashedReview()` at `main.ts:3080` (park branch at `main.ts:3254-3259`), `retryAgentForPhase()` at `main.ts:3086`, the main loop's `runPhase` → `checkAndRoute` at `main.ts:3746-3770`, and `run-task.ts`'s `main().catch(... process.exit(1))`. `src/orchestrator/agents/errors.ts` does not exist yet; the spec makes it new.
- **Real path:** `main()` loop → `runPhase()` → phase runner → `runClaude`/`runCodex` → `streamProcess` → failure ladder. The recovery path is `checkAndRoute()` → per-member loop → `recoverPhaseForTask()` → `retryAgentForPhase()` → `runCodex`/`runClaude`. `runClaude()` already has `catch { status = 'failed'; throw }` + `finally { recordMetric }` (`claude.ts:240-245`), and `runCodex()` has the same (`codex.ts:138-143`). So a throw from inside `attempt()` records a `failed` metric with no new code. `registerExitHandlers()` (`cli.ts`) writes the exit marker from `setExitReason()`, and `main()` registers it at `main.ts:3552`.
- **Callers:** `runClaude`: `phases/spec.ts:41,57`, `phases/plan.ts:25`, `phases/qa.ts:39`, `phases/code-review.ts:461` (via `deps`), and `main.ts:3157` (retry). `runCodex`: `phases/implement.ts:100`, `phases/spec-review.ts:106`, and `main.ts:3142` (retry). `runCodeReviewPhase`: `main.ts` `runPhase()` plus the unit tests. No phase runner or retry site has a `try` around these calls (`grep 'try {' src/orchestrator/phases/*.ts` shows only file-read guards). All of them are reached only from inside the new boundary. `runColdCodexReview()` is unchanged: it already returns `{ success: false }`.
- **Tests that can fail:** each new or updated test is red-first: run against pre-fix code, the process exits `1` from inside the wrapper before the assertion point, or the park writes nothing. The exceptions are AC-6 and AC-9; see Steps 7 and 9.
- **Predicates:** `isAgentSessionError(err)` is an `instanceof` check, so non-Error throws (strings, `undefined`) and plain `Error`s are rethrown. `phase === 'complete'` is unreachable for an agent failure but is rethrown for typing (`autoBlockPhase` takes `Phase`). `phaseIterationCount()` treats a missing phase entry or missing counters as `0`, and `0` is a valid escalation count. `shouldParkCrashedReview` is unchanged.
- **Scope:** every file below is in the spec's Affected Files. `docs/codebase-map.md` already covers the new file through its `src/orchestrator/agents/*.ts` row, so it is not edited; it is outside Affected Files anyway.
- **Async/stateful:** the park ends the process (`process.exit(2)`), so nothing re-enters. Heartbeat and `.canon-pid` cleanup run on `'exit'`, as on every other exit-2 auto-block. Operator SIGINT/SIGTERM: `streamProcess()` never resolves while `isShuttingDown()`, so no throw happens and `signals.ts` stays the owner. The stall path kills the child group before `streamProcess` resolves, so no orphan is left when the wrapper throws. Bundle ownership: Decision 7 holds by trace, because the only agent calls reachable from `checkAndRoute()` are in the per-member completion loop (via `retryAgentForPhase`), and that loop runs before any verdict or routing write.
- **Re-entry of a `blocked` phase (spec Decision 6 / Known Risk):** verified by trace for every phase. `deriveTopLevelStatus()` (`state.ts:427`) returns the first non-`done` phase, so a `blocked` phase is current. Each runner sets `in_progress` before its agent: `spec.ts`, `spec-review.ts:99`, `plan.ts:21`, `implement.ts`, `code-review.ts:391`, `qa.ts:36`. Their entry loop-cap checks read counters, not status, and a crash bumps no counter. For `code_review` specifically, `stopForReviewerBlock()` runs only inside `checkAndRoute()`, after `runCodeReviewPhase()` has already reset the status. That runner's early exits all auto-block or exit themselves, and its pre-flight-rejection return writes `done` via `taskPhasePreflightRejected`. So a crash-parked `code_review` re-runs instead of hitting the reviewer-block banner. The code path does not differ, so the spec's conditional extra `code_review` test is not needed. AC-5 covers `plan` and AC-13 covers `spec_review` re-entry end to end. One status-dependent branch was found: `implement.ts:81` `wasImplementInProgress` decides whether a non-revision, non-reroute implement *resumes* a stored `codex` session. After a park the status is `blocked`, so the re-run uses the fresh implement prompt instead of resuming. This is not a refusal or a misroute: the failed session's ID is never stored (a spec non-goal), and partial worktree edits stay on disk. It only matters when an implement *retry* inside `checkAndRoute()` crashes after a returned session was stored. `implement.ts` is outside Affected Files, so it is left unchanged and recorded in `notes.md`.

### Judgment calls (also in `notes.md`)

1. **Cold-Codex `kind`.** `runColdCodexReview()` reports only `success`, not why it failed. Use `kind: 'exit_code'` with no exit code, the closest member of the spec's fixed union, and add a source comment saying the cold review does not report which failure occurred. Do not widen the union or change `runColdCodexReview()`.
2. **Recovery hint is agent-aware.** For Claude the budget clause is "budget — raise `CLAUDE_BUDGET`". For Codex it is "credits/quota", because telling an operator to raise `CLAUDE_BUDGET` for a Codex stall is wrong.
3. **Wrappers stop calling `setExitReason()` in the converted branches.** The main-loop catch owns the exit reason. A thrown error should not mutate global exit state. Drop the now-unused `setExitReason` import from `codex.ts`. `claude.ts` still uses it in the interactive path, and `code-review.ts` still uses it for the HEAD-unresolvable path.
4. **Crashed-spec_review warn names the full bundle.** The `Fix the cause, then re-run` line uses `canon run ${taskIds.join(' ')}`, not `taskIds[i]`, to match Decision 7's whole-bundle re-run. The single-task test regex `/canon run task-crash/` still matches.

## Steps

### Step 1: Add `AgentSessionError`

Files: `src/orchestrator/agents/errors.ts` (new)

```ts
export type AgentSessionAgent = 'claude' | 'codex';
export type AgentSessionFailureKind = 'spawn_error' | 'stalled' | 'signal' | 'exit_code';

export class AgentSessionError extends Error {
    readonly agent: AgentSessionAgent;
    readonly kind: AgentSessionFailureKind;
    readonly exitCode: number | null;
    readonly signal: NodeJS.Signals | null;
    readonly reason: string;

    constructor(opts: {
        agent: AgentSessionAgent;
        kind: AgentSessionFailureKind;
        reason: string;
        exitCode?: number | null;
        signal?: NodeJS.Signals | null;
    }) {
        super(opts.reason);
        this.name = 'AgentSessionError';
        this.agent = opts.agent;
        this.kind = opts.kind;
        this.reason = opts.reason;
        this.exitCode = opts.exitCode ?? null;
        this.signal = opts.signal ?? null;
    }
}

export function isAgentSessionError(err: unknown): err is AgentSessionError {
    return err instanceof AgentSessionError;
}
```

Keep comment density at the level of the sibling `agents/*.ts` files: one short header comment saying this is the non-interactive session-failure signal that `main()` parks, and that phase runners must not catch it.

### Step 2: Claude ladder throws

Files: `src/orchestrator/agents/claude.ts`

In `attempt()`'s ladder (`claude.ts:189-210`), keep `console.error(result.spawnError.message)`, `printClaudeTooOldHint(...)` and `status = 'failed'`. Replace each `setExitReason(...)` + `process.exit(...)` pair with a throw that carries the same reason text:

| Branch | Throw |
|---|---|
| `spawnError` | `new AgentSessionError({ agent: 'claude', kind: 'spawn_error', reason: \`claude session spawn error: ${result.spawnError.message}\` })` |
| `stalled` | `{ agent: 'claude', kind: 'stalled', reason: 'claude session stalled' }` |
| `exitCode !== 0` | `{ agent: 'claude', kind: 'exit_code', exitCode: result.exitCode, reason: \`claude session exited ${result.exitCode} (possible budget exhaustion — see CLAUDE_BUDGET)\` }` |
| `signal` | `{ agent: 'claude', kind: 'signal', signal: result.signal, reason: \`claude session received signal ${result.signal}\` }` |

The stale-`--resume` early return above the ladder is unchanged. The interactive branch (`claude.ts:88-94`, `setExitReason` + `process.exit(exitCode)`) is unchanged. The outer `catch`/`finally` already turns the throw into a `failed` metric row (AC-10).

### Step 3: Codex ladder throws

Files: `src/orchestrator/agents/codex.ts`

Same conversion in `runCodex()` at `codex.ts:112-127`, for `spawn_error` (keep the `console.error`), `stalled` and `signal`, with reasons `codex session spawn error: …`, `codex session stalled` and `codex session received signal …`. The `result.exitCode !== 0` warn-and-return block stays exactly as it is. Remove `setExitReason` from the `../cli.js` import; `die`, `info` and `warn` stay. `runColdCodexReview()` is untouched.

### Step 4: Cold-Codex failure throws

Files: `src/orchestrator/phases/code-review.ts`

Replace the `!coldReview.success` block (`code-review.ts:435-442`) with:

```ts
if (!coldReview.success) {
    // runColdCodexReview reports success only, not which failure occurred
    // (no turn.completed / empty findings / spawn error / stall / signal).
    throw new AgentSessionError({
        agent: 'codex',
        kind: 'exit_code',
        reason:
            `cold-Codex review could not be obtained for task(s) ${taskIds.join(', ')} ` +
            `(no findings output / spawn error / stall / signal). Re-run when Codex is available — ` +
            `the code_review phase has not advanced.`,
    });
}
```

The `setExitReason` import stays, because the HEAD-unresolvable path at `code-review.ts:385-388` still uses it and still exits `1`. That path is not an agent failure and is out of scope.

### Step 5: One park point in `main()`

Files: `src/orchestrator/main.ts`

5a. Imports: `import { AgentSessionError, isAgentSessionError } from './agents/errors.js';`.

5b. Add the helpers next to `stopForReviewerBlock()` (the `// ── checkAndRoute` section):

```ts
function phaseIterationCount(taskIds: string[], phase: Phase): number {
    return taskIds.reduce((max, id) => {
        const entry = splitState.readStatus(id).phases[phase];
        return Math.max(max, entry?.iterations_current_loop ?? entry?.iterations ?? 0);
    }, 0);
}

function parkAgentSessionFailure(phase: Phase, taskIds: string[], err: AgentSessionError): never {
    const rerun = `canon run ${taskIds.join(' ')}`;
    const budget = err.agent === 'claude' ? 'budget — raise `CLAUDE_BUDGET`' : 'credits/quota';
    const reason = `${err.reason}. Fix the cause (auth, ${budget}, network), then re-run \`${rerun}\`.`;
    // Full bundle on purpose: members that already marked the phase done are
    // reopened so the bundle re-runs the phase together (no agent runs after routing).
    splitState.autoBlockPhase(taskIds, phase, phaseIterationCount(taskIds, phase), reason);
    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log(`  ✋  AGENT SESSION FAILED — ${phase} parked as blocked.`);
    console.log(`  Agent:  ${err.agent}`);
    console.log(`  Reason: ${err.reason}`);
    console.log(`  Fix the cause (auth, ${budget}, network), then run:`);
    console.log(`    ${rerun}`);
    console.log('════════════════════════════════════════════════════════');
    console.log('');
    splitCli.setExitReason(err.reason);
    process.exit(2);
}

// The main loop's only agent-failure boundary: an AgentSessionError from a phase
// runner or from checkAndRoute's retry becomes a durable park; anything else propagates.
export async function withAgentSessionPark<T>(phase: CurrentPhase, taskIds: string[], fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch (err) {
        if (!isAgentSessionError(err) || phase === 'complete') throw err;
        parkAgentSessionFailure(phase, taskIds, err);
    }
}
```

Use whatever `CurrentPhase`/`Phase` type aliases `main.ts` already uses (it references both, e.g. `runPhase(phase: CurrentPhase, …)` and `checkAndRoute(phase: Phase, …)`). Banner strings must stay adopter-safe: no canon-ai file paths. `CLAUDE_BUDGET` is a documented env var.

5c. In the `while (true)` loop (`main.ts:3745-3770`), keep `const state = buildPipelineState(taskIds);` outside the wrapper. Move the block from `const phaseResult = await runPhase(currentPhase, state);` through `await checkAndRoute(currentPhase, taskIds);` (the closing brace of the `if (currentPhase !== 'complete' && …)` block) unchanged into `await withAgentSessionPark(currentPhase, taskIds, async () => { … });`. Leave the `--step` block outside, after the wrapper. `lastClaudeSessionId`, `lastCodexSessionId` and `lastCodexExitStatus` are module-level and assigned inside the closure as today.

5d. Crashed-spec_review park (`main.ts:3254-3259`). Keep the three `warn` lines, changing the third to `canon run ${taskIds.join(' ')}` (judgment call 4). Then, before `process.exit(2)`:

```ts
const parkReason =
    `Codex spec review exited with status ${lastCodexExitStatus} and did not complete for '${taskIds[i]}' — ` +
    `no verdict was recorded this round. Fix the cause (out-of-credits, auth, network, or an MCP crash), ` +
    `then re-run \`canon run ${taskIds.join(' ')}\`.`;
splitState.autoBlockPhase(taskIds, 'spec_review', phaseIterationCount(taskIds, 'spec_review'), parkReason);
splitCli.setExitReason(parkReason);
```

Pass the full `taskIds`, not filtered (Decision 7 / Decision 5). Do not touch verdicts or counters: `autoBlockPhase` changes only `status`, `auto_block_count`, `escalations` and `updated`.

Do not change `retryAgentForPhase()`, `recoverPhaseForTask()`, `stopForReviewerBlock()`, or any loop-cap or routing code.

### Step 6: Update the failure-ladder test and add metrics coverage (AC-2, AC-10)

Files: `tests/run-task-safety.test.ts`

Rewrite `'Claude failure ladders set exit reasons and Codex non-zero exits do not exit by themselves'` (`:8076`) and rename it, for example to `'agent failure ladders throw AgentSessionError and Codex non-zero exits still return'`. Each failing case's inline script becomes:

```js
import { registerExitHandlers } from './src/orchestrator/cli.js';
import { AgentSessionError } from './src/orchestrator/agents/errors.js';
import { runClaude } from './src/orchestrator/agents/claude.js';
registerExitHandlers();
try {
  await runClaude('prompt', false, null, 'model', 'effort', '10', <metricsContext>, process.cwd());
  console.log('returned');
} catch (err) {
  console.log('CAUGHT ' + JSON.stringify({ isASE: err instanceof AgentSessionError, name: err.name, agent: err.agent, kind: err.kind, exitCode: err.exitCode, signal: err.signal, reason: err.reason }));
}
console.log('after-call');
```

Use the same `./src/orchestrator/...js` specifier style as the existing inline scripts, so tsx resolves `errors` to one module instance and `instanceof` holds. Assertions per case: `status === 0`; exactly one exit marker, with `code=0`; stdout has `after-call` and not `returned`; parse the `CAUGHT` JSON:

- Claude `exit 1`: `isASE: true`, `agent: 'claude'`, `kind: 'exit_code'`, `exitCode: 1`, `reason` matches `/claude session exited 1/`.
- Codex spawn error (`PATH` = empty dir): `kind: 'spawn_error'`, reason `/codex session spawn error:/`.
- Codex `sleep 2` with `PIPELINE_STALL_TIMEOUT_MS: '1'`: `kind: 'stalled'`, reason `/codex session stalled/`.
- Codex `kill -TERM $$`: `kind: 'signal'`, `signal: 'SIGTERM'`, reason `/codex session received signal SIGTERM/`.
- Codex `exit 1`: unchanged. It still returns, prints `after-runCodex`, `status === 0`, and has no `code=1`.

AC-10: in the Claude case pass `metricsContext = { taskId: 'claude-failed-metric', phase: 'plan', iteration: 0 }` and an explicit `CANON_METRICS_FILE_OVERRIDE: path.join(dir, 'metrics.md')`. `runNodeInline` honors a provided value. Assert the file has a row matching `/\| claude-failed-metric \| plan \| claude \|.*\| failed \|/`. All of these fail pre-fix: exit 1, marker `code=1`, no `CAUGHT`, no metric row.

### Step 7: End-to-end park + recovery tests (AC-3, AC-4, AC-5)

Files: `tests/run-task-safety.test.ts`

Use the real-git review-loop harness: `makeGitFixture`, `writeReviewLoopFixture`, `setupInvocationLoggingCliTools`, `runReviewLoopMain` (which passes `--step`, `CANON_NO_DETACH`, `CANON_TASKS_DIR_OVERRIDE`). Mark these tests `{ concurrency: false }` like their siblings.

- **AC-3 + AC-5 (plan, one test).** Call `writeReviewLoopFixture(localDir, taskId, 'code_review', 0)`. That leaves spec, spec_review and plan `done` and implement `pending`. Then read `status.json` and set `phases.plan.status = 'pending'`; leave `implement` pending. Overwrite `fakeBins/claude` with a script that logs `claude` to `$FAKE_AGENT_LOG`, short-circuits `--version` like its siblings, and `exit 1`. Run `runReviewLoopMain(localDir, tasksRoot, fakeBins, taskId, 3)`. Assert:
  - `status === 2`;
  - `phases.plan.status === 'blocked'`, `phases.plan.auto_block_count === 1`;
  - `escalations.length === 1`, with `escalations[0].phase === 'plan'` and a reason matching `/claude session exited 1/` and `/canon run/`;
  - the marker line `/■ orchestrator exit code=2 \[reason=claude session exited 1/` appears in stderr;
  - stdout has `AGENT SESSION FAILED`.

  Recovery: overwrite `claude` with a script that writes a filled plan (`printf '# Plan\n\n1. Implement the change.\n' > "$CANON_TASKS_DIR_OVERRIDE/$FAKE_AGENT_TASK_ID/plan.md"`, the `writePopulatedPlan` content) and then runs `node "$FAKE_AGENT_COMPLETER"`. Run again with `{ FAKE_AGENT_COMPLETE_PHASE: 'plan' }` and no `canon task` reset between runs. Assert `status === 0`, `phases.plan.status === 'done'`, and derived `status === 'implement'`. Pre-fix this fails: the first run exits 1, plan stays `in_progress`, and there is no escalation.
- **AC-4 (implement stall).** Base it on `'main runs the first implement pass when MAX_REVIEW_LOOPS=0 on a genuinely fresh task'` (`:7036`): the same fixture, including its `## Validation Required` append. Overwrite `codex` with a script that logs and then `sleep 2`. Pass `{ PIPELINE_STALL_TIMEOUT_MS: '50' }`; `env.ts` reads it at module load, which is fine in the subprocess. Assert `status === 2`, `phases.implement.status === 'blocked'`, an escalation with `phase: 'implement'` and reason `/codex session stalled/`, and a reason without `CLAUDE_BUDGET` (judgment call 2).

### Step 8: Bundle partial-completion tests (AC-13)

Files: `tests/run-task-safety.test.ts`

Add a small helper beside `runReviewLoopMain`, for example `runBundleMain(repoDir, tasksRoot, fakeBins, taskIds, extraEnv)`. It is identical except that argv is `['node', 'canon', ...taskIds, '--step']`, `MAX_REVIEW_LOOPS: '3'`, and no `FAKE_AGENT_TASK_ID`. Do not change `runReviewLoopMain`'s signature, which has many callers.

Fixture: `makeGitFixture`, then `writeReviewLoopFixture(localDir, id, 'spec_review', 0, 0, true)` for `bundle-a` and `bundle-b`. That gives spec `done`, spec_review `pending`, `human_spec_gate: false`, and `worktree: false`.

- **Case 1 (throwing failure).** The `codex` fake logs, short-circuits `--version`, runs `FAKE_AGENT_TASK_ID=bundle-a FAKE_AGENT_COMPLETE_PHASE=spec_review node "$FAKE_AGENT_COMPLETER"`, then `kill -TERM $$`. The completer marks A `done`/`approved` and writes an approved `spec-review.md`. Assert:
  - `status === 2`;
  - both members have `phases.spec_review.status === 'blocked'`, so A was reopened even though `verdict` is still `approved`;
  - each has exactly one escalation with `phase: 'spec_review'`;
  - derived `status === 'spec_review'` for both.

  Then replace `codex` with a fake that runs the completer for A and then B (same env-prefix form) and exits 0. Run `runBundleMain` again and assert `status === 0`, stderr/stdout without `Bundle tasks are at different phases`, both `spec_review` `done`/`approved`, and derived `status === 'plan'` for both.
- **Case 2 (returning non-zero, Decision 5).** The fake completes A, then `exit 1`. `runCodex` returns, `spec-review.ts` post-processing leaves B's non-template `spec-review.md` alone, and `checkAndRoute` skips A (done) and parks at B. Assert `status === 2`, both `blocked` at `spec_review`, one `spec_review` escalation each, and the stderr warn names `canon run bundle-a bundle-b`.

Pre-fix, case 1 exits 1 with no park. Case 2 exits 2, but A is at `plan` and B is at `spec_review`, so the status assertions fail.

### Step 9: Crashed-spec_review assertions, non-agent errors, QA salvage (AC-8, AC-9, AC-6)

Files: `tests/run-task-safety.test.ts`

- **AC-8.** In `'checkAndRoute parks a crashed Codex spec_review before stale-verdict recovery'` (`:6699`), change the `status` assertion from `'in_progress'` to `'blocked'`. Add `auto_block_count === 1` and one escalation with `phase: 'spec_review'`, `iteration_count: 1` (the fixture's `current`) and a reason matching `/did not complete/` and `/canon run task-crash/`. Keep the verdict and counter assertions as they are: the park must not touch them. The self-bookkept and clean-exit tests (`:6748`, `:6773`) stay unchanged and must pass.
- **AC-9.** New test. Write a task at `plan` `in_progress` via `writeTaskStatus` with `escalations: []`. Run, through `runNodeInline` with `CANON_TASKS_DIR_OVERRIDE`:

  ```js
  import { registerExitHandlers } from './src/orchestrator/cli.js';
  import { withAgentSessionPark } from './src/orchestrator/main.ts';
  registerExitHandlers();
  withAgentSessionPark('plan', ['task-plain'], async () => { throw new Error('plain boom'); })
    .catch(err => { console.error(err instanceof Error ? err.stack ?? err.message : err); process.exit(1); });
  ```

  The `.catch` mirrors `run-task.ts`. Assert `status === 1`, stderr matches `/plain boom/`, the marker has `code=1` and does not match `/session|blocked/`, `phases.plan.status` is still `'in_progress'`, and `escalations` is empty. In the same test, add a positive control: throw `new AgentSessionError({ agent: 'claude', kind: 'exit_code', exitCode: 1, reason: 'claude session exited 1 (possible budget exhaustion — see CLAUDE_BUDGET)' })` on a fresh task. Assert exit `2`, `blocked`, and one escalation. This pins that the boundary discriminates by type, and that `main()` uses this same helper (Step 5c). Pre-fix, the import fails.
- **AC-6.** New test. Fixture: `makeGitFixture(dir)`, so `REPO_ROOT` resolves to `localDir` and `qa.ts`'s `donePath` (`activeCwd/tasks/<id>/done.md`) lands under the override root. Use `tasksRoot = path.join(localDir, 'tasks')` and a status with every phase before `qa` `done`, `qa` `pending`, no `branch`, and `worktree: false`. Do not create `done.md` (`isDoneMdTemplate` treats a missing file as a template). The `claude` fake runs `printf '# QA Summary\n\nAll checks passed.\n'` and then `exit 1`; that raw line is in `capturedStdout`, and `extractDoneMdFromStdout` would accept it. Script: `buildPipelineState([id])` from `main.ts`, then `try { await runQaPhase(state, false, null); console.log('returned'); } catch (err) { console.log('CAUGHT ' + JSON.stringify({ name: err.name, agent: err.agent, kind: err.kind })); }`, with `cwd: localDir`. Assert `status === 0`, `CAUGHT` with `AgentSessionError` / `claude` / `exit_code`, no `returned`, `done.md` absent, and `phases.qa.status === 'in_progress'` (not `done`). Note: pre-fix code also never salvages, because it exits first. This test guards the hazard (a fix that returns instead of throwing), not pre-fix behavior. The spec's AC-6 does not claim red-first.

### Step 10: Cold-Codex unit test (AC-7)

Files: `tests/run-task-code-review.test.ts`

Update `'runColdCodexReview reports unavailable when no findings output is captured'`, the `runCodeReviewPhase` + `coldSuccess: false` variant at `:1376`. Remove the `process.exit` stub, then:

```ts
await assert.rejects(
    () => runCodeReviewPhase(makeState(['task-a', 'task-b']), false, null, deps),
    (error: unknown) => isAgentSessionError(error) && error.agent === 'codex' && /cold-Codex review could not be obtained/.test(error.reason),
);
```

Import `isAgentSessionError` from `../src/orchestrator/agents/errors.js`. Keep the existing post-assertions: the events list, no `review-cold-codex*` files, `code_review` `in_progress` (the main loop is what parks it; the runner only throws), and `qa` `pending`. Leave `'HEAD must resolve before cold-Codex …'` (`:1636`, still exit 1) and the `runColdCodexReview` direct tests unchanged. There is no duplicate test name in the file, because the direct `runColdCodexReview` test at `:940` shares the title. Rename the `:1376` one to `'runCodeReviewPhase throws AgentSessionError when cold-Codex review is unavailable'` to remove the ambiguity.

### Step 11: Docs (AC-11)

Files: `docs/patterns.md`, `docs/pipeline-orchestrator.md`, `docs/architecture.md`, `.claude/skills/canon-pipeline/recovery.md`; mirrors regenerated.

- `docs/patterns.md` §"A non-zero agent exit is not a completed review — recovery must park, not read the artifact". Replace "while a crashed Claude exits before recovery" with the throw-and-park mechanism: a failed non-interactive session (spawn error, stall, signal, or a non-zero Claude exit) throws `AgentSessionError` from the wrapper. `main()`'s loop catches only that type around `runPhase()` + `checkAndRoute()`, parks the phase `blocked` via `autoBlockPhase()` and exits `2`, and no phase runner may catch it, because returning partial output would let QA salvage a truncated session. Add one sentence on the bundle rule: the park passes every member's id and reopens members that already finished the phase. That is safe only because no agent session runs after `checkAndRoute()`'s routing writes, and adding one would break it. The crashed Codex `spec_review` park now also records `blocked` + an escalation.
- `docs/pipeline-orchestrator.md` §"Phase Routing + Auto-Block". Add a short **Agent session failures park the phase.** paragraph before the crashed-spec_review one. It says: the phase becomes `blocked` with an escalation, the run exits `2` with a stop banner, and recovery is to fix the cause (auth, budget/credits, network) and then run `canon run <ids>`, with no phase reset. In a bundle every member is parked, including one that already finished the phase, and the re-run redoes the phase for the whole bundle. Interactive sessions still exit directly. In the "Crashed Codex `spec_review` parks" paragraph, say that it now records `spec_review` `blocked` with an escalation on every bundle member before exiting `2`. Also update the cold-Codex sentence (`:440`): "`code_review` stops before any Claude session" becomes "…parks `code_review` `blocked` with an escalation (exit `2`) before any Claude session", which keeps that restatement current.
- `docs/architecture.md` "Auto-block / reroute" (`:174`). "pushes an escalation, and exits with code 2" becomes "pushes an escalation; the caller then exits with code 2 (`autoBlockPhase()` itself only writes state)".
- `.claude/skills/canon-pipeline/recovery.md` "Agent auth 401 mid-pipeline". Replace the "roll it back first" block. The new text: the failed phase is parked `blocked` with an escalation; re-auth (`claude login` / `codex login`), then re-run the same `canon run <ids>`, with no manual phase reset. In a bundle, run all members together. Update the contents list entry only if its title changes; it should not need to.
- Run `npm run sync-templates`, then `npm run sync-templates:check`. The pre-commit hook may already mirror. `docs/patterns.md` and `docs/architecture.md` have scaffold copies under `templates/docs/` that differ by design. They are not mirrors: do not edit them.

### Step 12: Build and validate

`npm run build` (rebuilds the tracked `dist/cli/index.js` and `dist/orchestrator/run-task.js`), then `npm run type-check`, `npm run lint`, `npm test` (full suite), `npm run sync-templates:check`, `npm run docs-refs-check`. AC-1 structural check:
- `grep -n 'process.exit' src/orchestrator/agents/claude.ts` returns only the interactive line;
- `grep -n 'process.exit' src/orchestrator/agents/codex.ts` returns nothing;
- `grep -n 'process.exit(1)' src/orchestrator/phases/code-review.ts` returns only the HEAD-unresolvable path.

In a Claude worktree, run `npm ci` first. The one known baseline failure (run-task-safety linked-worktree guard message) is acceptable only if this diff doesn't touch it; report it as failing, not passing.

## Testing Plan

- **Unit:** AC-2/AC-10 (ladder throws + failed metric row), AC-9 (boundary discriminates by type), AC-6 (QA salvage unreachable), AC-7 (cold-Codex throw), AC-8 (crashed-spec_review durable park).
- **E2E (subprocess `main()` on a real git fixture):** AC-3 + AC-5 (plan park and plain re-run), AC-4 (implement stall park), AC-13 cases 1 and 2 (bundle reopen and bundle re-run past the same-phase check).
- **Manual:** the spec's Human Test Plan: sign the planning agent out mid-run, confirm the blocked banner and that `canon watch` reports `auto_block`, then sign back in and re-run.

## Rollback Plan

Code-only revert, no schema change. A park writes existing `blocked` / `auto_block_count` / `escalations[]` shapes, and reverted code still re-enters a `blocked` phase the same way (the runners set `in_progress`). Escalation entries already written by parks stay in `status.json` as history.
