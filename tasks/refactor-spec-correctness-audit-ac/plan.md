# Implementation Plan: refactor-spec-correctness-audit-ac

> Written by: Claude | Implements: `tasks/refactor-spec-correctness-audit-ac/spec.md`

## Approach

Prose-only guidance edits on ten files plus one structural test, regenerated goldens and mirrors, and a rebuilt `dist/`. Every addition goes beside the existing refactor structural-caps rule (author side) or the bug-fix evidence rule (reviewer/checklist side), copying each file's local bullet convention. Spec review verdict is `approved` with no nits.

Shared rule wording (reuse the phrase "correctness audit" verbatim everywhere; no backticks, no canon-internal paths):
- Core sentence: "Refactor specs need a correctness audit before any \"preserve behavior\" AC: for each behavior declared preserved, check whether today's behavior is actually correct, and end each in one of three outcomes — fixed deliberately (own AC), split into a separate task, or kept as a named intentional quirk. Record what was audited and found in *Problem*; a one-line \"audited, correct\" satisfies a trivially correct refactor (a pure rename). N/A for features and bug fixes."

Feasibility check:
- **Exists:** confirmed by grep. Caps bullets: `.claude/skills/canon-spec/SKILL.md:158`, `src/orchestrator/prompts/templates/spec.md:19`, `spec-revision.md:20`. Bug-fix gated lines: skill `:148`, `.canon/templates/spec.md:100`, `src/orchestrator/prompts/index.ts:116` (`selfCheck` array at `:107`). Bug-fix evidence bullet: `spec-review.md:17`. Review skill scope line `:60` ("nine"), check (9) `:69`. BACKLOG line `docs/BACKLOG.md:24`. No existing "correctness audit" string in the repo.
- **Real path:** `selfCheck` is interpolated only by `templates/spec.md` (`{{{selfCheck}}}`, line 23); `spec-revision.md` has no such placeholder, so the self-check line reaches the spec golden only. Prompt text reaches adopters via the `tsup` bundle in `dist/orchestrator/run-task.js`. Mirrors come from `npm run sync-templates`.
- **Callers:** no function contract changes; `promptSpec` / `promptSpecRevision` / spec-review builder only gain text. Goldens are the sole consumer (`tests/run-task-prompts.test.ts` `recordOrAssert`, `UPDATE_GOLDENS=1`).
- **Tests that can fail:** the new test reads the six carrier files plus `src/orchestrator/prompts/index.ts` and fails if the phrase is absent (pre-change none contain it); the bullet-equality test fails if the two prompt bullets drift; the backtick test fails if a backtick appears in an added line; the golden assertion fails until regenerated.
- **Predicates:** the equality test extracts the bullet by a stable lead (`**Refactor specs need a correctness audit**`) — assert exactly one match per file (non-empty, not zero/two). Backtick check runs on the extracted lines only (the bullets, the self-check line, the strategic-read bullet), not whole files, since those files legitimately contain backticks elsewhere.
- **Scope:** all files below are in the spec's Affected Files (plus the declared Generated Artifacts). Nothing in plan/implement/QA/code-review/reroute prompts or agents is touched.
- **Async/stateful:** N/A.

Adopter-scope note: the rule text names no canon-internal path and cites no BACKLOG/CHANGELOG.

## Steps

### Step 1: Author-side skill and template

Files: `.claude/skills/canon-spec/SKILL.md`, `.canon/templates/spec.md`

- Skill: add a rules-of-thumb bullet immediately after line 158 (`- **Refactor specs need hard structural caps**: ...`), bold lead + colon style: `- **Refactor specs need a correctness audit before "preserve behavior"**: ...` with the core sentence, naming all three outcomes. Add a gated checklist line in the pre-presentation self-check after the bug/flake line (`:148`): `- [ ] (Refactors; N/A for features/bug fixes) *Problem* records the correctness audit of each behavior declared preserved, with each outcome (fixed deliberately with its own AC, split out, or kept as a named quirk) stated before any "preserve" AC`.
- Template: under `## Acceptance Criteria`, after the bug-fix note (`:24`), add a `> **For a refactor:** ...` note in the same blockquote convention naming the correctness audit and three outcomes. Add the same gated line to the Spec Quality Checklist after line 100. Do not add or rename any heading.
- Edit root files only; the pre-commit hook / sync handles mirrors (Step 6).

### Step 2: Prompt templates (identical bullet)

