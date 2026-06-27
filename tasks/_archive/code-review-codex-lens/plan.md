# Plan: code-review-codex-lens — Add cold-Codex third lens to code_review

> Written by: Claude | Implements: `tasks/code-review-codex-lens/spec.md`

## Approach

Three-part change: (A) orchestrator plumbing — `runColdCodexReview` helper + `code-review.ts` pre-foreman step; (B) foreman template + artifact wording — 3-lens synthesis, injected findings slot, separate reconciliations; (C) docs + decisions — overturn the "two-lens" rule, record the design. Tests wrap (A) and (B); build/sync/grep gate closes.

No new phase, no new verdict, no new `MetricEntry`. The cold Codex review runs once per bundle invocation via `codex exec review --json --base <baseBranch> -m <miniModel>`, sequentially before the foreman; failure exits 1 before any Claude session starts, matching how failed `implement`/`spec_review` Codex calls already halt.

**Spec-review nit addressed**: AC-14d (foreman prompt assertions) belongs in `tests/run-task-prompts.test.ts`, not in `tests/run-task-code-review.test.ts`. Both files are listed in the handoff Changes table; the test-file row covers (a)/(b)/(c), and the prompts test covers (d).

---

## Steps

### Step 1: Add `runColdCodexReview` to `scripts/run-task/agents/codex.ts`

**Files**: `scripts/run-task/agents/codex.ts`

Add below `runCodex`:

```typescript
export async function runColdCodexReview(
    baseBranch: string,
    model: string,
    activeCwd: string,
    options: { codexBinary?: string } = {},
): Promise<{ success: boolean; findings: string; durationMs: number }>
```

Implementation:
- `command = options.codexBinary ?? 'codex'` — `codexBinary` is the test seam.
- `args = ['exec', 'review', '--json', '--base', baseBranch, '-m', model]` — per spec Known Risks: `codex exec review --json` emits the same NDJSON `agent_message` stream as `codex exec --json`; exit 0 whether clean or findings-present. No `--sandbox` (read-only review). No effort flag (mini model default is acceptable).
- Use `streamProcess(command, args, { cwd: activeCwd, label: 'Codex cold review', onLine })` — same pattern as `runCodex:77`.
- In `onLine`: parse each JSON line; push `event.item.text` when `event.type === 'item.completed' && event.item?.type === 'agent_message'`.
- Bracket the call with `Date.now()` for `durationMs` (same as `runCodex:23`).
- `success = !result.spawnError && !result.stalled && !result.signal` — matches `runCodex`'s hard-failure classification. Exit code is NOT a failure signal (spec Known Risks confirms exit 0 on both clean and findings-present runs).
- Return `{ success, findings: displayChunks.join('\n\n'), durationMs }`.
- **Do NOT call `process.exit()` or `setExitReason()` here** — caller (`code-review.ts`) does that so it can write a phase-specific message. No `recordMetric()` call (AC-4 forbids a new `MetricEntry`).

### Step 2: Thread `coldCodexFindings` through `scripts/run-task/prompts/index.ts`

**Files**: `scripts/run-task/prompts/index.ts`

Add optional `coldCodexFindings: string | null = null` as the fourth parameter to `promptCodeReview` (after `scopedDiff`):

```typescript
export function promptCodeReview(
    state: PipelineState,
    baseBranch?: string,
    scopedDiff: ScopedDiff | null = null,
    coldCodexFindings: string | null = null,
): string
```

Pass into render view:

```typescript
return render('code-review-foreman.md', {
    // ...existing fields...
    coldCodexFindings: coldCodexFindings ?? '',
    hasColdCodexFindings: coldCodexFindings !== null,
});
```

Existing callers omitting the argument get `null` (empty slot rendered); the real findings flow in from Step 4.

### Step 3: Rewrite `scripts/run-task/prompts/templates/code-review-foreman.md`

**Files**: `scripts/run-task/prompts/templates/code-review-foreman.md`

This template is NOT in `CANON_OWNED` (it bundles straight to `dist/`); edit the root file only.

**Changes** (preserve the file skeleton; change only what AC-7/8/9 require):

**Intro paragraph (line 12)**: Change "spawn two review lenses as isolated sub-agents" → describe three lenses: two spawned Claude lenses + the pre-obtained cold-Codex lens injected by the orchestrator. Make clear the foreman does NOT run `codex` itself.

