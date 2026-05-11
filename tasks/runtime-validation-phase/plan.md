# Plan: runtime-validation-phase

> Written by: Claude | Phase: plan

## Spec review nits incorporated

Three nits from spec-review.md (all non-blocking; inform implementation, no spec changes required):

1. **Mustache-only**: template uses only `{{#flag}}...{{/flag}}` Mustache sections. No Handlebars-only helpers. All conditional values are pre-computed in the builder and passed as plain booleans/strings/arrays.
2. **`artifactReadingHint` source**: sourced at render time from `RUNTIME_CHECKS` by check name. Never parsed from the handoff row (which doesn't carry the hint). See Step 8.
3. **Function signature**: `runRuntimeValidationPhase(taskIds, state, checks?)` per AC-4 with `checks?: readonly RuntimeCheck[]` as test seam. The shortened affected-files table row is wrong; use AC-4's full signature.

---

## Step 1 — `scripts/run-task/types.ts`: Phase + TaskContext (AC-1, AC-9b)

**File**: `scripts/run-task/types.ts`

1. In `PHASE_ORDER` (line 12), insert `'runtime_validation'` between `'implement'` and `'code_review'`:
   ```ts
   export const PHASE_ORDER = ['spec', 'spec_review', 'plan', 'implement', 'runtime_validation', 'code_review', 'qa', 'human_review'] as const;
   ```
   `Phase` is derived from `PHASE_ORDER`, so it auto-updates to include `'runtime_validation'`.

2. In `TaskContext` (lines 80–87), add after `iterations: number`:
   ```ts
   runtimeIterations: number;
   ```

No other changes.

---

## Step 2 — `tasks/_templates/status.json`: new phase block (AC-2)

Add `"runtime_validation"` to the `phases` object between `"implement"` and `"code_review"`:
```json
"runtime_validation": { "status": "pending", "agent": "orchestrator", "verdict": "", "iterations": 0 },
```

**Do not migrate existing `tasks/*/status.json` files** — the back-compat shim in Step 3 handles them at read time.

---

## Step 3 — `scripts/run-task/state.ts`: back-compat shim (AC-2)

In `readStatus()`, after parsing the JSON, add a migration shim before returning:
```ts
if (!parsed.phases.runtime_validation) {
    parsed.phases.runtime_validation = { status: 'done', agent: 'orchestrator', verdict: 'approved', iterations: 0 };
}
```

This ensures `deriveTopLevelStatus()` — which iterates `PHASE_ORDER` and returns the first phase whose status is not `'done'` — skips `runtime_validation` for tasks that pre-date this change. Without the shim, an in-flight task with `implement.status = 'done'` would have no `runtime_validation` entry, `deriveTopLevelStatus` would return `'runtime_validation'` as the current phase (it treats undefined as not-done), and the pipeline would stall.

`deriveTopLevelStatus()` itself needs no changes.

---

## Step 4 — `scripts/pipeline-policy.ts`: RuntimeCheck type + registry (AC-3)

Add to the bottom of `pipeline-policy.ts` after the existing exports:

```ts
export type RuntimeCheck = {
    name: string;
    command: string;
    timeoutMs?: number;
    cwd?: 'worktree' | 'repo_root';
    when?: (status: PolicyInput, affectedFiles: readonly string[]) => boolean;
    artifactPaths?: readonly string[];
    artifactReadingHint?: string;
};

export const RUNTIME_CHECKS: RuntimeCheck[] = [
    { name: 'orchestrator-phase-smoke', command: 'echo orchestrator-phase-smoke-ok' },
];
```

No existing matrix or routing logic changes in this file. The smoke entry has no `when` predicate (runs on every task). `RUNTIME_CHECKS` is configuration data, not a routing-decision matrix — it does not need a row in `pipeline-policy.test.ts`.

---

## Step 5 — `scripts/run-task/validation.ts`: `computeLatestRuntimeResults` (AC-5)

Add new exports at the bottom of `validation.ts`. `parseTable`, `parseTableH3`, and `extractSectionBodies` are already imported at line 4.

```ts
export type RuntimeOutcomeRow = { check: string; result: string; elapsed: string; notes: string };

export function computeLatestRuntimeResults(handoffContent: string): Map<string, RuntimeOutcomeRow> {
    const latest = new Map<string, RuntimeOutcomeRow>();
    const baseline = parseTable(handoffContent, 'Runtime Validation Outcomes');
    for (const row of baseline) {
        const check = (row['Check'] ?? '').trim().replace(/^`|`$/g, '');
        if (!check) continue;
        latest.set(check, {
            check,
            result: row['Result'] ?? '',
            elapsed: row['Elapsed'] ?? '',
            notes: row['Notes'] ?? '',
        });
    }
    const iterationBodies = extractSectionBodies(handoffContent, /^## Iteration\b/);
    for (const body of iterationBodies) {
        const reruns = parseTableH3(body, 'Re-run runtime validation');
        for (const row of reruns) {
            const check = (row['Check'] ?? '').trim().replace(/^`|`$/g, '');
            if (!check) continue;
            latest.set(check, {
                check,
                result: row['Result'] ?? '',
                elapsed: row['Elapsed'] ?? '',
                notes: row['Notes'] ?? '',
            });
        }
    }
    return latest;
}
```

---

## Step 6 — `scripts/run-task/phases/runtime-validation.ts` (NEW) (AC-4, AC-4b, AC-5, AC-6, AC-7, AC-11, AC-13)

Create `scripts/run-task/phases/runtime-validation.ts`. Follow the `code-review.ts` module structure for imports, auto-block, and status update patterns.

### 6a. Imports

```ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { info, warn } from '../cli.js';
import { getMaxReviewLoops } from '../policy.js';
import { runTaskShFor } from '../task-sh.js';
import { autoBlockPhase, resolveTaskCwd, readStatus } from '../state.js';
import { parseHandoffFiles, computeLatestRuntimeResults } from '../validation.js';
import { gitSafeAtRaw, parsePorcelain } from '../git.js';
import { RUNTIME_CHECKS } from '../../pipeline-policy.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import type { RuntimeCheck } from '../../pipeline-policy.js';
```

### 6b. Helper: `sanitizeName(name: string): string`

Replace whitespace with `-`, remove any char not in `[a-zA-Z0-9._-]`. Used for the artifact directory path `runtime-check-output/<sanitized-name>/`.

### 6c. Helper: `runCheck(check, taskId, iterN, worktreeCwd)` — single-check runner

Returns:
```ts
type CheckRunResult = {
    result: 'Pass' | 'Fail' | 'Timeout';
    elapsedMs: number;
    stderrHead512: string;   // first 512 bytes of stderr, for handoff Notes
    artifactDir: string | null;  // null on Pass
};
```

Implementation:

1. **Resolve `cwd`**: `check.cwd === 'repo_root'` → `REPO_ROOT`; default (`'worktree'` or undefined) → `worktreeCwd`. (`REPO_ROOT` is already available in this module — it's used by other phase modules; or import from the env module.)

2. **Pre-check snapshot**: `gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall')`. Parse into `Set<string> preDirty` via `parsePorcelain`. Note: `git status` does not surface gitignored paths — they are invisible here by design.

3. **Artifact scratch dir**: pre-create at check start:
   ```
   tasks/<taskId>/runtime-check-output/<sanitized-name>/iter-<iterN>/
   ```
   resolved from `REPO_ROOT` (not worktree cwd — task artifact paths are repo-root-relative so `syncWorktreeArtifacts` picks them up). Use `fs.mkdirSync(..., { recursive: true })`.

4. **Spawn** (AC-13): `spawn(check.command, { shell: true, cwd, stdio: ['ignore', 'pipe', 'pipe'] })`.

5. **Two-tier capture** (AC-13 steps 1–4):
   - Open `fs.createWriteStream(path.join(artifactScratch, 'stdout.log'))` and `stderr.log` — unbounded, streaming directly to disk.
   - Maintain `let stdoutHeadBytes = 0` and `let stderrHeadBytes = 0` with `headBuf` arrays capped at 2048 bytes total each. Stop appending once full.
   - `child.stdout.on('data', chunk)`: write to WriteStream, append to head buf if not full, pipe to `process.stdout`.
   - `child.stderr.on('data', chunk)`: write to WriteStream, append to head buf if not full, pipe to `process.stderr`.
   - Reset heartbeat timer on any data event.

6. **Heartbeat** (AC-13 step 5): `setInterval(30_000)`. Print `[<name> still running — Xs elapsed; Ys until timeout]` to `process.stderr` IF no data chunk arrived since the last heartbeat tick. Clear interval on process exit.

7. **Timeout** (AC-7): `const timeoutMs = check.timeoutMs ?? resolvedEnvTimeout ?? 10 * 60 * 1000` where `resolvedEnvTimeout = process.env.ORCHESTRATOR_CHECK_TIMEOUT_MS ? parseInt(...) : undefined`. `setTimeout(timeoutMs)` → `child.kill('SIGTERM')` → 3s grace period → `child.kill('SIGKILL')`. Set result to `'Timeout'`.

8. **Wait for exit**: `await new Promise<number | null>(resolve => child.once('close', resolve))`.

9. **Print summary** (AC-13 step 6): to `process.stderr`.

10. **Post-check snapshot**: `gitSafeAtRaw(cwd, 'status', '--porcelain=v1', '-uall')`. Compute `delta = [...postDirty].filter(p => !preDirty.has(p))`.

11. **Artifact preservation** (AC-11 step 4):
    - **If `check.artifactPaths` is set**: for each declared path, resolve relative to `cwd`, copy recursively to `artifactScratch/<path>` if it exists on disk (regardless of `delta` or `git status` visibility — this is the critical gitignored-artifact path). Log `[<name> artifactPath '<p>' not found — skipping]` to stderr for missing paths.
    - **If `check.artifactPaths` is NOT set**: copy all `delta` paths into `artifactScratch` (safety net).
    - The `stdout.log`/`stderr.log` already in `artifactScratch` do not need to be moved.
    - **On Pass**: `fs.rmSync(artifactScratch, { recursive: true, force: true })`. Return `artifactDir: null`.
    - **On Fail/Timeout**: return `artifactDir: artifactScratch`.

12. **Scoped cleanup** (AC-11 step 5): for each path in `delta` where the path does NOT start with `tasks/`:
    - If `git status` shows it as tracked-but-modified: `gitSafeAtRaw(cwd, 'checkout', '--', path)`.
    - If untracked (porcelain prefix `??`): `fs.rmSync(path.join(cwd, p), { recursive: true, force: true })`.
    - **Never use `git stash`, `git clean`, or any other bulk operation** — blanket cleanup erases pre-existing dirty task artifacts (`handoff.md`, `notes.md`, `status.json`) and `syncWorktreeArtifacts` would then propagate the erasure to the main checkout.

13. Return `{ result, elapsedMs, stderrHead512: stderrHeadBuf.slice(0, 512).toString(), artifactDir }`.

### 6d. Main export: `runRuntimeValidationPhase`

```ts
export async function runRuntimeValidationPhase(
    taskIds: string[],
    state: PipelineState,
    checks?: readonly RuntimeCheck[],
): Promise<PhaseRunResult>
```

Implementation:

1. **Auto-block check** (AC-6): mirrors `runCodeReviewPhase` lines 31–41. For each task, read `status.phases.runtime_validation?.iterations ?? 0`. If `maxIter >= getMaxReviewLoops(tasks)`, call `autoBlockPhase(taskIds, 'runtime_validation', maxIter, reason)` and `process.exit(2)`.

2. **Effective registry**: `const registry = checks ?? RUNTIME_CHECKS`.

3. **Filter per task**: for each task, read affected files via `parseHandoffFiles(taskId)`. Filter `registry` by `check.when?.(task.status, affectedFiles) ?? true`. Compute the union of checks that survive filtering for at least one task.

4. **Empty registry / all-filtered** (AC-4b): if no checks remain:
   - For each task, call `runTaskShFor(taskId, 'phase', taskId, 'runtime_validation', 'done', 'approved')`.
   - Do not write any section to `handoff.md`.
   - Return `{ agent: 'claude', sessionId: null, exitCode: 0 }`.

5. **Run checks sequentially**: for each check in the filtered set, call `runCheck(check, taskId, iterN, worktreeCwd)` per task. Collect results into `Map<checkName, CheckRunResult>`.

   The `iterN` for path construction is `status.phases.runtime_validation?.iterations ?? 0` **before** incrementing (the current iteration number, 0-based for the first run). Task.sh increments iterations when the verdict is `changes_requested` (Step 9 adds runtime_validation to the iterations logic).

6. **Write handoff section** (AC-5): for each task, read `handoff.md` from `resolveTaskCwd(taskId)`:
   - **First run** (`runtime_validation.iterations === 0`): insert `## Runtime Validation Outcomes` after `## Validation Outcomes` and before `## Ready for Review`. Include the section intro line and the results table.
   - **Retry** (`iterations > 0`): locate the latest `## Iteration N` section in the handoff content. Append a `### Re-run runtime validation` h3 subsection with the table inside it (mirrors Codex's `### Re-run validation` convention, so `computeLatestRuntimeResults` finds it via `parseTableH3`).
   - Table format:
     ```
     ## Runtime Validation Outcomes
     
     > Authored by the orchestrator after Codex's implement phase. Codex did not run these checks.
     
     | Check | Result | Elapsed | Notes |
     |---|---|---|---|
     | `<name>` | Pass | 0.1s | exit code 0 |
     | `<name>` | Fail | 1.2s | exit code 1; <stderrHead512> artifacts: tasks/<id>/runtime-check-output/<name>/iter-0/ |
     ```
   - Write back to `handoff.md`.

7. **Compute verdict**: `anyFailed = results.some(r => r.result !== 'Pass')`. `verdict = anyFailed ? 'changes_requested' : 'approved'`.

8. **Update status**: for each task:
   ```ts
   runTaskShFor(taskId, 'phase', taskId, 'runtime_validation', 'done', verdict);
   ```
   Task.sh (after Step 9) increments `runtime_validation.iterations` when verdict is `changes_requested`.

9. Return `{ agent: 'claude', sessionId: null, exitCode: anyFailed ? 1 : 0 }`.

---

## Step 7 — `scripts/run-task/main.ts`: wiring (AC-9, AC-9b)

### 7a. Widen `getVerdict()` (line 127)

```ts
function getVerdict(status: StatusJson, phase: 'spec_review' | 'code_review' | 'runtime_validation'): Verdict {
```
No body change — `status.phases[phase]?.verdict` already handles any phase name.

### 7b. Update `buildPipelineState()` (lines 142–154)

In the `tasks` map, add after `iterations: getIterations(statuses[i])`:
```ts
runtimeIterations: statuses[i].phases.runtime_validation?.iterations ?? 0,
```

### 7c. Import + `runPhase` branch

Import `runRuntimeValidationPhase` with the other phase imports at the top.

In `runPhase()`, insert after the `if ((phase as Phase) === 'implement')` block and before the `if ((phase as Phase) === 'code_review')` block:
```ts
if ((phase as Phase) === 'runtime_validation') {
    return runRuntimeValidationPhase(taskIds, state);
}
```

### 7d. Add `case 'runtime_validation'` to `checkAndRoute()` (between `case 'implement':` at line 1462 and `case 'code_review':` at line 1466)

```ts
case 'runtime_validation': {
    const anyChangesRequested = statuses.some(s =>
        getVerdict(s, 'runtime_validation') === 'changes_requested'
    );
    if (anyChangesRequested) {
        const maxRuntimeIter = statuses.reduce(
            (max, s) => Math.max(max, s.phases.runtime_validation?.iterations ?? 0), 0
        );
        info(`Runtime validation requested changes (iteration ${maxRuntimeIter}) — routing back to implement`);
        routeBackTo(taskIds, 'implement');
    }
    return;
}
```

`routeBackTo(taskIds, 'implement')` resets `implement`, `runtime_validation`, `code_review`, and all downstream phases to `pending`. Next dispatch iteration picks up at `implement`.

No change to `case 'implement':` — `autoCommitCode` runs, and then `PHASE_ORDER` naturally advances to `runtime_validation`.

---

## Step 8 — `implement.ts` + `prompts/index.ts` + `templates/implement-revisions.md` (AC-9b, AC-12, AC-12b)

### 8a. `scripts/run-task/phases/implement.ts` — isRevision (line 43)

Change:
```ts
const isRevision = tasks.some(t => t.iterations > 0);
```
To:
```ts
const isRevision = tasks.some(t => t.iterations > 0 || t.runtimeIterations > 0);
```

`runtimeIterations` flows through `PipelineState.tasks` from `buildPipelineState()` (Step 7b) with no further wiring needed.

### 8b. `scripts/run-task/prompts/index.ts` — restructure `promptImplementRevisions()` (lines 135–155)

Replace the current body with a version that computes `hasReviewFindings`, `hasRuntimeFailures`, the three banner shapes (AC-12b), and the per-check runtime-failure list:

```ts
export function promptImplementRevisions(state: PipelineState): string {
    const { tasks } = state;
    const stateHeader = buildImplementStateHeader(state, 'revision');
    const maxCodeReviewIter = tasks.reduce((m, t) => Math.max(m, t.iterations), 0);
    const maxRuntimeIter = tasks.reduce((m, t) => Math.max(m, t.runtimeIterations), 0);
    const hasReviewFindings = maxCodeReviewIter > 0;
    const hasRuntimeFailures = maxRuntimeIter > 0;

    const iterationN = Math.max(maxCodeReviewIter, maxRuntimeIter) + 1;
    const priorRound = maxCodeReviewIter;

    // Banner: one of three shapes (AC-12b)
    const iterBanner = hasReviewFindings && hasRuntimeFailures
        ? `[ITERATION ${iterationN} — addressing code review round ${priorRound} and runtime validation failures]`
        : hasReviewFindings
            ? `[ITERATION ${iterationN} — addressing code review round ${priorRound}]`
            : `[ITERATION ${iterationN} — addressing runtime validation failures]`;

    // Handoff-append section heading
    const handoffAppend = hasReviewFindings && hasRuntimeFailures
        ? `## Iteration ${iterationN} — addressing review round ${priorRound} and runtime validation`
        : hasReviewFindings
            ? `## Iteration ${iterationN} — addressing review round ${priorRound}`
            : `## Iteration ${iterationN} — addressing runtime validation`;

    const reviewLines = hasReviewFindings
        ? tasks.map(t =>
            `- \`${t.taskId}\` → read \`tasks/${t.taskId}/review.md\` ` +
            `(most recent \`## Round ${priorRound}\` section only — earlier rounds are already addressed)`
          ).join('\n')
        : '';

    const runtimeFailureEntries = hasRuntimeFailures
        ? buildRuntimeFailureEntries(tasks, maxRuntimeIter)
        : [];

    const tightenLine = iterationN >= 3
        ? ` (note: round ${iterationN} is tightening — prefer to defer nits).`
        : '';

    return render('implement-revisions.md', {
        projectName: config.projectName,
        taskScope: tasks.length > 1 ? 'a bundle of related tasks' : `task "${tasks[0].taskId}"`,
        stateHeader,
        startup: CODEX_STARTUP,
        iterBanner,
        handoffAppend,
        hasReviewFindings,
        hasRuntimeFailures,
        iterationN,
        priorRound,
        reviewLines,
        runtimeFailureEntries,
        tightenLine,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'implement', 'done'),
    });
}
```

Add a helper `buildRuntimeFailureEntries(tasks, maxRuntimeIter)` that returns an array of per-check objects for the Mustache `{{#runtimeFailureEntries}}` loop:

```ts
function buildRuntimeFailureEntries(tasks: TaskContext[], maxRuntimeIter: number): object[] {
    const entries: object[] = [];
    for (const t of tasks) {
        const handoffPath = path.join(taskDirFor(t.taskId), 'handoff.md');
        let handoffContent = '';
        try { handoffContent = fs.readFileSync(handoffPath, 'utf8'); } catch { /* missing */ }
        const runtimeResults = computeLatestRuntimeResults(handoffContent);
        for (const [, row] of runtimeResults) {
            if (row.result !== 'Fail' && row.result !== 'Timeout') continue;
            const sanitized = sanitizeName(row.check);
            const artifactDir = `tasks/${t.taskId}/runtime-check-output/${sanitized}/iter-${maxRuntimeIter}/`;
            const stderrLogPath = path.join(REPO_ROOT, artifactDir, 'stderr.log');
            let stderrContent: string;
            let stderrMissing = false;
            try {
                const raw = fs.readFileSync(stderrLogPath);
                stderrContent = raw.slice(0, 2048).toString('utf8');
            } catch {
                stderrMissing = true;
                // Extract 512-byte excerpt from handoff notes column
                const excerpt = row.notes.replace(/artifacts:.*$/, '').trim().slice(0, 512);
                stderrContent = excerpt + '\n[stderr.log missing — using truncated handoff excerpt]';
            }
            const hint = RUNTIME_CHECKS.find(c => c.name === row.check)?.artifactReadingHint;
            entries.push({
                taskId: t.taskId,
                checkName: row.check,
                stderrContent,
                artifactPath: artifactDir,
                hasHint: !!hint,
                artifactReadingHint: hint ?? '',
            });
        }
    }
    return entries;
}
```

Import at the top of `prompts/index.ts`: `computeLatestRuntimeResults` from `validation.js`, `RUNTIME_CHECKS` and `RuntimeCheck` type from `pipeline-policy.js`, `taskDirFor` from `state.js`, and `sanitizeName` (expose from `phases/runtime-validation.ts` or duplicate as a small local helper — prefer exporting from the phase module so there's one source).

Note on `REPO_ROOT`: already available via the `env.js` import that `prompts/index.ts` already uses (`import { config } from '../env.js'`).

### 8c. `scripts/run-task/prompts/templates/implement-revisions.md` — restructure

Replace the current single-shape template with a composable Mustache template:

```mustache
{{{iterBanner}}}

{{{stateHeader}}}
{{{startup}}}

{{#hasReviewFindings}}
Your prior iteration shipped; the reviewer (Claude) appended findings to `review.md` as `## Round {{priorRound}}`. If you're resuming the prior session, the full task framing (spec, plan, repo conventions) is already in context — skip the re-read. If your context is cold, re-read `tasks/<id>/spec.md` and `tasks/<id>/plan.md` before addressing findings.

Tasks with new review feedback:
{{{reviewLines}}}

For each task:
1. Read the most recent `## Round {{priorRound}}` section of `tasks/<id>/review.md`. That is the entire scope of this iteration.
2. Address every `correctness bug`, `risk/guardrail`, and `spec gap` finding from that round (blocking). `optional cleanup/nit` is at your discretion{{#tightenLine}}{{{tightenLine}}}{{/tightenLine}}
3. Re-run only the validation checks affected by your changes (typically lint, type-check, plus whatever the diff touches).
{{/hasReviewFindings}}
{{#hasRuntimeFailures}}
## Runtime check failures to address

The orchestrator ran runtime checks after your last implementation and recorded the following failures. You cannot re-run these checks yourself — the orchestrator re-runs them after you close implement.

{{#runtimeFailureEntries}}
### Check: `{{{checkName}}}` (task: `{{{taskId}}}`)

Artifacts: `{{{artifactPath}}}`
{{#hasHint}}
Reading hint: {{{artifactReadingHint}}}
{{/hasHint}}

Captured stderr (head-truncated):
```
{{{stderrContent}}}
```

Discipline:
1. READ the artifacts before proposing a fix. The cause is usually visible there.
2. Fix the code, NOT the check. Don't add waits, weaken selectors, or modify assertions unless the spec explicitly authorizes a behavior change.
3. You cannot re-run this check yourself — the orchestrator will re-run after you close implement. You're fixing blind based on captured output.
4. If you cannot determine the root cause from the artifacts, write your hypothesis in the handoff's Blockers section and request human escalation. Blind guessing burns iterations toward auto-block.

{{/runtimeFailureEntries}}
{{/hasRuntimeFailures}}
4. **APPEND** to `tasks/<id>/handoff.md` a new section `{{{handoffAppend}}}` (the template's "On revision rounds" comment shows the shape). Do NOT rewrite the file from scratch — earlier iterations stay as the cumulative record. Include only the delta: findings addressed, AC deltas, re-run validation results.

Spec ACs remain binding. If the review identifies a dropped AC, restore it.
Append to `tasks/<id>/notes.md` for new pitfalls found (prefix: `[implement-revision]`).

When done, run:
{{{phaseCommands}}}
```

Key changes from the current template:
- `[ITERATION {{iterationN}} — ...]` line replaced by pre-computed `{{{iterBanner}}}` (handles all three shapes from AC-12b).
- `{{{handoffAppend}}}` replaces the hardcoded `## Iteration {{iterationN}} — addressing review round {{priorRound}}` instruction.
- `{{#hasReviewFindings}}...{{/hasReviewFindings}}` gates the "read review.md" block.
- `{{#hasRuntimeFailures}}...{{/hasRuntimeFailures}}` gates the runtime block.
- `{{#runtimeFailureEntries}}...{{/runtimeFailureEntries}}` iterates failed checks.

---

## Step 9 — `scripts/task.sh`: recognize `runtime_validation` (AC-1, Phase Addition Discipline)

Four sets of changes to the hardcoded `phase_order` jq array and related validation logic:

1. **Every `phase_order` definition** (lines 231, 312, 335, 388): insert `"runtime_validation"` between `"implement"` and `"code_review"`:
   ```jq
   def phase_order: ["spec","spec_review","plan","implement","runtime_validation","code_review","qa","human_review"];
   ```

2. **Verdict validation guard** (line 295): extend to allow `runtime_validation`:
   ```sh
   if [ "$phase" != "spec_review" ] && [ "$phase" != "code_review" ] && [ "$phase" != "runtime_validation" ]; then
   ```

3. **Iterations management jq** (lines 341–346): extend to include `runtime_validation`:
   ```jq
   if ($phase == "code_review" or $phase == "spec_review" or $phase == "runtime_validation")
   ```
   This lets `runTaskShFor(taskId, 'phase', taskId, 'runtime_validation', 'done', verdict)` from Step 6d correctly increment `iterations` when verdict is `changes_requested`.

---

## Step 10 — `.gitignore` + documentation (AC-11, Docs Impact)

### `.gitignore`

Append:
```
tasks/*/runtime-check-output/
```

### `tasks/_templates/handoff.md`

In the iteration-template comment block (the "On revision rounds" section near the bottom), add a note that the orchestrator may also append a `### Re-run runtime validation` subsection alongside Codex's `### Re-run validation` subsection.

### `AGENTS.md`

1. In the **Handoff sequence** numbered list, insert step 4.5 between step 4 (implement) and step 5 (code review):
   > 4.5. Orchestrator runs registered runtime checks (if any); writes `## Runtime Validation Outcomes` to `handoff.md`; sets `runtime_validation` → `done`. On failure: routes back to implement with same loop-cap semantics as code review.

2. In the pipeline diagram or description, insert `runtime_validation` between `implement` and `code_review`.

3. Add a note on authority: orchestrator authors `## Runtime Validation Outcomes`; Codex authors `## Validation Outcomes`. Neither section is modified by the other agent.

### `CLAUDE.md` / `CODEX.md`

Search for any explicit `PHASE_ORDER` snippets or phase-list references and insert `runtime_validation` in the correct position. For `CODEX.md`: note that the implement-revision prompt includes a `## Runtime check failures to address` section when `runtime_validation.verdict = changes_requested`, and Codex should read the artifacts before proposing a fix.

### `docs/pipeline-orchestrator.md`

Add a `## Runtime Validation Phase` section covering:
- Phase position (between implement and code_review)
- Registration API: `RUNTIME_CHECKS` in `scripts/pipeline-policy.ts`, `RuntimeCheck` type fields and their semantics
- Trust model: orchestrator-only authority; Codex static checks are unchanged
- Loop-cap semantics: `runtime_validation.iterations` independent of `code_review.iterations`; both use `MAX_REVIEW_LOOPS`
- Empty registry → no-op (no handoff write, phase advances immediately)
- Artifact preservation and scoped cleanup behavior

---

## Step 11 — `tests/run-task-runtime-validation.test.ts` (NEW) (AC-10)

Create the test file. Use the AC-4 test seam (`runRuntimeValidationPhase(taskIds, state, checks)` with explicit `RuntimeCheck[]`). Use real subprocesses (`echo`, `sh -c "exit 1"`, `sleep`) — no mocking of spawn. Each test sets up a minimal `PipelineState` with a temp task directory containing a pre-populated (non-template) `handoff.md`.

### Test cases

1. **Empty registry** → no-op: handoff unchanged, task status → `done`, verdict → `approved`, iterations → 0, no `## Runtime Validation Outcomes` section.

2. **Single passing check** (`echo ok`) → `## Runtime Validation Outcomes` appended with one Pass row, verdict=`approved`, status=`done`. No artifact directory created.

3. **Single failing check** (`sh -c "exit 1"`) → Fail row, status=`done`, verdict=`changes_requested`.

4. **Timeout** (`sleep 60`, `timeoutMs: 100`) → Timeout row, verdict=`changes_requested`. Process killed within timeout grace period.

5. **`when()` predicate filters**: check whose `when` returns false is not run and not recorded.

6. **Iteration 2 re-run**: run failing check twice. Second run appends `### Re-run runtime validation` inside the `## Iteration 1` section. `computeLatestRuntimeResults` returns the iter-2 result (latest-wins).

7. **`cwd: 'worktree'` vs `cwd: 'repo_root'`**: command `pwd` echoes the correct directory.

8. **On Pass: scoped delta cleanup**: check writes a temp file outside `tasks/`. After phase, `git status --porcelain` is clean for that path.

9. **On Fail: artifacts copied then cleaned**: check writes a file outside `tasks/`. Assert (a) file copied to `tasks/<id>/runtime-check-output/<name>/iter-0/`, (b) original location cleaned.

10. **Declared `artifactPaths` preserves gitignored paths**: configure `artifactPaths: ['fixtures/ignored-output/']` where that path is gitignored. Check writes a file there. Assert (a) `git status --porcelain` does not surface it, (b) it is copied into the artifact directory, (c) prompt builder includes its contents.

11. **Missing declared `artifactPaths`**: declare a path that doesn't exist on disk. Assert `[<name> artifactPath '<p>' not found — skipping]` log line emitted; phase does not abort.

12. **Stderr source order**: render reroute prompt for a failed check — (a) with `stderr.log` present (3KB): assert prompt contains first 2KB; (b) after deleting `stderr.log`: assert prompt falls back to handoff excerpt with `[stderr.log missing — using truncated handoff excerpt]` annotation.

13. **Two-tier capture regression guard**: failing check writing ≥100KB to stderr. Assert (a) `stderr.log` on disk contains ≥100KB (byte-equal), (b) handoff Notes cell contains only first 512 bytes, (c) prompt contains first 2KB.

14. **Pre-existing dirty task artifacts preserved**: seed `tasks/<id>/handoff.md` and `tasks/<id>/notes.md` as uncommitted dirty files. After a failing check that writes a new file outside `tasks/`, assert (a) both pre-existing dirty files are byte-identical to pre-phase content, (b) the check-induced file is removed.

15. **Reroute prompt structure**: failing check with `artifactReadingHint` set. Assert rendered prompt contains check name, stderr excerpt, artifact path, hint, and the four-item discipline block verbatim.

16. **Revision-mode selection — runtime-only reroute** (AC-9b): `code_review.iterations === 0`, `runtime_validation.iterations === 1` → `runtimeIterations === 1` in `TaskContext` → `isRevision === true` in `runImplementPhase`. Assert the correct prompt-builder path is chosen (inspect which prompt text is rendered — `implement-revisions.md` shape, not `implement.md` shape).

17. **Revision prompt template — three shapes** (AC-12b): render `promptImplementRevisions` with (a) review-only (`iterations=1, runtimeIterations=0`), (b) runtime-only (`iterations=0, runtimeIterations=1`), (c) both (`iterations=1, runtimeIterations=1`). Assert (a) contains `## Round N` read instruction, no runtime block; (b) contains `## Runtime check failures` block, no `review.md` reference; (c) contains both, review first.

---

## Step 12 — Validation

Run in order after all steps are complete:
```
npm run lint
npm run type-check
npm test
```

All three must pass cleanly. The new `run-task-runtime-validation.test.ts` suite is included in `npm test`. All pre-existing tests must remain green.

---

## Implementation order note

Steps 1–3 (types, template, state back-compat) must land before Steps 6–7 (phase module and main.ts wiring) since the new types are imported. Step 4 (`RuntimeCheck` type) must land before Step 6. Step 5 (`computeLatestRuntimeResults`) must land before Steps 6 and 8. Step 9 (task.sh) must land before running any test that calls `runTaskShFor` with the new phase. Step 11 (tests) should be written after all implementation steps are in place.