Files: `src/orchestrator/prompts/templates/spec.md`, `src/orchestrator/prompts/templates/spec-revision.md`

Add, directly after the caps bullet (`spec.md:19`, `spec-revision.md:20`), one bullet in em-dash convention, byte-identical in both files:
`- **Refactor specs need a correctness audit** — before any "preserve behavior" AC, ...` (core sentence, ending "N/A for features and bug fixes"). No backticks.

### Step 3: Self-check line

File: `src/orchestrator/prompts/index.ts`

In the `selfCheck` array, add after the bug/flake string (`:116`) a single-quoted line: `'- (Refactors; N/A for features/bug fixes) the spec records a correctness audit of each behavior declared preserved, and each audited behavior\'s outcome (fixed deliberately, split out, or kept as a named quirk) is stated'`. Avoid backticks and avoid `\'` by using wording without apostrophes (e.g. "the outcome of each audited behavior"). It is a plain string, so the `.filter(Boolean)` is unaffected.

### Step 4: Reviewer side

Files: `src/orchestrator/prompts/templates/spec-review.md`, `.claude/skills/canon-spec-review/SKILL.md`

- spec-review prompt: add one bullet in the strategic-read list immediately after the bug-fix bullet (`:17`): "For a refactor: does the spec show correctness audit evidence that the behavior it preserves is actually correct, with each audited behavior's outcome stated (fixed deliberately, split out, or kept as a named quirk)? A one-line audited-correct record satisfies a trivially correct refactor. A missing audit is a STRONG finding, never BLOCKING." Leave line 22 (silence default) untouched.
- Skill: change `:60` "these nine items" to "these ten items"; append after (9): `(10) **Refactor correctness-audit evidence** (N/A for features/bug fixes) — ...` stating severity STRONG, never BLOCKING (unlike check (9)). Then `grep -n -i "nine" .claude/skills/canon-spec-review/SKILL.md` must return nothing count-related (also check the "(9)" reference lines don't claim a total).

### Step 5: BACKLOG

File: `docs/BACKLOG.md`

Delete only line 24 (the "Refactor specs require a correctness audit AC" candidate). Check `git diff docs/BACKLOG.md` shows a single-line removal; leave the unrelated working-tree edit to `docs/pipeline-invocations.md` alone.

### Step 6: Test

File: `tests/run-task-prompts.test.ts`

Add a test beside the AC-11 structural-relocation test (`~:864`), using its `readRepoFile` style (`path.join(process.cwd(), rel)`, not `REPO_ROOT`):
1. For each of the six carriers (`.claude/skills/canon-spec/SKILL.md`, `.canon/templates/spec.md`, `src/orchestrator/prompts/templates/spec.md`, `spec-revision.md`, `spec-review.md`, `.claude/skills/canon-spec-review/SKILL.md`) and `src/orchestrator/prompts/index.ts`: `assert.ok(text.includes('correctness audit'))`.
2. Extract the rule bullet line (`/^- \*\*Refactor specs need a correctness audit\*\* — .*$/m`) from `templates/spec.md` and `templates/spec-revision.md`; assert both match and are equal; assert each is immediately after the caps bullet (`lines[i-1]` starts with `- **Refactor specs need structural caps**`).
3. Backtick check: bullets from step 2, the self-check line (find the `index.ts` line containing `correctness audit`), and the spec-review bullet line (line containing `correctness audit`) contain no backtick.
4. Golden presence: `promptSpec(baseState)` output includes the self-check line's distinctive text (`correctness audit of each behavior declared preserved`); `promptSpecRevision(specRevisionState)` output does not.

Do not weaken or edit other assertions; the new phrase does not collide with the DELETE/positive-assertion regexes or the code-review-agent absence checks.

### Step 7: Regenerate and verify

Run, in order:
1. `npm run sync-templates` (mirrors: `templates/.claude/skills/canon-spec/SKILL.md`, `templates/.canon/templates/spec.md`, `templates/.claude/skills/canon-spec-review/SKILL.md`), then `npm run sync-templates:check`.
2. `UPDATE_GOLDENS=1 npm test -- tests/run-task-prompts.test.ts` (or the repo's equivalent single-file invocation); review `git diff tests/run-task-prompts.golden.json`: spec = rule bullet + self-check line; spec-revision = rule bullet only; spec-review = strategic-read bullet only. Any other golden entry changing is a bug.
3. `npm run build`, then confirm `git diff --stat -- dist/` shows only `dist/orchestrator/run-task.js`.
4. `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`.
5. `git diff --name-only main...HEAD` (and working tree) is a subset of Affected Files + Generated Artifacts + task artifacts/telemetry.

Handoff Changes table must list every file above, including the three `templates/` mirrors and `dist/orchestrator/run-task.js` as generated artifacts.

## Reroute Plan

### Delta

Amendment Round 1 (review: approved_with_nits): in the pipeline spec_review prompt only, a missing correctness audit becomes **Blocking**; the canon-spec-review skill's check (10) stays STRONG (AC-13). Steps 1-5 and the Step 6 carrier/equality/self-check/golden assertions of the prior plan still apply untouched.

Feasibility check:
- **Exists:** the bullet to change is `src/orchestrator/prompts/templates/spec-review.md:18` (ends "A missing audit is a STRONG finding, never BLOCKING."); `STRONG` appears nowhere else in that file (grep). The Blocking tier is defined at `:33` ("Requires `changes_requested`"); the adjacent bug-fix bullet (`:17`) uses the phrase "Blocking Shape Check concerns: ...". The existing test is at `tests/run-task-prompts.test.ts:~974-1025` (`reviewLine` found by `includes('correctness audit')`, backtick check at `:1015`). Skill check (10) and mirror are not touched.
- **Real path:** `promptSpecReview` renders `templates/spec-review.md`; text reaches adopters via `dist/orchestrator/run-task.js` and the `promptSpecReview` golden in `tests/run-task-prompts.golden.json`. Other tests render spec-review output (`:310-380`) and match only on reroute/EXEMPT lines, unaffected by this bullet.
- **Callers:** no function contract changes; prose only.
- **Tests that can fail:** the new assertions run on `reviewLine`; pre-change it contains "STRONG" and lacks "Blocking", so both the `match(/Blocking/)` and `doesNotMatch(/STRONG/)` assertions fail until the bullet is edited. The golden assertion fails until regenerated.
- **Predicates:** `reviewLine` is the first line containing "correctness audit" and must be exactly the bullet (assert it starts with `- For a refactor:` so a later line, e.g. a second mention, can't silently satisfy the test). Also assert `doesNotMatch(/never BLOCKING/i)`. The no-backtick assertion on this line must keep holding: write "a changes_requested verdict" with no backticks.
- **Scope:** `spec-review.md`, `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`, `dist/orchestrator/run-task.js` — all in the amendment's Affected Files. Do not touch the skill, its mirror, or any other prompt.
- **Async/stateful:** N/A.

Nit incorporated (spec-review): keep the audit question and outcome language intact; the edit replaces only the final sentence.

### Steps

1. **Edit the bullet** (`src/orchestrator/prompts/templates/spec-review.md:18`): replace only the last sentence "A missing audit is a STRONG finding, never BLOCKING." with: "A missing audit is a Blocking Shape Check concern (requires a changes_requested verdict), matching the bug-fix evidence bullet above." Leave the question, the three outcomes, the "audited, correct" escape, and the silence-default line untouched. No backticks; no "STRONG"/"never BLOCKING" left.
2. **Test** (`tests/run-task-prompts.test.ts`, extend the existing correctness-audit test near `reviewLine`): after `assert.ok(reviewLine)`, add `assert.ok(reviewLine.startsWith('- For a refactor:'))`, `assert.match(reviewLine, /Blocking/)`, `assert.doesNotMatch(reviewLine, /STRONG/)`, `assert.doesNotMatch(reviewLine, /never BLOCKING/i)`. Also assert the audit-question and escape wording survive: `assert.match(reviewLine, /fixed deliberately, split out, or kept as a named quirk/)` and `/audited, correct/`. Do not weaken other assertions.
3. **Regenerate:** `UPDATE_GOLDENS=1 npm test -- tests/run-task-prompts.test.ts`; review `git diff tests/run-task-prompts.golden.json` — only the spec-review golden's changed sentence should differ from the prior round. Then `npm run build`; `git diff --stat -- dist/` must show only `dist/orchestrator/run-task.js`.
4. **Verify:** `npm run lint`, `npm run type-check`, `npm test`, `npm run sync-templates:check`, `npm run docs-refs-check`. Confirm `git diff --stat` for this round touches only the four files above (AC-13: the skill and its mirror unchanged — `grep -n "never BLOCKING" .claude/skills/canon-spec-review/SKILL.md` still matches).
5. **Handoff:** add a reroute section to the handoff listing the four files, and state AC-12/13/14 results; report any test skipped as unverified.
