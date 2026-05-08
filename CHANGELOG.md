# Changelog

> Internal changelog for canon-ai's `dev` branch. Not present on `main` (which is the portable template).
> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).

## [0.1.0] — 2026-05-07

### Added

- Post-commit handoff verification at code-review pre-flight: the pipeline now cross-checks the committed diff against every bundle member's handoff Changes table and rejects with a labelled bundle-level finding when they diverge — catching both hallucinated handoff entries and silent edits not mentioned in any handoff. `git diff --name-status -M` is parsed so renames expand to both pre-image and post-image paths and are treated symmetrically (a handoff listing either side covers the pair, matching `autoCommitCode()`'s existing rename contract). See [`tasks/_archive/handoff-verifier/done.md`](tasks/_archive/handoff-verifier/done.md) for the full task summary.

### Fixed (harness safety from canon-on-canon dogfood)

- `autoCommitCode()` post-commit verification via `git diff HEAD --name-only -- <handoff files>`: catches silent-partial-commit failures where `git status --porcelain` reports a file as clean while it actually differs from HEAD on disk. The earlier pre-commit checks all rely on `status`; this final check uses `git diff` directly so it remains correct when status is unreliable. Surfaced when iteration 3 of the handoff-verifier task itself committed only `status.json` while real on-disk changes to `scripts/run-task.ts` and the test file were silently dropped — and the prior status-based checks all passed.
- `--ship` pre-flight branch safety: `assertTaskBranchPushed()` aborts when any local `task/<id>` branch has commits not on `origin`; `assertNoOpenPRForTask()` aborts when a PR remains open after the merge step returned no merges. Prevents destruction of unpushed work the merge step misses (e.g., gh transient hiccups skipping `findOpenPRNumber`).
- Worktree creation aborts with "run `npm install` in `REPO_ROOT` first" when `package.json` exists but `REPO_ROOT/node_modules` is missing, instead of creating a dangling symlink that produces confusing downstream `tsx` / dependency errors inside the worktree.

### Changed

- `--reroute` help text clarified: "Reset from `human_review` back to `implement` AND re-invoke the pipeline" — was "Reset" only. The command both resets state and re-runs the orchestrator from the reset phase; the prior wording suggested it just reset state and let the user re-invoke separately, which led to a real recovery-flow misstep during the dogfood.

## [0.0.1] — 2026-05-07

Initial extraction of canon from its embedded source project. Pipeline built but unverified end-to-end. See [`STATUS.md`](STATUS.md).
