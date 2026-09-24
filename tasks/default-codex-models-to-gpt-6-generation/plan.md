# Plan: default-codex-models-to-gpt-6-generation

> Spec review verdict: approved_with_nits. Nit (AC-9 follow-up cohort attribution) addressed in Step 8 below.

## Step 1 — Bump the two fallback defaults (AC-1)

In `src/orchestrator/env.ts:151-152`:
```ts
codexModelMini: process.env.CODEX_MODEL_MINI ?? process.env.CODEX_MODEL_DEFAULT ?? 'gpt-6-luna',
codexModelFull: process.env.CODEX_MODEL_FULL ?? process.env.CODEX_MODEL_DELICATE ?? 'gpt-6-sol',
```
Same edit in `src/orchestrator/policy.ts:24-25` (byte-identical override chain, just the two literal defaults change). Do not touch `LEGACY_FALLBACK_ENV_VARS` / `LEGACY_IGNORED_ENV_VARS` — unrelated.

Verify: `git grep -n "gpt-6-luna\|gpt-6-sol" -- src/orchestrator/env.ts src/orchestrator/policy.ts` → exactly 4 lines.

## Step 2 — `CODEX_STARTUP`: headless paragraph + precedence line + branch-sync replacement (AC-3, AC-4, AC-5)

File: `src/orchestrator/prompts/helpers.ts`. `CODEX_STARTUP` is a single template-literal string (lines 12-25) referenced by name from `toResumePrompt` (line 47) via exact-match stripping of `\n\n${block}\n\n`. Any edit must keep the string's own leading/trailing edges exactly as they are today (no new leading/trailing blank line inside the constant) — `toResumePrompt` and AC-7 depend on that.

Insert the headless/bias-to-action paragraph and the precedence line **after** the existing grounding/resumed-session lines (after line 18, `'On resumed sessions, ...'`) and **before** the blank-line + Git-ownership paragraph (line 20). Use the spec's Implementation Notes wording (spec.md lines 128-132) as the base text, adjusted to fit this file's string-concatenation style:

```ts
export const CODEX_STARTUP =
    'Read docs/patterns.md and docs/codebase-map.md before starting.\n' +
    'Skim docs/lessons-learned.md for entries relevant to your task area.\n' +
    'Read docs/decisions.md if a settled decision governs the area you are changing, or if the task would revisit one.\n' +
    'Read docs/product-context.md if the task touches user-visible behavior, product terminology, or a business rule.\n' +
    'Ground every claim in the current file, diff, or artifact before you state it. Do not rely on prior-session memory for code existence, validation results, or completion status.\n' +
    'On resumed sessions, re-read the task-specific files named in the prompt and inspect the current working tree before saying anything is already done.\n' +
    '\n' +
    'Headless session: this runs non-interactively — nobody reads your messages or answers questions until the phase ends. Don\'t stop to ask for confirmation or clarification. When something is ambiguous, record the question and the interpretation you chose in this phase\'s artifact (in implement, a handoff Blocker labelled `[ambiguity]`) and proceed on it. Finish all the work this prompt authorizes before ending — acting on your own judgment never widens scope; the Affected Files cap and every other scope rule still bind. Always end by writing the phase artifact and running the phase command(s) listed at the end of this prompt, including when you recorded Blockers — a session that ends without them stalls the pipeline.\n' +
    '\n' +
    'If a project instruction file or other repository guidance tells you to ask the user or wait for approval before acting, there is no one to ask in this session: record the question in the phase artifact and continue with the authorized work.\n' +
    '\n' +
    'Git ownership: the pipeline orchestrator handles staging, committing, and pushing — do NOT run `git add`, `git commit`, or `git push`. Edit files in the working tree only; the orchestrator reads `git status` after your session and stages every file listed in handoff.md\'s Changes table. Read-only git is fine (`git status`, `git diff`, `git log`, `git show`).\n' +
    '\n' +
    'If a code review claims a file is "missing from the commit" or "staged but not committed," that is a pipeline-orchestration issue, not an implementation issue. Record it as a Blocker in handoff.md with the `[pipeline]` label and do not retry `git add`/`git commit` to recover — the sandbox blocks `.git` writes by design, and the orchestrator owns the recovery path.\n' +
    '\n' +
    'Communication: tone is project taste; honest signal is canon discipline — surface real disagreement rather than yielding to politeness.\n' +
    'Branch state: the orchestrator manages it — do not fetch, pull, rebase, or push; read the working tree as-is.';
```

