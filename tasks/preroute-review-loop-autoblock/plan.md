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
