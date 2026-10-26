# Implementation Plan: reroute-from-implement

> Written by: Claude | Implements: `tasks/reroute-from-implement/spec.md`

## Approach

Add one exported predicate, `isRerouteAdmitted(status)`, to `src/orchestrator/state.ts`. It replaces both `REROUTE_ADMITTED_PHASES` sets. The orchestrator gate (`rerouteFromHumanReview()` in `src/orchestrator/main.ts`) and `specGateDoneNote()` in `src/task/index.ts` both call it. The reroute reset loop needs no change: it already writes the state AC-5 pins. Everything else is text. One describer builds both the banner and the rejection summary. The loop-cap reason gains a state-independent `--reroute` clause. Then the reroute prompts, help, and docs get the phase-neutral, partial-round wording.

Spec review was `approved` with no nits. I found no spec contradictions. One `[plan]` observation is in `notes.md`: the predicate does not fall back to the legacy `iterations` alias.

**Feasibility check**
- **Exists:** confirmed by search: `REROUTE_ADMITTED_PHASES` at `src/orchestrator/main.ts:2783` and `src/task/index.ts:1549`; `describeRerouteEntryPhase()` at `src/orchestrator/main.ts:2794`; `rerouteFromHumanReview()` at `src/orchestrator/main.ts:2804`; `specGateDoneNote()` at `src/task/index.ts:1551`; `deriveTopLevelStatus()` at `src/orchestrator/state.ts:433`; `buildCodeReviewReason()` at `src/orchestrator/review-loop.ts:94`; `modeExplain.reroute` at `src/orchestrator/context.ts:168`; `promptImplementReroute()` at `src/orchestrator/prompts/index.ts:423`. Also confirmed: the three reroute templates, the `--reroute` help at `src/orchestrator/cli.ts:52-55`, the `HINT_SITES` registry in `tests/recovery-hints.test.ts`, and the `recordOrAssert` golden harness in `tests/run-task-prompts.test.ts`.
- **Real path:** `main()` calls `guardConcurrentRun()` at `src/orchestrator/main.ts:4027` before `rerouteFromHumanReview()` at `:4051`. The gate (`:2812`) reads `getCurrentPhase()`, which is `deriveTopLevelStatus()`. The amendment pre-flight, the review archive, and the reset loop (`:2937-3023`) already handle an implement-phase entry. The loop zeroes both code_review current-loop counters, sets implement `pending` + `rerouted` + `reroute_count+1`, and resets spec_review/plan on full tier. `archivePriorReview(..., { skipUnfilledTemplate: true })` already skips a pristine `review.md`. `runImplementPhase()` (`src/orchestrator/phases/implement.ts:50`) runs `evaluateCodeReviewLoop` first. That check writes the loop-cap state: implement `pending`, code_review `blocked`, verdict `''`.
- **Callers:** `REROUTE_ADMITTED_PHASES` has exactly 2 consumers: the gate at `main.ts:2812` and `specGateDoneNote` at `task/index.ts:1555`. Both switch to the predicate. `describeRerouteEntryPhase()` is called only from the banner (`main.ts:2882,2884`); this plan adds the rejection summary as a second caller. `buildCodeReviewReason()` is called only by `evaluateCodeReviewLoop()`, and its reason feeds both `phases/implement.ts:50` and `phases/code-review.ts:301`. The new `--reroute` clause holds in both states because each leaves code_review `blocked`, so the predicate admits both. No error contract changes: rejection is still `die()`.
- **Tests that can fail:** The loop-cap admit row (implement `pending`, code_review `blocked`, verdict `''`) and the route-back row (implement `pending`, code_review `pending`, `iterations_current_loop: 1`) derive phase `implement`. The base gate rejects both. Spec review confirmed this with probes. The two pre-flight-only and in_progress/blocked rows also fail on base. Opposite-outcome text tests fail on base, which has no implement sub-state text. The chained "code loop cap at implement entry" hint test fails on base twice over: the reason has no `--reroute`, and the gate rejects.
- **Predicates:** The predicate checks the phase first. For `spec`, `spec_review`, `plan`, and `complete` it returns false even when stale counters are non-zero. `code_review`, `qa`, and `human_review` return true for any status. For `implement` it is true iff implement status is `in_progress` or `blocked`, OR code_review status is `blocked`, OR either current-loop counter is `> 0`. A counter is `> 0` only when it is a finite number above 0. Absent, `null`, non-number (`"1"`), `0`, and negative values all count as 0. `src/task/index.ts` reads status through `readJsonFile` with no `validateStatus`, so these shapes can reach the predicate. Implement `pending`, `changes_requested`, or a missing status, with code_review not blocked and zero counters, is rejected.
- **Scope:** every file below is in the spec's Affected Files. `tasks/reroute-from-implement/handoff.md` and `notes.md` are task artifacts.
- **Async/stateful:** The predicate is pure and reads one `StatusJson` snapshot. The gate still runs before any mutation, so a rejection leaves `status.json` byte-unchanged. A live run is excluded by `guardConcurrentRun()`; nothing changes there. Re-entry after an aborted implement round is the point of the task. The reset leaves `implement.rerouted === true` and zero counters, so `shouldUseImplementRevision()` picks the reroute prompt, not the revision prompt. With implement no longer `in_progress`, `isResume` is false.

## Steps

### Step 0: Red-first evidence (before any `src/` edit)

Files: `tests/run-task-reroute-preflight.test.ts`, `tests/recovery-hints.test.ts`

1. First write the new admit rows for loop-cap and route-back (Step 7a) and the chained test "code loop cap at implement entry: the printed reroute is accepted" (Step 7d). Run them against unmodified `src/`:
   `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='loop-cap|route-back|code loop cap at implement entry' tests/run-task-reroute-preflight.test.ts tests/recovery-hints.test.ts`
2. Expected base failures:
   - Both admit rows exit non-zero with `--reroute requires every named task's current phase to be code_review, qa, or human_review`.
   - The chained test fails at `assert.ok(command, reason)` because the reason has no `--reroute`.
3. Record the command, base HEAD SHA, and observed failure in the handoff's `## Red-First Evidence`.

### Step 1: Shared admission predicate

Files: `src/orchestrator/state.ts`

Add these next to `deriveTopLevelStatus()`:

```ts
// A code_review current-loop counter; absent, non-numeric, or negative reads as 0.
export function currentLoopCount(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

// `canon run --reroute` admission: implementation has begun on every admitted task.
export function isRerouteAdmitted(status: StatusJson): boolean {
    const phase = deriveTopLevelStatus(status);
    if (phase === 'code_review' || phase === 'qa' || phase === 'human_review') return true;
    if (phase !== 'implement') return false;
    const implementStatus = status.phases.implement?.status;
    const codeReview = status.phases.code_review;
    return implementStatus === 'in_progress'
        || implementStatus === 'blocked'
        || codeReview?.status === 'blocked'
        || currentLoopCount(codeReview?.iterations_current_loop) > 0
        || currentLoopCount(codeReview?.preflight_rejections_current_loop) > 0;
}
```

Read only `iterations_current_loop`, not the legacy `iterations` alias (spec Decision 1). See `notes.md`.

### Step 2: Orchestrator gate, banner, and rejection message

Files: `src/orchestrator/main.ts`

1. Delete `REROUTE_ADMITTED_PHASES` (`:2783-2787`). `main.ts` imports state as `import * as splitState from './state.js'` (`:18`), so call `splitState.isRerouteAdmitted` and `splitState.currentLoopCount`; the snippet below writes `currentLoopCount` for brevity. Then set `const allAdmitted = entryStatuses.every(({ status }) => splitState.isRerouteAdmitted(status));`. Leave `isSpecGapReroute` unchanged (spec Non-Goal; AC-2c).
2. Extend `describeRerouteEntryPhase()` with an `implement` branch. Leave the `code_review` branch and the bare-phase fallback unchanged; the existing banner test pins them.
   ```ts
   if (phase === 'implement') {
       const implementStatus = status.phases.implement?.status ?? 'pending';
       const codeReview = status.phases.code_review;
       const details = [`code_review ${codeReview?.status ?? 'pending'}`];
       const rounds = currentLoopCount(codeReview?.iterations_current_loop);
       const preflight = currentLoopCount(codeReview?.preflight_rejections_current_loop);
       if (rounds > 0) details.push(`${rounds} review round${rounds === 1 ? '' : 's'} this loop`);
       if (preflight > 0) details.push(`${preflight} pre-flight rejection${preflight === 1 ? '' : 's'} this loop`);
       return `implement ${implementStatus} (${details.join(', ')})`;
   }
   ```
   Sample output for the loop-cap state: `implement pending (code_review blocked, 3 review rounds this loop)`.
