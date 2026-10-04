# Implementation Handoff: affected-files-fail-closed

> Author: Codex | Spec: `tasks/affected-files-fail-closed/spec.md` | Plan: `tasks/affected-files-fail-closed/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/git.ts` | Return the discriminated AffectedFilesResult directly from the existing three-dot git probe, preserving stderr and rename paths. Leave getPathsInRange unchanged. |
| `src/orchestrator/main.ts` | Fail closed for advancing full-send reviews; preserve SPEC GAP and requested-change precedence. Report unreadable task-changed diffs before the force override in the PR/push drift gate. |
| `src/orchestrator/phases/code-review.ts` | Share the full-send exemption predicate and scope-failure reason builder. Block unreadable scope before handoff classification, without invoking review agents or consuming pre-flight rejection counters. |
| `src/orchestrator/phases/implement.ts` | Warn on probe failure, continue implementation, and pass null to the affected-files prompt block. |
| `src/orchestrator/prompts/index.ts` | Render a distinct failed-diff note that requires the full check matrix; retain existing successful-empty and file-list wording. |
| `tests/run-task-code-review.test.ts` | Add single-task and bundle failure routing regressions and both full-send modes of the pre-flight regression. Update existing stubs only for the result shape. |
| `tests/run-task-safety.test.ts` | Fail only the three-dot origin/base probe in fake git and test both default and force failure paths, proving tree drift succeeded and no commit occurred. |
| `tests/run-task-validation.test.ts` | Real-git regression covers empty success, modifications, both sides of a rename, and nonexistent-base failure without a files field. |
| `tests/run-task-prompts.test.ts` | Test failed-diff rendering across fresh, revision, and reroute prompt builders. |
| `dist/orchestrator/run-task.js` | Regenerate the orchestrator bundle. A second build reproduces both bundles byte-for-byte; the CLI bundle is unchanged. |
| `docs/patterns.md` | Document the explicit result contract, guarded failure behavior, lenient prompt hints, and required pre-flight ordering. This doc is root-only in the managed-file registry. |

## Canon Governance

The authoritative provenance stamp remains in status.json.canon.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

An unreadable committed diff now has an explicit failure variant without a files field. Every production caller narrows the result before reading paths. Scope guards halt with the git error; implementation continues with conservative validation instructions.

The full-send success and failure paths use one exemption predicate. A SPEC GAP still halts the whole bundle with FIX/BLESS guidance and a scope-failure note. Requested changes still reroute the whole bundle to implementation. Only otherwise-advancing bundles receive the new post-review scope-failure block.

The PR/push task-changed probe runs before the force branch when tree drift is present. This makes the required no-bypass message accurate while preserving the successful-diff force override. No git semantics, dependency, persistent schema, or CLI options changed.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Minor test organization: initialize failing router fixtures inside the parameterized test instead of introducing a separate setupFailingBundle helper; combine real-git success/failure assertions in one test. | Fixtures are used once per case and retain the existing real-git subprocess harness. | All specified cases and assertions retained; empty success is also covered. |
| Fake-git three-dot switch is nested at the start of the existing non-cached diff branch. | The exact origin/base...HEAD range still uniquely selects the new failure while leaving existing argv patterns intact. | AC-4 pins both tree and task-diff argv and reports successful drift. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Discriminated result preserves stderr; real temp repo covers empty success, modification and rename paths, and failed base without files. Structural check finds no silent-empty collapse. |
| AC-2 | Met | Red-first single/bundle approved cases now exit 2 and block every member with verdicts and git error. SPEC GAP guidance and requested-change reroutes retain precedence. Existing bundle exemption test passes unchanged. |
| AC-3 | Met | Both full-send modes block before the git-diff handoff issue can become a format rejection: no review agents, no rejection counter increment, no rejection verdict or review block. |
| AC-4 | Met | Red-first default and force tests report unreadable task-changed files and git error; tree drift succeeds, no rebase classification appears, and no commit occurs. |
| AC-5 | Met | Failure flows to null without terminating implement; all three prompt builders render conservative checks without claiming no prior commits. Existing prompt goldens pass unchanged. |
| AC-6 | Met | Full suite passes, including existing full-send, scope and drift cases. One existing linked-worktree fixture is automatically skipped by its environment guard; details below. Existing assertions were not weakened. |
| AC-7 | Met | Built orchestrator output is regenerated; a second fresh build matches both bundles byte-for-byte. CLI bundle remains unchanged. |

