# Code Review: artifact-lint-agent-fixup

> Reviewer: Claude | Spec: `tasks/artifact-lint-agent-fixup/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored = `STAGE_1: fail` / `changes_requested`; cold-Claude = 11 findings / `changes_requested`; cold-Codex = no actionable bugs (its test-suite run had not finished when it reported).

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

All required checks are recorded as Pass. But the handoff's own AC Coverage marks six ACs Partial, lists a `[validation]` Blocker for the missing integration cases, and leaves every Ready-for-Review box unchecked.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: implement fix-up succeeds (red-first) | Partial | The green path passes (`tests/run-task-safety.test.ts` "implement docs-refs fix-up resumes Codex…"). The red-first requirement is not met, and the `[wrong-premise]` Blocker is wrong. The anchored lens reproduced the cause: `installDocsRefsChecker` (`tests/run-task-safety.test.ts:417`) writes the hook as `exec node '<repoDir>/scripts/docs-refs-check.mjs'`, using the non-realpath temp dir. On macOS that is a symlink (`/var` → `/private/var`), so the checker's `import.meta.url === pathToFileURL(process.argv[1]).href` main guard is false. The checker then exits 0 without checking anything, and the hook never rejects. The premise holds; the fixture is broken. The green test also never checks that the commit landed (`git show HEAD:…handoff.md`). |
| AC-2: bounded fallback | Not Met | No test for: never fixed → 2 resumes → warning → hook rejects → `Auto-commit failed:` → status and counters equal the failing-hook test. This can't be tested until the hook fixture is fixed. |
| AC-3: no fix-up when nothing is wrong | Not Met | None of the four zero-invocation cases is tested: an unrelated hook failure, an absent checker, no `sessions.codex`, a finding only in review.md or docs/. Only the `filterArtifactFindings` unit test exists. |
| AC-4: review-entry retry | Partial | The success path is tested. The required "a failing fix session on this path falls back, does not crash" case is not tested. |
| AC-5: scope guard | Not Met | None of the three integration cases is tested: editing an already-dirty source file, editing `status.json`, editing a non-artifact file at QA. Only the `diffScopeSnapshots` unit test on hand-built maps exists; it never runs `snapshotOutsideArtifacts`. |
| AC-6: failed fix session never parks | Not Met | Neither case is tested: a non-zero resume at implement (stays `done`) or at QA (warns, reaches `human_review`). The code path looks right: `fixUpOwnArtifactRefs` catches `AgentSessionError` locally and treats a non-zero Codex exit as failure. |
| AC-7: QA fix-up | Partial | The fixed case passes and checks the committed blob. The red-first baseline is recorded in the handoff. The never-fixed case (2 attempts → warn → `human_review`) and the no-session case (warning, zero invocations, `human_review`) are not tested. |
| AC-8: prompt guidance | Met | `ARTIFACT_CITATION_RULE` is in all four templates. `promptArtifactFixup_implement` and `promptArtifactFixup_qa` golden keys exist, and the test asserts the phase is complete and that no phase command may run. |
| AC-9: restatements updated | Met | Covered in docs/pipeline-orchestrator.md (both sections) with its templates/ mirror, docs/decisions.md, and docs/architecture.md. |
| AC-10: build and checks | Met | Every required check is Pass and dist/ is rebuilt. The anchored lens re-ran the new safety tests and they pass. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [ ] Known Risks addressed or documented as accepted — the "Fix session widens scope" and "Agent failure after routing parks a done phase" mitigations rely on AC-5 and AC-6, and neither is tested
- [x] Human Test Plan is satisfiable by the implementation

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

Summary of gaps:
1. Fix the hook fixture. Resolve the path with `fs.realpathSync(repoDir)`, or invoke `node scripts/docs-refs-check.mjs` relative to the hook's cwd. Then redo the AC-1 red-first run, which should die with `Auto-commit failed:` on pre-change code, record it in the handoff, and drop the `[wrong-premise]` Blocker.
2. Add the missing integration cases the spec names explicitly. These are test-integrity / AC-coverage gaps, so they are code-bugs:
   - AC-2
   - AC-3, all four cases
   - AC-4, the failing-session case
   - AC-5, all three cases
   - AC-6, both entry points
   - AC-7, the never-fixed and no-session cases
3. In the implement green test, assert the commit actually landed and the committed handoff is fixed.

## Stage 2 — Code Quality (only if Stage 1 passed)

Not run as a gate, because Stage 1 failed. The cold lenses still ran. Their verified findings are below so the next iteration can fold them in; a real bug from a cold lens is still a bug.

### Summary

The core loop in `fixUpOwnArtifactRefs` (`src/orchestrator/main.ts:442`) is sound:
- the 2-attempt bound
- local `AgentSessionError` catch
- the guard runs before the `!ok` early return
- the checker runs in the commit tree with REPO_ROOT's script, as the `--pr` gate does

The validation.ts parser and runner are correct. The weaknesses are test coverage (Stage 1) and a few rough edges in the guard and the prompt text.

### Findings

#### Correctness Bugs

- **[code-bug] Hook fixture symlink path makes every `hook: true` fixture inert.** `tests/run-task-safety.test.ts:417`. Source: anchored lens, reproduced. The cold-Claude lens's test-integrity finding (happy-path-only coverage, no commit-landed assertion) is the same cluster, so this is flagged by 2 lenses. See Stage 1 gap 1.
- **[code-bug] Missing spec-required integration cases.** `tests/run-task-safety.test.ts`. Source: anchored + cold-Claude (2 lenses). See Stage 1 gap 2.

#### Risk / Guardrails

- **[code-bug] The implement fallback warning tells adopters something false.** `src/orchestrator/main.ts:449`, source cold-Claude, verified. The warning says "a pre-commit hook that runs docs-refs-check will reject the commit". Canon installs no such hook, and in an adopter repo without one the commit succeeds with the broken refs. This violates the AGENTS.md §"Adopter Scope" rule for runtime strings. Make the text conditional ("if a pre-commit hook runs docs-refs-check it will reject the commit; otherwise the `--pr` docs-refs gate will stop on them") or name the `--pr` gate only.
- **[nit] The scope-guard stop is not sticky.** `src/orchestrator/main.ts:493-496`. Flagged by anchored + cold-Claude (2 lenses), verified. `die()` exits, but nothing records the stop. On the next `canon run`, the review-entry retry snapshots a tree that already contains the out-of-scope edit, and the commit may sweep it in. The spec (§Decision 3) asks only for "the run stops… commits nothing", and that is met. Persisting a block would go beyond the spec. Kept as a nit: consider setting `blocked` on implement or QA with the changed paths so the re-run refuses until the operator clears it. Record the choice in the handoff either way.

#### Optional Cleanup / Nit

- `src/orchestrator/prompts/templates/qa.md:28`: the citation rule sits at column 0 inside step 4, between `{{/prTemplate}}` and `{{^prTemplate}}`. That breaks the list and makes the rule read as PR-body-only. Move it after the numbered list, or indent it as its own step. In `implement.md` the rule also runs into the "Append to tasks/<id>/notes.md" line with no blank line between them. Source: cold-Claude.
- `src/orchestrator/prompts/templates/implement-revisions.md:41`: two bold labels are stacked ("**Referencing deleted…**: **Citing files in task artifacts:** …"). Drop one. Flagged by anchored + cold-Claude (2 lenses).
- `promptImplementResume` (`src/orchestrator/prompts/index.ts`) also tells Codex to write handoff.md but lacks `ARTIFACT_CITATION_RULE`. AC-8 names only the four templates, so this is optional. Source: cold-Claude.
- When an implement fix-up resume exits non-zero, `runCodex` prints "will verify phase completion via status.json", which is misleading in a fix-up turn. Source: anchored.
- `snapshotOutsideArtifacts` doesn't record HEAD or the branch. A fix session that runs `git commit` or `git stash`, or switches branch, can get past the content guard. Snapshotting `rev-parse HEAD` and the branch, and comparing them after the session, is a cheap close. Source: cold-Claude. Low severity: the fix-up prompt restricts edits to the cited artifacts.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex): "No actionable bugs identified". Not a finding. It is superseded by the verified test-integrity gaps above. Codex reported before its test run finished and did not exercise the hook-fixture path.
- Dismissed (cold-Claude): QA fix-up resume falls back to a fresh session when the resume id is not found, and may resume an interactive QA session headless. The spec's Non-Goals explicitly accept the resume-not-found fallback ("that is accepted, because the scope guard still applies"). The bundle metrics label mismatch (`taskIds[0]` vs `join('+')`) is cosmetic.
- Dismissed (cold-Claude): `fixupTaskContexts` hard-codes iteration, loop and reroute counts to 0, so the model or effort could differ. Low confidence and not demonstrated. The spec asks for the same model/effort resolution as the guardrail retry. Re-check only if a model selector keys on iteration.
- Dismissed (cold-Claude): `runDocsRefsCheck` has no spawn timeout and uses REPO_ROOT's checker. The lens itself notes both match the existing `--pr` gate, and spec §Known Risks "Checker path vs cwd" prescribes this resolution.
- Dismissed (cold-Claude): the hard-coded exempt list could trip on other canon-written files under `tasks/<id>/`. Low confidence, and no concrete writer was named. Any other file a fix session writes, notes.md included, is outside the artifacts the spec allows it to touch, so stopping is the intended behavior (§Decision 3).
- Dismissed (anchored, implementation note): QA `lastClaudeSessionId` may be the failed first session when recovery ran a fresh one. Low confidence, and the resume-not-found fallback plus the scope guard bound the effect.

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.
-->

## Round 2 — verifying iteration 1's response to round 1

**Scope:** Delta — base `cadb24f08952d526248cff955675094b7a62ab7e` — reason: small fix within the files already under review

Lens returns:
- **Anchored:** `STAGE_1: fail` / `changes_requested`. Reviewed the full `main...HEAD` diff.
- **Cold-Claude:** 4 findings / `approve`. Reviewed the delta only.
- **Cold-Codex:** no actionable findings. Reviewed the delta only.

The handoff's revision section is headed `## Iteration 2 — addressing review round 1`. That is the section reviewed here; the orchestrator calls it "Iteration 1". The heading number is off by one, which is cosmetic.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: implement fix-up succeeds (red-first) | Partial | The fixture now resolves the checker with `fs.realpathSync` (`tests/run-task-safety.test.ts:419`), and the green test checks that the commit landed. The anchored lens confirmed red-first now reproduces: with `fixUpImplementArtifactRefs` disabled in a scratch copy, the focused test died with `Auto-commit failed: tasks/artifact-fixup-implement/handoff.md:16: … — missing file`. The handoff still calls red-first "unresolved" and does not record that run, which the AC requires. |
| AC-2: bounded fallback | Not Met | No never-fixed test exists (2 resumes, then a warning, then the hook rejects, then `Auto-commit failed:`, with status and counters matching the failing-hook test). The fixture blocker is gone, so this test can now be written. |
| AC-3: no fix-up when nothing is wrong | Not Met | None of the 4 zero-invocation integration cases is tested. |
| AC-4: review-entry retry | Partial | The success path is tested. The case where the fix session fails and the run must not crash is not tested. |
| AC-5: scope guard | Not Met | None of the 3 integration cases is tested: a dirty source file, `status.json`, and a non-artifact file at QA. |
| AC-6: failed fix session never parks | Not Met | Neither non-zero-exit case is tested, at implement or at QA. |
| AC-7: QA fix-up | Partial | The fixed case and its red-first baseline are covered. The never-fixed and no-session cases are not tested. |
| AC-8: prompt guidance | Met | The rule is present in all four templates, the golden file is regenerated, and the fix-up goldens are in place. Placement nit below. |
| AC-9: restatements updated | Met (unchanged from round 1) | The docs, the mirror and the decisions entry are in place. |
| AC-10: build and checks | Met | The re-run validation table shows every check passing, and dist is rebuilt. |

