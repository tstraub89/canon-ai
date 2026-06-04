# Implementation Plan: reroute-spec-review-symmetry

> Written by: Claude | Implements: `tasks/reroute-spec-review-symmetry/spec.md`

## Approach

All ACs touch a tightly coupled cluster: state mutation in `rerouteFromHumanReview()`, routing in `checkAndRoute()`, prompt dispatch in `prompts/index.ts`, two new templates, and cwd/session fixes in the phase files. The sequence is:

1. State mutations first (ACs 1, 2, 9, 12 — all in `main.ts`)
2. Routing fix (AC-5, AC-6 regression guard — also `main.ts`)
3. Subprocess cwd fixes (AC-11, AC-13)
4. Template registration + prompt dispatch (ACs 3, 4, 7, 8)
5. Tests (extend both test files + regenerate golden)
6. Docs (AC-10)
7. Build validation (AC-14)

Each step is independently legible. No new `status.json` fields.

---

## Step 1 — Correct stale comment (AC-9)

**File**: `scripts/run-task/main.ts` ~L1879

Replace the stale comment on `implement.rerouted` with the true invariant:

```
// implement.rerouted is set on reroute entry and NEVER cleared.
// Dispatch correctness relies on this invariant:
//   At spec_review / plan / implement dispatch time, implement.rerouted === true
//   iff a human reroute is in progress. The four reset paths that could violate this:
//   1. Task creation — all phases pending, rerouted falsy → normal variants. ✓
//   2. routeBackTo('spec') (original spec_review changes_requested loop) — only fires
//      before any reroute because Option B (AC-5) intercepts reroute+changes_requested
//      before this line, so rerouted is falsy here → correct. ✓
//   3. routeBackTo('implement') (code_review loop) — implement.ts checks isRevision
//      (iterations_current_loop > 0) before isRerouted, so revision prompt wins
//      regardless. ✓
//   4. rerouteFromHumanReview() — sets rerouted = true. → reroute variants. ✓
```

No behavior change.

---

## Step 2 — Tier-gated reset + session clear + messaging in `rerouteFromHumanReview()` (AC-1, AC-2, AC-12)

**File**: `scripts/run-task/main.ts`, function `rerouteFromHumanReview()`

**2a. Detect tier once, before the per-task loop.**

After the amendment-verification loop (before the `splitCli.info('Rerouting...')` line), compute the tier:

```typescript
const rerouteStatuses = taskIds.map(splitState.readStatus);
const reroutableTier = splitPolicy.detectTier(rerouteStatuses);
```

`splitPolicy.detectTier` is already imported via the `splitPolicy` namespace used in `checkAndRoute`. Tier is determined by `task_size` + `delicate` fields (not reroute state), so reading statuses before or after incrementing `reroute_count` gives the same result.

**2b. Inside the existing per-task loop, add the full-tier reset after `codeReview`/`qa`/`humanReview` resets and before `splitState.writeStatus()`:**

```typescript
if (reroutableTier === 'full') {
    const specReview = status.phases.spec_review;
    if (specReview) {
        specReview.status = 'pending';
        specReview.verdict = '';
        // Reset loop counter; preserve monotonic counters
        // (iterations_total, changes_requested_total, auto_block_count).
        specReview.iterations_current_loop = 0;
        specReview.iterations = 0;  // legacy alias for back-compat readers
    }
    const plan = status.phases.plan;
    if (plan) plan.status = 'pending';
    // Clear stored Codex spec_review session: the original session is bound to
    // REPO_ROOT (worktree didn't exist at original spec_review time). Resuming it
    // at reroute defeats the activeCwd fix (AC-11) and gives Codex re-review
    // framing instead of fresh amendment-review framing. Clearing forces a fresh
    // session that honors the new cwd.
    if (status.sessions) {
        delete status.sessions.codex_spec_review;
    }
}
```

**2c. Replace the two info lines** (currently `Rerouting: human_review → implement ...` and `Status reset. Pipeline will resume from implement ...`) with tier-aware variants, placed after the loop:

```typescript
if (reroutableTier === 'full') {
    splitCli.info(
        'Rerouting: human_review → spec_review ' +
        '(resetting spec_review, plan, implement, code_review, qa)'
    );
} else {
    splitCli.info('Rerouting: human_review → implement (resetting implement, code_review, qa)');
}
// ... existing full_send cleared warning unchanged ...
if (reroutableTier === 'full') {
    splitCli.info(
        'Status reset. Pipeline will resume from spec_review (Codex reviews your amendment), ' +
        'then plan, then implement.'
    );
    splitCli.info('Use --step --expect spec_review to advance one phase at a time.');
} else {
    splitCli.info(
        'Status reset. Pipeline will resume from implement phase with amended-spec context.'
    );
    splitCli.info(
        'Note: Codex will re-read spec.md carefully ' +
        '(looking for new Amendment sections) and update the implementation.'
    );
}
splitCli.info('');
// ... existing amendment-section reminder unchanged ...
```

---

## Step 3 — Option B routing in `checkAndRoute()` (AC-5 + AC-6 regression guard)

**File**: `scripts/run-task/main.ts`, function `checkAndRoute()`, `case 'spec_review'`

Insert the reroute interception **before** the existing `routeBackTo(taskIds, 'spec')` call. This ordering is load-bearing for the `implement.rerouted` invariant (AC-9).

Current structure:
```typescript
case 'spec_review': {
    const anyChangesRequested = statuses.some(s => getVerdict(s, 'spec_review') === 'changes_requested');
    if (anyChangesRequested) {
        info('Spec review requested changes — routing back to spec.');
        routeBackTo(taskIds, 'spec');
        return;
    }
    // ... human gate ...
}
```

New structure:
```typescript
case 'spec_review': {
    const anyChangesRequested = statuses.some(s => getVerdict(s, 'spec_review') === 'changes_requested');
    const isRerouteInProgress = statuses.some(s => s.phases.implement?.rerouted === true);

    // Option B: reroute amendment rejected → block to human; do NOT route back to
    // pipeline spec phase. Must run BEFORE routeBackTo('spec') — see invariant comment
    // on implement.rerouted.
    if (isRerouteInProgress && anyChangesRequested) {
        // Whole-bundle reset: every bundled task back to spec_review pending so
        // assertSamePhase() is satisfied on re-run. Mirrors routeBackTo('spec') symmetry.
        for (const taskId of taskIds) {
            const s = splitState.readStatus(taskId);
            if (s.phases.spec_review) {
                s.phases.spec_review.status = 'pending';
                s.phases.spec_review.verdict = '';
            }
            splitState.writeStatus(taskId, s);
        }
        const rejectedIds = taskIds.filter((_, i) =>
            getVerdict(statuses[i], 'spec_review') === 'changes_requested'
        );
        console.log('');
        console.log('════════════════════════════════════════════════════════');
        console.log('  ✋  AMENDMENT REVIEW — Changes requested on your amendment.');
        console.log('');
        console.log('  Revise the amendment in these specs:');
        for (const id of rejectedIds) {
            console.log(`    tasks/${id}/spec.md`);
            console.log(`    tasks/${id}/spec-review.md  ← review findings`);
        }
        console.log('');
        console.log('  After revising, re-run (NOT --reroute, just the normal run):');
        console.log(`  canon run ${taskIds.join(' ')}`);
        console.log('════════════════════════════════════════════════════════');
        console.log('');
        process.exit(0);
    }

    // Non-reroute path: original spec_review changes_requested → route back to spec.
    if (anyChangesRequested) {
        info('Spec review requested changes — routing back to spec.');
        routeBackTo(taskIds, 'spec');
        return;
    }
    // ... existing human gate block unchanged ...
}
```

AC-6 is a regression guard — no new code needed. The human spec gate block (`if (tier === 'full' && statuses.some(s => s.human_spec_gate) && !allFullSend)`) already correctly skips when `human_spec_gate === false`. The test is what's new (Step 7).