**Add `## Injected Cold-Codex Findings` section** between the diff block and `## Foreman Protocol`:

```mustache
## Injected Cold-Codex Findings

{{#hasColdCodexFindings}}
The orchestrator ran `codex review` over the task's branch diff before spawning you.
Its findings are reproduced below. These are unanchored — Codex reviewed adversarially
without the spec as a checklist. Treat them as the third lens input.
Do **not** re-verify by running Codex yourself — inject these into synthesis alongside
the two Claude lenses.

{{{coldCodexFindings}}}
{{/hasColdCodexFindings}}
{{^hasColdCodexFindings}}
*(No cold-Codex findings provided — synthesize from the two Claude lenses only.)*
{{/hasColdCodexFindings}}
```

**`### 1. Spawn Lenses In Parallel`**: Keep the two Task tool invocations unchanged. Add a note after the cold-lens block: "The injected cold-Codex findings above are the third lens — do not spawn a Codex agent yourself."

**`### 2. Adjudicate`**: Replace with the three-way adjudication protocol:
1. **Dedup**: collapse 2+ lenses flagging the same behavior to one finding; record "flagged by N lenses." **Cross-model agreement** (same behavior flagged by both cold lenses — cold-Claude AND cold-Codex) must NOT be dismissed as spec-intended without explicit spec evidence cited in `review.md`.
2. **Two distinct reconciliation checks (keep these separate)**:
   - *Does it hold against the code?* — cold findings (cold-Claude **and** cold-Codex): verify each against the diff/code. Codex P-levels are claims to check, not verdicts. A finding that does not hold → `Dismissed (cold-Claude): <finding> - <reason>` or `Dismissed (cold-Codex): <finding> - <reason>`.
   - *Is it in spec scope?* — anchored lens only.
   - **Explicitly forbidden**: dismissing a *verified* cold finding merely for being off-AC or out of spec scope. A real bug the cold lens catches is still a bug even if no AC named it.
3. **Altitude classification** unchanged: `code-bug` or `spec-gap`.

Update "flagged by both lenses" → "flagged by 2+ lenses." Update "two lens outputs" → "three lens inputs (two spawned Claude lenses + the injected cold-Codex findings)."

**`### 4. Write review.md`**: Note to include `Dismissed (cold-Codex): ...` entries alongside `Dismissed (cold):`.

**Full phrasing sweep**: eliminate "two-lens," "two review lenses," and "either lens" (as a lens-count claim). No surviving phrasing from AC-10's grep pattern.

### Step 4: Update `runCodeReviewPhase` in `scripts/run-task/phases/code-review.ts`

**Files**: `scripts/run-task/phases/code-review.ts`

Add imports:
```typescript
import { runColdCodexReview } from '../agents/codex.js';
import { policyConfig } from '../policy.js';
```

(`setExitReason` is already imported from `../cli.js` — confirm before adding.)

Replace the block at lines 294–305 (the `info(...)` log + `taskPhase` + `runClaude` call) with:

```typescript
info(`Phase: code_review (Claude${state.isBundle ? ' bundle' : ''}, iteration ${maxIter + 1})`);
for (const t of tasks) taskPhase(t.taskId, 'code_review', 'in_progress');

// Cold-Codex review: runs once over the combined diff before the foreman.
// Hard-fail on unavailability — no graceful 2-lens fallback (see spec Non-Goals).
const miniModel = policyConfig().codexModelMini;
const coldReviewStartMs = Date.now();
const coldReview = await runColdCodexReview(baseBranch, miniModel, activeCwd);
const coldReviewDurationMs = Date.now() - coldReviewStartMs;

if (!coldReview.success) {
    setExitReason(
        `cold-Codex review could not be obtained for task(s) ${taskIds.join(', ')} ` +
        `(spawn error / stall / signal). Re-run when Codex is available — ` +
        `the code_review phase has not advanced.`,
    );
    process.exit(1);
}

for (const t of tasks) {
    fs.writeFileSync(
        path.join(taskDirFor(t.taskId), 'review-cold-codex.md'),
        coldReview.findings,
        'utf8',
    );
}
info(`→ cold-codex review (${taskIds.join(', ')}): ${Math.round(coldReviewDurationMs / 1000)}s`);

const cfg = getClaudeConfig('code_review', tasks);
const reviewResumeId = maxIter > 0 ? resumeId : null;
const scopedDiff = getScopedDiff(baseBranch, activeCwd);
const result = await runClaude(
    promptCodeReview(state, baseBranch, scopedDiff, coldReview.findings),
    interactive, reviewResumeId, cfg.model, cfg.effort, cfg.budget,
    { taskId: taskIds.join('+'), phase: 'code_review', iteration: maxIter, activeCwd },
    activeCwd,
);
```