### Verifying Round 1 findings

- _code-bug:_ the hook fixture ran the checker through a symlink path, so the hook never fired. **Addressed** at `tests/run-task-safety.test.ts:419`. The anchored lens confirmed the hook now rejects.
- _code-bug:_ the green test did not check that the commit landed. **Addressed** at `tests/run-task-safety.test.ts:7442-7445`. See the cold-Claude nit below about the fixture row that makes the handoff-blob assertion pass.
- _code-bug:_ the spec-required integration cases were missing. **Still open.** The handoff's `[validation]` Blocker says so: AC-2; AC-3 ×4; the AC-4 failing-session case; AC-5 ×3; AC-6 ×2; and the AC-7 never-fixed and no-session cases.
- _code-bug:_ the warning at `src/orchestrator/main.ts:449` implied canon installs a pre-commit hook. **Addressed.** It now names the `--pr` gate and treats a hook as optional.
- _nit:_ qa.md placement of the rule. **Partially addressed.** See the new finding below.
- _nit:_ stacked bold labels in implement-revisions.md, and the scope-guard stop not being sticky. **Deferred** with rationale. Accepted.

### New findings

- **[code-bug, test integrity / AC coverage] The spec-required integration cases are still missing.** Flagged by the anchored lens; carried over from round 1. File: `tests/run-task-safety.test.ts`. Write the cases listed above. The fixture fix means AC-2's hook-rejects path can now be tested. Also update the handoff: record the AC-1 red-first run (pre-change `Auto-commit failed:` on the fixed fixture) and drop the "unresolved" wording.
- **[code-bug, low] The QA citation rule still sits inside step 4.** Flagged by 2 lenses (anchored and cold-Claude). File: `src/orchestrator/prompts/templates/qa.md:43`.
  - The column-0 paragraph sits between `{{/prTemplate}}` and step 4's indented "⚠️ Write as the human engineer…" and "Skip this step entirely for bundle tasks" lines.
  - So it still reads as part of the single-task pr-body step, which bundle QA is told to skip. It also breaks step 4's list continuation.
  - The handoff's claim that the rule "applies to both QA artifacts" doesn't hold as placed.
  - Fix: move it out of the numbered list, for example right after step 4 ends or as its own step, separated by a blank line. Then regenerate the golden.
  - This is low severity on its own, but the verdict is already changes_requested, so fix it in the same iteration.
