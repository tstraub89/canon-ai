# Plan: review-verdict-freshness-guard

> Author: Claude | Spec: `tasks/review-verdict-freshness-guard/spec.md` | Spec Review: `approved_with_nits`

## Summary

Add a fail-closed park in `checkAndRoute()` for a crashed Codex `spec_review` invocation: when `phase === 'spec_review'` and `lastCodexExitStatus !== 0` (and the phase did not reach `done` via agent self-bookkeeping), emit an actionable error and `process.exit(2)` *before* `recoverPhaseForTask()` runs — skipping the stale-artifact read, the futile retry, and the counter mutation. No other phase, and no `done`-phase or clean-exit path, changes behavior.

Spec review returned `approved_with_nits` with two nits to fold into implementation (not spec changes):
1. Scope the "non-zero Codex exit reaches recovery" claim to the non-interactive `codex exec` path (interactive mode `process.exit`s earlier via `runCommandOrDie`, per `scripts/run-task/agents/codex.ts:50-67` / `scripts/run-task/git.ts:25-29`, and never reaches `checkAndRoute`). Docs/messages should say "the returning non-interactive exit-code path," not "every non-zero Codex exit."
2. AC-4's fixture must use a `changes_requested` verdict explicitly (not a generic "checked verdict"), because `updateReviewCounters()` only increments `iterations_current_loop` for `changes_requested`/`needs_re_review` — an `approved`/`approved_with_nits` verdict resets that counter to `0` instead. The plan below bakes this into the AC-4 test.

## Step 1 — Add a test-only exit-status setter (main.ts)

`lastCodexExitStatus` is a private module-level `let` (`scripts/run-task/main.ts:91`) with no external seam — tests that directly import `checkAndRoute` (as `tests/run-task-validation.test.ts` already does) have no way to drive it. Mirror the existing `setCliArgsForTest` pattern (`main.ts:93-95`) immediately below it:

```ts
export function setLastCodexExitStatusForTest(status: number): void {
    lastCodexExitStatus = status;
}
```

This is the test seam the AC-1/2/3/4/5 tests use — no subprocess, no fake-git harness required, consistent with how `checkAndRoute` is already tested at `tests/run-task-validation.test.ts:3291,3314,3356`.

## Step 2 — Add the pure park predicate (main.ts)

Add near `tryEvidenceAdvance` (e.g. directly above it, around `main.ts:2824`) a small exported pure predicate so AC-5's "branch is spec_review-only" claim has a structural, unit-testable anchor independent of the full `checkAndRoute` integration path:

```ts
// A non-zero Codex exit is not proof the review failed to complete (MCP shutdown
// noise can trail a genuine result) — but it is also not proof it succeeded. Only
// Codex spec_review can reach this signal: code_review is a Claude phase forced to
// lastCodexExitStatus = 0 (main.ts:3454), and a crashed Claude process.exits before
// reaching recovery (agents/claude.ts). Gating the park on phase === 'spec_review'
// is therefore sufficient to scope it — no other phase can trip this condition.
export function shouldParkCrashedReview(phase: Phase, codexExitStatus: number): boolean {
    return phase === 'spec_review' && codexExitStatus !== 0;
}
```

`Phase` is already imported in `main.ts` (used throughout `checkAndRoute`'s signature). No new import needed.

## Step 3 — Wire the park into `checkAndRoute()` (main.ts:3037-3046)

Current code (`checkAndRoute()`'s per-task not-`done` block):

```ts
        if (phaseStatus !== 'done') {
            if (lastCodexExitStatus !== 0) {
                warn(`Codex exited with status ${lastCodexExitStatus} and '${phase}' was not completed for '${taskIds[i]}'.`);
            }
            const recovered = await recoverPhaseForTask(taskIds[i], phase, phaseStatus);
            if (!recovered) {
                warn(`Phase '${phase}' did not reach 'done' for '${taskIds[i]}'. Stopping for human review.`);
                process.exit(2);
            }
        }
```

Insert the park check immediately after the existing `if (lastCodexExitStatus !== 0) { warn(...) }` block and before `recoverPhaseForTask` is called:

```ts
        if (phaseStatus !== 'done') {
            if (lastCodexExitStatus !== 0) {
                warn(`Codex exited with status ${lastCodexExitStatus} and '${phase}' was not completed for '${taskIds[i]}'.`);
            }
            if (shouldParkCrashedReview(phase, lastCodexExitStatus)) {
                warn(`Codex spec review exited with status ${lastCodexExitStatus} and did not complete — no verdict was recorded this round for '${taskIds[i]}'.`);
                warn('This is typically out-of-credits, auth, network, or an MCP crash.');
                warn(`Fix the cause, then re-run \`canon run ${taskIds[i]}\`.`);
                process.exit(2);
            }
            const recovered = await recoverPhaseForTask(taskIds[i], phase, phaseStatus);
            if (!recovered) {
                warn(`Phase '${phase}' did not reach 'done' for '${taskIds[i]}'. Stopping for human review.`);
                process.exit(2);
            }
        }