## Edge Cases Considered

- A successful empty diff remains distinct from a failed probe and keeps the existing prompt wording.
- Rename detection still emits both pre-image and post-image paths with the same git argv.
- SPEC GAP takes precedence over an approved sibling; requested changes and the legacy alias take precedence over advancing siblings.
- Empty stderr renders as unknown error. Block reasons and new operator messages contain no canon-ai source paths.
- Unreadable scope does not consume reviewer/pre-flight counters; the existing auto-block mechanism records the halt.
- Force still permits verified drift, but does not bypass an unreadable task-changed diff.

## Blockers

- [ambiguity] The plan notes ask the human to confirm whether --force should bypass this probe. In this headless session I interpreted the spec's explicit "No --force bypass" non-goal and required message as authoritative: a failed three-dot probe blocks even with --force. This is implemented and tested; no AC remains blocked.

## Red-First Evidence

Before editing production code, ran:

```sh
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='unreadable|only the task-changed diff fails' tests/run-task-code-review.test.ts tests/run-task-safety.test.ts
```

The run exited 1: eight failures and three passes. The approved single-task and approved/approved_with_nits bundle cases exited 0 rather than 2. Both pre-flight cases produced changes_requested format rejections instead of exit-2 blocks. For this pre-fix run their affected-files stub returned the existing [] failure equivalent; it now returns the explicit failure result. Both SPEC GAP cases lacked the git-error scope annotation. The default drift path printed the base-advanced/rebase advice; the force path exited 0. The three requested-change cases already rerouted successfully.

After the fix, the same regressions plus contract and prompt checks ran with:

```sh
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='unreadable|only the task-changed diff fails|getAffectedFiles|prompt builders render' tests/run-task-code-review.test.ts tests/run-task-safety.test.ts tests/run-task-validation.test.ts tests/run-task-prompts.test.ts
```

All 13 passed. The final full suite also passed these tests after the test fixture typing and lint fixes.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final run exited 0; no suppressions added. |
| `npm run type-check` | Pass | Final run exited 0; all caller and dependency-stub return shapes are checked. |
| `npm run build` | Pass | Completed before npm test. A second fresh build produced byte-identical bundles; CLI output unchanged. |
| `npm test` | Pass | 1,348 tests: 1,347 passed, 0 failed, 1 skipped. Existing test “REPO_ROOT stays anchored to the supervising checkout when imported from a linked worktree” in tests/run-task-safety.test.ts was automatically skipped because .git writes are restricted in this environment. No new tests were skipped. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| Targeted regression checks | Pass | 13 targeted cases passed after confirming the required red-first failures described above. |
| Structural collapse check | Pass | No getPathsInRange call collapsed to an empty array in src. |
| Unchanged CLI bundle and prompt goldens | Pass | git diff --exit-code returned 0 for both files. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Remove the unreadable-scope SPEC GAP assurance about a later PR gate from both reason and banner. Require repairing the base/history and rerunning, or manually verifying scope before blessing. Put git stderr on its own line and fix the neighboring missing space. |
| `src/orchestrator/phases/code-review.ts` | Broaden the scope-failure hint to include shared history with HEAD and resolving the reported git error. |
| `src/orchestrator/phases/implement.ts` | Make the failed-diff warning accurate for resumed sessions: the full check matrix applies, without claiming which prompt branch receives it. |
| `tests/run-task-code-review.test.ts` | Strengthen AC-2 single/bundle SPEC GAP assertions against the false assurance and for manual verification and separate git-error text. Record handoff-probe invocation in AC-3's stub so the existing event assertion directly proves it is skipped. |
| `dist/orchestrator/run-task.js` | Regenerate messages in the orchestrator bundle; fresh rebuild reproduces both bundles byte-for-byte and the CLI bundle remains unchanged. |

