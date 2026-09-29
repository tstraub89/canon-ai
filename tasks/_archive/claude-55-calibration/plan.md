# Implementation Plan: claude-55-calibration

> Written by: Claude | Implements: `tasks/claude-55-calibration/spec.md`

## Approach

Four independent edits on shared prompt surfaces plus one orchestrator routing branch:

1. **Foreman valid/clean/missing rule + reviewer stop.** Rewrite the foreman template's lens-return guidance, render a `code_review blocked` command list for it, and add a `checkAndRoute` branch that turns a code_review `blocked` into a whole-bundle stop (exit 2, escalation, no recovery).
2. **`CLAUDE_HEADLESS`.** New constant in `helpers.ts`, prepended inside `runClaude`'s unattended `attempt()` after resume wrapping, which mirrors `codex.ts:42-43`.
3. **Delegation bound.** Foreman text plus one line in each charter.
4. **Plan feasibility check.** One text builder in `prompts/index.ts`, rendered into `plan.md`, `plan-reroute.md`, and the fast-tier combined spec instruction and `selfCheck`.

Write the red-first tests (AC-1, AC-1b, AC-3) before touching the code they cover, and record their failing runs in the handoff.

**Feasibility check (for this plan):**
- **Exists:** confirmed by reading `runClaude` (`src/orchestrator/agents/claude.ts`), `CODEX_HEADLESS`/`toResumePrompt`/`phaseCommands` (`src/orchestrator/prompts/helpers.ts`), `promptSpec`/`promptPlan`/`promptCodeReview` (`src/orchestrator/prompts/index.ts`), `checkAndRoute`/`recoverPhaseForTask`/`retryAgentForPhase`/`tryEvidenceAdvance` (`src/orchestrator/main.ts`), `autoBlockPhase` (`src/orchestrator/state.ts`), `taskResetCodeReview` and `taskPhase` (`src/task/index.ts`), and `runCheckAndRouteInFixture`/`writeTask`/`initReviewRepo`/`withTempTasksAsync` (`tests/run-task-code-review.test.ts`).
- **Real path (routing):** phase loop (`main.ts` ~3662) → `runPhase('code_review')` → `runCodeReviewPhase`. That function marks every task `in_progress` (`phases/code-review.ts:367`) before the foreman runs. Each of its own `autoBlockPhase` calls is followed by `process.exit(2)`. The preflight-rejection early return sets `done` through `taskPhasePreflightRejected`. After the foreman, the function resets code_review to `pending` only when `review.md` is still the template. Then the session is stored and `checkAndRoute` runs (`main.ts:3690`, its only caller). So a `blocked` that reaches `checkAndRoute('code_review')` can only have been set during the foreman session, by the foreman or by an interactive human. A leftover `blocked` from an earlier stop can't reach it, because the phase start overwrites it with `in_progress`. Today that `blocked` goes to `recoverPhaseForTask`, whose evidence check finds no verdict, prints "Evidence insufficient … Attempting one-shot retry.", and calls `retryAgentForPhase`. That function resumes `claude_review` with `canon task phase <id> code_review done <verdict>`.
- **Real path (preamble):** `runClaude` has 5 callers (`phases/spec.ts:40,56`, `phases/plan.ts:25`, `phases/qa.ts:28`, `phases/code-review.ts:437`) plus the retry at `main.ts:3131`, and it is the only place src/ spawns `claude` for a session (the other `claude` spawn is a version probe in `canon-snapshot.ts`). If the preamble goes in `attempt()`, every unattended call gets it, including the resume-not-found fallback (`attempt(null)`). `toResumePrompt` strips `CLAUDE_STARTUP` by matching the exact `\n\n<block>\n\n`. The preamble is prepended outside that wrapper, so the stripping still works.
- **Callers:** `checkAndRoute` has only the one caller. `runClaude`'s signature doesn't change, and its argv changes only in the `-p` value. No test asserts the exact unattended `-p` text: `run-task-safety.test.ts:7977` checks exit markers only, and `run-task-reroute-preflight.test.ts:366` masks the prompt. `run-task-prompts.test.ts:422` tests `toResumePrompt` directly, and that function is unchanged.
- **Tests that can fail:** AC-1b's single-task case fails on the current code because the output contains "Evidence insufficient" and no escalation is written. The current code still exits 2 (`no_session` → "did not reach 'done'"), so **exit code alone is not a red signal**; assert on the output and the escalation too. AC-3 fails on the current code because `CLAUDE_HEADLESS` is undefined; each test asserts it is truthy first. AC-1 fails because the current foreman text contains "quiet lens output is a bug".
- **Predicates:** the new branch fires only when `phase === 'code_review'` and at least one task's `phases.code_review.status === 'blocked'`. It doesn't depend on the verdict: a stale verdict from an earlier round can survive under `blocked` (`taskPhase` clears the verdict only on `pending`). `pending`, `in_progress`, and `changes_requested` statuses keep the current recovery path, and the AC-1b unchanged-path test pins that.
- **Affected Files:** every file below is in the spec's table. See the spec gap in `notes.md` about the `canon-spec` skill's XS plan step, which is out of scope and not edited.
- **Async/stateful:** routing runs after the agent session exits, so there's no re-entry. The stop calls `autoBlockPhase` once per bundle, then exits. `auto_block_count` goes up, as with the spec_gap stop. The recovery path (`taskResetCodeReview`) accepts a code_review `blocked` task, because `blocked` is not `done`, so code_review stays the current phase. It archives `review.md`, sets implement `done` and code_review `pending`, and clears the verdict and `claude_review`.

