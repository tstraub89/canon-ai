# Changelog

> Internal changelog for canon-ai's `dev` branch. Not present on `main` (which is the portable template).
> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).

## [0.2.0] — 2026-05-08

### Added

- ESLint with `@typescript-eslint/recommendedTypeChecked` is now the repo's lint gate. Run `npm run lint` (= `eslint scripts/ tests/`) — required for all changes. Config lives in `eslint.config.mjs`. All 48 pre-existing violations were fixed in code; the lint command exits clean from a standing start.

## [0.1.0] — 2026-05-07

### Added

- Post-commit handoff verification at code-review pre-flight: the pipeline now cross-checks the committed diff against every bundle member's handoff Changes table and rejects with a labelled bundle-level finding when they diverge — catching both hallucinated handoff entries and silent edits not mentioned in any handoff. `git diff --name-status -M` is parsed so renames expand to both pre-image and post-image paths and are treated symmetrically (a handoff listing either side covers the pair, matching `autoCommitCode()`'s existing rename contract). See [`tasks/_archive/handoff-verifier/done.md`](tasks/_archive/handoff-verifier/done.md) for the full task summary.

### Fixed (harness safety from canon-on-canon dogfood)

- `autoCommitCode()` post-commit verification via `git diff HEAD --name-only -- <handoff files>`: catches silent-partial-commit failures where `git status --porcelain` reports a file as clean while it actually differs from HEAD on disk. The earlier pre-commit checks all rely on `status`; this final check uses `git diff` directly so it remains correct when status is unreliable. Runs on every return path of `verifyHandoffFilesCommitted()` (success and early-return) so the silent-omission failure mode is always caught regardless of which path the auto-commit took. Surfaced when iteration 3 of the handoff-verifier task itself committed only `status.json` while real on-disk changes to `scripts/run-task.ts` and the test file were silently dropped — and the prior status-based checks all passed.
- `--ship` pre-flight branch safety, three independent guards: `assertTaskBranchPushed()` aborts when any local `task/<id>` branch has commits not on `origin` (counted via `git rev-list --count origin/<b>..<b>` so behind-origin alone doesn't false-positive); `assertNoOpenPRForTask()` aborts when a PR remains open after the merge step returned no merges; `assertOriginTaskBranchAbsent()` aborts when `origin/task/<id>` still exists post-merge (queried via `git ls-remote refs/heads/<branch>` to bypass stale tracking refs and require exact-ref match). Together these prevent destruction of unpushed work the merge step misses (gh transient hiccups skipping `findOpenPRNumber`) and silent shipping of remote-only commits that were never PR'd.
- Worktree creation aborts with "run `npm install` in `REPO_ROOT` first" when `package.json` exists but `REPO_ROOT/node_modules` is missing, before `git worktree add` runs (so a failed pre-flight leaves no orphan worktree that would hit the existing-worktree early-return on retry). Replaces the dangling-symlink failure mode that produced confusing downstream `tsx` / dependency errors inside the worktree.

### Changed

- `--reroute` help text clarified: "Reset from `human_review` back to `implement` AND re-invoke the pipeline" — was "Reset" only. The command both resets state and re-runs the orchestrator from the reset phase; the prior wording suggested it just reset state and let the user re-invoke separately, which led to a real recovery-flow misstep during the dogfood.

## [0.0.1] — 2026-05-07

Initial extraction of canon from its embedded source project. Pipeline built but unverified end-to-end.