3. Rejection summary: when the current phase is `implement`, emit `'${taskId}': ${describeRerouteEntryPhase(status)}`. Keep the existing `'${taskId}': ${currentPhase} (code_review …, verdict …)` form for every other phase. Existing reject rows match `'task-a': <phase>`, so they keep passing. A rejected implement task then reads `'task-a': implement pending (code_review pending)`, and an admitted one shows its sub-state in the banner. One describer serves both surfaces (patterns.md §"Build a state-dependent operator message from one parameterized clause builder").
4. Replace the rule sentence (`:2823-2825`). The first source line must contain `--reroute` because the registry pins it.
   ```ts
   `--reroute requires implementation to have begun on every named task: current phase code_review, qa, or human_review; ` +
   `or implement once implementation has begun — implement in progress or blocked, a blocked code review, ` +
   `or a code review already run in the current loop (a review round or a pre-flight rejection). ` +
   `Current state: ${summary}`
   ```
   Do not reintroduce "completed implement round" (AC-8).

### Step 3: Spec-gate note follows the predicate

Files: `src/task/index.ts`

1. Delete the two-line "Mirrors REROUTE_ADMITTED_PHASES…" comment and the set (`:1547-1549`).
2. Add `isRerouteAdmitted` to the existing `../orchestrator/state.js` import (`:15`). Set `if (isRerouteAdmitted(status)) { …unchanged armed-gate text… }`. Keep that string byte-identical so its `HINT_SITES` entry stays valid.
3. Replace the "will not fire" text. It contains no `--reroute`, so it needs no registry entry.
   `Note: spec_review is already done on task ${id}, so the armed gate will not fire on this pass. On a full-tier task it can fire again only if an amendment is rerouted once implementation has begun: the task reaches code_review, qa, or human_review, or is at implement with implement in progress or blocked, a blocked code review, or a code review already run in the current loop.`

### Step 4: Loop-cap message names the reroute path

Files: `src/orchestrator/review-loop.ts`

In `buildCodeReviewReason()`, insert a clause right after "…may need revisiting rather than another implementation pass. ". Keep it on its own source line so the registry snippet is unique:

```ts
`If the spec itself needs to change, add the next Amendment section to each task's tasks/<id>/spec.md and run canon run ${taskIds.join(' ')} --reroute instead (the reroute pre-flight names the exact heading it expects). ` +
```

The `reset-code-review` rescope sentence stays. The clause holds in both `revisionNotDone` states (Approach → Callers), so do not route it through the state-dependent clause helpers. Keep `MAX_REVIEW_LOOPS` ahead of `reset-code-review`; `tests/run-task-code-review.test.ts:861` asserts that order.

### Step 5: Help text and implement state header

Files: `src/orchestrator/cli.ts`, `src/orchestrator/context.ts`

1. Replace `cli.ts:52-53` and keep the Full-tier / Feedback-channel lines that follow:
   ```
   '  --reroute           Reset a task once implementation has begun: current phase code_review,',
   '                      qa, or human_review, or implement when it is in progress or blocked,',
   '                      its code review is blocked, or a code review already ran in the current loop.',
   ```
2. In `context.ts:168`, change "after a completed implementation round" to "after implementation began". This string renders only in the implement-reroute prompt; `promptImplement` takes `'fresh' | 'resume'` only.

### Step 6: Reroute prompts (AC-9)

Files: `src/orchestrator/prompts/index.ts`, `src/orchestrator/prompts/templates/implement-reroute.md`, `src/orchestrator/prompts/templates/plan-reroute.md`, `src/orchestrator/prompts/templates/spec-review-reroute.md`

**`prompts/index.ts` (`promptImplementReroute`)**
- First-reroute banner: "after a completed implementation round" → "after implementation began". Bundle banner: "after completed implementation rounds" → "after implementation began". Keep "A human decided …" in both.
- Round ≥2 banner: replace "beyond what you fixed in reroute #N" with "on top of the reroute #N amendment". The prior round may not have finished, so "fixed" can be false.
- Non-exempt per-task line: replace the text after the task id with: `— a human amended the spec and rerouted this task after implementation began. Locate ${expectedHeading} in tasks/${id}/spec.md: it holds the newest requirements and wins where it conflicts with an earlier section; earlier sections (the original ACs and prior amendment rounds) stay binding wherever their work is not yet implemented. Your previous handoff is at tasks/${id}/handoff.md (use it only if it has been filled in).` Keep the `(entering reroute round N)` and `${expectedHeading}` tokens; tests at `tests/run-task-prompts.test.ts:567-568` match them. Remove "Ignore prior-round sections when implementing this one." Leave the exempt lines unchanged.
- Non-resumed preamble: `A human decided this task needed a spec amendment after implementation began, wrote the amendment into spec.md, and rerouted the task. The spec has been updated in place — new ACs, new sections, or revised requirements have been added since you last read it. This is **not** a resume of an interrupted session. The prior implementation round may be complete or partial: this round's scope is the amendment plus any unfinished work from the original ACs and earlier amendment rounds.`
- Resumed preamble: `Your session is being continued with spec amendments. The spec has been updated since your last turn — new ACs, new sections, or revised requirements have been added. The prior implementation round may be complete or partial, so confirm the current state from the worktree rather than from memory: this round's scope is the amendment plus any unfinished work from the original ACs and earlier amendment rounds.` This drops the "existing code … still valid; only the spec has changed" claim, which a partial round makes false.
- Resumed grounding rule: "re-read the amended spec.md and your handoff.md" → "re-read the amended spec.md, and handoff.md if it has been filled in,".

**`implement-reroute.md`.** Rewrite steps 1-5 and 7; leave step 0 and step 6 as they are.
1. Keep everything up to and including the exact-heading guidance. Replace "Treat that section's content as the new requirements; ignore prior-round sections when implementing this one." with "That section holds the newest requirements and wins where it conflicts with an earlier section; earlier sections (the original ACs and prior amendment rounds) stay binding wherever their work is not yet implemented."
2. "use that section as the delta guide" → "use that section as this round's plan guide". Keep the rest.
3. New: "Establish the current state from the worktree, not from memory: run `git status` and `git diff` against the task's base branch to see what is actually implemented, committed or not. The prior implementation round may be complete or partial — a reroute can follow a finished round or interrupt one that was stopped, crashed, or blocked mid-way, leaving uncommitted edits behind. Treat tasks/<id>/handoff.md as a record of prior work only if it has been filled in (after an aborted first pass it may still be the unfilled template); even then it predates the amendment."
4. New: "Determine this round's scope: the amendment, plus any unfinished work from the original ACs and earlier amendment rounds. Note which ACs are new, which changed, and which the worktree already implements." This removes "already addressed by the previous implementation".
5. New: "Implement that scope. Correct existing work stays; change it only where the amendment or an unmet AC requires. If the amendment conflicts with a prior AC, the amendment wins."
7. Keep the existing step and add after its first sentence: "The Changes table must list every file this task has changed — committed on the branch or dirty in the worktree (`git status --porcelain`), including uncommitted edits left by an interrupted earlier round; canon's auto-commit refuses to commit a dirty file the table omits." Keep "Carry existing Red-First Evidence rows forward." (`tests/run-task-prompts.test.ts:413` pins it).

**`plan-reroute.md`**
- Line 5: "after a completed implementation round" → "after implementation began".
- Step 3: "Establish the current implementation state from the worktree: `git status` and `git diff` against the task's base branch. The prior implementation round may be complete or partial. Read `tasks/<id>/handoff.md` as a record of Codex's prior work only if it has been filled in — after an aborted first pass it may still be the unfilled template."
- Step 6: "Plan this round's scope: the amendment, plus any unfinished work from the original ACs and earlier amendment rounds (those sections stay binding wherever not yet implemented; the newest amendment wins on conflict). Reference specific files, functions, and existing patterns. Acknowledge prior plan steps that are already implemented without re-planning them."
- Closing line: "…is what implement-reroute reads as its delta guide." → "…is what implement-reroute reads as its guide for this round."
- HTML append-shape comment: keep the `### Delta` heading (`tests/run-task-prompts.test.ts` asserts `/### Delta/`). Change the bullet to `- ...ordered steps for this round's scope (amendment plus unfinished earlier work)...`.

**`spec-review-reroute.md` line 5**: "after a completed implementation round" → "after implementation began".

### Step 7: Tests

**7a. `tests/run-task-reroute-preflight.test.ts`** (AC-1, AC-2, AC-3, AC-4, AC-5, AC-6)
- Add `import { isRerouteAdmitted } from '../src/orchestrator/state.js';`.
- **Predicate unit tests** (AC-3), table-driven over `makeRerouteStatus(...)` objects:
  - Admit: implement `in_progress`; implement `blocked`; loop-cap (implement `pending`, code_review `blocked`, verdict `''`); route-back (`iterations_current_loop: 1`); pre-flight-only (`preflight_rejections_current_loop: 1`, `iterations_current_loop: 0`); `code_review`, `qa`, and `human_review` entries.
  - Reject: implement `pending` with zero counters; the same with counters absent; counters `'1'` (string) and `-1`; `plan` pending with stale `iterations_current_loop: 2` (proves the phase check comes first); `spec_review`; `spec`; `complete`.
