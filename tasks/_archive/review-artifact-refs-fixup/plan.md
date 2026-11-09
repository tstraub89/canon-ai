# Implementation Plan: review-artifact-refs-fixup

> Written by: Claude | Implements: `tasks/review-artifact-refs-fixup/spec.md` (spec_review: approved)

## Approach

Reuse the implement/QA mechanism for code_review: add `ARTIFACT_CITATION_RULE` to the foreman template, widen `fixUpOwnArtifactRefs` to `code_review`, run it after every session that can write `review.md`, wrap it in a verdict guard whose stops auto-block code_review, and exempt two raw/superseded files in the checker.

**Feasibility check** (all found by reading the code, not recalled):
- **Exists:** `fixUpOwnArtifactRefs` (`src/orchestrator/main.ts:538`), `fixupTaskContexts` (:530), `fixUpImplementArtifactRefs` (:613, the request pattern to copy: `wrapForResume: false`, success = `exitCode === 0`), `promptArtifactFixup` (`src/orchestrator/prompts/index.ts:54`), `extractCheckedVerdict` (`src/orchestrator/validation.ts:931`, re-exported in `main.ts`), `splitState.autoBlockPhase` (`src/orchestrator/state.ts:522`), `splitState.usableSessionId`, `splitPolicy.phaseSessionSlot('code_review')` = `reviewer`, `taskDirFor` (`state.ts`, honors `CANON_TASKS_DIR_OVERRIDE`), `archivePriorReview`/`REVIEW_ARCHIVE_PREFIX` (`src/orchestrator/review-archive.ts`), `isNoisySourceFile` (`scripts/docs-refs-check.mjs:512`), "### 4. Write `review.md`" in the foreman template.
- **Real path:** main loop (`main.ts` ~4332) `runPhase` → store session id → `checkAndRoute` (:3753). In `checkAndRoute`: reviewer-blocked stop (:3756) → per-task done check + `recoverPhaseForTask` loop (:3777-3815) → full-send scope check (:3821) → verdict switch. `recoverPhaseForTask` → `retryAgentForPhase` (:3606) is the second writer of `review.md`. The `qa` case (:4022) shows the existing fix-up call shape. The scope guard already lives inside `fixUpOwnArtifactRefs` (snapshot before/after).
- **Callers:** `fixUpOwnArtifactRefs` has two callers (implement, qa) — new options must default to current behavior (`die`). `promptArtifactFixup` callers: `fixUpOwnArtifactRefs` and `tests/run-task-safety-scaffold-push.test.ts` (builds the expected prompt). `checkAndRoute` is exported and called directly by tests with two args, so no new required parameter.
- **Tests that can fail:** each orchestrator test needs a foreman fake that writes `review.md` with a backticked missing path and a checked verdict, plus `installDocsRefsChecker` (as the existing review-entry fix-up test does at `tests/run-task-safety-scaffold-push.test.ts:~412`). Without the change no "Artifact fix-up" line is logged, so AC-2/5/6/10 fail on current `main`. AC-3's second case needs a fix-session fake that edits the checkbox then exits non-zero.
- **Predicates:** (a) "all tasks code_review `done`" uses `getPhaseStatus(...) === 'done'` for **every** task (bundle `every()`, not `some()`); a `pending`/`blocked`/`in_progress` member skips the fix-up. (b) Verdict guard: `extractCheckedVerdict` returns `null` for no checked box or a missing/unreadable `review.md` — treat `null` as a mismatch (recorded verdict is never null because the phase gate `verdictMustMatchArtifact` already required them equal at `done`). Compare `after !== getVerdict(status, 'code_review')`. (c) Zero findings / `absent` / `clean` checker results make no fix session → guard not run (nothing could have changed).
- **Scope:** every file below is in the spec's Affected Files (including `templates/` mirrors and `dist/`). `tasks/review-artifact-refs-fixup/*` are this task's own artifacts.
- **Async/stateful:** at most one fix-up per bundle per phase invocation falls out of control flow: the post-foreman call runs only when every task is already `done` (so `checkAndRoute` performs no recovery); the recovery call runs only when `recoverPhaseForTask` actually ran for a code_review task (so the first call was skipped because something wasn't `done`). No module-level flag is needed. Interactive mode: pass `sessionId = null` (a stale stored reviewer id from an earlier round must not be resumed). Post-foreman call: also pass `null` when `phaseResult?.sessionId` is absent, for the same stale-id reason. Resuming `reviewer` does not change the stored id, so round continuity is unchanged. A throw from the fix session other than `AgentSessionError` propagates as today; the verdict guard still runs (`finally`).

No contradictions with the spec found. Judgment calls made (recorded in `notes.md` `[plan]`): the post-fix-session "could not inspect the working tree" `die` also routes through the code_review stop callback (it would otherwise exit with code_review `done`, the same hazard as the scope stop).

## Steps

### Step 1: Checker exemptions

Files: `scripts/docs-refs-check.mjs`, `templates/scripts/docs-refs-check.mjs`

Edit the root copy only; the pre-commit hook / `npm run sync-templates` mirrors it (list both in the handoff). In `isNoisySourceFile`, extend the last regex alternative:
`/^tasks\/[^/]+\/review-cold-codex(?:-run-\d+)?\.md$/` and add `/^tasks\/[^/]+\/review-prior-\d+\.md$/`. Update the comment block above the function (lines ~490-510) to mention both. `review.md` must remain checked.

### Step 2: Prompt rule in the foreman template

Files: `src/orchestrator/prompts/templates/code-review-foreman.md`, `src/orchestrator/prompts/index.ts`

The template is rendered in `promptCodeReview`; see how `implement.md`/`qa.md` receive `ARTIFACT_CITATION_RULE` (grep it in `prompts/index.ts`, it is passed as a template variable) and do the same. Place `{{{artifactCitationRule}}}` (use the actual existing variable name) in `### 4. Write review.md`, after the `§"…"` paragraph and before "For each task, write…". Then `promptArtifactFixup`: widen `phase` to `'implement' | 'qa' | 'code_review'`; for `code_review` replace the `Do not run git add or git commit; the orchestrator commits after this turn.` line with: canon checks the references before acting on the review, nothing commits at this point, edit only references, and do not change any verdict checkbox or finding. Keep the "phase is already complete" and "do not run `canon task phase`" sentences (tests match them). The header line "before committing, canon ran…" also says "before committing" — make it phase-aware for code_review ("before acting on the review"), so the prompt does not say canon commits after the turn.

### Step 3: Generalize `fixUpOwnArtifactRefs`

Files: `src/orchestrator/main.ts`

- `phase: 'implement' | 'qa' | 'code_review'`.
- Add optional `onStop?: (message: string) => never` defaulting to `die`. Use it for the two existing stops (post-snapshot failure and outside-artifact change). Keep the `die(...); return;` shape for the default.
- Agent name for the no-session warning: `{implement: 'implementer', qa: 'qa', code_review: 'reviewer'}`.
- `consequence` for `code_review`: `Fix the references before --pr; its docs-refs gate will stop on them.` (Both stops' messages: for code_review the "Nothing was committed… re-run canon run" tail is wrong — pass the recovery text via the callback wrapper in Step 4, and have the callback receive only the cause text. Simplest: build the cause string in `fixUpOwnArtifactRefs`, call `opts.onStop ? opts.onStop(cause) : die(cause + defaultTail)`.)
- Metrics label `code_review_fixup` is set by the caller (Step 4).

### Step 4: Code-review fix-up helper, verdict guard, wiring

Files: `src/orchestrator/main.ts`

Add `fixUpReviewArtifactRefs(taskIds: string[], cwd: string, sessionId: string | null): Promise<void>` near `fixUpImplementArtifactRefs`:

1. Return immediately unless every task's `getPhaseStatus(readStatus(id), 'code_review') === 'done'`.
2. `let sessionRan = false`. Call `fixUpOwnArtifactRefs({ phase: 'code_review', taskIds, cwd, sessionId, artifactNames: ['review.md'], onStop: stopReviewFixup, runSession })` inside `try { … } finally { if (sessionRan) verdictGuard() }`. `runSession` sets `sessionRan = true`, then `agentBackendFor('reviewer', assignmentForTasks(taskIds)).run({ role: 'reviewer', phase: 'code_review', tasks: fixupTaskContexts(taskIds), prompt, interactive: false, resumeId: sessionId, metricsContext: { taskId: taskIds[0], phase: 'code_review_fixup', activeCwd: cwd }, cwd, wrapForResume: false })`, returning `result.exitCode === 0`.
3. `verdictGuard`: for each task read `path.join(taskDirFor(id), 'review.md')` (missing → null), `extractCheckedVerdict`, compare with `getVerdict(readStatus(id), 'code_review')`; on any mismatch call `stopReviewFixup` naming the task and both verdicts (`checked "<after|none>" in review.md vs recorded "<recorded>"`). Because the guard runs in `finally`, a stop thrown by `onStop` (process.exit) from the scope check wins first; the guard must not mask a thrown `AgentSessionError`-free error — keep it simple: run the guard in `finally`, and `stopReviewFixup` calls `process.exit`.
4. `stopReviewFixup(cause)`: `reason = cause + ' Reset code review for every task, then run again: canon task reset-code-review <id> …; canon run <ids>.'`; `warn(reason)`; `splitState.autoBlockPhase(taskIds, 'code_review', phaseIterationCount(taskIds, 'code_review'), reason)`; `splitCli.setExitReason(reason)`; `process.exit(2)` — mirror the QA-blocked stop in `checkAndRoute` (:3765-3771) and `autoBlockPhase` parks the whole bundle.

Wiring:
- **Post-foreman:** in the main loop (`withAgentSessionPark`, ~:4349) immediately before `await checkAndRoute(currentPhase, taskIds)`, for `currentPhase === 'code_review'` call `fixUpReviewArtifactRefs(taskIds, splitWorktree.getActiveCwd(taskIds), cliArgs.interactive || !lastSessionId ? null : splitState.usableSessionId(taskIds, 'reviewer', assignmentForTasks(taskIds)))`. This sits before the reviewer-blocked stop in `checkAndRoute`, which is safe because the helper returns when any task is not `done` (AC-6 blocked case).
- **Recovery:** in `checkAndRoute`, set `let recoveredReview = false` and set it true whenever `recoverPhaseForTask` returns true for `phase === 'code_review'`. After the loop and the `statuses = …` re-read, before the full-send scope check: `if (phase === 'code_review' && recoveredReview) { await fixUpReviewArtifactRefs(taskIds, splitWorktree.getActiveCwd(taskIds), splitState.usableSessionId(taskIds, 'reviewer', assignmentForTasks(taskIds))); statuses = taskIds.map(splitState.readStatus); }`. (Interactive: `cliArgs.interactive ? null : …`.)

### Step 5: Docs

Files: `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md`

Edit root (line ~375 fix-up paragraph): add that after code_review (foreman and one-shot recovery session) canon checks each task's `review.md`, resumes the stored reviewer session for up to two fix attempts, that an outside-artifact change or a verdict that no longer matches the recorded verdict auto-blocks code_review for the bundle (`canon task reset-code-review <id>`, then `canon run`), that a `blocked` review gets no fix-up, and that no stored session / failed session / remaining findings warn and continue. In the session-resumption passage (~:479) add that the `reviewer` session may be resumed in-process for the fix-up. Adopter-scope: describe in generic terms, no canon-ai-only paths. Run `npm run sync-templates`.

### Step 6: Tests

Files: `tests/docs-refs-check.test.ts`, `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json`, `tests/run-task-safety-scaffold-push.test.ts`

- `docs-refs-check.test.ts` (next to the run-N case at :119): AC-8 — `review-cold-codex.md`, `review-prior-1.md`, `review-prior-12.md` with a backticked missing path pass; `review.md` same content fails. AC-11 — fixture task dir whose `review.md` has the bad ref; call real `archivePriorReview(taskDir)`, write a clean `review.md`, assert checker reports no findings (also assert the archived file name matches `review-prior-\d+\.md` came from the real call).
- `run-task-prompts.test.ts`: add `promptCodeReview(baseState)` and the round-N state to the prompt list in the citation-rule test (AC-1); add a `promptArtifactFixup({ phase: 'code_review', … })` case with `recordOrAssert('promptArtifactFixup_code_review', …)`, asserting `doesNotMatch(/commits after this turn|git commit/)` as a single phrase check and `match(/do not change any verdict checkbox or finding/i)` (AC-7). Regenerate goldens: `UPDATE_GOLDENS=1 npm test`, then a plain `npm test`.
- `run-task-safety-scaffold-push.test.ts` (reuse `prepareReviewEntryMainFixture`/fake-agent scaffolding; one shared fixture helper, per Slow Test Discipline, table-driven where the fixture is identical): AC-2 (changes_requested + missing path → "Artifact fix-up (attempt 1/2)", reviewer session resumed, routes to implement), AC-6 spec_gap variant + blocked no-fix-up variant, AC-3 two cases (zero exit with flipped checkbox; flipped checkbox then non-zero exit) asserting code_review `blocked`, reason names task and both verdicts, no routing; AC-4 outside-file edit → blocked; AC-5 no stored session → warn mentions `--pr`, continues; AC-10 foreman returns code_review `pending`, recovery session writes review and marks done → exactly one fix-up, after recovery, none at the foreman return; plus outside-edit/verdict-change variant of it.
- Prove red: temporarily remove the wiring call and the guard `finally` and confirm AC-2/AC-3 turn red (Known Pitfall "Prove each regression test can fail").

### Step 7: Build and validate

`npm run build` (dist is tracked), then `npm run lint`, `npm run type-check`, `npm test`, `npm run docs-refs-check`, `npm run sync-templates:check`. List `dist/` and all `templates/` mirrors in the handoff Changes table. In the handoff, cite non-existent example paths in markdown-link form.

## Testing Plan

- **Unit:** checker exemption cases (AC-8, AC-11); prompt cases and goldens (AC-1, AC-7).
- **E2E (orchestrator subprocess):** AC-2 to AC-6, AC-10 in `tests/run-task-safety-scaffold-push.test.ts`.
- **Manual:** none beyond the spec's Human Test Plan; a live run is only needed to confirm real Claude reviewer resume works (flag in PR body).

## Rollback Plan

Revert the commit; no data or schema change. A task auto-blocked by the new stop recovers with `canon task reset-code-review <id>`.
