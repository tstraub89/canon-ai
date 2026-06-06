# Plan: multi-agent-code-review

> Written by: Claude | Task: `multi-agent-code-review`
> Spec-review verdict: approved_with_nits — nits addressed inline below.

## Nits addressed from spec-review

**Nit 1 (spec_gap counter behavior):** `spec_gap` is treated like `approved/approved_with_nits` in `updateReviewCounters()` — it is a completed real review round that halts (not a reroute), so `iterations_total += 1`, `iterations_current_loop = 0`, `preflight_rejections_current_loop = 0`.

**Nit 2 (surface count label):** Test names and comments use "seven surfaces" to match AC-10.

---

## Overview

This plan restructures `code_review` from a single-session direct-write into a **synthesis foreman** that spawns two isolated lens sub-agents, adjudicates their findings, and writes the single `review.md` + verdict the rest of the pipeline already consumes. It also adds `spec_gap` as a new verdict that halts the pipeline for human intervention rather than routing back to `implement`.

The implementation is ordered to avoid type errors: verdict-type changes first, runtime validators second, templates/agent-defs third, phase logic fourth, tests last.

---

## Step 1 — Add `spec_gap` to the verdict type (`scripts/run-task/types.ts`)

`_VERDICT_VALUES` on line 14 is the source-of-truth tuple. Add `'spec_gap'`:

```typescript
export const _VERDICT_VALUES = ['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review', 'spec_gap'] as const;
```

`Verdict` is derived from the tuple (`(typeof _VERDICT_VALUES)[number] | ''`), so it picks up `spec_gap` automatically — no separate change needed to the `Verdict` type alias.

`isVerdict()` checks `_VERDICT_VALUES.includes(...)` and picks it up automatically.

---

## Step 2 — Add `spec_gap` to runtime validators and counters (`src/task/index.ts`)

Three targeted edits:

**2a. `VALID_VERDICTS` set (line 19):**
```typescript
const VALID_VERDICTS = new Set<string>(['approved', 'approved_with_nits', 'changes_requested', 'needs_re_review', 'spec_gap']);
```

**2b. `assertValidVerdict()` error message (line ~344):** Update to include `spec_gap` in the "Must be one of:" list.

**2c. `updateReviewCounters()` (line 362):** Add `spec_gap` to the `approved/approved_with_nits` branch — `spec_gap` is a completed real review round that halts (loop ends, not repeats):

```typescript
} else if (verdict === 'approved' || verdict === 'approved_with_nits' || verdict === 'spec_gap') {
    entry.iterations_total += 1;
    entry.iterations_current_loop = 0;
    entry.iterations = 0;
    entry.preflight_rejections_current_loop = 0;
}
```

---

## Step 3 — Update CLI help (`src/cli/index.ts`)

Find the line containing `verdict:  approved | approved_with_nits | changes_requested | needs_re_review` (line ~56) and append `| spec_gap`.

---

## Step 4 — Update `extractCheckedVerdict()` (`scripts/run-task/validation.ts`)

**4a. `extractCheckedVerdict()` (line 864):** Add a regex for the `spec_gap` checkbox BEFORE the `return null` line, following the same pattern:

```typescript
if (/^- \[x\] (?:\*\*)?Spec gap(?:\*\*)?(?:\s|$)/mi.test(scope)) return 'spec_gap';
```

**4b. `PHASE_GATE_CONFIG`:** The `code_review` entry uses `requiresVerdict: true, verdictMustMatchArtifact: true`. Since `spec_gap` is now in `_VERDICT_VALUES` and `extractCheckedVerdict()` detects it, the gate accepts it automatically — no structural change to `PHASE_GATE_CONFIG` needed. Verify by tracing `checkPhaseGate()`: it calls `extractCheckedVerdict()` then compares against the passed `verdict` argument; both now accept `'spec_gap'`.

---

## Step 5 — Update status.json template and mirror

**5a. `.canon/templates/status.json` (line 51):** Update `_verdict_values`:
```json
"_verdict_values": "approved | approved_with_nits | changes_requested | needs_re_review | spec_gap",
```

**5b. `templates/.canon/templates/status.json`:** Same change to the mirror. The pre-commit hook auto-syncs root → templates/, but edit both explicitly since the hook runs on commit.

