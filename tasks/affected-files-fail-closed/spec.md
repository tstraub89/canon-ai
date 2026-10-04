# Spec: affected-files-fail-closed — getAffectedFiles fails closed on git diff failure

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`getAffectedFiles(baseRef, cwd)` in `src/orchestrator/git.ts` returns `getPathsInRange(`${baseRef}...HEAD`, cwd) ?? []`. `getPathsInRange` returns `null` when `git diff <range> --name-status -M -z` fails, and it discards the git stderr. `getAffectedFiles` then turns that `null` into an empty list. A caller can't tell "the task branch changed nothing" apart from "the diff could not be read." Every caller that uses the list as a scope guard therefore **fails open**.

**Confirmed mechanism (deterministic, confirmed by trace and by running git):**
- Running `git diff no-such-base...HEAD --name-status` in this repo exits `128` with `fatal: ambiguous argument 'no-such-base...HEAD': unknown revision or path not in the working tree.`
- `gitSafeAtRaw` reports that exit as `{ ok: false }`, `getPathsInRange` returns `null`, and `getAffectedFiles` returns `[]`.
- `getBaseBranch` does not check that the base branch exists. So a stale or mistyped `base_branch`, a deleted local base, or any other git error reaches this path.

The defect was found by a GPT-6 Luna xhigh replay of the cold-Codex review on tstraub89/canon-ai#66 (commit `4a23fac`). It is still present on `main`.

**Per-caller audit.** These are all of the callers in `src/`, confirmed by grep; `templates/` has none.

| Caller | Role | Effect of `[]` today | Disposition |
|---|---|---|---|
| **B** — `checkAndRoute()` full-send post-review scope check in `src/orchestrator/main.ts` (`splitGit.getAffectedFiles(baseBranch, cwd)`) | Scope guard | `findUnjudgedFullSendFilesFromData` gets an empty list, so `unjudged` is empty and an **approved full-send review advances to QA with scope never verified**. On a `spec_gap` verdict, `specGapScopeFiles` is also empty, which silently drops the "`--pr` will still reject these files" note. In the normal flow, a persistent diff failure is caught by C first (today as a misroute), so B is reached only when the failure starts after C's pre-flight passed, or on a recovery path. B is defense in depth. | **Follow existing bundle precedence:** block only a bundle that would otherwise advance; annotate `spec_gap`; leave reroutes alone |
| **C** — `runCodeReviewPhase()` pre-flight in `src/orchestrator/phases/code-review.ts` (`deps.getAffectedFiles(baseBranch, activeCwd)`) | Scope guard and regression-classification input | The out-of-scope block (`verifyBaseDriftFromData` → auto-block) is skipped. The `classifyPreflightBlockers` check "Fail – unrelated cites a changed file" (gated on `changedFiles.size > 0`) is also skipped. In production, `verifyHandoffAgainstDiff` runs its own three-dot diff and, on failure, returns the bundle-wide issue `git diff failed: …`. That issue is classified as a handoff **format** problem, so `determinePreflightRoute` **reroutes to implement**. The run becomes a re-implement loop framed wrongly, when it should block. | **Block** — explicitly, before the handoff pre-flight classification can route |
| **A** — `commitHumanReviewFiles()` `--pr`/`--push` base-drift path in `src/orchestrator/main.ts` (`splitGit.getAffectedFiles(`origin/${baseBranch}`, cwd)`) | Classification for an abort message | Every path still ends in `die()`, so the gate stays closed. But an empty set puts every drifted file in "base advanced", and the operator is told to rebase even when some files are task-changed and out of scope. The advice is wrong; nothing is bypassed. | **Block with a correct message** — keep `die()`, report that the task-changed files could not be computed |
| **D** — implement phase in `src/orchestrator/phases/implement.ts` (`getAffectedFiles(baseBranch, activeCwd)`) | Prompt hint only (`buildAffectedFilesBlock` in `src/orchestrator/prompts/index.ts`) | Renders "No prior commits on this task's branch yet…". That is conservative (every check runs) but false on revision and reroute rounds. Not a gate. | **Benign — stay lenient** and render a distinct "could not determine" note instead of the false "no prior commits" claim |

