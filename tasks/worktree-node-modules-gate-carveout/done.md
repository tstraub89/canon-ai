# Completion Summary: worktree-node-modules-gate-carveout — Exempt canon's verified node_modules worktree symlink from QA-end and human-review dirty gates

> For the human. This is what you need to know.

## What Changed

When canon runs a task in an isolated worktree, it links that worktree's `node_modules` to the main checkout's install via a symlink. If the project's `.gitignore` uses the common trailing-slash style (`node_modules/`) rather than canon's own bare `node_modules` style, git doesn't recognize that symlink as ignored — so it shows up as an untracked change, and canon's own commit gates (at the end of QA, and again when opening a PR or pushing) refused to proceed, complaining about an "unexpected" file that canon itself created. An adopter (James, GitHub issue #197) hit this live. This task adds a narrow, verified exemption: a top-level `node_modules` entry is now ignored by these gates only when a real filesystem check confirms it is exactly canon's own symlink pointing at the main checkout's `node_modules` — a real file, a real directory, or a symlink pointing anywhere else still blocks the gate exactly as before. Separately, the one-time setup step that creates the symlink was hardened so re-running it never crashes if the symlink (or something else) is already there.

## Files Changed

- `scripts/run-task/worktree.ts` — added the pure decision function that classifies a `node_modules` entry as canon's verified symlink or not, plus the filesystem probe that feeds it; replaced the worktree setup guard with an `lstat`-based check so re-running setup never crashes on a pre-existing symlink.
- `scripts/run-task/main.ts` — applied the exemption in both commit gates: at QA-end's "unexpected files" check, and upstream of every dirty-tree decision in the human-review commit path (the clean-tree retry, the no-dirty check, and the no-stage-to-commit check), so a tree that's dirty only because of the symlink is treated as clean.
- `tests/run-task-safety.test.ts` — new regression tests: real-git fixtures for both gitignore styles, the fix itself, negative cases (a real file/directory/wrong-target symlink still blocks), probe-error fail-closed behavior, and setup idempotency.
- `dist/scripts/run-task.js` — rebuilt output from the source changes (required so the published CLI matches source).

## How to Test

1. In a project whose `.gitignore` lists the dependencies folder with the common trailing-slash style, run a full-tier canon task through QA in the default isolated-worktree mode.
2. Expected: QA commits its artifacts and stops at human review normally — no abort about unexpected changed files, even though canon linked the dependencies folder into the task's workspace.
3. From that same stopped-at-human-review state, ask canon to open a draft pull request. At this point the only leftover change in the workspace is canon's own dependency link.
4. Expected: canon pushes the branch and opens the draft PR normally — it does not stop and complain there are no changes it's allowed to commit, and the dependency link is not included in the PR.
5. Replace canon's dependency link in the task workspace with an ordinary folder or file of the same name, then let the pipeline reach the same commit point again.
6. Expected: the pipeline stops and reports the unexpected item instead of committing or opening a PR — anything other than canon's own verified link is still treated as a problem.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (963 tests: 962 pass, 1 skipped) |
| E2E tests | not_configured — spec marks no end-to-end surface applicable |
| Build | Pass (`dist/scripts/run-task.js` rebuilt, matches source) |
| `docs-refs-check` | Pass |

## Human Verification Required

None — no `human_pending` checks remain in `handoff.md`; all Validation Outcomes are `Pass` or the spec-marked `not_configured` E2E row.

Pre-merge checklist (not yet confirmable at QA time — check before merging):

- [ ] Version correct — N/A for this task; canon-ai bumps versions at a separate release step (`docs/decisions.md` §"Versioning and release policy"), not per task.
- [ ] Changelog updated — draft text proposed below; final wording and version/tier are the release step's call.
- [x] PR body current — drafted in `pr-body.md` this pass.
- [ ] Final CI/CD checks green — confirm once the PR is opened.
- [ ] Final diff matches spec intent — code_review returned `approved_with_nits` with all 8 ACs Met; a final human skim at human_review is still expected.

## Proposed Changelog

- **Canon's own worktree `node_modules` symlink no longer hard-stops the QA-end and human-review commit gates.** `ensureWorktree()` links a task's `node_modules` to the supervising checkout's install via `fs.symlinkSync`; adopters whose `.gitignore` uses the common trailing-slash `node_modules/` style don't match that symlink, so `git status` reports it as an untracked file and the QA-end/human-review dirty-tree gates aborted with "outside the ... allowlist" on an artifact canon created itself (adopter report [#197](https://github.com/tstraub89/canon-ai/issues/197)). Both gates now exempt a top-level `node_modules` entry only when a filesystem probe confirms it's a symlink resolving to the supervising checkout's `node_modules` — a real file, a real directory, or a wrong-target symlink still blocks the gate exactly as before. `ensureWorktree()`'s setup guard is also now `lstat`-based instead of `fs.existsSync`, so re-running setup never crashes with `EEXIST` on its own prior symlink. Ships to adopters via `canon upgrade`.

## Decisions Made

- Committed the rebuilt `dist/scripts/run-task.js` even though the spec's Affected Files table didn't list it — `docs/architecture.md` requires committed dist to match a fresh build whenever `scripts/run-task/**` changes; documented as a deviation in `handoff.md`.
- AC-7's idempotency tests materialize `node_modules` by running `git worktree add` for a branch whose checkout already contains a tracked entry, rather than calling `ensureWorktree()` twice on the same worktree — calling it twice would hit the pre-existing "worktree already exists" early return before ever reaching the changed guard code, so it wouldn't actually exercise the fix.
- Kept the QA-end/human-review asymmetry deliberate rather than "fixing" it to be symmetric: QA-end's no-stage case is a graceful `return` and always has task artifacts to stage, so it only needed the exemption at its allowlist filter; human-review's no-stage case is a hard `die` and can be dirty *only* because of the symlink, so the exemption had to move upstream of three separate decisions there (see spec Decision section).

## Open Questions

- Code review (`review.md`, finding R1) flagged that the same bug class exists at a third enforcement site — the implement-phase auto-commit gates (`operatorAcceptedImplement()`, `autoCommitCode()`'s empty-handoff check) — which this task deliberately left untouched as an explicit spec Non-Goal. It's narrower than the QA-end failure (it only trips when an implement step produces an empty handoff Changes table on a repo using the trailing-slash gitignore style) but is the same underlying gap. Recommend a follow-up task to route those gates through the same `isExemptNodeModulesEntry` predicate if you want to close the bug class everywhere it can occur.
- The spec's Docs Impact note suggested optionally adding one sentence to `docs/pipeline-orchestrator.md` describing the new carve-out, calling it "heads-up only, QA decides." That doc isn't one of the five docs QA's docs-freshness pass is scoped to edit, and nothing in it currently contradicts this change, so no edit was made. Flagging in case you'd like that sentence added by hand or in a follow-up.
