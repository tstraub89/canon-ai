# Implementation Plan: preroute-review-loop-autoblock

> Written by: Claude | Implements: `tasks/preroute-review-loop-autoblock/spec.md`
> Spec verdict: approved_with_nits (Codex, round 4). The one nit — isolate the
> resume-order clause before applying AC-10's phase-name assertion — is
> resolved in Step 1 below by giving the clause a fixed, greppable prefix and
> extracting it with a capture group in every test, rather than a bare
> `\bphase\b` scan over the whole reason string (which would false-match
> `reset-spec-review`'s own word-boundary-anchored `spec` in *either* state).

## Approach

Two checkpoints already exist per loop (the review-phase entry, in
`spec-review.ts` / `code-review.ts`); they stay in place as a defense-in-depth
backstop (AC-11). Two new checkpoints get added at the top of each loop's
*revision* phase (`spec.ts` / `implement.ts`), landing after a
`changes_requested` verdict is recorded but before the next revision agent is
spawned. Both checkpoints per loop must share exactly one evaluator (AC-6) so
the threshold, counter formula, recovery text, and resume-order clause can
never disagree between the two call sites. `checkAndRoute()` and
`routeBackTo()` are **not** touched (AC-12) — `routeBackTo` is what persists
the continuation contract; this task only relocates *where the cap is
checked*, never *what happens after a `changes_requested` verdict*.

The evaluator is a pure function (`readonly TaskContext[]` + an explicit
`cap: number` in, a discriminated result out — no I/O, no env reads). Taking
the cap as a parameter rather than importing `getMaxReviewLoops` internally is
why `code-review.ts`'s existing `CodeReviewPhaseDeps.getMaxReviewLoops` test
seam keeps working unmodified — callers still resolve the cap themselves
(via `deps.getMaxReviewLoops` in `code-review.ts`, via the real
`getMaxReviewLoops` import everywhere else) and just hand it to the
evaluator.

## Steps

### Step 1: New module `scripts/run-task/review-loop.ts`

Files: `scripts/run-task/review-loop.ts` (new)

```ts
import type { TaskContext } from './types.js';

export type ReviewLoopResult =
    | { blocked: false; count: number }
    | { blocked: true; count: number; reason: string };

function specReviewIterations(t: TaskContext): number {
    // NOT TaskContext.iterations_current_loop — buildPipelineState() populates
    // that field from code_review only (main.ts:218-227). Reusing it here
    // would read the wrong loop and silently never block, or block on the
    // wrong signal (AC-7's inverse-case test guards this).
    return t.status.phases.spec_review?.iterations_current_loop
        ?? t.status.phases.spec_review?.iterations
        ?? 0;
}

function revisionPhaseNotDone(tasks: readonly TaskContext[], phase: 'spec' | 'implement'): boolean {
    // every(), not some() — docs/patterns.md "Bundle-gate conditions must use
    // every(), not some(), on per-task flags". A mixed bundle can't reach a
    // dispatch anyway (assertSamePhase() refuses it before any phase runs),
    // so this is belt-and-suspenders, not a live branch.
    return tasks.every(t => (t.status.phases[phase]?.status ?? 'pending') !== 'done');
}

// Fixed, greppable prefix so tests extract the phase name with a capture
// group instead of a bare `\bphase\b` scan over the whole reason string —
// that would false-match "reset-spec-review"'s own word-boundary-anchored
// "spec" in EITHER state (the round-1 spec_review nit).
function resumeOrderClause(
    revisionPhase: 'spec' | 'implement',
    reviewPhase: 'spec_review' | 'code_review',
    revisionNotDone: boolean,
): string {
    return revisionNotDone
        ? `Resuming after raising the cap runs \`${revisionPhase}\` first — the deferred revision — then \`${reviewPhase}\` again.`
        : `Resuming after raising the cap runs \`${reviewPhase}\` directly; \`${revisionPhase}\` already completed its revision.`;
}

function buildSpecReviewReason(taskIds: string[], count: number, cap: number, revisionNotDone: boolean): string {
    const resetCommands = taskIds.map(id => `canon task reset-spec-review ${id}`).join('; ');
    const resumeClause = resumeOrderClause('spec', 'spec_review', revisionNotDone);
    return (
        `Spec review hit ${count} changes_requested iterations in a row (limit: ${cap}). ` +
        `Pipeline auto-blocked before the next spec revision. Read the latest spec-review.md: ` +
        `if review is still converging (each round narrows on distinct, legitimate findings), ` +
        `raise the cap and continue — MAX_REVIEW_LOOPS=<n> canon run ${taskIds.join(' ')} --step. ` +
        `Only rescope if prior iterations no longer apply — run ${resetCommands} to archive the ` +
        `prior review, clear the loop counters, and drop the stored Claude session. ${resumeClause}`
    );
}

function buildCodeReviewReason(
    worst: { taskId: string; real: number; preflight: number; combined: number },
    taskIds: string[],
    cap: number,
    revisionNotDone: boolean,
): string {
    const resetCommands = taskIds.map(id => `canon task reset-code-review ${id}`).join('; ');
    const resumeClause = resumeOrderClause('implement', 'code_review', revisionNotDone);
    return (
        `Code review hit ${worst.combined} attempts in a row for task ${worst.taskId} ` +
        `(${worst.real} reviewer rounds + ${worst.preflight} pre-flight rejections; limit: ${cap}). ` +
        `Pipeline auto-blocked before the next re-implementation. If the same finding keeps ` +
        `recurring, raise the cap and continue — MAX_REVIEW_LOOPS=<n> canon run ${taskIds.join(' ')} --step ` +
        `— rather than another implementation pass. If repeated failures were all pre-flight, the ` +
        `handoff format itself may be wrong. To rescope instead: run ${resetCommands} to archive the ` +
        `prior review and clear the loop-local counters. ${resumeClause}`
    );
}

export function evaluateSpecReviewLoop(tasks: readonly TaskContext[], cap: number): ReviewLoopResult {
    const count = tasks.reduce((max, t) => Math.max(max, specReviewIterations(t)), 0);
    if (count < cap) return { blocked: false, count };
    const taskIds = tasks.map(t => t.taskId);
    const revisionNotDone = revisionPhaseNotDone(tasks, 'spec');
    return { blocked: true, count, reason: buildSpecReviewReason(taskIds, count, cap, revisionNotDone) };
}

