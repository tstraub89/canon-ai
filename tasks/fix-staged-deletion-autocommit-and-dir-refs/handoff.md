# Implementation Handoff: fix-staged-deletion-autocommit-and-dir-refs

> Author: Codex | Spec: `tasks/fix-staged-deletion-autocommit-and-dir-refs/spec.md` | Plan: `tasks/fix-staged-deletion-autocommit-and-dir-refs/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/git.ts` | Added the shared index and working-tree stage-path filter. |
| `src/orchestrator/main.ts` | Applied the filter at all three commit sites, kept the deletion-only commit path, and exported the auto-commit test seam. |
| `scripts/docs-refs-check.mjs`, `templates/scripts/docs-refs-check.mjs` | Accepted existing directories in plain backtick refs and synced the adopter mirror. |
| `tests/run-task-safety.test.ts` | Added real-git implement and QA commit regressions. |
| `tests/run-task-validation.test.ts` | Covered every required filter boundary in a temporary real-git repository. |
| `tests/docs-refs-check.test.ts` | Covered existing and missing directories and the file-only symbol-ref boundary. |
| `dist/orchestrator/run-task.js`, `dist/cli/index.js` | Rebuilt and normalized published bundles. |

## Canon Governance

Provenance remains in `status.json.canon`.

## Intent & Rationale

A path absent from both the working tree and Git index has nothing for `git add` to match. The shared filter omits only that path from staging; the already-staged deletion still flows through the existing coverage checks and commit. Plain backtick references now accept existing directories. Symbol, section, and anchor references retain their file-only behavior.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Removed the now-unused `settledDeletions` set while retaining the committed-deletion acceptance branch. | The shared filter replaces its only staging use; keeping an unread set would fail lint. | No behavioral change to the pre-stage check. |
| Left the proposed `docs/patterns.md` sentence for QA. | The plan resolves the spec-review scope nit this way; that file is outside the spec's Affected Files cap. | None of the ACs requires that edit. |
| Filter keeps paths when `lstat` fails for a reason other than absence. | An uncertain filesystem probe must not silently omit content. | Strengthens AC-6's keep boundary. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Real-git staged-deletion-only test creates a new deletion commit and a clean tree. |
| AC-2 | Met | One new commit contains the staged deletion and unstaged edit. |
| AC-3 | Met | Old rename path is absent and destination present at HEAD. |
| AC-4 | Met | Plain unstaged removal passes before and after the fix. |
| AC-5 | Met | QA-end creates one commit containing dirty task artifacts and the staged telemetry deletion. |
| AC-6 | Met | One exported helper covers all eight specified real-git cases; all three staging call sites use it. |
| AC-7 | Met | Literal-string grep count is 0, and AC-1 exercises the empty add list. |
| AC-8 | Met | Existing directory passes; missing directory and symbol-in-directory fail. |
| AC-9 | Met | Mirror is byte-identical; sync check passes. |
| AC-10 | Met | All five red-first failures were observed below; all new tests pass unskipped in the full suite. |
| AC-11 | Met | Build and required suite pass. Both generated bundles are in the Changes table for the orchestrator-owned commit, and a second build produced identical SHA-256 hashes. |

## Edge Cases Considered

- An unstaged deletion still has an index entry and remains stageable.
- A cached removal with its file still on disk remains stageable.
- Directory paths stay stageable if an index entry remains beneath them.
- A failed index probe keeps every candidate, preserving the existing stage error instead of silently dropping content.
- The QA and human-review loops can receive an empty filtered list and continue to their staged-content checks.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| AC-1 red-first | Pass | Pre-fix: `Failed to stage files: fatal: pathspec 'dead.ts' did not match any files`; post-fix targeted and full-suite pass. |
| AC-2 red-first | Pass | Pre-fix: `Failed to stage files: fatal: pathspec 'dead.ts' did not match any files`; post-fix one-commit test passes. |
| AC-3 red-first | Pass | Pre-fix: `Failed to stage files: fatal: pathspec 'old.ts' did not match any files`; post-fix tree assertion passes. |
| AC-5 red-first | Pass | Pre-fix: `QA-end commit aborted: failed to stage docs/pipeline-invocations.md: fatal: pathspec 'docs/pipeline-invocations.md' did not match any files`; post-fix one-commit test passes. |
| AC-8 red-first | Pass | Pre-fix: existing directory produced `missing file`; post-fix it passes, and negative cases still fail. |
| `npm run lint` | Pass | No findings. |
| `npm run type-check` | Pass | No findings. |
| `npm test` | Pass | 1265 tests, 1264 pass, 0 fail, 1 pre-existing environment-gated skip; no new test skipped. |
| `npm run build` | Pass | Two runs yielded the same bundle hashes. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `git diff --check` | Pass | No whitespace errors. |
| E2E | not_configured | Spec explicitly marks E2E N/A; real-git integration fixtures cover the CLI internals. |

