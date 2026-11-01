# Implementation Handoff: spec-manifest-lint

> Author: Codex | Spec: `tasks/spec-manifest-lint/spec.md` | Plan: `tasks/spec-manifest-lint/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/markdown-table.ts` | Shared manifest visibility, heading, and raw table-block scan; preserve full cells for lint while retaining consumer column mapping. Exclude actual comments and fences, preserving literal comment examples in inline code. |
| `src/orchestrator/validation.ts` | Pure manifest lint, shared-scan consumer, task-aware reader, issue formatter, pre-flight messages, and spec-done gate. |
| `src/orchestrator/main.ts` | Forward force to plan entry and return lint issues from spec evidence recovery without throwing. |
| `src/orchestrator/phases/plan.ts` | Check every task before any plan agent or in-progress transition; block or warn under force. |
| `src/orchestrator/phases/implement.ts` | Check every task before agents, scaffold commits, branch setup, or review-loop handling. |
| `src/orchestrator/cli.ts` | Include manifest pre-flights in force help. |
| `src/orchestrator/prompts/index.ts` | Canonical exported manifest contract and spec self-check. |
| `src/orchestrator/prompts/templates/spec-revision.md` | Restate the manifest contract for revisions. |
| `tests/markdown-table.test.ts` | Scanner visibility, raw extra cells, section boundaries, and comment-example regression tests. |
| `tests/run-task-validation.test.ts` | Both AC-6 red-first regressions, all lint kinds, valid grammar, spec gate, override, bypass, and adopter-safe diagnostics. |
| `tests/run-task-safety.test.ts` | Evidence recovery, both phase entries, force, clean specs, resume after block, worktree-only state writes, bundle siblings, and main-dispatch force wiring. |
| `tests/run-task-reroute-preflight.test.ts` | Fast-tier reroute reads the malformed amendment from the active worktree. |
| `tests/run-task-prompts.test.ts` | Pin the same contract verbatim on every authoring surface. |
| `tests/run-task-prompts.golden.json` | Regenerated spec and spec-revision prompt snapshots. |
| `.canon/templates/spec.md`, `templates/.canon/templates/spec.md` | Contract beneath Affected Files and in the author checklist; generated mirror synced. |
| `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md` | Author self-check contract and generated mirror. |
| `.claude/skills/canon-spec-review/SKILL.md`, `templates/.claude/skills/canon-spec-review/SKILL.md` | Narrow structural item 3 to scope completeness; explain format enforcement. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Gate, recovery, phase pre-flights, bypasses, routing coverage, and full-send interaction; generated mirror synced. |
| `docs/codebase-map.md` | Index shared scanner and lint entry points. |
| `docs/lessons-learned.md` | Remove the now-mechanized fused-row lesson. |
| `docs/BACKLOG.md` | Mark the Affected Files shift-left half complete; retain the docs-reference half. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt tracked bundles. |
| `tasks/spec-manifest-lint/notes.md`, `tasks/spec-manifest-lint/handoff.md`, `tasks/spec-manifest-lint/status.json` | Implementation observations, evidence, and phase bookkeeping through the task helper. |

## Canon Governance

The authoritative provenance is `tasks/spec-manifest-lint/status.json`, under its canon object.

| Field | Source |
|---|---|
| Upstream repo | status.json.canon.upstream_repo |
| Upstream commit | status.json.canon.upstream_commit |
| Orchestrator commit | status.json.canon.orchestrator_commit |
| Codex CLI | status.json.canon.codex_cli |
| Claude Code | status.json.canon.claude_code |

## Intent & Rationale

Manifest consumers and lint now use the same raw scan, including the same table boundaries and escaped-pipe splitter. Path-cell decisions reuse the existing parser, preserving directory entries, comma-joined paths, markdown links, partial per-path failures, and consumer ordering. Fences and actual comments are excluded before headings or tables are selected.

