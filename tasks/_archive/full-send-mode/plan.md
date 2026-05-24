# Implementation Plan: full-send-mode

> Written by: Claude | Implements: `tasks/full-send-mode/spec.md`
> Spec review verdict: `approved_with_nits`

## Nits addressed

- **AC-8(e) "5 seconds"**: treat as a plain conversational pause in the skill — no timed wait primitive. The skill prints the high-commitment block and waits for the user's natural next turn.
- **`--full-send` + `--push`/`--pr` precedence**: full-send checks first in `runPhase('human_review')`. If the full-send tail fires, the `--pr`/`--push` path is never reached. Document in a comment. No die-on-combination needed — intent is unambiguous.

## Approach

Implement in two layers: (1) scaffold the new status.json field + CLI surface (types, templates, cli.ts, src/cli/index.ts), then (2) wire the orchestrator logic in main.ts. Prompt injection and skill changes are independent of each other and of main.ts, so they can be done in any order once types exist.

---

## Steps

### Step 1 — `scripts/run-task/types.ts`: Add `full_send` and `force`/`fullSend` fields

Files: `scripts/run-task/types.ts`

**1a. `StatusJson`** (around line 84): add `full_send?: boolean` between `human_spec_gate` and `worktree`:

```typescript
/**
 * When true: collapses human_spec_gate (skips spec gate) and auto-advances
 * human_review after a clean QA pass by running the --pr flow inline.
 * Future human-interrupt gates should honor this flag by convention — see
 * AGENTS.md "Full-send mode".
 */
full_send?: boolean;
```

**1b. `CliArgs`** (around line 108): add `fullSend: boolean` and `force: boolean` after `dryRun`. Both default to `false` from `parseArgs`.

---

### Step 2 — Status templates: Add `full_send` field

Files: `.canon/templates/status.json` AND `templates/.canon/templates/status.json` (edit both in the same logical change — lockstep rule)

In each file, insert `"full_send": false` between `"human_spec_gate": true` and `"worktree": true`. Add a documentation line after `_verdict_values`:

```json
"_full_send": "true → skip spec gate + auto-open draft PR after clean QA. See AGENTS.md Full-send mode."
```

---

### Step 3 — `scripts/run-task/cli.ts`: Parse `--full-send`, `--force`, and mutual exclusion

Files: `scripts/run-task/cli.ts`

**3a. Locals** (after `let dryRun = false;`): add:
```typescript
let fullSend = false;
let force = false;
```

**3b. Switch cases** (before the `default` case at line 89):
```typescript
case '--full-send':
    fullSend = true;
    break;
case '--force':
    force = true;
    break;
```

**3c. Mutual exclusion guard** (AC-6) — after the switch loop, before `if (taskIds.length === 0)`:
```typescript
if (reroute && fullSend) {
    die('--reroute and --full-send are mutually exclusive in a single invocation. Run --reroute first, then --full-send if you want to re-trust the result.');
}
```

**3d. Return** (line 96): add `fullSend` and `force` to the returned object.

**3e. `printUsage()`** (after the `--dry-run` line):
```
'  --full-send          Skip spec gate + auto-open draft PR after clean QA'
'  --force              Acknowledge high-commitment combinations (currently: --full-send on a delicate task)'
```

---

### Step 4 — `src/cli/index.ts`: Update top-level help

Files: `src/cli/index.ts`

In the `canon run options` block (lines 53–64), add after the `--reroute` line:
```
  --full-send         Skip spec gate + auto-open draft PR after clean QA
  --force             Acknowledge high-commitment combinations (currently: --full-send on a delicate task)
```

---

### Step 5 — `scripts/run-task/main.ts`: Six hunks

Work in this order — each hunk builds on the previous.

#### 5a. Refactor `commitHumanReviewFiles` to accept `createPR: boolean` (AC-4a)

Current signature (line 867): `function commitHumanReviewFiles(taskIds: string[], cwd: string): void`

