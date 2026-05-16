# Changelog

> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).

## [1.0.0] — 2026-05-16

First major release. Canon ships as the `canon-ai` npm package with a full CLI, Claude Code skills, and a unit-test suite.

### Added

- **Affected-files section in implement prompts** — `promptImplement`, `promptImplementRevisions`, and `promptImplementReroute` now receive the committed diff path set (`git diff <baseBranch>...HEAD --name-status -M`, expanded for renames) and render it into a `## Affected files (committed diff vs base branch)` section. Spec authors can write predicate-gated checks in the *Validation Required* section ("run e2e only if `src/` changed") and Codex evaluates the predicate against this set during `implement`. On the first implement pass (empty set), Codex applies the full default check matrix.
- **`canon-ai` npm package** — publishable via npm; `canon` binary wired through `dist/cli/index.js`. Build via `tsup`; `templates/`, `scripts/`, and `public/` are included in the package files so adopters get the full scaffold on install.
- **`canon` CLI** — six commands: `init` (installs the `/canon-init` skill into the project), `doctor` (verifies environment and canon setup), `upgrade` (syncs canon-owned files to match installed version), `update` (updates the canon-ai package itself), `run` (delegates to `scripts/run-task.ts`), `task` (delegates to `scripts/task.sh`).
- **`/canon-spec`, `/canon-pipeline`, `/canon-status`, `/canon-changelog` Claude Code skills** — installed to `.claude/skills/` by `canon init` and synced by `canon upgrade`. All four are `CANON_OWNED`.
- **Unit test suite** — 237 tests covering CLI commands (`upgrade`, `init`, `doctor`, `update`), orchestrator extractors, validation parsers, and phase-gate logic. Run via `npm test`. Pure/injectable entry points extracted from each CLI command so tests don't require subprocess spawning or `process.chdir`.
- **Project template overrides** — `canon task new` checks `tasks/_templates/<file>` first and falls back to `.canon/templates/<file>`. Files in `tasks/_templates/` are never touched by `canon upgrade`, allowing per-project customization (validation commands, placeholder text, project-specific sections) to survive upgrades. See `.canon/README.md`.
- **`.canon/README.md`** — "do not edit these files" notice seeded by `canon init` and kept current by `canon upgrade`, with the `cp` command and post-upgrade `diff` workflow for overrides.

### Removed

- **`runtime_validation` orchestrator phase** — implement now routes directly to `code_review`. The phase handler, `RUNTIME_CHECKS` registry, `RuntimeCheck` type, status.json block, handoff template section, AGENTS.md "Validation authority boundary" rule, and the dedicated test suite are all gone. Validation execution lives entirely inside agent phases now (Codex runs checks in `implement`; Claude verifies in Stage 1 code review). Legacy in-flight tasks with a `runtime_validation` block in `status.json` are tolerated — the parser ignores the block on read and preserves it on write. See `docs/decisions.md` "Validation runs inside agent phases" for the reframe rationale.

### Changed

- **Codex CLI invocation no longer passes redundant sandbox flags.** `agents/codex.ts` previously hardcoded `--sandbox workspace-write -c sandbox_permissions=["disk-full-read-access"]` on every fresh invocation, which overrode any project-owned `.codex/config.toml`. Codex CLI's default sandbox already grants workspace-write + `/tmp` + `$TMPDIR` + `~/.codex/memories` writes and network access — equivalent to what canon was explicitly requesting. Dropping the flags makes `.codex/config.toml` the authoritative source for adopters who want to *tighten* (read-only mode for regulated data) or further widen (`danger-full-access` for off-workspace writes).
- **Task templates moved** from `tasks/_templates/` to `.canon/templates/` — now canon-owned and overwritten by `canon upgrade` alongside skills. The `tasks/_templates/` path is now the project-override location.
- **`detectInstallType`** now inspects the package's own install path (`packageDir`) instead of `cwd/node_modules/canon-ai`. The old check failed silently when `canon` was invoked from a project subdirectory, always returning `local` regardless of actual install type.
- **Signal exit propagation** in `run` and `task` subcommands: child process exit code is now `result.status ?? 1` (was `result.status ?? (result.error ? 1 : 0)`, which swallowed non-zero exits on some error paths).
- **`CANON_VERSION`** injected at build time via `tsup` `define` so the compiled binary carries the package version without a `package.json` read at runtime.

### Fixed