export function evaluateCodeReviewLoop(tasks: readonly TaskContext[], cap: number): ReviewLoopResult {
    // Per-task combined attempts, THEN max across tasks — never max-iter +
    // max-preflight computed separately across different tasks (AC-7; a
    // prior Codex P2 finding on the formula this replaces).
    const perTask = tasks.map(t => {
        const preflight = t.status.phases.code_review?.preflight_rejections_current_loop ?? 0;
        return { taskId: t.taskId, real: t.iterations_current_loop, preflight, combined: t.iterations_current_loop + preflight };
    });
    const worst = perTask.reduce((worst, curr) => curr.combined > worst.combined ? curr : worst, perTask[0]);
    if (worst.combined < cap) return { blocked: false, count: worst.combined };
    const taskIds = tasks.map(t => t.taskId);
    const revisionNotDone = revisionPhaseNotDone(tasks, 'implement');
    return { blocked: true, count: worst.combined, reason: buildCodeReviewReason(worst, taskIds, cap, revisionNotDone) };
}
```

Notes:
- `ReviewLoopResult` always carries `count`, blocked or not. `code-review.ts`
  needs the combined-attempts number on the non-blocking path too, for the
  unrelated pre-flight-infrastructure auto-block's `iteration_count` argument
  (Step 2) — this removes the need for a second, separate
  `perTaskCombined`/`worstTask` computation there.
- Do not export the `build*Reason` / `resumeOrderClause` helpers unless a
  test genuinely needs them directly; every AC exercises them through the two
  `evaluate*` functions.
- AC-6(a)'s grep ("exactly one template-literal definition site per loop for
  `Spec review hit` / `Code review hit`") is satisfied because those strings
  now only live in this file — `spec.ts`, `spec-review.ts`, `implement.ts`,
  `code-review.ts` must not inline reason text after this change.

### Step 2: Rewire the review-entry backstops onto the shared evaluator

Files: `scripts/run-task/phases/spec-review.ts`, `scripts/run-task/phases/code-review.ts`

**`spec-review.ts`**: replace the `maxSpecIter`/`specReviewLoopCap` cap-check
block (current lines 90-114) with:

```ts
const maxSpecIter = tasks.reduce(
    (max, t) => Math.max(
        max,
        t.status.phases.spec_review?.iterations_current_loop
            ?? t.status.phases.spec_review?.iterations
            ?? 0,
    ),
    0,
); // still needed below for the `iteration:` metrics field on the runCodex call
const specReviewCheck = evaluateSpecReviewLoop(tasks, getMaxReviewLoops(tasks));
if (specReviewCheck.blocked) {
    warn(specReviewCheck.reason);
    autoBlockSpecReview(taskIds, specReviewCheck.count, specReviewCheck.reason);
    process.exit(2);
}
```

Add `import { evaluateSpecReviewLoop } from '../review-loop.js';`. Keep
`autoBlockSpecReview()` (line 14) and its role unchanged — the new
revision-entry checkpoint in `spec.ts` calls `autoBlockPhase` directly
instead (matching the Decision: "the escalation and `auto_block_count` stay
on the review phase that looped").

**`code-review.ts`**: replace the `maxIter`/`perTaskCombined`/`worstTask`/
`codeReviewLoopCap` cap-check block (current lines ~237-271) with:

```ts
const maxIter = tasks.reduce((max, t) => Math.max(max, t.iterations_current_loop), 0);
const codeReviewCheck = evaluateCodeReviewLoop(tasks, deps.getMaxReviewLoops(tasks));
if (codeReviewCheck.blocked) {
    warn(codeReviewCheck.reason);
    autoBlockPhase(taskIds, 'code_review', codeReviewCheck.count, codeReviewCheck.reason);
    process.exit(2);
}
```

Then, at the separate pre-flight-infrastructure auto-block further down
(current line ~306: `autoBlockPhase(taskIds, 'code_review', worstTask.combined, reason)`),
change `worstTask.combined` → `codeReviewCheck.count`. That reason string
itself (and every other line in that block) is unchanged — Non-Goals: "No
change to... the pre-flight-infrastructure auto-block."

Add `import { evaluateCodeReviewLoop } from '../review-loop.js';`. Keep
`deps.getMaxReviewLoops(tasks)` as the cap source — calling the real
`getMaxReviewLoops` directly instead would silently stop the existing
`CodeReviewPhaseDeps` test seam (`makeDeps()` in
`tests/run-task-code-review.test.ts`) from controlling the cap.

### Step 3: New revision-entry checkpoints

Files: `scripts/run-task/phases/spec.ts`, `scripts/run-task/phases/implement.ts`

**`spec.ts`**: add imports — `warn` (alongside the existing `info` from
`'../cli.js'`), `getMaxReviewLoops` (alongside `getClaudeConfig` from
`'../policy.js'`), `autoBlockPhase` from `'../state.js'`,
`evaluateSpecReviewLoop` from `'../review-loop.js'`. At the very top of
`runSpecPhase()`, before `hasChangesRequested` is computed:

```ts
export async function runSpecPhase(
    state: PipelineState,
    interactive: boolean,
    resumeId: string | null,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);

    const specReviewCheck = evaluateSpecReviewLoop(tasks, getMaxReviewLoops(tasks));
    if (specReviewCheck.blocked) {
        warn(specReviewCheck.reason);
        autoBlockPhase(taskIds, 'spec_review', specReviewCheck.count, specReviewCheck.reason);
        process.exit(2);
    }

    const hasChangesRequested = tasks.some(t => t.specReviewVerdict === 'changes_requested');
    ...
```

Self-gating (AC-13): on a genuine first-time spec write the loop-local
counter is `0`, always below cap, so this is a no-op. It only trips once the
loop has actually reached cap, which requires real prior `changes_requested`
iterations.

**`implement.ts`**: add imports — `getMaxReviewLoops` (alongside
`getCodexConfig` from `'../policy.js'`), `evaluateCodeReviewLoop` from
`'../review-loop.js'` (`warn` and `autoBlockPhase` are already imported). At
the very top of `runImplementPhase()`, before `commitTaskArtifactsToBase`
and `ensureBranch`:

```ts
export async function runImplementPhase(
    state: PipelineState,
    interactive: boolean,
    resumeId: string | null,
    force = false,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);

    const codeReviewCheck = evaluateCodeReviewLoop(tasks, getMaxReviewLoops(tasks));
    if (codeReviewCheck.blocked) {
        warn(codeReviewCheck.reason);
        autoBlockPhase(taskIds, 'code_review', codeReviewCheck.count, codeReviewCheck.reason);
        process.exit(2);
    }

    const primaryStatus = readStatus(taskIds[0]);
    ...
