# Plan: codex-code-review-phase — Codex adversarial code-review phase after Claude approves

> Written by: Claude | Task: codex-code-review-phase

## Spec-review nit incorporated

The spec-review flagged that AC-16a hard-codes `## Round 1` in skip/disabled artifacts while AC-13 defines an append-and-increment pattern. Both paths must share a single round-number helper so a pre-existing `codex-review.md` (from a human reroute or a prior real-review cycle) increments correctly rather than overwriting or emitting a duplicate `## Round 1`. This is reflected in Step 4 (getNextRoundNumber is used by all three write paths: real, skip, and disabled).

---

## Step 1 — Update `PHASE_ORDER` and `Phase` type

**File**: `scripts/run-task/types.ts`

Insert `'codex_code_review'` between `'code_review'` and `'qa'` in the `PHASE_ORDER` const:

```typescript
export const PHASE_ORDER = [
  'spec', 'spec_review', 'plan', 'implement',
  'code_review', 'codex_code_review', 'qa', 'human_review'
] as const;
```

`Phase`, `PhaseEntry`, `StatusJson.phases`, and `getPhaseStatus` all derive from `PHASE_ORDER` — no other changes needed in this file. `StatusJson.sessions` is **not** modified (AC-7a: non-resumable by design).

**Compile check**: run `npm run type-check` after this step — TypeScript will surface every switch/case that needs a new arm. Use that output as the read list for Steps 6 and 7.

---

## Step 2 — Add `codex_code_review` to `CodexPhase` and `codexMatrix`

**File**: `scripts/pipeline-policy.ts`

1. Extend the `CodexPhase` union:

   ```typescript
   export type CodexPhase = 'spec_review' | 'implement' | 'codex_code_review';
   ```

2. Add a `codex_code_review` row to `codexMatrix` inside the `codexMatrix()` function. Place it after `implement`. Mirror the `spec_review` effort values (the `S` row is kept for completeness/testability even though fast-tier never invokes it):

   ```typescript
   codex_code_review: {
     S:  { model: config.codexModelMini, effort: 'medium' },
     M:  { model: config.codexModelMini, effort: 'medium' },
     L:  { model: config.codexModelMini, effort: 'high' },
     XL: { model: config.codexModelFull, effort: 'high' },
   },
   ```

3. `getPipelinePolicy` returns `codex: (phase) => matrix[phase][effectiveSize]` — the new row is picked up automatically.

4. **No change** to `scripts/run-task/policy.ts` — `CodexPhase` re-exports from `pipeline-policy.ts` and `getCodexConfig` accepts the extended union automatically.

---

## Step 3 — Schema: status.json template and `REVIEW_PHASES`

### 3a — `.canon/templates/status.json`

Insert `phases.codex_code_review` between `code_review` and `qa`. Match the exact shape of `code_review`'s entry (same counter fields, `agent: "codex"`):

```json
"codex_code_review": {
  "status": "pending",
  "agent": "codex",
  "verdict": "",
  "iterations": 0,
  "iterations_current_loop": 0,
  "iterations_total": 0,
  "changes_requested_total": 0,
  "auto_block_count": 0
}
```

The `_verdict_values` comment block is unchanged — the existing values already cover all `codex_code_review` verdicts.

### 3b — `src/task/index.ts`

Two changes:

1. Add `'codex_code_review'` to the `REVIEW_PHASES` set (line 20):

   ```typescript
   const REVIEW_PHASES = new Set<string>(['spec_review', 'code_review', 'codex_code_review']);
   ```

2. Update the error message in `assertValidVerdict` (line 327):

   ```typescript
   throw new Error('Error: verdict is only valid for spec_review, code_review, and codex_code_review phases');
   ```

No other changes — `PHASE_ORDER` is imported from `types.ts`, and `updateReviewCounters` + `checkPhaseGate` are already REVIEW_PHASES-driven.

---

## Step 4 — Extend `validation.ts` with parser functions and phase gate

