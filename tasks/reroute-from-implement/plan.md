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