```

Placement above `commitTaskArtifactsToBase`/`ensureBranch` is load-bearing —
do not move it below either call (AC-2's "no commit created on the base
branch" assertion; Known Risks "side effects above the guard").

Both checkpoints call `autoBlockPhase` directly against the **review**
phase, not the revision phase itself. Because the block `process.exit(2)`s
before `taskPhase(t.taskId, 'spec'|'implement', 'in_progress')` ever runs,
the revision phase stays `'pending'` and `deriveTopLevelStatus()` derives it
as current with no new `status.json` field (AC-3).

### Step 4: Widen `taskResetCodeReview()`'s precondition

Files: `src/task/index.ts` (function at line 1074)

Current:

```ts
const currentPhase = deriveTopLevelStatus(status);
if (currentPhase !== 'code_review') {
    throw new Error(`Error: reset-code-review only operates on tasks currently at code_review. Current phase: ${currentPhase}.`);
}
```

Change to:

```ts
const currentPhase = deriveTopLevelStatus(status);
const blockedAtImplementEntry = currentPhase === 'implement' && status.phases.code_review?.status === 'blocked';
if (currentPhase !== 'code_review' && !blockedAtImplementEntry) {
    throw new Error(`Error: reset-code-review only operates on tasks currently at code_review. Current phase: ${currentPhase}.`);
}
```

And just before the existing `codeReview.status = 'pending'` write, add the
mirror of `taskResetSpecReview()`'s `spec.status = 'done'` write:

```ts
const implement = ensurePhaseEntry(status, 'implement');
implement.status = 'done';
```

This is a no-op whenever `currentPhase` already derives `code_review` (that
state already has `implement.status === 'done'`), so the two existing tests
at `tests/task-cli.test.ts:850` and `:895` must keep passing **unmodified**
— do not edit those tests. Error message text, archive behavior, and every
other counter reset are unchanged.

## Testing Plan

### Unit: `tests/run-task-review-loop.test.ts` (new file)

Import `evaluateSpecReviewLoop`/`evaluateCodeReviewLoop` from
`'../scripts/run-task/review-loop.js'`. These are pure functions — build
`TaskContext[]` fixtures by hand (no filesystem needed), following the shape
of `taskContext()`/`makeState()` in `tests/run-task-code-review.test.ts:109-130`.

- **AC-6(c)**: for each evaluator — cap−1 → `blocked: false`; cap →
  `blocked: true`; cap+1 → `blocked: true`.
- **AC-6(d)**: call each evaluator twice, identical inputs except the
  revision phase's status (`'pending'` vs `'done'`). Assert every component
  of the reason matches except the resume-order clause (same iteration
  count, same cap, same reset command(s), same relative ordering) — verify
  this by stripping the clause (everything from `Resuming after raising the
  cap runs` to the end) from both reasons and asserting the remainders are
  equal, then assert the clauses differ per AC-10 below.
- **AC-7 (code_review formula)**: two-task bundle, task A `(2 iterations, 0 preflight)`,
  task B `(0 iterations, 2 preflight)`, cap `3` → `blocked: false` (worst
  combined is `2`, not `2+2=4` mixed across tasks). Single task
  `(2 iterations, 1 preflight)`, cap `3` → `blocked: true`.
- **AC-7 (spec_review counter source)**: a fixture with
  `status.phases.spec_review.iterations_current_loop` at cap while the
  `TaskContext.iterations_current_loop` field (code_review-sourced) is `0`
  still blocks `evaluateSpecReviewLoop`; the inverse (`code_review` at cap,
  `spec_review` at `0`) does not.
- **AC-8**: for each evaluator's blocked reason, assert
  `reason.indexOf('MAX_REVIEW_LOOPS') < reason.indexOf('reset-spec-review')`
  (or `'reset-code-review'`).
- **AC-9**: assert neither reason matches `/iterations_current_loop\s*=/` or
  `/phases\.\w+\.status\s*=/`.
- **AC-10 (and the nit fix)**: extract the clause with
  `reason.match(/Resuming after raising the cap runs `([a-z_]+)`/)` and
  assert the captured group is `'spec'` (revision phase not done) or
  `'spec_review'` (revision phase done) — never a bare `/\bspec\b/` test
  against the whole reason (it would also match inside `reset-spec-review`
  in both states and pass vacuously — the spec_review round-1 nit). Mirror
  for `'implement'` / `'code_review'`.
- **AC-13 (loop-local-only)**: both evaluators return `blocked: false` when
  the loop-local counters (`iterations_current_loop`,
  `preflight_rejections_current_loop`) are `0`, even when `iterations_total`
  (or `preflight_rejections_total`) is at or above cap.

### Unit: `tests/task-cli.test.ts` (AC-16)

Add near the existing reset-code-review tests (~lines 850-910):

- **AC-16(a)**: fixture matching the AC-2/AC-3 post-block shape —
  `implement.status = 'pending'`, `code_review.status = 'blocked'` with
  `iterations_current_loop`/`preflight_rejections_current_loop`/
  `iterations_total`/`auto_block_count` populated. Call
  `taskCmd(['reset-code-review', <id>])`; assert no throw, and the AC-16(a)
  end state: `implement.status === 'done'`, `code_review.status === 'pending'`,
  loop-local counters all `0`, `verdict === ''`, `iterations_total`/
  `auto_block_count` unchanged, `review.md` archived to `review-prior-1.md`,
  `sessions.claude_review` absent, top-level `status === 'code_review'`.
- **AC-16(b)**: confirm the existing tests at lines 850 and 895 still pass
  without modification.
- **AC-16(c)**: fixture with `implement.status` not done (e.g.
  `'in_progress'`) and `code_review.status === 'pending'` (not `'blocked'`).
  Assert `taskResetCodeReview` still throws `/only operates on tasks
  currently at code_review/`.

### Unit: `tests/run-task-code-review.test.ts` (AC-11 code_review half)

Follow the existing deps-injection + `process.exit` patch pattern (lines
158-172 `isProcessExitError`; lines 564-577 the cold-Codex-unavailable
test). Fixture: `implement.status = 'done'`, `code_review.status = 'pending'`
with `iterations_current_loop`/`preflight_rejections_current_loop` summing
to a cap injected via `makeDeps({ ..., })`'s `getMaxReviewLoops: () => <cap>`
(no real env-var manipulation needed). Patch `process.exit`, call
`runCodeReviewPhase(makeState([taskId]), false, null, deps)`, assert
`isProcessExitError(error, 2)`, that `deps.runColdCodexReview`/`deps.runClaude`
were never invoked, `readStatus(taskId).phases.code_review.status === 'blocked'`
with top-level `status === 'code_review'`, and that the persisted
`escalations[].reason` clause capture-group equals `'code_review'` (not
`'implement'` — it must not promise a revision runs first).

### Integration: `tests/run-task-safety.test.ts` (AC-1, AC-2, AC-3, AC-4, AC-5, AC-10(a), AC-11 spec_review half, AC-17)

Add an invocation-logging variant alongside `setupFakeCliTools` (line 208).
The stub agents must not just log — for AC-4's "raised cap, resume runs the
deferred revision" case, the stub must let the phase reach `'done'` cleanly
in one invocation, or `checkAndRoute`'s generic pre-switch recovery loop
(`main.ts:3030-3062`, which runs for *every* phase, not only
spec_review/code_review) attempts a one-shot retry and invokes the agent a
second time — breaking the "exactly one invocation" assertion. Have the fake
`claude`/`codex` binary patch `tasks/<id>/status.json` directly (Node is
already available in the test process) to flip the relevant phase to
`'done'` after logging its own invocation, keyed by env vars the test sets
per-run (task ID, phase name, log path). For AC-1/AC-2/AC-5 (block without
raising the cap), no change to the fake binary is needed — the checkpoint
exits before the agent is ever spawned, so the log stays empty by
construction.

Use `writeReviewRecoveryTask()` (line 531) as a starting point for fixtures
— it builds a `spec_review`/`code_review` phase entry with configurable
counters and a matching verdict artifact. Check what it currently leaves the
*revision* phase (`spec`/`implement`) status as, and build a small local
variant if it doesn't already leave it `'pending'` (the post-`routeBackTo`
state this task's checkpoints assume) — don't modify the shared helper,
other tests depend on its current shape.

- **AC-1**: `spec.status='pending'`, `spec_review.status='pending'` with
  `iterations_current_loop` at the tier cap. Run `main()`. Assert:
  fake-agent log absent/empty, exit `2`, `phases.spec_review.status ===
  'blocked'`, one new `escalations` entry with `phase: 'spec_review'`.
- **AC-2**: analogous with `implement.status='pending'`, two cases — (a)
  `code_review.iterations_current_loop` at cap,
  `preflight_rejections_current_loop: 0`; (b) `iterations_current_loop: 1`,
  `preflight_rejections_current_loop` summing to cap. Same assertions, plus:
  no commit landed on the base branch (check the fake-git invocation log for
  no `commit`, or that the base branch tip SHA is unchanged).
- **AC-3**: on the same AC-1/AC-2 runs, assert top-level `status === 'spec'`
  / `'implement'` and `phases.spec.status === 'pending'` /
  `phases.implement.status === 'pending'`.
- **AC-4**: from the AC-1/AC-2 post-block fixtures, set `MAX_REVIEW_LOOPS`
  one above the recorded count, run with `--step`. Use two *separate copies*
  of the fixture (order-independence matters here) — one asserts `--expect
  spec` doesn't die, the fake-agent log records exactly one invocation, and
  `phases.spec_review.status` is still `'blocked'`; the other asserts
  `--expect spec_review` dies with `--expect spec_review but current phase
  is spec` (mirror `main.ts:3457`'s format). Mirror both for the code loop
  (`--expect implement` / `--expect code_review`).
- **AC-5**: re-run `main()` on the AC-1/AC-2 blocked fixtures with the
  original cap. Assert exit `2`, fake-agent log still empty, second
  `escalations` entry appended.
- **AC-10(a)**: on the AC-1/AC-2 fixtures, read the persisted
  `escalations[].reason` and assert the capture-group match equals `'spec'`
  / `'implement'`.
- **AC-11 (spec_review half)**: fixture shaped like the post-revision state
  — `spec.status='done'`, `spec_review.status='pending'` at the cap (this is
  what `writeReviewRecoveryTask()` already produces unmodified). Run
  `main()`, assert exit `2`, fake-agent log absent, `phases.spec_review.status
  === 'blocked'`, top-level `status === 'spec_review'`, and the persisted
  reason's clause capture-group equals `'spec_review'` (not `'spec'`).
- **AC-17**: within the *same test and fixture* as AC-1/AC-2 (not a fresh
  copy — the requirement is exercising the reset against the genuinely-
  persisted post-block state), after the blocked `main()` run exits, import
  `taskCmd` from `'../src/task/index.js'` and call
  `taskCmd(['reset-spec-review', taskId])` / `taskCmd(['reset-code-review', taskId])`
  in-process with `CANON_TASKS_DIR_OVERRIDE` still pointed at the fixture.
  Assert no throw and the expected end states (mirrors `taskResetSpecReview`'s
  contract / AC-16(a)).

### Integration: `tests/run-task-reroute-preflight.test.ts` (AC-13 reroute-inertness half)

Add near the existing `rerouteFromHumanReview` tests (~lines 620-733): after
`rerouteFromHumanReview()` on a fixture with `code_review.iterations_total`
at or above cap, assert entering `implement` does not block, because the
reroute already zeroed `iterations_current_loop`/
`preflight_rejections_current_loop` (`main.ts:2461-2500`) — which is what
the evaluator actually reads. Reuse the file's existing reroute fixture
helpers.

### Regression check (AC-12, no code change)

Confirm `grep -n "getMaxReviewLoops\|evaluateSpecReviewLoop\|evaluateCodeReviewLoop" scripts/run-task/main.ts`
returns nothing inside `checkAndRoute`, and that
`"checkAndRoute preserves non-reroute spec_review changes_requested routing
back to spec"` (`tests/run-task-reroute-preflight.test.ts:774`) passes
unmodified — true by construction since this task never edits `main.ts`.