New signature: `function commitHumanReviewFiles(taskIds: string[], cwd: string, createPR: boolean): void`

Three internal changes inside the function:
1. **Idempotent-retry guard** (line 882): `(cliArgs.pr || cliArgs.push)` → `(createPR || cliArgs.push)`
2. **PR call in idempotent branch** (line 906): `if (cliArgs.pr) reportOrCreatePR(...)` → `if (createPR) reportOrCreatePR(...)`
3. **PR call in normal branch** (line 990): `if (cliArgs.pr) reportOrCreatePR(...)` → `if (createPR) reportOrCreatePR(...)`

Update existing call sites to pass `cliArgs.pr`:
- `human_review` branch (line 1760): `commitHumanReviewFiles(taskIds, cwd, cliArgs.pr)`
- `complete` branch (line 1782): `commitHumanReviewFiles(taskIds, cwd, cliArgs.pr)`

#### 5b. Add `shouldRunFullSendTail` helper

Add just before `runPhase`:

```typescript
function shouldRunFullSendTail(taskIds: string[]): boolean {
    return taskIds.every(id => {
        const s = splitState.readStatus(id);
        return s.full_send === true &&
            s.phases.qa?.status === 'done' &&
            s.phases.human_review?.status === 'pending';
    });
}
```

#### 5c. Full-send tail in `runPhase('human_review')` (AC-4, 4a–4e, 5, 7)

Replace the `human_review` block in `runPhase` (starting at line 1756) with:

```typescript
if (phase === 'human_review') {
    const taskIds = tasks.map(t => t.taskId);

    // Full-send takes priority over --pr/--push: if full_send is active and
    // qa is done, run the tail regardless of whether --pr was also passed.
    if (shouldRunFullSendTail(taskIds)) {
        // AC-4c: reject multi-branch bundles.
        const branches = new Set(taskIds.map(id => resolveTaskBranchName(id)));
        if (branches.size !== 1) {
            die(
                `Full-send tail aborted: bundle spans multiple branches (${[...branches].join(', ')}). ` +
                `Today's --pr flow operates on one branch per invocation; multi-branch full-send is out of scope. ` +
                `Run each branch's tasks as a separate invocation.`
            );
        }

        const branch = [...branches][0];
        const cwd = splitWorktree.getActiveCwd(taskIds);
        const tasksRootForGate = process.env.CANON_TASKS_DIR_OVERRIDE ?? path.join(cwd, 'tasks');

        // AC-4: run human_review gate per task. Halt if any fails.
        for (const taskId of taskIds) {
            const gateResult = splitValidation.checkPhaseGate(
                taskId,
                'human_review',
                undefined,
                tasksRootForGate,
            );
            if (!gateResult.ok) {
                die(`Full-send gate failed for '${taskId}': ${gateResult.reason}`);
            }
        }

        // AC-4a: invoke the PR-creating path.
        // IMPORTANT (AC-5): write human_review.status = 'done' ONLY after
        // commitHumanReviewFiles returns — bundle atomicity requires all
        // tasks advance together or not at all.
        commitHumanReviewFiles(taskIds, cwd, true);

        for (const taskId of taskIds) {
            const s = splitState.readStatus(taskId);
            if (s.phases.human_review) s.phases.human_review.status = 'done';
            splitState.writeStatus(taskId, s);
        }

        // AC-4b: capture PR URL via inspectCompleteState (same path the
        // complete-state banner uses — avoids refactoring reportOrCreatePR).
        const completeState = inspectCompleteState(branch, taskIds);
        let prUrl: string;
        if (completeState.kind === 'open_pr') {
            prUrl = completeState.prUrl ?? '(PR URL unavailable — check GitHub)';
        } else {
            warn(`Full-send: PR URL unavailable for branch ${branch}; expected open PR after --pr step`);
            prUrl = '(PR URL unavailable — check GitHub)';
        }

        // AC-7: completion banner.
        console.log('');
        console.log('════════════════════════════════════════════════════════');
        console.log('  ✅ FULL-SEND COMPLETE — draft PR open.');
        console.log('');
        console.log(`  PR: ${prUrl}`);
        console.log('');
        console.log(`  Merge at your discretion via \`canon run ${taskIds.join(' ')} --ship\`,`);
        console.log('  or via GitHub once the PR is marked ready.');
        console.log('════════════════════════════════════════════════════════');
        console.log('');
        process.exit(0);
    }

    // Normal --push / --pr path (only when full-send is NOT active).
    if (cliArgs.push || cliArgs.pr) {
        const cwd = splitWorktree.getActiveCwd(taskIds);
        commitHumanReviewFiles(taskIds, cwd, cliArgs.pr);
        process.exit(0);
    }

    console.log('');
    console.log('════════════════════════════════════════════════════════');
    console.log('  HUMAN REVIEW — no push requested.');
    console.log('');
    console.log('  Done files:');
    for (const taskId of taskIds) {
        console.log(`  tasks/${taskId}/done.md`);
    }
    console.log('');
    console.log('  Re-run with --push to commit task artifacts and push, or --pr to also create a draft PR.');
    console.log('════════════════════════════════════════════════════════');
    console.log('');
    process.exit(0);
}
```

#### 5d. Spec-gate short-circuit in `checkAndRoute` (AC Design hunk a)

In `checkAndRoute`, `spec_review` case (line 2079):

```typescript
// Before:
if (tier === 'full' && statuses.some(s => s.human_spec_gate)) {

// After:
if (tier === 'full' && statuses.some(s => s.human_spec_gate) && !statuses.some(s => s.full_send === true)) {
```

This short-circuits the spec-gate display when full-send is active. The `human_spec_gate` flag was already cleared by the `--full-send` invocation, but this guard handles the case where the flag is `true` and `full_send` is also `true` (e.g., status.json was hand-edited with conflicting values — spec says "full-send wins").

#### 5e. `rerouteFromHumanReview` — clear `full_send` (AC-6)

In `rerouteFromHumanReview` (line 1631), inside the per-task loop, after the `humanReview.status = 'pending'` block:

```typescript
// AC-6: reroute clears full_send — a reroute means the prior result needed
// correction; the human should re-engage before another PR auto-opens.
const s = splitState.readStatus(taskId);
if (s.full_send === true) {
    s.full_send = false;
    splitState.writeStatus(taskId, s);
}
```

After the existing `info()` messages at lines 1675–1680, add:

```typescript
splitCli.info('⚠  full_send cleared. Reroutes indicate the prior result needed correction; re-engage at human_review to verify the fix before another PR opens. Re-enable with \'canon run --full-send <id>\' if you\'re confident.');
```

Note: the existing loop at lines 1639–1673 already calls `splitState.writeStatus(taskId, status)` per task. The `full_send` clear should be added inside that same loop rather than re-reading status. Refactor accordingly: add `if (status.full_send === true) status.full_send = false;` before the `splitState.writeStatus` call in the existing loop.

#### 5f. `main()` — write `full_send` + delicate check (AC-2, 3)

In `main()` (around line 2178), after `if (cliArgs.reroute) { rerouteFromHumanReview(...) }` and before `const { taskIds } = cliArgs;`, insert:

```typescript
// AC-2: --full-send writes full_send: true + human_spec_gate: false before
// any phase routing. Retroactive use (on a mid-pipeline task) is intentional
// — the field-write is idempotent.
if (cliArgs.fullSend) {
    for (const taskId of cliArgs.taskIds) {
        const s = splitState.readStatus(taskId);
        s.full_send = true;
        s.human_spec_gate = false;
        splitState.writeStatus(taskId, s);
    }
}

// AC-3: delicate + full_send requires --force. Fires whether full_send came
// from --full-send this invocation OR was already in status.json (hand-edit).
for (const taskId of cliArgs.taskIds) {
    const s = splitState.readStatus(taskId);
    if (s.full_send === true && s.delicate === true && !cliArgs.force) {
        die(
            `--full-send on delicate task '${taskId}' requires --force. ` +
            `Canon's full-model review chains still run on delicate tasks under full-send, ` +
            `but the combination is a high-commitment stance. Re-run with --force to acknowledge.`
        );
    }
}
```

---

### Step 6 — Spec-review prompt: full-send injection (AC-11)

Files: `scripts/run-task/prompts/templates/spec-review.md` and `scripts/run-task/prompts/index.ts`

**6a. Template** (`spec-review.md`):

After the "Batch related nits" paragraph (line 34) and before "If you encounter surprising codebase behavior" (line 36), insert:

```
{{#fullSend}}

**Full-send mode active**: The human grilled Claude to resolve the decision tree but did not read this spec before pipeline execution. Your review is the primary rigor layer before implementation. Apply your existing review rubric, but raise the bar specifically on: (1) missed cases the spec's ACs might overlook; (2) scope drift between the Decision section and the ACs; (3) ambiguity in AC verification steps. Verdict thresholds are unchanged; expectations for thoroughness are higher.
{{/fullSend}}
```

**6b. `promptSpecReview`** (`prompts/index.ts`, around line 123):

In the `render('spec-review.md', {...})` call, add:

```typescript
fullSend: tasks.some(t => t.status.full_send === true),
```

---

### Step 7 — Skill files (AC-8, AC-9)

Files: `.claude/skills/canon-spec/SKILL.md` AND `templates/.claude/skills/canon-spec/SKILL.md` (edit both in lockstep)

**7a. Frontmatter `description`**: Append: `" Also supports full-send mode: if the human's request includes 'full send' / 'full-send' / --full-send, the skill runs spec → pipeline → draft PR without further interrupts."`

**7b. Detection block**: Add immediately after the `---` that ends the frontmatter section (before "# Spec Authorship"):

```markdown
## Full-send mode

Scan `$ARGUMENTS` before Phase 1:
- **Explicit flag**: `--full-send` appears in `$ARGUMENTS`
- **Natural language**: case-insensitive match of the phrase `full send` or `full-send` in `$ARGUMENTS` (match as a phrase, not as part of another word — e.g., "spec about full-send mode" is a content description, not a mode invocation; prefer requiring the phrase at the start or end of `$ARGUMENTS`, or following a natural delimiter, to reduce false positives)

If either matches, set `FULL_SEND_MODE=true` for this skill run. Print immediately (before loading any context):

> Full-send mode detected. I'll grill, write the spec, and run the pipeline through to a draft PR without further interrupts.

This gives the human a chance to redirect before grilling begins.
```

**7c. Phase 5 — Write spec, step 3 (spec.md writing)**: After step 3 and before step 4, add:

```markdown
3a. If `FULL_SEND_MODE=true`, insert the full-send banner near the top of `tasks/TASK-ID/spec.md`, immediately after the title block and before `## Problem`:
    ```
    > **Full-send mode**: This spec was produced in full-send mode.
    ```
```

**7d. Phase 6 — After spec approval**: Modify the pipeline invocation.

For S tasks (current step 3: `canon run TASK-ID`), replace with:
```bash
# Full-send mode:
canon run --full-send TASK-ID
# Normal mode:
canon run TASK-ID
```

For full-tier tasks (M, L, XL, delicate), replace the `canon run TASK-ID` line with:
```bash
# Full-send mode:
canon run --full-send TASK-ID
# Normal mode:
canon run TASK-ID
```

**7e. Delicate + full-send** (AC-8e): In Phase 5, step 2 (status.json edit for `delicate`), add after setting `delicate: true`:

```markdown
If `FULL_SEND_MODE=true` AND `delicate: true` was just set, before invoking the pipeline print:

> ⚠ Delicate + full-send: canon's review chains still run with the upgraded model, but no human checkpoint exists before the PR opens. Reply "stop" to abort, or continue (including silence) to proceed.

Wait for the user's next message. If it is "stop" (case-insensitive), halt without invoking the pipeline. Otherwise append `--force` to the invocation: `canon run --full-send --force TASK-ID`.

(This is a plain conversational pause — no timed wait. The user can simply press Enter to proceed.)
```

---

### Step 8 — Documentation files (AC-10)

Edit each pair in lockstep.

#### 8a. `AGENTS.md` and `templates/AGENTS.md`

Add a `### Full-send mode` subsection under `## Workflow`, after the "Bundle mode" paragraph:

```markdown
### Full-send mode

Full-send mode collapses two human interrupt points — the `human_spec_gate` (between spec_review and plan) and the `human_review` stop (after QA) — into zero. When active, the pipeline runs spec_review → plan → implement → code_review → QA → draft PR open without stopping.

**What it skips**: the spec-gate interrupt and the post-QA stop-before-PR.
**What it does NOT skip**: Codex spec_review, Claude code_review, the `checkPhaseGate` human_review invariant, and the auto-block halt.

**When to use**: when the human has committed to the task at creation, trusts canon's review chains end-to-end, and wants to engage at the PR rather than at intermediate gate points.

**Invocation paths**:
- Conversational: `/canon-spec full send this: <description>` — skill grills, writes spec, invokes `canon run --full-send <id>`.
- Direct CLI: `canon run --full-send <id>` — works at task creation OR retroactively to resume a task paused at the spec gate.

**Delicate + full-send**: requires `--force`. Example: `canon run --full-send --force <id>`. Canon's full-model review chains still run on delicate tasks; the `--force` acknowledges the high-commitment stance. (Delicate's mechanism is model upgrade, not human-eyes-required — the guardrails hold.)

**Reroute clears full-send**: `canon run --reroute <id>` resets `full_send` to `false`. Re-enable with `canon run --full-send <id>` after verifying the rerouted implementation.
```

#### 8b. `CLAUDE.md` and `templates/CLAUDE.md`

Under "**Conversational mode**" section (or near the `human_spec_gate` / `canon run <id>` invocation guidance), add a new paragraph:

```markdown
**Full-send detection (operator Claude)**: When the human's natural-language request includes "full send", "full-send", "yolo it", "don't bother me", "no interrupts", or similar signals, pass `--full-send` to the skill: `/canon-spec full send this: <description>`. For direct-CLI retroactive enable (without the skill): invoke `canon run --full-send <id>`. When doing so on a task with `delicate: true` in status.json, append `--force` and surface the high-commitment acknowledgment to the human before invoking (same behavior as the skill's AC-8(e) block — the skill auto-threads `--force`; direct-CLI invocations rely on operator Claude applying the same rule).
```

#### 8c. `CODEX.md` and `templates/CODEX.md`

In `### Reviewing a Spec`, after step 2's bullet list, add:

```markdown
**Full-send rigor**: When `status.json.full_send === true`, your spec_review is the primary rigor layer — the human did not read this spec before pipeline execution. Apply your existing rubric, but raise the bar on: (1) missed cases the ACs might overlook; (2) scope drift between the Decision section and the ACs; (3) ambiguity in AC verification steps. Verdict thresholds are unchanged; thoroughness expectations are higher.
```

---

### Step 9 — Tests (AC-12)

Locate test files:
```bash
grep -rl "parseArgs" tests/   # → CLI test file
grep -rl "canon task new" tests/  # → task-new test file
grep -rl "commitHumanReviewFiles\|checkPhaseGate\|human_review" tests/  # → dispatcher test file
grep -rl "rerouteFromHumanReview\|--reroute" tests/  # → reroute test file
```

Write the following tests in the identified files. If no good match for a group, extend `tests/run-task-validation.test.ts`.

**CLI parsing** (in the parseArgs test file):
- `parseArgs(['--full-send', 'task-id'])` → `{ fullSend: true, force: false, ... }`
- `parseArgs(['--force', 'task-id'])` → `{ force: true, fullSend: false, ... }`
- `parseArgs(['--full-send', '--force', 'task-id'])` → `{ fullSend: true, force: true, ... }`
- `parseArgs(['--reroute', '--full-send', 'task-id'])` → dies with AC-6 mutual-exclusion message

**Default template** (in task-new test file):
- `canon task new <id> "Title"` produces status.json with `full_send: false` AND `human_spec_gate: true`

**Dispatcher — full-send tail** (in dispatcher test file):
- All tasks: `qa.status === 'done'`, `full_send === true`, gate passes → `commitHumanReviewFiles(ids, cwd, true)` called, `human_review.status` → `'done'`
- Gate fails → `human_review.status` stays `pending`, dispatcher dies
- `commitHumanReviewFiles` throws (mock) → `human_review.status` stays `pending`, error propagates

**`commitHumanReviewFiles` refactor** (extend the same dispatcher test file):
- `commitHumanReviewFiles(ids, cwd, false)` pushes but does NOT call `reportOrCreatePR`
- `commitHumanReviewFiles(ids, cwd, true)` pushes AND calls `reportOrCreatePR`
- Idempotent-retry guard keys on `createPR`, not `cliArgs.pr` — set `cliArgs.pr = false`, call with `createPR = true`, verify PR creation fires

**PR URL capture** (same dispatcher test file):
- Successful full-send tail: `inspectCompleteState` called once, banner contains PR URL
- `inspectCompleteState` returns `pushed_no_pr` (mocked): banner contains placeholder `(PR URL unavailable — check GitHub)` AND `human_review.status` still advances

**Multi-branch guard** (same dispatcher test file):
- Bundle tasks map to multiple branches (mock `resolveTaskBranchName`): dies with AC-4c message, no `human_review.status` advances, fires before `checkPhaseGate`

**Reroute** (reroute test file):
- `rerouteFromHumanReview` on task with `full_send: true` → resets `full_send` to `false`
- Output includes `⚠ full_send cleared.` message

**Delicate-vs-full-send**:
- `canon run --full-send` on `delicate: true` task, no `--force` → dies before phase routing
- Same with `--force` → proceeds to phase routing
- `canon run` (no `--full-send`) on status.json with `full_send: true` AND `delicate: true` (hand-edit) → dies absent `--force`

**Retroactive enable**:
- `canon run --full-send` on task with `full_send: false` → rewrites `full_send: true` AND `human_spec_gate: false` before dispatch

---

### Step 10 — `CHANGELOG.md`: New entry

Under `[1.4.0] — unreleased`, add:

```markdown
### Added

- **Full-send mode** (`canon run --full-send <id>`, `/canon-spec full send this: ...`): commit at task creation and let canon run the full pipeline — spec_review, plan, implement, code_review, QA — then auto-open a draft PR. No human interrupt at the spec gate or after QA. The draft PR is the artifact; the human still reviews and merges (or runs `canon run --ship`).
  - `--force` required alongside `--full-send` on delicate tasks (canon's full-model review chains still run; the flag acknowledges the high-commitment stance).
  - `canon run --reroute` clears `full_send` automatically; re-enable with `canon run --full-send` after verifying the rerouted result.
  - Codex spec_review applies higher thoroughness expectations when `full_send: true` (no human checkpoint before plan).
```

---

## Testing Plan

- **Unit**: AC-12 tests (step 9) — CLI parsing, dispatcher logic, `commitHumanReviewFiles` refactor, PR URL capture, multi-branch guard, reroute, delicate check, retroactive enable
- **E2E**: N/A (no UI)
- **Manual**: Human Test Plan in spec.md (8 steps) — run after implementation against a real task

## Rollback Plan

`full_send` defaults to `false` and is optional in `StatusJson` — existing tasks without the field behave identically to today. Reverting the feature is a clean rollback of the affected files with no data migration. In-flight tasks that had `full_send: true` set would need a manual `status.json` edit to clear the field, but the `?:` typing means they would not error — they would just never trigger the full-send tail after the code rolls back.