---

## Step 6 — Update `review.md` template and mirror

**6a. `.canon/templates/review.md`:** Add a `spec_gap` verdict checkbox to the `## Final Verdict` section (after the four existing checkboxes):

```markdown
- [ ] **Spec gap** — root cause is the spec, not the code; halt for human (do not route to implement)
```

Also add it inside the `<!-- On re-review ... -->` comment block's `### Verdict for this round` section:

```markdown
- [ ] Spec gap
```

**6b. `templates/.canon/templates/review.md`:** Same change to the mirror.

---

## Step 7 — Create `.claude/agents/` directory and lens definition files

The `.claude/agents/` directory does not yet exist. Create it and two agent definition files.

**7a. `.claude/agents/code-review-anchored.md`:**

```markdown
---
name: code-review-anchored
description: Anchored code reviewer — Stage 1 AC compliance + Stage 2 quality + test-integrity. Returns structured findings to the foreman; does NOT write review.md or set the verdict.
---

You are the **anchored** code reviewer in a two-lens review pipeline. Your findings will be adjudicated by a synthesis foreman. Do NOT write `review.md` directly and do NOT run `canon task phase` commands.

**Your task:** Apply canon's full code-review charter to the diff and spec you are given. Return your findings as structured text in the format below.

**Charter (Stage 1 gate, then Stage 2 quality):**

Stage 1 — Spec Compliance (gate):
1. Verify each handoff.md Validation Outcomes table has no `Fail` results and all applicable checks were run. `Fail – unrelated` is valid only when Notes names a specific file/line outside the task's Affected Files.
2. Fill an AC cross-reference table: every AC from spec.md must appear (missing = Stage 1 fail). Columns: AC, Status (Met/Partial/Not Met), Notes.
3. Non-goals respected? Known Risks addressed? Human Test Plan satisfiable? Any dropped section = Stage 1 fail.
4. If Stage 1 fails: list the failures and mark Stage 2 as "Not run — Stage 1 failed." Do NOT write Stage 2 findings.

Stage 2 — Code Quality (only if Stage 1 passed):
- Label findings: `correctness bug`, `risk/guardrail`, `optional cleanup/nit`, `spec gap` (inline label for ambiguous spec wording — distinct from the halt verdict).
- Test change rule: any test change must be directly justified by a spec AC. A test changed to pass against broken behavior = `correctness bug`.
- Reference findings by file:line and AC number.

**Return format** (foreman reads this):

```
STAGE_1: pass | fail
AC_TABLE:
| AC-N | Met/Partial/Not Met | one-line note |
...
STAGE_1_GAPS: (if fail) bulleted list of gaps
STAGE_2_FINDINGS:
- [correctness bug | risk/guardrail | optional cleanup/nit | spec gap] file:line — description
...
OVERALL_SIGNAL: approve | changes_requested
```

If Stage 1 failed, omit STAGE_2_FINDINGS and set OVERALL_SIGNAL: changes_requested.
```

**7b. `.claude/agents/code-review-cold.md`:**

```markdown
---
name: code-review-cold
description: Cold (spec-blind) adversarial code reviewer. Receives diff only — no spec, no AC context. Returns structured findings to the foreman; does NOT write review.md or set the verdict.
---

You are the **cold** code reviewer in a two-lens review pipeline. You have received a code diff — no spec, no acceptance criteria, no canon context. Your role is adversarial: find problems the diff introduces, regardless of intent.

**Your task:** Review the diff for bugs, race conditions, lifecycle issues, consistency gaps, security risks, and code quality issues. Treat anything suspicious as potentially wrong. Your findings will be reconciled against the spec by a synthesis foreman.

Do NOT write `review.md` directly and do NOT run `canon task phase` commands.

**Return format** (foreman reads this):

```
COLD_FINDINGS:
- [correctness bug | race condition | lifecycle issue | consistency gap | security risk | code quality] file:line — description. Severity: high | medium | low
...
COLD_OVERALL_SIGNAL: approve | changes_requested
```

If no problems found: `COLD_FINDINGS: (none)` and `COLD_OVERALL_SIGNAL: approve`.
```

