# Implementation Handoff: recovery-command-fixtures

> Author: Codex | Spec: `tasks/recovery-command-fixtures/spec.md` | Plan: `tasks/recovery-command-fixtures/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts`, `dist/orchestrator/run-task.js` | Added shared `rerouteAmendmentHeading` logic and used it in the spec_gap FIX reason and console hint, so both name the heading required by the next reroute for each task. |
| `tests/recovery-hints.test.ts` | Added the registry for all matching source lines, actionable fixtures, and injected registry failures for an unregistered line, stale snippet, and missing test title. |
| `tests/run-task-safety.test.ts` | Existing spec/code loop-cap fixtures now extract reset commands from emitted escalation text, assert the console copy, and execute the extracted command. |
| `tests/run-task-code-review.test.ts` | Reviewer-block test now extracts and compares reset commands from console and escalation text, then executes the extracted commands. |
| `docs/BACKLOG.md` | Recorded shipped coverage for the four recovery commands, the remaining unenforced command families, and why probe-error grep enforcement stays open. |

## Intent & Rationale

The spec_gap FIX hint previously always named `## Amendment`; after one reroute, `--reroute` requires `## Amendment Round 2`. The new helper supplies the same round-sensitive heading to the hint and reroute pre-flight. The registry test now makes each literal site an explicit actionable fixture or an exemption with a reason.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| T6 invokes `runCodeReviewPhase` directly with controlled dependencies, instead of driving the entire CLI pipeline. | This reaches the production pre-flight classifier and auto-block branch with a real `blocked` Validation Outcomes row, while controlled review dependencies keep the follow-up deterministic and confined to a temp repository. | None; the fixture captures the real hint, runs its extracted reset command, changes the blocked row to Pass, and verifies the follow-up reaches the reviewer call without another pre-flight rejection. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | The registry covers all 56 matching source lines: 11 actionable entries and 45 exempt entries, each exemption carrying a reason. Actionable sites and emitting states: reviewer-block reset reason/output in code_review; spec_gap FIX reason/output at reroute_count 0, reroute_count 1, and a mixed bundle; spec_gap BLESS reason/output at the spec_gap halt; code_review pre-flight auto-block when every issue is blocked; sanctioned `task phase` redirect from a code_review spec_gap halt; spec-loop reset at spec entry before revision and spec_review entry after revision; code-loop reset at implement entry and code_review entry; spec-gate note reroute from code_review, qa, and human_review. The final-tree registry test passes. |
| AC-2 | Met | New chained fixtures cover the spec_gap FIX, BLESS, all-blocked pre-flight auto-block, sanctioned redirect, spec-gate note, and cap hints from their additional emitting states. Existing cap and reviewer-block fixtures extract the command from emitted text and execute it. `tests/recovery-hints.test.ts` passes all 11 tests; the named existing tests pass in the full suite. |
| AC-3 | Met | The registry test itself checks three injected cases and asserts the named failure messages: unregistered matching line, stale snippet, and nonexistent covering-test declaration. Both the injected-check test and real-tree registry test pass. |
| AC-4 | Met | The reroute_count 0 and 1 fixtures both pass. Red-first run: temporarily restored the FIX hint to `## Amendment` while leaving reroute validation round-sensitive, then ran `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='spec_gap fix hint at reroute_count 1' tests/recovery-hints.test.ts`; it failed after executing the printed command with `--reroute aborted: spec.md amendment required before reroute` and `expected heading: ## Amendment Round 2`. With the helper-backed hint, the same fixture passes. |
| AC-5 | Met | No other hint was wrong in the chained fixtures. `docs/pipeline-orchestrator.md` and its mirror do not restate the changed heading; no doc update was needed. |
| AC-6 | Met | `git status --porcelain` captured immediately before and after the final `npm test` is identical; the test run adds no paths. Captures are `/tmp/recovery-command-fixtures-before-final-test.txt` and `/tmp/recovery-command-fixtures-after-final-test.txt`. |
| AC-7 | Met | `docs/BACKLOG.md` now says the registry and fixtures cover hints naming the four recovery commands; other `canon` commands remain unenforced. Part (b) stays open and records why a grep check is impractical. |