```

Notes for the implementer:
- `warn()` writes to `console.error` (`scripts/run-task/cli.ts:107-109`), matching AC-2's "asserts these substrings appear" check via a captured-`console.error` test helper (see Step 5).
- This is a per-task check inside the existing `for (let i = 0; i < taskIds.length; i += 1)` loop, so in bundle mode the *first* crashed `spec_review` member halts the whole run via `process.exit(2)` — matching the spec's "Bundle mode" design note. Do not hoist it out of the loop or change it to check `statuses.every(...)`.
- Do **not** touch the `if (lastCodexExitStatus !== 0) { warn(...) ; lastCodexExitStatus = 0; }` block at `main.ts:3053-3056` (the "completed despite Codex exit status N (likely MCP warnings)" note) — it's unreachable for the parked case because `process.exit(2)` already terminated the process, and it must keep firing unchanged for the benign `done`-phase case (AC-3) and other phases.
- Do **not** add `phase === 'spec_review'` gating anywhere else (e.g. don't wrap the *existing* generic `if (lastCodexExitStatus !== 0) { warn(...) }` — that line stays phase-agnostic exactly as today; only the *new* park check is spec_review-gated).

## Step 4 — Rebuild dist

```bash
npm run build
```

This regenerates `dist/scripts/run-task.js` (bundles `main.ts`). Per AC-9 / spec Affected Files: `dist/cli/index.js` is not expected to change since this task doesn't touch `validation.ts`, but verify with `git diff --exit-code -- dist/cli/index.js` after the build — if it does change, commit it and add it to the handoff Changes table (don't assume the spec's prediction is correct without checking).

## Step 5 — Tests (tests/run-task-validation.test.ts)

**Placement decision (deviates from the spec's suggested file):** the spec's Affected Files table names `tests/run-task-safety.test.ts` (the subprocess/real-git integration pattern) as the test seam. That file's helpers (`setupFakeGit`, spawned subprocesses) exist for git-surgery tests that need a real git checkout. This task's ACs need none of that — `checkAndRoute` is already directly imported and exercised against `withTempTasksAsync`-created status.json/artifact fixtures in `tests/run-task-validation.test.ts` (e.g. the `'checkAndRoute treats sanctioned review verdicts as advancing outcomes'` test at `tests/run-task-validation.test.ts:3302-3362`, which builds a literal spec_review `StatusJson` and calls `checkAndRoute('spec_review', ['task-spec'])` directly). Add the new tests there instead, right after that test, reusing the same fixture-construction style. Note this placement change in the handoff (the file still needs declaring — `tests/run-task-validation.test.ts` instead of `tests/run-task-safety.test.ts`).

### 5a. Shared test helpers

Add near the top of the test file (alongside `withTempTasksAsync`, `writeCodeReviewTask`), or as local helpers just above the new tests:

```ts
import { setLastCodexExitStatusForTest, shouldParkCrashedReview } from '../scripts/run-task/main.js';
```
(add to the existing `import { checkAndRoute, resolveQaPrBody } from '../scripts/run-task/main.js';` at line 47)

```ts
// Mirrors the captureDie pattern in tests/run-task-code-review.test.ts:157-172,
// generalized to any exit code and returning both the exit code seen and the
// joined console.error output (warn() writes to console.error). Unlike
// captureDie, this does not assert.rejects internally — it swallows the
// expected process.exit throw itself and returns the observed code, so a
// caller that expects NO exit (AC-3, AC-4) can just await it with no
// try/catch of its own. Any OTHER thrown error (a real bug, not our stub)
// is rethrown so it still fails the test loudly.
async function captureExit(fn: () => Promise<unknown>): Promise<{ code: number | undefined; messages: string }> {
    const originalExit: typeof process.exit = process.exit.bind(process);
    const originalError = console.error;
    const errors: string[] = [];
    let seenCode: number | undefined;
    process.exit = ((code?: string | number | null): never => {
        seenCode = typeof code === 'number' ? code : undefined;
        throw Object.assign(new Error('process.exit'), { code });
    }) as typeof process.exit;
    console.error = (...args: unknown[]): void => { errors.push(args.map(String).join(' ')); };
    try {
        await fn();
    } catch (error) {
        const isOurExitSignal = error instanceof Error && error.message === 'process.exit';
        if (!isOurExitSignal) throw error;
    } finally {
        process.exit = originalExit;
        console.error = originalError;
    }
    return { code: seenCode, messages: errors.join('\n') };
}
```

`captureExit` returning `code: undefined` (rather than `2`) is exactly how AC-3/AC-4 assert "no park fired" — no explicit assertion needed on `code` in those tests since the function under test's own return value / subsequent status read is the real assertion; only AC-1/AC-2 need to check `code === 2`.

Build a minimal spec_review status fixture helper, following the inline literal already used at `tests/run-task-validation.test.ts:3320-3353` (don't reuse `writeCodeReviewTask`, which is code_review-shaped):

```ts
function writeSpecReviewTask(
    tasksRoot: string,
    taskId: string,
    opts: {
        specReviewStatus?: 'pending' | 'in_progress' | 'done';
        iterationsCurrentLoop?: number;
        iterationsTotal?: number;
        changesRequestedTotal?: number;
        verdict?: string;
        reviewContent?: string;
    } = {},
): void {
    const taskDir = path.join(tasksRoot, taskId);
    fs.mkdirSync(taskDir, { recursive: true });
    const status: StatusJson = {
        id: taskId,
        title: taskId,
        status: 'spec_review',
        created: '2026-07-01',
        updated: '2026-07-01',
        branch: `task/${taskId}`,
        base_branch: 'main',
        task_size: 'M',
        delicate: true,
        human_spec_gate: false,
        full_send: false,
        worktree: false,
        phases: {
            spec: { status: 'done', agent: 'claude' },
            spec_review: {
                status: opts.specReviewStatus ?? 'in_progress',
                agent: 'codex',
                verdict: opts.verdict ?? '',
                iterations: opts.iterationsCurrentLoop ?? 0,
                iterations_current_loop: opts.iterationsCurrentLoop ?? 0,
                iterations_total: opts.iterationsTotal ?? 0,
                changes_requested_total: opts.changesRequestedTotal ?? 0,
                auto_block_count: 0,
                preflight_rejections_current_loop: 0,
            },
            plan: { status: 'pending', agent: 'claude' },
            implement: { status: 'pending', agent: 'codex' },
            code_review: { status: 'pending', agent: 'claude', verdict: '' },
            qa: { status: 'pending', agent: 'claude' },
            human_review: { status: 'pending', agent: 'human' },
        },
        escalations: [],
        sessions: {},
    };
    writeStatusToFile(path.join(taskDir, 'status.json'), status);
    fs.writeFileSync(
        path.join(taskDir, 'spec-review.md'),
        opts.reviewContent ?? [
            '# Spec Review',
            '',
            '## Verdict',
            '',
            '- [x] **Changes requested**',
            '',
        ].join('\n'),
    );
}
```

Check `writeStatusToFile` is already imported (it's used at `tests/run-task-validation.test.ts:3354`) — it is, per the existing import block from `../scripts/run-task/state.js`.

Every test that calls `setLastCodexExitStatusForTest` must reset it to `0` in a `finally` block (or at the top of the next test) — it is shared module state across the whole test-file process, same caveat as `cliArgs` in `setCliArgsForTest`.

### 5b. AC-1 — park + counters protected + no phantom advance (red-first)

```ts
void test('checkAndRoute parks a crashed Codex spec_review instead of advancing on the stale artifact', async () => {
    await withTempTasksAsync(async tasksRoot => {
        writeSpecReviewTask(tasksRoot, 'task-crash', {
            iterationsCurrentLoop: 1,
            iterationsTotal: 2,
            changesRequestedTotal: 1,
            reviewContent: [
                '# Spec Review',
                '',
                '## Round 1',
                '',
                '### Verdict for this round',
                '',
                '- [x] Changes requested',
                '',
            ].join('\n'),
        });
        setLastCodexExitStatusForTest(1);
        try {
            const { code } = await captureExit(() => checkAndRoute('spec_review', ['task-crash']));
            assert.equal(code, 2);
        } finally {
            setLastCodexExitStatusForTest(0);
        }

        const status = readStatus('task-crash');
        assert.equal(status.phases.spec_review?.status, 'in_progress');
        assert.equal(status.phases.spec_review?.iterations_current_loop, 1);
        assert.equal(status.phases.spec_review?.iterations_total, 2);
        assert.equal(status.phases.spec_review?.changes_requested_total, 1);
    });
});
```

This is red on pre-fix `main.ts`: today's code has no park branch, so `recoverPhaseForTask` → `tryEvidenceAdvance` reads the stale `- [x] Changes requested` off `spec-review.md`, calls `taskPhase(..., 'done', 'changes_requested')`, and `updateReviewCounters` bumps `iterations_current_loop` to 2 / `iterations_total` to 3 / `changes_requested_total` to 2 — the assertions above fail, and `checkAndRoute` returns normally instead of throwing a `process.exit(2)`-shaped error. After the fix, the park fires before any of that runs.

### 5c. AC-2 — actionable park message (fold into the AC-1 test or as a sibling)

Extend the AC-1 test (or add a sibling using the same fixture) to assert on `messages`:

```ts
        const { code, messages } = await captureExit(() => checkAndRoute('spec_review', ['task-crash']));
        assert.equal(code, 2);
        assert.match(messages, /status 1/);
        assert.match(messages, /did not complete/i);
        assert.match(messages, /no verdict was recorded/i);
        assert.match(messages, /out-of-credits|auth|network|MCP crash/i);
        assert.match(messages, /canon run task-crash/);