The spec-done gate reports all issues. Evidence recovery checks first so a rejected spec remains incomplete with an actionable note. Plan and implement entry check every task through the active task resolver before any agent runs. A rejection parks every bundle member at that phase without consuming review iterations; force prints the issues and proceeds. Recovery messages name the whole invocation's task list.

Routing audit: normal full-tier progression, reset-spec-review, human-gate edits, full-tier reroutes through review/plan, fast-tier reroutes straight to implement, spec-gap reroutes with exempt siblings, code-review revisions, and resumes all reach the two phase handlers. Fast-tier combined spec/plan is checked at spec done and again at implement entry. Accepting a spec review still reaches plan; accepting implement skips agent entry by design and retains existing downstream scope checks.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Leave both extractSectionBodies and scanAllTables unchanged for non-manifest consumers. | The new manifest scanner and parseAllTablesH3 share visibility and raw-block scanning; broader review/handoff scanning changes are unnecessary and would risk AC-8. | Preserves other consumers. |
| Omit the plan-only unclosed-block issue kind. | The binding spec excludes fenced/commented examples from lint and allows a spec without a table. Adding an unterminated-example rejection expands the required grammar and raises false-positive risk. | All six required lint kinds implemented; AC-6 exclusion retained. |
| Reject a duplicate exact heading even when its body has no table. | AC-5 unconditionally rejects the second exact heading; only AC-4 includes a table-presence predicate. | Follows AC-5 rather than the plan's narrower predicate; tested. |
| Protect inline code and preserve visible text around actual HTML comments. | Archive calibration exposed a false positive when literal comment markers in Change text split a live table. | Fixes the false positive required by AC-15. |
| No edit to `tests/recovery-hints.test.ts`. | New runtime messages contain none of that registry's trigger commands; the existing registry suite passes. | No new hint registration required. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Fused extra cells fail only when an extra cell has a backticked token; section and data-row number included. Prose-only extras and escaped pipes pass. |
| AC-2 | Met | Missing separator, blank-split table, and note-split table tested, including a singleton swallowed as a header. |
| AC-3 | Met | Every specified malformed cell uses the existing parser reason; comma siblings and annotated directories pass. |
| AC-4 | Met | Every specified ignored heading fails only with a table; title/prose mentions pass; nested H4 content already read by an exact manifest remains valid. |
| AC-5 | Met | Duplicate exact headings rejected per H2; Design and Amendment tables coexist. |
| AC-6 | Met | Both required regressions failed on base and pass after the fix; scanner tests cover comments before/after live tables and both fence types. |
| AC-7 | Met | Empty column 1 with a backticked token elsewhere fails at the correct data-row number; empty/prose continuations pass. |
| AC-8 | Met | Existing parser/validation suites pass with added cases. Valid grammar and this task's spec pass; all 127 archive consumer path arrays equal the base parser's arrays. |
| AC-9 | Met | Gate reports every issue and fix command; clean spec, explicit root override, and env bypass tested. |
| AC-10 | Met | Malformed spec returns advanced=false with issues, leaves spec incomplete, and does not throw. Removing the pre-check reproduces the gate exception. |
| AC-11 | Met | Both entries block before agents; force and clean paths invoke fakes; fix-and-resume works without reset. Worktree writes leave main state unchanged. Bundle exemption, fast-tier reroute, and main force dispatch tested. |
| AC-12 | Met | All six issue kinds and forced/unforced messages for both phases are checked for internal implementation names. |
| AC-13 | Met | Canonical contract pinned across all four authoring carriers; review item remains pinned; docs/help updated; goldens regenerated; mirrors in sync. Obsolete directory prohibition absent from target surfaces. |
| AC-14 | Met | Lesson removed; backlog records manifest half done and docs-reference half open. |
| AC-15 | Met | Entire 127-spec archive calibrated; counts and source-inspected samples below. Initial comment-example false positive fixed; archives untouched. See interpretation below. |