## Edge Cases Considered

- The registry scans all files below `src/`, line by line, and its synthetic checks exercise all three failure modes.
- The FIX fixture compares persisted and console hint behavior, writes the heading the hint names, and runs the printed reroute. The bundle fixture verifies only the spec_gap member receives an amendment heading.
- The BLESS fixture leaves the temp repository clean outside the task directory so the real `canon task accept` clean-tree guard is exercised.
- The pre-flight fixture records a blocked validation row and reaches the production auto-block path before running its printed reset command.
- The built runtime bundle contains the helper-backed hint; `dist/cli/index.js` was not changed.

## Blockers

- `[ambiguity]` `src/orchestrator/main.ts`'s combined `--reroute --step --expect` line is classified exempt as an alternate invocation form. Read literally after reroute, it is not accepted from the resulting phase; I interpret it as guidance about how to invoke the reroute itself, not a next-step recovery command. A reviewer may judge the line actionable.
- `[ambiguity]` The `src/task/index.ts` sanctioned redirect interpolates a phase and can name `spec_review` or `code_review`. The chained fixture covers the `code_review` form emitted at a spec_gap halt; the `spec_review` form's accepted states are governed by the recovery command's existing state contract, which this task does not change.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-4 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='spec_gap fix hint at reroute_count 1' tests/recovery-hints.test.ts` | Temporary old FIX hint (`## Amendment`) with current reroute pre-flight | Printed `--reroute` exited 1: `--reroute aborted: spec.md amendment required before reroute`; expected heading was `## Amendment Round 2`, but the fixture wrote `## Amendment`. | Same test passes with both reason and console hint naming `## Amendment Round 2`. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Pass | Completed after the final source changes; runtime bundle rebuilt. |
| `npm run type-check` | Pass |  |
| `npm run lint` | Pass |  |
| `npm test` | Pass | 1,572 passed, 0 failed, 1 skipped; the skipped test is the existing `.git/` write restriction. Tests wrote no new paths. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/recovery-hints.test.ts` | Pass | 11 tests passed, including registry and all new fixtures. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Findings addressed

| Finding | Change |
|---|---|
| Spec-gate fixture used a hand-set phase pointer and actually covered qa, human_review, human_review. | The fixture now derives each entry state from phase statuses, asserts the derived phase before emitting the note, and covers the intended code_review, qa, and human_review states. |
| Loop-cap entry fixtures bypassed phase emitters by calling the evaluator helpers. | Both fixtures now invoke `main()` at the capped phase through temp repositories, extract the command from the persisted escalation, assert the console copy, and run the extracted reset. |
| Sanctioned redirect fixture omitted its spec_review form. | Added a spec_review-state fixture that extracts and runs the printed `canon task accept` command and asserts sanctioned status, operator audit fields, and the next phase. |
| Full-send scope note still said `(as an ## Amendment)` after the FIX hint had become round-sensitive. | The status reason and console scope note now use the same per-task heading list as FIX. The new fixture reaches a full-send spec_gap halt with an unscoped committed file and asserts both message copies name the required round. |

### AC deltas

| AC | Iteration 2 result |
|---|---|
| AC-1 | Still met: 56 source lines, 11 actionable entries, and 45 exempt entries. The sanctioned redirect entry now covers both its `code_review` and `spec_review` emitting forms. The alternate-invocation exemption reason now explains why it is exempt. |
| AC-2 | Met: spec-gate coverage now reaches the three declared phases, both additional loop-cap cases run through `main()` and extract emitted commands, and the `spec_review` sanctioned redirect form has a chained fixture. |
| AC-3 | Still met: the real-tree registry test and all three injected failure checks pass. The test-title escape now covers `$` as well. |
| AC-4 | Still met: no change to the red-first fix or its passing round-sensitive cases. |
| AC-5 | Met: the scope-note defect was reproduced red-first and fixed. The changed message is runtime-only; `docs/pipeline-orchestrator.md` and its mirror do not restate it. No other hint was shown wrong. |
| AC-6 | Still met: the final full-suite before/after `git status --porcelain` diff is empty. Captures: `/tmp/recovery-command-fixtures-iteration-2-before-test.txt` and `/tmp/recovery-command-fixtures-iteration-2-after-test.txt`. |
| AC-7 | Still met: no further BACKLOG change was needed. |

### Red-first evidence

| Finding | Command and pre-fix result | Post-fix result |
|---|---|---|
| Scope-note heading | Before changing the runtime text, ran `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='spec_gap scope hint names the round-specific amendment heading' tests/recovery-hints.test.ts`. It failed on the emitted scope note: `Affected Files (as an ## Amendment)` while the same message's FIX line required `## Amendment Round 2`. | The focused recovery-hints suite passes; both the persisted reason and console copy name `## Amendment Round 2`. |

### Additional review cleanup

- Reworked the helper and fixture section of `tests/recovery-hints.test.ts` into the repository's multi-line style.
- The spec_gap round-1 fixture now asserts `reroute_count === 2` and review archival.
- The pre-flight fixture changes its blocked Validation Outcomes row to Pass before running the printed reset, matching the hint's stated order.
- The spec-loop reset assertion includes subprocess diagnostics.
- Previous ambiguity entries are resolved: the reviewer accepted the alternate-invocation exemption (now with a matching reason), and the spec_review redirect form now has a fixture.

### Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js` after the scope-note runtime change. |
| `npm run type-check` | Pass |  |
| `npm run lint` | Pass |  |
| `npm test` | Pass | 1,574 passed, 0 failed, 1 skipped. The skipped test is the existing `.git/` write restriction. No new paths appeared during the run. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/recovery-hints.test.ts` | Pass | 13 tests passed, including all registry and chained fixtures. |

## Iteration 3 — addressing review round 2

### Findings addressed

| Finding | Change |
|---|---|
| The spec_gap full-send scope note named the next human reroute amendment heading, allowing a scope-only section to satisfy a later `--reroute` after BLESS. | The persisted reason and console hint now share one clause naming `## Amendment (full-send scope)`. The fixture follows the emitted heading, runs the extracted BLESS command, then runs the emitted reroute and verifies it still requires `## Amendment Round 2`. The runtime bundle was rebuilt. |

### AC deltas

| AC | Iteration 3 result |
|---|---|
| AC-5 | Met: the chained fixture proved the old scope note could be followed by BLESS and a later reroute without a fresh amendment. Both runtime message copies now name the scope-only heading. `docs/pipeline-orchestrator.md` and `templates/docs/pipeline-orchestrator.md` already state that this heading never satisfies the human reroute gate, so no doc change was needed. No other hint was shown wrong. |
| AC-6 | Met: `git status --porcelain=v1` was captured immediately before and after `npm test`; `diff -u` returned 0 with no new paths. Captures: `/tmp/recovery-command-fixtures-iteration-3-before-test.txt` and `/tmp/recovery-command-fixtures-iteration-3-after-test.txt`. |

### Red-first evidence

| Finding | Command and pre-fix result | Post-fix result |
|---|---|---|
| Scope-only amendment heading | Before the source fix, ran `node --import tsx --test --test-name-pattern='spec_gap scope hint' tests/recovery-hints.test.ts`. The fixture followed the emitted `## Amendment Round 2` scope instruction, BLESS succeeded, and the later printed `--reroute` exited 0 and advanced to `spec_review`; the fixture failed because it expected the reroute to refuse without a human amendment. | The same test passes after the message names `## Amendment (full-send scope)`. BLESS succeeds; the subsequent printed reroute exits nonzero and reports `expected heading: ## Amendment Round 2`. |

### Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`. |
| `npm run lint` | Pass |  |
| `npm run type-check` | Pass |  |
| `npm test` | Pass | 1,574 passed, 0 failed, 1 skipped; the skip is the existing `.git/` write restriction. Before/after porcelain diff was empty. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `node --import tsx --test --test-name-pattern='spec_gap scope hint' tests/recovery-hints.test.ts` | Pass | The strengthened chained scope/BLESS/reroute fixture passes. |
