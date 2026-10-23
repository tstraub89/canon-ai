# Implementation Plan: red-first-evidence-slot

> Written by: Claude | Implements: `tasks/red-first-evidence-slot/spec.md`

## Approach

Text-only change on four surfaces: the handoff template, the anchored charter + review template, four orchestrator prompt templates, and `docs/decisions.md`. No orchestrator logic changes (AC-6). Spec review verdict was `approved` with no nits.

**Feasibility check**

- **Exists:** confirmed by grep/read. Red-run sentences live at `implement.md:37`, `implement-revisions.md:43`, `implement-reroute.md:28`. The foreman round-N directive is `code-review-foreman.md:20-21` (inside `{{^isRound1}}`). `.canon/templates/handoff.md` has `## Blockers` then `## Validation Outcomes`, and a commented Iteration skeleton at the end. `.canon/templates/review.md` has the Stage 1 `### Validation Gate` checkbox list (lines 19-21). `.claude/agents/code-review-anchored.md` Stage 1 has items 1-5. `docs/decisions.md:73` is "Two-stage code review with Stage 1 as a gate". `docs/pipeline-orchestrator.md:399` starts "The validation-outcome pre-flight is structural, not spec-matching." (bold lead-in, not a heading; cite that text exactly).
- **Real path:** prompts are bundled `.md` templates rendered by `promptImplement`, `promptImplementRevisions`, `promptImplementReroute`, `promptCodeReview` in `src/orchestrator/prompts/index.ts`; `tsup` bundles them into `dist/orchestrator/run-task.js`. No code on that path parses handoff sections. The handoff/review/charter files are canon-owned, so the pre-commit hook mirrors root → `templates/`.
- **Callers:** no function's behavior or error contract changes. Prompt text only; every consumer is a golden/prompt test in `tests/run-task-prompts.test.ts`.
- **Tests that can fail:** each new assertion targets text that does not exist today (`Red-First Evidence` appears nowhere in `src/`, `.canon/`, `.claude/agents`; `Report the red run` exists today and must be absent after). The round-2 foreman test must render `promptCodeReview(codeReviewRoundNState)` (iterations=1 selects `{{^isRound1}}`); the round-1 render must NOT carry the directive (state-varying pair).
- **Predicates:** template test asserts heading order by `indexOf` (`## Blockers` < `## Red-First Evidence` < `## Validation Outcomes`), exactly five column headers in the header row, and the same five in the commented skeleton. Boundary: the skeleton lives inside an HTML comment, so slice from `<!--` to the end rather than parsing tables. `none` placeholder row must be present.
- **Scope:** every file below is in the spec's Affected Files. `tests/run-task-prompts.golden.json` regenerates via `UPDATE_GOLDENS=1`. `dist/orchestrator/run-task.js` via `npm run build`. `docs/decisions.md` is root-only (not in `CANON_OWNED`) — no mirror row.
- **Async/stateful:** N/A.

**Contradictions/gaps:** none found. Pitfall to respect: canon-owned files must not name an internal-only prompt template (`implement.md` etc.) — `sync-templates:check` leak scan; describe "the implement phase" instead. Another: `review.md` heading parser eats `#`-led lines inside fenced blocks — add no fenced blocks to `.canon/templates/review.md`.

## Steps

### Step 1: Handoff template (AC-1, AC-2)

Files: `.canon/templates/handoff.md` (root only; hook mirrors to `templates/.canon/templates/handoff.md`)

1. Blockers: after the `[ambiguity]` bullet add: ``- Label a red-first test that cannot be made to fail for the stated reason `[wrong-premise]` and describe what you observed instead of implementing on an unconfirmed premise``.
2. Insert `## Red-First Evidence` between `## Blockers` and `## Validation Outcomes`. Content: a `>` guidance note covering (a) one row per red-first AC; (b) "Ran against" is the commit of the pre-fix code; (c) two allowed alternatives in place of a failure excerpt — a pointer to the `[wrong-premise]` Blocker, or for an environment-bound escape the named alternative's outcome or a statement that it was not executable and why; (d) a task with no red-first ACs leaves the `none` row. Then the table, mirroring the style of the AC Coverage table:

   `| AC | Command | Ran against | Pre-fix failure | Post-fix result |`
   `|---|---|---|---|---|`
   `| _(none — no red-first ACs / one row per red-first AC)_ | | | | |`

   Keep the first cell prose-free of paths (near-miss scan reads first columns only of Changes tables, so this is safe, but avoid backticked paths anyway). Do not name any prompt template file.
3. In the commented Iteration skeleton, after `### AC deltas (if any)` add `### Red-First Evidence` (with a one-line note: include only when this round adds or changes a red-first test or adds missing evidence) and the same five-column table header.

### Step 2: Review template + anchored charter (AC-4, AC-5)

Files: `.canon/templates/review.md`, `.claude/agents/code-review-anchored.md` (mirrors via hook)

1. `review.md` Validation Gate list: add `- [ ] Red-first evidence recorded for each red-first AC (Red-First Evidence row against pre-fix code, a [wrong-premise] Blocker, or the environment-bound escape's outcome)`. Plain text, no fenced block.
2. Charter Stage 1: insert as item 5 (renumber "If Stage 1 fails" to 6) — for each AC the spec states as a red-first regression test, look for a Red-First Evidence row across the baseline section and every Iteration subsection of `handoff.md`; it must show a run against pre-fix code (a commit that predates the fix) with a failure excerpt consistent with the reason the spec states, or a `[wrong-premise]` Blocker reference, or the environment-bound escape's outcome / stated non-executability. A missing row, or a row with no pre-fix run and no allowed alternative, is a Stage 1 gap. Evidence recorded in a later round against the pre-fix commit satisfies the check; do not treat "test first ran after the fix" as a gap by itself. Apply only to ACs the spec states as red-first regression tests, not any test-adding AC.