- **Admit rows** (AC-1, AC-4): add a `name` + `options` row for each implement sub-state. Code_review stays `pending` with `verdict: ''` except in the loop-cap row; qa stays `pending`.
  - `implement in_progress`
  - `implement blocked`
  - `implement-entry loop-cap auto-block (implement pending, code_review blocked, verdict '')`, with counters `iterations_current_loop: 3`
  - `route-back after code_review changes_requested (iterations_current_loop 1)`
  - `route-back after pre-flight rejection (preflight_rejections_current_loop 1)`

  Relabel the existing `code_review blocked changes_requested` row as `code_review-phase auto-block (code_review blocked, verdict changes_requested)` and keep it.
- **Entry-phase assertion:** give each row an `entryPhase` and assert `derivePhase(status)` equals it before calling `runReroute` (patterns.md "Prove each regression test can fail").
- **AC-5 assertions for every admit row:** code_review `pending`, verdict `''`, `iterations_current_loop` 0, `preflight_rejections_current_loop` 0, implement `rerouted: true`, `reroute_count` 3 (from 2), and `derivePhase(updated) === 'spec_review'` (M, full tier).
- **Fast-tier loop:** run the five implement admit states with `taskSize: 'XS', delicate: false` and assert `derivePhase(updated) === 'implement'`.
- **Reject rows:** rename `implement pending` to `implement pending with counter fields absent`. Add `implement pending with zero current-loop counters`, with code_review `{ status: 'pending', verdict: '', iterations_current_loop: 0, preflight_rejections_current_loop: 0 }`. The existing byte-unchanged assertion covers both.
- **Bundles (AC-2):**
  - (a) implement `blocked` + implement `pending`/zero: rejected, neither status changed, stderr names both states.
  - (b) implement `in_progress` + `human_review`, both amended: admitted, banner shows `task-a: implement in_progress` and `task-b: human_review`.
  - (c) `makeCodeReviewBlockedStatus('task-a', …, 'spec_gap')` + loop-cap `task-b`. First amend only task-a: rejected, stderr names `task-b:` (in exempt mode task-b would have been skipped), statuses unchanged. Then amend both: admitted, and task-b's status has no `reroute_exempt`.
- **Operator text (AC-6a/b), opposite-outcome pair:**
  - Admitted loop-cap: banner matches `/implement pending \(code_review blocked/`, stdout doesNotMatch `/requires implementation to have begun/`.
  - Admitted `in_progress`: banner matches `/implement in_progress/`.
  - Rejected implement-pending/zero: stderr matches `/'task-a': implement pending \(code_review pending\)/` and the full rule (`/implementation to have begun/`, `/in progress or blocked/`, `/a blocked code review/`, `/code review already run in the current loop/`), stdout doesNotMatch `/Rerouting:/`.

**7b. `tests/run-task-code-review.test.ts`** (AC-6c): in `review-loop recovery reasons…`, for both `codePending.reason` and `codeDone.reason`, assert they match `/add the next Amendment section.*canon run task-a --reroute/` and still match `/canon task reset-code-review task-a/`. Assert `specPending.reason` doesNotMatch `/--reroute/`; the spec loop cap stays unchanged.

**7c. `tests/task-cli.test.ts`** (AC-7)
- Update `:700` to `/will not fire on this pass.*full-tier.*once implementation has begun.*code_review, qa, or human_review.*implement/`.
- Add a loop over the five implement admit states, with spec, spec_review, and plan `done`. Each must print `/full-tier reroute.*canon run --reroute <id>/`.
- Add implement `pending` + zero counters, with spec, spec_review, and plan `done`, which must print the "will not fire" text with the new rule and doesNotMatch `/canon run --reroute/`.

**7d. `tests/recovery-hints.test.ts`** (AC-11)
- `HINT_SITES` updates:
  - Replace the `cli.ts` snippet with the new first help line, `'  --reroute           Reset a task once implementation has begun: current phase code_review,',` (exempt, usage/help).
  - Replace the `main.ts` rejection snippet with the new first line (exempt, descriptive).
  - Delete the `src/task/index.ts` entry for `// \`canon run --reroute\` is accepted.`; the comment is gone.
  - Add the `review-loop.ts` `--reroute` clause line as **actionable**, covering `implement entry` → "code loop cap at implement entry: the printed reroute is accepted" and `code_review entry` → "code loop cap at code_review entry: the printed reroute is accepted". It is a real next-step recovery command, so the registry's actionable class applies.
  - Add covers to the spec-gate-note actionable entry for `implement in_progress`, `implement blocked`, `implement loop-cap`, and `implement route-back`, all pointing at the new test below.
- **New chained tests**, modelled on `code loop cap at code_review entry: the printed reset-code-review is accepted`:
  - **Implement entry.** Fixture `fixtureTask(cwd, id, 0, '')` with implement `pending` and code_review `{ status: 'pending', verdict: '', iterations: 3, iterations_current_loop: 3, iterations_total: 3, preflight_rejections_current_loop: 0 }`.
    1. Run `runLoopCap(cwd, tasks, id, 'implement')`; expect exit 2.
    2. Assert the persisted state is implement `pending` + code_review `blocked`.
    3. Extract `/canon run [\w-]+ --reroute/` from the escalation reason and assert it is in the run output.
    4. Append `## Amendment` to the spec and run `runPrinted(command, cwd, tasks, id)` (default `--expect spec_review`); expect exit 0.
    5. Assert implement `rerouted: true`, `reroute_count` 1, and spec_review `done` (fake codex).
  - **Code_review entry.** The same flow from the existing code_review-entry fixture.
  - **Spec-gate note at implement.** "spec gate done note: the printed reroute is accepted and the armed gate fires from implement once implementation has begun". Mirror the existing spec-gate-note test, with spec, spec_review, and plan `done`, for implement `in_progress`, implement `blocked`, the loop-cap state, and route-back (`iterations_current_loop: 1`). Assert `derive(...) === 'implement'`, the note's `canon run --reroute <id>` exits 0, stdout matches `/SPEC GATE/`, and `human_spec_gate` ends `false`.

**7e. `tests/run-task-prompts.test.ts` + golden** (AC-9, AC-10)
- Add `void test('promptImplementReroute_resumed', …)` rendering `promptImplementReroute(rerouteState, true, [], 'main')` → `recordOrAssert('promptImplementReroute_resumed', …)`.
- Add a structural test over the non-resumed render, the resumed render, and `promptPlan` reroute round 1. Use the existing call shape for the `promptPlan_reroute_round1` key. Match each clause as one phrase (patterns.md "Prove each regression test can fail"):
  - (a) `/may be complete or partial/`
  - (b) `/amendment plus any unfinished work from the original ACs and earlier amendment rounds/` and a newest-wins phrase
  - (c) `/git diff/` plus `/only if it has been filled in/`
  - (d) implement only: `/every file this task has changed/`
  - Assert each render doesNotMatch `/ignore prior-round sections/i`, `/already addressed by the previous implementation/`, and `/Plan only the delta/`.
  - Assert the human-decision framing `/A human (decided|amended)/` is still present, including in the spec_review reroute render.
- Regenerate: `UPDATE_GOLDENS=1 node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-prompts.test.ts`, then re-run without the env var.
- Key-level compare for the handoff:
  ```bash
  git show <base-sha>:tests/run-task-prompts.golden.json > /tmp/golden-base.json
  node -e 'const a=require("/tmp/golden-base.json"),b=require("./tests/run-task-prompts.golden.json");const k=new Set([...Object.keys(a),...Object.keys(b)]);for(const x of k){if(!(x in a))console.log("added",x);else if(!(x in b))console.log("removed",x);else if(a[x]!==b[x])console.log("changed",x)}'
  ```
  The expected output has exactly these lines and nothing else:
  - `added promptImplementReroute_resumed`
  - `changed promptImplementReroute`
  - `changed promptSpecReview_reroute_round1`, `changed promptSpecReview_reroute_round2`, `changed promptSpecReview_reroute_bundle`
  - `changed promptPlan_reroute_round1`, `changed promptPlan_reroute_bundle`

### Step 8: Docs, skill, README, decision

Files: `docs/pipeline-orchestrator.md`, `.claude/skills/canon-pipeline/SKILL.md`, `docs/patterns.md`, `docs/decisions.md`, `README.md`

All rule restatements use one operator-terms phrasing: "once implementation has begun — current phase `code_review`, `qa`, or `human_review` (any status or verdict), or `implement` when implement is in progress or blocked, its code review is blocked, or a code review already ran in the current loop". No `src/` paths go in the two canon-managed files (`scripts/sync-canon-templates.mjs` rejects them).

- `docs/pipeline-orchestrator.md`:
  - Line 98 flags row: replace the predicate and drop "back into the post-review fix path".
  - §Human Reroute opening (`:485`): the full predicate. Add that implement `pending` with no code-review activity in the current loop is rejected as a spec or plan revision, as are `spec`, `spec_review`, `plan`, and a completed task. Replace "compare against prior artifacts, and update only the delta" with "establish current state from the worktree, and implement the amendment plus any unfinished earlier work".
  - Full-tier paragraph (`:491`): "regardless of which admitted state the task was rerouted from, including an `implement` entry". Drop the `(code_review, qa, or human_review)` parenthetical.
  - Uncommitted-state paragraph (`:495`): "Rerouting from an `implement`, `code_review`, or `qa` `pending`/`in_progress` entry…". Add: "An implement-entry reroute also leaves the aborted round's uncommitted source edits in the worktree; the next implementation round picks them up and must list every dirty file in its handoff Changes table, or auto-commit refuses to commit." Do not rename the `## Human Reroute` heading.