---

## Step 4 — Pass `activeCwd` as `cwd` argument (AC-11)

**File**: `scripts/run-task/phases/spec-review.ts`

`activeCwd` is already computed at line ~L95: `const activeCwd = getActiveCwd(taskIds);`

The `runCodex` call currently passes `activeCwd` only inside `metricsContext` (6th arg). Add it as the 7th positional arg (`cwd`):

```typescript
const result = await runCodex(
    specReviewPrompt, interactive, resumeId, cfg.model, cfg.effort,
    { taskId: taskIds.join('+'), phase: 'spec_review', iteration: maxSpecIter, activeCwd },
    activeCwd,   // ← new: use worktree cwd on reroute; falls back to REPO_ROOT on first pass
);
```

`runCodex` signature: `(prompt, interactive, resumeId, model, effort, metricsContext?, cwd = REPO_ROOT, wrapForResume?)`. The 7th positional is `cwd`.

**File**: `scripts/run-task/phases/plan.ts`

Same fix — `activeCwd` is already computed at line ~L24. Add as the 7th positional arg to `runClaude`:

```typescript
const result = await runClaude(
    promptPlan(state), interactive, null, cfg.model, cfg.effort,
    { taskId: taskIds.join('+'), phase: 'plan', iteration: ..., activeCwd },
    activeCwd,   // ← new
);
```

On first pass, `getActiveCwd` returns `REPO_ROOT` — no behavior change. On reroute (worktree exists), returns worktree path.

---

## Step 5 — `retryAgentForPhase()` reroute cwd (AC-13)

**File**: `scripts/run-task/main.ts`, function `retryAgentForPhase()` (~L2269)

`status` is already read at the top of the function: `const status = splitState.readStatus(taskId);`

Change:
```typescript
// spec/spec_review/plan/qa always run in REPO_ROOT.
const isWorktreePhase = phase === 'implement' || phase === 'code_review';
```

To:
```typescript
// implement and code_review always use the worktree.
// spec_review uses the worktree only on reroute — when a fresh session is created
// in activeCwd (AC-11/AC-12); on first pass there is no worktree yet, so REPO_ROOT is correct.
// spec/plan/qa always use REPO_ROOT.
const isWorktreePhase = phase === 'implement' || phase === 'code_review' ||
    (phase === 'spec_review' && status.phases.implement?.rerouted === true);
```

---

## Step 6 — New template: `spec-review-reroute.md` (AC-3)

**File**: `scripts/run-task/prompts/templates/spec-review-reroute.md` (new)

```mustache
You are reviewing an amended spec for {{taskScope}} for {{projectName}}.

{{{startup}}}

A human has rerouted this task from human review back to spec review. The original spec was already reviewed and approved. Your job is to review **only the amendment and its integration** — not to re-litigate previously approved ACs.

{{{roundBanner}}}
Tasks with amendments to review:
{{{taskLines}}}

**Amendment review scope** (for each task):
1. Read `tasks/<id>/spec.md` from your current directory. Locate the `## Amendment` section (round 1) or `## Amendment Round N` section (round N ≥ 2) — the exact heading is listed in the per-task line above.
2. Read `tasks/<id>/spec-review.md` (the prior review of the original spec) so you do not re-raise already-settled findings.
3. Review the amendment across three dimensions:
   - **The amendment itself**: implementable as written? ACs verifiable and unambiguous? Edge cases handled?
   - **Integration with approved ACs**: does the amendment contradict or conflict with previously approved ACs? Gaps between old and new ACs? Does the amendment assume something the existing spec rules out?
   - **Overall shape**: with the amendment included, is the spec still coherent? New scope-expansion that changes complexity?
4. Do **not** read `handoff.md`, `review.md`, or `done.md` — this review stays in the spec domain.

Grounding rule: if a finding depends on a symbol or file, re-open it before claiming it exists.