The other callers of `getPathsInRange` (the delta-scope probes in `code-review.ts` that feed `resolveCodeReviewScope`) already keep `null`, and `pipeline-policy.ts` already turns it into a full review. They fail closed today and are out of scope.

This matches the existing pitfall in `docs/patterns.md` §"Write-safety guards must fail closed when the underlying probe errors". Sibling helpers in `git.ts` already follow it: `getTreeDriftFiles` returns `{ files, ok, stderr }`, and `getUnpushedBaseCommits` returns `{ commits, ok, stderr }`.

## Decision

Replace the silent-empty contract with an explicit result: a discriminated union, `{ ok: true; files: string[] } | { ok: false; stderr: string }`. The failure variant has no `files` field, so TypeScript forces every current and future caller to narrow on `ok` before it can read a file list. This is deliberately stricter than the sibling `getTreeDriftFiles` shape, which still carries `files: []` on failure. On diff failure `getAffectedFiles` returns `ok: false` with the git stderr, never an empty list that looks like success. The `?? []` collapse must not exist after this change. `getPathsInRange` drops stderr and its signature is frozen (Non-Goals), so `getAffectedFiles` stops delegating to it and calls `gitSafeAtRaw` and `parseNameStatusOutput` directly with the same diff arguments, the way `getTreeDriftFiles` does. Every caller branches on `ok`:

- **B (full-send router):** on `ok: false`, B keeps today's bundle routing precedence. The bundle is judged as a whole, the same way `findUnjudgedFullSendFilesFromData` judges it, and the first matching rule wins:
  1. **Any member's verdict is `spec_gap`:** the existing SPEC GAP halt runs unchanged (FIX/BLESS guidance included, whole bundle blocked), even when a sibling is `approved` or requests changes. Where the "`--pr` will still reject these files" note would go, the reason says instead that scope could not be verified, and includes the git error.
  2. **Otherwise, any member's verdict is `changes_requested` or `needs_re_review`:** the bundle reroutes to implement as today, even when a sibling is `approved`. The next review re-runs the scope check, so nothing is skipped.
  3. **Otherwise** — the bundle would advance to QA, i.e. exactly the bundles whose scope `findUnjudgedFullSendFilesFromData` checks today (every member `approved` / `approved_with_nits`, or no recorded verdict): auto-block `code_review` and exit `2`, using the existing phase-gate block style (`warn` → `autoBlockPhase(taskIds, 'code_review', …)` → `process.exit(2)`). The reason says the task's scope could not be verified because the committed diff against the base branch could not be read. It names the recorded verdict(s), includes the git error, and ends with the re-run command (`canon run <ids>`). The bundle must not advance to QA.

  The block set for rule 3 must stay identical to the helper's non-exempt set, so the "which bundles are scope-checked" rule lives in one place. How the implementation shares it (reuse the helper's exemption predicate, or an equivalent) is a plan decision. `findUnjudgedFullSendFilesFromData`'s signature stays unchanged.
- **C (code_review pre-flight):** on `ok: false`, auto-block `code_review` with exit `2` and the same kind of reason. This check runs before the handoff pre-flight classification and routing, so the run is never rerouted to implement for a diff it could not read. It blocks whether or not the task is full-send.
- **A (`--pr`/`--push` drift abort):** on `ok: false`, still `die()`. Replace the base-advanced/out-of-scope classification with a message saying the task-changed files could not be computed against `origin/<base>`. Include the git error and "This failure cannot be bypassed with --force.", following the existing tree-diff failure message a few lines above.
- **D (implement prompt):** on `ok: false`, implement continues. The affected-files block says the committed diff vs the base branch could not be determined and tells the agent to apply the full default check matrix from *Validation Required*. It must not claim there are no prior commits.

Block reasons and messages reach adopters, so they must not cite canon-ai source paths (AGENTS.md §Adopter Scope).

## Non-Goals