**Bundle contract** (AC-5): the single `runColdCodexReview(baseBranch, miniModel, activeCwd)` call runs over the combined diff — the `activeCwd` worktree holds all tasks' changes. The same `coldReview.findings` string is written to every task dir's `review-cold-codex.md`. On failure, `process.exit(1)` fires before any Claude session; no member advances. This naturally satisfies "one review, atomic failure."

### Step 5: Update artifact templates

**Files**: `.canon/templates/review.md`, `.claude/agents/code-review-anchored.md`, `.claude/agents/code-review-cold.md`

These are `CANON_OWNED`. Edit root files; `npm run sync-templates` regenerates mirrors.

**`.canon/templates/review.md`** (AC-9):
- Line 7: "synthesized by a foreman from two review lenses: an anchored lens… and a cold lens that reads only the diff" → "synthesized by a foreman from three lenses: an **anchored Claude lens** (Stage 1 / Stage 2 charter), a **cold Claude lens** (diff only), and a **cold Codex lens** (pre-obtained by the orchestrator — unanchored diff-only review from a different model family)."
- `### Dismissed Cold Findings` section: expand to note both `Dismissed (cold):` and `Dismissed (cold-Codex):` label forms are valid; both should appear with the finding and reason.

**`.claude/agents/code-review-anchored.md`** (AC-9):
- Line 6: "two-lens review pipeline" → "three-lens review pipeline"

**`.claude/agents/code-review-cold.md`** (AC-9):
- Line 6: "two-lens review pipeline" → "three-lens review pipeline"

### Step 6: Rewrite the relevant decisions in `docs/decisions.md`

**File**: `docs/decisions.md` (NOT in `CANON_OWNED` — edit root, no mirror)

**At line 193** (`the **two** review lenses`): "the **two** review lenses" → "the review lenses" (the find/filter split is count-agnostic).

**At line 202** (current: "Lens count stays two…Do not add a third lens"):
Replace with:
> - **Lens count: one anchored + two cross-family adversarial lenses (cold-Claude + cold-Codex).** The "near-clones" caveat scopes to **same-model** additions; a lens from a **different model family** is the documented exception — decorrelated blind spots, genuinely additive recall. Empirical driver: the archived head-to-head (`docs/canon-opus48-gpt55-report.md`: 173 Codex PR findings, 0 false positives, ~76% off-AC) confirms Codex and cold-Claude are "complementary, not substitutes," and the operator's lived experience (Codex repeatedly finding PR P2s both Claude lenses miss) is direct evidence of decorrelation. Do not add a third lens of the **same** model family; cross-family additions are evaluated on their own merits.

**At lines 297–303** (heading "Cold independent review: pursue multi-agent Claude, park the Codex code-review phase"):
Rewrite heading to: "Cold independent review: cold-Claude + cold-Codex in-pipeline, PR-level Codex backstop retained"
Update body to record: the direction is now provided (this task); the in-pipeline cold-Codex lens is the realization; the operator was running `codex review` by hand before every PR — this institutionalizes that step; PR-level Codex review remains ON. Updated rule: "The cold-Codex lens is in-pipeline. The PR-level `codex review` remains as belt-and-suspenders. The archived `codex-code-review-phase` spec is superseded."

**Add new entry** (AC-13) after the rewritten `:297` block documenting the design:
- Orchestrator-run, sequential `codex exec review --json --base <baseBranch> -m <miniModel>` in the task worktree.
- `miniModel = policyConfig().codexModelMini` (honors `CODEX_MODEL_MINI` / `CODEX_MODEL_DEFAULT` env — no new `codexMatrix` phase).
- Findings injected into foreman prompt as pre-obtained third lens; foreman synthesizes 3-way verify-don't-relay with two separate reconciliation checks.
- Hard-fail design: `setExitReason` + `process.exit(1)` before any Claude session — no new verdict, no `codex_error`, no graceful 2-lens fallback.
- Bundle contract: one review over combined diff, findings reach every member, atomic `process.exit(1)`.
- Orchestrator-run chosen over foreman-owned: foreman-owned needs a poller or new `codex_error` verdict + `checkAndRoute` routing; orchestrator-run reuses existing halt machinery for free.
- Sequential v1; run-log duration line (AC-4) is the data to revisit concurrency.