- `.claude/skills/canon-pipeline/SKILL.md` §6 line 150: "`--reroute` is allowed once implementation has begun: …predicate…. A task with a plan but no implementation started in the current loop is rejected." Leave the §6 heading alone.
- `docs/patterns.md` §"Operator git surgery before first QA…" (`:136`): change "it admits `code_review` and `qa`-pending entry states … both of which sit before the QA-end commit" to cover implement-entry states too ("all of which sit before…"). Add the sentence that an implement-entry reroute leaves the aborted round's uncommitted source edits in the worktree. This file is root-only, so it has no mirror row (patterns.md §"Declare `templates/` mirrors…").
- `README.md:97` and `:278`: the same predicate; drop "back into the post-review fix path".
- `docs/decisions.md`: append `## \`--reroute\` is admitted once implementation has begun (2026-10)` in the existing **Decision** / **Why** / **Rule** shape.
  - **Decision:** the predicate.
  - **Why:**
    - It reverses the "No reroute from `implement`" Non-Goal in `tasks/_archive/relax-reroute-gate-post-implement/spec.md`.
    - The hand-mark workaround fakes phase history into the same half-written worktree.
    - Route-back and loop-cap states rest at implement entry.
    - `guardConcurrentRun()` already refuses a live run.
  - **Rule:** implement `pending` with no current-loop review activity stays rejected; prompts stay phase-neutral and scope each round as amendment plus unfinished work; no entry-phase field.
- Run `npm run sync-templates` and then `npm run sync-templates:check`. Declare both mirrors in the handoff Changes table: `templates/docs/pipeline-orchestrator.md` and `templates/.claude/skills/canon-pipeline/SKILL.md`.

### Step 9: Build, sweep, validate

1. `npm run build`. Expect `dist/cli/index.js` and `dist/orchestrator/run-task.js` to change; no other `dist/` file should.
2. Run the AC-8 greps and record the results in the handoff:
   ```bash
   grep -rniE 'completed .?implement|previously shipped|implementation shipped|complete and shipped|post-review fix path|admitted phase \(.?code_review.?, .?qa.?, or .?human_review.?\)' src docs .claude templates README.md dist | grep -vE '^docs/(task-quality-log|lessons-learned|pipeline-invocations|BACKLOG)\.md'
   grep -rniE 'code_review.?, .?qa.?, or .?human_review' src docs .claude templates README.md dist | grep -vE '^docs/(task-quality-log|lessons-learned|pipeline-invocations|BACKLOG)\.md'
   ```
   - The first grep must be empty.
   - Classify every hit of the second in the handoff. Expected hits include the new rule sentences in `main.ts`, `task/index.ts`, and `cli.ts`, plus the docs; each restates the full predicate.
   - `dist/orchestrator/run-task.js` will hit through the same strings; classify them the same way.
3. Full validation: `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (then `git status --porcelain dist/` shows only the intended rebuild), `npm run sync-templates:check`, `npm run docs-refs-check`.
4. In a Claude-created worktree, one known unrelated failure may appear. Only call a failure pre-existing after checking it against base.

## Testing Plan

- **Unit**
  - Predicate table (Step 7a).
  - Loop-cap reason text (7b).
  - Spec-gate note branches (7c).
  - Prompt structure and golden (7e).
- **Integration (subprocess)**
  - Admit/reject matrix with byte-unchanged rejection.
  - AC-5 reset assertions, full and fast tier.
  - Bundles (7a).
  - Chained hint tests from loop-cap emission through to an accepted reroute, and spec-gate note → reroute (7d).
- **E2E**: N/A (no UI).
- **Manual**: the spec's Human Test Plan. Items 1-3 depend on a live stopped/blocked run.

## Rollback Plan

This is a pure revert. No `status.json` field is added or reinterpreted (spec Data Model Changes: none). A task rerouted from implement under the new gate is left in an ordinary rerouted state (implement `pending`, `rerouted: true`). The old code handles that state, so a revert strands nothing. Reverting restores the narrower gate and the old prompt and doc wording together; golden and `dist/` revert with them.

## Unattended-session notes

- Nobody was available to ask. No question blocked the plan.
- Two judgment calls are recorded here and in `notes.md`:
  - The new loop-cap `--reroute` line is registered as **actionable**, with chained covering tests rather than exempt.
  - The predicate follows the spec's letter and ignores the legacy `iterations` alias.

## Reroute Plan

### Delta

This round's scope is the round-1 amendment (AC-A1–AC-A9). Round 1 finished: `e8c2d12` implemented every original AC, code review approved it with nits, and QA completed (`f17a1d5`). The worktree has no aborted-round source edits; the only dirty files are under `tasks/reroute-from-implement/`. No original-AC work is unfinished, so Steps 0–9 of the base plan are already implemented and are not re-planned. The amendment spec review was `approved` with no nits.

The section is headed `### Delta` because the running engine's plan-reroute prompt still uses that name. AC-A4/N3 renames the heading only in the dev template, for future rounds. Don't treat the mismatch as a defect.

**Feasibility check**
- **Exists:** confirmed by search:
  - `isRerouteAdmitted()` and `currentLoopCount()` in `src/orchestrator/state.ts:442-457`.
  - `describeRerouteEntryPhase()` (`src/orchestrator/main.ts:2788`), called from the rejection summary at `:2821` and the banner at `:2888-2890`. `getIterations()` (`:158-161`) already applies `iterations_current_loop ?? iterations`.
  - Non-resumed preamble at `src/orchestrator/prompts/index.ts:472`. The feasibility pointer `'at the top of the appended \`### Delta\` section'` is at `:297`.
  - `implement-reroute.md` lines 22 (step 7) and 28 (red-first checkpoint); `plan-reroute.md` append shape at lines 26-31.
  - `--reroute` help at `src/orchestrator/cli.ts:52-56` and `specGateDoneNote()` at `src/task/index.ts:1546-1555`.
  - `implementEntryRows` / `admittedStateRows` / `rejectedStateRows` in `tests/run-task-reroute-preflight.test.ts:940-1101`. The startsWith phase derivation is at `:1017`; the prefix-only banner assertion is at `:1036-1039`.
  - HINT_SITES first entry at `tests/recovery-hints.test.ts:14-21`, with single-quoted keys and two stray blank lines. Every other entry uses `"key":` quoting.
  - Double blank at `docs/decisions.md:492-493`.
  - Rescope paragraph at `docs/pipeline-orchestrator.md:417-424`; Human Reroute leftover sentence at `:493`.
  - `docs/patterns.md:136`, `recovery.md:18-38` ("Two paths"), and `README.md:278`.
- **Real path:** `canon run --reroute` → `rerouteFromHumanReview()` → `isRerouteAdmitted()`. On rejection, `describeRerouteEntryPhase()` builds the summary; on admission, it builds the banner. The reroute reset (`main.ts:~2985`) zeroes both `iterations_current_loop` and `iterations`. Auto-commit behavior was checked for AC-A1:
  - `findUncoveredTrackedChanges()` (`src/orchestrator/validation.ts:779-791`) skips `??` entries. A modified tracked file that the handoff omits aborts the commit; an untracked file is staged only if the handoff lists it.
  - A leftover untracked file then dies at the QA-end check (`main.ts:~1109`, "QA-end commit aborted … Source or test edits must be committed during the implement phase").
- **Callers:**
  - `isRerouteAdmitted()` is called by `rerouteFromHumanReview()` and `specGateDoneNote()`. Both inherit the N6 fallback, which is intended: the spec-gate note should advise `--reroute` for a legacy state the gate now admits.
  - `describeRerouteEntryPhase()` is called only inside `main.ts`, at the three sites above.
  - `currentLoopCount()` keeps its contract; it is called by the predicate and by `describeRerouteEntryPhase`.
  - Every current writer that zeroes the counter writes both fields: `src/task/index.ts:427-428` and `:1172-1178`, and the reroute reset. A status with `iterations > 0` and `iterations_current_loop` absent therefore exists only before migration. The fallback cannot admit a freshly reset state.
- **Tests that can fail:**
  - N6 row: implement `pending`, code_review `{ status: 'pending', verdict: '', iterations: 1 }`, no current-loop fields. Today it is rejected (exit 1, "requires implementation to have begun"), and `isRerouteAdmitted` returns false. The amendment spec review confirmed this with a probe.
  - N9 rows: a status with `phases.code_review` deleted renders `code_review pending` today, so a `code_review missing` assertion fails.
  - N8: the detail-clause assertions fail if the clauses are dropped or misworded. They pass pre-fix for the current-field rows; that is fine, since N8 is a pin, not a bug fix.
  - N7 is a refactor of the assertion and has no red run.