## Edge Cases Considered

- Preserve Design-before-Amendment consumer ordering even when source section order differs.
- Preserve per-path diagnostics and valid comma siblings without changing later consumers' warn behavior.
- Comment markers inside inline code and inside fences do not hide live scope; real comments are removed before table cells are split.
- Hidden headings cannot displace live headings; visible tables after a blank or hidden block still require their own header/separator.
- Every bundle member is linted even when exempt from an amendment-heading requirement; the recovery command includes every member.
- No-table specs remain accepted. Existing missing-spec behavior is unchanged; the spec-done gate already rejects missing artifacts.

## Blockers

- [ambiguity] AC-15 asks to classify sampled hits as real silent-loss defects or false positives, while AC-1 explicitly rejects any extra backticked token. The archive's three fused-cell hits are unescaped logical-OR operators in Change-column code: the primary scope path survives, but Change content containing backticked tokens is silently truncated. I classified these as real table-content loss under AC-1, with the narrower impact stated below; I did not weaken the mandatory token predicate to recognize only file-looking tokens. Likewise, a sampled ignored amendment repeats already-declared paths: its table is ignored even though the net allowlist remains complete. No execution blocker remains.

## Red-First Evidence

Both tests were written and run before any production edits, against base commit a4b4174ecb96123db1756311c7c97a79db1a6d51.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-6 fenced displacement | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='AC-6 manifest' tests/run-task-validation.test.ts` | a4b4174ecb96123db1756311c7c97a79db1a6d51 | Expected ['real.ts']; received ['example.ts']. Assertion failed. | Pass: exactly ['real.ts']. |
| AC-6 commented table | Same command as preceding row | a4b4174ecb96123db1756311c7c97a79db1a6d51 | Expected ['real.ts']; received ['real.ts', 'old.ts']. Assertion failed. | Pass: exactly ['real.ts']. |

Additional mutation evidence, with each source restored afterward:

| Check removed | Targeted test | Observed failure |
|---|---|---|
| Spec gate lint | spec manifest gate lists all issues, honors override and retains the env bypass | Gate returned ok=true instead of false. |
| Spec evidence pre-check | manifest evidence recovery parks with issues without marking spec done | Gate exception escaped; subprocess exit 1 instead of 0. |
| Plan pre-flight | manifest pre-flight plan: blocked before any agent runs | Agent path ran; exit 0 instead of 2. |
| Implement pre-flight | manifest pre-flight implement: blocked before any agent runs | Agent path ran; exit 0 instead of 2. |
| Main plan force forwarding | manifest --force reaches plan through main dispatch | Force invocation blocked with exit 2 instead of 0. |

Each targeted run used the Node test runner with the same two imports shown in the red-first command and the named test selected by test-name-pattern. All mutations failed as expected; the final full suite ran after restoration.

## Archive Calibration

Scanned every existing spec directly under archived task directories: **127 specs; 15 distinct specs flagged**. Counts below are specs per kind, not issue totals, and overlap across kinds.

| Issue kind | Specs flagged |
|---|---|
| fused-cells | 3 |
| header-less-block | 0 |
| malformed-path | 4 |
| empty-first-cell | 0 |
| ignored-heading | 9 |
| duplicate-heading | 0 |

Up to three sampled hits per nonzero kind, inspected in the actual archived source:

| Kind | Sample | Classification and concrete loss |
|---|---|---|
| fused-cells | `tasks/_archive/parser-cwd-worktree-mode/spec.md`:138 | Real silent table-content loss: unescaped logical OR splits Change code into six cells against a two-cell header; later backticked code/path mentions are discarded. Column-1 scope path survives. |
| fused-cells | `tasks/_archive/runtime-validation-phase/spec.md`:197 | Real silent table-content loss: logical OR splits Change code into four cells; trailing backticked expressions are discarded. Column-1 scope path survives. |
| fused-cells | `tasks/_archive/scope-pr-auto-commit-to-affected-files-v2/spec.md`:83 | Real silent table-content loss: logical OR splits Change code into four cells; later backticked content is discarded. Column-1 scope path survives. |
| malformed-path | `tasks/_archive/codex-code-review-phase/spec.md`:148 | Real scope loss: slash-separated backticked file tokens structurally reject the whole first cell. The same shape occurs on rows 149–151. |
| malformed-path | `tasks/_archive/full-send-mode/spec.md`:164 | Real scope loss: prose identifies a prompt source without a path token. Dispatcher and reroute test rows at 167–168 have the same defect. |
| malformed-path | `tasks/_archive/runtime-validation-phase/spec.md`:198 | Real scope loss: plus-separated tokens structurally reject both paths; row 205 uses another unsupported join. |
| ignored-heading | `tasks/_archive/add-ci/spec.md`:129 | Real scope loss: H2 Affected Files is outside the accepted Design/Amendment H3 structure, so its table is never read. |
| ignored-heading | `tasks/_archive/adopt-eslint/spec.md`:138 | Real scope loss: same standalone H2 defect; table paths are not read. |
| ignored-heading | `tasks/_archive/docs-refs-adopter-config/spec.md`:179 | Real ignored-table defect: suffixed amendment heading is not read. Its note says these paths are already in Design, so this sample loses the amendment table without shrinking the union of paths. |

Initial false positive, fixed before final calibration: `tasks/_archive/canon-docs-dedup/spec.md`:124 contains literal HTML comment markers in inline code. Hiding that live row caused the following row to appear header-less. The visibility scan now protects literal code and keeps the table contiguous; that spec is no longer flagged. `tests/markdown-table.test.ts` pins this distinction.

A separate differential run compared consumer path arrays from the base parser with the current shared scanner for all 127 archived specs: **zero differences**. No archive file was edited.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final ESLint run completed successfully. |
| `npm run type-check` | Pass | Final TypeScript check completed successfully. |
| `npm test` | Pass | Final full run: 1,906 tests, 1,905 passed, zero failed, one skipped. Existing linked-worktree REPO_ROOT test in `tests/run-task-safety.test.ts`:3589 skips under restricted git writes; fish-specific subchecks in `tests/completion.test.ts` report fish unavailable. |
| `npm run build` | Pass | Both tracked bundles rebuilt successfully. |
| `npm run sync-templates:check` | Pass | All canon-managed mirrors in sync. |
| `npm run docs-refs-check` | Pass | All references valid; rerun after final artifact writing before phase close. |
| Scoped parser and validation tests | Pass | Existing suites plus new cases passed; included again in final full suite. |
| Prompt snapshots | Pass | Regenerated with UPDATE_GOLDENS=1; normal snapshot assertions passed in the final full suite. |
| Mutation checks | Pass | All five removed-gate/wiring probes failed as intended; source restored. |
| Archive calibration and consumer differential | Pass | 127 specs scanned; samples above; zero archived consumer path-array differences. |
| Scope and whitespace checks | Pass | All 27 changed source/generated files are in the spec cap; git diff --check passed. |

E2E is explicitly not applicable in the spec: this is a CLI with no UI runtime.

## Ready for Review

- [x] All spec ACs met (see coverage and the calibration interpretation)
- [x] All applicable validation checks pass
- [x] Deviations documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/markdown-table.ts` | C2: reject backtick-fence openers with backticks in their info string. C3: an HTML marker starts a multiline comment only at the start of a line with up to three spaces; an inline comment must close on that line. |
| `src/orchestrator/validation.ts` | R1: describe truncated backticked content and explain literal-pipe escaping. R2: match Affected Files as whole words. |
| `tests/run-task-validation.test.ts` | C1: embed this task's Affected Files section instead of reading a live task artifact. Add end-to-end parser/lint regressions for C2/C3 and diagnostic/heading tests for R1/R2. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt both tracked bundles for the parser and lint changes. |
| `tasks/spec-manifest-lint/handoff.md`, `tasks/spec-manifest-lint/notes.md` | Record revision decisions, reproductions, and validation. |