**File**: `scripts/run-task/validation.ts`

### 4a — Severity parser and verdict derivation (AC-11, AC-12)

Add two pure exported functions. Place them near `extractCheckedVerdict` for discoverability:

```typescript
export function parseCodexReviewSeverities(
    output: string,
): { P0: number; P1: number; P2: number; P3: number } {
    const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
    // Line-prefix match: must start with `- [P<n>] ` (line start, global, multiline).
    // Lines that lack the `- ` prefix (e.g. `[P2] foo`) are not counted — by design.
    const re = /^- \[P([0-3])\] /gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(output)) !== null) {
        const key = `P${m[1]}` as keyof typeof counts;
        counts[key]++;
    }
    return counts;
}

export function deriveCodexCodeReviewVerdict(
    counts: { P0: number; P1: number; P2: number; P3: number },
): 'approved' | 'approved_with_nits' | 'changes_requested' {
    if (counts.P0 > 0 || counts.P1 > 0 || counts.P2 > 0) return 'changes_requested';
    if (counts.P3 > 0) return 'approved_with_nits';
    return 'approved';
}
```

### 4b — Verdict extractor for phase gate (AC-14a)

Add an exported helper that reads the **last** `### Verdict (orchestrator-computed)` block:

```typescript
export function extractCodexReviewVerdict(content: string): string | null {
    // Locate every occurrence of the verdict block and keep the last one.
    // Use a non-greedy body match up to the next h2/h3 or end of string.
    const blockRe =
        /### Verdict \(orchestrator-computed\)\n([\s\S]*?)(?=\n## |\n### |$)/g;
    let lastBlock: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = blockRe.exec(content)) !== null) {
        lastBlock = m[1];
    }
    if (!lastBlock) return null;
    const verdictLine = lastBlock.match(/^- Verdict: (.+)$/m);
    return verdictLine ? verdictLine[1].trim() : null;
}
```

### 4c — Extend `PhaseGateConfig` with optional `verdictExtractor`

Extend the local `PhaseGateConfig` type:

```typescript
type PhaseGateConfig = {
    artifactName?: string;
    requiresVerdict?: boolean;
    verdictMustMatchArtifact?: boolean;
    customTemplateCheck?: (artifactPath: string) => boolean;
    // When set, used instead of extractCheckedVerdict to read the verdict
    // from the artifact. Needed for codex_code_review which uses a plain
    // `- Verdict: <value>` line rather than a checked checkbox.
    verdictExtractor?: (content: string) => string | null;
};
```

### 4d — Add `codex_code_review` to `PHASE_GATE_CONFIG`

Insert after the `code_review` entry:

```typescript
codex_code_review: {
    artifactName: 'codex-review.md',
    requiresVerdict: true,
    verdictMustMatchArtifact: true,
    verdictExtractor: extractCodexReviewVerdict,
},
```

`codex-review.md` uses the default `isTemplateUnfilled` check — real artifacts, skip artifacts, and disabled artifacts all contain real prose, so none trigger the template sentinel.

### 4e — Use `verdictExtractor` in `checkPhaseGate`

In the `verdictMustMatchArtifact` branch inside `checkPhaseGate`, swap in the phase-specific extractor when present:

```typescript
if (config.verdictMustMatchArtifact) {
    if (!verdict) {
        return { ok: false, reason: `phase '${phase}' requires a verdict argument; none provided` };
    }
    const extractFn = config.verdictExtractor ?? extractCheckedVerdict;
    const extracted = extractFn(content);
    if (!extracted) {
        return { ok: false, reason: `${config.artifactName} has no verdict block for phase '${phase}'` };
    }
    if (extracted !== verdict) {
        return {
            ok: false,
            reason: `verdict mismatch: status.json wants '${verdict}', ${config.artifactName} has '${extracted}'`,
        };
    }
}
```

---

## Step 5 — Add `runCodexReview` to `agents/codex.ts`

**File**: `scripts/run-task/agents/codex.ts`