```

### 5d. AC-3 — benign done-phase + non-zero exit does NOT park

```ts
void test('checkAndRoute does not park a done spec_review even when the trailing Codex exit was non-zero', async () => {
    await withTempTasksAsync(async tasksRoot => {
        writeSpecReviewTask(tasksRoot, 'task-done', {
            specReviewStatus: 'done',
            verdict: 'approved_with_nits',
            iterationsCurrentLoop: 0,
            iterationsTotal: 1,
            reviewContent: [
                '# Spec Review',
                '',
                '## Verdict',
                '',
                '- [x] **Approved with nits**',
                '',
            ].join('\n'),
        });
        setLastCodexExitStatusForTest(1);
        let code: number | undefined;
        try {
            ({ code } = await captureExit(() => checkAndRoute('spec_review', ['task-done'])));
        } finally {
            setLastCodexExitStatusForTest(0);
        }
        assert.equal(code, undefined); // no process.exit was called
        const status = readStatus('task-done');
        assert.equal(status.phases.spec_review?.status, 'done');
    });
});
```

The key behavior under test: `checkAndRoute` must run to completion (falls through to the `lastCodexExitStatus !== 0` "completed despite..." note at `main.ts:3053-3056`, then the `switch (phase) { case 'spec_review': ... }` routing at `main.ts:3059-3128`) without `process.exit(2)` — because `phaseStatus === 'done'` already, the whole not-`done` block (park included) is skipped. Confirmed by reading the routing switch: with verdict `approved_with_nits`, `anyChangesRequested` is `false` (line 3060), so both the reroute-rejection branch (3066) and `routeBackTo(taskIds, 'spec')` (3097) are skipped; with the fixture's `human_spec_gate: false`, the full-tier gate block (3105) is also skipped; the case falls through to a bare `return` (3127) with no further mutation. So `phases.spec_review.status` stays exactly `'done'` as seeded — assert that directly, no further routing to account for.

### 5e. AC-4 — benign clean-exit skipped-bookkeeping still advances, with a `changes_requested` fixture (nit #2)

```ts
void test('checkAndRoute auto-advances a clean-exit spec_review from a fresh changes_requested verdict', async () => {
    await withTempTasksAsync(async tasksRoot => {
        writeSpecReviewTask(tasksRoot, 'task-fresh', {
            iterationsCurrentLoop: 0,
            iterationsTotal: 1,
            changesRequestedTotal: 1,
            reviewContent: [
                '# Spec Review',
                '',
                '## Verdict',
                '',
                '- [x] **Changes requested**',
                '',
            ].join('\n'),
        });
        setLastCodexExitStatusForTest(0);
        const { code } = await captureExit(() => checkAndRoute('spec_review', ['task-fresh']));
        assert.equal(code, undefined); // clean-exit auto-advance never exits the process

        const status = readStatus('task-fresh');
        // recoverPhaseForTask -> tryEvidenceAdvance already called
        // taskPhase(taskId, 'spec_review', 'done', 'changes_requested'), which runs
        // updateReviewCounters (src/task/index.ts:394-415: a changes_requested
        // verdict increments all three counters by 1), before the switch-based
        // routing (main.ts:3059-3128) runs. anyChangesRequested is then true, so
        // routeBackTo(taskIds, 'spec') fires (main.ts:3097) and resets
        // phases.spec_review.status to 'pending' and clears .verdict — but
        // routeBackTo only touches .status/.verdict/operator-acceptance fields,
        // never the counters — so the counter increments below survive routing.
        assert.equal(status.phases.spec_review?.status, 'pending');
        assert.equal(status.phases.spec_review?.verdict, '');
        assert.equal(status.phases.spec_review?.iterations_current_loop, 1); // 0 -> 1
        assert.equal(status.phases.spec_review?.iterations_total, 2); // 1 -> 2
        assert.equal(status.phases.spec_review?.changes_requested_total, 2); // 1 -> 2
        assert.equal(status.phases.spec?.status, 'pending'); // routeBackTo resets target phase too
    });
});
```

Counter math confirmed by reading `updateReviewCounters` and `routeBackTo` (`main.ts:2536-2566`) during planning — a `changes_requested` verdict increments all three counters by 1, and `routeBackTo` resets only `.status`/`.verdict`/operator-acceptance fields on `spec_review` and every downstream phase (including `spec` itself, since `targetIdx` for `'spec'` is `0`), never the counters. This test must pass unchanged both before and after the `main.ts` fix (it exercises the clean-exit path, which the fix does not touch) — treat a pre-fix failure here as a sign the fixture or assertions are wrong, not as a legitimate red-first case.

### 5f. AC-5 — branch is spec_review-only

Two parts:

**Structural assertion** (no fixture needed):
```ts
void test('shouldParkCrashedReview only fires for spec_review with a non-zero Codex exit', () => {
    assert.equal(shouldParkCrashedReview('spec_review', 1), true);
    assert.equal(shouldParkCrashedReview('spec_review', 0), false);
    for (const phase of ['code_review', 'plan', 'implement', 'qa'] as const) {
        assert.equal(shouldParkCrashedReview(phase, 1), false);
    }
});
```

**`code_review` recovery unchanged** — reuse the existing `writeCodeReviewTask` helper with a not-`done` code_review status and a fresh verdict on disk, call `setLastCodexExitStatusForTest(0)` (matching the spec's own point that `code_review` forces `lastCodexExitStatus = 0` in production — a Claude phase can't set it non-zero, so the faithful test drives the code path with `0`, not an artificial non-zero value production never produces), then assert `checkAndRoute('code_review', [...])` behaves exactly as it does today (advances via evidence, no `process.exit(2)`). Check whether an existing not-`done` code_review recovery test already covers this (skim the `describe`/`test` blocks around `writeCodeReviewTask` usages in `tests/run-task-validation.test.ts`) before adding a new one; if one exists, just wrap it with a `setLastCodexExitStatusForTest(0)`/reset pair as an explicit regression guard and a one-line comment explaining why (documents that the park predicate is provably never reachable for this phase in production, and the test still passes with the literal `0` it would always see).

## Step 6 — Docs: `docs/pipeline-orchestrator.md` (AC-6)

Add a new paragraph in the **"Phase Routing + Auto-Block"** section, immediately after the "Auto-block on runaway loops" paragraph (`docs/pipeline-orchestrator.md:356`) and before the "`Fail – unrelated` result state" paragraph (`:358`):

```markdown
**Crashed Codex `spec_review` parks instead of advancing.** When a non-interactive `codex exec spec_review` invocation exits non-zero (out-of-credits, auth, network, MCP crash) and the phase never reached `done` via the agent's own `canon task phase` bookkeeping, the orchestrator does not read a verdict from `spec-review.md` and advance — it parks: an actionable error naming the exit code, the likely cause, and the re-run instruction, then `process.exit(2)`. This is fail-closed by design: after a non-zero exit the orchestrator cannot tell a genuinely completed review that exited noisily (MCP shutdown warning) apart from a crash that left the *prior* round's verdict sitting in the shared, cumulative artifact — trusting the artifact either way risks fabricating a review that never ran and inflating the durable iteration counters `autoBlockSpecReview` compares against the loop cap. The tradeoff: the rare genuine case (a real verdict was written, then the process exited non-zero, and self-bookkeeping was skipped) now also parks and needs a manual re-run, rather than auto-advancing as it optimistically did before. Interactive Codex invocations fail closed differently — `runCommandOrDie` `process.exit`s before returning to `checkAndRoute`, so they never reach this park at all. No other phase parks this way: `code_review` is a Claude phase (`lastCodexExitStatus` is forced to `0` for it) and a crashed Claude session `process.exit`s before recovery, so it never reaches `checkAndRoute` non-zero either.
```

## Step 7 — Docs: `docs/patterns.md` (AC-7)

Add a new "Known Pitfall" entry. Insert it after the last existing pitfall ("Write-safety guards must fail closed when the underlying probe errors", ending around `docs/patterns.md:202`) and before the "## Quick Reference" section (`:204`):

```markdown
### A non-zero agent exit is not a completed review — recovery must park, not read the artifact