**7c & 7d. Mirrors:** Create `templates/.claude/agents/code-review-anchored.md` and `templates/.claude/agents/code-review-cold.md` with identical content. After registering in CANON_OWNED (Step 9), `npm run sync-templates` will keep them in sync going forward.

---

## Step 8 — Create the foreman prompt template

**New file:** `scripts/run-task/prompts/templates/code-review-foreman.md`

This template is rendered by `promptCodeReview()` and sent to the foreman session. The foreman spawns both lenses via `subagent_type`, adjudicates, and writes `review.md` + verdict. Mustache variables match the render call in Step 10.

```markdown
You are the **synthesis foreman** for the code review phase for {{taskScope}} for {{projectName}}.

{{{startup}}}

**Your job**: Spawn the two review lenses as parallel sub-agents, collect their findings, adjudicate using the spec (which you hold — the cold lens did not see it), then write `review.md` and set the verdict.

Tasks:
{{{taskLines}}}

{{#isRound1}}
This is **Round 1** (initial review).
{{/isRound1}}
{{^isRound1}}
This is **Round {{roundN}}** — re-review after iteration {{priorIteration}}. Both lenses re-run from scratch. Direct the anchored lens to read the `## Iteration {{priorIteration}} — addressing review round {{priorIteration}}` section of `handoff.md`.
{{#tightenLine}}
{{{tightenLine}}}
{{/tightenLine}}
{{/isRound1}}

{{#hasDiff}}
**Task diff against {{{baseBranch}}}**

```diff
{{{diffContent}}}
```
{{#diffTruncated}}
> Diff truncated at 50 000 bytes — direct each lens to read changed files from handoff.md Changes table for the remainder.
{{/diffTruncated}}
{{/hasDiff}}
{{^hasDiff}}
Retrieve the diff: `git diff {{{baseBranch}}}...HEAD`.
{{/hasDiff}}

---

## Foreman protocol

### Step 1 — Spawn lenses in parallel

Spawn two sub-agents simultaneously using `subagent_type`:

**Anchored lens** (`code-review-anchored`):
Give it: the full diff + spec.md + handoff.md for each task. It applies the full code-review charter (Stage 1 + Stage 2). Do NOT give it the cold lens's findings.

**Cold lens** (`code-review-cold`):
Give it: the full diff ONLY. No spec, no AC context, no canon docs. The isolation is a hard contract.

### Step 2 — Adjudicate

Using the findings from both lenses AND the spec:

1. **Dedup**: if both lenses flagged the same issue (same file:line or behavior), collapse to one entry. Note "flagged by both lenses."

2. **Cold-vs-spec reconciliation**: for each cold-lens finding, does the spec (a Non-Goal, an explicit decision, or AC wording) explain it as intended? If yes, DROP it but record `Dismissed (cold): [spec reason]` in the review. If ambiguous, keep it with a note.

3. **Altitude classification**: for every surviving finding, classify as:
   - `code-bug` — the implementation is wrong regardless of spec
   - `spec-gap` — the spec itself is missing or wrong; correct implementation is ambiguous

### Step 3 — Determine verdict

- Any `code-bug` finding → `changes_requested`
- Any `spec-gap` finding and no code-bugs → `spec_gap` (halt for human; do NOT loop back to implement)
- Only nits/cleanup → `approved_with_nits`
- No findings → `approved`

### Step 4 — Write `review.md`

For each task, write `tasks/<id>/review.md`. Structure:
- **Stage 1 section**: anchored lens AC table and validation gate assessment
- **Stage 2 / Findings**: surviving findings from both lenses, labeled with altitude (`code-bug` or `spec-gap`), source lens, and file:line
- **Dismissed cold findings**: brief subsection with each dismissed item and the spec reason
- **Final Verdict**: check the single verdict checkbox (`Approved`, `Approved with nits`, `Changes requested`, or `Spec gap`)

On re-review (Round N+): append a `## Round {{roundN}}` section rather than rewriting.

### Step 5 — Set the verdict

Run (one per task with actual verdict):
{{{phaseCommands}}}
```

---

## Step 9 — Register canon-owned agent defs (`src/lib/canon-owned.ts`)

Add the two new agent defs to `CANON_OWNED` so they sync to `templates/` and ship via `canon upgrade`:

```typescript
'.claude/agents/code-review-anchored.md',
'.claude/agents/code-review-cold.md',
```

---

## Step 10 — Rewrite `promptCodeReview()` in `prompts/index.ts`

**10a. Import the new template:**
```typescript
import codeReviewForemanTemplate from './templates/code-review-foreman.md';
```

**10b. Add to `TEMPLATES` map:**
```typescript
'code-review-foreman.md': codeReviewForemanTemplate,
```

**10c. Rewrite `promptCodeReview()`** — always uses the foreman template; round context injected as variables:

```typescript
export function promptCodeReview(
    state: PipelineState,
    baseBranch?: string,
    scopedDiff: ScopedDiff | null = null,
): string {
    const { tasks } = state;
    const rawMaxIter = tasks.reduce((max, t) => Math.max(max, t.iterations), 0);
    // Force Round 1 if any task lacks a real prior Stage 1 review (same guard as before).
    const maxIter = bundleHasRealPriorReview(tasks.map(t => t.taskId)) ? rawMaxIter : 0;
    const resolvedBaseBranch = baseBranch ?? getBaseBranch(tasks.map(t => t.taskId));
    const hasDiff = scopedDiff !== null;

    const isRound1 = maxIter === 0;
    const roundN = maxIter + 1;
    const priorIteration = maxIter;
    const tightenLine = roundN >= 3
        ? `**Round ${roundN} discipline.** Findings must be \`correctness bug\` or \`spec gap\` only — no nits.`
        : '';

    const taskLines = isRound1
        ? tasks.map(t =>
            `- \`${t.taskId}\`: read tasks/${t.taskId}/handoff.md and cross-reference tasks/${t.taskId}/spec.md ACs`
          ).join('\n')
        : tasks.map(t =>
            `- \`${t.taskId}\` → read the \`## Iteration ${priorIteration} — addressing review round ${priorIteration}\` section of \`tasks/${t.taskId}/handoff.md\``
          ).join('\n');

    const diffView = hasDiff
        ? { hasDiff, baseBranch: resolvedBaseBranch, diffContent: scopedDiff.diff, diffTruncated: scopedDiff.truncated }
        : { hasDiff, baseBranch: resolvedBaseBranch, diffContent: '', diffTruncated: false };

    return render('code-review-foreman.md', {
        projectName: config.projectName,
        startup: CLAUDE_STARTUP,
        taskScope: tasks.length > 1 ? 'a bundle of tasks' : `task "${tasks[0].taskId}"`,
        taskLines,
        isBundle: tasks.length > 1,
        isRound1,
        roundN,
        priorIteration,
        tightenLine,
        ...diffView,
        phaseCommands: phaseCommands(tasks.map(t => t.taskId), 'code_review', 'done', '<verdict>'),
    });
}
```

The `bundleHasRealPriorReview()` helper and its `taskDirFor`-based read are UNCHANGED.

The old `codeReviewRound1Template` / `codeReviewRoundNTemplate` imports and their `TEMPLATES` entries remain (they're still part of the codebase and referenced by the golden tests). Leave them in place; they just aren't returned by `promptCodeReview()` anymore.

---

## Step 11 — Update existing round-1/round-N prompt templates

**`scripts/run-task/prompts/templates/code-review-round-1.md`** and **`code-review-round-n.md`**: Add a header comment noting these templates now serve as the anchored lens charter base (embedded in `.claude/agents/code-review-anchored.md`). No functional change to the methodology text — the redirect ("return findings to foreman, don't write review.md") is in the agent def file.

This satisfies AC-7: `promptCodeReview()` no longer returns a prompt that tells the reviewer to write `review.md` and set the verdict directly. The old direct-review path is gone from the render path.

---

## Step 12 — `spec_gap` routing in `checkAndRoute()` (`scripts/run-task/main.ts`)

In the `case 'code_review':` block (line ~2537), add the `spec_gap` intercept **before** the `anyChangesRequested` check. Without this intercept, a `spec_gap` verdict falls through with no `routeBackTo` call, and the phase runner loop advances to `qa` — violating AC-5.

```typescript
case 'code_review': {
    // spec_gap intercept — halt for human BEFORE changes_requested routing.
    // spec_gap means the spec is wrong, not the code — do NOT route to implement.
    const anySpecGap = statuses.some(s => getVerdict(s, 'code_review') === 'spec_gap');
    if (anySpecGap) {
        const maxIter = statuses.reduce((max, s) => Math.max(max, getIterations(s)), 0);
        const specGapIds = taskIds.filter((_, i) => getVerdict(statuses[i], 'code_review') === 'spec_gap');
        const reason =
            `Code review surfaced a spec_gap verdict for task(s): ${specGapIds.join(', ')}. ` +
            `The code faithfully implements the spec, but the spec itself is wrong or incomplete. ` +
            `Review tasks/<id>/review.md for the specific spec problem. ` +
            `To resume: revise the spec (add an ## Amendment section), reset ` +
            `phases.code_review.status to "pending" in status.json, and re-run.`;
        console.log('');
        console.log('════════════════════════════════════════════════════════');
        console.log('  ✋  SPEC GAP — Code review surfaced a spec problem.');
        console.log('');
        console.log('  The code matches the spec, but the spec is wrong or incomplete.');
        console.log('  Review the findings:');
        for (const id of specGapIds) console.log(`    tasks/${id}/review.md`);
        console.log('');
        console.log('  To resume: revise the spec → reset code_review to pending → re-run.');
        for (const id of specGapIds) {
            console.log(`    # Edit tasks/${id}/spec.md  (add ## Amendment section)`);
            console.log(`    canon task phase ${id} code_review pending`);
        }
        console.log(`  canon run ${taskIds.join(' ')}`);
        console.log('════════════════════════════════════════════════════════');
        console.log('');
        splitState.autoBlockPhase(taskIds, 'code_review', maxIter, reason);
        process.exit(2);
    }

    const anyChangesRequested = statuses.some(s =>
        getVerdict(s, 'code_review') === 'changes_requested' ||
        getVerdict(s, 'code_review') === 'needs_re_review'
    );
    if (anyChangesRequested) {
        const maxIter = statuses.reduce((max, s) => Math.max(max, getIterations(s)), 0);
        info(`Code review requested changes (iteration ${maxIter}) — routing back to implement`);
        routeBackTo(taskIds, 'implement');
    }
    return;
}
```

`splitState.autoBlockPhase` is already available via `import * as splitState from './state.js'`. `getIterations` is already defined as a local helper in main.ts.

---

## Step 13 — Docs updates

**13a. `CLAUDE.md` — "Reviewing Code" section and "Review Responsibilities":**
- Update to describe the two-lens + foreman model: the phase session is the foreman; it spawns an anchored lens (current charter) and a cold lens (spec-blind) as parallel sub-agents; it adjudicates and writes the single `review.md` + verdict.
- Add `spec_gap` description: root cause is the spec; foreman sets this when spec explains/fails to explain something; routes to `code_review.status='blocked'`; human's path is revise spec → reset pending → re-run.

**13b. `AGENTS.md` — "Reviewing Code" / "Review Responsibilities":**
Same structural update. Cross-review rule unchanged; add two-lens foreman framing.

**13c. `docs/pipeline-orchestrator.md`:**
In the verdict/routing table, add `spec_gap` row: blocks + escalates via `autoBlockPhase`, does NOT route to implement.

The canon-managed mirrors (`templates/CLAUDE.md`, `templates/AGENTS.md`, `templates/docs/pipeline-orchestrator.md`) are auto-synced by `npm run sync-templates` via the pre-commit hook. Do NOT hand-edit the `templates/` copies.

---

## Step 14 — Tests (AC-11: deterministic surface only)

Consolidate new tests into existing test files per the per-feature convention. Add tests to:
- `tests/run-task-extract-verdict.test.ts` or `tests/run-task-validation.test.ts` — verdict extraction + gate
- `tests/task-cli.test.ts` — `canon task phase` runtime acceptance
- `tests/run-task-validation.test.ts` — routing
- `tests/run-task-safety.test.ts` — phase-level fail-loud
- `tests/run-task-prompts.test.ts` — foreman prompt selection (golden regeneration)

**Test group 1 — Verdict plumbing (seven surfaces per AC-10/nit #2):**
- `extractCheckedVerdict()` returns `'spec_gap'` when `review.md` has `- [x] **Spec gap**` checked
- `extractCheckedVerdict()` returns `null` for unchecked or misspelled forms
- `checkPhaseGate('code_review', verdict='spec_gap')` returns `{ ok: true }` when review.md has the checkbox checked and content is not template
- `canon task phase <id> code_review done spec_gap` succeeds: writes `status.json` with `phases.code_review.verdict = 'spec_gap'`, `iterations_current_loop = 0`, `iterations_total` incremented (spec nit #1)
- `canon task phase <id> code_review done spec_gap` fails with a runtime error when `VALID_VERDICTS` didn't include it (negative: verify old set would reject — can be a comment, not a live test)

**Test group 2 — `spec_gap` routing:**
- `checkAndRoute('code_review', taskIds)` with a task having `verdict='spec_gap'` → `autoBlockPhase` fires → `code_review.status='blocked'` with an escalation entry appended, and `qa` phase is NOT advanced to `in_progress` or `done`
- `checkAndRoute('code_review', taskIds)` with `changes_requested` → routes to `implement` (existing; verify unchanged)
- `checkAndRoute('code_review', taskIds)` with `approved` → falls through cleanly (no block, no implement reroute)

**Test group 3 — Phase-level fail-loud (AC-6):**
- After a foreman run where `review.md` is still the unfilled template, `isTemplateUnfilled` check in `runCodeReviewPhase` resets `code_review.status` to `pending` (existing test; verify the check survives the refactor since the check in `code-review.ts` is independent of the prompt template)

**Test group 4 — Model tier (no regression):**
- `getClaudeConfig('code_review', tasks)` with S/M task → sonnet; L/XL/delicate → opus — no change to `pipeline-policy.ts` means existing tests cover this; add a comment that the foreman and lenses run at this tier

**Golden snapshot:** `promptCodeReview()` output changes. Regenerate `tests/run-task-prompts.golden.json` via the test's golden-regen mechanism (check the test file for the env-var or flag — e.g., `CANON_UPDATE_GOLDEN=1 npm test` or the `--update-snapshots` flag). Do NOT hand-edit the golden file.

---

## Step 15 — Build and verification

Run in order:
```bash
npm run lint
npm run type-check
npm run test
npm run build           # rebuilds dist/**
npm run sync-templates:check
npm run docs-refs-check
```

Commit `dist/**` alongside source changes. The pre-commit hook auto-syncs `templates/` from root canon-managed files and re-stages them — if the hook doesn't fire (e.g., on a rebase step), run `npm run sync-templates` manually before committing.

---

## Implementation order summary

1. `scripts/run-task/types.ts` — `spec_gap` in `_VERDICT_VALUES`
2. `src/task/index.ts` — `VALID_VERDICTS`, `assertValidVerdict`, `updateReviewCounters`
3. `src/cli/index.ts` — help verdict list
4. `scripts/run-task/validation.ts` — `extractCheckedVerdict` regex
5. `.canon/templates/status.json` + `templates/` mirror — `_verdict_values` hint
6. `.canon/templates/review.md` + `templates/` mirror — `spec_gap` checkbox
7. `.claude/agents/code-review-anchored.md`, `.claude/agents/code-review-cold.md` (new) + `templates/` mirrors
8. `scripts/run-task/prompts/templates/code-review-foreman.md` (new)
9. `src/lib/canon-owned.ts` — register new agent defs
10. `scripts/run-task/prompts/index.ts` — import + `TEMPLATES` + rewrite `promptCodeReview()`
11. `scripts/run-task/prompts/templates/code-review-round-1.md`, `code-review-round-n.md` — header redirect note
12. `scripts/run-task/main.ts` — `spec_gap` intercept in `checkAndRoute()`
13. `CLAUDE.md`, `AGENTS.md`, `docs/pipeline-orchestrator.md` — two-lens/foreman/`spec_gap` docs
14. Tests across `run-task-extract-verdict`, `run-task-validation`, `task-cli`, `run-task-safety`
15. Regenerate `tests/run-task-prompts.golden.json`
16. `npm run build` → commit `dist/**`