## Ready for Review

- [x] All spec ACs met
- [x] All required checks pass
- [x] Deviations documented

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Counted staged and unstaged deletions as implement evidence using the diff from HEAD. |
| `tests/run-task-safety.test.ts` | Added a red-first real-git test through `checkAndRoute('implement')` and updated the existing fake-Git deletion fixture for the new probe. |
| `tests/run-task-validation.test.ts` | Pinned absent-on-disk directory index-prefix matching, trailing-slash matching, and failed-index-probe fallback. |
| `dist/orchestrator/run-task.js` | Rebuilt the orchestrator bundle from the evidence-gate change. |

### Findings addressed

- **Correctness bug 1 — staged deletion blocked before auto-commit:** A real-git, non-worktree `checkAndRoute('implement')` test failed red with `handoff.md lists 1 file(s) but none exist on disk or are git-tracked deletions` and exit 2. The gate now uses `git diff HEAD --name-only --diff-filter=D`, which sees staged and unstaged deletions. The same test passes green, with implement still done, exactly one deletion commit, and a clean tree. The existing unstaged-deletion evidence fixture also passes after its fake-Git response was updated.
- **Correctness bug 2 — weak helper boundary test:** The real-git fixture now removes a tracked directory with plain filesystem removal and checks both the directory and trailing-slash path remain stageable while absent on disk. A separate non-repository cwd confirms a failed index probe returns every candidate unchanged. Both pass; these assertions exercise the index-prefix, slash normalization, and fail-closed branches.
- The first full-suite run exposed the old fake-Git fixture's missing response for the new diff probe. That in-scope fixture was corrected; the final full suite passes. Optional nits N1–N4 and follow-ups F1–F5 were left for their stated owners.

### AC deltas

- **AC-1:** The direct auto-commit regression remains green, and a new red-first real-git test now proves the full implement routing reaches and commits the staged deletion.
- **AC-6:** The keep boundary is pinned for an absent-on-disk tracked directory, a trailing-slash path, and an errored index probe.
- **AC-10:** The new routed test's pre-fix evidence-gate failure and post-fix pass are recorded above. All task tests ran unskipped.
- **AC-11:** Rebuilt output is stable across two fresh builds. The cumulative Changes tables cover every file in the branch diff against main.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| Routed staged-deletion red-first test | Pass | Pre-fix exited 2 with the missing-evidence message above; post-fix targeted and full-suite pass. |
| Focused routed and helper tests | Pass | Four targeted cases pass, including the pre-existing deletion-evidence fixture. |
| `npm run lint` | Pass | No findings. |
| `npm run type-check` | Pass | No findings. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm test` | Pass | 1267 tests, 1266 pass, 0 fail, 1 existing environment-gated skip; no task test skipped. |
| `npm run build` | Pass | Repeated builds produced identical bundle SHA-256 hashes. |
| `git diff --check` | Pass | No whitespace errors. |

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Disabled rename detection in the uncommitted-deletion evidence probe so a removed path remains visible beside a similar added path. |
| `tests/run-task-safety.test.ts` | Added a red-first real-git intent-to-add rename case and aligned the fake-Git argv response with the probe. |
| `dist/orchestrator/run-task.js` | Rebuilt the orchestrator bundle. |

### Findings addressed

- **N-1 correctness bug:** The new real-git test moves a tracked file, marks the destination intent-to-add, and verifies that `git diff HEAD --name-only --diff-filter=D` reports no deletion while the same command with `--no-renames` reports the old path. Before the fix, `tryEvidenceAdvance('implement')` exited 2 with `handoff.md lists 1 file(s) but none exist on disk or are git-tracked deletions`. The probe now uses `--no-renames`; the test and the existing staged-deletion and deletion-evidence tests pass. The fake-Git fixture matches the revised command exactly.
- Round 2's sibling committed-diff suggestion and optional nits remain deferred, as requested for this tightening round. No files outside the spec's Affected Files table were edited for the fix.

### AC deltas

- **AC-1 / AC-10:** A deletion-only handoff remains valid when Git would pair its removed path with an intent-to-add destination. The red-first gate failure and green pass are recorded above.
- **AC-11:** The full suite and required checks pass; the rebuilt bundle is byte-stable across fresh builds. The cumulative Changes tables cover every path in the branch diff against main.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| Intent-to-add rename red-first test | Pass | Pre-fix gate returned the missing-evidence message and exit 2; post-fix targeted and full-suite pass. |
| Focused evidence tests | Pass | Three targeted cases pass unskipped. |
| `npm run lint` | Pass | No findings. |
| `npm run type-check` | Pass | No findings. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm test` | Pass | 1268 tests, 1267 pass, 0 fail, 1 existing environment-gated skip; no task test skipped. |
| `npm run build` | Pass | Two fresh builds produced identical bundle SHA-256 hashes. |
| `git diff --check` | Pass | No whitespace errors. |