- **Predicates:**
  - Use `codeReview?.iterations_current_loop ?? codeReview?.iterations` before `currentLoopCount`. With `??`, an absent or `null` current-loop field falls back; a present `0`, `-1`, `'1'`, `NaN`, or `Infinity` does not fall back and still yields 0.
  - Rows that must still reject:
    - The existing invalid-counter tests (`:1146-1152`, which set no `iterations`).
    - "implement pending with absent counters" (no `iterations` in `makeRerouteStatus`'s code_review default).
    - "implement pending with zero counters".
  - `iterations: 0` with no current-loop field gives 0 and rejects.
  - `preflight_rejections_current_loop` has no legacy alias, so it is unchanged.
- **Scope:** every file below is in the amendment Affected Files except `tests/run-task-prompts.test.ts`. Its `/### Delta/` assertions (`:353`, `:728`) must follow N3. That file is in the original `### Affected Files` table (spec line 107), so the union covers it. Logged `[plan]` in notes.md. Separately, `parseAllTablesH3` (`src/orchestrator/markdown-table.ts:173`) reads only the **first** `### Affected Files` H3. `.claude/skills/canon-pipeline/recovery.md` and `templates/.claude/skills/canon-pipeline/recovery.md` appear only in the amendment table, so Affected-Files-driven gates (`--pr` base drift, the human_review allow-list) won't see them. That is a spec-shape issue for the human to settle before `--pr`, not one to fix here. Logged `[plan]`.
- **Async/stateful:** N/A. The predicate is pure, and no new status writes are added.

**Step R0 — Red-first for AC-A6 (before any `src/` edit).**
1. Add a standalone admitted row in `tests/run-task-reroute-preflight.test.ts`: `legacy iterations alias without current-loop field (implement pending, code_review pending)`, with options `{ implement: { status: 'pending' }, codeReview: { status: 'pending', verdict: '', iterations: 1 }, qa: { status: 'pending' } }` and `expectedPhase: 'implement'`. Put it in `admittedStateRows` directly, **not** in `implementEntryRows`. That array's `.map` (`:953-957`) injects `iterations_current_loop: 0`, which would suppress the fallback and make the row reject for the wrong reason.
2. Run `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='legacy iterations' tests/run-task-reroute-preflight.test.ts` against `f17a1d5` plus the test-only edit. Expected failures:
   - the M and XS `rerouteFromHumanReview admits …` tests, with exit 1 and stderr naming `'task-a': implement pending (code_review pending)`;
   - `isRerouteAdmitted … : true`.
3. Record the failing run as a Red-First Evidence row (AC-A6). The worktree is clean of non-test leftovers, so committed HEAD is the isolated pre-fix state.

**Step R1 — N6 fallback (`src/orchestrator/state.ts`, `src/orchestrator/main.ts`).** Export one helper from `state.ts` so the predicate and the describer can't diverge, e.g. `currentLoopReviewRounds(codeReview)` = `currentLoopCount(codeReview?.iterations_current_loop ?? codeReview?.iterations)`. Update its comment to mention the legacy alias. Use it in `isRerouteAdmitted` and in `describeRerouteEntryPhase` (`main.ts:2794`). Re-run R0's command; it should pass. Record the post-fix result in the same evidence row.

**Step R2 — N9 `missing` (`src/orchestrator/main.ts:2792`).** In `describeRerouteEntryPhase`'s implement branch, change `codeReview?.status ?? 'pending'` to `?? 'missing'`. This matches the non-implement summary at `:2823`. Leave implement's own `?? 'pending'` unchanged: an implement-phase task can have `phases.implement` absent, since `deriveTopLevelStatus` treats a missing phase as pending, and the AC names only code_review.

**Step R3 — Tests (`tests/run-task-reroute-preflight.test.ts`): N7, N8, N9.**
- **N7:** give every `admittedStateRows` entry an explicit `expectedPhase` field (type it like `rejectedStateRows`).
  - The five implement rows and the legacy row: `'implement'`.
  - The human_review row: `'human_review'`.
  - The two qa rows: `'qa'`.
  - The rest: `'code_review'`.

  Replace the `startsWith` chain at `:1017` with `assert.equal(derivePhase(status), expectedPhase)`, and branch on `expectedPhase === 'implement'` at `:1036`. The predicate loop at `:1138` destructures only `name`/`options`, so it needs no change.
- **N8:** add an optional `bannerDetail?: RegExp` per implement row and assert `result.stdout` matches it:
  - route-back: `/\(code_review pending, 1 review round this loop\) →/`
  - pre-flight: `/\(code_review pending, 1 pre-flight rejection this loop\) →/`
  - legacy: `/\(code_review pending, 1 review round this loop\) →/`
  - loop-cap: `/\(code_review blocked\) →/`

  Also add one direct plural case: a route-back with `iterations_current_loop: 2` and `preflight_rejections_current_loop: 3` must produce `2 review rounds this loop, 3 pre-flight rejections this loop`. Add it as a further admitted row with an `expectedPhase` and a `bannerDetail`.
- **N9:** two tests built from `makeRerouteStatus(...)` with `delete (status.phases as Record<string, unknown>).code_review`.
  - (a) Rejected: implement `pending`, qa `pending`. Assert stderr matches `/'task-a': implement pending \(code_review missing\)/` and status.json is byte-unchanged.
  - (b) Admitted: implement `in_progress`, with `## Amendment Round 3` (rerouteCount 2) written. Assert stdout matches `/Rerouting: implement in_progress \(code_review missing\) →/`. The reset loop guards `if (codeReview)`, so assert exit 0 too. If exit is non-zero for an unrelated downstream reason, assert only the banner and record why in the handoff. Don't widen scope to fix it.
- The legacy row (R0) also gets the existing AC-5 reset assertions automatically via the admitted loop.

**Step R4 — N4 operator text (`src/orchestrator/cli.ts`, `src/task/index.ts`, `tests/task-cli.test.ts`).**
- `cli.ts:54`: `'                      its code review is blocked, or a code review already ran in the current loop'` becomes `... in the current loop (a review round or a pre-flight rejection).`. Re-wrap across lines 53-55 to keep the help column width. Don't change line 52: `tests/recovery-hints.test.ts:62` pins it as an exempt snippet.
- `src/task/index.ts:1554`: append ` (a review round or a pre-flight rejection)` after "already run in the current loop".
- `tests/task-cli.test.ts:675` and `:724`: extend the regexes with `\(a review round or a pre-flight rejection\)` so the qualifier is pinned. Both still match after the edit; before the edit, they fail on the new tail.

**Step R5 — Prompt templates (`src/orchestrator/prompts/templates/implement-reroute.md`, `plan-reroute.md`, `src/orchestrator/prompts/index.ts`).**
- **implement-reroute.md step 7 (AC-A1, N1):** replace "including the round-1 work that still applies plus the new amendment work" with "including earlier work that still applies, any unfinished work from the original ACs and earlier amendment rounds, and this round's amendment work". Replace the clause "canon's auto-commit refuses to commit a dirty file the table omits" with: "a modified tracked file the table omits blocks canon's auto-commit, while an untracked file is committed only if the table lists it — otherwise it is left out of the commit, unseen by code review, until the QA-end check rejects it. Delete leftovers from an interrupted round that the amendment makes obsolete rather than listing them." Keep "Carry existing Red-First Evidence rows forward." (pinned at `tests/run-task-prompts.test.ts:413`).
- **implement-reroute.md red-first checkpoint (AC-A3):** rewrite the paragraph's trigger and pre-fix definition and keep its confirmation contract.
  - **Trigger:** "if the amendment adds or modifies a red-first regression-test AC, or an original or earlier-round red-first AC is unfinished because the prior round was partial".
  - **Prior evidence:** "Keep any carried-forward Red-First Evidence row that already satisfies its AC; do not re-run it."
  - **Pre-fix state:** "the task branch's committed HEAD. If the worktree already holds aborted-round edits, set the non-test leftovers aside (for example, a temporary WIP commit on a scratch ref, or copy them out — never a bare `git stash`), run the red test against that isolated state, then restore them before applying the fix. Difficulty isolating the edits is not grounds for skipping the red run."
  - Keep the existing `[wrong-premise]` Blocker sentence and the environment-bound escape sentence. Add: "If no isolated pre-fix run is possible and the spec names no environment-bound escape, record a `[wrong-premise]`-style Blocker and do not implement the fix on an unconfirmed premise."
  - The worktree note matters: the environment section warns that the stash stack is shared across worktrees, so steer the agent to a non-stash mechanism. Wording is Codex's call within that constraint; the sentence must stay adopter-generic (no canon-ai paths).
- **index.ts:472 (N2):** "This is **not** a resume of an interrupted session." becomes "This is a fresh agent session, **not** a resume of your interrupted one — that refers to the session, not to whether the prior implementation round finished." It can be shorter, but it must say *session* explicitly.
- **plan-reroute.md (N3):** rename `### Delta` to `### Round Scope` in the append-shape comment (line 28). In `index.ts:297`, change the pointer to `'at the top of the appended \`### Round Scope\` section'`. Leave the `## Reroute Plan` / `## Reroute Plan Round N` headings untouched (`src/orchestrator/validation.ts:322` parses them). Update `tests/run-task-prompts.test.ts:353` and `:728` from `/### Delta/` to `/### Round Scope/`, and add `assert.doesNotMatch(..., /### Delta/)` at `:353`.

**Step R6 — Golden (`tests/run-task-prompts.golden.json`).** Run `UPDATE_GOLDENS=1 node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-prompts.test.ts`, then re-run without the env var. Run the base plan's Step 7e key-compare script with `git show e8c2d12:tests/run-task-prompts.golden.json` as the base. Expected `changed` keys: `promptImplementReroute`, `promptImplementReroute_resumed`, `promptPlan_reroute_round1`, and `promptPlan_reroute_bundle`. There should be no `added` or `removed` keys and no non-reroute key. If a spec-review reroute key changes, something outside scope moved; investigate it rather than accept it. Paste the output into the handoff (AC-A9).

**Step R7 — Docs and skill (AC-A1, AC-A2, N5, N10).**
- **`docs/pipeline-orchestrator.md:493`:** replace "the rewritten handoff's Changes table must cover them so auto-commit can account for every dirty source file" with the tracked/untracked wording from R5, plus "delete leftovers the amendment makes obsolete rather than listing them".
- **`docs/pipeline-orchestrator.md:417-424` (rescope paragraph):** keep both reset commands. After the closing sentence, add an operator-terms paragraph:
  - "A `code_review` loop-cap block means implementation has begun, so if the spec itself must change, add the next Amendment section and run `canon run <id> --reroute` instead of resetting."
  - "A `spec_review` loop-cap block is not admitted by `--reroute`: revise the spec and resume, raise the cap, or run `reset-spec-review`."
  - No `src/` paths: `scripts/sync-canon-templates.mjs` rejects `src/orchestrator/` in managed files.
- **`.claude/skills/canon-pipeline/recovery.md:18-38`:** replace "Two paths:" with a per-block count, e.g. "Three paths. A and B apply to either block; C applies only to a `code_review` block."
  - Path B: add the `canon task reset-code-review <task-id>` variant next to the existing `reset-spec-review` line.
  - Add **Path C — spec change after a `code_review` loop-cap block:** append the next `## Amendment` / `## Amendment Round N` section to `tasks/<id>/spec.md`, then `canon run <task-id> --reroute`.
  - Add one sentence that a `spec_review` block isn't reroutable, so the spec is revised normally and resumed, or handled via A/B.
  - Line 7's TOC entry stays.
- **`docs/patterns.md:136`:** replace "the next handoff's Changes table must include them" with the tracked/untracked distinction: a tracked omission blocks auto-commit; an untracked omission is skipped until the QA-end check; obsolete leftovers should be deleted.
- **`README.md:278`:** split into two sentences so "after appending…" can't attach to the pre-flight-rejection parenthetical: "Reset a task once implementation has begun: … (a review round or a pre-flight rejection). Requires an `## Amendment` section appended to `spec.md` first; full-tier re-enters at `spec_review`, fast-tier at `implement`."
- **`docs/decisions.md:492-493`:** collapse to one blank line.
- **`tests/recovery-hints.test.ts:14-21`:** requote the keys as `"file"`, `"snippet"`, `"kind"`, `"covers"`, `"state"`, `"test"` to match the other entries, and remove the two blank lines after `},`. The snippets themselves are unchanged: R4 doesn't touch `cli.ts:52`, and the `main.ts:2828` rejection snippet first line doesn't change. Re-run the file to confirm no registry drift. R7 adds `--reroute` to `recovery.md`, which is outside `src/`; HINT_PATTERN scans `src/` only.
- **Spec supersession (AC-A1, last sentence):** the spec's Known Risks / Non-Goals / Interaction Dependencies overstatements are declared superseded by the amendment itself. Don't edit `spec.md`.
- Run `npm run sync-templates`, then `npm run sync-templates:check`. Declare `templates/docs/pipeline-orchestrator.md` and `templates/.claude/skills/canon-pipeline/recovery.md` in the handoff Changes table.

**Step R8 — Build and validate (AC-A9).**
1. Run `npm run build`. Only `dist/cli/index.js` and `dist/orchestrator/run-task.js` should change.
2. Re-run the base plan's Step 9 AC-8 greps. The first must still be empty. Classify the second grep's new hits from the N4 qualifier edits.
3. Then run `npm run lint`, `npm run type-check`, `npm test`, `npm run sync-templates:check`, and `npm run docs-refs-check`.
4. Rewrite `handoff.md` in full. Carry the two AC-1 Red-First Evidence rows forward and add the AC-A6 row. Add an AC-A1–A9 coverage table. List every changed file, including both mirrors and both dist bundles.

## Reroute Plan Round 2

### Delta

This round's scope is Amendment Round 2 (AC-B1–AC-B9). The original ACs and the round-1 amendment (AC-A1–AC-A9) were fully implemented and committed in `80b7023`. The round-1 post-reroute code review (archived as `review-prior-2.md`) found no failing AC: it returned one spec gap (now AC-B1) and eleven nits (now AC-B2–B8). The worktree holds no aborted-round source edits; the only dirty files are under `tasks/reroute-from-implement/`. Base Steps 0–9 and round-1 Steps R0–R8 are therefore done and are not re-planned. Committed HEAD `80b7023` is the isolated pre-fix state for this round's red runs. The amendment review approved with no findings. Its two `[ambiguity]` readings are adopted below: B1 supersedes the blanket zero-counter bundle exclusion only for matching-branch siblings (Step R2-5), and full-rule restatements must carry the bundle exception (Step R2-6).

This section is headed `### Delta` because the running engine's plan-reroute prompt still uses that name; the dev template's `### Round Scope` rename (AC-A4/N3) is unaffected.

**Feasibility check**
- **Exists:** confirmed by search:
  - `isRerouteAdmitted()`, `currentLoopCount()`, and `currentLoopReviewRounds()` are at `src/orchestrator/state.ts:441-462`. `validateStatus()` (`:410-420`) rejects any present counter that is not a non-negative integer, `null` included, on every `readStatus` path.
  - In `src/orchestrator/main.ts`:
    - `getIterations()` is at `:158-161` and applies the raw `iterations_current_loop ?? iterations ?? 0` chain.
    - `buildPipelineState()` repeats the chain at `:223`.
    - `phaseIterationCount()` is at `:3551-3556`. It is generic and out of scope per B6.
    - `describeRerouteEntryPhase()` is at `:2788-2805`; its implement branch uses `?? 'pending'` at `:2791`.
    - `rerouteFromHumanReview()` is at `:2808`. Its gate is `allAdmitted = entryStatuses.every(isRerouteAdmitted)` at `:2816`, and its rejection is at `:2817-2832`.
  - The rejection's first line is pinned as an exempt snippet at `tests/recovery-hints.test.ts:108`, and its rule wording at `tests/run-task-reroute-preflight.test.ts:1151-1152`.
  - In `src/orchestrator/prompts/index.ts`:
    - The non-exempt task lines are at `:290` (`promptPlan`) and `:467` (`promptImplementReroute`).
    - `priorReviewReference()` is at `:499-504` and is reached only from the exempt branches (`:228`, `:462`).
    - The non-resumed preamble is at `:472`.
  - `findNewestReviewArchive()` (`src/orchestrator/review-archive.ts:89`) selects archives numerically. It calls `fs.readdirSync` unguarded, so it **throws ENOENT on a missing task dir**.
  - The red-first set-aside sentence is at `src/orchestrator/prompts/templates/implement-reroute.md:28`.
  - Downstream gates: `verifyHandoffAgainstDiffFromData()` (`src/orchestrator/validation.ts:1504`), `buildAffectedFilesAllowlist()` (`:1581`), and `verifyBaseDriftFromData()` (`:1606`). `src/orchestrator/phases/code-review.ts:321,368-373` uses the last two.
  - `ensureBranch()` writes the shared branch, per the amendment and its review probe.
  - `validateBranchField()` (`src/orchestrator/state.ts:385-399`) accepts `''` and whitespace-only branches.
  - Test fixtures: `makeRerouteStatus(taskId, branch, …)` (`tests/run-task-reroute-preflight.test.ts:57`) takes an explicit branch. The bundle scenarios at `:1229-1257` give each task its own `task/<id>`, so the AC-2(a) reject row keeps rejecting under B1.
  - Docs, skill, and help surfaces:
    - SKILL.md §6 heading is at `.claude/skills/canon-pipeline/SKILL.md:148` and its rule at `:150`. No file links to the heading text.
    - recovery.md Path B is at `:27`.
    - `docs/pipeline-orchestrator.md` §Human Reroute rule is at `:487`; "Archived findings remain binding; exempt-sibling prompts point …" is at `:497`.
    - The decision entry is at `docs/decisions.md:493-499`.
    - Help is at `src/orchestrator/cli.ts:52-58`, the spec-gate note at `src/task/index.ts:1555`, and the README rule at `README.md:97,278`. No surface advises rerouting a subset of a bundle today (grep `subset|split|separately`).
- **Real path:** `canon run <ids> --reroute` → `guardConcurrentRun()` → `rerouteFromHumanReview()`:
  1. It reads every status once into `entryStatuses`.
  2. Then: admission gate → amendment pre-flight (all non-exempt tasks, so a shared-branch sibling needs its own Amendment) → banner → archive → reset loop.
  3. The reset loop already zeroes every named task's counters and sets `rerouted`, so B1 needs no reset change.
  - Prompts: `buildPipelineState()` → `promptPlan()` / `promptImplementReroute()` → per-task lines.
  - Loop-cap checks read `getIterations()` (`main.ts:3588,3673,3800,3859`).
- **Callers:**
  - `isRerouteAdmitted()`'s contract is unchanged. It is still called by the gate and by `specGateDoneNote()`, and B1 is layered on top in `main.ts` only.
  - `getIterations()` has four loop-cap callers, and `buildPipelineState()` is called throughout. Their outputs are unchanged for every `readStatus`-validated status: for non-negative integers the helper returns the same value. `null` and invalid values never reach them, because validation throws first.
  - `src/task/index.ts:412,560` (`entry.iterations_current_loop ??= entry.iterations ?? 0`) are seeding **writers** that normalize the persisted field before incrementing. They are not count consumers, so they stay as they are and get classified in the handoff.
  - `priorReviewReference()` has two exempt callers. Their output is unchanged, except that a missing task dir now falls back to `review.md` instead of throwing.
  - `describeRerouteEntryPhase()` is called only within `main.ts`, at the three sites listed under Exists.
- **Tests that can fail:**
  - **B4 (mandatory red-first).** A non-exempt rerouted task, rendered from its own dir holding `review-prior-2.md` and `review-prior-10.md`. Today both builders' lines omit any archive name, so `assert.match(line, /review-prior-10\.md/)` fails. The amendment review reproduced this with a probe.
  - **B1 admitted row.** Today `every(isRerouteAdmitted)` rejects A, so the test exits 1 with "requires implementation to have begun". The red run is recommended but not mandated.
  - **B2.** Today's rejection has no next-step text.
  - **B7(6).** The updated rule regex fails against the repeated "once implementation has begun" wording.
  - **B7(8).** `implement` deleted → today renders `implement pending`.
  - **B6.** The `null` helper row is a pin: it passes before and after the change. The `getIterations` swap is a refactor with no red run.
  - **B8.** Pins only.
- **Predicates:**
  - **Sibling clause (B1).** A task qualifies through it only when all of these hold:
    - `getCurrentPhase(status) === 'implement'`.
    - `status.phases.implement?.status === 'pending'` **and** `status.phases.code_review?.status === 'pending'`. Both entries must be present; a missing entry never qualifies.
    - `isRerouteAdmitted(status)` is false, which implies zero counters and no blocked review.
    - `branch?.trim()` is non-empty.
    - Some **other** named task j passes `isRerouteAdmitted` and has an equal trimmed branch.
  - **Sibling boundaries:**
    - Branch `undefined`, `''`, or whitespace-only → not eligible.
    - A different branch → not eligible.
    - Two zero-activity tasks on one branch → neither has an anchor → rejected.
    - A single task → no j → rejected.
    - The anchor may be at any single-admitted phase (`code_review`/`qa`/`human_review` or implement-entry).
  - **Review-round helper (B6):** `iterations_current_loop ?? iterations`, then finite-positive.
    - Absent or `null` current-loop → falls back.
    - Present `0`, `-1`, `'1'`, `NaN`, or `Infinity` → no fallback, yields 0.
    - Legacy `iterations: '3'` → 0.
    - Both absent or `undefined` entry → 0.
  - **Archive lookup (B4):** a missing dir or zero archives → no pointer. `review-prior-10` beats `review-prior-2` (numeric).
- **Scope:** every file below is in the union of the three Affected Files tables.
  - `src/orchestrator/cli.ts`, `README.md`, and `tests/task-cli.test.ts` are in the original table only. Under the reviewer's adopted reading, they get the bundle-exception clause.
  - `src/orchestrator/review-archive.ts` is in no table and is **not** edited. The ENOENT guard lives in `prompts/index.ts`.
  - `plan-reroute.md` is in the round-2 table, but its archive pointer goes in the per-task line, which `index.ts` renders. The template needs no edit, because any unconditional template text would violate B4's "say nothing when no archive exists".
- **Async/stateful:**
  - The gate decides from the single `entryStatuses` snapshot before any write, so every rejected row stays byte-unchanged.
  - Live-run exclusion is still `guardConcurrentRun()`.
  - The archive lookup runs at render time. That is intended: a later plain `canon run` still finds the durable archive.
  - No new persisted state.

**Step R2-0 — Red-first (test-only edits on `80b7023`, before any `src/` edit).**
1. Add the B4 tests in `tests/run-task-prompts.test.ts`, following the exempt-archive test at `:365-397`:
   - **With archive:** create `tmpRoot/test-pf-archive` with a `status.json` from `makeReroutedTask('test-pf-archive', 2)`, plus `review-prior-2.md` and `review-prior-10.md`. For both `promptPlan(state)` and `promptImplementReroute(state, false, [], 'main')`, take `outputLineFor(…, 'test-pf-archive')` and assert:
     - it matches `/tasks\/test-pf-archive\/review-prior-10\.md/`;
     - it does not match `/review-prior-2\.md/`;
     - it matches `/remain binding unless/`.
   - **No archive (negative):** a second dir `test-pf-no-archive` with no archive. Assert the line does not match `/review-prior/` or `/archived/i`.
   - Use new task ids so the existing golden fixture (`TASK_ID`, no archive) stays untouched.
2. Run `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='archive' tests/run-task-prompts.test.ts`. Expected: four with-archive assertions fail with the pointer absent, and the no-archive cases pass. Record this as the AC-B4 Red-First Evidence row.
3. Recommended: add the B1 admitted row (Step R2-5) now as well. Run `--test-name-pattern='shared-branch'` and record the exit-1 rejection as a supplementary evidence row.

**Step R2-1 — Single review-round source (B6; `src/orchestrator/state.ts`, `src/orchestrator/main.ts`).**
- Keep `currentLoopReviewRounds()` as the one exported helper. Update its comment: "absent or null current-loop field falls back to legacy `iterations`".
- `getIterations()` becomes `return splitState.currentLoopReviewRounds(status.phases.code_review);`.
- `buildPipelineState()` `:223` becomes `const codeReviewCurrentLoop = splitState.currentLoopReviewRounds(codeReview);`. Leave `codeReviewTotal` alone (different field).
- Leave `phaseIterationCount()` alone, and also the `src/task/index.ts:412,560` seeding writers.
- **Verify:** `grep -nE 'iterations_current_loop \?\? ' src/orchestrator/main.ts src/orchestrator/state.ts src/task/index.ts`. Expected hits: the `state.ts` helper and `main.ts` `phaseIterationCount()` only. Record the output and the classification of the `??=` writers in the handoff.
- **Tests** (`tests/run-task-reroute-preflight.test.ts`): a direct table for `currentLoopReviewRounds`:
  - `{iterations_current_loop: null, iterations: 2}` → 2
  - `{iterations_current_loop: 0, iterations: 2}` → 0
  - `{iterations_current_loop: '1'}` → 0
  - `-1`, `NaN`, `Infinity` → 0
  - `{iterations: '3'}` → 0
  - `{}` → 0
  - `undefined` → 0
- **`docs/decisions.md:495`:** "falling back to legacy `iterations` when the current-loop field is absent or null".

**Step R2-2 — Shared-branch sibling admission and rejection text (B1, B2, B3, B7(6), B7(8); `src/orchestrator/main.ts`).**
- Add a module-local (or exported, for direct tests) `rerouteAdmissions(entryStatuses)` returning one `'qualifies' | 'sibling' | 'rejected'` per task. It computes the single-task results first, then applies the R2 predicate above. The gate becomes `allAdmitted = admissions.every(a => a !== 'rejected')`.
- Don't touch `isRerouteAdmitted` or `specGateDoneNote()`'s use of it.
- **Rejection message:**
  - **First line (B7(6)):** `--reroute requires implementation to have begun on every named task: current phase code_review, qa, or human_review; or implement in progress or blocked, a blocked code review, or a code review already run in the current loop (a review round or a pre-flight rejection).` Update the snippet at `tests/recovery-hints.test.ts:108` to the new first source line, still exempt.
  - **Multi-task (B3):** add the sibling clause in operator terms: "In a bundle, an approved sibling at implement pending with no current-loop activity is admitted alongside a task that qualifies when both record the same task branch." Then list the tasks that qualify and those that do not, e.g. `Qualifying: task-b. Not qualifying: task-a.`, followed by the existing `Current state:` summary. Do not suggest splitting or rerouting a subset.
  - **Single task at implement, not admitted (B2):** append a next step:
    - If `phases.implement.rerouted === true`: "This task is mid-reroute: revise the current amendment in spec.md and run plain `canon run <id>`."
    - Otherwise: "Revise the spec or plan and run plain `canon run <id>`."
    - Judgment call (logged in notes): also add "If it was implemented in a bundle on a shared task branch, name every bundle task in one reroute instead." That covers a secondary member rerouted alone. Keep the literal `--reroute` out of new lines; otherwise register them in `HINT_SITES` (the HINT_PATTERN check fails on any unregistered `src/` line matching `--reroute`).
- **B7(8):** `describeRerouteEntryPhase` `:2791` changes `?? 'pending'` to `?? 'missing'`.
- The banner is otherwise unchanged. A sibling renders `implement pending (code_review pending)`.

**Step R2-3 — Archive pointer (B4; `src/orchestrator/prompts/index.ts`).**
- Add `newestArchivedReview(taskId): string | null`. It wraps `findNewestReviewArchive(taskDirFor(taskId))` in try/catch (ENOENT → `null`) and returns `tasks/<id>/review-prior-<n>.md`.
- Rewrite `priorReviewReference()` as `newestArchivedReview(taskId) ?? \`tasks/${taskId}/review.md\``.
- In both non-exempt lines (`:290` `promptPlan`, `:467` `promptImplementReroute`), when the pointer is non-null, append: ` Prior review findings are archived at <path>; its unresolved findings remain binding unless the amendment supersedes them.` When it is null, append nothing.
- No template edit.
- Re-run the R2-0 command and record the passing post-fix result. The full prompt test file must leave every existing golden for the B4 change byte-identical.

**Step R2-4 — Template wording (B5, B7(1); `src/orchestrator/prompts/templates/implement-reroute.md`, `src/orchestrator/prompts/index.ts:472`).**
- **B5:** in the `:28` set-aside sentence, replace "copy them out to a temporary directory and temporarily restore those paths to their committed contents" with wording that does three things:
  1. Copy tracked non-test leftovers out and restore those paths to their committed contents, and **move** untracked non-test leftovers out of the worktree.
  2. Confirm the set-aside copies exist before the red run.
  3. Restore every set-aside file (tracked and untracked) after the run, before applying the fix.

  Keep "never a bare `git stash`" and the rest of the paragraph verbatim (AC-A3 contract).
- **B7(1):** in the `:472` non-resumed preamble, replace "This is a fresh agent session, **not** a resume of your interrupted one — that refers to the session, not to whether the prior implementation round finished." with "This is a fresh agent session, **not** a resume of a prior session — that refers to the session, not to whether the prior implementation round finished."
- **Existing assertions:** check `tests/run-task-prompts.test.ts` for any that pin "interrupted one" or "committed contents" and update them to the new text.

**Step R2-5 — Reroute tests (B1, B2, B3, B7(6), B7(8), B8; `tests/run-task-reroute-preflight.test.ts`).**
- **B1 rows** go in a new `for` loop named `reroute shared-branch sibling <case>`. They reuse the bundle scenario's fixture pattern: each task's status sits under `worktrees/<id>/tasks/<id>`, and both specs carry `## Amendment`. Fixtures:
  - A: implement `pending`, code_review `{status:'pending', verdict:'', iterations:0, iterations_current_loop:0, preflight_rejections_current_loop:0}`.
  - B: the route-back row options (`iterations_current_loop: 1`).

  Cases:
  1. `admit`: both `branch: 'task/task-a'` → exit 0. Assert both tasks' written status follows the AC-5 reset (implement `pending`, `rerouted: true`, `reroute_count` 1, code_review `pending`, verdict `''`, both counters 0), and the banner names both tasks.
  2. `empty-branch`: A `branch: ''` → rejected.
  3. `whitespace-branch`: A `branch: '  '` → rejected.
  4. `different-branch`: A `task/other` → rejected.
  5. `both-unstarted`: two zero-activity tasks on `task/task-a` → rejected.
  6. `single`: A alone with `task/task-a` → rejected.

  Each rejected case asserts `status.json` byte-unchanged. Case 5 asserts both tasks are listed as not qualifying. Cases 2–4 assert B listed as qualifying and A as not (B3 rejection-text test), and assert stderr doesNotMatch `/split|separately|subset/i`.
- **B1 downstream gates** (same file, in-process): with `CANON_TASKS_DIR_OVERRIDE` pointing at a temp root holding `task-a`/`task-b` specs whose `### Affected Files` list `src/task-a.ts` and `src/task-b.ts` respectively:
  - **Covers both files:** `verifyHandoffAgainstDiffFromData(['task-a','task-b'], { diffFiles: ['src/task-a.ts','src/task-b.ts'], handoffFilesByTask: new Map([['task-a',['src/task-a.ts']],['task-b',['src/task-b.ts']]]) })` → `[]`. Also `verifyBaseDriftFromData(diff, allowlist.paths, ids, allowlist.prefixes)` with `buildAffectedFilesAllowlist(ids, { admittedDocs: [] })` → `[]`.
  - **Opposite outcome:** the same calls with `['task-b']` alone report `src/task-a.ts`. This pins why the bundle must stay whole.
  - Restore the env var in `finally`.
- **B2:** two single-task rejections at implement `pending` / code_review `pending` / zero counters:
  - one with `implement.rerouted: true` → stderr matches `/revise the current amendment.*plain `canon run task-a`/` and does not match `/Revise the spec or plan/`;
  - one without → the reverse.
- **B7(6):** update `:1151-1152` to the new rule sentence and add `assert.doesNotMatch(stderr, /or implement once implementation has begun/)`.
- **B7(8):** take `makeRerouteStatus` with code_review `pending` and `delete phases.implement`. Assert `derivePhase === 'implement'`, the rejection stderr matches `/'task-a': implement missing \(code_review pending\)/`, and status is byte-unchanged.
- **B8:** in the `admit-started` branch at `:1246`, read both written statuses and assert the AC-5 reset fields and `reroute_count` 1 for task-a and task-b. Assert stdout matches `/Rerouting: task-a: implement in_progress \(code_review pending\), task-b: human_review →/`; take the exact form from the banner code at `main.ts:2885-2894`.

**Step R2-6 — Docs, skill, help, README, note (B3, B7(2), B7(7), B4 doc line; reviewer-adopted full-rule reading).**
- **`docs/pipeline-orchestrator.md`:**
  - `:487`: after the rule sentence, add the sibling clause in operator terms. Also add: "Name every task of a shared-branch bundle in one reroute; rerouting part of it fails the downstream handoff and Affected Files checks."
  - `:497`: replace "exempt-sibling prompts point at the archived file instead of the now-absent `review.md`" with: rerouted tasks' prompts point at the newest archive when one exists (exempt siblings still fall back to `review.md` when none does).
- **`.claude/skills/canon-pipeline/SKILL.md`:**
  - `:148`: change the heading to `### 6. Reroute once implementation has begun`, keeping the ordinal.
  - `:150`: add the sibling sentence and the whole-bundle note.
- **`.claude/skills/canon-pipeline/recovery.md:27` (B7(2)):** change the Path B trigger to: "use when the latest review flagged stale context — for a `spec_review` block, phrases that no longer exist in the spec; for a `code_review` block, code or handoff content the review no longer matches — a session-resume staleness artifact".
- **`docs/decisions.md` reroute-from-implement entry:**
  - Decision paragraph: append the sibling clause.
  - Rule paragraph: replace "Keep the all-task bundle gate" with "Every named task must qualify, or be a same-branch sibling of one that does".
  - Add one or two sentences on the declined alternatives: a route-back marker on the approved sibling would change loop-counter semantics, and admitting a sibling without shared-branch evidence would let an unstarted task ride along.
  - Also apply the B6 null wording from R2-1.
- **Bundle-exception clause on the remaining full-rule restatements** (operator terms, no source paths), per the reviewer's adopted reading:
  - `src/orchestrator/cli.ts:55-56`: add a continuation line without the literal `--reroute`, so the HINT registry is unaffected.
  - `README.md:97,278`.
  - `src/task/index.ts:1555`: the "will not fire" note gets a trailing clause such as ", or, in a bundle, alongside such a task on the same task branch". The `tests/task-cli.test.ts:724` regex still matches; extend it to pin the clause.
- **`src/task/index.ts:15` (B7(9)):** sort the import list so `isOrphanedWorktreeState` precedes `isRerouteAdmitted`.
- Run `npm run sync-templates`, then `npm run sync-templates:check`. Declare all three mirrors in the handoff.

**Step R2-7 — Golden, build, validate (AC-B9).**
1. Regenerate goldens: `UPDATE_GOLDENS=1 node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-prompts.test.ts`, then re-run without the env var.
2. Run the key compare against `git show 80b7023:tests/run-task-prompts.golden.json`. Expected: changed `promptImplementReroute` (B5 and B7(1)) and `promptImplementReroute_resumed` (B5); nothing added or removed; every other key byte-identical. A changed plan or spec-review key means B4 leaked into the shared fixture, so investigate it. Record the output.
3. Run `npm run build`; only the two dist bundles may change.
4. Run `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, and `npm run sync-templates:check`.
5. Re-run the round-1 AC-8 greps and the R2-1 B6 grep.
6. Rewrite `handoff.md` cumulatively:
   - Carry forward the three existing Red-First Evidence rows, and add AC-B4 (plus the optional B1 row).
   - Add an AC-B1–B9 coverage table.
   - Include the `??=` writer classification.
   - List every changed file, including the mirrors and both dist bundles.