**Verdict rules** (same as normal spec review):
- `changes_requested` — one or more blocking findings. Human must revise the amendment and re-run.
- `approved_with_nits` — no blockers; non-blocking observations only. Loop exits immediately.
- `approved` — no findings.

For each task, append a new round section to `tasks/<id>/spec-review.md` (do not overwrite the prior review). Set your verdict.

When done, run (one per task with actual verdict):
{{{phaseCommands}}}

<!-- per-round append shape (for reroute rounds):
## Amendment Review [Round N]
> ...verdict and findings...
-->
```

---

## Step 7 — New template: `plan-reroute.md` (AC-4)

**File**: `scripts/run-task/prompts/templates/plan-reroute.md` (new)

```mustache
You are updating the implementation plan for {{taskScope}} for {{projectName}} after a human reroute.

{{{startup}}}

The spec was amended after human review and a Codex review of the amendment is complete. Your job is to **append** a reroute plan section to `plan.md` — do not rewrite or remove existing plan content.

{{{roundBanner}}}
Amendment review verdicts:
{{{verdictLines}}}

For each task:
1. Read `tasks/<id>/spec.md` (the worktree copy with the amendment) to understand the full spec.
2. Read `tasks/<id>/plan.md` to understand what was already planned.
3. Read `tasks/<id>/handoff.md` to understand what Codex previously shipped.
4. Read `tasks/<id>/spec-review.md` (the latest reroute amendment review) for any nits to incorporate.
5. **Append** a new section to `tasks/<id>/plan.md`:
   - Round 1: `## Reroute Plan`
   - Round N ≥ 2: `## Reroute Plan Round N` (N = this task's reroute round, listed above)
6. The reroute plan section describes **only the delta** — what must change relative to what was already implemented. Reference specific files, functions, and patterns. Acknowledge existing work that remains correct ("Steps 1–3 of the original plan still apply") without re-planning it.

Do **not** rewrite or remove any existing sections from `plan.md`. The appended section is what implement-reroute reads as its guide.

When done, run:
{{{phaseCommands}}}

<!-- per-round append shape:
## Reroute Plan [Round N]
### Delta
- ...ordered steps for the amendment delta only...
-->
```

---

## Step 8 — Register templates in `prompts/index.ts` (AC-8)

**File**: `scripts/run-task/prompts/index.ts`

Add imports with the existing import block:
```typescript
import specReviewRerouteTemplate from './templates/spec-review-reroute.md';
import planRerouteTemplate from './templates/plan-reroute.md';
```

Add to `TEMPLATES`:
```typescript
'spec-review-reroute.md': specReviewRerouteTemplate,
'plan-reroute.md': planRerouteTemplate,
```

---

## Step 9 — `promptSpecReview()` reroute dispatch (AC-3)

**File**: `scripts/run-task/prompts/index.ts`, function `promptSpecReview()`

Add reroute dispatch at the top of the function. The `rerouteCount` field already exists on `TaskContext` (used in `promptImplementReroute`). The per-task line pattern mirrors `promptImplementReroute`'s `taskLines`:

```typescript
export function promptSpecReview(state: PipelineState): string {
    const { tasks, tier } = state;
    const isReroute = tasks.some(t => t.status.phases.implement?.rerouted === true);

    if (isReroute) {
        const roundBanner = tasks.length === 1
            ? (() => {
                const count = tasks[0].rerouteCount;
                return count <= 1
                    ? `**This is a reroute amendment review (round 1).** Review the \`## Amendment\` section.\n\n`
                    : `**This is reroute amendment review round ${count}.** Review the \`## Amendment Round ${count}\` section.\n\n`;
            })()
            : `**This is a reroute amendment review for a bundle.** Each task has its own round — see per-task lines below for the exact heading.\n\n`;
        const taskLines = tasks.map(t => {
            const heading = t.rerouteCount <= 1
                ? '`## Amendment`'
                : `\`## Amendment Round ${t.rerouteCount}\``;
            return `- \`${t.taskId}\`: "${t.title}" → review ${heading} in tasks/${t.taskId}/spec.md`;
        }).join('\n');
        return render('spec-review-reroute.md', {
            projectName: config.projectName,
            startup: CODEX_STARTUP,
            taskScope: tasks.length > 1 ? 'a bundle of amended specs' : 'an amended spec',
            roundBanner,
            taskLines,
            phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'spec_review', 'done', '<verdict>'),
        });
    }

    // Non-reroute path (existing code):
    const combined = tier === 'fast';
    const fullSendActive = tasks.some(t => t.status.full_send === true);
    const taskLines = tasks.map(t =>
        `- \`${t.taskId}\`: "${t.title}" → tasks/${t.taskId}/spec.md${combined ? ` and tasks/${t.taskId}/plan.md` : ''}`
    ).join('\n');
    return render('spec-review.md', {
        projectName: config.projectName,
        startup: CODEX_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of specs' : 'a spec',
        taskLines,
        combined,
        isBundle: tasks.length > 1,
        fullSendActive,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'spec_review', 'done', '<verdict>'),
    });
}
```

---

## Step 10 — `promptPlan()` reroute dispatch (AC-4)

**File**: `scripts/run-task/prompts/index.ts`, function `promptPlan()`

```typescript
export function promptPlan(state: PipelineState): string {
    const { tasks } = state;
    const isReroute = tasks.some(t => t.status.phases.implement?.rerouted === true);

    if (isReroute) {
        const roundBanner = tasks.length === 1
            ? (() => {
                const count = tasks[0].rerouteCount;
                return count <= 1
                    ? `**Reroute round 1** — append \`## Reroute Plan\` to plan.md.\n\n`
                    : `**Reroute round ${count}** — append \`## Reroute Plan Round ${count}\` to plan.md.\n\n`;
            })()
            : `**Bundle reroute** — each task has its own round; use the per-task round numbers in the verdicts below.\n\n`;
        const verdictLines = tasks.map(t =>
            `- \`${t.taskId}\`: amendment review = ${t.specReviewVerdict} (reroute round ${t.rerouteCount})`
        ).join('\n');
        return render('plan-reroute.md', {
            projectName: config.projectName,
            startup: CLAUDE_STARTUP,
            taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
            roundBanner,
            verdictLines,
            phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'plan', 'done'),
        });
    }

    // Non-reroute path (existing code):
    const verdictLines = tasks.map(t =>
        `- \`${t.taskId}\`: spec review verdict = ${t.specReviewVerdict}`
    ).join('\n');
    return render('plan.md', {
        projectName: config.projectName,
        startup: CLAUDE_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        verdictLines,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'plan', 'done'),
    });
}
```

---

## Step 11 — Update `implement-reroute.md` to read reroute plan (AC-7)

**File**: `scripts/run-task/prompts/templates/implement-reroute.md`

In the "How to approach this:" numbered list, the current step 1 reads the amended spec and step 2 reads handoff. Insert a new step 2 between them:

```
2. Check `tasks/<id>/plan.md` for a `## Reroute Plan` section (round 1) or `## Reroute Plan Round N` section (N = this task's reroute round, listed above). If present, use it as your delta guide — it describes only the work added by the amendment. If absent (fast-tier reroute with no conversational reroute plan), read the base plan for orientation.
```

Renumber the original step 2 (read handoff) to step 3, step 3 (identify delta) to step 4, and so on.

---

## Step 12 — Tests: `run-task-reroute-preflight.test.ts` (ACs 1, 2, 5, 6, 12, 13)

**File**: `tests/run-task-reroute-preflight.test.ts`

Use the existing subprocess test pattern (spawn `rerouteFromHumanReview` via the module-import mechanism already established in this file). Add these test cases:

**AC-1: Full-tier resets spec_review + plan**
```
test('rerouteFromHumanReview full-tier resets spec_review and plan to pending')
  - task_size: 'M', spec_review done approved, plan done, implement done, code_review done, qa done, human_review in_progress
  - run rerouteFromHumanReview
  - assert: phases.spec_review.status === 'pending', verdict === '', iterations_current_loop === 0
  - assert: phases.plan.status === 'pending'
  - assert: phases.spec_review.iterations_total preserved (if set)
  - assert: phases.implement.reroute_count === 1, rerouted === true
  - assert: derived top-level phase is 'spec_review'
```

**AC-1: Fast-tier leaves spec_review + plan untouched**
```
test('rerouteFromHumanReview fast-tier does NOT reset spec_review or plan')
  - task_size: 'S', delicate: false — same phase setup
  - run rerouteFromHumanReview
  - assert: phases.spec_review.status === 'done' (unchanged)
  - assert: phases.plan.status === 'done' (unchanged)
  - assert: derived top-level phase is 'implement'
```

**AC-2: Messaging**
```
test('rerouteFromHumanReview full-tier emits spec_review messaging')
  - capture stderr; assert includes 'spec_review'
  
test('rerouteFromHumanReview fast-tier emits implement messaging')
  - capture stderr; assert includes '→ implement'
```

**AC-5: Option B — bundle reroute, mixed verdicts**
```
test('checkAndRoute spec_review reroute+changes_requested resets all tasks and exits without touching spec phase')
  - two tasks, both implement.rerouted = true; task A spec_review = changes_requested, task B = approved
  - run checkAndRoute
  - assert: both tasks spec_review.status === 'pending' after exit
  - assert: neither task's phases.spec.status was modified
  - assert: process exited 0 (not routed to routeBackTo('spec'))
```

**AC-5: First-pass changes_requested still routes to spec (regression guard)**
```
test('checkAndRoute spec_review non-reroute changes_requested routes back to spec')
  - implement.rerouted falsy; spec_review = changes_requested
  - assert: phases.spec.status === 'pending' after (routeBackTo fired)
```

**AC-6: Flow-through on reroute approval**
```
test('checkAndRoute spec_review reroute+approved advances to plan without hitting spec gate')
  - implement.rerouted = true; spec_review = approved; human_spec_gate = false
  - assert: pipeline does NOT exit at spec gate; derived next phase is 'plan'
```

**AC-12: Session slot cleared on full-tier reroute**
```
test('rerouteFromHumanReview full-tier clears sessions.codex_spec_review')
  - full-tier task with sessions.codex_spec_review = 'some-session-id' set
  - run rerouteFromHumanReview
  - read written status; assert: status.sessions.codex_spec_review === undefined
```

**AC-13: retryAgentForPhase uses worktree cwd on reroute spec_review**

This test needs to verify the `cwd` argument passed to `runCodex`. Options:
- Spy on `runCodex` (if the module exports it and the test can intercept it)
- Use the subprocess pattern and assert the spawned codex command received the worktree path

Suggested: check that `retryCwd` is the worktree path when `implement.rerouted === true` by creating a fixture worktree directory, verifying that `getActiveCwd([taskId])` returns it, and asserting the retry call used that path.

---

## Step 13 — Tests: `run-task-prompts.test.ts` + golden (ACs 3, 4, 7)

**File**: `tests/run-task-prompts.test.ts`

Follow the existing prompt dispatch + golden test patterns in this file.

**Dispatch tests (non-golden)**:
- `promptSpecReview` returns a string containing `"amendment review"` when `implement.rerouted === true`
- `promptSpecReview` returns the normal `spec-review.md`-based string when `rerouted` is falsy
- `promptPlan` returns a string containing `"Reroute Plan"` when `implement.rerouted === true`
- `promptPlan` returns the normal plan string when `rerouted` is falsy
- Bundle reroute for both: two tasks with different `rerouteCount` values; assert both per-task round numbers appear

**Golden snapshot tests** — add to `tests/run-task-prompts.golden.json`:
- `spec-review-reroute` single-task (rerouteCount = 1)
- `spec-review-reroute` single-task (rerouteCount = 2, to verify round-N banner)
- `spec-review-reroute` bundle (two tasks, mixed counts)
- `plan-reroute` single-task
- `plan-reroute` bundle
- `implement-reroute` — update existing golden to include the new reroute plan read step

Generate the golden file after all templates are written: run the test suite with `--update-snapshots` (or the project's equivalent golden-regen command) and inspect the diff to confirm the output is correct before committing.

---

## Step 14 — Docs updates (AC-10)

**File**: `docs/pipeline-orchestrator.md` §Human Reroute

Rewrite to describe:
- **Full-tier reroute flow**: `human_review` → `spec_review` (Codex reviews amendment in context of prior approved ACs) → `plan` (Claude appends reroute plan section) → `implement` (Codex reads reroute plan delta + amendment)
- **Option B**: if Codex requests changes on the amendment, pipeline exits with files to revise; human revises amendment and re-runs `canon run <id>` (not `--reroute`); `--reroute` would increment `reroute_count` again
- **B2 flow-through**: on `approved`, pipeline continues to `plan` without re-arming spec gate
- **Fast-tier**: unchanged — reroute still enters at `implement`; operator may optionally append `## Reroute Plan` to `plan.md` conversationally before running
- **`--step --expect` note**: for a full-tier reroute, `--step --expect spec_review`; for a fast-tier reroute, `--step --expect implement` (unchanged)

**File**: `CLAUDE.md` (Quick Refs — reroute section)

Add/update:
```
- Full-tier reroute re-enters at spec_review: use `canon run <id> --step --expect spec_review` to advance one phase at a time.
- Fast-tier reroute is unchanged (enters at implement). Optionally append `## Reroute Plan` to plan.md before running — implement-reroute reads it when present.
- After an Option B block (amendment rejected): revise the amendment in spec.md, then `canon run <id>` (not `--reroute`).
```

`templates/CLAUDE.md` auto-syncs from `CLAUDE.md` via the pre-commit hook — no manual edit.

---

## Step 15 — Build and validate (AC-14)

```bash
npm run lint
npm run type-check
npm test
npm run build
git -C <worktree> diff --exit-code -- dist/
npm run docs-refs-check
npm run sync-templates:check
```

Record all outcomes in `handoff.md`.

---

## Testing Plan

- **Unit (reroute-preflight)**: AC-1 (full/fast tier reset), AC-2 (messaging), AC-5 (Option B bundle), AC-6 (flow-through), AC-12 (session clear), AC-13 (retry cwd)
- **Unit (prompts)**: AC-3/AC-4 dispatch; AC-7 golden delta
- **Golden**: regenerate `run-task-prompts.golden.json` for new templates and updated implement-reroute
- **E2E**: N/A
- **Manual (Human Test Plan)**: four scenarios in spec (full-tier happy path, full-tier Option B, fast-tier unchanged, round-2 reroute)

## Rollback Plan

All changes are additive or behavioral modifications to the reroute path (which only activates on `--reroute`). Rollback: revert commits touching this task. No data migration — no new `status.json` fields. Tasks in flight that have not been rerouted are unaffected. Tasks mid-reroute (spec_review pending with `rerouted = true`) would need their `spec_review.status` manually reset to `done` and `plan.status` manually set back to `done` if rolling back after a partial reroute.

---

## File Checklist

| File | ACs |
|---|---|
| `scripts/run-task/main.ts` | AC-1, AC-2, AC-5, AC-6 (test), AC-9, AC-12, AC-13 |
| `scripts/run-task/phases/spec-review.ts` | AC-11 |
| `scripts/run-task/phases/plan.ts` | AC-11 |
| `scripts/run-task/prompts/index.ts` | AC-3, AC-4, AC-8 |
| `scripts/run-task/prompts/templates/spec-review-reroute.md` | AC-3 (new) |
| `scripts/run-task/prompts/templates/plan-reroute.md` | AC-4 (new) |
| `scripts/run-task/prompts/templates/implement-reroute.md` | AC-7 |
| `docs/pipeline-orchestrator.md` | AC-10 |
| `CLAUDE.md` | AC-10 |
| `templates/CLAUDE.md` | AC-10 (auto-synced, pre-commit hook) |
| `dist/` | AC-14 (build artifact) |
| `tests/run-task-reroute-preflight.test.ts` | AC-1, AC-2, AC-5, AC-6, AC-12, AC-13 |
| `tests/run-task-prompts.test.ts` | AC-3, AC-4, AC-7 |
| `tests/run-task-prompts.golden.json` | AC-3, AC-4, AC-7 |

---

## Reroute Plan — Amendment 1 (AC-15 / AC-16: round-aware reroute evidence gate)

> Appended after PR #125's Codex review found two stale-evidence bypasses in the reroute path. Fixed **inline** (the installed `canon` runs the old release/v1.9 reroute, so `--reroute` wouldn't exercise the new code) with `codex review` as the gate. The AC-1…AC-14 plan above is unchanged.

**Problem.** On a reroute, `spec-review.md` and `plan.md` already carry the original first-pass content, so the phase-completion gates accept stale evidence: `spec_review` could advance on the original `- [x] Approved` (P1), and `plan` could advance with no fresh `## Reroute Plan` (P2). The requirement must hold at all four gate×phase sites — `{tryEvidenceAdvance, checkPhaseGate} × {spec_review, plan}` — so it is centralized rather than patched per-site.

**Approach — one shared invariant.**

1. **`scripts/run-task/validation.ts`**
   - `sliceRerouteRoundSection(content, label, round)`: returns the current round's section (`## Amendment Review` / `## Reroute Plan`; round 1 = bare, round N≥2 = `… Round N`), fence- and HTML-comment-aware (comment tracking precedes fence tracking; heading-like lines inside fences/comments don't truncate the section before the verdict).
   - `checkRerouteEvidence(phase, content, status)`: the single source of truth. `{reroute:false}` when not a reroute; `ok:false` when `reroute_count` is missing/`<1`, when the round section is absent, or (spec_review) when its verdict box is unchecked; returns the **section-scoped** verdict for spec_review.
