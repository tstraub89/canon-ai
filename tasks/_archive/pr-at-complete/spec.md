# Spec: pr-at-complete — `canon run --pr` handles `complete` phase + idempotent on existing PR

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`canon run <id> --pr` (and `--push`) only handles dispatch inside the `human_review` phase (`scripts/run-task/main.ts:1244-1264`). Once a task's top-level status becomes `complete` — either because the user manually advanced `human_review` via `canon task phase <id> human_review done`, or because they're trying to re-run after a prior partial flow — `runPhase()` falls through to `die("Unknown phase: complete")` at `:1267`.

Two adopter-visible failures from this:

1. **Off-script-but-recoverable**: Someone reviews the diff locally, marks `human_review` done thinking that's the next step, then tries `canon run X --pr` to push and open a PR retroactively. Currently dies with an unfriendly "Unknown phase" message.
2. **Idempotent retry on an already-open PR**: Even within the `human_review` phase today, `commitHumanReviewFiles`'s `--pr` retry path (`:537-549`) only fires when **no open PR exists**. If a PR is already open (which is the normal state after a successful `--pr` ran once), the function falls through to `die("Human review commit aborted: no dirty task artifacts...")` at `:552`. Re-running `--pr` after a successful first run is hostile when it could be a no-op.

Filed as [issue #72](https://github.com/tstraub89/canon-ai/issues/72). James hit (1) on a TokenAnxiety task; (2) is a related sharp edge in the same code path.

## Decision

1. **Extend the dispatch in `runPhase()`** so the `human_review` branch also fires when the current phase is `complete`. Single handler covers both: `--pr` / `--push` go through `commitHumanReviewFiles`; no flags prints a friendly status message instead of dying.
2. **Make `commitHumanReviewFiles`'s `--pr` retry path idempotent on an existing open PR**. When the tree is clean AND `--pr` is set AND the branch is on origin AND an open PR exists, print the PR URL and exit 0 — do not die. This applies at both `human_review` and `complete` phases.
3. **At `complete` with no flags**, the friendly status message tells the user "task is already complete — use `--ship` to archive" rather than the current crash.
4. **The dirty-file allowlist enforcement stays exactly as it is** — adopters can still only commit task artifacts / managed docs / telemetry. `complete`-phase behavior must not relax this guard.

## Non-Goals

- **No reroute or reset of phases.** The fix only changes dispatch behavior at `complete`; it never moves a completed task backward into earlier phases. (`--reroute` is the separate mechanism for that.)
- **No new flags.** `--pr` and `--push` semantics stay the same; we just extend where they're valid.
- **No `--ship`-style behavior change.** `--ship` already accepts both `human_review` and `complete` (`:1002`); we're bringing `--pr`/`--push` to parity, not modifying `--ship`.
- **No change to bundle behavior.** Bundles already pin all tasks to the same phase via `assertSamePhase`; bundled tasks at `complete` will all dispatch through the new branch together.
- **No change to non-dirty-state logic at `human_review`.** When the tree is clean at `human_review` AND `--pr` is set AND no open PR exists, the existing path (create-PR-only) stays unchanged.

## Acceptance Criteria

- [ ] **AC-1**: `runPhase()` in `scripts/run-task/main.ts` accepts `complete` as a valid current phase for `--pr` and `--push` invocations. The implementation extends the existing `human_review` branch rather than adding a parallel one — single source of behavior.
- [ ] **AC-2**: At `complete` with `--pr` or `--push`, `commitHumanReviewFiles()` is called and produces one of these outcomes based on tree/remote/PR state:
  - Dirty tree (artifacts/managed docs uncommitted): commit + push + (if `--pr`) open or reuse PR.
  - Clean tree, branch on origin, open PR exists: print existing PR URL and exit 0.
  - Clean tree, branch on origin, no open PR (and `--pr` set): create draft PR only.
  - Clean tree, branch NOT on origin: push the branch + (if `--pr`) open PR.
- [ ] **AC-3**: At `complete` with no `--pr`/`--push` flag, the wrapper prints a **state-aware** status message and exits 0 (no longer dies). The implementation inspects three signals and chooses the matching block:

  | State | Detection | Message body |
  |---|---|---|
  | (A) Open PR exists | `findOpenPRNumber(branch)` returns non-null | `Open PR: #<num> (<url>)\nNext: \`canon run <id> --ship\` to merge + archive.` |
  | (B) Branch on origin, no open PR | `git rev-parse --verify origin/<branch>` succeeds AND `findOpenPRNumber` returns null | `Branch <branch> is on origin but no open PR.\nNext: \`canon run <id> --pr\` to (re)open the draft PR, or \`canon run <id> --ship\` if the work is already merged to <base>.` |
  | (C) Local branch unpushed | `git rev-parse --verify origin/<branch>` fails | `Local branch <branch> is not on origin.\nNext: \`canon run <id> --pr\` to push and open a draft PR. (For a no-PR flow, merge to <base> manually then run --ship.)` |

  All three messages sit inside the same banner frame:

      ════════════════════════════════════════════════════════
        TASK COMPLETE — already past human_review.

        <state-specific body>
      ════════════════════════════════════════════════════════

  Bundle tasks: when multiple tasks share a branch (typical), print one banner with the branch state. When tasks have distinct branches, print one banner per task.

- [ ] **AC-4**: `commitHumanReviewFiles()` is updated so that when the tree is clean AND `--pr` is set AND the branch is on origin AND `findOpenPRNumber(branchName)` returns a non-null PR number, the function prints `Existing draft PR: #<num> (https://github.com/<owner>/<repo>/pull/<num>)` and returns cleanly (no `die`). This new branch sits **above** the existing `openPR === null` retry branch at `:543`, so the open-PR case is handled before the no-open-PR case.
- [ ] **AC-5**: At `human_review` (not just `complete`), re-running `canon run X --pr` after a successful first run is a no-op with the existing-PR message above — proves AC-4 applies to both phases via the shared code path.
- [ ] **AC-6**: The dirty-file allowlist enforcement (`unexpected` check at `:555-562`) still rejects files outside the human-review allowlist. A task at `complete` cannot use `--pr` to push arbitrary working-tree changes.
- [ ] **AC-7**: `--ship` continues to fire at `complete` unchanged. A regression test that calls `--ship` on a `complete` task (existing `--ship` codepath) still produces the expected behavior.
- [ ] **AC-8**: New unit tests in `tests/run-task-safety.test.ts` (or a new sibling test file if more appropriate) cover:
  - Dispatch: `runPhase` called with `phase = 'complete'` and `cliArgs.pr = true` invokes the human-review handler path.
  - Dispatch: `runPhase` called with `phase = 'complete'` and no flags prints the matching state-aware message (A / B / C per AC-3) and exits 0. Test each of the three states with mocked branch/PR signals.
  - Idempotency helper: a pure helper (extracted from the idempotency logic, e.g., `formatExistingPRMessage(branch, prNum, repoSlug)`) returns the expected string for given inputs.
  - The dirty-file allowlist guard still rejects unrelated files when phase is `complete`.

  Where the existing test patterns require process-level mocking that's hard to do cleanly (most of `commitHumanReviewFiles` involves `gitSafeAt`, `runCommand`, etc.), prefer testing extracted helper functions over end-to-end. Implementer's call whether to refactor for testability or leave deeper coverage to manual smoke. If unit tests for the dispatch are infeasible without significant refactoring, document in handoff and rely on manual smoke for that portion.
- [ ] **AC-9**: `CHANGELOG.md` gets a `### Fixed` entry under the in-progress `## [1.1.4] — unreleased` block (already exists after PR #73) describing the crash fix, the idempotent retry, and the friendly `complete` status message. Reference issue #72.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | (1) Extend the `human_review` dispatch branch at `:1244` to also trigger when `phase === 'complete'`. The handler body stays the same except the "no push requested" message branches on phase (`human_review` keeps its message; `complete` gets the new "task complete" message per AC-3). (2) Update `commitHumanReviewFiles()` at `:537-549`: add a new check before the existing `openPR === null` branch that handles the `openPR !== null` case — print URL + return. ~20-25 lines total. |
| `tests/run-task-safety.test.ts` (or new sibling) | Tests per AC-8. ~30-40 lines. |
| `CHANGELOG.md` | `### Fixed` entry under `## [1.1.4]` referencing #72. |
| `dist/scripts/run-task.js` | Regenerated build output (automatic via `npm run build` + postbuild normalize from #74). |

### Interaction Dependencies

- `--ship` already supports both `human_review` and `complete` at `:1002`. This change brings `--pr`/`--push` to parity but doesn't touch `--ship`.
- `findOpenPRNumber` (`:840`) and `createDraftPRForTask` (`:503`) are reused — no new helpers needed for the PR-create side.
- `gitSafeAt` and `gitSafeAtRaw` are reused — no new wrappers needed.

### Data Model Changes

None. The fix is dispatch and CLI-message logic; no `status.json` schema changes.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — must include the new AC-8 tests
- [x] `npm run build` — dist/ regenerated; postbuild normalize ensures reproducibility
- [ ] E2E — N/A

## Docs Impact

- `CHANGELOG.md` — covered by AC-9.
- `templates/CLAUDE.md` "Opening a PR (at human_review)" section currently only mentions `human_review` as the trigger phase. No change needed: that documentation still describes the canonical flow correctly. The `complete`-phase support is a recovery affordance for off-script paths, not a new documented happy path.

Beyond that, the user-facing surface of canon doesn't expose any new behavior worth documenting elsewhere. Adopters who hit "Unknown phase: complete" today will instead see either the actual `--pr` succeeding or the friendly "task complete" message.

## Known Risks

1. **The existing dispatch at `:1244` uses `(phase as Phase) === 'human_review'`** — note the cast from `CurrentPhase` to `Phase`. Extending the check to include `complete` requires comparing against `'complete'` as a string, since `complete` isn't a `Phase`. The right shape is something like `if (phase === 'human_review' || phase === 'complete')`. TypeScript should narrow correctly without further casts; verify during implement.
2. **`commitHumanReviewFiles` constructs PR URLs.** The existing code calls `createDraftPRForTask` which prints the URL on success, but the idempotent existing-PR branch in this spec needs to construct the URL itself. Use `gh pr view <num> --json url --jq .url` for the canonical URL, or fall back to `https://github.com/<owner>/<repo>/pull/<num>` if `gh pr view` fails. The owner/repo can come from `git remote get-url origin` parsing. Implementer's choice — prefer `gh pr view` for correctness when available.
3. **Bundle tasks at `complete`**: if a bundle's tasks all reach `complete`, `--pr` should print one existing-PR message per branch (deduped). The shared branch case (most bundles) means one message. Verify the dedup logic in `commitHumanReviewFiles` already handles this — branches are derived from the bundle's tasks via `mergeOpenPRsAndPull`'s `branches` set pattern (`:860`).
4. **No `--ship` interaction surprises.** `--ship` already accepts both `human_review` and `complete`. Adding `--pr` at `complete` doesn't change `--ship`'s behavior in any phase. Worth a one-line sanity test (AC-7) just to lock it.
5. **`canon run X` (no flags) at `complete` previously died** — anyone scripting around the failure (catching exit code, parsing stderr) will now see exit 0 with the new message. If anyone built an idempotent automation around the failure as a signal, that automation will need updating. Unlikely but worth noting.

## Human Test Plan

1. Take any in-progress task at `human_review` (or create one cheaply via `canon task new` + manual phase advances). Manually mark it complete: `canon task phase <id> human_review done`. Verify `canon task list` shows the task at `complete`.
2. Run `canon run <id> --pr`. Expected: artifacts commit (if dirty) + push + draft PR creation OR (if PR exists) friendly message with the PR URL. Should NOT crash with "Unknown phase: complete".
3. Re-run `canon run <id> --pr` immediately. Expected: friendly "Existing draft PR: #N (URL)" message, exit 0. No duplicate PR created.
4. Run `canon run <id>` (no flags) on the same `complete` task. Expected: the "TASK COMPLETE — already past human_review" block from AC-3. Exit 0.
5. Verify the dirty-file allowlist still rejects unrelated changes: edit a random file under `src/` (not a task artifact), then run `canon run <id> --pr`. Expected: the existing allowlist guard fires ("dirty files outside the human_review allowlist") and the command exits non-zero.
6. Confirm `--ship` still works: merge the PR, then `canon run <id> --ship`. Expected: standard archive flow.
7. Read `CHANGELOG.md` and confirm the `### Fixed` entry under `## [1.1.4] — unreleased` references #72.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry checked