### Step 7: Update `docs/product-context.md` and `docs/pipeline-orchestrator.md`

**`docs/product-context.md`** (NOT in `CANON_OWNED`):
- Line 38 (Review row): "Two-stage code review by Claude" → "Three-lens code review. The orchestrator pre-obtains a cold-Codex review (`codex exec review`), then a Claude foreman spawns an anchored lens (Stage 1 gate + Stage 2 quality) and a cold-Claude lens (diff only). The foreman synthesizes all three and writes one `review.md`."
- Line 128 (roadmap): "Multi-agent cold review shipped in v1.10.0 (`code_review` now runs as a foreman over anchored + cold lenses)" → "Multi-agent cold review with cold-Codex third lens: `code_review` runs as an orchestrator-run `codex review` step followed by a Claude foreman over anchored-Claude, cold-Claude, and cold-Codex lenses."

**`docs/pipeline-orchestrator.md`** (IS in `CANON_OWNED` — `npm run sync-templates` regenerates mirror):
- `## Code Review Diff Injection` section (≈lines 372–374): expand to describe the three-step flow: (1) orchestrator runs `codex exec review --json --base <baseBranch> -m <miniModel>` in the active worktree, writes `tasks/<id>/review-cold-codex.md`, logs duration; (2) if cold review fails, phase stops before any Claude session — re-run with `canon run`; (3) foreman receives captured findings as pre-obtained third lens and spawns the two Claude lenses. Note that the scoped diff for Claude lenses and the `--base` for `codex review` both cover the same `<baseBranch>...HEAD` range.

### Step 8: Create `tests/run-task-code-review.test.ts` (AC-14a/b/c)

**Files**: `tests/run-task-code-review.test.ts`, `tests/fixtures/fake-codex-review.mjs` (or inline scripts)

Use the `codexBinary` option from Step 1 to inject a fake `codex` command.

**(a) Success path** (AC-14a):
- Create a fake codex script (Node.js ESM or shell) that prints one `{"type":"item.completed","item":{"type":"agent_message","text":"[P2] src/foo.ts:10 — null deref"}}` line and exits 0.
- Call `runColdCodexReview('main', 'gpt-5.4-mini', tmpDir, { codexBinary: fakePath })`.
- Assert: `success === true`, `findings` contains the agent_message text, `durationMs >= 0`.
- Verify `review-cold-codex.md` written to each task dir (integration-level: wire through `runCodeReviewPhase` mock).

**(b) Failure path** (AC-14b):
- Fake codex script that exits 1 with no stdout.
- Assert: `success === false`.
- For orchestrator-level: wrap `runCodeReviewPhase` such that `process.exit` is intercepted (e.g., spy on `process.exit` or catch the thrown error if the test environment overrides it); verify it fires before `runClaude` is called.

**(c) Bundle** (AC-14c):
- Two-task bundle state.
- Assert `runColdCodexReview` called exactly once (one codex invocation over combined `activeCwd`).
- Assert both `tasks/<id-1>/review-cold-codex.md` and `tasks/<id-2>/review-cold-codex.md` written with identical content (the single shared findings).
- On fake-codex-failure: assert neither artifact written, phase stops before foreman.

**Test seam for `process.exit`**: follow the pattern in `tests/run-task-safety.test.ts` — either spawn as subprocess and check exit code, or use a mock that throws a catchable sentinel error.

### Step 9: Update `tests/run-task-prompts.test.ts` + regenerate golden (AC-14d)

**Files**: `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`

Extend the existing `promptCodeReview` test at ≈line 519:
- Call `promptCodeReview(state, 'main', null, 'P2 — null deref at src/foo.ts:10')`.
- Assert: output contains the findings text, "cold-Codex" (or "cold-codex"), and "three lens" or "three lenses."