Notes on this edit:
- The precedence line ("If a project instruction file...") must not name `AGENTS.md` or `CLAUDE.md` and must not claim general override — it already doesn't in the draft above (AC-4). Confirm afterward with `git grep -n "AGENTS.md\|CLAUDE.md" -- src/orchestrator/prompts/helpers.ts` → zero results.
- The old branch-sync sentence (`'Branch sync (non-pipeline sessions): ...'`, current lines 24-25 tail) is fully replaced by the one-line "Branch state: ..." sentence. Do not keep any `git fetch`/`git pull` text. Verify with `git grep -nE "Branch sync|git fetch|git pull" -- src/orchestrator/prompts/helpers.ts tests/run-task-prompts.golden.json` → zero results (the golden file gets regenerated in Step 7, so re-run this grep after that step too).
- Keep the existing Git-ownership paragraph and `[pipeline]` Blocker paragraph verbatim (AC-5 requires their meaning unchanged) — only their position relative to the new paragraphs shifts.
- Double-check final string concatenation has no stray leading/trailing blank line changes at the very start (`'Read docs/patterns.md...'`) or very end (`'...read the working tree as-is.'` with no trailing `\n`) — matches today's shape.

## Step 3 — Reword the three "stop" instructions (AC-6)

**`src/orchestrator/prompts/templates/implement.md`**

Scope Discipline rule 1 (line 28), currently:
> 1. **Affected Files is the scope cap.** If satisfying an AC genuinely requires editing files outside the spec's *Affected Files* table, stop, document the gap in `handoff.md` under *Blockers*, and surface it for human attention. Do not silently expand scope.