Add a new exported helper **below** `runCodex`. Do not modify `runCodex`.

```typescript
export type CodexReviewResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
};

/**
 * Invokes `codex review --base <baseBranch>` as a one-shot adversarial diff review.
 * Model and effort flags are placed BEFORE the `review` subcommand — the `review`
 * subcommand does not accept `-m`; top-level placement is required.
 * Does NOT use `codex exec` or the `--json` event stream; returns raw stdout+stderr.
 * The caller (runCodexCodeReviewPhase) handles non-zero exit per AC-9d.
 */
export async function runCodexReview(args: {
    baseBranch: string;
    cwd: string;
    model: string;
    effort: string;
    metricsContext?: { taskId: string; phase: string; iteration?: number; activeCwd?: string };
}): Promise<CodexReviewResult> {
    const { baseBranch, cwd, model, effort, metricsContext } = args;
    info(`Calling Codex review (base: ${baseBranch})...`);
    info(`Model: ${model} | Effort: ${effort}`);

    const startMs = Date.now();
    let metricStatus: 'ok' | 'failed' = 'ok';

    const argv = ['-m', model, '-c', `model_reasoning_effort=${effort}`, 'review', '--base', baseBranch];

    try {
        const result = await streamProcess('codex', argv, { cwd, label: 'Codex review' });
        if (result.exitCode !== 0) metricStatus = 'failed';
        return {
            exitCode: result.exitCode ?? 1,
            stdout: result.capturedStdout,
            stderr: result.capturedStderr,
        };
    } catch (err) {
        metricStatus = 'failed';
        throw err;
    } finally {
        if (metricsContext) {
            recordMetric({
                ...metricsContext,
                agent: 'codex',
                model,
                durationMs: Date.now() - startMs,
                status: metricStatus,
            });
        }
    }
}
```

**Verification**: confirm `streamProcess` from `./stream.js` exposes `capturedStdout` and `capturedStderr` on its return type — `runCodex` already uses `result.capturedStdout` so the fields exist. No `onLine` callback is needed here; full stdout is the artifact.

---

## Step 6 — New phase module `phases/codex-code-review.ts`

**File**: `scripts/run-task/phases/codex-code-review.ts` (new file)

Key design decisions:
- `getNextRoundNumber` reads existing `codex-review.md` to derive the next round number. Used by ALL three write paths (real, skip, disabled) — satisfying the spec-review nit.
- `appendCodexReviewArtifact` is the single write helper; all paths call it.
- Phase is non-resumable: no `resumeId` is consumed; document the reason inline.
- CLI failure (AC-9d): non-zero `runCodexReview` exit → write CLI Failure section, mark `blocked`, exit 2.

```typescript
import fs from 'node:fs';
import path from 'node:path';

import { info, warn } from '../cli.js';
import { getCodexConfig, getMaxReviewLoops } from '../policy.js';
import { runCodexReview } from '../agents/codex.js';
import { autoBlockPhase, readStatus, resolveTaskCwd, writeStatus } from '../state.js';
import type { PipelineState, PhaseRunResult } from '../types.js';
import {
    parseCodexReviewSeverities,
    deriveCodexCodeReviewVerdict,
} from '../validation.js';
import { getActiveCwd } from '../worktree.js';
import { taskPhase } from '../../../src/task/index.js';

// codex_code_review is intentionally non-resumable. `codex review` is a cold
// adversarial pass — resuming a partial session would defeat the framing benefit.
// No sessions.codex_code_review slot is tracked in status.json (AC-7a).

function getNextRoundNumber(codexReviewPath: string): number {
    let content = '';
    try { content = fs.readFileSync(codexReviewPath, 'utf8'); } catch { /* file absent */ }
    const rounds = [...content.matchAll(/^## Round (\d+)/gm)].map(m => Number(m[1]));
    return rounds.length > 0 ? Math.max(...rounds) + 1 : 1;
}

function buildVerdictBlock(args: {
    counts: { P0: number; P1: number; P2: number; P3: number };
    verdict: string;
    baseBranch: string;
    iteration: number;
}): string {
    return [
        `### Verdict (orchestrator-computed)`,
        `- P0: ${args.counts.P0}`,
        `- P1: ${args.counts.P1}`,
        `- P2: ${args.counts.P2}`,
        `- P3: ${args.counts.P3}`,
        `- Verdict: ${args.verdict}`,
        `- Base branch reviewed: ${args.baseBranch}`,
        `- Iteration: ${args.iteration}`,
    ].join('\n');
}