Update the structural assertion test at ≈line 736 that reads the agent charters:
- If it checks for "two-lens" in `code-review-anchored.md` or `code-review-cold.md`, change to "three-lens."

After all template and code changes:
```
UPDATE_GOLDENS=1 npm test
```
Verify `tests/run-task-prompts.golden.json` diff is consistent with the template changes. Commit the updated golden before the plain `npm test` run.

### Step 10: Build, sync, validate (AC-16)

Run in sequence:
1. `npm run lint`
2. `npm run type-check`
3. `npm test` (with updated golden committed)
4. `npm run build` — commit `dist/`
5. `npm run sync-templates && npm run sync-templates:check`
6. `npm run docs-refs-check`
7. Structural grep gate (AC-10):
   ```
   rg -n --hidden -g '!.git' -g '!tasks/**' -g '!node_modules' -g '!dist/**' \
      -g '!CHANGELOG.md' -g '!docs/lessons-learned.md' -g '!docs/BACKLOG.md' \
      -g '!docs/task-quality-log.md' \
      -g '!docs/harness-audit-2026-06.md' -g '!docs/canon-opus48-gpt55-report.md' \
      -e 'two-lens' -e 'two review lenses' -e 'Lens count stays two' -e 'Do not add a third lens'
   ```
   Must return zero matches.

---

## Key Implementation Notes

**Invocation form**: `codex exec review --json --base <baseBranch> -m <model>` — NOT `codex review` (which is an alias without guaranteed `--json` NDJSON support). The `agent_message` parse path in `runCodex:72-74` applies verbatim.

**Model source**: `policyConfig().codexModelMini` — one import, no new `CodexPhase` entry, no `pipeline-policy.ts` / `tests/pipeline-policy.test.ts` touch.

**`setExitReason` import**: already imported in `code-review.ts` from `../cli.js`. Confirm before adding.

**`docs/decisions.md` and `docs/product-context.md`** are NOT in `CANON_OWNED`. Verify via `src/lib/canon-owned.ts` if uncertain. Edit roots only; do not run sync for these.

**`pipeline-orchestrator.md`** IS in `CANON_OWNED`. Mirror at `templates/docs/pipeline-orchestrator.md` is auto-synced; declare it in the handoff Changes table.

**No telemetry-schema changes**: `review-cold-codex.md` is a plain file under `tasks/<id>/`. `MetricEntry`, `types.ts`, `metrics.ts`, and `docs/pipeline-invocations.md` are untouched.

---

## Affected Files Summary

| File | Change |
|---|---|
| `scripts/run-task/agents/codex.ts` | Add `runColdCodexReview` (Step 1) |
| `scripts/run-task/prompts/index.ts` | Add `coldCodexFindings` param to `promptCodeReview` (Step 2) |
| `scripts/run-task/prompts/templates/code-review-foreman.md` | 3-lens framing, injected slot, 3-way synthesis, two reconciliations, no-off-AC-dismissal, cross-model-agreement (Step 3) |
| `scripts/run-task/phases/code-review.ts` | Run cold Codex review before foreman; write artifact; log duration; hard-fail (Step 4) |
| `.canon/templates/review.md` | Three lenses, `Dismissed (cold-Codex)` slot (Step 5) |
| `.claude/agents/code-review-anchored.md` | "two-lens" → "three-lens" (Step 5) |
| `.claude/agents/code-review-cold.md` | "two-lens" → "three-lens" (Step 5) |
| `docs/decisions.md` | Generalize `:193`; rewrite `:202` + `:297-303`; add AC-13 entry (Step 6) |
| `docs/product-context.md` | Review row `:38` + roadmap `:128` (Step 7) |
| `docs/pipeline-orchestrator.md` | Code Review Diff Injection → 3 lenses + orchestrator step (Step 7) |
| `tests/run-task-code-review.test.ts` | New: AC-14a/b/c coverage (Step 8) |
| `tests/run-task-prompts.test.ts` | AC-14d: cold-Codex findings slot + three-lens assertion (Step 9) |
| `tests/run-task-prompts.golden.json` | Regenerated (Step 9) |
| `dist/` | Rebuilt (Step 10) |
| `templates/.canon/templates/review.md` | Auto-synced mirror |
| `templates/.claude/agents/code-review-{cold,anchored}.md` | Auto-synced mirrors |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced mirror |