- **[nit, test integrity] The committed-handoff assertion depends on a fixture-only Changes row.** Flagged by cold-Claude; the lens verified it by removing the row in a scratch copy. File: `tests/run-task-safety.test.ts:7407`.
  - The test adds `tasks/<id>/handoff.md` to the handoff's own Changes table so that `git show HEAD:…handoff.md` resolves.
  - The real proof that the fix-up ran before the hook is the `HEAD:initial-fixture.txt` assertion: the hook would reject the commit otherwise.
  - Add a comment saying the row is fixture-only, or drop the self-listing row and the handoff-blob asserts.
- **[follow-up, pre-existing, outside Affected Files] The checker's entry guard has the same symlink blind spot.** Flagged by cold-Claude. File: `scripts/docs-refs-check.mjs:951`.
  - The guard is `import.meta.url === pathToFileURL(process.argv[1]).href`. When the script is invoked through a non-canonical path, it exits 0 without checking anything.
  - `runDocsRefsCheck` would then report `clean`, and the `--pr` gate would pass silently.
  - In production, `REPO_ROOT` comes from git and is already canonical, so the trigger is rare. It does affect adopter hooks that call the script through a symlinked path.
  - The fix belongs in the guard: compare realpaths. That script is outside this spec's Affected Files and the behavior predates this diff. So it is not blocking here and should not be fixed in this task. Recommend a follow-up issue.