### Step 3: Implement prompts (AC-3)

Files: `src/orchestrator/prompts/templates/implement.md`, `implement-revisions.md`, `implement-reroute.md`

Replace only the "Report the red run …" sentence in each; leave the `[wrong-premise]` and environment-bound wording intact (word the environment-bound tail to say "record the outcome in the Red-First Evidence section" where it currently says "report … in handoff.md" so it doesn't contradict).

- `implement.md`: "Record the red run as a row in the handoff's Red-First Evidence section (AC, command, the commit it ran against, observed failure, post-fix result). The pre-fix state is the task's base commit: write the test and run it before changing any non-test code; files that exist only to support tests count as test files."
- `implement-revisions.md`: same, but name the `### Red-First Evidence` subsection of this round's Iteration section, and pre-fix state = "the task branch's HEAD before this round's edits". Add: "If a review round flagged missing red-first evidence, run the test against the recorded pre-fix commit (for example in a scratch checkout of that commit with only the test applied) and record the row; you do not need to redo the fix."
- `implement-reroute.md`: name the Red-First Evidence section (new rows in the `## Amendment Round N` handoff content as the prompt already structures rounds — keep consistent with the "Rewrite handoff.md" step), pre-fix state = "the task branch's HEAD before this round's edits". In step 7 (Rewrite handoff.md) add: "Carry existing Red-First Evidence rows forward."
- Each must contain the literal `Red-First Evidence` and must no longer contain `Report the red run`.

### Step 4: Foreman directive (AC-5)

Files: `src/orchestrator/prompts/templates/code-review-foreman.md`

In the `{{^isRound1}}` block extend the directive sentence: "… Also tell the anchored lens that red-first evidence is read across the whole handoff (baseline section and every Iteration subsection), not only that Iteration section." Keep the existing sentence verbatim (other tests may match it).

### Step 5: Decisions doc (AC-8)

Files: `docs/decisions.md` (root-only; no mirror)

1. Add an entry (match neighbouring Decision/Why/Rule format, short) titled e.g. "Red-first evidence is checked in anchored Stage 1, not pre-flight": Decision, Why (cite `docs/pipeline-orchestrator.md` by the exact lead-in text "The validation-outcome pre-flight is structural, not spec-matching" — verify with `docs-refs-check`/grep; don't restate the #163/#200 history), Rule (no orchestrator code reads Red-First Evidence or `[wrong-premise]`).
2. In "Two-stage code review with Stage 1 as a gate", change the scope list "(validation outcomes, AC coverage, dropped sections)" to include red-first evidence.

### Step 6: Tests (AC-1…AC-5)

Files: `tests/red-first-evidence-template.test.ts` (new), `tests/run-task-prompts.test.ts`

New file (Node test runner + `assert`, style of `tests/sync-canon-templates.test.ts`; read files via `path.resolve` from `process.cwd()` per patterns.md worktree rule, not `REPO_ROOT`):
- handoff template: heading present once; order via `indexOf`; header row has the five columns in order; `none` placeholder row; Blockers section text contains `[wrong-premise]` and `[ambiguity]`; commented skeleton (text after `<!--`) contains `### Red-First Evidence` and the five columns.
- charter: Stage 1 section contains `Red-First Evidence`, `[wrong-premise]`, `pre-fix`; no `implement.md`/`.md` prompt-template name.
- review template: Validation Gate list contains a checkbox line mentioning red-first evidence.

In `run-task-prompts.test.ts` add tests (use existing `baseState`/`iterState`/`rerouteState`/`codeReviewRoundNState`): for each of the three implement renders assert `/Red-First Evidence/`, its pre-fix phrase (`base commit` for fresh; `HEAD before this round` for the others), `doesNotMatch /Report the red run/`; revisions asserts the scratch-checkout recovery sentence; reroute asserts the carry-forward sentence; round-2 foreman render matches the "whole handoff" directive and round-1 render does not (`doesNotMatch`).

### Step 7: Regenerate, sync, build, validate

1. `UPDATE_GOLDENS=1 npm test -- tests/run-task-prompts.test.ts` (or the repo's equivalent for one file) to refresh `tests/run-task-prompts.golden.json`; review `git diff` on it — only the intended sentences should change.
2. `npm run sync-templates` then `npm run sync-templates:check`.
3. `npm run build` (updates tracked `dist/orchestrator/run-task.js`).
4. `npm run lint && npm run type-check && npm test && npm run docs-refs-check`.
5. AC-6: run `grep -rniE "red-first|wrong-premise" src/ --include='*.ts'`; matches must be only under `src/orchestrator/prompts/` (currently `prompts/index.ts:157`, which is under that path). Paste the output into handoff validation notes.
6. In the handoff, list mirrors and `dist/` in the Changes table; declare `docs/decisions.md` without a mirror row.

## Testing Plan

- **Unit:** `tests/red-first-evidence-template.test.ts` (template/charter/review structure); prompt assertions in `tests/run-task-prompts.test.ts`, including a round-1 vs round-2 pair for the foreman directive; regenerated goldens.
- **E2E:** none.
- **Manual:** render the handoff template and eyeball section order (Human Test Plan steps 1-2).

## Rollback Plan

Revert the commit; no data or state migration. Existing tasks' handoff.md copies are untouched, and adopters with an override of the handoff template keep their own content.
