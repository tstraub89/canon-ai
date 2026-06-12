# Completion Summary: qa-end-commit — Commit QA artifacts at QA-end so the worktree is clean

> For the human. This is what you need to know.

## What Changed

The pipeline now commits all QA-phase output at the moment QA finishes, before the task enters the "ready for review" state. Previously those files stayed uncommitted until you ran `--pr`, leaving the working folder dirty across the gap and causing three failures: a reroute from human-review could abort the post-implementation auto-commit if a project doc had been touched during QA (issue #152); `git reset`/`git stash drop` on the task folder during that window silently wiped all accumulated pipeline progress; and `--pr` required a stash-and-pop during base-drift rebases. A new commit helper (`commitQaArtifacts`) stages and commits the task's review notes, done summary, pr-body draft, status file, and any dirty project docs — everything in a single `chore: QA artifacts for <task-id>` commit. The `--pr` step is unchanged: it still pushes the branch and opens the PR; if you edit the notes after QA, those late edits are captured by the existing late-commit path. Separately, a structural fix ensures that a project doc can never abort an implement auto-commit even if it happens to be dirty during that phase — closing issue #152 by invariant, not just by timing.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | Added `commitQaArtifacts`; routed QA phase through it from `checkAndRoute` |
| `scripts/run-task/validation.ts` | Added `PIPELINE_MANAGED_DOCS` to `autoCommitAllowedSourceBypass` |
| `tests/run-task-safety.test.ts` | New coverage: staged-path set, bundle commit message, evidence-advance path, clean-tree idempotence, allow-list violations |
| `tests/run-task-parse-porcelain.test.ts` | New coverage: dirty managed doc absent from handoff not reported as uncovered |
| `dist/scripts/run-task.js` | Rebuilt |
| `docs/pipeline-orchestrator.md` | QA-end commit step documented |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced mirror |
| `docs/patterns.md` | Git-surgery pitfall updated — post-QA window now committed |
| `docs/BACKLOG.md` | "Commit pipeline state at QA-end" checked off |

## How to Test

Follow the spec's Human Test Plan:

1. Run any task through the pipeline until QA finishes and the task reaches "ready for review."
2. In the task's working folder, run `git status`. **Expected:** the folder is clean — QA notes, review notes, done summary, and any updated project docs are already in a commit titled "QA artifacts for …". (Before this fix, those files would show as unstaged/dirty.)
3. Push the branch / open the draft PR (`canon run <id> --pr`). **Expected:** succeeds with no errors about "nothing to commit," and the PR opens normally.
4. Reproduce issue #152: take a task whose QA updated a project doc, then reroute it (`canon run <id> --reroute`). **Expected:** reroute proceeds cleanly and does not halt with an auto-commit error blaming an uncommitted project doc.
5. Make a small manual edit to `done.md` or another artifact after QA, then run `--pr`. **Expected:** the late edit is captured in the push — not silently dropped.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 854 pass, 1 skip, 0 fail |
| `npm run build` | Pass — `dist/scripts/run-task.js` rebuilt |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |
| E2E | N/A — no UI surface |

## Human Verification Required

None.

## Decisions Made

- **Minimum-scope fix**: one QA-end commit plus the reconciler exemption. Per-phase commits (implement and code_review each committing their own artifacts) remain a deferred follow-up per the spec's Non-Goals.
- **Single chokepoint via `checkAndRoute`**: both QA advance paths (normal completion and evidence-advance) consolidated here rather than patching each call site.
- **Staged-file allow-list checked twice** (pre-add and post-add): the implementation added a second-stage guard mirroring `commitHumanReviewFiles`, preventing a dirty allowed directory from sweeping out-of-scope files into the QA-end commit. This is a deviation from plan (documented in handoff), and strengthens AC-7/AC-10 beyond the spec's minimum.

## Open Questions

None.

## Proposed Changelog

> Audience: operators and adopters of canon. Per AGENTS.md §"Release Rules", scope is user-visible pipeline behavior.

**For the next release under `### Fixed`:**

- **Worktree is clean when `human_review` opens.** The pipeline now commits all QA-phase output — task artifacts, review notes, QA summary, pr-body draft, and any managed-doc edits — in a single `chore: QA artifacts for <task-id>` commit at the QA→`human_review` boundary. Previously those files stayed uncommitted until `--pr`, creating three failure modes: a `--reroute` from `human_review` aborted the post-implement auto-commit if a QA-touched managed doc was still dirty (issue #152); `git reset`/`git stash drop` on the worktree silently wiped all accumulated phase state; and `--pr` required a stash-and-pop around base-drift rebases. The `--pr` clean-tree path is unchanged — push + PR as before; late post-QA edits still land via the existing dirty-tree commit path.

- **Issue #152 closed structurally.** Managed docs (`PIPELINE_MANAGED_DOCS`) are now exempt from the implement-phase orphan-change detector, so a QA-touched managed doc can no longer abort an implement auto-commit — independent of whether the QA-end commit cleaned the tree first. Both the timing fix (clean tree at reroute) and the invariant fix (reconciler exemption) ship together.

**Proposed version bump:** patch → `v1.12.0`. These are bug fixes to pipeline infrastructure behavior. No API changes, no operator migration required.