### Dismissed Cold Findings

- Dismissed (cold-Claude): the implement warning's "the --pr docs-refs gate will stop" ignores `--force`, and "Committing as before" sits awkwardly with "a hook may also reject". Low confidence, and the wording is accurate enough for an operator: `--force` is an explicit operator bypass. When a hook rejects, today's `Auto-commit failed:` die applies, as the spec intends (§Decision 1, "No fix").
- Dismissed (cold-Codex): no actionable findings. This is not a finding, and the delta did not touch the still-missing integration coverage.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

## Round 3 — verifying iteration 2's response to round 2

**Scope:** Delta — base `1b0b7742c12b42b8dd154e6999df298fea5d30f5` — reason: small fix within the files already under review

Lens returns:
- Anchored: `STAGE_1: pass` with AC-3 Partial; signal `changes_requested`. Reviewed the full `main...HEAD` diff.
- Cold-Claude: 8 findings (test-integrity and quality); signal `approve`. Reviewed the delta only.
- Cold-Codex: no introduced correctness issues. Reviewed the delta only.

The handoff section reviewed is `## Iteration 3 — addressing review round 2`. The orchestrator calls it "Iteration 2"; the off-by-one heading number is cosmetic. Under Round 3 discipline, nits and wording findings are folded below and do not drive the verdict.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: implement fix-up succeeds (red-first) | Met | The green test asserts the fixed handoff and the source blobs that were committed. Red-first was reproduced in Round 2: `Auto-commit failed: … missing file`. The handoff now cites that run. |
| AC-2: bounded fallback | Met | `tests/run-task-safety.test.ts:7586` asserts 2 resumes, the warning, `Auto-commit failed:`, exit 1, implement `done`, and counters at 0. The counter asserts use `?? 0` (nit below). |
| AC-3: no fix-up when nothing is wrong | Partial | Cases 1, 3 and 4 (the review.md variant) go through `main()` and assert zero resumes. Case 2 (checker absent) is tested only at the `runDocsRefsCheck` boundary, which never counts agent invocations. See the code-bug below. |
| AC-4: review-entry retry | Met | The failed resume on the review-entry path falls back, exits 0, and the source commit lands (`:1698`). |
| AC-5: scope guard | Met | A dirty source file, a `status.json` edit, and a QA non-artifact edit each stop the run. The stop names the path and the commit count stays at baseline. |
| AC-6: failed fix session never parks | Partial | Implement: a non-zero resume leaves implement `done` and falls through to the hook's die. QA: the test asserts exit 0, the warning, 1 resume and `phases.qa.status === 'done'`. But the completer sets that status before the fix-up runs. The test never asserts that the task "reaches `human_review`" or that `commitQaArtifacts` ran. See the code-bug below. |
| AC-7: QA fix-up | Met | All three variants are covered: fixed, never-fixed, and no session. The never-fixed and no-session cases assert the committed done.md. |
| AC-8: prompt guidance | Met | The qa.md citation rule now stands alone after step 4 (`src/orchestrator/prompts/templates/qa.md:46`). The golden is regenerated. |
| AC-9: restatements updated | Met (unchanged from round 2) | — |
| AC-10: build and checks | Met | The full-suite failure is recorded as `Fail – unrelated` at `tests/run-task-ship.test.ts:1529` (`git clone` exit 128), outside Affected Files. The anchored lens re-ran that file in isolation and got 69/69 passing, so the failure is transient. The 10 fix-up tests pass in the worktree, per both Claude lenses. |