### Findings addressed

- **Correctness Bug 1:** Verified that the base-drift helper returns fetchFailed and skips its check when origin/base cannot be fetched. Removed the new unreadable-scope branch's promise that a later PR check will reject out-of-scope files. Both the escalation reason and displayed SPEC GAP banner now require verification before blessing; FIX/BLESS guidance and bundle routing remain intact.
- **Optional nit 1:** Broadened the recovery diagnostic beyond a missing recorded base. Did not adopt the suggested task-set command: the current taskSet implementation locks base_branch once a branch is recorded, which makes that command unavailable for these post-implementation blocks. The message asks for a valid base and shared history and keeps the git error and rerun command.
- **Optional nit 2:** Removed the implement warning's claim about the selected prompt; its validation instruction now holds on resume as well.
- **Optional nit 3:** Moved full git stderr out of the SPEC GAP parenthetical and onto its own Git error line in both surfaces.
- **Optional nit 4:** Added the missing space before Recovery options in the neighboring successful-diff scope note.
- **Optional nit 5:** Added an event to the handoff-diff stub. The assertion that only verifyBranch ran now directly pins the early block before that probe.
- **Optional nits 6 and 7:** Deferred. The operator-doc addition and mirror are outside Affected Files; the pre-existing sibling evidence-probe issue is a separate follow-up. No edits made for either.

### Red-first evidence

Before production edits, strengthened the existing AC-2 SPEC GAP cases and ran:

```sh
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='unreadable full-send scope preserves bundle precedence:.*spec_gap' tests/run-task-code-review.test.ts
```

Both cases failed (exit 1) specifically because the single-task and approved/spec_gap bundle banners contained the prohibited assurance about the later PR gate. After the fix, the unreadable-scope regression group passed all nine cases, including both pre-flight modes and all specified bundle precedence cases. The complete four affected suites then passed.

### AC deltas

| AC | Status | Notes |
|---|---|---|
| AC-2 | Met | Scope failure annotation still contains the git error and preserves SPEC GAP precedence, now with accurate before-blessing guidance and no unsupported assurance. Regression assertions strengthened. |
| AC-3 | Met | Existing block/counter/artifact assertions retained; stub events now directly verify the handoff probe was skipped. |
| AC-5 | Met | Prompt behavior unchanged; warning now also applies accurately on resume. |
| AC-6 | Met | All executable tests in the four affected suites pass; the existing linked-worktree environment skip is disclosed below. |
| AC-7 | Met | Rebuilt output matches a second fresh build. CLI bundle and prompt goldens unchanged. |

### Deviations and Blockers

No new blockers or scope expansion. The plan's original unreadable-scope assurance was removed as required by Correctness Bug 1; the spec requires an error annotation, not that assurance. The suggested optional task-set recovery command was omitted after verifying its post-branch lock. The initial handoff's force interpretation remains unchanged.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Exited 0. |
| `npm run type-check` | Pass | Exited 0. |
| `npm run build` | Pass | Completed before tests. A second fresh build reproduces both bundles byte-for-byte. |
| Affected test suites | Pass | Direct Node runner executed all tests in tests/run-task-code-review.test.ts, tests/run-task-safety.test.ts, tests/run-task-validation.test.ts, and tests/run-task-prompts.test.ts: 536 tests, 535 passed, 0 failed, 1 skipped. The existing REPO_ROOT linked-worktree fixture skips when .git writes are restricted. This was a scoped run, not another full npm test run. |
| Targeted regression checks | Pass | Nine unreadable-scope cases passed after the two expected red-first failures documented above. |
| `npm run docs-refs-check` | Pass | All refs OK; rerun after the artifact append as well. |
| Unchanged CLI bundle and prompt goldens | Pass | git diff --exit-code returned 0 for both files. |
| `git diff --check` | Pass | No whitespace errors. |
| Cumulative handoff coverage | Pass | Compared git diff main...HEAD --name-only with the union of baseline and iteration Changes tables; all 11 cumulative source/doc/test/build paths are covered. |