Reword to (uses the spec's suggested wording, spec.md line 136):
> 1. **Affected Files is the scope cap.** If satisfying an AC genuinely requires editing files outside the spec's *Affected Files* table, do not make that edit. Record the gap in `handoff.md` under *Blockers* — the handoff is how it reaches a human — then finish the remaining in-scope work, the handoff, and the phase command. Do not silently expand scope.

Red-First Checkpoint (line 37), currently ends with:
> ...If the test cannot be made to fail on the pre-fix code for the stated reason, stop — the spec's mechanism is wrong. Document it in handoff.md under Blockers with label `[wrong-premise]` and do not implement a fix on a premise you could not reproduce. ...

Reword the "stop" clause only (keep everything else, including the environment-bound-escape sentence that follows, unchanged):
> ...If the test cannot be made to fail on the pre-fix code for the stated reason, do not implement a fix on a premise you could not reproduce — record a `[wrong-premise]` Blocker in handoff.md instead, then finish the remaining in-scope work, the handoff, and the phase command. ...

**`src/orchestrator/prompts/templates/implement-revisions.md`**

Red-first bullet (line 43), currently ends with:
> ...If it cannot be made to fail for that reason, stop and record a `[wrong-premise]` Blocker in handoff.md — do not implement around an unconfirmed premise. ...

Reword to:
> ...If it cannot be made to fail for that reason, do not implement around an unconfirmed premise — record a `[wrong-premise]` Blocker in handoff.md instead, then finish the remaining in-scope work, the handoff, and the phase command. ...

Do not touch `implement-reroute.md` (spec Non-Goals: its red-first paragraph already uses "record a `[wrong-premise]` Blocker instead of implementing" with no bare "stop" — confirmed by reading the file, no edit needed).

Verify: `git grep -nE "stop, document the gap|stop — the spec's mechanism is wrong|stop and record a" -- src/orchestrator/prompts/templates` → zero results. Preserve every other rule in those paragraphs verbatim (no-silent-scope-expansion, never-report-an-outcome-for-a-run-that-didn't-happen, environment-bound escape) — only the "stop" clause's meaning changes.

## Step 4 — `pipeline-policy.ts` comment (AC-8)

`src/lib/pipeline-policy.ts` around line 161, inside the `implement:` comment block:
> ...tier inherited pending 5.6-generation re-eval, and canon's thesis...

→
> ...tier inherited pending GPT-6-generation re-eval, and canon's thesis...

Comment-only change; the `codexMatrix()` return value and every model/effort cell are unchanged. No test update needed for this line (it's a comment, not a table cell), but re-run `tests/pipeline-policy.test.ts` per Step 7 to confirm no incidental diff.

Verify: `git grep -n "5\.6-generation" -- docs/product-context.md src/lib/pipeline-policy.ts` → zero results.

## Step 5 — `docs/product-context.md` Full-tier bullet (AC-8)

Line 91, currently:
> ...tier inherited pending 5.6-generation re-eval; see `docs/decisions.md` §"Model-generation re-baseline (2026-06)"...

Wait — read the live line before editing: it says `§"Model-generation re-baseline (2026-06)"` but decisions.md's actual heading (confirmed by reading the file) is `## Model-generation re-baseline (2026-07): Codex defaults → 5.6 generation` — the dated section header uses `2026-07`, not `2026-06`. Re-point this bullet at the **new** entry being added in Step 6 instead of correcting the old pointer's date (out of scope; the old entry stays as history per spec Non-Goals). New wording:

> ...tier inherited pending GPT-6-generation re-eval; see `docs/decisions.md` §"Model-generation re-baseline (2026-09): Codex defaults → GPT-6 generation"...

`docs/product-context.md` is not in `CANON_OWNED`/`DELIMITED` (verify with `grep -n "product-context" src/lib/canon-owned.ts` — expect no match, same root-only status as `docs/decisions.md`), so no `templates/` mirror row is needed for this file.

## Step 6 — New `docs/decisions.md` entry (AC-9)

Append a new dated entry at the end of the file (after the "Task quality-log row upserted..." entry), following the exact shape of the existing `## Model-generation re-baseline (2026-07): Codex defaults → 5.6 generation` entry (Decision / Why / Rule structure). Do not edit the 2026-07 entry.

```markdown
---

## Model-generation re-baseline (2026-09): Codex defaults → GPT-6 generation

_Generation: gpt-6-luna (mini) / gpt-6-sol (full)._

**Decision**: Bump canon's shipped Codex defaults from the 5.6 generation (`gpt-5.6-luna`, `gpt-5.6-sol`) to the GPT-6 generation (`gpt-6-luna`, `gpt-6-sol`), triggered by OpenAI's 2026-09-22 release. This is a **minor** canon-supplied-default change per §"Versioning and release policy". Effort tiers, routing, and the override env-var chains are unchanged — only the two fallback model strings move. GPT-6 Astra, the flagship, was considered and rejected: its cost doesn't fit canon's token-discipline thesis.

**Why**: Both GPT-6 IDs were verified resolvable via a `codex exec -m <id>` probe on 2026-09-23. Sol is a straightforward upgrade — cheaper ($2/$10 vs $4/$20 per 1M input/output tokens) and better on coding (Artificial Analysis Coding Agent Index 55→57, Terminal-Bench 37→43%, SWE-Atlas-QnA 54→58%). Luna is a genuine trade-off: ~60% cheaper per task, but the Coding Agent Index moves 43→41, SWE-Atlas-QnA 49→44%, DeepSWE 66→64%, and it emits ~25% more output tokens. Canon routes every XS–L phase to the mini model, so this regression lands on most runs. The public benchmark deltas are measured at max effort; canon runs Luna at `medium`/`high`, where no public data exists for this comparison.

As part of the same trigger, the audit required by the "Guardrail prompts carry an implicit model-strength calibration" entry above was run against the five Codex prompt templates plus `CODEX_STARTUP`. `spec-review.md` passed unchanged — it already has no "push harder" framing, no "silence is failure" framing, and an explicit scope boundary. Four other issues were found and fixed: no prompt stated the session was non-interactive; three "stop" instructions in `implement.md` and `implement-revisions.md` were literally readable as "end the session" rather than "don't make that edit"; nothing told Codex what to do when a project instruction file says "ask before X"; and `CODEX_STARTUP`'s "Branch sync (non-pipeline sessions)" sentence asked the model to classify its own session next to `git fetch`/`git pull` commands it must never run in a pipeline session. `CODEX_STARTUP` now carries a headless/bias-to-action paragraph, a narrowly-scoped ask/approval precedence line, and a plain "the orchestrator manages branch state" statement in place of the dead branch-sync instruction.

**Rule**: Shipped defaults are `gpt-6-luna` (mini) and `gpt-6-sol` (full) as of this entry. Rollback: set `CODEX_MODEL_MINI=gpt-5.6-luna` (and `CODEX_MODEL_FULL=gpt-5.6-sol` if needed) — the 5.6 models remain available at the API. Follow-up measurement (separate from this change): compare M/L `code_review` reroute rate and iteration counts, as recorded in `docs/task-quality-log.md`, for tasks run on GPT-6 against the 5.6-era baseline recorded there before this entry's landing commit — use each task-quality-log row's date against this entry's date to draw the cohort boundary, since the log does not itself record model generation. Effort-tier re-evaluation for the GPT-6 generation remains a separate future task, not folded into this change.
```

This directly answers the spec-review nit: the cohort boundary is "task-quality-log rows dated before vs. after this entry's landing commit," since no generation field exists on the row today (adding one is out of scope per spec Non-Goals / Affected Files).

## Step 7 — `docs/pipeline-orchestrator.md` + synced mirror (AC-2)

`docs/pipeline-orchestrator.md` lines 261-262 (Codex model overrides table):
```
| `CODEX_MODEL_MINI` | `gpt-6-luna` | Codex model for XS/S/M/L non-delicate phases. |
| `CODEX_MODEL_FULL` | `gpt-6-sol` | Codex model for XL or delicate phases. |
```
This file is in `CANON_OWNED` (confirmed: `src/lib/canon-owned.ts:24`), so its `templates/docs/pipeline-orchestrator.md` mirror regenerates automatically via the pre-commit hook / `npm run sync-templates`. Run `npm run sync-templates` after this edit and confirm `npm run sync-templates:check` passes. Both the root file and the mirror go in the handoff Changes table (per the patterns-doc rule on declaring managed-file mirrors).

## Step 8 — Golden regeneration + new resume-stripping test (AC-7, AC-10)

Add to `tests/run-task-prompts.test.ts`, near the other `toResumePrompt`/CODEX_STARTUP-adjacent tests (this repo currently has no `toResumePrompt` test — this is new coverage, not a modification):

```ts
void test('toResumePrompt strips CODEX_STARTUP from spec-review, fresh-implement, and implement-revisions prompts', () => {
    const specReview = promptSpecReview(baseState);
    const implementFresh = promptImplement(baseState, 'fresh', [], 'main');
    const implementRevisions = promptImplementRevisions(iterState, [], 'main');

    for (const rendered of [specReview, implementFresh, implementRevisions]) {
        const resumed = toResumePrompt(rendered);
        assert.ok(!resumed.includes(CODEX_STARTUP));
        assert.ok(resumed.startsWith('[Resumed session'));
    }
});
```
Import `toResumePrompt` and `CODEX_STARTUP` from `../src/orchestrator/prompts/helpers.js` (match the existing relative-import style/extension used elsewhere in this test file — check the top-of-file import block for the exact path and `.js` vs no-extension convention before adding). Use the same `baseState` / `iterState` fixtures already defined in the file (see the existing `promptSpecReview`/`promptImplementRevisions` tests for their names and shapes).

Then:
1. `UPDATE_GOLDENS=1 npm test` — regenerates `tests/run-task-prompts.golden.json` to reflect the new `CODEX_STARTUP` text and the two reworded "stop" instructions in `implement.md`/`implement-revisions.md`.
2. Diff the golden JSON before committing: confirm only `CODEX_STARTUP`-derived and the two template-text changes moved, and that whitespace around the block (leading/trailing blank lines) matches what Step 2 preserved — this is where a resume-strip regression would show up (a golden snapshot with `CODEX_STARTUP` no longer bracketed by blank lines on both sides).
3. `npm test` again without `UPDATE_GOLDENS` — must pass clean.

## Step 9 — Full validation pass (AC-10)

Run in order: `npm run lint`, `npm run type-check`, `npm run docs-refs-check`, `npm run sync-templates:check` (after Step 7's sync), `npm test`, `npm run build`. After `npm run build`, `git status` on `dist/` must show no uncommitted diff (confirms `dist/cli/index.js` and `dist/orchestrator/run-task.js` were rebuilt and match source — both are Affected Files per the spec, generated, not hand-edited).

## Step 10 — Handoff bookkeeping

List every file touched (both root docs and the `templates/` mirror row) in `handoff.md`'s Changes table: `src/orchestrator/env.ts`, `src/orchestrator/policy.ts`, `src/orchestrator/prompts/helpers.ts`, `src/orchestrator/prompts/templates/implement.md`, `src/orchestrator/prompts/templates/implement-revisions.md`, `src/lib/pipeline-policy.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`, `dist/cli/index.js`, `dist/orchestrator/run-task.js`, `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`, `docs/product-context.md`, `docs/decisions.md` — matching the spec's Affected Files table exactly (AC-2/AC-8's docs edits plus AC-9's new entry plus the mirror).