`checkAndRoute()`'s recovery path used to trust whatever verdict was extractable from a review artifact any time the phase status wasn't yet `done`, regardless of how the preceding agent invocation exited. For a returning (non-interactive) Codex `spec_review` invocation that crashed — out-of-credits, auth, network, an MCP crash — this reads the *prior* round's verdict off the shared, cumulative `spec-review.md` and fabricates a review that never happened, inflating the durable `iterations_current_loop`/`iterations_total`/`changes_requested_total` counters `autoBlockSpecReview` compares against the loop cap. A non-zero exit code does not distinguish "the review completed and then the process emitted trailing noise" from "the review never ran and the artifact is stale" — both produce the same on-disk artifact. The fix: gate on `phase === 'spec_review' && lastCodexExitStatus !== 0` (`shouldParkCrashedReview()` in `scripts/run-task/main.ts`) *before* `recoverPhaseForTask()` runs, and park (actionable error + `process.exit(2)`) instead of reading the artifact. This is scoped to `spec_review` by construction — `code_review` is a Claude phase forced to `lastCodexExitStatus = 0`, and a crashed Claude session `process.exit`s before reaching recovery at all, so it can never trip this condition. When adding recovery/auto-advance logic for any phase, treat "the agent process exited non-zero" as "assume the work did not complete," not as noise to warn-and-continue past.
```

## Step 8 — Docs: `docs/BACKLOG.md` (AC-8)

Two additions near the existing Bug 2 entry (`docs/BACKLOG.md:857-871`):

1. Append a new bullet at the end of that entry (after the `2026-06-09` bullet ending at line 871, still nested under the same top-level item, before the blank line at 872):

```markdown
  - **Shared theme with `review-verdict-freshness-guard` (agent-failure ≠ phase success)**: that task's fix is a *different* failure mode on the *same* theme — instead of an agent-CLI exit killing the orchestrator (this Bug 2), a crashed Codex `spec_review` invocation that *returns* a non-zero exit (rather than `process.exit`-ing) could make `checkAndRoute()`'s recovery path read a stale verdict off the artifact and fabricate a completed review. Both bugs are instances of "an agent process's exit code/behavior does not by itself mean the phase succeeded or failed" — Bug 2 is about the orchestrator surviving the exit; the freshness guard is about not trusting stale on-disk state after it. See `scripts/run-task/main.ts`'s `shouldParkCrashedReview()` and the "non-zero agent exit is not a completed review" pitfall in `docs/patterns.md`.