### Findings addressed

- **C1 — correctness bug:** the valid-manifest test no longer reads a task artifact that shipping moves. Its static fixture is this task's full Affected Files section (`tests/run-task-validation.test.ts`:4446). An archive simulation that denies the live spec read fails on the pre-revision test with ENOENT and passes on the revised test, without moving or deleting any file.
- **C2 — correctness bug:** inline triple-backtick text and invalid backtick info strings no longer open a fence (`src/orchestrator/markdown-table.ts`:195). Three malformed-markdown cases now preserve the live manifest's path; the ordinary backtick/tilde fence-exclusion tests remain green.
- **C3 — correctness bug:** an unclosed comment marker in a table cell stays literal instead of hiding later rows and amendments (`src/orchestrator/markdown-table.ts`:211). End-to-end tests prove both the literal case and real multiline/closed-inline comment exclusion.
- **R1 — risk/guardrail:** fused-cell errors now say backticked content is discarded and give the backslash-pipe escape for a literal pipe (`src/orchestrator/validation.ts`:1949). The new test requires the actual escape and its explanatory clause.
- **R2 — risk/guardrail:** whole-word heading detection accepts Unaffected Files while continuing to reject Tests for affected files with a table (`src/orchestrator/validation.ts`:1963).

### AC deltas

