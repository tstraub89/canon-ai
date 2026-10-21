# Spec: artifact-lint-agent-fixup — Send task-artifact docs-refs failures back to the agent session that wrote them

> Written by: Claude | Review by: Codex
> Status: draft

> **Full-send mode**: This spec was produced in full-send mode.

## Problem

This is GitHub issue #102. It is related to #10 ("don't respawn the implement model for mechanical handoff errors"). Twice in one adopter release cycle, a deterministic artifact lint stopped the pipeline over a one-line citation that the authoring agent could have fixed in seconds:

1. **Implement.**
   - The post-implement auto-commit (`autoCommitCode` in `src/orchestrator/main.ts`) failed because the adopter's pre-commit hook ran `docs-refs-check`. That check rejected `tasks/<id>/handoff.md`, which cited `src/components/...` without its workspace prefix.
   - `autoCommitCode` calls `die('Auto-commit failed: <hook stderr>')`. The run log ends `■ orchestrator exit code=1 [reason=Auto-commit failed: tasks/<id>/handoff.md:106: \`src/...\` — missing file · Found 1 broken ref · ...]`, and `canon watch` reports death.
   - The next `canon run` retries the commit (`retryImplementAutoCommitAtReviewEntry`). It fails identically until a human edits the handoff.
   - Two archived adopter tasks show this exact exit marker.
2. **QA.**
   - `done.md` cited, in backticks, a file the task itself deleted.
   - The `--pr` docs-refs gate in `commitHumanReviewFiles` aborted with `--pr aborted: docs-refs-check found broken refs ... missing file`. The operator rewrote the line by hand.

Confirmed mechanism (deterministic, from code trace plus adopter logs):

- Both failures come from `scripts/docs-refs-check.mjs`. That script is canon-owned, so it ships to adopters.
- The checker scans `tasks/<id>/handoff.md`, `done.md`, `review.md` and `pr-body.md` (spec, plan, notes and spec-review are exempt).
- Nothing feeds its findings back to the agent that wrote the artifact:
  - `autoCommitCode` dies on any commit failure.
  - The QA session ends without the check ever running.
  - The check first runs at `--pr`, after the QA session is gone. QA session ids are never persisted (`docs/pipeline-orchestrator.md` §Session Resumption).

## Decision

Before canon commits an agent's task artifacts, it runs the docs-refs checker. If the checker finds broken references in an artifact that agent wrote, canon resumes that agent's session with the findings and asks it to fix them, then checks again. It allows at most 2 fix attempts. After that it falls back to what happens today.

"The checker" means the canon-shipped `scripts/docs-refs-check.mjs`, run the way the `--pr` gate runs it: as a CLI in the tree being committed, so it loads the adopter's config. If the script is absent, nothing in this spec runs.

"Its own artifacts" means:
- implement: `tasks/<id>/handoff.md`
- QA: `tasks/<id>/done.md` and `tasks/<id>/pr-body.md`

These are counted for every task in the bundle. Findings in other files never trigger a fix-up.

1. **Implement: proactive, before the auto-commit.**
   - Both auto-commit entry points run the check before committing: the post-implement commit and the review-entry retry (`retryImplementAutoCommitAtReviewEntry`).
   - If the check reports findings and a stored Codex implement session (`sessions.codex`) exists, canon:
     1. Resumes that session, using the same cwd and model/effort resolution as the existing guardrail retry. The fix-up prompt carries the findings. It says the phase is already complete, that no phase command may run, and that only the cited artifacts may change.
     2. Re-runs the check.
   - **Success** (no findings remain): the commit proceeds as today. Canon prints one info line per fix-up attempt.
   - **No fix:** the commit proceeds exactly as today, with a warning that names the remaining findings. Today's `Auto-commit failed:` die still applies if a hook rejects the commit. This happens when:
     - findings remain after 2 attempts
     - there is no stored session
     - the fix session itself fails, meaning the agent call throws or returns a non-zero exit code. Codex's runner returns non-zero exits rather than throwing, so the exit code must be checked. An agent error from that session is caught locally: it never parks a phase, and it never crashes the review-entry retry.
   - Adopters without a docs-refs hook now get a fixed handoff before `--pr`, so the error no longer surfaces only at the PR gate.
2. **QA: before the session is forgotten.**
   - After the QA session completes and recovery has settled, and before `commitQaArtifacts`, canon runs the same check.
   - If there are findings and this process knows the QA Claude session id, canon resumes that session under the same 2-attempt bound. The session runs in the same cwd QA ran in (the task worktree when one is active), not REPO_ROOT, because the generic retry helper keeps QA on REPO_ROOT. The check, the fix and `commitQaArtifacts` all operate on that tree.
   - If findings remain, or there is no session id (for example, QA advanced by evidence in a later process), or the fix session fails, canon warns with the findings and the pipeline continues. A fix-session failure is caught locally and never parks QA.
   - The `--pr` docs-refs gate is unchanged.
3. **Scope guard (implement and QA).**
   - Before each fix session, canon snapshots the content of every path outside that agent's own artifacts. This means a content snapshot (e.g. `git diff` / hashes of dirty paths plus untracked files), not just the set of dirty paths. It also covers each bundle task's `status.json`.
   - If anything outside the agent's own artifacts differs after the session, the run stops. Canon names the changed paths and commits nothing. This stop applies at QA too. It is a safety stop, unlike the warn-only lint result.
4. **Prompt guidance.**
   - The implement templates (fresh, revisions and reroute) and the QA template tell the agent to cite repository files by their full path from the repository root.
   - They also tell it to cite a file the task deleted with the markdown-link form `[path](path)` rather than in backticks. That matches the existing deleted-file rule in the handoff template and the revisions prompt.
   - The wording describes the convention and names no canon-ai file.

## Non-Goals

- No new `status.json` session slot for QA. QA fix-up works only within the process that ran QA.
- No change to the `--pr` docs-refs gate, its `--force` bypass, or the checker's rules or scan set.
- No parsing of adopter hook output.
- No fixing of broken refs outside the phase's own artifacts.
- No deliberate respawn of a fresh agent session for the fix-up. Fix-up starts only from a known session id. If the agent CLI's own resume-not-found fallback starts a fresh session with the fix-up prompt, that is accepted, because the scope guard still applies.
- No fix-up for `autoCommitCode`'s other mechanical handoff dies (malformed Changes rows, coverage mismatches), and no change to the code_review pre-flight's handoff-format respawn path. Both are #10's broader ask and stay separate.

## Acceptance Criteria

- [ ] **AC-1: implement fix-up succeeds (red-first).**
  - Setup: a test drives `main()` through implement → auto-commit with the fake-agent harness (`setupInvocationLoggingCliTools` in `tests/run-task-safety.test.ts`). The fixture contains the canon checker, a pre-commit hook that runs it, and a `tasks/<id>/handoff.md` holding a broken backticked path. The fake resumed Codex session rewrites that line.
  - Expected: exactly one resume invocation with the stored session id, a successful commit, and the task reaches `code_review`.
  - Red-first: the pre-change code dies with `Auto-commit failed:` on this fixture.
- [ ] **AC-2: bounded fallback.**
  - Setup: the AC-1 fixture, but the fake session never fixes the line.
  - Expected: exactly 2 resume invocations, then a warning naming the finding.
  - Then the hook rejects the commit, and the run exits with today's `Auto-commit failed:` message.
  - Implement status and counters equal those asserted by today's main-driven failing-hook test (the `main()` failing-hook case near `tests/run-task-safety.test.ts` `runReviewEntryMainFixture`).
- [ ] **AC-3: no fix-up when nothing is wrong in the agent's artifacts.**
  - Each of these cases makes zero agent invocations:
    1. clean artifacts plus a hook that fails for an unrelated reason (today's die text)
    2. checker script absent
    3. no stored `sessions.codex` (warning, then today's behavior)
    4. a finding only in `tasks/<id>/review.md` or in a `docs/` file
  - The existing failing-hook tests pass unchanged.
- [ ] **AC-4: review-entry retry.**
  - Setup: implement already `done`, handoff still dirty (the `retryImplementAutoCommitAtReviewEntry` path).
  - Expected: the AC-1 fixture is fixed by a resume and proceeds into code_review.
  - A failing fix session on this path falls back to today's behavior. It does not crash.
- [ ] **AC-5: scope guard.**
  - A fake fix session that edits a source file **already dirty** from implement stops the run. The message names that file, and nothing is committed.
  - The same holds for a session that edits `tasks/<id>/status.json`.
  - At QA, a fix session that edits a non-artifact file also stops the run.
- [ ] **AC-6: failed fix session never parks.**
  - At implement (post-implement entry), a fake resumed session that exits non-zero leaves implement `done`, not `blocked`, and the run continues to today's commit behavior.
  - At QA, the same failure warns and reaches `human_review`, not a blocked QA.
- [ ] **AC-7: QA fix-up.**
  - Fixed: a test drives QA in-process with `done.md` citing a deleted file in backticks. The fake resumed Claude session fixes it, and `commitQaArtifacts` commits the fixed `done.md`.
  - Red-first: on the pre-change code this test fails because QA makes no resume invocation and `commitQaArtifacts` commits `done.md` with the broken backticked ref still in it (the committed blob is asserted, not just the working tree). The handoff records that pre-change failure.
  - Never fixed: 2 attempts, then a warning listing the finding, and the task reaches `human_review`.
  - No QA session id in this process: a warning, zero invocations, and the task reaches `human_review`.
- [ ] **AC-8: prompt guidance.**
  - `implement.md`, `implement-reroute.md`, `implement-revisions.md` and `qa.md` under `src/orchestrator/prompts/templates/` carry the full-path and `[path](path)` deleted-file guidance.
  - `tests/run-task-prompts.golden.json` is regenerated.
  - `tests/run-task-prompts.test.ts` pins the new text.
  - The fix-up prompt builders have golden keys, and their text says no phase command may run.
- [ ] **AC-9: restatements updated.**
  - `docs/pipeline-orchestrator.md` §Auto-Branch + Auto-Commit describes the pre-commit fix-up, its fallback and the scope guard.
  - §Session Resumption notes the in-process QA resume.
  - Both are synced to `templates/docs/pipeline-orchestrator.md`.
  - The `docs/decisions.md` "Auto-commit owned by the orchestrator" entry notes that the orchestrator may resume the implementer to fix its own artifact.
- [ ] **AC-10: build and checks.**
  - `npm run build` output is committed.
  - Lint, type-check, the full suite, `sync-templates:check`, and `docs-refs-check` pass.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/main.ts` | Fix-up loop around the auto-commit (both entry points) and before `commitQaArtifacts`; scope guard; fallback messages. |
| `src/orchestrator/validation.ts` | Run the canon checker and filter findings to the bundle's task dirs (or place this in a new module). |
| `src/orchestrator/prompts/index.ts` | Fix-up prompt builders for implement (Codex resume) and QA (Claude resume). |
| `src/orchestrator/prompts/templates/implement.md` | Citation guidance. |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Citation guidance. |
| `src/orchestrator/prompts/templates/implement-revisions.md` | Full-path citation guidance (the deleted-file rule is already there). |
| `src/orchestrator/prompts/templates/qa.md` | Citation guidance. |
| `src/orchestrator/prompts/templates/artifact-fixup.md` | New fix-up prompt template (if the builders use a template). |
| `docs/architecture.md` | Auto-commit description and docs-refs gate lines mention the pre-commit fix-up. |
| `tests/run-task-safety.test.ts` | AC-1 through AC-7 tests; extend the fake-agent harness with argv logging and a scripted edit hook. |
| `tests/run-task-prompts.test.ts` | Structural asserts and golden keys. |
| `tests/run-task-prompts.golden.json` | Regenerated. |
| `docs/pipeline-orchestrator.md` | Auto-commit and Session Resumption sections. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror. |
| `docs/decisions.md` | Auto-commit ownership entry. |
| `dist/cli/index.js` | Rebuilt. |
| `dist/orchestrator/run-task.js` | Rebuilt. |

### Interaction Dependencies

- **Agent-session park (3.11.0):** a fix session runs after `checkAndRoute` has already routed implement to `done`. Per `docs/lessons-learned.md`, no agent session may run after routing writes unless its failure is handled locally. AC-6 pins that.
- **`retryImplementAutoCommitAtReviewEntry` (issue #84):** that archived spec's Non-Goal "Not auto-fixing the content that made a hook fail" is superseded for task-artifact checker findings only.
- **Bundles:** findings are filtered across every bundle task's dir. One resumed session covers the bundle, because implement shares one Codex session.

### Data Model Changes

None.

### Implementation Notes (non-binding)

- Run the checker as its CLI (`file:line: ref — reason` lines on stderr, repo-relative POSIX paths), the way the `--pr` gate does, so the adopter's `scripts/docs-refs-config.mjs` is loaded. `runChecks` without an explicit `adopterConfig` ignores that file.
- The fake-agent harness (`setupInvocationLoggingCliTools`) only logs agent names today. Extend it to log each invocation's argv (to assert the resumed session id) and to run a scripted edit (to rewrite `handoff.md`/`done.md`, or to touch a source file for AC-5).
- `retryAgentForPhase` shows how to resolve the session slot, cwd and model for a Codex resume.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite (incl. golden regen)
- [x] `npm run build` (dist committed)
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] E2E — N/A

## Docs Impact

`docs/pipeline-orchestrator.md` and `docs/decisions.md` are edited here. Two other docs may go stale and are left for QA to check:

- `docs/architecture.md`: its auto-commit and docs-refs gate descriptions.
- `docs/BACKLOG.md`: the "Shift the `--pr` artifact-format gates left" entry, which is partly delivered.

## Known Risks

- **Fix session widens scope.** Mitigated by the scope guard (AC-5).
- **Agent failure after routing parks a done phase.** At implement this happens inside `checkAndRoute` under the park wrapper; at the review-entry retry it happens outside the wrapper. Both entry points must catch fix-session failures locally (AC-4, AC-6).
- **Unrelated broken refs elsewhere in the repo** would trigger a fix-up loop the agent can't satisfy. Filtering to the phase's own artifacts prevents that (AC-3).
- **Cost and departure from #10.** #10 prefers never resuming the implement model for mechanical errors. Resuming it here, possibly at XL/delicate effort, costs one short turn. It is preferred over a deterministic rewrite because choosing the right replacement path needs judgment. The 2-attempt bound caps the cost.
- **Proactive check slows implement slightly** on every run: one checker invocation per auto-commit attempt.
- **Headless prompt contract conflicts.** `CODEX_HEADLESS` and `CLAUDE_HEADLESS` tell the agent to finish by running the phase command. The fix-up prompt must say explicitly that the phase is already complete and that no phase command should run. Otherwise a resumed agent may flip phase state.
- **Checker path vs cwd.** The `--pr` gate resolves the script from REPO_ROOT but runs it in the worktree. The fix-up must scan the tree the commit is made from, which is the worktree.

## Human Test Plan

1. Run a task whose implementer writes a handoff citing a file path that doesn't exist.
2. Expected: the run continues on its own, and the log notes the implementer was asked to fix its handoff. Review starts normally.
3. Run a task that deletes a file and whose QA summary mentions that file.
4. Expected: QA fixes its own summary before finishing, and opening the PR doesn't stop on a broken reference.
5. Expected: if the agent can't fix it after two tries, the run stops (implement) or warns (QA) the same way it did before, and tells you what's broken.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps (fast tier) — N/A
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has entries marked `- [x]`
- [x] Bug fix: confirmed mechanism (adopter exit markers + code trace); AC-1 (implement) and AC-7 (QA) are red-first
- [x] Refactor audit — N/A