### Verifying Round 2 findings

- _code-bug:_ spec-required integration cases missing. **Mostly addressed.** The remaining gaps are listed below.
- _code-bug:_ AC-1 red-first not recorded in the handoff. **Addressed** ✓.
- _code-bug, low:_ the QA citation rule sat inside step 4. **Addressed** ✓.
- _nit:_ fixture-only self-listing Changes row. **Addressed** with a comment ✓.
- _follow-up:_ symlink blind spot in the checker's entry guard. Still deferred as out of scope, as agreed.

### New findings

Both blocking items are narrow test-integrity gaps against ACs that name the case explicitly. Each needs one fixture variant or a couple of asserts; neither needs a source change.

- **[code-bug, test integrity] AC-3 case 2 (checker absent) has no zero-invocation test, and the handoff's reason for skipping it is wrong.** Source: anchored lens; the foreman verified it. Files: `tests/run-task-safety.test.ts:55` and the handoff's Iteration 3 Blocker.
  - The handoff says the case can't go through `main()` because the fix-up uses the package's own checker path. That is not so.
    - `REPO_ROOT` comes from `git rev-parse --git-common-dir` in the orchestrator's cwd (`src/orchestrator/env.ts:40-52`). That cwd is the fixture repo.
    - `installDocsRefsChecker` copies the checker into `<fixture>/scripts/` (`tests/run-task-safety.test.ts:409-412`).
  - Fix: add an implement fixture variant that skips `installDocsRefsChecker`. Give it a broken ref in handoff.md and a stored session, then assert 0 resumes and a normal commit.
  - Then drop the Blocker. Covering the QA absent-checker case the same way is optional.
- **[code-bug, test integrity] The AC-6 QA failed-resume case doesn't prove the run continued past the fix-up.** Flagged by 2 lenses (anchored and cold-Claude). File: `tests/run-task-safety.test.ts:7714-7721`.
  - `phases.qa.status === 'done'` is set before the fix-up, so it is not evidence.
  - Add the asserts the sibling cases already use: the top-level `status.status === 'human_review'` (the AC's stated expectation), plus `git show HEAD:tasks/artifact-fixup-qa-failed/done.md`.
  - Optional, and not required: make the implement failed-resume case also assert the `Artifact fix-up failed; remaining findings` warning. Today `hook: 'fail'` makes `Auto-commit failed:` appear whatever happens (cold-Claude).

Folded nits, which do not drive the verdict:
- AC-2 counters use `?? 0` where the reference test asserts a strict `0` and an unchanged HEAD (anchored).
- `assert.match(output, /human_review/)` is a weak proxy at `:7697` and `:7707` (anchored).
- `void root;` is dead code at `:7640/7649` (both Claude lenses).
- The `fix` option in `prepareQaFixupFixture` is unused (cold-Claude).
- The fake agent accepts the `--resume=*` form, which canon never passes (cold-Claude).
- The review-only case doesn't assert that the checker reported the review.md finding (cold-Claude).
- AC-3 case 4's `docs/` variant is untested; it goes through the same filter, so this is cosmetic (anchored).

### Dismissed Cold Findings

- Dismissed (cold-Claude): no end-to-end test for checker `kind: 'error'`, for re-check failure, or for a broken ref in `pr-body.md`. No AC names these branches; the AC-3 absent-checker gap above is the AC-required one. The code paths warn and continue by inspection. Worth adding if convenient, but not blocking at Round 3.
- Dismissed (cold-Claude): no "fails on attempt 1, fixed on attempt 2" case. Not AC-required, and the bounded loop is already covered by the never-fixed case.
- Dismissed (cold-Codex): "no introduced correctness issues." This is not a finding. The remaining gaps are missing assertions in tests, which a delta correctness review would not flag.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap
