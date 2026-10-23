# Implementation Plan: recovery-command-fixtures

> Written by: Claude | Implements: `tasks/recovery-command-fixtures/spec.md`

## Approach

Three parts:

1. **Registry and registry test** in a new `tests/recovery-hints.test.ts`. A pure checker takes an in-memory file map, so AC-3's three red checks run against synthetic input.
2. **Chained fixtures.** Each one reaches the emitting state through `main()`, `checkAndRoute`, or `canon task` code. It parses the command out of the emitted text, fills in placeholders, runs it in a subprocess, and asserts it exits 0 and reaches the promised outcome. The three existing chained tests are changed to take their command from the emitted text.
3. **One source fix (AC-4).** A new exported helper `rerouteAmendmentHeading(status)` in `src/orchestrator/main.ts` becomes the single home of the round/heading rule. `rerouteFromHumanReview`'s pre-flight and both copies of the spec_gap FIX hint use it.

I chose this over a shared clause builder for all hints because the spec rules that out (Non-Goals). A single helper for the one rule that two sites restate follows `docs/patterns.md` §"Build a state-dependent operator message from one parameterized clause builder".

### Feasibility check

- **Exists:** confirmed by grep/read:
  - `verifyRerouteAmendment` is at `src/orchestrator/validation.ts:333`.
  - The inline heading rule is at `src/orchestrator/main.ts:2761-2768`: `requiredRound = reroute_count + 1` and `expectedHeading = requiredRound === 1 ? '## Amendment' : '## Amendment Round N'`.
  - The spec_gap reason is at `main.ts:3718-3724` and its console copy at `main.ts:3743-3752`.
  - `stopForReviewerBlock` is at `main.ts:3502`.
  - The pre-flight auto-block reason is at `src/orchestrator/phases/code-review.ts:342-351`.
  - `buildSpecReviewReason` and `buildCodeReviewReason` are at `src/orchestrator/review-loop.ts:66` and `:94`.
  - `specGateDoneNote` is at `src/task/index.ts:1533`, and the sanctioned redirect is at `src/task/index.ts:372-375`.
  - The `taskCmd` accept parser (`--reason <next arg>`, last positional is the phase) is at `src/task/index.ts:1631-1652`.
  - Test helpers to copy are in `tests/run-task-safety.test.ts`:
    - `withTempDir` :68, `writeTaskStatus` :77, `writeExecutable` :83
    - `setupInvocationLoggingCliTools` :395, `makeReviewLoopStatus` :643, `writeReviewLoopFixture` :698, `runReviewLoopMain` :748
    - `runNodeInline` :803, `runEnsureBranchInline` :847, `childEnvWithoutTasksOverride` :875, `gitIn` :881, `makeGitFixture` :885
    - `makeBootstrappedTaskWorktreeFixture` :974, `makeCompleteStatus` :1404, `combinedOutput` :1618, `prepareReviewEntryMainFixture` :1818
  - `runCheckAndRouteInFixture` is at `tests/run-task-code-review.test.ts:319`.
- **Real path:**
  - spec_gap halt: `checkAndRoute('code_review')` → `case 'code_review'` → `autoBlockPhase` + `process.exit(2)`.
  - `--reroute`: `main()` → `rerouteFromHumanReview` → amendment pre-flight (`main.ts:2752-2793`) → status reset → with `--step`, foreground run of `spec_review` → `checkAndRoute('spec_review')`. That last step is where the armed spec gate fires (`main.ts:3672-3692`).
  - Pre-flight auto-block: `runCodeReviewPhase` → `classifyPreflightBlockers` (a `blocked` result goes to the `blocked` bucket via `isBlockedResult`, `validation.ts:536/642`) → `determinePreflightRoute` returns `auto_block` when nothing is fixable.
  - Already doing part of the work: the reroute pre-flight already computes the correct heading. AC-4 moves that computation into the helper. It does not add a second rule.
- **Callers:**
  - `rerouteAmendmentHeading` is new. Its callers are `rerouteFromHumanReview` (same behavior as before) and the spec_gap hint.
  - No error contract changes.
  - The only consumer of the spec_gap reason text outside `main.ts` is `tests/run-task-code-review.test.ts:467`, which asserts `FIX: .*canon run <ids> --reroute`. The new wording keeps that shape (grep of `src/` for `FIX:` finds no other parser).
- **Tests that can fail:**
  - AC-4 red: a task with `reroute_count: 1` whose spec already has `## Amendment` (from the prior reroute). On pre-fix code the hint says `## Amendment`, the fixture appends that heading, and `--reroute` dies with `expected heading: ## Amendment Round 2`.
  - Other fixtures fail if the hint's command is rejected from its state or does not reach the promised phase.
  - Registry red checks: synthetic inputs (Step 2).
- **Predicates:**
  - `rerouteAmendmentHeading`: `reroute_count` undefined or 0 gives round 1 and `## Amendment`. 1 gives round 2 and `## Amendment Round 2`. This is the same expression as the existing pre-flight, so pre-flight and hint cannot disagree.
  - Registry snippet count per file: 0 means stale, more than 1 means ambiguous, exactly 1 is ok.
  - An actionable entry with empty `covers` fails, and so does an exempt entry with an empty `reason`.
  - A matched `src/` line covered by no snippet is unregistered.
- **Scope:** every file in the steps is in Affected Files: `tests/recovery-hints.test.ts`, `tests/run-task-safety.test.ts`, `tests/run-task-code-review.test.ts`, `src/orchestrator/main.ts`, `dist/orchestrator/run-task.js`, `docs/BACKLOG.md`. The others are only touched if AC-5 fires.
- **Async/stateful:** N/A. All fixtures are subprocess runs over temp dirs. There is no re-entry or cancellation.

### Classification of the 56 matching lines (AC-1)

From `grep -rnE -- '--reroute|reset-code-review|reset-spec-review|canon task accept' src/` on the plan base: 11 actionable, 45 exempt. Line numbers are as of the plan base, and AC-4 rewords two of the actionable lines. The registry keys on snippets, so the implementer takes snippets from the final tree.

**Actionable (11):**

| File:line | Hint | Emitting state(s) → covering test |
|---|---|---|
| `review-loop.ts:72` | `canon task reset-spec-review <id>` (builder) | spec entry, revision not done → existing "main blocks a capped spec loop before revision, re-blocks on resume, and its advertised reset works" (extended); spec_review entry, revision done → new T8 |
| `review-loop.ts:100` | `canon task reset-code-review <id>` (builder) | implement entry → existing "main blocks a capped code loop before implementation side effects, re-blocks, and its advertised reset works" (extended); code_review entry → new T9 |
| `main.ts:3504` | reviewer-block reason `canon task reset-code-review <id>` | code_review set blocked by reviewer → existing "reviewer block covers a mixed bundle, and reset restores the review phase" (extended) |
| `main.ts:3516` | reviewer-block console copy | same |
| `main.ts:3723` | spec_gap FIX reason (`--reroute`) | spec_gap halt at reroute_count 0 → T1; at reroute_count 1 → T2; bundle with one spec_gap member → T3 |
| `main.ts:3749` | spec_gap FIX console (`canon run <ids> --reroute`) | same three |
| `main.ts:3724` | spec_gap BLESS reason (`canon task accept … code_review --reason "<why>"`) | spec_gap halt → T4 |
| `main.ts:3752` | spec_gap BLESS console | same |
| `phases/code-review.ts:347` | pre-flight auto-block `canon task reset-code-review <id>` | code_review pre-flight with only `blocked` rows → T6 |
| `task/index.ts:374` | `canon task phase … sanctioned` redirect → `canon task accept <id> ${phase} --reason "<why>"` | code_review spec_gap halt (a review verdict exists to sanction) → T5 |
| `task/index.ts:1538` | `specGateDoneNote` → `canon run --reroute <id>` | full tier with spec_review done at code_review, qa, human_review → T7 |

**Exempt (45)**, each needing a one-line reason in the registry:

- **Source comments, 15.** `tsup` strips them and they never reach an operator: `main.ts:338, 2954, 4008, 4014, 4016, 4018, 4019`; `detach.ts:179, 187`; `types.ts:55, 66`; `review-archive.ts:97`; `task/templates.ts:5, 6`; `task/index.ts:1530`.
- **Usage or help renderers, including usage errors, 11:** `cli/index.ts:65, 72, 74, 108`; `orchestrator/cli.ts:152`; `task/index.ts:58, 59, 584, 1065, 1109, 1646`.
- **Argv handling, 4:** `orchestrator/cli.ts:211`; `detach.ts:190`; `task/index.ts:1654, 1657` (`case` labels).
- **Refusal naming the command it refuses, 6:**
  - `main.ts:2743` (reroute phase refusal)
  - `main.ts:2776` (`--reroute aborted`: amendment required)
  - `main.ts:2822` (`--reroute aborted`: archive failed)
  - `task/index.ts:591` (accept refuses this phase)
  - `task/index.ts:1125` (reset-code-review refuses this phase)
  - `orchestrator/cli.ts:236` (`--reroute` with `--full-send` refused; the message splits the operator's own invocation)
- **Negative mention, 1:** `main.ts:3658` ("NOT --reroute").
- **Audit or log line, 3:** `main.ts:559`; `task/index.ts:821, 1041`.
- **Generic pointer list or field description, 4:** `task/index.ts:31` (says what clears `full_send`, not a step to run); `task/index.ts:34, 35, 37`.
- **Alternate invocation form, 1:** `main.ts:2963`. It prints after a reroute has started and shows how to step a reroute ("combine the flags in this one command: `canon run <id> --reroute --step --expect …`"). The line before it says not to start a second run while this one is active. This is a judgment call; see Open Questions.

Total: 15 + 11 + 4 + 6 + 1 + 3 + 4 + 1 = 45, and 45 + 11 actionable = 56. The registry is the authority on the final tree, and the handoff reports the per-class counts from it.

## Steps

### Step 1: AC-4 heading helper and spec_gap FIX hint (red-first)

Files: `src/orchestrator/main.ts`

Write T1 and T2 from Step 4 first. Run them on the unchanged source and record T2's failure in the handoff (expected: `--reroute aborted … expected heading: ## Amendment Round 2`; T1 passes). Then:

1. Add the helper next to `rerouteFromHumanReview`:

   ```ts
   /** Heading the next `--reroute` requires in this task's spec.md. */
   export function rerouteAmendmentHeading(status: StatusJson): { round: number; heading: string } {
       const round = (status.phases.implement?.reroute_count ?? 0) + 1;
       return { round, heading: round === 1 ? '## Amendment' : `## Amendment Round ${round}` };
   }
   ```

2. In `rerouteFromHumanReview` (`main.ts:2761-2769`), replace the inline `requiredRound` and `expectedHeading` with a call to the helper. Pass `round` to `verifyRerouteAmendment` and use `heading` as `expectedHeading`. Behavior does not change.

3. In the spec_gap block of `checkAndRoute` (`main.ts:3698+`), compute per spec_gap task, using `statuses`, which is freshly re-read at that point:

   ```ts
   const amendHeadings = specGapIds.map(id => ({
       id,
       heading: rerouteAmendmentHeading(statuses[taskIds.indexOf(id)]).heading,
   }));
   ```

   - Reason FIX line: `` `  FIX: add ${amendHeadings.map(a => `${a.heading} to tasks/${a.id}/spec.md`).join('; ')}, then: canon run ${taskIds.join(' ')} --reroute\n` ``.
     - It keeps the `FIX: … canon run <ids> --reroute` shape that `run-task-code-review.test.ts:467` asserts.
     - It names a heading only for spec_gap tasks, because the reroute pre-flight skips non-spec_gap members (`main.ts:2758-2760`).
   - Console: change `# Edit tasks/${id}/spec.md — add a ## Amendment section` to use the per-task heading: `` `    # Edit tasks/${id}/spec.md — add a ${heading} section` ``.
   - Leave the scope-note prose (`as an ## Amendment`, `(## Amendment)`) alone. It describes adding Affected Files, not the reroute heading, and AC-4 does not cover it.

4. Re-run T1–T3 until green.

### Step 2: Registry and registry test

Files: `tests/recovery-hints.test.ts` (new)

- Data:

  ```ts
  type HintSite =
      | { file: string; snippet: string; kind: 'actionable'; covers: ReadonlyArray<{ state: string; test: string }> }
      | { file: string; snippet: string; kind: 'exempt'; reason: string };
  const HINT_PATTERN = /--reroute|reset-code-review|reset-spec-review|canon task accept/;
  const HINT_SITES: readonly HintSite[] = [ /* one entry per matching line; see classification table */ ];
  ```

  `file` is repo-relative (`src/...`). `snippet` is a verbatim substring of the raw line, including leading indentation where that is needed for uniqueness. Examples: `task/index.ts:1646` vs `:584`, and the `'  reset-spec-review <TASK-ID>'` usage line vs `:1065`.

- Pure checker: `checkHintRegistry(sources: ReadonlyMap<string, string>, sites: readonly HintSite[], testSources: readonly string[]): string[]`. It returns failure messages, and an empty array means pass.
  1. For each source file and each line matching `HINT_PATTERN` with no `sites` entry for that file whose snippet the line contains:
     `` `${file}:${n}: unregistered recovery-command hint: ${line.trim()} — add a HINT_SITES entry in tests/recovery-hints.test.ts (actionable with covering tests, or exempt with a reason).` ``
  2. For each site, count lines in its file that contain the snippet:
     - 0 lines, or a missing file: `` `${file}: stale HINT_SITES snippet not found: ${snippet} — the hint was reworded or removed; update or delete the entry.` ``
     - more than 1 line: `` `${file}: HINT_SITES snippet matches ${n} lines: ${snippet} — lengthen it until it is unique in the file.` ``
     - exactly 1 line that does not match `HINT_PATTERN`: report it as stale with "no longer names a recovery command".
  3. For each actionable site:
     - empty `covers` is a failure.
     - For each `covers[].test`, it fails when no test source contains a test declaration with that exact title. Declarations are `test('<title>'`, `test("<title>"`, or `` test(`<title>` ``; match on the declaration, not a bare `includes(title)`, because this file holds the titles as data. Message: `` `${file}: actionable hint ${snippet} names covering test "${title}", which no tests/*.test.ts declares — write the chained fixture or fix the title.` ``
  4. An exempt site with a blank `reason` is a failure.
- Loader: recursively read every file under `src/` (all extensions; AC-1 says every line in `src/`) into a `Map` keyed by repo-relative path. Read `tests/*.test.ts` contents.
- Tests:
  - `'recovery hint registry covers every recovery-command line in src'`: `assert.deepEqual(checkHintRegistry(loadSrc(), HINT_SITES, loadTests()), [])`.
  - `'recovery hint registry reports unregistered, stale and uncovered entries'` (AC-3), with three in-memory cases, each asserting the matching message (regex on `unregistered recovery-command hint`, `stale HINT_SITES snippet`, `names covering test`):
    - `{'src/x.ts': "die('run canon run a --reroute');"}` with no sites.
    - A site whose snippet is not in its file.
    - An actionable site covering `'no such recovery test'`.
- Titles must contain no quote characters, so the declaration match stays simple.
- Fill `HINT_SITES` from the final tree after Step 1. Run the registry test and register anything it reports.

### Step 3: Shared fixture helpers in the new file

Files: `tests/recovery-hints.test.ts`

Copy what the fixtures need from `tests/run-task-safety.test.ts` (the spec says copy, not share):

- `withTempDir`, `writeTaskStatus`, `writeExecutable`, `gitIn`, `makeGitFixture`
- `makeCompleteStatus`, `makeReviewLoopStatus`, `writeReviewLoopFixture`
- `runNodeInline`, `childEnvWithoutTasksOverride`, `combinedOutput`, `runEnsureBranchInline`
- `makeBootstrappedTaskWorktreeFixture` and `prepareReviewEntryMainFixture` (for T6)

Fake agents: copy `setupInvocationLoggingCliTools`, but drop the `gh` fake (no fixture needs it). Extend the completer so a comma-separated `FAKE_AGENT_TASK_IDS` (falling back to `FAKE_AGENT_TASK_ID`) completes the phase for every listed task; T3 is a bundle.

Add two new helpers:

- `extractCommand(text: string, re: RegExp): string`. It asserts a match and returns the trimmed command (from `canon` to the end of the command, without surrounding backticks).
- `runPrintedCommand(command, { cwd, env, ids?, reason?, bound? })`:
  - Replace `<id>` with the given id.
  - Replace any `"<…>"` placeholder with `"<reason>"` (a real string).
  - Tokenize, respecting double quotes.
  - Assert `tokens[0] === 'canon'`.
  - Dispatch: `canon task …` runs `taskCmd(tokens.slice(2))` from `src/task/index.ts` in a subprocess. `canon run …` runs `main()` from `src/orchestrator/main.ts` with `process.argv = ['node', 'canon', ...tokens.slice(2), ...bound]`, `CANON_NO_DETACH=1`, and the fake agents first on `PATH`.
  - Return `{ status, stdout, stderr }`.

`bound` is always `['--step', '--expect', '<phase>']` for `canon run`, so nothing goes beyond one agent phase (Decision 3).

### Step 4: New chained fixtures

Files: `tests/recovery-hints.test.ts`

Every fixture:

- asserts the command appears in both emitted copies, the persisted escalation reason and the console output, when the site has two copies;
- carries out any precondition the hint states;
- asserts exit 0 and the promised outcome.

Titles are the strings the registry's `covers` uses.

**spec_gap halt helper (T1–T5).**

- `makeGitFixture(dir)`.
- For each task id, `writeReviewLoopFixture(localDir, id, 'code_review', 0, 0, true)`, then patch `status.json`:
  - `code_review: { status: 'done', verdict: 'spec_gap', iterations: 1, iterations_current_loop: 1 }`
  - `implement.reroute_count = N`
  - `delicate: false`, `task_size: 'M'`, `full_send: false`, `worktree: false`
- When N ≥ 1, append the prior round's heading to `spec.md` (`## Amendment\n\nPrior reroute.\n` for N=1), as a task rerouted once would have.
- Write `review.md` with a checked `spec_gap` verdict.
- Run `checkAndRoute('code_review', ids)` via a copy of `runCheckAndRouteInFixture` (cwd `localDir`, `CANON_TASKS_DIR_OVERRIDE`). Assert exit 2 and `code_review.status === 'blocked'`. The verdict-artifact exception in Decision 3 applies here.

**T1 `'spec_gap fix hint at reroute_count 0: the printed heading and reroute are accepted'`.**

1. Extract the heading from the reason (`/FIX: add (## Amendment(?: Round \d+)?) to tasks\/<id>\/spec\.md/`) and from the console (`/add a (## Amendment(?: Round \d+)?) section/`). Assert they are equal.
2. Assert `doesNotMatch(/Amendment Round/)`. This is the state-varying pair with T2, as `patterns.md` requires.
3. Append `<heading>\n\nFixture amendment.\n` to `spec.md`.
4. Extract `canon run <id> --reroute` from the console and assert the reason has the same command.
5. `runPrintedCommand` with `bound = ['--step','--expect','spec_review']` and `FAKE_AGENT_COMPLETE_PHASE=spec_review`.
6. Assert:
   - exit 0
   - output matches `/code_review spec_gap → spec_review/`
   - status has `implement.reroute_count === 1`, `implement.rerouted === true`, `spec_review.status === 'done'`, `code_review.status === 'pending'` and `verdict === ''`, and the next phase is `plan`
   - `review-prior-1.md` exists

   Use the reason regex `/FIX: \S+ .*?(?:add|with) (## Amendment(?: Round \d+)?)/`. It matches both the pre-fix wording (`FIX: amend spec.md with ## Amendment`) and the post-fix wording (`FIX: add ## Amendment Round 2 to …`), so the red run fails at `--reroute` and not at extraction.

**T2 `'spec_gap fix hint at reroute_count 1: the printed heading and reroute are accepted'` (AC-4 red-first).**

Same as T1 with N=1. Assert the heading is `## Amendment Round 2` (match), and assert after the reroute that `reroute_count === 2`. Pre-fix: the extracted heading is `## Amendment`, and `--reroute` exits non-zero with `expected heading: ## Amendment Round 2`. Record this in the handoff.

**T3 `'spec_gap fix hint in a bundle names a heading only for the spec_gap task and its reroute is accepted'`.**

- Bundle `gap-a` (spec_gap, N=1) and `ok-b` (`code_review` done/`approved`, N=0). The halt blocks both (`autoBlockPhase(taskIds …)`).
- Assert the reason names `## Amendment Round 2 to tasks/gap-a/spec.md` and does not mention `tasks/ok-b/spec.md` in the FIX clause.
- Append the heading to gap-a only, then run the printed `canon run gap-a ok-b --reroute` bounded, with `FAKE_AGENT_TASK_IDS=gap-a,ok-b`.
- Assert exit 0, the `code_review spec_gap → spec_review` banner, and `gap-a.reroute_count === 2`.

**T4 `'spec_gap bless hint: the printed accept command sanctions code_review and advances to qa'`.**

- Halt at N=0.
- Extract the console `canon task accept <id> code_review --reason "<why this gap is acceptable>"` and the reason's `… --reason "<why>"`. Assert both have the same tokens up to `--reason`.
- Keep the tree clean outside `tasks/`. `makeGitFixture` leaves only untracked `tasks/`; do not write anything else in `localDir`.
- Run the printed accept with a real reason (cwd `localDir`, `CANON_TASKS_DIR_OVERRIDE`).
- Assert:
  - exit 0
  - `code_review.status === 'done'`, `verdict === 'sanctioned'`, `operator_accepted === true`
  - `operator_accepted_sha` equals `git rev-parse HEAD`
  - `notes.md` contains `Operator accepted code_review via \`canon task accept\``
  - the derived next phase is `qa`. Use a local `derivePhase` like `tests/run-task-reroute-preflight.test.ts:191`.

**T5 `'task phase sanctioned redirect: the printed accept command is accepted from a spec_gap halt'`.**

- Halt at N=0.
- Run `canon task phase <id> code_review done sanctioned` via a `taskCmd` subprocess. Assert non-zero exit and the stderr redirect.
- Extract `` `canon task accept <id> code_review --reason "<why>"` `` (the text inside backticks), fill the placeholders, and run it.
- Assert exit 0 and the sanctioned audit fields, as in T4.

**T6 `'code_review pre-flight auto-block: the printed reset-code-review is accepted and the re-run passes pre-flight'`.**

1. `prepareReviewEntryMainFixture(dir, id, true, false)`, the harness proven by "main enters code_review without retry when the handoff is clean…".
2. Rewrite the handoff Validation Outcomes row to `` | `npm test` | blocked | CI runner unavailable | ``.
3. Run main via `runReviewLoopMain(...)` with `CANON_WORKTREES_ROOT` set as in `runReviewEntryMainFixture`, and no `FAKE_AGENT_COMPLETE_PHASE`.
4. Assert:
   - exit 2
   - no agent invocations
   - `code_review.status === 'blocked'`
   - the escalation reason and output contain `` `canon task reset-code-review <id>` ``
5. Do the hint's stated precondition: flip the row to `Pass`.
6. Run the printed reset with `<id>` filled in. Assert exit 0, `code_review.status === 'pending'`, and `implement.status === 'done'`.
7. Do the hint's "re-run the pipeline": run main again with `FAKE_AGENT_COMPLETE_PHASE=code_review`. Assert exit 0, agent log `['claude']` (pre-flight passed and the foreman ran), and `code_review.status === 'done'`.

**T7 `'spec gate done note: the printed reroute is accepted and the armed gate fires from code_review, qa and human_review'`.**

For each phase P in `code_review`, `qa`, `human_review`:

1. `makeGitFixture`, plus a full-tier M, non-delicate, `worktree: false` task whose phases before P are done:
   - `spec_review` done/approved
   - `code_review` approved when P > code_review
   - `human_spec_gate: false`
   - `implement.reroute_count: 0`
2. Spec contains `## Validation Required`/Affected Files as in `writeReviewLoopFixture`.
3. Run `canon task set <id> human_spec_gate true` via a `taskCmd` subprocess. Assert stdout contains the note.
4. Extract `` `canon run --reroute <id>` ``. Do the precondition ("add an amendment to the spec"): append `## Amendment`.
5. Run it bounded with `--step --expect spec_review` and `FAKE_AGENT_COMPLETE_PHASE=spec_review`.
6. Assert:
   - exit 0
   - output matches `/SPEC GATE/` (the note's promise: "the armed gate fires after the next spec_review")
   - `human_spec_gate === false` (consumed)
   - `spec_review.status === 'done'`, and the next phase is `plan`

**T8 `'spec loop cap at spec_review entry: the printed reset-spec-review is accepted'`.**

- `writeReviewLoopFixture(localDir, id, 'spec_review', 3, 0, true)`, then `runReviewLoopMain(..., cap 3)`. Assert exit 2.
- Extract `canon task reset-spec-review <id>` from the escalation reason and output.
- Run it. Assert exit 0, `spec_review.status === 'pending'`, `iterations_current_loop === 0`, and that `spec-review-prior-1.md` exists.

The builder text says the next run enters `spec_review`. Also run `runReviewLoopMain(..., ['--expect','spec_review'], { FAKE_AGENT_COMPLETE_PHASE: 'spec_review' })` and assert exit 0 with agent log `['codex']`.

**T9 `'code loop cap at code_review entry: the printed reset-code-review is accepted'`.**

- Same shape with `'code_review', 3, 0, true`.
- After the reset, assert `code_review.status === 'pending'` and `implement.status === 'done'`, and that `--expect code_review` passes the `--expect` guard.
- If the non-worktree harness cannot reach the code_review backstop (`verifyBranch`), use `prepareReviewEntryMainFixture` with `iterations_current_loop` at the cap instead. Note which one in the handoff.
- Bound the follow-on run with `--step --expect code_review` and `FAKE_AGENT_COMPLETE_PHASE=code_review`.

### Step 5: Extend the three existing chained tests

Files: `tests/run-task-safety.test.ts`, `tests/run-task-code-review.test.ts`

- **Spec loop cap test** (`run-task-safety.test.ts:8003`):
  - Replace `taskCmd(['reset-spec-review', taskId])` with a command parsed from `blocked.escalations?.[0]?.reason` via `/canon task (reset-spec-review) ([^\s;]+)/`.
  - Assert the captured id equals `taskId` and the same `canon task reset-spec-review <id>` appears in `combinedOutput(first)`.
  - Call `taskCmd([m[1], m[2]])`.
  - Leave the existing outcome assertions unchanged.
- **Code loop cap test** (`:8067`): same, with `reset-code-review`.
- **Reviewer block test** (`run-task-code-review.test.ts:1087`):
  - Collect every `canon task reset-code-review (\S+)` from `result.output` (console lines) and from each task's escalation reason (the `${recovery}` clause).
  - Assert both sets equal `['blocked-peer', 'active-peer']`.
  - Run each parsed command through the existing `spawnSync` + `taskCmd` call, built from the parsed tokens instead of the literal `'reset-code-review'`.
  - Keep the existing assertions.

Leave the test titles unchanged; the registry cites them.

### Step 6: AC-5 sweep

If any fixture in Steps 4–5 fails because the hint (not the command) is wrong:

1. Record the failure output in the handoff (red).
2. Fix the hint at its site, preferring an existing builder or `rerouteAmendmentHeading`.
3. Update any doc restating it (`docs/pipeline-orchestrator.md`, then run `npm run sync-templates`).
4. Update the registry snippet.

If the command itself rejects a state the hint is correct to name, do not change the command. Put it in the handoff's Blockers (Non-Goals). If no other hint is wrong, the handoff says so explicitly.

### Step 7: BACKLOG (AC-7)

Files: `docs/BACKLOG.md`

Edit the "Enforce the recovery-message and fail-closed pitfalls mechanically" entry (line 26). Keep the entry and mark part (a) shipped for its narrowed scope:

- **(a)** `tests/recovery-hints.test.ts` now registers every `src/` line naming `--reroute`, `reset-code-review`, `reset-spec-review` or `canon task accept`, and pins each actionable one to a chained fixture. Hints naming other `canon` commands (`canon task phase`, `canon task set`, `canon stop`, `canon watch`, plain `canon run`, `--force`) remain unenforced. Hints assembled from fragments escape the line scan.
- **(b)** stays open as a review-lens item. A grep-based check is impractical: about 17 early returns and about 10 ternaries map probe errors to empty-ish values, and many are deliberate "unknown" sentinels or already fail closed.

Write in the entry's existing register. Name no other repo.

### Step 8: Build and validate

`npm run build` must run to completion before `npm test` (lessons-learned §"Run `npm run build` to completion before `npm test`"). Then:

- `npm run type-check`, `npm run lint`
- capture `git status --porcelain` to a file outside the repo (`mktemp`)
- `npm test`, then capture the status again and diff it (AC-6: no new paths)
- `npm run docs-refs-check`, `npm run sync-templates:check`

The rebuild must change `dist/orchestrator/run-task.js`. `dist/cli/index.js` should not change, because `main.ts` is not in its bundle (tsup entry `cli/index` → `src/cli/index.ts`). If it does change, check why before committing.

## Testing Plan

- **Unit/registry:** registry pass on the real tree, plus three synthetic red checks (AC-3).
- **Chained fixtures (subprocess `main()`, `checkAndRoute`, `taskCmd`):** T1–T9 new; three existing tests extended.
- **Red-first:**
  - T2 fails on pre-fix source. Record the exact `--reroute aborted … expected heading: ## Amendment Round 2` output in the handoff.
  - T1 passes both before and after.
  - Any AC-5 fix gets the same treatment.
- **Full suite:** `npm test` green. Report any `skipped` test as unverified, not passed. In the Codex sandbox, `gitDirWritable`-gated tests skip; none of the new fixtures depend on REPO_ROOT `.git` writes.

## Handoff Requirements

The handoff must report:

- registry counts per class
- the list of actionable entries with their emitting states
- T2's pre-fix failure output
- any AC-5 findings, or the explicit statement "no other hint was wrong"
- the AC-6 before/after `git status --porcelain` comparison

## Open Questions (recorded; not blocking)

- **`main.ts:2963` classified exempt** (alternate invocation form). After a reroute starts, it says to "combine the flags in this one command: `canon run <id> --reroute --step --expect …`". Run literally from the post-reroute state, that command would be refused, because `spec_review`/`implement` is not a reroute-admitted phase, and the line above says not to start a second run. I read it as advice about how to invoke the reroute, not as a next step. A reviewer may reasonably call it actionable. If so, its fixture would fail, and AC-5 would reword it, e.g. "Next time, to step a reroute, run … instead of a bare `--reroute`".
- **`orchestrator/cli.ts:236` classified exempt** as an argv refusal of the `--reroute`+`--full-send` combination. "Run --reroute first" is the operator's own invocation minus one flag, so its acceptance is whatever the reroute pre-flight decides for that task.
- **`task/index.ts:374`, the spec_review form of the redirect.** `${phase}` also renders `canon task accept <id> spec_review --reason "<why>"`. T5 covers the code_review form from the state where a sanctionable verdict exists. Whether `accept spec_review` succeeds from a given state is accept's own contract (Non-Goal: no change to the states recovery commands accept).
- **`specGateDoneNote`** says "add an amendment" without naming the round. The spec judges this not wrong. T7 runs at `reroute_count 0`, where `## Amendment` is right. At `reroute_count ≥ 1` an operator writing `## Amendment` gets a reroute abort that names the expected heading, so recovery is self-correcting but costs a round trip. Not in scope.
