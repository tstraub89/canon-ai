# Implementation Plan: cold-codex-review-invocation-policy

> Written by: Claude | Implements: `tasks/cold-codex-review-invocation-policy/spec.md`

## Approach

Route the cold-Codex review lens through the same policy/validation/telemetry machinery every other Codex invocation already uses, instead of the bespoke `getColdCodexModel()` shortcut:

1. Add a `code_review` row to `codexMatrix()` in `scripts/pipeline-policy.ts` (mini model, flat `high` effort at every size).
2. Extract a single shared effort-validation helper in `scripts/run-task/agents/codex.ts` and call it from all three non-interactive spawn sites (fresh `runCodex`, resumed `runCodex`, `runColdCodexReview`).
3. Widen `runColdCodexReview`'s argv, stream handler (token parsing), and telemetry (`recordMetric` in `finally`, plus an explicit pre-spawn record on the validation-guard path since `process.exit`/`die()` skips pending `finally` blocks).
4. Swap `code-review.ts`'s `getColdCodexModel` dependency for `getCodexConfig('code_review', tasks)` and pass the metrics context through to the cold call.
5. Update/add tests per the spec's ACs, then land the two doc amendments (AC-10) before handoff — per the spec-review nit, these are **not** QA-phase work; they must be in the implement commit so `code_review`'s handoff-diff check sees them.

No new files. No status.json schema changes. No prompt changes.

## Steps

### Step 1: `scripts/pipeline-policy.ts` — add the `code_review` phase to the Codex matrix

Files: `scripts/pipeline-policy.ts`

- Widen the `CodexPhase` union (line 12):

  ```ts
  export type CodexPhase = 'spec_review' | 'implement' | 'code_review';
  ```

- In `codexMatrix()` (currently returns `Record<CodexPhase, Record<TaskSize, CodexModelConfig>>` at lines 143–183), add a third row alongside `spec_review` and `implement`:

  ```ts
  code_review: {
      // Cold-Codex review lens (GitHub #195). Flat `high` effort at every
      // size — human decision: this lens is a mandatory hard-fail gate
      // (docs/decisions.md "Cold-Codex code-review lens"), so it doesn't
      // get the token-savings taper the other phases use for XS/S. Model
      // stays mini at every size, including XL/delicate — unlike
      // spec_review/implement, this lens never escalates to the full
      // model; that's a deliberate cost boundary, not an oversight
      // (see docs/decisions.md and the spec's Non-Goals).
      XS: { model: config.codexModelMini, effort: 'high' },
      S:  { model: config.codexModelMini, effort: 'high' },
      M:  { model: config.codexModelMini, effort: 'high' },
      L:  { model: config.codexModelMini, effort: 'high' },
      XL: { model: config.codexModelMini, effort: 'high' },
  },
  ```

  Follow the existing comment style above the `return` statement (the `spec_review:`/`implement:` prose block at lines 144–166) — add a `code_review:` bullet there too, one or two lines, cross-referencing the human decision.

- No change needed to `getPipelinePolicy()` — `codex: (phase) => matrix[phase][effectiveSize]` already generalizes to the new phase.

### Step 2: `tests/pipeline-policy.test.ts` — cover the five new cells

Files: `tests/pipeline-policy.test.ts`

- `CodexPhase` is imported already; `CODEX_MATRIX` (lines 141–154) is the table-driven fixture. Add five rows:

  ```ts
  // code_review (cold-Codex review lens)
  { phase: 'code_review', size: 'XS', expected: { model: 'mini', effort: 'high' } },
  { phase: 'code_review', size: 'S',  expected: { model: 'mini', effort: 'high' } },
  { phase: 'code_review', size: 'M',  expected: { model: 'mini', effort: 'high' } },
  { phase: 'code_review', size: 'L',  expected: { model: 'mini', effort: 'high' } },
  { phase: 'code_review', size: 'XL', expected: { model: 'mini', effort: 'high' } },
  ```

  These loop through the existing `for (const row of CODEX_MATRIX)` block automatically — no new test body needed.

- Extend the `'codex matrix: delicate M uses XL row (effective size)'` test (lines 163–167) with a third assertion so delicate promotion is proven for the new phase too:

  ```ts
  assert.deepEqual(p.codex('code_review'), { model: 'mini', effort: 'high' });
  ```

  (This is the interesting case: `implement`/`spec_review` upgrade to `codexModelFull` on delicate promotion to XL, but `code_review` must stay on `mini` even at XL — this assertion is what actually proves the "no model upgrade" non-goal, not just the flat table above.)

