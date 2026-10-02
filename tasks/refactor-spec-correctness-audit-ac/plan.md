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

## Reroute Plan Round 2

### Delta

Amendment Round 2 (review: approved): replace the hand-written paraphrases of the rule with canonical strings A (author rule), R (review question) and O (outcome list) copied verbatim, enforced by one test. Severities stay split (Blocking in the spec_review prompt, STRONG never BLOCKING in the review skill). Prior Steps 1-5 and Reroute Plan Round 1 still apply except where the paraphrased wording below is replaced. No structure, placement, gating, or severity changes.

Feasibility check:
- **Exists:** grep for "correctness audit" / "is actually correct" over `.claude/skills`, `.canon/templates`, `src`, `templates` finds the carriers to rewrite: skill rule `.claude/skills/canon-spec/SKILL.md:160` (says "four outcomes", "actually correct today") and checklist `:149`; template note `.canon/templates/spec.md:25` and checklist `:102`; prompt bullets `src/orchestrator/prompts/templates/spec.md:20` and `spec-revision.md:21`; review prompt bullet `spec-review.md:18` ("is actually correct"); self-check `src/orchestrator/prompts/index.ts:117`; review skill check (10) `.claude/skills/canon-spec-review/SKILL.md:70`. Mirrors exist under `templates/` for the three managed files. The inline f3ee6bb patch ("confirmed correct as-is") is superseded: canonical wording is "correct as-is".
- **Real path:** unchanged from prior rounds. `selfCheck` renders only in the spec prompt; prompt text reaches adopters through the `dist/orchestrator/run-task.js` bundle; mirrors via `npm run sync-templates`.
- **Callers:** prose only, no function contracts. Goldens (`tests/run-task-prompts.golden.json`) are the sole consumer: spec (bullet + self-check), spec-revision (bullet), spec-review (bullet) all change again.
- **Tests that can fail:** the existing test (`tests/run-task-prompts.test.ts:~973-1033`) already contains assertions that the new wording breaks: `/correct as-is, fixed deliberately, split out, or kept as a named quirk/` and `/audited, correct/` on `reviewLine` (R has neither), so they must be replaced, not left. New verbatim assertions fail today because every carrier uses a paraphrase (none contains A, R or O exactly). A one-word mutation of any carrier fails `includes`.
- **Predicates:** R and A lack the literal phrase "correctness audit", and the existing test locates lines by `includes('correctness audit')` and the AC-7 phrase check needs it. Keep it in the per-carrier lead-in (surrounding words are per-carrier by spec), so each carrier still has the phrase and the line-finders still work. O contains parentheses and commas but no backticks or apostrophes, so it embeds verbatim in the single-quoted TS string in `index.ts` with no escaping. A and R contain no backticks (the existing no-backtick assertion holds). Match on raw file text with `includes`, not regex, to avoid escaping the parentheses and `?`. Exactly-one-match guard on the prompt bullets stays.
- **Scope:** all files are in Amendment Round 2's Affected Files (13 rows incl. mirrors); no other prompt, agent, or BACKLOG change.
- **Async/stateful:** N/A.

Nit/contradiction notes: AC-12 (Round 1) says the "audited, correct" escape in the review bullet is unchanged; Round 2's R supersedes it with "A behavior confirmed correct needs only a one-line record." Following Round 2 (later, approved, and explicitly replaces paraphrase); recorded in `notes.md`.

### Steps