```

2. Add a new standalone backlog item recording the deferred in-band freshness follow-up (place it directly after the Bug 2 entry's closing, i.e. as a new `- [ ]` item before the `- [x]` "Bundle QA injects the PR template..." entry at line 873):

```markdown
- [ ] **Deferred: in-band per-invocation spec_review verdict freshness** *(deferred from `review-verdict-freshness-guard`, which shipped the smaller fail-closed park instead — see `docs/patterns.md` "A non-zero agent exit is not a completed review")*
  - **What's deferred**: the fail-closed park now sends one genuine benign sub-case to manual re-run — a real `spec_review` verdict was produced, then the Codex process exited non-zero (MCP shutdown noise), and the agent skipped `canon task phase` self-bookkeeping. Restoring auto-advance for that sub-case requires the orchestrator to prove a verdict was authored by *this* invocation, not the shared cumulative artifact's prior round.
  - **Why it's hard**: `extractCheckedVerdict()` (`scripts/run-task/validation.ts:870-881`) recognizes a verdict checkbox anywhere in its selected scope (latest `## Round` or the whole file) — there is no structural `## Verdict`-section locator to anchor a freshness check on. Two prior spec_review rounds on `review-verdict-freshness-guard` rejected in-band mechanisms on exactly this ground: a whole-file mtime/size fingerprint can't prove the *verdict* (vs. unrelated content) is fresh, and invalidating the latest round/scope before dispatch destroys completed-round history that the append-only cumulative artifact contract requires preserving.
  - **Path forward**: first give `extractCheckedVerdict`/`checkPhaseGate`/`checkRerouteEvidence` a shared structural verdict-section locator (a load-bearing parser change, since all three consume it), then add a per-invocation freshness signal (e.g. a scoped marker written at dispatch time and checked at recovery time, verified sound against partial-write and worktree-dual-copy cases). Distinct, larger task from the park fix.
  - **Effort**: `M`+ — parser-grammar change touching three call sites plus a new freshness mechanism and its own adversarial test suite.