**Base note:** `rebaseline-claude-matrix-for-5-5` has already landed on `main` (#69, `1f2450f`), so this task is the one that lands second. There is nothing to rebase. `docs/decisions.md` already has its entry, and this task's entry goes after it (step 9).

## Steps

### Step 1: Red-first tests (write first, run against the unchanged code, record failures)

Files: `tests/run-task-prompts.test.ts`, `tests/run-task-code-review.test.ts`

**AC-1 (prompts test).** Add one test that renders all four code-review paths with the same arguments the golden tests use: `promptCodeReview_round1` (`run-task-prompts.test.ts` ~527), `_roundN`, `_deltaRound`, and `_fullSendOutOfScope`. Loop over the four renders and assert the following on each, using tokens rather than full sentences:
- `assert.doesNotMatch(p, /quiet lens output is a bug/)`
- `/STAGE_2_FINDINGS: \(none\)/` and `/COLD_FINDINGS: \(none\)/` (the empty forms), plus `/Stage 1 fail/i` (the anchored fail form)
- `/re-spawn/`, `/approval evidence/`, `/no verdict box/i`
- the rendered no-verdict blocked command: `/canon task phase \S+ code_review blocked\)/`. The closing paren confirms that no verdict follows, because `phaseCommands` wraps each command as `(cd '…' && …)`.

**AC-1b (code-review test).** Add these tests next to the full-send router tests (~`run-task-code-review.test.ts:440-520`). Use `withTempTasksAsync`, `initReviewRepo(activeCwd)` (every existing subprocess router test does this), and `writeTask`, which leaves implement `done`, `sessions: {}`, and so no `claude_review` session. Add a small helper:

```ts
function writeBlockedReview(tasksRoot: string, taskId: string): void {
    fs.writeFileSync(path.join(tasksRoot, taskId, 'review.md'),
        '# Code Review\n\n## Stage 1\n\nAnchored lens return missing after re-spawn.\n\n## Final Verdict\n\n- [ ] Approved\n- [ ] Changes requested\n');
}
function setCodeReviewStatus(tasksRoot: string, taskId: string, s: 'blocked' | 'in_progress'): void { /* readStatus → set phases.code_review.status → writeStatusToFile */ }
```

The review must not contain the template placeholder (bracketed uppercase TASK-ID), so that `isTemplateUnfilled` is false, and must have no `[x]`.

Cases:
1. **Single blocked.** `result = runCheckAndRouteInFixture(tasksRoot, activeCwd, 'rb-single')`. Assert:
   - `result.status === 2`;
   - `readStatus(...).phases.code_review.status === 'blocked'`;
   - `escalations.filter(e => e.phase === 'code_review').length === 1`;
   - `result.output` matches `/tasks\/rb-single\/review\.md/` and `/reset-code-review/`;
   - `doesNotMatch(result.output, /Evidence insufficient/)`.
2. **Bundle.** `rb-a` is `blocked` and `rb-b` is `in_progress`, both with `writeBlockedReview`. Assert exit 2, both tasks `blocked` with one code_review escalation each, and no `Evidence insufficient` in the output.
3. **Recovery.** After case 1, import `taskResetCodeReview` from `../src/task/index.js` and call it in-process. The absolute `CANON_TASKS_DIR_OVERRIDE` set by `withTempTasksAsync` resolves the directory. Assert implement is `done` and code_review is `pending`. The reset prints a "no template" warning because the fixture has no `.canon/templates/review.md`. That warning is expected and harmless.
4. **Unchanged path.** A single task with `in_progress` and the same review. Assert that `result.output` matches `/Evidence insufficient/`, and that no code_review escalation was written. The current code exits 2 through `no_session`, and so does the new code, so the exit code can be asserted too.

**AC-3 (code-review test, next to the Codex headless test at ~932).** Import the namespace with `import * as promptHelpers from '../src/orchestrator/prompts/helpers.js';`. At the top of each test, write `const headless = (promptHelpers as { CLAUDE_HEADLESS?: string }).CLAUDE_HEADLESS; assert.ok(headless, 'CLAUDE_HEADLESS is exported');`. A missing export then fails that one test instead of crashing the file. Import `runClaude` from `../src/orchestrator/agents/claude.js`.

The fake `claude` is a node script, like the one in `run-task-reroute-preflight.test.ts:282-290`:

```js
#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(ARGS_FILE, JSON.stringify(args) + '\n');
const r = args.indexOf('--resume');
if (r !== -1 && args[r + 1] === 'missing-id') { process.stderr.write('No conversation found with session ID missing-id\n'); process.exit(1); }
console.log(JSON.stringify({ type: 'result', session_id: '00000000-0000-0000-0000-000000000000', result: '' }));
```

The prompt is `args[args.indexOf('-p') + 1]` for unattended calls and the last argv element for interactive ones. Use one test with four calls or four small tests (four keeps the red run per assertion):
- `runClaude('fresh prompt', false, null, 'sonnet', 'medium', '1', undefined, dir)`: the prompt `startsWith(headless)` and `endsWith('fresh prompt')`.
- `runClaude('resumed prompt', false, 'resume-id', …)`: `startsWith(headless)`, and `indexOf('[Resumed session') > headless.length - 1`.
- `runClaude('fallback prompt', false, 'missing-id', …)`: the capture file has 2 lines, and the **second** (the fresh fallback) `startsWith(headless)`, contains no `--resume`, and doesn't contain `[Resumed session`. The resumeNotFound check in `attempt()` runs before the exit-code check, so the fake's exit 1 does not reach `process.exit`.
- `runClaude('interactive prompt', true, null, …)`: the last argv element doesn't include `headless` and equals `'interactive prompt'`.

Save and restore `PATH` in `finally`, as the Codex test does. Mark each test `{ concurrency: false }`.

**Red run:** `npx tsx --test tests/run-task-prompts.test.ts tests/run-task-code-review.test.ts` (or `npm test`). Paste the failing assertion lines into the handoff: the AC-1 first assertion; AC-1b single-task (`Evidence insufficient` present, 0 escalations); AC-3 fresh, resumed, and fallback. The interactive negative case is expected to pass on the current code.

### Step 2: `CLAUDE_HEADLESS` constant

Files: `src/orchestrator/prompts/helpers.ts`

Add it after `CODEX_HEADLESS`, in the same string-concatenation style. Suggested text; the wording can change, but keep the tokens that AC-4 asserts (listed in Step 11):

```ts
export const CLAUDE_HEADLESS =
    'Unattended session: this runs non-interactively — nobody reads your messages or answers questions until the phase ends. Don\'t stop to ask for confirmation or clarification. When something is ambiguous, record the question and the interpretation you chose in this phase\'s artifact or in `tasks/<id>/notes.md`, and proceed on it.\n' +
    '\n' +
    'The phase is complete only when its artifact is written and its phase command (the `canon task phase` command(s) this prompt lists) has run. A progress summary, a description of next steps, or an offer to continue is not completion — keep working until both are done.\n' +
    '\n' +
    'Do only this phase: don\'t run `canon run`, advance any other phase, or start review passes, review skills, or reviewer sub-agents this prompt didn\'t ask for.\n' +
    '\n' +
    'Report a check that couldn\'t run, or that failed, as exactly that — never as passed.\n' +
    '\n' +
    'If a project instruction file or other repository guidance says to ask or wait for approval before an action, there is no one to ask in this session. Skip that action unless this prompt explicitly authorizes it, record the question in the phase artifact, and continue with the rest of the authorized work.';
```

Don't touch `CLAUDE_STARTUP`, `CODEX_STARTUP`, `CODEX_HEADLESS`, or `toResumePrompt`.

### Step 3: Prepend in `runClaude`

Files: `src/orchestrator/agents/claude.ts`

Import `CLAUDE_HEADLESS` next to `toResumePrompt`. In `attempt()`:

```ts
const renderedPrompt = useResumeId ? toResumePrompt(prompt) : prompt;
const effectivePrompt = `${CLAUDE_HEADLESS}\n\n${renderedPrompt}`;
```

Leave the interactive branch (`args.push(resumeId ? toResumePrompt(prompt) : prompt)`) unchanged. Don't add a parameter: the retry at `main.ts:3131` already passes `interactive=false` and goes through `attempt()`.

### Step 4: Foreman template

Files: `src/orchestrator/prompts/templates/code-review-foreman.md`

1. **§1, after the paragraph at line 120** ("The injected cold-Codex findings … Do not let a Claude lens see another lens's output."), add two paragraphs:
   - **Spawn only these.** Each round, spawn exactly the two Claude lenses above, plus at most one **re-spawn** of a lens whose return is missing. Spawn no other reviewers or review agents, don't run review skills, and never substitute your own review for a lens's return.
   - **Valid vs. missing lens returns.** A return is valid when it follows the lens's charter return format. That includes the charter's empty form, which is a clean review and valid evidence (`STAGE_2_FINDINGS: (none)` from the anchored lens, `COLD_FINDINGS: (none)` from the cold lens), and the anchored lens's Stage 1 fail form (`STAGE_1: fail`, no Stage 2 findings, `OVERALL_SIGNAL: changes_requested`). A return is missing when it is absent or doesn't follow the charter format. Re-spawn a missing lens once with the same inputs. If it is still missing, don't approve and don't guess at its findings: a missing lens is not **approval evidence**. Write `review.md` recording which lens was missing and what came back, check **no verdict box**, then run the `code_review blocked` commands in step 5 for every task in this review. Findings from the other lenses may be recorded but are not adjudicated into a verdict.
2. **§2, line 126:** replace ``Filtering is **your** job, not theirs: a quiet lens output is a bug in the lens, not a clean diff.`` with ``Filtering is **your** job, not theirs. A clean return in the charter's empty form is a valid result, not a lens failure; only a missing return (step 1) is.`` Keep the rest of the paragraph.
3. **§4 "Include:", last bullet:** add "(except the missing-lens stop in step 1, which checks none)" to "Final Verdict: check exactly one verdict checkbox…". Without this, the missing-lens stop contradicts the checkbox instruction.
4. **§5:** after `{{{phaseCommands}}}` add:

   ```
   If a lens was still missing after its re-spawn (step 1), write `review.md` first, then run these instead, with no verdict — this stops the run for the human:
   {{{blockedCommands}}}
   ```

   Writing `review.md` first matters. If `review.md` is still the template, the post-foreman check resets code_review to `pending`, and the stop becomes an ordinary retry (spec, Interaction Dependencies).

Keep the rendered text free of any `src/orchestrator/` path or template filename. The template isn't mirrored, but the rule applies to adopter-visible text anyway.

### Step 5: Render `blockedCommands`

Files: `src/orchestrator/prompts/index.ts`

In `promptCodeReview`'s `render('code-review-foreman.md', {...})`, add:

```ts
blockedCommands: phaseCommands(tasks.map(t => t.taskId), 'code_review', 'blocked'),
```

`phaseCommands` with no verdict renders `canon task phase <id> code_review blocked`.

### Step 6: `checkAndRoute` reviewer-stop branch

Files: `src/orchestrator/main.ts`

At the top of `checkAndRoute`, right after `let statuses = taskIds.map(splitState.readStatus);` and **before** the per-task recovery `for` loop:

```ts
// A reviewer-set code_review `blocked` (e.g., a lens missing after its
// re-spawn) is a deliberate stop for the human. It carries no verdict, so
// evidence recovery and the `done <verdict>` retry must not run: they would
// push the reviewer to invent one. runCodeReviewPhase marks every task
// in_progress before the foreman and exits on its own auto-blocks, so a
// `blocked` seen here was set during the session.
if (phase === 'code_review') {
    const reviewerBlockedIds = taskIds.filter((_, i) => getPhaseStatus(statuses[i], 'code_review') === 'blocked');
    if (reviewerBlockedIds.length > 0) stopForReviewerBlock(taskIds, reviewerBlockedIds, statuses);
}
```

Add `function stopForReviewerBlock(taskIds: string[], blockedIds: string[], statuses: StatusJson[]): never` near the `checkAndRoute` section divider. Follow the spec_gap stop at `main.ts:3326-3372`:
- `maxIter = statuses.reduce((max, s) => Math.max(max, getIterations(s)), 0)`.
- `reason`: something like `` `Code review stopped without a verdict for task(s): ${blockedIds.join(', ')} — the reviewer set code_review blocked; see ${blockedIds.map(id => `tasks/${id}/review.md`).join(', ')}. No retry was attempted. Recovery (the full blocked bundle [${taskIds.join(' ')}]): ${taskIds.map(id => `canon task reset-code-review ${id}`).join('; ')}, then canon run ${taskIds.join(' ')}` ``.
- Print a banner in the spec_gap style: a `✋  CODE REVIEW STOPPED — the reviewer could not reach a verdict.` title, each `tasks/<id>/review.md` on its own line, the per-id `canon task reset-code-review <id>` lines, then `canon run <ids>`. Add one line saying that re-running without the reset starts a fresh review pass without archiving the stopped `review.md`.
- `splitState.autoBlockPhase(taskIds, 'code_review', maxIter, reason);` blocks the **whole bundle**: it marks every member blocked with one escalation each, as the spec_gap stop does.
- `process.exit(2);`

Nothing else in `checkAndRoute` changes. This includes the implement-done evidence check, the full-send scope check, and the `switch`.

### Step 7: Charters

Files: `.claude/agents/code-review-anchored.md`, `.claude/agents/code-review-cold.md`

- **Both:** after the "Do not ask the user for permission to edit files." line, add `Do this review yourself: spawn no sub-agents and run no review skills or other reviewers.` Keep the existing "Coverage is your job; filtering is not." sentences unchanged.
- **Anchored, Return Format:** after the "If Stage 1 failed…" line, add:

  ````
  If Stage 1 passes and you find no Stage 2 issues, return:

  ```text
  STAGE_1: pass
  AC_TABLE:
  | AC | Met/Partial/Not Met | note |
  STAGE_1_GAPS: (none)
  STAGE_2_FINDINGS: (none)
  OVERALL_SIGNAL: approve
  ```
  ````

- Neither charter may cite a `src/orchestrator/` path or the foreman or reroute template filename (the sync-templates guard).

### Step 8: Plan feasibility check

Files: `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/plan.md`, `src/orchestrator/prompts/templates/plan-reroute.md`

1. In `prompts/index.ts`, near `promptSpec`, add one builder shared by all three surfaces:

   ```ts
   function planFeasibilityCheck(placement: string, indent = ''): string {
       const lines = [
           `**Feasibility check.** Before writing steps, confirm each item below and record the results in a few lines ${placement}. Mark an item that doesn't apply \`N/A\` in a word.`,
           '- **Exists:** the functions, files, and patterns the plan relies on exist — found by searching the code, not recalled.',
           '- **Real path:** the actual runtime call path the change sits on, including any existing code on it that already does part of the work.',
           '- **Callers:** every caller of each function whose behavior or error contract changes, found and accounted for.',
           '- **Tests that can fail:** for each regression test the plan prescribes, the input or state that sends it through the changed path, so it fails without the change.',
           '- **Predicates:** for each condition or state check the plan writes out, its boundary values (for example zero, empty, or non-numeric) and every state it must handle.',
           "- **Scope:** every file the steps change is inside the spec's Affected Files.",
           '- **Async/stateful:** for async or stateful changes — re-entry, cancellation or unmount, stale state, and ownership.',
           'A finding that changes a step goes in that step. If the check contradicts the spec, record the contradiction in the plan and in `tasks/<id>/notes.md` with a `[plan]` prefix. Do not change the spec or widen scope to resolve it.',
       ];
       return lines.map((line, i) => (i === 0 ? line : indent + line)).join('\n');
   }
   ```

2. **`promptPlan`, normal branch:** pass `feasibilityCheck: planFeasibilityCheck("in the plan's Approach section")`. In `plan.md`, insert `{{{feasibilityCheck}}}` as its own paragraph between the "Write tasks/<id>/plan.md …" line and the "If you encounter spec gaps …" line.
3. **`promptPlan`, reroute branch:** pass `feasibilityCheck: planFeasibilityCheck('at the top of the appended `### Delta` section', '   ')`. In `plan-reroute.md`, add step `7. {{{feasibilityCheck}}}` after step 6, inside the "For each task — EXCEPT … EXEMPT …" list. Update the trailing `<!-- per-round append shape -->` comment so that `### Delta` begins with a `- Feasibility: …` line before the ordered steps. Verdict lines are unchanged, so an exempt sibling's line carries no feasibility text.
4. **`promptSpec`, fast tier (`combined`):**
   - Single-task string: after the "Also write tasks/${task.taskId}/plan.md …" sentence, append `\n\n${planFeasibilityCheck("in plan.md's Approach section")}`.
   - Bundle string: after `.join('\n\n')`, append `(combined ? \`\n\n${planFeasibilityCheck("in each plan.md's Approach section")}\` : '')` once, not per task.
   - `selfCheck`: add a combined-only bullet after the existing "Plan steps reference actual function/file names" bullet: `combined ? "- plan.md's Approach records the feasibility check (exists, real path, callers, tests that can fail, predicates, Affected Files, async/stateful; N/A where it doesn't apply)" : null`.
   - The full tier is unchanged. Every addition is gated on `combined`, so the `promptSpec` golden (full tier) stays byte-identical.