### Docs (AC-14, AC-15)

- `docs/BACKLOG.md`: add one entry under `## 🐛 Harness Bugs` (line 852)
  recording the `promptSpecRevision` unreachability from the spec's
  *Problem* section — mechanism (`routeBackTo` clears
  `spec_review.verdict` before `phases/spec.ts:17` reads it), evidence
  (`.canon-run.log` lines 36/155 both printing the first-write label for
  revision rounds), suggested fix (mirror `shouldUseImplementRevision()`'s
  counter-based signal). Documentation only. Verify with `npm run
  docs-refs-check`.
- `docs/pipeline-orchestrator.md`: (1) update the "Auto-block on runaway
  loops" paragraph (currently line 358) to an at-or-above-cap phrasing and
  state the check now fires at the revision phase's entry for both loops,
  with the review-phase-entry check as a backstop; (2) update the recovery
  block (currently lines 366-372) to describe the revision-entry block's
  resume order, that resuming without raising the cap re-blocks for free,
  add a `canon task reset-spec-review <id>` line paralleling the existing
  `reset-code-review` line, and state both reset commands run directly from
  the block state. Then `npm run sync-templates` (regenerates
  `templates/docs/pipeline-orchestrator.md`) and `npm run
  sync-templates:check`.

### Manual

Follow the spec's Human Test Plan steps 1-9 against a real (or
size-lowered) task once the automated suite is green — drive both loops to
cap via repeated `changes_requested`, confirm the block message's two
recovery options and resume-order line, confirm raise-and-resume runs the
revision first, and confirm each reset command works directly from the
blocked state.

## Validation (run last, in order)

