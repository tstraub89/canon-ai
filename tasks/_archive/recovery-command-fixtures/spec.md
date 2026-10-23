# Spec: recovery-command-fixtures — Pin every recovery-command hint to a test that runs it from the emitting state

> Written by: Claude | Review by: Codex
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

`docs/BACKLOG.md` §"Enforce the recovery-message and fail-closed pitfalls mechanically", part (a). When canon blocks, halts, resets or refuses, it often tells the operator which `canon` command to run next. A classification pass over archived review findings found that these hints keep naming a command the current state rejects, or the wrong next phase: about 10 blockers in 2026-07, about 3 in 2026-09 and about 3 in 2026-10, even after `docs/patterns.md` gained a rule for it ("Build a state-dependent operator message from one parameterized clause builder").

An inventory of `src/` finds about 9 hint sites routed through shared builders (`buildSpecReviewReason`, `buildCodeReviewReason` and four single-purpose builders) and about 35 ad hoc literals. Only some recovery paths have a test that emits the hint and then runs the named command from that state. Examples with one: the spec- and code-review loop caps (`reset-spec-review`, `reset-code-review`) and the reviewer block (`reset-code-review`). Examples without one: the spec_gap halt's fix (`canon run <ids> --reroute`) and bless (`canon task accept <ids> code_review --reason …`) commands, the code_review pre-flight auto-block's `canon task reset-code-review <id>`, and the `canon task set … human_spec_gate` note that recommends `canon run --reroute`. No mechanism notices when a new hint is added without such a test.

Spec review of this task already found one wrong hint, confirmed by a deterministic trace. The spec_gap halt's fix hint tells the operator to add a `## Amendment` section and run `--reroute` (the status reason at `src/orchestrator/main.ts` around line 3723 and the console copy around line 3747). `--reroute` computes the required heading as round `reroute_count + 1` and, from the second reroute on, accepts only `## Amendment Round N` (`verifyRerouteAmendment` in `src/orchestrator/validation.ts`, which reports "found `## Amendment` …, expected `## Amendment Round 2`"). So on any task already rerouted once, following the hint exactly makes `--reroute` abort. `specGateDoneNote` in `src/task/index.ts` says "add an amendment" without a heading, which is not wrong but gives no round.

Part (b) of the BACKLOG entry (probes that fail open) is out of scope: the inventory found 17 early returns and about 10 ternaries that turn a probe error into an empty-ish value, and many are deliberate "unknown" sentinels or fail closed. A grep would mostly flag false positives.

This task adds tests and fixes wrong hints: the amendment-round hint above (AC-4, red-first) and any other a new fixture proves wrong (AC-5).

## Decision