1. **Define canonical strings in the test first** (`tests/run-task-prompts.test.ts`, inside the existing correctness-audit test): `const O = 'correct as-is, fixed deliberately (with its own AC), split into a separate task, or kept as a named quirk'`, `const A = 'For each behavior a refactor declares preserved, record in Problem whether it is correct today, and state one outcome: ' + O + '. A behavior confirmed correct needs only a one-line record.'`, `const R = 'does the spec record, for each behavior it declares preserved, whether it is correct today and one outcome: ' + O + '? A behavior confirmed correct needs only a one-line record.'` (assert `A.includes(O)`, `R.includes(O)` as a self-check of the definitions; strings must equal the spec's canonical text exactly). Run it first to see it fail.
2. **Author side, A** (replace the paraphrase, keep lead and gate):
   - `.claude/skills/canon-spec/SKILL.md:160`: `- **Refactor specs need a correctness audit before "preserve behavior"**: ` + A + ` N/A for features and bug fixes.` (drops "four outcomes" and "actually correct").
   - `.canon/templates/spec.md:25`: `> **For a refactor:** Before any "preserve behavior" AC, run a correctness audit. ` + A + ` N/A for features and bug fixes.`
   - `src/orchestrator/prompts/templates/spec.md:20` and `spec-revision.md:21`: `- **Refactor specs need a correctness audit** — ` + A + ` N/A for features and bug fixes.` Byte-identical in both (existing equality test stays).
3. **Checklist and self-check, O:** `.claude/skills/canon-spec/SKILL.md:149`, `.canon/templates/spec.md:102`: `- [ ] (Refactors; N/A for features/bug fixes) *Problem* records the correctness audit of each behavior declared preserved, with one outcome each (` + O + `) stated before any "preserve" AC`. `src/orchestrator/prompts/index.ts:117`: `'- (Refactors; N/A for features/bug fixes) the spec records a correctness audit of each behavior declared preserved, with one outcome each: ' + O + '` as a single literal (no concatenation in source, so a raw `includes` finds it). Keep the substring "correctness audit of each behavior declared preserved" (the golden-presence test depends on it).
4. **Reviewer side, R:**
   - `spec-review.md:18`: `- For a refactor, check for a correctness audit: ` + R + ` A missing audit is a Blocking Shape Check concern (requires a changes_requested verdict), matching the bug-fix evidence bullet above.` Leave the silence-default line untouched. This keeps `startsWith('- For a refactor:')` false, so update that test assertion to `startsWith('- For a refactor')`, or keep the lead literally `- For a refactor: ` and put the phrase later, e.g. `- For a refactor: ` + R + ` ... correctness audit ...` — implementer's choice, but the line must contain "correctness audit", contain R, contain Blocking, and not contain STRONG.
   - `.claude/skills/canon-spec-review/SKILL.md:70`: `(10) **Refactor correctness audit evidence** (N/A for features/bug fixes) — ` + R + ` Missing audit evidence is STRONG, never BLOCKING.` Scope line still says ten (unchanged); `grep -n -i nine` still empty.
5. **Complete the test** (same test, replacing the Round 1 regex assertions on wording that no longer exists):
   - A verbatim (`includes`) in skill, template, spec prompt, spec-revision prompt. R verbatim in spec-review prompt and review skill. O verbatim in skill, template, and `index.ts`.
   - Keep: both prompt bullets equal, adjacent to the caps bullet, no-backtick on bullets/self-check/review line, spec golden has the distinctive self-check text and spec-revision golden does not, review line has Blocking and no STRONG/never BLOCKING; review skill line still has STRONG, never BLOCKING (AC-13).
   - Remove the `correct as-is, fixed deliberately, split out...` and `audited, correct` regexes. Add: no carrier, mirror, or `index.ts` contains "is actually correct". Read the three `templates/` mirrors too and assert the same A/R/O.
6. **Regenerate and verify:** `npm run sync-templates` then `npm run sync-templates:check`; `UPDATE_GOLDENS=1 npm test -- tests/run-task-prompts.test.ts` and review `git diff tests/run-task-prompts.golden.json` (spec: bullet + self-check; spec-revision: bullet; spec-review: bullet; no other entry); `npm run build` (only `dist/orchestrator/run-task.js` changes); `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`. Confirm the diff is inside Round 2's Affected Files.
7. **Mutation check by hand (AC-18):** change one word in one carrier, confirm the test fails, revert. Report in the handoff, along with any skipped test as unverified.
8. **Handoff:** add a Round 2 section listing all 13 files (mirrors and `dist/` as generated artifacts) and AC-15 through AC-19 results.