### Step 3: `scripts/run-task/agents/codex.ts` — shared effort validation

Files: `scripts/run-task/agents/codex.ts`

Add a small, exported, pure helper near the top of the file (after imports, before `runCodex`):

```ts
export const VALID_CODEX_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const;

// Canon resolves effort per phase/size (scripts/pipeline-policy.ts) and passes
// it as an invocation-scoped `-c model_reasoning_effort=<effort>` override —
// it never reads or mutates ~/.codex/config.toml. This guards against a
// resolved value the Codex CLI itself would reject (e.g. a future matrix
// typo, or CLI drift on the valid set) with an actionable message instead of
// a raw CLI rejection that kills the invocation with no context (#195).
export function invalidCodexEffortMessage(effort: string): string | null {
    if ((VALID_CODEX_EFFORTS as readonly string[]).includes(effort)) return null;
    return (
        `Invalid Codex reasoning effort "${effort}" — canon resolved this value for the ` +
        `current phase/size and passes it via \`-c model_reasoning_effort=${effort}\`, but the ` +
        `Codex CLI only accepts: ${VALID_CODEX_EFFORTS.join('|')}. This per-invocation override ` +
        `supersedes any user-level model_reasoning_effort set in ~/.codex/config.toml — fix the ` +
        `resolved value (scripts/pipeline-policy.ts), not the user's Codex config.`
    );
}
```

This message string is what AC-5 checks for all three elements: (a) the invalid value is interpolated in, (b) the valid set is listed, (c) the "supersedes ... ~/.codex/config.toml" sentence states the precedence.

### Step 4: `scripts/run-task/agents/codex.ts` — wire validation into `runCodex` (fresh + resumed)

Files: `scripts/run-task/agents/codex.ts`

At the very top of `runCodex` (before `effectivePrompt`/`info(...)`/`startMs`, i.e. before anything happens), add:

```ts
const invalidEffort = invalidCodexEffortMessage(effort);
if (invalidEffort) die(invalidEffort);
```

Import `die` alongside the existing `info, setExitReason, warn` import from `../cli.js` (line 2).

This covers both the fresh and resumed paths through one call site — `runCodex` already branches on `resumeId` further down for argv shape, but the effort check applies identically before that branch, so one guard covers both AC-5(b) and AC-5(c). Because this fires before `startMs`/the `try` block, `finally`'s `recordMetric` correctly does not fire here (no work was attempted) — that's fine, no AC requires a metrics row for this path (only the cold path has that requirement, per AC-7).

`die()` synchronously calls `process.exit(1)` — the fake `codex` binary is never spawned since we return (never, from TS's perspective) before reaching the `streamProcess`/`runCommandOrDie` calls.

### Step 5: `scripts/run-task/agents/codex.ts` — rewrite `runColdCodexReview`

Files: `scripts/run-task/agents/codex.ts`

Replace the current signature and body (lines 128–179) with:

```ts
export async function runColdCodexReview(
    baseBranch: string,
    model: string,
    effort: string,
    activeCwd: string,
    metricsContext?: { taskId: string; phase: string; iteration?: number; activeCwd?: string },
    options: { codexBinary?: string } = {},
): Promise<ColdCodexReviewResult> {
    const startMs = Date.now();

    const invalidEffort = invalidCodexEffortMessage(effort);
    if (invalidEffort) {
        if (metricsContext) {
            recordMetric({
                ...metricsContext,
                agent: 'codex',
                model,
                durationMs: Date.now() - startMs,
                status: 'failed',
            });
        }
        die(invalidEffort);
    }

    const command = options.codexBinary ?? 'codex';
    const args = ['exec', 'review', '--json', '-c', `model_reasoning_effort=${effort}`, '--base', baseBranch, '-m', model];
    const displayChunks: string[] = [];
    let sawTurnCompleted = false;
    let tokenTotal = 0;
    let sawUsage = false;
    let success = false;
    let findings = '';

    try {
        const onLine = (line: string): void => {
            let event: {
                type?: string;
                item?: { type?: string; text?: string };
                usage?: { input_tokens?: number; output_tokens?: number };
            };
            try { event = JSON.parse(line) as typeof event; } catch { return; }
            const tick = formatLiveTick(event);
            if (tick) console.log(tick);
            if (event.type === 'turn.completed') {
                sawTurnCompleted = true;
                if (event.usage) {
                    tokenTotal += (event.usage.input_tokens ?? 0) + (event.usage.output_tokens ?? 0);
                    sawUsage = true;
                }
            } else if (event.type === 'item.completed' && event.item?.type === 'agent_message' && event.item.text) {
                displayChunks.push(event.item.text);
            }
        };

        const result = await streamProcess(command, args, {
            cwd: activeCwd,
            label: 'Codex cold review',
            onLine,
        });
        findings = displayChunks.join('\n\n');
        // See the historical comment this replaces: "obtained" means the
        // stream ran to completion (turn.completed), not exit-code zero.
        success =
            findings.trim().length > 0 &&
            sawTurnCompleted &&
            !result.spawnError &&
            !result.stalled &&
            !result.signal;

        return {
            success,
            findings,
            durationMs: Date.now() - startMs,
        };
    } finally {
        if (metricsContext) {
            recordMetric({
                ...metricsContext,
                agent: 'codex',
                model,
                durationMs: Date.now() - startMs,
                status: success ? 'ok' : 'failed',
                tokens: sawUsage ? tokenTotal : undefined,
            });
        }
    }
}
```

Notes for the implementer:

- `metricsContext` is **optional** (mirrors `runCodex`'s own `metricsContext?`) so existing/new unit tests that only care about argv or success-gate semantics can call `runColdCodexReview` without a metrics seam. The real pipeline call site (Step 6) always passes it.
- The pre-spawn guard records its row **before** calling `die()`, not via `finally` — `process.exit()` (which `die()` calls) does not run pending `finally` blocks (see the spec's Known Risks and the existing skip on the `spawnError`/`stalled`/`signal` branches inside `runCodex` itself — that pre-existing gap is out of scope here, don't fix it as a drive-by).
- `success` and `findings` are declared outside the `try` so the `finally` block can read the final value.
- Token parsing now happens on `turn.completed` (mirroring `runCodex`'s `onLine` handler at lines 75–77), tolerating a stream with no `usage` field (`sawUsage` stays `false` → `tokens: undefined` → metrics.ts renders `-`).
- Preserve the existing `ColdCodexReviewResult` type (`{ success, findings, durationMs }`) unchanged — the spec's Data Model Changes section says so explicitly.

### Step 6: `scripts/run-task/phases/code-review.ts` — swap the dependency and wire the new call

Files: `scripts/run-task/phases/code-review.ts`

- Remove the `getColdCodexModel` field from `CodeReviewPhaseDeps` (line 33) and from `defaultDeps` (line 47). Add `getCodexConfig: typeof getCodexConfig` in its place, importing `getCodexConfig` from `../policy.js` alongside the existing `getClaudeConfig, getMaxReviewLoops, policyConfig` import (line 6). Drop the `policyConfig` import if nothing else in this file uses it after the removal — grep the file first (`policyConfig()` is currently only referenced inside the `getColdCodexModel` arrow being deleted).

- Replace the call site (lines 327–330):

  ```ts
  const miniModel = deps.getColdCodexModel();
  const coldReviewStartMs = Date.now();
  const coldReview = await deps.runColdCodexReview(baseBranch, miniModel, activeCwd);
  const coldReviewDurationMs = Date.now() - coldReviewStartMs;
  ```

  with:

  ```ts
  const coldCfg = deps.getCodexConfig('code_review', tasks);
  const coldReviewStartMs = Date.now();
  const coldReview = await deps.runColdCodexReview(baseBranch, coldCfg.model, coldCfg.effort, activeCwd, {
      taskId: taskIds.join('+'),
      phase: 'code_review',
      iteration: maxIter,
      activeCwd,
  });
  const coldReviewDurationMs = Date.now() - coldReviewStartMs;
  ```

  `maxIter` is already computed above at line 237 (`const maxIter = tasks.reduce(...)`) — reuse it; this is what makes the cold row's iteration column match the foreman row's (both use `maxIter`, see the existing `runClaude` call's `iteration: maxIter` at line 356).

- No other lines in this file change. The failure branch (`if (!coldReview.success) { ...; process.exit(1); }` at lines 332–339) is untouched — `runColdCodexReview`'s own `finally` already recorded the `failed` row before this `process.exit(1)` runs (the phase-layer exit happens *after* `runColdCodexReview` has already returned, so its `finally` has already completed — this is the "good" ordering the spec's Known Risks section calls out).

### Step 7: `tests/run-task-code-review.test.ts` — update for the new signatures

Files: `tests/run-task-code-review.test.ts`

- **`makeDeps()` (lines 137–177)**: replace `getColdCodexModel: () => 'mini-from-policy'` with `getCodexConfig: () => ({ model: 'mini-from-policy', effort: 'high' })`, and update the `runColdCodexReview` stub's signature to `(_baseBranch, model, _effort, cwd, _metricsContext) => {...}` (keep pushing the same `cold:${model}:${cwd}` event string so the two existing bundle tests at lines 247–320 don't need further changes).

- **`runColdCodexReview captures agent_message findings and uses codex review args` (lines 186–215)**: this is the AC-3 red-first test.
  - Call: `await runColdCodexReview('main', 'gpt-mini', 'high', dir, undefined, { codexBinary: fakeCodex })`.
  - Update the expected argv `deepEqual` (lines 203–211) to:
    ```ts
    assert.deepEqual(fs.readFileSync(argsFile, 'utf8').split('\n'), [
        'exec', 'review', '--json', '-c', 'model_reasoning_effort=high', '--base', 'main', '-m', 'gpt-mini',
    ]);
    ```
  - Verify this fails against pre-fix code (missing `-c` pair) before applying Step 5, then passes after — that's the "red-first" requirement.

- **`runColdCodexReview reports unavailable when no findings output is captured` / `...stream truncates before turn.completed`** (lines 217–245): add the new `effort` argument (`'high'`) to both `runColdCodexReview(...)` calls; behavior/assertions unchanged.

- **New: AC-5 effort-validation test for the cold path.** Add a test that calls `runColdCodexReview('main', 'gpt-mini', 'ultra', dir, undefined, { codexBinary: fakeCodex })` where `fakeCodex` is a script that would `fs.writeFileSync` a sentinel file if ever invoked. Mock `process.exit` the same way the existing bundle-failure test does (lines 299–310, `isProcessExitError` helper already defined at lines 179–184) and assert: (a) `process.exit` was called with code `1`; (b) the sentinel file was never written (fake binary never ran); (c) the thrown/logged message contains the invalid value, the valid set, and the `~/.codex/config.toml` precedence sentence — capture via a `console.error` spy or by having `die()`'s message text be recoverable through the mocked exit call's context (simplest: temporarily stub `console.error` to capture the argument, matching how `die()` writes `❌ ${message}`).

- **New: AC-6/AC-7/AC-9 telemetry tests.** Use the `CANON_METRICS_FILE_OVERRIDE` seam (see `getMetricsFile()` in `scripts/run-task/metrics.ts` — set the env var to a temp file path for the duration of the test, matching the pattern other metrics tests in this repo use — grep `CANON_METRICS_FILE_OVERRIDE` across `tests/` for the existing idiom before writing a new one). For each, call `runColdCodexReview` directly (not the full phase) with a `metricsContext` object, then read the temp metrics file and assert on the appended row:
  - **AC-6 (ok + tokens)**: fake codex emits `agent_message` + `turn.completed` with `usage`. Assert exactly one row with `agent=codex`, `phase=code_review`, `taskId` matching, `iteration` matching the passed value (not `-`), `status=ok`, and a numeric token count.
  - **AC-7(a) (ordinary failure)**: fake codex exits before `turn.completed` (reuse the existing truncated-stream fixture). Assert exactly one row, `status=failed`, zero `ok` rows.
  - **AC-7(b) (guard failure)**: invalid effort, as above. Assert exactly one row, `status=failed`, and that the fake codex binary was never invoked (same sentinel-file technique).
  - **AC-9 (no usage)**: fake codex emits `turn.completed` with no `usage` field. Assert the row's token cell is `-`.

  Each test must reset/restore `CANON_METRICS_FILE_OVERRIDE` in a `finally` (mirror the `withTempTasksAsync` env-var save/restore idiom already in this file at lines 12–27) so it doesn't leak into sibling tests.

### Step 8: `tests/run-task-reroute-preflight.test.ts` — tighten fresh/resumed argv (AC-4)

Files: `tests/run-task-reroute-preflight.test.ts`

- The fake `codex` binary (`writeFakeAgentBins`, lines 202–228) already captures full `argv` into the `FAKE_AGENT_CAPTURE` file (via `readCapture`, lines 302–309). Find the existing assertions that check `entry.args` for codex captures (e.g. around lines 882, 912, 964, 995) and tighten at least one fresh-path and one resumed-path assertion to a full `deepEqual` against the exact expected argv:
  - Fresh: `['exec', '--json', '-c', 'model_reasoning_effort=<effort>', '--sandbox', 'workspace-write', <prompt>, '-m', <model>, '-C', <cwd>]`.
  - Resumed: `['exec', 'resume', <id>, '--json', '-c', 'model_reasoning_effort=<effort>', <prompt>, '-m', <model>]`.
  - Match the prompt element with a placeholder/regex (it's long and generated) — pin every other element exactly, matching argument order from `codex.ts`'s `args` construction (lines 55–57).
- This is a test-only AC — `runCodex`'s argv construction doesn't change in this task (the effort flag is already there); the goal is to convert existing loose/partial assertions into an order-and-content-pinning `deepEqual` so a future accidental flag reorder/removal is caught here too.

### Step 9: Doc updates (AC-10) — land before handoff, not in QA

Per the spec-review nit: these are binding on the implementer, and `code_review`'s handoff-diff check runs before `qa`, so they must be committed in the implement pass.

- **`docs/decisions.md`** (root-only, no `templates/` mirror — do not touch `templates/docs/decisions.md`). In the "Cold-Codex code-review lens: orchestrator-run, sequential, hard-fail (2026-06)" section (line 341 onward), amend the sentence:

  > `<miniModel>` is `policyConfig().codexModelMini`, so `CODEX_MODEL_MINI` / `CODEX_MODEL_DEFAULT` overrides still apply and no new `codexMatrix` phase exists.

  to something like:

  > `<miniModel>`/`<effort>` resolve through `getCodexConfig('code_review', tasks)` — a `code_review` row in `codexMatrix()` (`scripts/pipeline-policy.ts`) that pins the model to `codexModelMini` and effort to flat `high` at every size, including XL/delicate (no model upgrade for this lens — see the invocation-policy task, #195). `CODEX_MODEL_MINI` / `CODEX_MODEL_DEFAULT` overrides still apply to the model.

  Keep the rest of the section (foreman synthesis behavior, hard-fail contract, bundle contract) unchanged — those aren't affected by this task.

- **`docs/pipeline-orchestrator.md`** (canon-managed, mirror auto-syncs). In the "Codex Model/Effort Matrix" section (line 212 onward), add a row to the table:

  ```
  | `code_review` (cold lens) | mini / high | mini / high | mini / high | mini / high | mini / high |
  ```

  and add a sentence noting the flat-effort, no-model-upgrade shape (distinct from the size-scaling `spec_review`/`implement` rows above it) — e.g. after the existing "XL/delicate implement runs at `high`, not `xhigh`..." paragraph:

  > The cold-Codex `code_review` review lens (run during the `code_review` phase, ahead of the Claude foreman) is the one exception to size-scaling: it runs at flat `high` effort and stays on the mini model at every size, including XL/delicate — this lens is a mandatory hard-fail gate (see `docs/decisions.md`), not a phase where token-savings tapering or a full-model upgrade applies.

  Do not touch `templates/docs/pipeline-orchestrator.md` by hand — the pre-commit sync hook regenerates it from the root file.

### Step 10: Rebuild

Files: `dist/scripts/run-task.js`, `dist/cli/index.js` (if applicable)

Run `npm run build` after all source changes land. Commit the regenerated `dist/` output — CI enforces that committed `dist/` matches a fresh build.

## Testing Plan

- **Unit**: all of Steps 2, 7, 8 above (`tests/pipeline-policy.test.ts`, `tests/run-task-code-review.test.ts`, `tests/run-task-reroute-preflight.test.ts`).
- **Full suite**: `npm test` must be green, including the pre-existing bundle-mode tests in `run-task-code-review.test.ts` (lines 247–320) updated only for the new `makeDeps()` signature — their behavioral assertions (cold-before-foreman ordering, hard-fail-before-Claude) must be unchanged (AC-8).
- **Manual**: none required beyond the Human Test Plan already in `spec.md` — that's the human's post-ship verification, not part of this implementation pass.

## Rollback Plan

Pure code/doc change, no data migration, no schema change, no new files. Revertible with a single `git revert` of the implementation commit. The only externally-visible behavior change is the cold lens now always running at `high` effort (previously inherited the user's Codex config) — called out in Known Risks as a canon-supplied-default change to mention in the next changelog entry, not something this task's rollback needs to handle specially.