1. **Registry of hint sites.** A new test file holds a registry with one entry per source site that names one of the recovery commands `--reroute`, `reset-code-review`, `reset-spec-review` or `canon task accept`. An entry has: the source file, a snippet (a verbatim substring of that site's line, unique within the file), a class, and either covering test titles or an exemption reason.
   - **actionable**: the text tells the operator to run the command from the state it is emitted in. Needs chained fixtures.
   - **exempt**: anything else the pattern matches, with a one-line reason: a usage or help renderer, argument parsing or argv handling, a refusal that names the command it is refusing, a negative mention ("NOT --reroute"), an audit or notes line, or a generic pointer list. Needs no fixture.
2. **Registry test.** It scans `src/` line by line for the four commands and fails when: a matching line contains no registered snippet for its file (an unregistered site); a registered snippet is no longer found in its file (a stale entry); or an actionable entry names a covering test title that does not appear in any `tests/*.test.ts`. Each failure message names the file, the line or snippet, and what to do. This is a tripwire that forces a registry decision for every new or reworded site, not proof that a fixture is correct.
3. **Chained fixtures.** Each actionable entry has, for each state it is emitted from, a test that reaches that state through canon's own code, captures the emitted text, runs the command it names, and asserts acceptance and the promised outcome. For a builder literal reached from several states (the review-loop reset hints), the entry lists one covering test per emitting state.
   - A fixture fills in placeholders the hint prints (`<id>`, `"<why>"`) with real values, carries out any precondition the hint states before its command (for example writing the `## Amendment` the spec_gap fix hint asks for), and covers each command a multi-command hint names.
   - A fixture bounds a run that would continue into an agent phase by using fake agent CLIs on `PATH`, by adding `--step --expect <phase>`, or by asserting the reset banner and `status.json` before the agent phase starts. It must not hand-edit the target state, except that a state only an agent verdict can produce (spec_gap) may be set up by writing the verdict artifact and status an agent would write and letting `checkAndRoute` emit the hint.
4. **Fix what the fixtures expose.** If a chained fixture shows a hint naming a command the state rejects, or promising an outcome it does not reach, the hint is corrected in the same task, preferably by routing it through an existing builder, and any doc that restates it is updated.

Plain `canon run` resume hints are out of scope: plain `canon run` is accepted from every state that emits it.

## Non-Goals

- Hints naming other commands (`canon task phase`, `canon task set`, `canon stop`, `canon watch`, `--step --expect` without `--reroute`, `--force`). The BACKLOG entry's part (a) covers "any `canon` subcommand"; this task covers the four recovery commands, where the recorded blockers clustered, and AC-7 records the narrower scope.
- Part (b), mechanical enforcement of fail-closed probes. AC-7 records why.
- No new shared clause builder or refactor of hints that are already correct.
- No change to which states the recovery commands accept. If a fixture shows the command, not the hint, is wrong, record it in the handoff Blockers and leave it for a separate task.
- No change to help or usage text.

## Acceptance Criteria

- [ ] AC-1: the registry (Decision 1) covers every line in `src/` matching `--reroute|reset-code-review|reset-spec-review|canon task accept`, each classified actionable or exempt with a reason. The handoff summarizes the counts per class and lists the actionable entries with their emitting states. Verified by the registry test (AC-3) passing.
- [ ] AC-2: every actionable entry has chained fixtures per Decision 3, one per emitting state. At minimum these get new fixtures: the spec_gap fix hint (`--reroute` after an amendment), the spec_gap bless hint (`canon task accept … code_review --reason`), and the code_review pre-flight auto-block hint (`canon task reset-code-review`). The existing spec- and code-loop cap tests and the reviewer-block test run the right command but hard-code it instead of taking it from the emitted text; they are extended to extract the command from the emitted hint, not duplicated. Of the shared builders, only `buildSpecReviewReason`, `buildCodeReviewReason` and `stopForReviewerBlock` name one of the four commands. The pre-flight auto-block is reached when every pre-flight issue is in the `blocked` class (a Validation Outcomes row recorded `blocked`), which no existing test drives. The bless fixture keeps the tree clean outside the task directory, since `canon task accept` refuses a dirty tree. Each fixture asserts the command exits 0 and the task reaches the phase or outcome the hint promises. Verified by running the named tests.
- [ ] AC-3: the registry test implements Decision 2's three failure checks. Verified by the test passing on the final tree and by three red checks the test itself performs against an injected source root or in-memory file set: an unregistered matching line, a stale snippet, and a covering-test title that does not exist each produce the named failure message.
- [ ] AC-4 (red-first): the spec_gap fix hint, in both the status reason and the console output, names the amendment heading the next `--reroute` will require: `## Amendment` when the task's `reroute_count` is 0, `## Amendment Round N` with N = `reroute_count + 1` otherwise (for a bundle, per task). Verified by a chained fixture on a task with `reroute_count: 1` that reaches the spec_gap halt, writes the heading the hint names, runs the printed `--reroute` command, and asserts it is accepted. On the pre-fix code the fixture fails because `--reroute` aborts with "expected `## Amendment Round 2`"; the handoff records that failure. A second case with `reroute_count: 0` keeps passing.
- [ ] AC-5: any other hint a chained fixture proves wrong is fixed, red-first: the fixture fails on the pre-fix hint for the stated reason and passes after, and the handoff records the pre-fix failure. Every doc restating a changed hint (`docs/pipeline-orchestrator.md` and its mirror) is updated in the same change. If no other hint is wrong, the handoff says so explicitly.
- [ ] AC-6: the new tests write only to temp fixtures. Verified by comparing `git status --porcelain` captured immediately before and after `npm test` in the implement session: no new paths appear.
- [ ] AC-7: `docs/BACKLOG.md`'s entry is updated: part (a) records that the registry test and fixtures now cover hints naming the four recovery commands, and that hints naming other `canon` commands remain unenforced; part (b) records why a grep-based check is not practical (about 17 early returns and 10 ternaries map probe errors to empty-ish values, many deliberately) and stays open as a review-lens item.

## Design

### Affected Files

| File | Change |
|---|---|
| `tests/recovery-hints.test.ts` | New: registry, registry test (AC-1, AC-3) and new chained fixtures (AC-2); copies the small subprocess helpers it needs from `tests/run-task-safety.test.ts` rather than sharing them |
| `tests/run-task-safety.test.ts` | Extend the loop-cap chained tests to take the command from the emitted text |
| `tests/run-task-code-review.test.ts` | Extend the reviewer-block chained test to take the command from the emitted text |
| `src/orchestrator/main.ts` | AC-4 amendment-round heading in the spec_gap fix hint; other hints only if a fixture proves them wrong (AC-5) |
| `src/orchestrator/phases/code-review.ts` | Only if a fixture proves a hint here wrong (AC-5) |
| `src/orchestrator/review-loop.ts` | Only if a fixture proves a builder hint wrong (AC-5) |
| `src/orchestrator/cli.ts` | Only if a fixture proves a hint here wrong (AC-5) |
| `src/task/index.ts` | Only if a fixture proves a hint here wrong (AC-5) |
| `docs/pipeline-orchestrator.md` | Only if a restated hint changes (AC-5); its spec_gap row says "amend" without a heading, so AC-4 leaves it as is |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror, only if the root changes |
| `dist/orchestrator/run-task.js` | Rebuilt for the AC-4 hint change |
| `dist/cli/index.js` | Rebuilt only if a source hint changes |
| `docs/BACKLOG.md` | AC-7 entry update |

### Interaction Dependencies

- Existing chained tests to reuse or cite: the loop-cap tests in `tests/run-task-safety.test.ts` ("main blocks a capped spec loop before revision, re-blocks on resume, and its advertised reset works" and its code-loop sibling), and "reviewer block covers a mixed bundle" in `tests/run-task-code-review.test.ts`.
- `rerouteFromHumanReview` calls `die`, so `--reroute` acceptance is observable only through a subprocess run of `main()`. `runMainInline` and the fake agent CLI setup are file-local to `tests/run-task-safety.test.ts`; the new file copies what it needs.
- `tests/run-task-reroute-preflight.test.ts` already checks that `--reroute` accepts or refuses a code_review spec_gap state (helper `makeCodeReviewBlockedStatus`); what is missing is the link from the emitted hint to running it.
- The spec_gap halt is reached through a code_review verdict, which an agent writes; per Decision 3 the fixture may write `review.md` with a checked `spec_gap` verdict and let `checkAndRoute` emit the hint.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite
- [x] `npm run build`
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`

## Docs Impact

`docs/BACKLOG.md` is edited (AC-7). If a hint changes, `docs/pipeline-orchestrator.md` may restate it in its recovery sections; QA checks it.

## Known Risks

- **Scope growth.** If many hints turn out wrong, fixing them all could balloon. AC-5 fixes only hints a fixture proves wrong; a wrong command (not hint) goes to Blockers per Non-Goals.
- **Misclassification.** Marking a real recovery hint exempt dodges a fixture. Each exemption carries a reason the reviewer can check against the line.
- **Registry brittleness.** Rewording a hint line breaks its snippet. That is the intended trade: the failure message says exactly what to update.
- **Literal-only scan.** A hint assembled from fragments or variables (`'canon task ' + verb`) escapes the line scan. The registry is a tripwire for ordinary literals, not a proof.
- **Concurrent edits.** Other in-flight tasks that add or reword hint lines will fail the registry test after this lands until they register their sites; the failure message tells them how.
- **Fixture realism.** A fixture that hand-writes the target state can pass while the real path emits a different hint. Decision 3 requires reaching the state through canon's code, with the agent-verdict exception.
- **Slow tests.** Subprocess `main()` runs take about half a second each; a dozen new ones add seconds, not minutes.

## Human Test Plan

1. Run the test suite.
2. Expected: the recovery-hint tests pass, and each one shows a halt message followed by its printed command being accepted.
3. Add a new halt message to the code that tells the operator to run a reroute, without registering it.
4. Expected: the suite fails with a message naming the new line and saying to register it with a covering test.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) AC-4's mechanism is confirmed by trace (Problem); AC-4 and AC-5 are red-first
- [x] (Refactors) N/A