### Step 9: Docs

Files: `docs/pipeline-orchestrator.md`, `docs/decisions.md`

- **`docs/pipeline-orchestrator.md` §"Phase Routing + Auto-Block" table (line ~375):** add a row after the `spec_gap` row: `` | `code_review` | reviewer-set `blocked` (no verdict) | Block the whole `code_review` bundle with an escalation and exit `2`; no evidence recovery or retry is attempted. The stop names each task's `review.md`. Recovery: `canon task reset-code-review <id>` for each task, then `canon run <id>`. | ``. Don't cite source paths. Leave the rest of the doc unchanged.
- **`docs/decisions.md`:** append `---` and a new `## Claude prompt calibration audit (2026-09)` entry at the end of the file, after §"Model-generation re-baseline (2026-09): Claude defaults → 5.5 generation". That entry follows the GPT-6 Codex entry, so this placement satisfies AC-9's "after the GPT-6 Codex entry". Contents:
  - **What was audited:** every unattended Claude phase prompt (spec, spec revision, plan and plan reroute, the code-review foreman, QA) and both code-review lens charters, per §"Guardrail prompts carry an implicit model-strength calibration".
  - **Three fixes:** (1) the foreman's "quiet lens output is a bug" line is replaced by the valid/clean/missing split, and a lens missing twice stops the review with `code_review blocked` and no verdict. The orchestrator treats a reviewer-set code_review `blocked` as a stop for the human, blocking the whole bundle, and never recovers it into a verdict. (2) `CLAUDE_HEADLESS` is prepended only on unattended `runClaude` calls, including resumed, fallback, and retry calls. It must never move into `CLAUDE_STARTUP`, which also reaches `--interactive` sessions. (3) Delegation is bounded: the foreman spawns only the two lenses plus one re-spawn, and the lenses spawn no sub-agents.
  - **Separate paragraph, the plan feasibility check:** state the 422-task analysis summary (implement changes the plan's approach in 6% of tasks; about 40% of sampled non-hygiene blocking findings trace to the plan; the three defect groups; observational and unverified classification). Note that this is a plan-quality fix riding with the calibration, and point to tstraub89/canon-ai#68 for the plan-review-phase decision.
  - Any backtick paths must exist, because `docs-refs-check` resolves them. `tasks/claude-55-calibration/spec.md` and `src/orchestrator/prompts/helpers.ts` are safe. Don't cite line numbers.

### Step 10: Goldens, mirrors, bundle

- `UPDATE_GOLDENS=1 npm test`. Then `git diff --stat tests/run-task-prompts.golden.json`, and check with a small `node -e` key diff against `git show HEAD:tests/run-task-prompts.golden.json` that **only** these keys changed: `promptCodeReview_round1`, `promptCodeReview_roundN`, `promptCodeReview_deltaRound`, `promptCodeReview_fullSendOutOfScope`, `promptPlan`, `promptPlan_reroute_round1`, and `promptPlan_reroute_bundle`. Record the key list in the handoff. If `promptSpec` changed, a fast-tier addition leaked into the full tier.
- `npm run sync-templates`, then `npm run sync-templates:check`. This mirrors both charters and `docs/pipeline-orchestrator.md` into `templates/`.
- `npm run build`, which rebuilds `dist/orchestrator/run-task.js`.

### Step 11: Remaining non-red tests

Files: `tests/run-task-prompts.test.ts`

- **AC-2:** read both charters. Assert that the anchored charter includes `'STAGE_2_FINDINGS: (none)'`, the cold charter includes `'COLD_FINDINGS: (none)'`, and both include `'Coverage is your job; filtering is not.'`.
- **AC-4:** import `CLAUDE_HEADLESS` and `CLAUDE_STARTUP`. For each token in `['nobody reads', 'ambiguous', 'interpretation', 'notes.md', 'phase command', 'not completion', 'Do only this phase', 'canon run', 'reviewer sub-agents', 'never as passed', 'no one to ask', 'Skip that action unless this prompt explicitly authorizes it']`, assert `CLAUDE_HEADLESS.includes(t)` and `!CLAUDE_STARTUP.includes(t)`. Also extend the AC-11 relocation test (~783) with a `CLAUDE_STARTUP` slice check: `doesNotMatch(helpers.match(/export const CLAUDE_STARTUP =[\s\S]*?;\n/)?.[0] ?? '', /Unattended session|no one to ask/)`.
- **AC-5:**
  - Foreman, over the four renders from the AC-1 test: `/exactly the two Claude lenses/`, `/re-spawn/`, and `/never substitute your own review/`.
  - Charters: each includes `spawn no sub-agents`.
  - `CLAUDE_HEADLESS` includes `reviewer sub-agents` and `review passes`.
  - The existing tests at ~537, ~709, and ~721 still pass unchanged.
- **AC-6:** on `promptPlan(baseState)`, assert these tokens: `Feasibility check`, `searching`, `Real path`, `Callers`, `Tests that can fail`, `Predicates`, `boundary`, `Affected Files`, `re-entry`, `N/A`, `[plan]`, `notes.md`, `Do not change the spec`, `widen scope`, and `Approach section`.
- **AC-7:**
  - `promptPlan` bundle render (two `makeTask`s, full tier): contains `Feasibility check` and `Approach section`.
  - Reroute: in the existing exempt test (~319), assert `planOutput.indexOf('Feasibility check')` is greater than `indexOf('EXCEPT tasks whose line above marks them EXEMPT')` and less than `indexOf('Do **not** rewrite')`. Assert it contains `### Delta`. Assert the exempt line (`planOutput.split('\n').find(l => l.includes('test-pf-005'))`) doesn't match `/Feasibility|Real path/`.
  - `promptSpec` fast tier: build `{ tasks: [task], tier: 'fast', isBundle: false }` and a two-task bundle equivalent. Each contains `Feasibility check`, and its self-check contains `records the feasibility check`.
  - `promptSpec` full tier: doesn't contain `Feasibility check`. The unchanged `promptSpec` golden also covers this.

### Step 12: Validation

Run, in order: `npm run lint`, `npm run type-check`, `npm test`, `npm run build`, `npm run sync-templates:check`, and `npm run docs-refs-check`.

For AC-10, record the output of `grep -nE '^\| `code_review` .*blocked.*reset-code-review' docs/pipeline-orchestrator.md` in the handoff.

The handoff must not claim that the prompt assertions prove model behavior (spec AC rule).

## Testing Plan

- **Unit/prompt:** AC-1, AC-2, AC-4–AC-7 in `tests/run-task-prompts.test.ts`. Regenerated goldens (the 7 keys).
- **Integration (subprocess):** AC-1b routing fixtures and AC-3 fake-`claude` preamble tests in `tests/run-task-code-review.test.ts`.
- **Red-first:** AC-1 (first assertion), AC-1b (single-task case), and AC-3 (fresh, resumed, and fallback), each recorded against the unchanged code before Steps 2–6.
- **Manual:** the spec's Human Test Plan (human_review).

## Rollback Plan

Revert the commit. There is no data migration and no status.json shape change. The one leftover: a task stopped by the new branch keeps code_review `blocked` with an escalation. `canon task reset-code-review <id>` recovers it on either version. Adopters who ran `canon upgrade` keep the new charter text until they upgrade again. The added lines are harmless under the old foreman.