- No change to `getPathsInRange`'s signature or its other callers (the delta-scope probes and `resolveCodeReviewScope` / `pipeline-policy.ts`), which already fail closed.
- No change to `verifyHandoffAgainstDiff`'s own diff or its `git diff failed:` issue text. C's new check makes that path unreachable on a probe failure, but the function stays as it is.
- No change to three-dot vs two-dot semantics, and no merging of `getAffectedFiles` with `getTreeDriftFiles`.
- No `--force` bypass, and no new CLI flag or env var.
- No base-branch existence check in `getBaseBranch` or at `canon run` entry. The fix sits at the guards that consume the diff.
- No retry logic for transient git failures.

## Acceptance Criteria

- [ ] **AC-1 (contract replaced):** `getAffectedFiles` returns the discriminated union `{ ok: true; files } | { ok: false; stderr }`. On a failing diff it returns `ok: false` with the git stderr (non-empty for the nonexistent-base case) and no `files` field. On success it returns `ok: true` and the same paths as before, renames on both sides included. A unit test in `tests/run-task-validation.test.ts`, next to the `parseNameStatusOutput` tests, covers both cases against a real temp repo, using a nonexistent base ref for the failure. Structural check: `grep -rn "getPathsInRange(.*) ?? \[\]" src/` returns no results. On pre-fix `main` it returns `src/orchestrator/git.ts:450`.
- [ ] **AC-2 (B follows bundle precedence — red-first):** Regression tests in `tests/run-task-code-review.test.ts` run `checkAndRoute` for all-full-send tasks in the existing real-git subprocess fixture (`runCheckAndRouteInFixture`; two-task bundles as in the existing "full-send bundle router" tests), with the three-dot diff made to fail (for example every member's `status.base_branch` set to the same branch that does not exist; nothing earlier in `checkAndRoute` reads the base ref). Cases:
  - **Single task `approved`, and bundle `[approved, approved_with_nits]`:** exit code `2`; `code_review` auto-blocked for every member with a reason that says scope could not be verified, names the recorded verdict(s), and includes the git error. On pre-fix code these fail because the subprocess exits `0` with `code_review` not blocked; exit code and blocked status are the red-first signal.
  - **Single task `spec_gap`, and bundle `[approved, spec_gap]`:** the existing SPEC GAP halt fires (exit `2`, FIX/BLESS guidance in the output, whole bundle blocked), and its reason includes the could-not-verify-scope note with the git error. The reason is the SPEC GAP reason, not the rule-3 scope-failure reason.
  - **Single task `changes_requested`, bundle `[approved, changes_requested]`, and bundle `[approved, needs_re_review]`:** the bundle reroutes to implement as today — exit `0`, `code_review` not blocked, and `implement` and `code_review` both back to `pending` (today's reroute-to-implement reset).
  - Every block reason above contains no canon-ai source paths (`doesNotMatch(/src\//)`).
  - The existing "full-send scope exemptions match routing verdicts across a bundle" test still passes unchanged, so the exemption set B uses on failure is the same set the helper uses on success.
- [ ] **AC-3 (C blocks before routing — red-first):** A regression test in `tests/run-task-code-review.test.ts` runs `runCodeReviewPhase` with `deps.getAffectedFiles` returning a failure result **and** `deps.verifyHandoffAgainstDiff` returning `['git diff failed: <stderr>']`, which reproduces the production misroute input. It asserts:
  - exit `2`;
  - `code_review` auto-blocked with a could-not-verify reason that includes the git error and no canon-ai source paths (`doesNotMatch(/src\//)`);
  - `code_review` **not** pre-flight-rejected: its verdict is not `changes_requested`, `preflight_rejections_current_loop` is unchanged, and `review.md` has no pre-flight rejection block;
  - the review agents were not invoked.

  A second case runs the same failure with `full_send: true` and asserts the same block. On pre-fix code (a stub returning `[]` is the closest pre-fix equivalent) the test fails because the `git diff failed:` issue is classified as a format problem and `code_review` is pre-flight-rejected with `changes_requested` instead of blocked.
- [ ] **AC-4 (A message correct — red-first):** A regression test in `tests/run-task-safety.test.ts` makes the base-drift tree diff succeed and report drift while only the three-dot `origin/<base>...HEAD` diff fails. This needs a new fake-git switch keyed on the three-dot range, since today's `diff` branch fails both together. Per the fake-git lockstep lesson, existing fake-git argv patterns stay correct. The test asserts:
  - the run dies;
  - the message says the task-changed files could not be computed, includes the git error and "cannot be bypassed with --force", and contains no canon-ai source paths (`doesNotMatch(/src\//)`);
  - the message does **not** contain the rebase/base-advanced classification;
  - no commit is made.

  On pre-fix code it fails because the message is the base-advanced classification.
- [ ] **AC-5 (D lenient):** When `getAffectedFiles` fails during implement, the phase still runs. The rendered affected-files block says the committed diff could not be determined, tells the agent to apply the full default check matrix, and does not contain "No prior commits". A prompt-level test asserts this. The existing renderings (empty success → "No prior commits"; non-empty → file list) are unchanged, and the existing golden entries in `tests/run-task-prompts.golden.json` still pass without regeneration.
- [ ] **AC-6 (existing behavior intact):** All existing tests in `tests/run-task-code-review.test.ts` and `tests/run-task-safety.test.ts` pass, including the full-send router accept/block cases, the scope pre-flight block cases, and the base-drift gate tests. Stubs are updated only for the new return shape (for example `() => ({ ok: true, files: [...] })`), never by weakening assertions.
- [ ] **AC-7 (build artifact):** `npm run build` regenerates `dist/orchestrator/run-task.js`, and the committed `dist/` matches a fresh build. `dist/cli/index.js` does not bundle these modules and should be unchanged.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/git.ts` | `getAffectedFiles` returns the discriminated union. It calls `gitSafeAtRaw` and `parseNameStatusOutput` directly so stderr is kept, instead of delegating to `getPathsInRange`. Remove the `?? []` collapse. |
| `src/orchestrator/main.ts` | Full-send router in `checkAndRoute()`: on `ok: false`, keep the `spec_gap` → requested-changes → advance precedence and block only a bundle that would advance (AC-2). `commitHumanReviewFiles()` drift path: `die()` with a could-not-compute message on `ok: false` (AC-4). Read `.files` on success at both sites. |
| `src/orchestrator/phases/code-review.ts` | `CodeReviewPhaseDeps.getAffectedFiles` type follows the new shape. Explicit fail-closed block before the handoff pre-flight classification and routing (AC-3). Read `.files` on success. If the plan shares the scope-exemption rule with B by extracting a predicate from `findUnjudgedFullSendFilesFromData`, it lives here; the helper's signature is unchanged. |
| `src/orchestrator/phases/implement.ts` | Pass a could-not-determine signal to the implement prompts on `ok: false` (AC-5). |
| `src/orchestrator/prompts/index.ts` | `buildAffectedFilesBlock` (and the implement prompt builders' parameter types, if needed) renders the distinct could-not-determine note (AC-5). |
| `tests/run-task-code-review.test.ts` | Update the `makeDeps` stub and overrides to the new shape. Add the AC-2 and AC-3 regression tests. |
| `tests/run-task-safety.test.ts` | Add a fake-git switch that fails only the three-dot diff. Add the AC-4 regression test. |
| `tests/run-task-validation.test.ts` | AC-1 unit tests (success and failure) against a real temp repo, next to the `parseNameStatusOutput` tests. |
| `tests/run-task-prompts.test.ts` | AC-5 prompt rendering test. |
| `dist/orchestrator/run-task.js` | Rebuilt output (AC-7). |
| `docs/patterns.md` | §"`getAffectedFiles` uses three-dot diff semantics": note the result shape and that callers must handle `ok: false` (QA-time update). |

### Interaction Dependencies

- `findUnjudgedFullSendFilesFromData`, `verifyBaseDriftFromData`, `classifyPreflightBlockers`, and `classifyBaseDriftFilesFromData` keep their signatures. They receive `.files` only on success.
- `autoBlockPhase` and the existing block-reason style (re-run command at the end). The auto-block increments `auto_block_count`, the same as the existing scope blocks.
- `verifyHandoffAgainstDiff` still runs its own diff. On a real git failure, C's new check fires first, so the misroute to implement can't happen.
- The `delicate: true` code_review full scope applies to this task itself.

### Data Model Changes

None. `status.json` is unchanged. The only change is the in-process return type of `getAffectedFiles` and the `CodeReviewPhaseDeps.getAffectedFiles` type.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added". Run after `npm run build` finishes, never at the same time.
- [x] `npm run build` — `dist/` must match a fresh build.
- [x] `npm run docs-refs-check` — `docs/patterns.md` references `getAffectedFiles` / `getTreeDriftFiles`.
- [ ] `<E2E>` — N/A, no UI surface.

## Docs Impact

- `docs/patterns.md` §"`getAffectedFiles` uses three-dot diff semantics" goes stale on the return shape. Add one line saying callers must treat `ok: false` as "cannot verify" (fail closed for guards). That section could also cross-reference the existing §"Write-safety guards must fail closed when the underlying probe errors". Also note that the code_review pre-flight's could-not-verify check must stay ahead of handoff classification: `verifyHandoffAgainstDiff`'s `git diff failed:` issue is still classified as a handoff format problem, so reordering would bring the misroute back.

## Known Risks

- **Over-blocking on a mistyped `base_branch`:** a task with a bad `base_branch` that used to slide through now auto-blocks at code_review. That is intended; the block reason must include the git error so the cause is obvious (an unknown revision names the ref).
- **C ordering:** if the new check runs after `classifyPreflightBlockers` / `determinePreflightRoute`, production still pre-flight-rejects (and later reroutes to implement) through `verifyHandoffAgainstDiff`'s `git diff failed:` format issue. AC-3 feeds that exact issue through the stub and asserts there is no pre-flight rejection, which pins the ordering.
- **B over-blocking non-advancing bundles:** an unconditional block — or an "any member approved" block — would cut off the SPEC GAP halt's FIX/BLESS guidance and legitimate `changes_requested` reroutes, including in mixed bundles where an `approved` sibling sits next to an exempt verdict (spec-review F1). AC-2's single-task and mixed-bundle cases pin the precedence: `spec_gap` first, then requested changes, then the scope-failure block.
- **B exemption drift:** if the failure path keeps its own copy of the exempt-verdict list, a future verdict added to `findUnjudgedFullSendFilesFromData`'s exemption could block on failure but not on success (or the reverse). The Decision requires one shared source for that rule.
- **Fake-git drift (A):** the current fake-git `diff` branch treats every non-`--cached` diff the same way. A switch keyed too loosely could fail the tree-drift diff too, and the test would then pass through the existing "could not compute base-drift diff" message instead of the new one. AC-4 asserts the drift diff succeeded (drift reported) and that the new message is present.
- **Stub-shape churn:** many tests override `deps.getAffectedFiles`. Type-check catches a missed override returning a bare array, and the discriminated union catches an unchecked `.files` read. At runtime, `.ok === undefined` is falsy, so a missed override blocks loudly rather than passing silently.
- **D golden drift:** changing the existing "No prior commits" wording would churn three golden entries. AC-5 forbids that; only the new failure branch adds text.

## Human Test Plan

1. Let a scratch task reach code review normally. Before code review starts, change the task's recorded base branch to a name that doesn't exist. Expected: code review stops before any reviewer runs, with a message that it could not verify the task's scope, showing git's "unknown revision" error. The task is not sent back for re-implementation.
2. Restore the correct base branch and re-run the task with the command the message suggests. Expected: code review proceeds normally.
3. (The full-send post-review check needs the failure to appear after the reviewers ran. That is covered by the automated tests, not by this manual plan.)

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed; *Acceptance Criteria* includes red-first regression-test ACs (AC-2, AC-3, AC-4)
- [x] (Refactors) N/A — bug fix