---

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Remove plain-rerun advice from both unreadable-scope SPEC GAP messages. Require repairing the base/history before choosing FIX or BLESS, with manual scope verification before blessing. Remove leading spaces from both scope-note variants. |
| `tests/run-task-code-review.test.ts` | Strengthen single-task and approved/spec_gap bundle assertions to reject plain-rerun wording in the banner and escalation reason, while explicitly retaining the FIX command with --reroute. |
| `dist/orchestrator/run-task.js` | Regenerate the corrected recovery messages. |

### Findings addressed

- **New correctness finding 1:** Replaced the scope-note recovery advice in both stored reason and displayed banner with the review's suggested wording. Repairing the base/history is now a prerequisite to choosing the existing recovery options, rather than a recommendation to run another review independently. FIX still requires an amendment and --reroute; BLESS still requires explicit acceptance and manual scope verification. No routing or gate changes were needed.
- **Optional nit 1:** Removed the leading space from both scopeNote variants while editing the same lines; the enclosing reason already supplies the separator.
- **Optional nits 2–4:** No further changes. Nit 2 is informational; the optional precedence-matrix expansion and human-test-plan clarification are deferred in this tightening pass.
- **Validation evidence:** Ran the full npm test suite this iteration, so the current handoff supplies the complete test evidence rather than relying on the reviewer's Round 2 run.

### Red-first evidence

Before production edits, added the negative rerun assertions and positive FIX/--reroute assertions to AC-2's existing SPEC GAP cases, then ran:

```sh
node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='unreadable full-send scope preserves bundle precedence:.*spec_gap' tests/run-task-code-review.test.ts
```

Both cases failed (exit 1) because the single-task and mixed-bundle banners contained “and re-run, or”. After correcting the messages, the same command passed both cases, including the stored-reason assertions and preserved FIX/--reroute guidance. The full suite also passed afterward.

### AC deltas

| AC | Status | Notes |
|---|---|---|
| AC-2 | Met | Unreadable scope still annotates the SPEC GAP halt with the git error, and recovery guidance now stays within FIX/BLESS. Existing precedence and block assertions remain intact. |
| AC-6 | Met | Full suite passed with no failures; one existing environment-guarded fixture skipped, as disclosed below. |
| AC-7 | Met | Rebuilt output matches a second fresh build; CLI bundle unchanged. |

Other ACs are unchanged. No new blockers, ambiguities, or scope deviations.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Exited 0. |
| `npm run type-check` | Pass | Exited 0. |
| `npm run build` | Pass | Completed before npm test; second fresh build reproduces both bundles byte-for-byte. |
| `npm test` | Pass | Full suite: 1,348 tests, 1,347 passed, 0 failed, 1 skipped. The existing REPO_ROOT linked-worktree fixture in tests/run-task-safety.test.ts automatically skips because .git writes are restricted in this environment. No new tests skipped. |
| Targeted regression checks | Pass | Both strengthened single-task/mixed-bundle SPEC GAP cases passed after the expected red-first failures. |
| `npm run docs-refs-check` | Pass | All refs OK, including after this artifact append. |
| Unchanged CLI bundle and prompt goldens | Pass | git diff --exit-code returned 0 for both files. |
| `git diff --check` | Pass | No whitespace errors. |
| Cumulative handoff coverage | Pass | All 11 paths in git diff main...HEAD --name-only are covered by the combined Changes tables; all three revision source/test/build paths are also covered. |