| AC | Status | Delta |
|---|---|---|
| AC-1 | Met | Fused-cell recovery now explains escaping literal pipes; rejection predicate unchanged. |
| AC-4 | Met | Remove the Unaffected Files false positive; preserve the required phrase match in other headings. |
| AC-6 | Met | Exclude real fences/comments while preserving inline backtick text and unclosed mid-cell markers. New regressions ran red before production edits. |
| AC-8 | Met | Restore valid non-fenced/non-commented scope and make the task-spec fixture independent of task lifecycle. Reviewer marked this Partial before the revision. |
| AC-15 | Met | Recalibration remains 127 specs, 15 flagged, with identical per-kind counts and no archive path-output changes from round-1 HEAD. |

Other ACs are unchanged; the full suite includes their existing coverage.

### Deferred optional findings and scope

- **R3:** retain the existing decision to exclude a genuinely unclosed fence without adding a diagnostic. Its content is actually fenced; a new lint kind would add a grammar restriction beyond the binding ACs and the required review fixes. The silent exclusion remains a documented residual risk.
- **R5:** retain the existing park-resume behavior. The interrupted-implement/broken-spec edge can select misleading resume wording or a fresh mixed-mode session, but the review found no state corruption. Changing session routing is unnecessary for these parser fixes.
- **R4:** the foreman amendment contract follow-up targets `src/orchestrator/prompts/templates/code-review-foreman.md`, which is outside the spec cap. No edit made; human scope amendment remains the follow-up path. The `docs/patterns.md` mirror-row wording remains the QA consistency follow-up identified in review.
- Other optional nits are deferred. No new ambiguity or execution blocker was found. The baseline archive-classification ambiguity was accepted by Round 1 review.

### Red-First Evidence

The C2/C3/R1/R2 tests ran before this round's production edits against HEAD **34470c8b46c102d6458d0a8604e134aebbd64e59**. The selected run produced six expected failures and one passing real-comment control. The same selection passes all seven tests after the fixes.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-6 / AC-8 — C2 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='revision [CR]' tests/run-task-validation.test.ts` | 34470c8b46c102d6458d0a8604e134aebbd64e59 | Each of three inline/invalid backtick opener cases returned [] instead of ['a.ts']. | All three pass; exactly ['a.ts']; lint clean. |
| AC-6 / AC-8 — C3 | Same command as preceding row | 34470c8b46c102d6458d0a8604e134aebbd64e59 | Unclosed mid-cell marker returned ['a.ts'] instead of ['a.ts', 'b.ts', 'c.ts']; the amendment was hidden. | Pass: all three paths returned; real block/closed-inline control also passes. |
| AC-1 — R1 | Same command as preceding row | 34470c8b46c102d6458d0a8604e134aebbd64e59 | The fused-cell message lacked the required backslash-pipe escape. | Pass: escape and literal-pipe explanation present. |
| AC-4 — R2 | Same command as preceding row | 34470c8b46c102d6458d0a8604e134aebbd64e59 | Unaffected Files incorrectly returned an ignored-heading issue. | Pass: no issue; Tests for affected files still rejected. |
| AC-8 — C1 | Selected valid-grammar test with a filesystem read interceptor simulating an archived live spec | 34470c8b46c102d6458d0a8604e134aebbd64e59 | The original test from git show HEAD, loaded from a scratch copy with only import locations rewritten, threw ENOENT at its live artifact read. | The revised test passes under the same interceptor. |

C1's post-fix command was `node --test --import /tmp/spec-manifest-r2-no-live.mjs --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='manifest lint accepts the valid grammar' tests/run-task-validation.test.ts`. The temporary interceptor throws ENOENT only for this task's live spec path. The pre-fix command substituted the scratch copy of the original test for the final argument. Neither run altered the task artifact.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed successfully. |
| `npm run type-check` | Pass | TypeScript completed successfully. |
| `npm test` | Pass | Full suite: 1,913 tests, 1,912 passed, zero failed, one skipped. The existing linked-worktree root test in `tests/run-task-safety.test.ts` skips under restricted git writes; fish-dependent subchecks report fish unavailable. |
| `npm run build` | Pass | Both declared tracked bundles rebuilt successfully. |
| `npm run sync-templates:check` | Pass | All canon-managed mirrors remain in sync; no guidance changes this round. |
| `npm run docs-refs-check` | Pass | All refs valid; checked again after this append before phase close. |
| Scoped parser and validation tests | Pass | 270 tests passed across `tests/markdown-table.test.ts` and `tests/run-task-validation.test.ts`. |
| Archived-task simulation | Pass | Original test fails with ENOENT; revised fixture test passes under the identical denied-read condition. |
| Archive calibration and consumer differential | Pass | 127 specs; 15 flagged. Specs per kind: fused-cells 3, malformed-path 4, ignored-heading 9, other required kinds 0. Zero scope-path differences from round-1 HEAD. No archived specs edited. |
| Scope and whitespace checks | Pass | Working changes remain within the file cap. Every path in git diff main...HEAD --name-only is covered across the cumulative Changes tables. git diff --check passed. |

E2E remains explicitly inapplicable per the spec. All required Round 1 findings are addressed; optional decisions are recorded above.

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/validation.ts` | N1: recognize Affected Files when bordered by non-letters, including underscore emphasis, while preserving the Unaffected Files exception. |
| `src/orchestrator/markdown-table.ts` | N2: consume the two complete short HTML comment forms without opening multiline-comment state. |
| `tests/run-task-validation.test.ts` | Add single/double underscore heading and short-comment regressions. N3: make closed-inline-comment exclusion observable with a pipe and backticked content inside the comment. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt the declared bundles. |
| `tasks/spec-manifest-lint/handoff.md`, `tasks/spec-manifest-lint/notes.md` | Record Round 2 fixes, red-first and mutation evidence, and validation. |

### Findings addressed

- **N1 — correctness bug:** replace the word-boundary predicate with non-letter boundaries in `src/orchestrator/validation.ts`:1963. Single- and double-underscore Affected Files headings now produce ignored-heading errors; Unaffected Files still passes. Both regression rows failed before the fix and pass afterward.
- **N2 — correctness bug:** explicitly consume both complete short-comment forms in `src/orchestrator/markdown-table.ts`:211 without leaving comment state open. Each form before a valid manifest now returns its live path and a clean lint. Both tests returned no paths before the fix.
- **N3 — correctness bug / test integrity:** the existing real-block/closed-inline test in `tests/run-task-validation.test.ts`:4575 now includes a pipe plus backticked tokens inside the inline comment. Disabling only inline-comment stripping makes that test fail with fused-cells; restoring the source makes it pass. The assertion now distinguishes stripped from unstripped content.

### AC deltas

| AC | Status | Delta |
|---|---|---|
| AC-4 | Met | Restore ignored-heading detection for underscore emphasis without reintroducing the Unaffected Files false positive. |
| AC-6 | Met | Complete short comments no longer hide later content; inline-comment exclusion has an observable regression test. |
| AC-8 | Met | Live scope after short comments is preserved; existing valid-shape tests and the static task-scope fixture pass. |
| AC-15 | Met | Recalibration remains 127 specs, 15 flagged; per-kind counts and archived consumer paths are unchanged from round-2 HEAD. |

All other ACs remain unchanged and their existing tests pass in the full suite. No new ambiguity, blocker, or plan deviation. Optional Round 2 nits and the previously accepted human/QA follow-ups remain deferred; no file outside the spec cap was edited.

### Red-First Evidence

New N1/N2 regressions ran before any production fix edits against HEAD **286ca9fe14e92c7ab3df9ada177bb0572e07d69f**. All four failed for the reviewed reasons. N3's fixture was strengthened before its mutation check; the temporary source mutation was restored before applying the fixes.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-4 — N1 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='round 2 N' tests/run-task-validation.test.ts` | 286ca9fe14e92c7ab3df9ada177bb0572e07d69f | Both underscore-emphasized headings returned zero issues instead of one ignored-heading issue. | Both pass; Unaffected Files remains valid. |
| AC-6 / AC-8 — N2 | Same command as preceding row | 286ca9fe14e92c7ab3df9ada177bb0572e07d69f | Each complete short comment returned [] instead of ['a.ts'] for the following live table. | Both pass: ['a.ts'] and clean lint. |
| AC-6 — N3 mutation | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='revision C3: real block' tests/run-task-validation.test.ts` | 286ca9fe14e92c7ab3df9ada177bb0572e07d69f with only inline-comment stripping disabled | Strengthened test failed: expected no lint issues, received fused-cells for row 1. | Pass with stripping restored; included in final full suite. |

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed successfully. |
| `npm run type-check` | Pass | TypeScript completed successfully. |
| `npm test` | Pass | Full suite: 1,917 tests, 1,916 passed, zero failed, one existing sandbox skip. The linked-worktree root test in `tests/run-task-safety.test.ts` skips under restricted git writes; fish-dependent subchecks report fish unavailable. |
| `npm run build` | Pass | Both declared tracked bundles rebuilt successfully. |
| `npm run sync-templates:check` | Pass | All canon-managed mirrors remain in sync; no guidance changed this round. |
| `npm run docs-refs-check` | Pass | References valid; rerun after this artifact append before phase close. |
| Scoped parser and validation tests | Pass | 274 tests passed across `tests/markdown-table.test.ts` and `tests/run-task-validation.test.ts`. |
| Inline-comment mutation check | Pass | N3 fails with fused-cells when inline stripping is disabled and passes after restoration. |
| Archive calibration and consumer differential | Pass | 127 specs; 15 flagged. Specs per kind: fused-cells 3, malformed-path 4, ignored-heading 9, other required kinds 0. Zero consumer path-array changes from round-2 HEAD. Archives untouched; existing sample classifications remain applicable. |
| Scope and whitespace checks | Pass | All edited source/test/generated files are within the cap. Every path in git diff main...HEAD --name-only is covered across the cumulative Changes tables. git diff --check passed. |

E2E remains explicitly inapplicable per the spec. All required Round 2 findings are addressed.