function appendCodexReviewArtifact(args: {
    codexReviewPath: string;
    roundNumber: number;
    body: string;
    counts: { P0: number; P1: number; P2: number; P3: number };
    verdict: string;
    baseBranch: string;
    iteration: number;
}): void {
    const { codexReviewPath, roundNumber, body, counts, verdict, baseBranch, iteration } = args;
    const separator = roundNumber === 1 ? '' : '\n';
    const block =
        `${separator}## Round ${roundNumber}\n\n` +
        `${body.trim()}\n\n` +
        buildVerdictBlock({ counts, verdict, baseBranch, iteration }) +
        '\n';
    fs.mkdirSync(path.dirname(codexReviewPath), { recursive: true });
    fs.appendFileSync(codexReviewPath, block, 'utf8');
}

const ZERO_COUNTS = { P0: 0, P1: 0, P2: 0, P3: 0 };

export async function runCodexCodeReviewPhase(
    state: PipelineState,
    _interactive: boolean,
    _resumeId: string | null,
): Promise<PhaseRunResult> {
    const { tasks } = state;
    const taskIds = tasks.map(t => t.taskId);
    const baseBranch = tasks[0].status.base_branch ?? 'main';

    // Fast-tier skip (AC-16). Uses the shared append helper so round numbering
    // is correct when a codex-review.md already exists.
    if (state.tier === 'fast') {
        info('Fast tier: skipping codex_code_review.');
        for (const t of tasks) {
            const codexReviewPath = path.join(resolveTaskCwd(t.taskId), 'tasks', t.taskId, 'codex-review.md');
            const roundNumber = getNextRoundNumber(codexReviewPath);
            const iteration = (t.status.phases.codex_code_review?.iterations_total ?? 0) + 1;
            appendCodexReviewArtifact({
                codexReviewPath,
                roundNumber,
                body: '(skipped — fast tier, no Codex review performed)',
                counts: ZERO_COUNTS,
                verdict: 'approved',
                baseBranch: `${baseBranch} (skipped)`,
                iteration,
            });
            taskPhase(t.taskId, 'codex_code_review', 'done', 'approved');
        }
        return null;
    }

    // Env-var disable switch (AC-28). Any value other than 'true' leaves phase enabled (AC-29).
    if (process.env.CODEX_CODE_REVIEW_DISABLED === 'true') {
        info('codex_code_review disabled by CODEX_CODE_REVIEW_DISABLED — skipping.');
        for (const t of tasks) {
            const codexReviewPath = path.join(resolveTaskCwd(t.taskId), 'tasks', t.taskId, 'codex-review.md');
            const roundNumber = getNextRoundNumber(codexReviewPath);
            const iteration = (t.status.phases.codex_code_review?.iterations_total ?? 0) + 1;
            appendCodexReviewArtifact({
                codexReviewPath,
                roundNumber,
                body: '(skipped — disabled by CODEX_CODE_REVIEW_DISABLED, no Codex review performed)',
                counts: ZERO_COUNTS,
                verdict: 'approved',
                baseBranch: `${baseBranch} (skipped)`,
                iteration,
            });
            taskPhase(t.taskId, 'codex_code_review', 'done', 'approved');
        }
        return null;
    }

    // Auto-block check (AC-18, AC-19).
    const maxCurrentLoop = tasks.reduce(
        (max, t) => Math.max(max, t.status.phases.codex_code_review?.iterations_current_loop ?? 0),
        0,
    );
    const loopCap = getMaxReviewLoops(tasks);
    if (maxCurrentLoop >= loopCap) {
        const reason =
            `Codex code review hit ${maxCurrentLoop} changes_requested iterations in a row ` +
            `(limit: ${loopCap}). Pipeline auto-blocked. See tasks/<id>/codex-review.md for ` +
            `the blocking findings. Recovery: fix the implementation, then set ` +
            `phases.codex_code_review.iterations_current_loop = 0 in status.json and re-run. ` +
            `If Codex blocks on the same finding class repeatedly, the spec or validator may be ` +
            `wrong — inspect spec.md before raising MAX_REVIEW_LOOPS.`;
        warn(reason);
        autoBlockPhase(taskIds, 'codex_code_review', maxCurrentLoop, reason);
        process.exit(2);
    }

    info(`Phase: codex_code_review (Codex adversarial review${state.isBundle ? ' — bundle' : ''})`);
    for (const t of tasks) taskPhase(t.taskId, 'codex_code_review', 'in_progress');

    const cfg = getCodexConfig('codex_code_review', tasks);
    const activeCwd = getActiveCwd(taskIds);
    const iteration = tasks.reduce(
        (max, t) => Math.max(max, (t.status.phases.codex_code_review?.iterations_total ?? 0) + 1),
        1,
    );

    // One `codex review` invocation for the whole bundle (AC-23).
    const result = await runCodexReview({
        baseBranch,
        cwd: activeCwd,
        model: cfg.model,
        effort: cfg.effort,
        metricsContext: {
            taskId: taskIds.join('+'),
            phase: 'codex_code_review',
            iteration: maxCurrentLoop,
            activeCwd,
        },
    });

    // CLI failure (AC-9d): fail closed, never mark approved.
    if (result.exitCode !== 0) {
        const stderrTruncated = result.stderr.slice(0, 4096);
        for (const t of tasks) {
            const codexReviewPath = path.join(resolveTaskCwd(t.taskId), 'tasks', t.taskId, 'codex-review.md');
            const roundNumber = getNextRoundNumber(codexReviewPath);
            fs.mkdirSync(path.dirname(codexReviewPath), { recursive: true });
            const separator = roundNumber === 1 ? '' : '\n';
            fs.appendFileSync(
                codexReviewPath,
                `${separator}## Round ${roundNumber}\n\n### CLI Failure\n\n\`\`\`\n${stderrTruncated}\n\`\`\`\n`,
                'utf8',
            );
            const status = readStatus(t.taskId);
            const entry = status.phases.codex_code_review;
            if (entry) entry.status = 'blocked';
            writeStatus(t.taskId, status);
        }
        warn(
            `Codex review CLI failed (exit ${result.exitCode}). Phase marked blocked. ` +
            `Fix the CLI environment, then re-run. ` +
            `Set CODEX_CODE_REVIEW_DISABLED=true to bypass for debugging only.`,
        );
        process.exit(2);
    }

    // Parse output and derive bundle-level verdict (AC-11, AC-12, AC-25).
    const counts = parseCodexReviewSeverities(result.stdout);
    const verdict = deriveCodexCodeReviewVerdict(counts);

    // Write codex-review.md per task in the bundle (AC-24). Same raw output,
    // task-specific round number, task-specific taskPhase call.
    for (const t of tasks) {
        const codexReviewPath = path.join(resolveTaskCwd(t.taskId), 'tasks', t.taskId, 'codex-review.md');
        const roundNumber = getNextRoundNumber(codexReviewPath);
        appendCodexReviewArtifact({
            codexReviewPath,
            roundNumber,
            body: result.stdout,
            counts,
            verdict,
            baseBranch,
            iteration,
        });
        taskPhase(t.taskId, 'codex_code_review', 'done', verdict);
    }

    info(
        `Codex code review complete — verdict: ${verdict} ` +
        `(P0:${counts.P0} P1:${counts.P1} P2:${counts.P2} P3:${counts.P3})`,
    );
    return { agent: 'codex', sessionId: null, exitCode: result.exitCode };
}
```

---

## Step 7 — Wire the phase into `main.ts`

**File**: `scripts/run-task/main.ts`

### 7a — Import the new phase

Add to the import block (alongside other phase imports):

```typescript
import { runCodexCodeReviewPhase } from './phases/codex-code-review.js';
```

### 7b — Add arm to `runPhase()`

Insert after the `code_review` arm and before the `qa` arm:

```typescript
if ((phase as Phase) === 'codex_code_review') {
    // Non-resumable: no session slot, resumeId always null (AC-7a).
    return runCodexCodeReviewPhase(state, cliArgs.interactive, null);
}
```

### 7c — Add case to `checkAndRoute()`

In `switch (phase)`, add a case after `'code_review'`:

```typescript
case 'codex_code_review': {
    const anyChangesRequested = statuses.some(s => {
        const v = s.phases.codex_code_review?.verdict ?? '';
        return v === 'changes_requested';
    });
    if (anyChangesRequested) {
        const maxIter = statuses.reduce(
            (max, s) => Math.max(max, s.phases.codex_code_review?.iterations_current_loop ?? 0),
            0,
        );
        info(`Codex code review requested changes (iteration ${maxIter}) — routing back to implement`);
        routeBackTo(taskIds, 'implement');
    }
    return;
}
```

**Why `routeBackTo` needs no change**: It resets the target phase and ALL downstream phases by walking `PHASE_ORDER` from the target index onward (lines 1920–1923). With `'codex_code_review'` at index 5 and `'implement'` at index 3, `routeBackTo(taskIds, 'implement')` already resets `implement`, `code_review`, `codex_code_review`, and `qa`. Confirm by re-reading the function body (lines 1901–1928) — no manual add is needed.

### 7d — Confirm no explicit `code_review → qa` transition exists

Re-read the `case 'code_review'` arm in `checkAndRoute`. It routes `changes_requested` back to `implement` and otherwise falls through to `default: return`. With `codex_code_review` now in `PHASE_ORDER` after `code_review`, `deriveTopLevelStatus` will naturally advance the pipeline to `codex_code_review` on the next loop iteration. No explicit `→ qa` transition exists to remove.

### 7e — Update `printDryRunPlan()` (AC-19a)

Replace the current Codex-phase branch (the `if (phase === 'spec_review' || phase === 'implement')` block around lines 1138–1142) with:

```typescript
if (phase === 'spec_review' || phase === 'implement' || phase === 'codex_code_review') {
    // Fast-tier skips both spec_review and codex_code_review.
    if ((phase === 'spec_review' || phase === 'codex_code_review') && state.tier === 'fast') continue;
    const cfg = splitPolicy.getCodexConfig(phase, tasks);
    console.log(`  - ${phase}: Codex / ${cfg.model} / ${cfg.effort}`);
}
```

### 7f — Update `rerouteFromHumanReview()` to reset `codex_code_review`

In `rerouteFromHumanReview`, after the `qa` reset block (~line 1870), add:

```typescript
const codexCodeReview = status.phases.codex_code_review;
if (codexCodeReview) {
    codexCodeReview.status = 'pending';
    codexCodeReview.verdict = '';
    // Preserve monotonic counters; reset the per-loop counter (mirrors code_review reset).
    codexCodeReview.iterations_current_loop = 0;
    codexCodeReview.iterations = 0;
}
```

---

## Step 8 — Tests

### 8a — New `tests/codex-code-review-phase.test.ts` (AC-30, AC-32)

`parseCodexReviewSeverities` cases:
- Empty string → all zeros.
- Prose-only Codex "no findings" output (e.g., `"I did not find a discrete correctness issue introduced by the patch."`) → all zeros.
- `"- [P2] Buffer not re-armed\n"` → `{ P0: 0, P1: 0, P2: 1, P3: 0 }`.
- `"- [P0] a\n- [P1] b\n- [P2] c\n- [P3] d\n"` → `{ P0: 1, P1: 1, P2: 1, P3: 1 }`.
- `"- [P5] invalid\n"` → all zeros (digit out of range).
- `"[P2] missing dash prefix\n"` → all zeros (no `- ` prefix).
- `"- [P2] Mid-content finding\n"` → `{ P2: 1 }` (acceptable false positive; line-prefix-based).

`deriveCodexCodeReviewVerdict` cases (AC-32):
- All zeros → `'approved'`.
- P3 only → `'approved_with_nits'`.
- P2 > 0 → `'changes_requested'`.
- P1 > 0 → `'changes_requested'`.
- P0 > 0 → `'changes_requested'`.

### 8b — Extend `tests/pipeline-policy.test.ts` (AC-31)

Add `codex_code_review` matrix rows following the exact fixture shape used for `spec_review` rows:
- Size S, non-delicate → `{ model: codexModelMini, effort: 'medium' }`.
- Size M, non-delicate → `{ model: codexModelMini, effort: 'medium' }`.
- Size L, non-delicate → `{ model: codexModelMini, effort: 'high' }`.
- Size XL, non-delicate → `{ model: codexModelFull, effort: 'high' }`.
- Size M, `delicate: true` (promotes to XL) → `{ model: codexModelFull, effort: 'high' }`.

### 8c — Extend the `canon task phase` test file (AC-32a)

Locate with: `grep -l "assertValidVerdict\|REVIEW_PHASES" tests/`. Add cases:
- `canon task phase <id> codex_code_review done approved` → verdict written, `iterations_current_loop` reset to 0.
- `canon task phase <id> codex_code_review done changes_requested` → `iterations_current_loop` incremented, `iterations_total` incremented, `changes_requested_total` incremented.
- After `changes_requested`, then `approved` → `iterations_current_loop` = 0, `iterations_total` = 2.
- Non-review phase given a verdict → error message lists all three phases (`spec_review, code_review, codex_code_review`).

### 8d — Extend the phase-gate test file (AC-32b)

Locate with: `grep -l "checkPhaseGate\|PHASE_GATE_CONFIG" tests/`. Add:
- `extractCodexReviewVerdict` on single-round artifact → returns the verdict.
- `extractCodexReviewVerdict` on multi-round artifact → returns the **last** round's verdict.
- `extractCodexReviewVerdict` on content with no verdict block → `null`.
- `checkPhaseGate(id, 'codex_code_review', 'approved')` with missing `codex-review.md` → `{ ok: false }`.
- `checkPhaseGate` with artifact verdict `'approved'` but argument `'changes_requested'` → `{ ok: false, reason: /mismatch/ }`.
- `checkPhaseGate` with artifact verdict `'approved'` and argument `'approved'` → `{ ok: true }`.
- `checkPhaseGate` with the AC-16a skip artifact shape (prose + `Verdict: approved`) and argument `'approved'` → `{ ok: true }`.

Use `taskDirOverride` to write test fixtures to a temp directory.

---

## Step 9 — Docs

Edit root copies only — the pre-commit hook and `npm run sync-templates` update `templates/` automatically.

### `docs/pipeline-orchestrator.md` (AC-33)

1. Update every `PHASE_ORDER` listing to include `codex_code_review` between `code_review` and `qa`.
2. Codex env var table: add row for `CODEX_CODE_REVIEW_DISABLED` — value `'true'`; skips the phase, writes minimal skip artifact, marks done with `approved`. Note: does not bypass `checkDeps()` (full-tier runs still need `codex` for `spec_review` and `implement`).
3. Codex model matrix table: add `codex_code_review` row (S: mini/medium, M: mini/medium, L: mini/high, XL: full/high; S always skipped on fast tier).
4. Review Loops & Auto-block section: note that `code_review` and `codex_code_review` have **independent** iteration counters (each capped at `MAX_REVIEW_LOOPS`). Document worst-case ceiling: a Codex reroute triggers a fresh Claude re-review, so total Claude passes ≤ `MAX_REVIEW_LOOPS²` in pathological cases.

### `CLAUDE.md` (AC-34)

In the "Review Responsibilities" section, add:

> **Two-stage code review**: Claude `code_review` is the first stage. On full-tier tasks, if Claude approves (`approved` or `approved_with_nits`), the pipeline runs `codex_code_review` — a Codex adversarial pass that reads the diff cold with no spec context, targeting lifecycle/state-machine bugs that the AC-compliance lens misses. Claude's review behavior is unchanged; `codex_code_review` is a separate phase that runs after approval.

### `AGENTS.md` (AC-35)

1. Update the Handoff sequence in the File-Based Handoff Protocol section: step 5 → Claude code_review → if approved, step 5a Codex codex_code_review → if approved, step 6 Claude QA.
2. Update any `PHASE_ORDER` listing.
3. Update the Full-tier pipeline workflow description if it shows the phase sequence.

### `CODEX.md` (AC-36)

Add a section on `codex_code_review` responsibilities. Key points:
- Default `codex review` prompt is used — no spec, no AC injection. The framing benefit is the cold adversarial read.
- Output findings with `- [P<n>] ` prefix (P0–P3). The orchestrator parses these.
- On `changes_requested`, the pipeline reroutes to `implement`; Claude re-reviews from scratch before Codex runs again.
- The phase is non-resumable; each run is fresh against the current branch state.

### `docs/codebase-map.md` (AC-37)

Add `scripts/run-task/phases/codex-code-review.ts` to the phases listing alongside the other phase modules.

### `CHANGELOG.md` (AC-40)

Under `[Unreleased]` → `### Added`:

```
- **Codex adversarial code-review phase** (`codex_code_review`): After Claude approves the implementation, a Codex cold-diff review pass runs with no spec context — targeting lifecycle, state-machine, and consistency-across-paths bugs the AC-compliance lens misses. P0/P1/P2 findings reroute to implement; P3-only is `approved_with_nits`. Skipped on fast tier (S non-delicate). Disable per-invocation via `CODEX_CODE_REVIEW_DISABLED=true` for debugging.
```

---

## Step 10 — Template sync, validation, and build

```bash
npm run sync-templates        # update templates/ mirrors; stage output
npm run lint
npm run type-check
npm test
npm run build                 # rebuilds dist/; stage dist/
npm run docs-refs-check
npm run sync-templates:check  # confirm templates/ is in sync
```

Stage all modified source, test, doc, template, and `dist/` files. Commit.

---

## Ordering constraints and key pitfalls

- **Run `npm run type-check` after Step 1** before writing any phase logic. TypeScript will list every switch arm that needs updating — use the output as a checklist for Steps 6 and 7.
- **`routeBackTo` needs no manual add for `codex_code_review`** — the phase-index loop already covers it once `PHASE_ORDER` is updated.
- **Round numbering is universal**: `getNextRoundNumber` must be called in all three write paths (real, skip, disabled). Never hardcode `## Round 1`.
- **`runCodexReview` does not call `runCodex`** — it's a sibling that uses `streamProcess` directly with `codex review` argv.
- **CLI failure path never marks approved** — exit 2 after writing the `### CLI Failure` block and marking `blocked`.
- **`CODEX_CODE_REVIEW_DISABLED` does not bypass `checkDeps()`** — document this inline in `runCodexCodeReviewPhase` with a brief rationale (full-tier runs invoke Codex for `spec_review` and `implement` regardless).
- **Bundle verdict propagation**: one `runCodexReview` call, `verdict`/`counts` shared, `taskPhase` called per task.
- **`verdictExtractor` in `PhaseGateConfig`** is the mechanism that lets `codex-review.md` use `- Verdict: <value>` instead of a checkbox — do not reuse `extractCheckedVerdict` for this phase.