2. **`scripts/run-task/main.ts`** — `tryEvidenceAdvance` spec_review + plan call `checkRerouteEvidence` after a guarded `readStatus` that fails closed (`advanced:false`) on unreadable status, since `recoverPhaseForTask` does not catch throws.
3. **`scripts/run-task/validation.ts` `checkPhaseGate`** — for reroute-capable phases (spec_review, plan), read `status.json` from the artifact's taskDir; **fail closed** if missing/unreadable/malformed; otherwise call `checkRerouteEvidence` *before* the verdict-match block (so `plan` is gated too — closing the manual `canon task phase plan done` bypass) and source the spec_review verdict from the section.
4. **`scripts/run-task/prompts/templates/spec-review-reroute.md`** — instruct a verdict **checkbox** inside the Amendment Review section plus the explicit round-1/round-N heading convention so template and gate agree.
5. **Tests** — `tests/run-task-reroute-preflight.test.ts` (slicer + `checkRerouteEvidence` units + `tryEvidenceAdvance` subprocess behavior); `tests/run-task-validation.test.ts` (`checkPhaseGate` plan-reroute bypass, spec_review verdict scope, fail-closed on missing/malformed status).

### Affected Files (Amendment 1 addendum)

| File | AC |
|---|---|
| `scripts/run-task/validation.ts` | AC-15, AC-16 (`sliceRerouteRoundSection`, `checkRerouteEvidence`, `checkPhaseGate`) |
| `scripts/run-task/main.ts` | AC-15, AC-16 (`tryEvidenceAdvance`) |
| `scripts/run-task/prompts/templates/spec-review-reroute.md` | AC-15 (verdict-checkbox convention) |
| `tasks/reroute-spec-review-symmetry/spec.md` | AC-15, AC-16 (amendment + ACs) |
| `tests/run-task-reroute-preflight.test.ts` | AC-15, AC-16 |
| `tests/run-task-validation.test.ts` | AC-15, AC-16 (`checkPhaseGate` reroute) |
| `dist/` | AC-14 (rebuilt) |