```bash
npm run lint
npm run type-check
npm test
npm run build   # scripts/run-task/** bundles into dist/scripts/run-task.js — required, CI diffs dist/
npm run docs-refs-check
npm run sync-templates:check
```

## Rollback Plan

Pure relocation/addition — no `status.json` schema change, no removed
capability. Revert is a plain `git revert` of the task's commit(s): the two
new checkpoints and the widened `reset-code-review` precondition disappear,
the review-entry backstops and `checkAndRoute`/`routeBackTo` are untouched
throughout, so no data migration or in-flight-task concern. A task already
blocked at a revision-phase entry when the revert lands would simply fall
through to the (still-present) review-entry backstop the next time it
reaches that phase — never crash-loop.

## Reroute Plan

Human reroute: code review round 2 returned `spec_gap` (all 17 original ACs
met; R2-1/R2-2/R2-3 + F11/F13 needed a product decision the implementer
couldn't make). The spec amendment (AC-18–AC-24) closed that gap through
7 further amendment-review rounds and is now `approved_with_nits` — the one
nit (AC-20's fixture count/labeling) is cosmetic and folded into Step 7
below. Steps 1–4 above are already implemented and merged into the current
tree (`scripts/run-task/review-loop.ts`, the revision-entry checkpoints in
`spec.ts`/`implement.ts`, the review-entry backstops in
`spec-review.ts`/`code-review.ts`, and `taskResetCodeReview()`'s widened
precondition all exist and pass their ACs per `handoff.md`). This section
plans only the amendment delta: AC-18/19 (`taskAccept`), AC-20 (`canon
watch`), AC-21 (`MAX_REVIEW_LOOPS` validation), AC-24/F11 (drop `--step`),
and F13 (stale operator guidance). It was written against the actual current
source (not the original spec's pseudocode), confirmed by reading
`src/task/index.ts`, `src/cli/commands/watch.ts`, `scripts/run-task/policy.ts`,
`scripts/run-task/env.ts`, `scripts/run-task/review-loop.ts`,
`docs/pipeline-orchestrator.md`, `.claude/skills/canon-pipeline/recovery.md`,
`docs/architecture.md`, and `docs/product-context.md`.

One correction to `handoff.md`'s "Blockers" section while reading it: it
documents Iteration 2's fixes for F1/F3/F4/F5 against the *original* spec's
round-1 code-review findings, plus F2/F13 recorded as blocked pending this
amendment. That work (including `taskResetCodeReview()`'s
`implement.status === 'pending'` narrowing) is already in the tree and
unaffected by the steps below except where a step explicitly touches the
same file.

### Step 5: `taskAccept` — derive "Next phase" from state, widen the forced-write predicate (AC-18, AC-19)

Files: `src/task/index.ts` (the `spec_review`/`code_review` branch of
`taskAccept`, currently lines 677–819)

Today, lines 812–817 hardcode the resume message from `phaseArg` alone:

```ts
const label = ids.length === 1 ? ids[0] : `[${ids.join(', ')}]`;
const nextPhase = phaseArg === 'spec_review' ? 'plan' : 'qa';
console.log(
    `Accepted ${label}: ${phaseArg} → done.` +
    `\n  Next phase: ${nextPhase}. Run \`canon run ${ids.join(' ')}\` to continue.`
);
return;
```

That is false once a loop-cap block leaves the *revision* phase (`spec` /
`implement`) pending and current — accepting `code_review` there should
report `implement` as next, not `qa`, unless the accept also marks
`implement` done (the AC-18 mirror write).

**5a. Compute the mirror-write decision and the projected next phase per task, before any write happens.** Insert this pre-pass after the `verdictlessTasks` check (~line 720) and before `headRevParse` (~line 722) — it only reads `ctx.status`, which is still untouched at this point:

```ts
const precedingPhase: Phase = phaseArg === 'spec_review' ? 'spec' : 'implement';

const mirrorPlanByTask = new Map<string, { mirrorDone: boolean; projectedNextPhase: Phase }>();
for (const ctx of ctxByTask.values()) {
    const reviewWasBlocked = (ctx.status.phases[phaseArg]?.status ?? 'pending') === 'blocked';
    const precedingIsPending = (ctx.status.phases[precedingPhase]?.status ?? 'pending') === 'pending';
    const precedingIsCurrent = deriveTopLevelStatus(ctx.status) === precedingPhase;
    const mirrorDone = reviewWasBlocked && precedingIsPending && precedingIsCurrent;

    // Project the post-write derived phase WITHOUT mutating the real status —
    // the bundle-divergence check below must be able to refuse before any
    // file is written.
    const projected: StatusJson = structuredClone(ctx.status);
    ensurePhaseEntry(projected, phaseArg).status = 'done';
    if (mirrorDone) ensurePhaseEntry(projected, precedingPhase).status = 'done';
    mirrorPlanByTask.set(ctx.id, { mirrorDone, projectedNextPhase: deriveTopLevelStatus(projected) });
}

const projectedPhases = new Set([...mirrorPlanByTask.values()].map(p => p.projectedNextPhase));
if (projectedPhases.size > 1) {
    const detail = [...ctxByTask.keys()]
        .map(id => `${id}=${mirrorPlanByTask.get(id)!.projectedNextPhase}`)
        .join(', ');
    throw new Error(
        `Error: bundled accept would leave tasks at different next phases (${detail}). ` +
        `Run accept separately for the tasks that diverge.`
    );
}
```

This is the exact predicate from the Decision text: preceding phase both
`pending` *and* the task's derived current phase — not "not done" (which
would also match `in_progress`, the AC-20 healthy-resume shape, and would
mis-fire on a bundle with two-or-more incomplete phases where
`deriveTopLevelStatus` already points at an *earlier* one). `structuredClone`
is a Node global (available in this repo's Node target) — if `type-check`
flags it, fall back to `JSON.parse(JSON.stringify(ctx.status))`.

**5b. Apply the mirror write inside the existing write loop.** In the
`try { for (const ctx of ctxByTask.values()) { ... } }` block (~lines
748–765), after `reviewEntry.status = 'done';` and before
`writeStatusAtomic`:

```ts
const plan = mirrorPlanByTask.get(ctx.id)!;
if (plan.mirrorDone) {
    ensurePhaseEntry(ctx.status, precedingPhase).status = 'done';
}
```

Outside the `mirrorDone` predicate this changes nothing — the loop still
writes only the accepted phase's own entry, matching AC-19's "unchanged
write behavior outside the two named exceptions."

**5c. Derive the printed message from real post-write state**, replacing
lines 812–817:

```ts
const label = ids.length === 1 ? ids[0] : `[${ids.join(', ')}]`;
const nextPhase = deriveTopLevelStatus(ctxByTask.get(ids[0])!.status);
console.log(
    `Accepted ${label}: ${phaseArg} → done.` +
    `\n  Next phase: ${nextPhase}. Run \`canon run ${ids.join(' ')}\` to continue.`
);
```

`ctx.status` objects were mutated in place by the write loop (5b), so
reading `deriveTopLevelStatus` on any bundle member here reflects the true
post-write state — already validated identical across the bundle in 5a, so
picking `ids[0]` is safe. This is a strict generalization of today's ternary
(AC-19): every state the ternary handled today still derives the same
value; the AC-18 states are simply the first ones where they'd have
disagreed.

Trace through the ACs against this design: AC-18(a) (`implement='pending'`
+ current, `code_review='blocked'`) → `mirrorDone=true` →
`implement.status` becomes `done`, message says `qa`. AC-18(b)
(`implement='in_progress'`) → `precedingIsPending` false → `mirrorDone=false`
→ no extra write, message derives `implement` (still not done) — pin this
as the expected text, not "unchanged." AC-18(c) (`plan='pending'`,
`implement='pending'`, `code_review='blocked'`) → `precedingIsCurrent` false
(`deriveTopLevelStatus` returns `plan`, not `implement`) → `mirrorDone=false`
→ message derives `plan`. AC-18(d) (bundle divergence) → the 5a check throws
before the write loop ever runs — no file touched for any task in the
bundle.

### Step 6: `canon watch` — gate block/settlement on orchestrator liveness, not phase identity (AC-20)

Files: `src/cli/commands/watch.ts`

Confirmed against the current source: `classifyAttach()` (lines 266–318)
and `classifyIdle()` (lines 320–389) both check `findFirstBlockedPhase()`
*before* `ctx.ambiguousPid` (lines 280–283/285–292 and 330–333/335–342) —
this is the precedence bug the amendment's R2-2/finding-9 rounds converged
on reordering. `isPhaseSettled()` (lines 97–100) treats any `blocked` entry
as settled with no liveness check at all. `orchestratorStillProgressing()`
(lines 407–416) already gates on `probeAlive` first, but its line 413
(`if (findFirstBlockedPhase(status)) return false;`) still short-circuits a
confirmed-live process to "not progressing" whenever any phase is blocked.

**6a. Reorder + liveness-gate `classifyAttach()`.** Replace lines 280–292
(current: blocked-check then ambiguous-check) with ambiguous-check first,
then a liveness-gated blocked-check:

```ts
// Ambiguity must be resolved before block classification (fixture E) — a
// blocked marker plus two disagreeing live PIDs must refuse to attach, not
// report a terminal auto-block.
if (ctx.ambiguousPid != null) {
    return {
        kind: 'ambiguous_pid',
        state,
        canonPid: ctx.ambiguousPid.canonPid,
        heartbeatPid: ctx.ambiguousPid.heartbeatPid,
    };
}

const blockedPhase = status ? findFirstBlockedPhase(status) : null;
const orchestratorLive = ctx.resolvedPid != null && probeAlive(ctx.resolvedPid);
if (blockedPhase && !orchestratorLive) {
    return { kind: 'auto_block', state: 'blocked', phase: blockedPhase };
}
```

Everything below (the `live` check, `launchWindow`, the `in_progress` →
`death` fallback, `nothing_to_watch`) is unchanged — a blocked phase with a
live orchestrator now simply falls through to those existing checks instead
of short-circuiting to `auto_block`. Because ambiguity is ruled out first,
`ctx.resolvedPid == null` inside `orchestratorLive` unambiguously means "no
pid," not "ambiguous" (per the Decision text — `ctx.ambiguousPid` no longer
needs to appear in this specific condition).

**6b. Mirror the same reorder in `classifyIdle()`** (lines 330–342): move
the `ctx.ambiguousPid` check first, then gate the `findFirstBlockedPhase`
check the same way. `classifyIdle` has no `probeAlive` parameter today —
add one, defaulted so every existing call site that doesn't pass it
preserves today's "any block → auto_block" behavior unchanged:

```ts
export function classifyIdle(
    ctx: RunContext,
    _taskId: string,
    probeAlive: (pid: number) => boolean = () => false,
): IdleClassification {
    ...
    if (ctx.ambiguousPid != null) {
        return { kind: 'ambiguous_pid', state, canonPid: ctx.ambiguousPid.canonPid, heartbeatPid: ctx.ambiguousPid.heartbeatPid };
    }
    const blockedPhase = findFirstBlockedPhase(status);
    const orchestratorLive = ctx.resolvedPid != null && probeAlive(ctx.resolvedPid);
    if (blockedPhase && !orchestratorLive) {
        return { kind: 'auto_block', state: 'blocked', phase: blockedPhase, pid: ctx.resolvedPid ?? undefined };
    }
    ...
```

Update the real call site (line 663) to pass the live probe:
`classifyIdle(freshCtx, taskId, pid => probePidAlive(pid, deps.probeAliveImpl))`.
Check `tests/watch.test.ts`'s existing `classifyIdle(ctx, 't1')` call sites
(lines 249–338) — they omit the third argument and must keep passing
unmodified against the default (no live PID assumed).

**6c. Liveness-gate `isPhaseSettled()` / `phaseSettled()`** (lines 97–100,
391–397), consumed by every `--until` check (lines 531, 597, 653):

```ts
function isPhaseSettled(status: StatusJson, phase: Phase, orchestratorLive: boolean): boolean {
    const phaseStatus = status.phases[phase]?.status ?? 'pending';
    if (phaseStatus === 'done' || phaseStatus === 'changes_requested') return true;
    if (phaseStatus === 'blocked') return !orchestratorLive;
    return false;
}

function phaseSettled(ctx: RunContext, phase: Phase, probeAlive: (pid: number) => boolean): boolean {
    const status = ctx.statusResult.kind === 'ok' && isStatusJson(ctx.statusResult.status) ? ctx.statusResult.status : null;
    if (status == null) return false;
    const live = ctx.resolvedPid != null && probeAlive(ctx.resolvedPid);
    return isPhaseSettled(status, phase, live);
}
```

Update all three `phaseSettled(ctx, parsed.untilPhase)` call sites (lines
531, 597, 653) to pass a probe: `phaseSettled(ctx, parsed.untilPhase, pid =>
probePidAlive(pid, deps.probeAliveImpl))`. Since this probe closure is now
needed at 4+ call sites (`classifyAttach`, `classifyIdle`, and three
`phaseSettled` sites), hoist one `const isOrchestratorAlive = (pid: number):
boolean => probePidAlive(pid, deps.probeAliveImpl);` near the top of
`watchCmd()` and reuse it everywhere instead of repeating the arrow inline.

**6d. Trim `orchestratorStillProgressing()`** (lines 407–416): once liveness
is confirmed, a blocked marker (stale or current) no longer means "not
progressing" — delete line 413 (`if (findFirstBlockedPhase(status)) return
false;`) entirely rather than reordering it. The function's remaining body
(pid-alive check, then `state !== 'human_review' && state !== 'complete'`)
is unchanged.

Verify each of AC-20's five fixtures against this design: (A) `implement`
current/`in_progress`, `code_review` blocked/stale, live PID →
`orchestratorLive=true` → 6a/6b fall through the blocked branch to the
existing `live` check → non-`auto_block`; `phaseSettled` returns `false`
(blocked + live) → `--until` does not exit early. (D) same shapes but no
live PID → `auto_block` / `phaseSettled` returns `true` → `--until` exits
`until`. (C)/(B) mirror A/D for the backstop shape (`code_review` blocked
*and* current) — the fix doesn't distinguish current from non-current, only
liveness, so the same branches apply. (E) blocked + `ctx.ambiguousPid` set →
6a/6b return `ambiguous_pid` before the blocked check ever runs, in both
liveness states.

**Test-file note.** Grep `tests/watch.test.ts` for any existing fixture that
combines a `blocked` phase with a live-probe/fresh-heartbeat and asserts
`auto_block` — that fixture encodes today's bug; flipping its expectation
to a non-`auto_block` kind is this fix landing correctly, not a regression.

### Step 7: Validate `MAX_REVIEW_LOOPS` at the raw-string boundary; let a validated `0` reach the evaluator (AC-21)

Files: `scripts/run-task/env.ts`, `scripts/run-task/policy.ts`,
`scripts/run-task/review-loop.ts`

Today both parse sites are `process.env.MAX_REVIEW_LOOPS ?
Number.parseInt(process.env.MAX_REVIEW_LOOPS, 10) : null` — `policy.ts:25`
and `env.ts:136`. `Number.parseInt` truncates rather than rejects
(`parseInt('1.5', 10) === 1`, `parseInt('2junk', 10) === 2`), so it never
actually rejects a decimal or trailing-junk value.

**7a. Add one canonical raw-string validator, defined once in `env.ts`**
(both files already sit in `scripts/run-task/`, and `policy.ts` has no
existing import from `env.ts` to worry about cycling — `env.ts` does not
import `policy.ts`):

```ts
// env.ts
import { warn } from './cli.js';

function parseMaxReviewLoops(raw: string | undefined): number | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) {
        warn(`Invalid MAX_REVIEW_LOOPS value "${raw}"; using the size-aware default.`);
        return null;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < 0) {
        warn(`Invalid MAX_REVIEW_LOOPS value "${raw}"; using the size-aware default.`);
        return null;
    }
    return parsed;
}

export const config = {
    ...
    maxReviewLoops: parseMaxReviewLoops(process.env.MAX_REVIEW_LOOPS),
    ...
};
```

The regex anchors the *entire* raw string to `-?\d+`, so `'1.5'` and
`'2junk'` fail validation outright (never reach `Number()`/`parseInt`
truncation) — this is what fixes the "non-integer" contract the round-1
amendment review finding caught. `'0'` and `'-1'` both match the regex;
`'-1'` is then rejected by the `< 0` check (still warns + defaults), `'0'`
passes through unchanged, preserving the existing "suicidal override"
semantics.

**7b. `policy.ts:25`** — export `parseMaxReviewLoops` from `env.ts` and
reuse it identically:

```ts
import { parseMaxReviewLoops } from './env.js';
...
maxReviewLoops: parseMaxReviewLoops(process.env.MAX_REVIEW_LOOPS),
```

**7c. `review-loop.ts`'s own floor** (line 7–9) still independently rejects
`0`:

```ts
function isUsableCap(cap: number): boolean {
    return Number.isInteger(cap) && cap >= 1;
}
```

Change the floor to `cap >= 0`. This is the fix the amendment review's
round-1 finding said config validation alone can't cover — without it, a
validated `0` still gets filtered out one layer downstream and both
evaluators report `blocked: false` unconditionally for `count=0, cap=0`.

Confirm `getPipelinePolicy`'s `config.maxReviewLoops ?? defaultMaxReviewLoops(nominalSize)`
(`scripts/pipeline-policy.ts:261`) already uses `??`, not `||` — `0` flows
through as `0`, not replaced by the tier default. No change needed there;
`tests/pipeline-policy.test.ts:92` already covers it and must keep passing
unmodified.

### Step 8: Drop the unsafe `--step` recovery command (AC-24 / F11)

Files: `scripts/run-task/review-loop.ts`, `docs/pipeline-orchestrator.md`,
`templates/docs/pipeline-orchestrator.md`

Under the relocation, `--step` runs exactly one phase and exits — so
`MAX_REVIEW_LOOPS=<n> canon run <ids> --step` runs only the deferred
revision and then loses the raised env var before the following review,
re-blocking on the very next invocation. Two call sites carry the string
today (confirmed by grep, no others exist in source):

- `scripts/run-task/review-loop.ts:64` (`buildSpecReviewReason`) and `:90`
  (`buildCodeReviewReason`) — both read `... canon run ${taskIds.join(' ')}
  --step. ...`. Drop ` --step` from both template literals so the advertised
  command is a plain `MAX_REVIEW_LOOPS=<n> canon run <ids>`.
- `docs/pipeline-orchestrator.md`'s cap-raise recovery block (currently
  ```` MAX_REVIEW_LOOPS=5 canon run <id> --step ````, in the "If the human
  authorizes more iterations..." section right before the two reset-command
  lines) — drop ` --step` there too, then `npm run sync-templates` to
  regenerate `templates/docs/pipeline-orchestrator.md` and confirm with
  `npm run sync-templates:check`.

Grepped `tests/run-task-code-review.test.ts`'s existing AC-8 ordering
assertion (`reason.indexOf('MAX_REVIEW_LOOPS') < reason.indexOf(resetCommand)`,
~line 402–403) — it does not assert the `--step` substring, so it needs no
change. Grep the full test suite for a literal `--step` inside a reason
string before finalizing, in case a later AC-8/AC-10 addition pinned it.

Add the new integration test AC-24 requires: from a block fixture (reuse
the AC-1/AC-2 fixtures from `tests/run-task-safety.test.ts`), raise
`MAX_REVIEW_LOOPS` and run `main()` **without** `--step` — assert the
deferred revision *and* the following review both run to completion in one
process (two fake-agent invocations logged, not one), under the same raised
cap the whole way through. This is the assertion that actually justifies
dropping `--step` (AC-4 only exercises the `--step` case and stops after
one invocation).

### Step 9: Correct stale operator guidance (F13 / AC-22, AC-23)

Files: `.claude/skills/canon-pipeline/recovery.md`,
`templates/.claude/skills/canon-pipeline/recovery.md`,
`docs/architecture.md`, `docs/product-context.md`

**9a. `recovery.md`'s "Phase mismatch" section** (heading at line 37, body
at lines 39–44) currently prescribes `canon task reset-spec-review
<task-id>` for exactly the state this task's relocated checkpoint now
creates on purpose — contradicting the file's own "Never reset the
iteration counter" rule three lines above (line 35). Replace lines 37–44:

```markdown
## Phase mismatch — pipeline routes to `spec` when you expected `spec_review`

Cause: the loop-cap checkpoint now sits at the revision phase's own entry
(see "Auto-block" above), so after a `spec_review` block, `spec` really is
the correct next phase — it's the deferred revision, not a stale verdict.

Fix: raise the cap and resume (see "Auto-block" above for the command).
Never reset the loop counter just to make the phase match what you
expected — that bypasses the exact cap the block exists to enforce.
```

AC-22's verify condition is a literal grep for `reset-spec-review` inside
this section's text — the replacement above deliberately never names the
command, only points back to the "Auto-block" section above it. Re-sync
`templates/.claude/skills/canon-pipeline/recovery.md` via `npm run
sync-templates` (root is registered as canon-managed) and confirm with
`npm run sync-templates:check`.

**9b. `docs/architecture.md:82`** — item 5 of the one-task lifecycle list
currently ends "...routes back to spec (or auto-blocks if cap hit)." That
reads as if the block happens at the `spec_review` verdict-processing step
itself. Reword to: "...routes back to spec; the loop-cap block itself now
fires at that next `spec` phase entry, before the revision starts, not
here (see 'Auto-block / reroute' below)."

**9c. `docs/architecture.md:174`** — the `autoBlockPhase()` bullet under
"Auto-block / reroute" says "Manual intervention required (reset phase +
`iterations_current_loop`; see recovery below)," implying a hand-edit.
Reword to name where the check fires and the two real recovery commands,
mirroring the phrasing AC-15 already used in `docs/pipeline-orchestrator.md`:

```markdown
- **`autoBlockPhase()`**: the primary check runs at the next revision
  phase's entry (`spec` / `implement`), before that revision starts; the
  review phase keeps the same check as a defense-in-depth backstop. On a
  block it sets the review phase's status to `blocked`, bumps
  `auto_block_count`, pushes an escalation, and exits with code 2. Recover
  by raising `MAX_REVIEW_LOOPS` and resuming, or via `canon task
  reset-spec-review <id>` / `canon task reset-code-review <id>` for a
  genuine rescope (see recovery below). Lifetime counters
  (`iterations_total`, `auto_block_count`) are never reset.
```

**9d. `docs/product-context.md:76`** — Flow 3 step 3 names only
`reset-code-review`. Add the `spec_review` counterpart:

```markdown
3. Resolve manually: reset the relevant phase via `canon task phase <id>
   <phase> pending`; for a `spec_review` auto-block use `canon task
   reset-spec-review <id>`, or for `code_review` use `canon task
   reset-code-review <id>` (both archive the prior review, zero loop
   counters, and preserve lifetime `iterations_total`); or escalate to a
   human reroute.
```

`docs/architecture.md` and `docs/product-context.md` are not
canon-managed (`grep -n 'architecture.md\|product-context.md'
src/lib/canon-owned.ts` is empty per the original spec's Docs Impact note)
— no `templates/` mirror for either, so 9b–9d need no re-sync. Verify all
four edits with `npm run docs-refs-check`.

## Testing Plan (Reroute)

- **`tests/task-cli.test.ts`** — new cases for AC-18(a)/(b)/(c)/(d) near
  the existing accept tests. (a) single-task `implement='pending'`+current,
  `code_review='blocked'` → accept succeeds, `implement.status==='done'`,
  message says `qa`, a follow-on run invokes QA not Codex; mirror for
  `spec`/`spec_review`. (b) `implement='in_progress'`,
  `code_review='blocked'` → no `implement.status` write, message derives
  `implement`. (c) `plan='pending'`, `implement='pending'`,
  `code_review='blocked'` → no mirror write, message derives `plan`. (d)
  two-task bundle whose post-write derived phases would differ → refused
  atomically, error names both tasks, neither `status.json` written.
  Confirm the existing write-side assertions at lines 1088–1913 pass
  **unmodified**, and re-run any message-text assertion in that range to
  confirm it still matches (fix forward per AC-19 if a state there now
  legitimately prints different text; don't suppress the check).
- **`tests/watch.test.ts`** — new fixtures per AC-20 (A/B/C/D/E) against
  `classifyAttach`, `classifyIdle` (now with the third `probeAlive` arg),
  `orchestratorStillProgressing`, and `phaseSettled`/`--until` via
  `watchCmd` deps injection. Follow the existing `RunContext` fixture
  pattern (lines 118–338). Flip any pre-existing fixture that encoded
  today's blocked+live→`auto_block` bug (see Step 6's test-file note).
- **`tests/pipeline-policy.test.ts`** — new cases for AC-21(a)'s raw-string
  validation (`"abc"`, `"-1"`, `"1.5"`, `"2junk"` → default + warning;
  `"0"` → `0` unchanged). Line 92 unmodified.
- **`tests/run-task-harness.test.ts`** — mirrored AC-21(a) cases against
  `env.ts`'s `config.maxReviewLoops` (file already imports `env.js`).
- **`tests/run-task-code-review.test.ts`** — new checkpoint-level case per
  AC-21(b): call `evaluateSpecReviewLoop`/`evaluateCodeReviewLoop` directly
  with `cap=0, count=0`, assert `blocked: true` (red-first against today's
  `cap >= 1` floor).
- **`tests/run-task-safety.test.ts`** — new integration test per AC-24: from
  a block fixture, raised cap, plain `canon run <ids>` (no `--step`) runs
  the deferred revision and the following review to completion in one
  process (two fake-agent invocations).
- **Docs** — `npm run docs-refs-check` after Step 9's edits; `npm run
  sync-templates` + `npm run sync-templates:check` after Step 8's and Step
  9a's root-doc edits.

## Validation (Reroute — run last, in order)

```bash
npm run lint
npm run type-check
npm test
npm run build
npm run docs-refs-check
npm run sync-templates:check
```

## Rollback Plan (Reroute delta)

Same shape as the original Rollback Plan: every amendment change is either
a pure relocation (message/predicate derivation in `taskAccept`, the
liveness reorder in `watch.ts`) or an added validation branch
(`MAX_REVIEW_LOOPS` parsing, `isUsableCap`'s floor) — no schema change, no
removed capability. `git revert` on the amendment's commit(s) restores
today's (buggy) `taskAccept` message, `watch` block-precedence, and
`--step`-bearing recovery text without touching Steps 1–4's already-shipped
mechanism.
