# Changelog

> Internal changelog for canon-ai's `dev` branch. Not present on `main` (which is the portable template).
> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).

## [0.3.0] — 2026-05-10

### Added

- Post-Codex `isTemplateUnfilled` check on `spec-review.md` — orchestrator rejects `spec_review: done` when the artifact is still the bare template. Closes a gap that allowed phase status to disagree with artifact state. Surfaced in TokenAnxiety dogfood [discussion #27](https://github.com/tstraub89/canon-ai/discussions/27); the same check already existed for `review.md` and `plan.md`, just not `spec-review.md`.
- README "Supported platforms" section documenting macOS/Linux as supported; Windows requires WSL2 (#22).
- Three new entries in [`docs/decisions.md`](docs/decisions.md): **"Declared Canon vs Executable Canon"** as a recurring audit lens (when reviewing canon's own changes, bucket findings as declared bug / executable bug / drift between them); **"Canon is a quality layer, not an authoring tool"** as the settled positioning (per strategy memo [#30](https://github.com/tstraub89/canon-ai/discussions/30)); **"Track new work in BACKLOG.md by default"** codifying when new work goes in BACKLOG vs. as GH issues.

### Fixed

- `.claude/settings.local.json` filename in `.gitignore` — the pattern had the words reversed (`.claude/local.settings.json`) and matched no real file (#14).
- `task.sh release-init` dead `short=` reassignment removed (#21).
- `docs/product-owner.md` reference removed from agent startup prompts (file doesn't exist in canon-ai) (#15).
- `.agent/docs-map.json` Citation grounding block removed from the code-review template (runtime tooling doesn't exist) (#16).
- GalleryPlanner project names scrubbed from canon-supplied source comments and test fixtures (#18).
- README install step now includes `mustache` + `@types/mustache` (the orchestrator imports `mustache` for prompt rendering, but the install was missing it) (#12).
- README stale counts dropped; orchestrator description updated to reflect the `run-task` module split (#19).
- Node version docs aligned to actual policy: 24.x only, not 22.x. README + `docs/architecture.md` (Codex P2 follow-on to PR #28).
- `phaseCommands` quotes the absolute `task.sh` path so commands survive spaces in repo paths (#9).
- `retryAgentForPhase` maps phase to session slot (`spec → claude_spec`, `code_review → claude_review`) instead of the deprecated flat `claude` slot. Was causing recovery to report "no session" even when a usable session id existed (#10).
- Post-Claude `review.md` template check reads from the active worktree, not REPO_ROOT. Was false-positively resetting `code_review` to pending in worktree mode (#11).
- First-implement worktree creation: when `worktree: true` and no branch is recorded, the orchestrator now creates `task/<id>` directly in the worktree from `baseBranch` instead of mutating the main checkout. Restores the documented isolation model (#6).
- `code_review` retries now run in the active worktree (was REPO_ROOT-only). Latent bug exposed when the session-slot fix activated the previously-dead Claude code_review retry path (Codex P2 follow-on to PR #29).
- `AGENTS.md` and `docs/pipeline-orchestrator.md` script-location references aligned with the `run-task` module split (`getCodexConfig` in `policy.ts`, `streamProcess` in `agents/stream.ts`, `pipeline-invocations.md` writer in `metrics.ts`).
- `docs/product-context.md` roadmap updated — was claiming v0.0.1 and "not yet smoke-tested end-to-end" despite multiple shipped tasks.

### Removed

- `npm run setup-hooks` script on `main` (the merge-guard hook file is deliberately dev-only; the script was broken on main since `df9ab41` removed the hook). Closes #13 on main. Dev keeps the script — the hook file exists there and the script works.

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
