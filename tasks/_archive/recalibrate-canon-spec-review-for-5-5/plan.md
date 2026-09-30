# Plan: recalibrate-canon-spec-review-for-5-5

> Written by: Claude | Implemented by: Codex
> Spec verdict: approved (no nits to fold in). Size S, not delicate.

## Approach

Add one read-only charter, `.claude/agents/spec-review-lens.md`. Repoint the skill's three angles at it. Move the silence default from each agent to the synthesis step. Extend check C3. Fix the smaller drift. Register the charter in `CANON_OWNED`, sync the mirrors, rebuild, and add one structural test. Then add the decision-record paragraph.

### Feasibility check

- **Exists:** confirmed by search.
  - `.claude/skills/canon-spec-review/SKILL.md` has the cited lines: `general-purpose` at :55 and :77, `Explore` at :65, `Calibration applied to every angle` at :51, C3 at :82, `codex review` pointers at :20 and :145, the war story at :136, and the trivial-patch row at :142.
  - `.claude/agents/code-review-cold.md` exists as the model charter. `code-review-anchored.md`, `code-review-cold.md` and the skill are all in `CANON_OWNED` (`src/lib/canon-owned.ts:10-14`).
  - The scope-boundary text to paraphrase is `src/orchestrator/prompts/templates/spec-review.md:29`, and the blocking/nit definitions follow at :31 onward.
  - `docs/decisions.md:461` holds §"Claude prompt calibration audit (2026-09)". It is the last section in view and ends at line 469.
  - The existing AC-11 assertion is at `tests/run-task-prompts.test.ts:855-857`. The charter tests sit at :577-590 and read files via `path.resolve` / `process.cwd()`.
- **Real path:** there is no runtime code path. Adopters get the files through `canon init` and `canon upgrade`, both driven by `CANON_OWNED`. The only source change is one array entry. `sync-canon-templates.mjs` mirrors `CANON_OWNED` entries into `templates/`, and the pre-commit hook does the same.
- **Callers:** nothing calls `CANON_OWNED` in a way that depends on the entry count.
  - `tests/cli.test.ts:1187` and `:1985` filter only `.canon/templates/*`.
  - No test or source file enumerates `.claude/agents/*`. I grepped tests, `src` and `README.md` and found `code-review-*` referenced only in `canon-owned.ts`, `run-task-prompts.test.ts`, `code-review-foreman.md`, and the golden file, which are unrelated to this change.
  - The golden JSON (`tests/run-task-prompts.golden.json`) holds prompt-builder snapshots. It doesn't read the skill or the charter, so no regen is needed. No `src/orchestrator/prompts` file changes.