- `scaffoldTemplates` (`init.ts`) extracted as a testable pure function; dead `resolveTsx` function body removed (was causing lint error `'resolveTsx' is defined but never used`).
- `runUpgrade` (`upgrade.ts`) extracted as a testable pure function accepting `(cwd, pkgDir)` so upgrade logic can be exercised without invoking the CLI entry point.
- `upgrade` output no longer stages files to paths that may not exist on disk when a CANON_OWNED template is missing from the package's `templates/` directory.

## [0.6.1] — 2026-05-15

### Fixed

- **Code review diff injection**: the orchestrator now pre-computes `git diff {baseBranch}...HEAD` and injects it directly into the code-review prompt, eliminating the failure mode where a noisy worktree (uncommitted unrelated files) caused the review agent to drift to the wrong fallback and stall without producing `review.md`. Diffs larger than 50 000 bytes are truncated with a note pointing the agent to the handoff Changes table. When git fails, the original command-instruction fallback is preserved. Applies to both round-1 and round-N review prompts. Closes [#46](https://github.com/tstraub89/canon-ai/issues/46).
- **Shared-doc sync over-skipping**: `syncWorktreeTelemetry` was using a HEAD-level `merge-base --is-ancestor` check, so any unrelated commit on dev (a backlog doc update, a hotfix) would block the entire shared-doc sync for an in-flight task. Switched to a per-file `git log source..dest -- <path>` check: each file is now skipped only when the destination has file-specific commits the worktree lacks; unrelated divergence on other files does not block it.

## [0.6.0] — 2026-05-14

### Fixed

- **Reroute session prompt**: `--reroute` with an existing Codex session now sends a purpose-built resumed-reroute prompt instead of routing through the generic `toResumePrompt` wrapper. The cold-session prompt said "session memory is stale by design" while `toResumePrompt` prepended "project context loaded, skip startup re-reads" — a direct contradiction that caused Codex to anchor on stale spec context. The new prompt (when `isResumedSession=true`) omits startup boilerplate already in context, uses a session-aware preamble, and tells Codex its codebase context is valid but the spec has changed. Cold reroutes (no prior session) are unchanged.
- **Spec-review / implement session isolation**: `spec_review` and `implement` now use separate Codex session slots (`codex_spec_review` vs `codex`). Previously both wrote to the same slot, so on full-tier tasks the spec_review session ID (project root: REPO_ROOT) would be read by fresh implement (project root: worktree). If the spec_review session was still live, Codex would resume it in the wrong directory. Sessions are now structurally isolated at the slot level, with a `shouldResume` gate in `implement.ts` as an additional guard.

### Added

- `promptImplementResume()` extracted from inline string in `implement.ts` into its own function in `prompts/index.ts`, completing the one-function-per-implement-mode pattern (`fresh`, `resume`, `revision`, `reroute`).
- `wrapForResume` parameter on `runCodex()` (default `true`) — allows purpose-built resumed prompts to bypass `toResumePrompt` wrapping while still using `codex exec resume` to preserve session context. Currently used only by resumed reroutes.

### Changed

- `--reroute` CLI output now prints a warning that `spec.md` amendments must be written to the main repo (not the worktree path), and that `review.md` alone is insufficient — Codex reads `spec.md` as the contract. Worktree copies are overwritten by the implement-phase sync.
- `pipeline-orchestrator.md` §Human Reroute clarifies the same main-repo-only requirement and removes the ambiguous "or update `review.md` for small tweaks" language.
- `CODEX.md` and `tasks/_templates/handoff.md` now document file-revert behavior: `git restore` is blocked by the sandbox (requires `.git/index.lock`); byte-perfect reverts use `git show origin/<base>:<path>` instead. Perfect reverts (net-zero in diff) must be removed from all prior Changes tables; imperfect reverts (residual diff remains) must be listed in the current iteration's table.

## [0.5.1] — 2026-05-13

### Fixed

- `run-task-safety.test.ts`: the `REPO_ROOT stays anchored` test now skips instead of failing with EPERM when `git worktree add` is blocked by the environment (Codex sandbox or linked-worktree filesystem restrictions). A write probe against `REPO_ROOT/.git/` at module load determines whether the test can run; the regression guard is preserved on all environments where it can.

## [0.5.0] — 2026-05-13

### Added

- New `Fail – unrelated` validation result state. When a required check fails due to a pre-existing flake or test outside the task's Affected Files, Codex can now record `Fail – unrelated` in the Validation Outcomes table instead of blocking on a `Fail`. The state is accepted by `validateHandoffAgainstSpec` only when Notes contains a specific test/file reference (a path, file extension, or `file:line`); vague notes are rejected. The code-review prompt now explicitly instructs Claude to assess whether the explanation is credible and the failure is genuinely out of scope.

## [0.4.5] — 2026-05-12

### Fixed

- `resolveTaskCwd` (state.ts) and `getActiveCwd` (worktree.ts) no longer die when `branch` is empty on a fresh task. The `die()` call was outside the `if (branch)` guard, so both Situation A (fresh task, no branch yet) and Situation B (branch set but worktree missing) hit the same error path. Moving `die()` inside the branch guard preserves the fail-closed behavior for missing worktrees while allowing `checkDeps`-era `statusFileFor` calls to complete normally before `ensureBranch` runs.

## [0.4.4] — 2026-05-12

### Fixed

- Runtime-validation retry prompts now reference the correct artifact directory (`iter-N`) using the monotonic `runtimeIterations_total` counter instead of the per-loop `runtimeIterations` counter, which resets to 0 on approval. Previously, any runtime-validation failure after a successful first cycle would point Codex at a non-existent or stale path.
- Closing `human_review` without a `handoff.md` present now fails closed with an explicit error instead of silently returning `ok: true`. Previously, `--ship` could archive a task with no validation evidence when the implement phase had not produced a handoff.

## [0.4.3] — 2026-05-11

### Fixed

- Handoff iteration sections now contribute their own `### Changes` tables to the diff/auto-commit file set, so files introduced in later review rounds are no longer falsely rejected as missing from the handoff.

## [0.4.2] — 2026-05-11

### Fixed

- Shared-doc sync now uses a shared registry for telemetry and managed docs, fails closed when the supervising checkout has diverged, and compares file content instead of byte length before mirroring worktree edits back to the supervising checkout.
- Human-review auto-commit now stages the protected managed docs through the same shared-doc registry instead of relying on a separate allowlist.
- Added regression coverage for linked-worktree root resolution, the load-bearing harness extractors, and the shared-doc sync guardrails.
- Canon now documents the tested `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL` defaults in the orchestrator docs and README instead of changing runtime behavior.

## [0.4.1] — 2026-05-11

### Fixed

- `--ship` now fails closed across worktree teardown and archive commit handling, instead of dropping the final `status.json` write or continuing after a failed archive commit.
- Task branch creation now honors the declared `status.base_branch` strictly, and the ship path checks out the real base branch before merge/archive work.
- Worktree-backed bundle tasks now resolve to the correct worktree instead of silently falling back to `REPO_ROOT`.
- `validateHandoffAgainstSpec()` now rejects specs that omit `## Validation Required` or leave it empty, so handoff validation cannot be bypassed by an empty section.

## [0.4.0] — 2026-05-11

### Added

- GitHub Actions CI workflow (`.github/workflows/ci.yml`) and a POSIX-safe `npm test` glob so `main` / `dev` now run lint, type-check, audit, and unit tests in CI.
- `scripts/run-task.ts` split into focused modules under `scripts/run-task/`, and prompt prose moved into Mustache templates with golden-output regression coverage.
- `--dry-run` on `run-task`: prints the planned phases, agents, models, and effort without spawning an LLM session.
- New `runtime_validation` phase between `implement` and `code_review`, with a `RUNTIME_CHECKS` registry and orchestrator-owned shell execution.
- New iterative counter fields on `spec_review`, `code_review`, and `runtime_validation`: `iterations_current_loop`, `iterations_total`, `changes_requested_total`, and `auto_block_count`.
- Prompt-fidelity regression suite plus `CANON_TASKS_DIR_OVERRIDE` and `CANON_PATTERNS_MD_PATH` test hooks.
- Canon provenance stamping in `status.json.canon`, plus the `Canon Governance` section in `handoff.md`.

### Fixed

- Worktree telemetry and task-artifact sync no longer clobber main-checkout files with shorter worktree copies; `notes.md` is mirrored, `human_review` exits cleanly when done, and `REPO_ROOT` resolves correctly in linked worktrees.
- The centralized AC Coverage check now parses the markdown table instead of pattern-matching prose, eliminating false positives.
- Runtime validation no longer writes a second top-level baseline after a reroute; it keys the re-run path off `iterations_total`.
- `cmd_reset_spec_review` now preserves cumulative counters instead of zeroing them, and `--reroute` resets only the current loop counter.
- `task.sh phase` and `--ship` now honor the active task worktree, and the shell wrapper prefers the repo-local `tsx` binary before falling back to `npx`.

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