```

## Step 9 — Templates mirror

Do **not** hand-edit `templates/docs/pipeline-orchestrator.md`. The pre-commit sync hook regenerates it from the root `docs/pipeline-orchestrator.md` edit in Step 6 (`docs/patterns.md` and `docs/BACKLOG.md` are not in `CANON_OWNED`/`DELIMITED` per `src/lib/canon-owned.ts`, so they have no mirror). Run `git status` after committing to confirm the mirror regenerated and is included, per the "declare templates/ mirrors" pitfall in `docs/patterns.md`.

## Step 10 — Validation

Run in order:

```bash
npm run lint
npm run type-check
npm test
npm run build && git diff --exit-code -- dist/
npm run docs-refs-check
```

All must pass clean per the spec's Validation Required checklist. `npm run build` is required because `main.ts` changed (`dist/scripts/run-task.js` regenerates); confirm whether `dist/cli/index.js` also changed (Step 4 note) and declare it in the handoff Changes table only if it did.

## Handoff Changes table — expected rows

- `scripts/run-task/main.ts` — park predicate + wiring + test-only setter
- `tests/run-task-validation.test.ts` — AC-1 through AC-5 tests (placement deviates from the spec's suggested `tests/run-task-safety.test.ts`; note why in the handoff)
- `docs/pipeline-orchestrator.md` — recovery/auto-advance park documentation
- `templates/docs/pipeline-orchestrator.md` — regenerated mirror (auto)
- `docs/patterns.md` — new Known Pitfall
- `docs/BACKLOG.md` — Bug 2 cross-reference + deferred-freshness item
- `dist/scripts/run-task.js` — regenerated build artifact
- `dist/cli/index.js` — only if `npm run build` actually changes it (verify, don't assume either way)