- **Tests that can fail:** each assertion in the new test targets text that is absent or wrong today, so it goes red before the edits.
  - The charter file does not exist yet, so `readFileSync` throws.
  - The skill currently matches `general-purpose`, `Explore` and `Shape Check rubric`, has no `spec-review-lens`, and has `Calibration applied to every angle`, `codex review --` and `worktree-canonical-task-state`.
  - The skill's C3 has no `### Affected Files` token.
  - The skill's `Don't use for already-committed code review` line holds the `codex review --` form that AC-7 forbids.
  - **AC-3 "one conjunct only" rule.** The test splits each file into lines and, for any line matching `/explicitly exclude|Non-Goals/`, requires the same line or an adjacent pair to also match `/verif\w* (as )?unaffected/`. To keep that predicate testable, write the carve-out as one paragraph line, with no hard wraps, that carries both conjuncts. No other line in either file may mention `Non-Goals` or `explicitly exclude` without the verification conjunct. C-check (5) "Non-goals — rule out the most tempting scope expansions" contains `Non-goals`; the regex is case-sensitive on `Non-Goals`, so it does not trip. Keep it that way.
- **Predicates:**
  - Tools list, AC-1: parse the frontmatter `tools:` value by splitting on `,` and trimming, then compare the set to exactly `{Read, Grep, Glob, Bash}`. Reject extra tokens, duplicates and empty items, and assert a `tools:` line exists (an absent field means inherit-all).
  - AC-4: `\bExplore\b` must not match anywhere in the skill, including prose. Do not write "Explore-type agent" anywhere.
  - AC-7: `/codex review --/` must not match. The skill may say `codex review` only if followed by something other than `--`. Simplest is to remove the raw command mentions entirely.
- **Scope:** every file the steps touch is in Affected Files. That covers the charter, its mirror, the skill and its mirror, `canon-owned.ts`, `dist/cli/index.js`, `tests/run-task-prompts.test.ts`, and `docs/decisions.md`. Do not edit `README.md`, `docs/pipeline-orchestrator.md`, or any prompt template.
- **Async/stateful:** N/A. These are static prompt files.
- **Tools syntax:** the spec asks the plan to confirm it. Claude Code sub-agent frontmatter uses `tools: Read, Grep, Glob, Bash`, a comma-separated allowlist on one line. Other agents in this repo declare none, so there is no local precedent. I could not run a real dispatch in this unattended session, so the syntax is confirmed from Claude Code's documented format, not observed. The Human Test Plan covers the live check.
- **Leak gate:** neither shipped file may contain `src/orchestrator/` or a basename from `src/orchestrator/prompts/templates/` (`spec-review.md`, `plan.md`, `qa.md`, `spec.md`, `implement.md`, and so on). In particular, don't write `spec-review.md` or `spec.md` as a bare filename in the charter or skill. `tasks/<id>/spec.md` is a task artifact and reads fine as a path, but the leak scanner is basename-based, so confirm the existing skill's `tasks/<id>/spec.md` mentions still pass and run `npm run sync-templates:check` after each edit. Refer to Codex's review as "Codex `spec_review`", never by file.
- **Adopter scope:** no canon-ai-only paths (`src/**`, `tests/**`, `docs/decisions.md`) in the charter or skill text.

## Steps

### 1. Write the charter: `.claude/agents/spec-review-lens.md`

Model it on `code-review-cold.md`.

Frontmatter:

```
---
name: spec-review-lens
description: Read-only spec reviewer for the /canon-spec-review skill. Dispatched once per angle (shape, factual, spec-quality) with the spec inline; returns cited findings to the synthesizing session.
tools: Read, Grep, Glob, Bash
---
```

Body, in this order:

1. **Role paragraph.** You are one lens in `/canon-spec-review`. The prompt gives you the spec text, your angle, and your rubric.
2. **Lane rules**, one line each:
   - Review the spec yourself and spawn no sub-agents.
   - Invoke no skills.
   - Write no files. Run no `canon` commands and ask the user nothing.
   - Bash is read-only: searching, listing, printing file ranges, and read-only git history. No redirects, no in-place edits, no state-changing git.
   - Inherit the session's model and effort.
3. **Grounding.** Every finding cites `file:line` or an AC number. Re-open the current file before making any claim about code, and don't rely on memory.
4. **Coverage first.** Report every finding you can back with a citation, each tagged with a severity. Filtering is the synthesizer's job. `[NO FINDINGS]` is a valid return, and you must not invent findings.
5. **Severity definitions**, paraphrased from Codex's `spec_review` wording:
   - BLOCKING: wrong behavior, a silent bug, or an AC unimplementable as written.
   - NIT: an implementation detail the implementer resolves by reading the codebase, a minor ambiguity with an obvious default, or a question the plan phase should answer.
   - STRONG: nit-grade under those rules but likely to cost a review round, so cheaper to fix now.
6. **Scope boundary.** Write it as a single unwrapped line: "Behavior the spec's Non-Goals explicitly exclude and verify as unaffected is a NIT at most." Follow it with the three exclusions: an omitted required change (caller, parser, migration or test surface), a transitive effect of the change, and an internal contradiction between spec sections. Those stay BLOCKING.
7. **Return format:**

```
- [BLOCKING|STRONG|NIT] <one-line finding> — <file:line or AC#>
  <2-3 sentence rationale, citing evidence>
```

Return exactly `- [NO FINDINGS]` if the lens finds nothing. Add no preamble or closing remarks.

### 2. Rewrite `.claude/skills/canon-spec-review/SKILL.md`

Keep the frontmatter unchanged, `effort: high` included.

- **Line 20.** Change the "Don't use for already-committed code review" sentence to point at `/canon-inline-review`, with no raw `codex review` command.
- **Step 2 intro.**
  - Dispatch three Agent calls in a single message, each with `subagent_type: spec-review-lens`. Each call carries the spec inline plus its angle, scope and rubric.
  - Remove the return-format block, since the charter owns it. Say briefly that the lens returns cited findings in its own format.
  - **Delete the "Calibration applied to every angle" paragraph.**
- **Missing charter.** If the Agent tool rejects the `spec-review-lens` type, stop. Tell the human to run `canon upgrade` and then start a new Claude Code session. Do not fall back to another agent type.
- **Agent A.**
  - Remove "Subagent type: `general-purpose`" and the "Shape Check rubric" pointer.
  - State the four questions inline: is the problem real, is the framing right, is there a materially simpler solution, and is the AC decomposition right.
  - Keep the stay-in-lane constraints.
- **Agent B.**
  - Remove "Subagent type: `Explore`". Keep the existing highest-value-class sentence, worded so it doesn't contain "Explore".
  - Instruct the lens to read whole functions and call sites, not excerpts, when it verifies return shapes.
- **Agent C.** Remove "Subagent type: `general-purpose`". Keep all nine checks verbatim, so `Name effects to DELETE` and `Prefer positive or structural assertions` still appear and AC-11 keeps passing. Rewrite only check (3), Affected Files:
  - The table sits under a heading that is exactly `### Affected Files`, inside `## Design` (or an `## Amendment`).
  - It lists every file the change writes, including generated mirrors and rebuilt outputs.
  - Files only read for context stay out.
  - A mismatched heading or a missing generated output is BLOCKING, because a pipeline gate rejects it later.
- **Severity definitions and scope boundary section.** Add a short section before Step 3 that carries the same definitions and the same one-line full-predicate carve-out as the charter. The two copies must match token for token on the load-bearing phrases.
- **Step 3.** Replace the three bullets with four named filters:
  1. Drop any finding with no citation (uncited).
  2. Downgrade any finding inside the scope boundary to NIT (scope-boundary downgrade).
  3. De-dupe.
  4. Re-classify on the strongest evidence, then order BLOCKING, then STRONG, then NIT.

  Say that silence is the default for what reaches the report, and keep the report template as is.
- **Output principles.** Delete the war-story bullet at :136. Keep the other two.
- **Anti-patterns.**
  - Trivial-patch row: reword around XS, for example "Run on XS typo fixes or version bumps — overhead exceeds value when there is no logic to vet".
  - Code-diff row: use `/canon-inline-review` for diff review.
  - Update the "Manufacture findings" row so it doesn't mislead, and keep `[NO FINDINGS]`.
- **Word-level greps.** After editing, the skill must not match `general-purpose`, `\bExplore\b`, `Shape Check rubric`, `Calibration applied to every angle`, `codex review --`, `worktree-canonical-task-state`, or `~15-min`.

### 3. Register the charter: `src/lib/canon-owned.ts`

Add `'.claude/agents/spec-review-lens.md',` after the `code-review-cold.md` line.

### 4. Add the structural test: `tests/run-task-prompts.test.ts`

Add `void test('spec-review-lens charter and canon-spec-review skill carry the calibrated contract', …)` directly after the charter test at :577-590. Use `fs.readFileSync(path.resolve(...))`, matching that test. Cover AC-1 to AC-7 with token asserts:

- **AC-1.** Extract the frontmatter with `/^---\n([\s\S]*?)\n---/`. Check `name: spec-review-lens`. Parse the `tools:` line into a set and `assert.deepEqual([...set].sort(), ['Bash','Glob','Grep','Read'])`. Assert the raw line has no `Agent|Skill|Edit|Write`.
- **AC-2.** Match tokens for read-only Bash, `spawn no sub-agents`, `invoke no skills`, `write no files`, `file:line`, `Coverage`, `filtering`, and `[NO FINDINGS]`. Use the exact phrases you wrote in Step 1.
- **AC-3.** Loop over both files. Assert `BLOCKING`, `STRONG` and `NIT`. Assert both `/explicitly exclude|Non-Goals/` and `/verif\w* (as )?unaffected/`. Assert the three exclusions by tokens such as `omitted`, `transitive`, and `contradiction`. For the one-conjunct rule, split into lines and assert that no line matching `/explicitly exclude|Non-Goals/` fails to match `/verif\w* (as )?unaffected/`.
- **AC-4.** Assert `subagent_type: spec-review-lens` and `canon upgrade`. Assert the negatives `general-purpose`, `\bExplore\b` and `Shape Check rubric`. Assert `Name effects to DELETE` and `Prefer positive or structural assertions` are still present.
- **AC-5.** Assert the skill lacks `Calibration applied to every angle` and that synthesis names the filters with tokens such as `uncited`, `scope boundary`, and `de-dupe`. Scope those matches to the text after the `### 3.` heading with `split`.
- **AC-6.** Take the text of check (3) or C3, and assert `### Affected Files`, `## Design`, and `/generated|rebuilt/`.
- **AC-7.** Assert `effort: high` in the frontmatter and `/canon-inline-review`. Assert the skill lacks `codex review --`, `worktree-canonical-task-state` and `~15-min`. Isolate the trivial-patch anti-pattern row with `split('\n').find(l => /trivial|XS/.test(l) && l.startsWith('|'))` and assert it matches `XS`.

Add a comment that these assertions prove the text is present, not that a model will behave accordingly. Don't claim otherwise in the handoff.

### 5. Add the decision record: `docs/decisions.md`

Append one paragraph at the end of §"Claude prompt calibration audit (2026-09)", after the "Plan-quality follow-up" paragraph. Record that:

- The `/canon-spec-review` sub-agents run under one read-only `spec-review-lens` charter.
- Delegation is bounded by its tool list.
- The lens is coverage-first, and synthesis does the filtering.

Use the phrase `spec-review-lens` so the AC-9 grep finds it. This doc is root-only, so add no mirror row.

### 6. Sync mirrors, build, verify

Run these in order:

1. `npm run sync-templates`. This creates `templates/.claude/agents/spec-review-lens.md` and updates `templates/.claude/skills/canon-spec-review/SKILL.md`.
2. `npm run sync-templates:check`. If it reports a leak, remove the offending path or basename from the shipped text, then re-run.
3. `npm run build`.
4. `grep -c "spec-review-lens.md" dist/cli/index.js`. It must be non-zero. Record the result in the handoff.
5. `grep -n "spec-review-lens" docs/decisions.md`. Confirm the hit sits inside the calibration-audit section, and record it in the handoff.
6. `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`.
7. Run `git status` before finishing. The handoff Changes table must list all eight Affected Files, including both `templates/` mirrors and `dist/cli/index.js`.

`npm test` is the only step here I can't predict fully. `tests/run-task-safety.test.ts` has one known linked-worktree failure when run in a worktree. If it appears and this diff doesn't touch that area, report it as pre-existing. Also, per the handoff rule, if any test reports `skipped`, treat it as unverified, not passing.

## Out of scope (do not touch)

- The Codex spec_review prompt and any other file under `src/orchestrator/`.
- The code-review charters.
- The README allow-list block and `RECOMMENDED_ALLOW` in `doctor.ts`.
- `docs/pipeline-orchestrator.md` and `README.md`.
- Other skills.
- `canon doctor`.
- The skill's `effort` setting.
- Any `model` or `effort` pin in the charter.
