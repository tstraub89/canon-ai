# Changelog

> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).

## [1.9.0] — 2026-06-04

### Added

- **`canon-changelog` and `canon-pipeline` are now release-format-agnostic.** Both shipped skills match your project's *existing* CHANGELOG style instead of imposing canon-ai's bracketed form, and the release-branch flow is an optional recommendation rather than a mandate — adopters with any release process can use them unchanged.
- **QA drafts the PR body for `canon run --pr`.** The `qa` phase writes `tasks/<id>/pr-body.md` — an outward-facing description filling your repo's PR template (or a default skeleton), no tool attribution. `--pr` uses it for single-task runs and falls back gracefully when it's absent; QA never blocks on it. Scaffolded by `canon task new`, synced by `canon upgrade`.

### Changed

- **Full-tier reroutes now re-enter at `spec_review` + `plan`, not just `implement`.** A full-tier (M/L/XL/delicate) amendment gets the same review altitude as its original spec — Codex re-reviews it (and its interaction with approved ACs) before re-implementation, and a `changes_requested` amendment stops cleanly for revision. Fast-tier reroutes are unchanged. **Operator note:** `--step --expect` after a full-tier reroute now expects `spec_review`, not `implement`.

### Fixed

- **`canon watch` no longer false-idles during the plan→implement worktree flip.** A ~30s window where the heartbeat resolver pointed at the still-empty worktree dir could trip a false healthy-stop (`exit 0`) while the run was alive. The worktree is now seeded with a heartbeat the moment it's created (covering bundle secondaries too).
- **Pre-flight rejection counter resets after a real review round.** It previously stayed ≥ 1 after a `changes_requested` round, so every subsequent re-implementation got the "fix your handoff" prompt instead of the reviewer's actual findings until the auto-block cap fired. Now resets on any real verdict; the auto-block safeguard for pure pre-flight loops is preserved.
- **`/canon-status`'s status header no longer silently fails the permission gate.** Its `` ```! `` pre-exec block used nested command substitution (`$(...)`), which can't be allowlisted, so the header failed on every run. Now uses the `@{u}` upstream ref, with `Bash(git rev-list *)` added to `allowed-tools`.

### Removed

- **`CODEX.md` is no longer scaffolded or managed.** No tool read it — the Codex CLI loads `AGENTS.md` natively. `canon doctor` warns (never deletes) on a stale copy; its file-revert guidance moved to `AGENTS.md`.
- **`canon task release-init` has been removed.** It hardcoded canon-ai's changelog format and overwrote `.canon/version` (canon's vendored-files version), making it unusable by adopters. Release branches still start from `main` — follow your project's own release steps.

## [1.8.2] — 2026-05-31

### Fixed

- **The QA phase no longer autonomously rewrites `docs/lessons-learned.md` or promotes entries into permanent docs.** When the lessons-learned buffer exceeded ~15 entries, the QA-phase prompt instructed the agent to run a full "lessons sweep" — promoting entries into `docs/patterns.md` / `docs/decisions.md` / `AGENTS.md` and pruning or editing entries belonging to *other* tasks — with no human-approval gate (and a watchdog `SIGTERM` mid-sweep could strand the docs in a half-promoted state). QA is now strictly **append-only**: it adds only the current task's own entry, still corrects stale references in protected docs via the Docs-freshness step, and when the buffer exceeds ~15 entries it merely *signals* in `done.md` that a human sweep is due. Promoting and pruning the buffer is now a human-initiated, human-approved action, documented as such in the scaffolded `docs/lessons-learned.md` and across the canon-managed docs.

## [1.8.1] — 2026-05-31

### Fixed

- **`canon upgrade` no longer leaves a half-applied docs-refs cutover.** 1.8.0 deferred overwriting the canon-owned `scripts/docs-refs-check.mjs` (requiring a second `canon upgrade`) while updating its `scripts/docs-refs-check.mjs.d.ts` in the same run — leaving the type declaration describing an API the held-back checker lacked, and the scaffolded `scripts/docs-refs-config.mjs` inert until the re-run. The checker and its `.d.ts` now overwrite together in one pass. `scripts/docs-refs-config.mjs` stays adopter-owned (scaffolded only when missing, never overwritten); when a pre-split checker is replaced, upgrade prints a heads-up to recover any inline `noisySourcePaths` / `validDirs` / `markdownRootDirs` customizations from git history (`git diff HEAD -- scripts/docs-refs-check.mjs`) into the config. The warning fires whenever the installed checker predates the config split, even if a config file already exists (e.g. after an interrupted earlier upgrade).

## [1.8.0] — 2026-05-31

### Added

- **`canon watch <id>`.** Blocking observer for detached pipeline runs. Attaches to an already-running orchestrator, streams `phase X → Y` transitions to stderr, and exits with a machine-parseable summary line (`state=… reason=…`) plus a classified exit code: `0` healthy stop (checkpoint / complete / `--step` done), `2` nothing-to-watch / read error / ambiguous PID, `3` auto-block, `4` crash, `5` timeout. Flags: `--until <phase>` (return early when a phase settles), `--timeout <dur>`, `--follow`/`-f` (tail the run log). Refuses to attach when `.canon-pid` and a live heartbeat PID disagree (PID-reuse safety). Settle detection is liveness-gated: a heartbeat that goes stale during a between-phase synchronous window (scaffold commit, `git worktree add`, node_modules symlink, agent session-init — all block the event loop so the heartbeat timer can't tick) does not trip a false `step_done` while the orchestrator pid is still alive and unblocked. Pair with `canon run <id>`: run detaches, watch blocks.
- **Canon manages runtime-file `.gitignore` patterns across `init`, `upgrade`, and `doctor`.** `canon init` ensures an adopter's `.gitignore` contains a canon-owned `# canon:start`/`# canon:end` block with the three orchestrator runtime patterns (`tasks/**/.canon-pid`, `tasks/**/.canon-run.log`, `tasks/**/.heartbeat.json`), so they stop surfacing as untracked. `canon upgrade` retrofits and refreshes the block on existing adopters, routing through the standard dirty-refusal/`--check`/`--force` queue; a malformed block is reported and never auto-repaired, even under `--force`. `canon doctor` warns when the patterns are absent and names the fix. Adopter content outside the canon block is preserved verbatim.

### Fixed

- **`canon upgrade` no longer silently drops adopter `docs-refs-check` customizations.** The tunable allowlists (`noisySourcePaths`, `validDirs`, `markdownRootDirs`) now live in an adopter-owned `scripts/docs-refs-config.mjs` that `canon upgrade` never overwrites and `canon init` scaffolds. Existing adopters get it created on first upgrade with a prompt to move their entries over before the checker updates.

## [1.7.0] — 2026-05-29

### Added

- **`--push` / `--pr` / `--ship` base-divergence gate.** Hard-fails when local `<base_branch>` is ahead of `origin/<base_branch>`, listing the colliding commits with a `git push origin <base>` fix and an `--allow-divergent-base` override. Runs before the file-allow-list gate (so the root-cause message replaces the misleading per-file "drift" error) and before `--ship`'s merge (so divergent commits can't conflict the post-merge pull and strand ship half-complete). The new `--allow-divergent-base` flag bypasses only this commit-divergence check. `--force` does not bypass the new gate; its existing documented bypasses (the file-allow-list gate, the reroute amendment gate, the dirty-`REPO_ROOT` worktree-start gate, and `--full-send` on a delicate task) are unchanged.
- **Scaffold push reminder.** The first `canon run` on a task prints a one-time reminder to `git push origin <base>` after the scaffold commits land on the local base branch. Fires once per bundle, never on reroutes or review iterations; informational only — `canon run` never pushes.

### Changed

- **Canon runs every fresh Codex `exec` with `--sandbox workspace-write`** regardless of the operator's `~/.codex/config.toml` state. Without an explicit baseline, the pipeline previously ran Codex with whatever sandbox the operator's HOME happened to declare. Resumed sessions still inherit their original sandbox.

### Removed

- **`canon init` no longer creates a project-local `.codex/config.toml`.** Codex CLI only reads `~/.codex/config.toml`. Adopters who want personal Codex defaults — sandbox, MCP servers, model preferences — set them in `~/.codex/config.toml`. `canon doctor`'s codex-trust check is unaffected. Upgrading does not delete an existing project-local `.codex/config.toml` left by an older install; the file is inert for Canon (Codex CLI reads `~/.codex/config.toml`, not repo-local config) and can be removed if unmodified.

### Fixed

- **Canon-shipped docs no longer reference orchestrator source paths that don't exist in adopter repos.** `CLAUDE.md`, `docs/pipeline-orchestrator.md`, and the `canon-review` skill referenced canon-internal paths that broke `npm run docs-refs-check` for adopters after upgrading to 1.6.0.
- **`docs-refs-check` recognizes line ranges separated by en-dash (U+2013) and em-dash (U+2014)**, not just ASCII hyphen. Citations like `file.ts:42–50` are no longer flagged as missing refs.
- **`--pr` base-drift gate honors files declared in `## Amendment` / `## Amendment Round N` sections of `spec.md`.** `parseAffectedFilesFromSpec` previously walked only `## Design`, forcing operators to duplicate amendment-added files into the main Affected Files table to clear the gate.
- **`canon run --ship` tolerates a branch already deleted by GitHub's "auto-delete head branches".** When `gh pr merge --squash --delete-branch` fails on branch deletion but the specific attempted PR is confirmed merged, ship warns and completes teardown instead of dying after the irreversible merge.

## [1.6.0] — 2026-05-28

### Added

- **Detach mode for `canon run`.** Non-TTY invocations (Claude Code Bash tool, CI, piped) respawn into their own session so harness pgroup-kill (session-resume, SSH disconnect, terminal close) can't reach them. Interactive terminals stay foreground. Opt out with `CANON_NO_DETACH=1`.
- **`canon stop <id>`.** Gracefully terminate a detached run. Self-heals stale `.canon-pid` / `.heartbeat.json` when the orchestrator is already dead.
- **Heartbeat file + `canon doctor` stale-orchestrator detection.** Flags tasks whose status says in-progress but whose heartbeat is missing or >120s stale, with a `canon run <id>` resume hint.

### Changed

- **`AGENTS.md` commit-ownership rule matches what the orchestrator actually does in worktree mode** — scaffold commits to base before implement; human-review commit is `chore: human review (<TASK-ID>)`.

### Fixed

- **Release-process branch-naming convention corrected.** One release branch per release, named for the version it ships (`release/v1.6` for 1.6.0, `release/v1.5.1` for 1.5.1).

## [1.5.1] — 2026-05-27

### Fixed

- **Round-N code-review docs/templates match the v1.5 executable prompt** — adopter-facing docs require re-filling the Stage 1 AC table every review round, with a `Met (unchanged from round N-1)` shortcut. Fixes #108.
- **Validation enum guidance surfaces human-only checks** — `human_pending`, `deferred_by_spec`, and the `Acknowledged:` waiver convention are documented so unresolved human checks appear in `done.md`. Fixes #109.
- **First worktree creation refuses dirty source edits in `REPO_ROOT`** — only task artifacts and pipeline telemetry are tolerated; dirty source aborts unless `--force` is supplied. Fixes #110.

## [1.5.0] — 2026-05-26

### Changed

- **Claude `code_review` upgrades to Opus on L/XL/delicate.** New `CLAUDE_MODEL_REVIEW_LARGE` env var (default Opus) splits from `CLAUDE_MODEL_REVIEW` (default Sonnet, still used for S/M). Closes the Codex/Claude tier asymmetry on XL/delicate.
- **Worktree-canonical task state from implement onward.** The worktree is canonical for task-scoped state from implement onward; `REPO_ROOT` is canonical for project-level resources and pre-implement task state. `canon task status/list/accept/phase` read from the worktree when one exists past plan. PR #104.

### Added

- **`/canon-review` skill — adversarial pre-pipeline spec review.** Dispatches three parallel sub-agents (structural / factual / spec-quality) at the spec and surfaces BLOCKING / STRONG / NIT findings inline. Opt-in; recommended for M/L/XL or delicate specs.
- **`docs-refs-check` adopter skip-path surface (`NOISY_SOURCE_PATHS`).**
- **`docs-refs-check` treats `...` as a placeholder** in both target-side and symbol-side refs.
- **`docs-refs-check` exempts per-task `notes.md` and `spec-review.md`** — both routinely contain refs to imagined paths.
- **`docs-refs-check` skips gitignored paths** — refs to gitignored files (e.g. `.claude/settings.local.json`) and source markdown files that are themselves gitignored are excluded.

### Fixed

- **`--pr` base-drift gate accepts directory-form Affected Files entries** — `` `dist/` `` matches every subpath. Same prefix semantics in the human-review dirty-tree and staging gates.
- **`--pr` base-drift and human-review gates auto-allowlist `PIPELINE_MANAGED_DOCS` once `qa.status = done`** — QA's "Docs Freshness" sweep no longer forces a spec backfill.
- **Orchestrator survives SIGHUP from a dying supervising shell.** PR #105.
- **Code-review pre-flight exempts pipeline telemetry files from the diff coverage check.** PR #106.
- **`canon run --ship` no longer crashes with ENOENT for tasks created with `worktree: false`.**
- **`canon task release-init` inserts the new CHANGELOG block before the first version block** — file-level meta stays between the H1 and the version entries.
- **Code-review pre-flight rejection no longer skips Stage 1 on subsequent rounds** — the rejection path appends a `## Pre-Flight Rejection` section to `review.md` instead of stomping it.
- **Round-N code_review prompt re-fills the Stage 1 AC table every round** — with a `Met (unchanged from round N-1)` shortcut for untouched ACs.
- **`canon task list` no longer crashes on orphan- or stale-worktree state** — invalid entries render as `INVALID: <reason>` and the listing continues.

## [1.4.0] — 2026-05-24

### Added

- **`canon run --full-send`** — spec to draft PR with no human interrupts. `/canon-spec` detects natural-language full-send intent. Delicate tasks require `--force`.
- **`--pr` base-drift safety gate** — aborts if files outside the spec's *Affected Files* changed on base mid-pipeline. `--force` bypasses. PR #97.
- **`--pr` auto-commit allow-list scoped to *Affected Files*** — out-of-scope dirty files warn instead of being swept in. PR #96.
- **`--reroute` requires `spec.md` amendment** — `## Amendment` or `## Amendment Round N`. `--force` bypasses. PR #99.
- **`docs-refs-check` script + CI gate** — markdown ref hygiene validation. Adopters opt in via `npm run docs-refs-check`.

### Changed

- **`CLAUDE.md` no longer claims `base_branch` is "typically `dev`"** — reflects the variety of adopter branch models.
- **Expanded `--help` for `--reroute`, `--pr` / `--push`, `--ship`** — each flag names its expected starting state, files read/written, and alternatives.

### Fixed

- **Implement phase only commits the task scaffold to base once** — eliminates the recurring pre-pipeline commits that produced PR-merge conflicts.
- **`--ship` actually invokes `gh pr merge`** — silently dead since 1.3.2.
- **`--ship` no longer commits dirty pipeline-shared docs to base** — the squash merge brings docs to base atomically.
- **`--ship` no longer creates a premature GitHub release** — adopters drive release tagging from their own workflow.
- **`--ship` tolerates a worktree-held local branch on `gh pr merge --delete-branch`.**
- **`parseValidationRequiredChecks` distinguishes empty from missing `## Validation Required` section.**
- **`canon task release-init` writes `.canon/version` and uses the canonical `## [<version>] — YYYY-MM-DD` block format.**

## [1.3.2] — 2026-05-19

### Fixed

- **Auto-commit handles files already deleted in earlier task-branch commits.**
- **`canon task accept` rollback uses atomic tmp+rename.**
- **`parseHandoffPathCell` rejects markdown links with empty URL `[foo]()`.**
- **`canon doctor` codex-trust check accepts single-quoted TOML and handles root `/` as a trusted ancestor.**
- **`--ship` operator docs corrected** — `--ship` calls `gh pr merge --squash --delete-branch` itself; do not merge the PR manually.

## [1.3.1] — 2026-05-19

Recovery release for v1.3.0 — the auto-release workflow tagged 1.3.0 at the first version-bump commit while extracting notes from main's HEAD, so the release page advertised fixes that weren't in the tagged code. This release ships them plus the workflow fix.

### Added

- **`canon doctor` checks codex project trust** — parses `~/.codex/config.toml`'s trusted-projects list and prints the exact TOML line to add when missing.
- **`canon task accept` accepts multiple task IDs for bundle mode.** Closes [#89](https://github.com/tstraub89/canon-ai/issues/89).

### Fixed

- **`canon task accept` parser rejects absolute paths and `..`-traversals.** Closes [#90](https://github.com/tstraub89/canon-ai/issues/90).
- **Gitignored handoff entries exempt from existence and coverage checks** — build-generated artifacts no longer trip auto-commit.
- **`canon task list` no longer crashes on non-canonical `status.json`** — invalid rows render as `INVALID: <reason>`. Closes [#83](https://github.com/tstraub89/canon-ai/issues/83).
- **`canon run --pr` uses the repo's `.github/pull_request_template.md`** if present. `CANON_PR_BODY` override available.
- **`canon run --pr` at `human_review` is idempotent** — both code paths check for an open PR before recreating.
- **`docs/pipeline-orchestrator.md` lists all four `canon task accept` guards.** Closes [#91](https://github.com/tstraub89/canon-ai/issues/91).

### Changed

- **`auto-release.yml` extracts release notes from the tagged tree, not the workflow's checkout.** Adds post-publish verification. Closes [#92](https://github.com/tstraub89/canon-ai/issues/92).

## [1.3.0] — 2026-05-19

Hotfix release for two failure classes exposed by a GP dogfood.

> **Note (added 2026-05-19):** v1.3.0's GitHub release was originally published with notes describing six fixes that weren't in the tagged code ([#87](https://github.com/tstraub89/canon-ai/issues/87)); the page has been corrected and the missing fixes ship in [v1.3.1](#131--2026-05-19).

### Added

- **`canon task accept <id> <phase> [--force]`** — operator escape hatch for manually-committed work. Marks the phase done and sets `operator_accepted: true` so post-phase dispatch is skipped on subsequent runs. Only `implement` is supported today.

### Fixed

- **Strict handoff Changes-table parser rejects combined rows, wildcards, and unfilled placeholders.**
- **Handoff template no longer ships a literal `` | `<path>` | ... | `` example row.**

## [1.2.0] — 2026-05-18

### Added

- **`canon upgrade --check`, `--force`, `--no-stage`** — `canon upgrade` refuses to overwrite dirty managed files by default (exit 2). Closes [#63](https://github.com/tstraub89/canon-ai/issues/63).
- **`canon upgrade` header-only-syncs `docs/pipeline-invocations.md`** — refreshes the canon-owned header while preserving telemetry rows. Closes [#67](https://github.com/tstraub89/canon-ai/issues/67).
- **`canon doctor` enforces Claude Code ≥ 2.1.72.** Closes [#70](https://github.com/tstraub89/canon-ai/issues/70).
- **Release process documented + automated** — new `docs/release-process.md` and `.github/workflows/auto-release.yml`. Closes [#66](https://github.com/tstraub89/canon-ai/issues/66).
- **Private-distribution and license language made explicit in README.** Closes [#68](https://github.com/tstraub89/canon-ai/issues/68).

### Fixed

- **`canon run <id> --pr` handles `complete` and stays idempotent when a PR already exists.** Closes [#72](https://github.com/tstraub89/canon-ai/issues/72).
- **`canon run <id> --ship` is idempotent on partial cleanup and auto-deletes a stale remote task branch.**
- **`canon task post-merge-sync` nudges archive-ready tasks instead of going silent.**
- **Auto-commit handles markdown-link handoff paths and hard-fails on source-dirty empty handoff.**
- **Validation pre-flight diagnostics sharpened.** Closes [#71](https://github.com/tstraub89/canon-ai/issues/71).
- **Retired `runtime_validation` phase removed from shipped pipeline docs.** Closes [#64](https://github.com/tstraub89/canon-ai/issues/64).
- **README permission allowlist re-synced with `canon doctor`.** Closes [#65](https://github.com/tstraub89/canon-ai/issues/65).

### Changed

- **`dist/` builds are now reproducible across worktrees.**

## [1.1.3] — 2026-05-17

### Fixed

- **Restored `picocolors` entry in `package-lock.json`** corrupted by a too-broad `sed` substitution during the 1.1.2 release. No adopter impact.

## [1.1.2] — 2026-05-17

### Fixed

- **`canon upgrade` syncs `docs/pipeline-orchestrator.md` to existing adopters** — added to `CANON_OWNED`.

## [1.1.1] — 2026-05-17

Adopter-feedback cleanup from a fresh GP install of 1.1.0. No runtime behavior change; doc + scaffold fixes only.

### Fixed

- **README install command corrected** — `npm install -g --install-links github:tstraub89/canon-ai`. Drops `jq` from Prerequisites.
- **Stale canon-internal source-path references swept from adopter-facing shipping content** — `templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/CODEX.md`, both `pipeline-orchestrator.md` copies, and the canon-owned skills. `templates/docs/pipeline-orchestrator.md` reframed as a reference for *using* canon's pipeline.

### Changed

- **`canon init` no longer mutates the adopter's `package.json`.**
- **`canon update` targets the GitHub source.**

## [1.1.0] — 2026-05-17

### Changed

- **canon is self-contained at runtime.** Adopters' runtime requirements drop from `{node, git, bash, jq}` to just `{node, git}`. The 693-line `scripts/task.sh` becomes `src/task/index.ts` with the same `canon task` API. Orchestrator compiles to `dist/scripts/run-task.js`; templates inline as build-time imports.
- **`canon run <id>` spawns `node dist/scripts/run-task.js`** instead of `tsx scripts/run-task.ts`.

### Fixed

- **`npm install -g github:tstraub89/canon-ai` now works reliably.** See [PR #58](https://github.com/tstraub89/canon-ai/pull/58).
- **`syncWorktreeTelemetry` no longer strands managed-doc edits on the task author.**
- **CI's `npm install -g` verify step uses `--install-links`.**

### Removed

- **`scripts/task.sh`** (replaced by `src/task/index.ts` — same API), **`jq` hard dependency**, **`tsx` from runtime `dependencies`**, **`mustache` from runtime dependencies**, and the `npm run-task` dev shortcut.

## [1.0.2] — 2026-05-16

### Fixed

- **Git-based installs work now — commit `dist/` instead of building at install time.** Supersedes 1.0.1's `prepare: "tsup"` hook ([npm/cli#8440](https://github.com/npm/cli/issues/8440)).

## [1.0.1] — 2026-05-16

### Fixed

- **Git-based installs now produce a working `canon` binary.** Added `"prepare": "tsup"` so `npm install github:tstraub89/canon-ai` builds `dist/` before install. (Superseded by 1.0.2's commit-dist approach.) Reported in [discussion #56](https://github.com/tstraub89/canon-ai/discussions/56).

## [1.0.0] — 2026-05-16

First major release. Canon ships as the `canon-ai` npm package with a full CLI, Claude Code skills, and a unit-test suite.

### Added

- **`canon-ai` npm package** — `canon` binary wired through `dist/cli/index.js`.
- **`canon` CLI** — six commands: `init`, `doctor`, `upgrade`, `update`, `run`, `task`.
- **`/canon-spec`, `/canon-pipeline`, `/canon-status`, `/canon-changelog` Claude Code skills** — installed by `canon init`, synced by `canon upgrade`.
- **Unit test suite** — 237 tests covering CLI commands, orchestrator extractors, validation parsers, and phase-gate logic.
- **Affected-files section in implement prompts** — Codex receives the committed diff path set so spec authors can write predicate-gated validation checks.
- **Project template overrides** — `tasks/_templates/` survives `canon upgrade`; `.canon/templates/` is canon-owned.
- **`.canon/README.md`** — "do not edit these files" notice with override workflow.

### Removed

- **`runtime_validation` orchestrator phase** — implement now routes directly to `code_review`. Validation execution lives inside agent phases.

### Changed

- **Codex CLI invocation no longer hardcodes sandbox flags** — `.codex/config.toml` is the authoritative source.
- **Task templates moved** from `tasks/_templates/` to `.canon/templates/`; `tasks/_templates/` is now the override location.
- **`detectInstallType`** inspects the package's own install path.
- **Signal exit propagation** in `run` and `task` no longer swallows non-zero exits.
- **`CANON_VERSION`** injected at build time via tsup `define`.

### Fixed

- `scaffoldTemplates` and `runUpgrade` extracted as testable pure functions.
- `upgrade` no longer stages paths that may not exist when a `CANON_OWNED` template is missing.

## [0.6.1] — 2026-05-15

### Fixed

- **Code-review diff injection** — orchestrator pre-computes `git diff <baseBranch>...HEAD` and injects it into the review prompt. Closes [#46](https://github.com/tstraub89/canon-ai/issues/46).
- **Shared-doc sync over-skipping** — per-file divergence check instead of HEAD-level; unrelated commits on dev no longer block the entire sync.

## [0.6.0] — 2026-05-14

### Fixed

- **Reroute session prompt** — `--reroute` with an existing Codex session uses a purpose-built resumed-reroute prompt instead of the generic resume wrapper.
- **`spec_review` and `implement` use separate Codex session slots** (`codex_spec_review` vs `codex`).

### Added

- `promptImplementResume()` extracted into its own function.
- `wrapForResume` parameter on `runCodex()` — purpose-built resumed prompts can bypass `toResumePrompt` wrapping.

### Changed

- **`--reroute` warns that `spec.md` amendments must be written to the main repo** (not the worktree path).
- **`CODEX.md` and the handoff template document file-revert behavior** — byte-perfect reverts use `git show origin/<base>:<path>` since `git restore` is blocked by the sandbox.

## [0.5.1] — 2026-05-13

### Fixed

- `run-task-safety.test.ts` skips instead of failing with EPERM when `git worktree add` is blocked by the environment.

## [0.5.0] — 2026-05-13

### Added

- **`Fail – unrelated` validation result state** — Codex can record this when a required check fails due to a pre-existing flake outside the task's Affected Files. Notes must contain a specific test/file reference.

## [0.4.5] — 2026-05-12

### Fixed

- `resolveTaskCwd` / `getActiveCwd` no longer die when `branch` is empty on a fresh task.

## [0.4.4] — 2026-05-12

### Fixed

- Runtime-validation retry prompts reference the correct artifact directory using the monotonic `runtimeIterations_total` counter.
- Closing `human_review` without a `handoff.md` now fails closed instead of silently returning ok.

## [0.4.3] — 2026-05-11

### Fixed

- Handoff iteration sections contribute their own `### Changes` tables — files introduced in later review rounds are no longer falsely rejected.

## [0.4.2] — 2026-05-11

### Fixed

- Shared-doc sync uses a shared registry, fails closed on divergence, and compares content instead of byte length.
- Human-review auto-commit stages protected managed docs through the same shared-doc registry.
- Regression coverage added for linked-worktree root resolution and shared-doc sync guardrails.
- `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL` defaults documented in orchestrator docs and README.

## [0.4.1] — 2026-05-11

### Fixed

- **`--ship` fails closed** across worktree teardown and archive commit handling.
- **Task branch creation honors `status.base_branch` strictly.**
- **Worktree-backed bundle tasks resolve to the correct worktree.**
- **`validateHandoffAgainstSpec()` rejects specs that omit or empty out `## Validation Required`.**

## [0.4.0] — 2026-05-11

### Added

- GitHub Actions CI workflow and POSIX-safe `npm test` glob.
- `scripts/run-task.ts` split into focused modules; prompt prose moved into Mustache templates with golden-output regression coverage.
- `--dry-run` on `run-task` — prints planned phases, agents, models, and effort without spawning an LLM session.
- `runtime_validation` phase between `implement` and `code_review`. (Removed in 1.0.0.)
- Iterative counter fields on review phases: `iterations_current_loop`, `iterations_total`, `changes_requested_total`, `auto_block_count`.
- Prompt-fidelity regression suite plus `CANON_TASKS_DIR_OVERRIDE` and `CANON_PATTERNS_MD_PATH` test hooks.
- Canon provenance stamping in `status.json.canon` and the `Canon Governance` section in `handoff.md`.

### Fixed

- Worktree telemetry and task-artifact sync no longer clobber main-checkout files with shorter worktree copies.
- AC Coverage check parses the markdown table instead of pattern-matching prose.
- Runtime validation no longer writes a second top-level baseline after a reroute.
- `cmd_reset_spec_review` preserves cumulative counters; `--reroute` resets only the current loop counter.
- `task.sh phase` and `--ship` honor the active task worktree; the shell wrapper prefers the repo-local `tsx` binary.

## [0.3.0] — 2026-05-10

### Added

- Post-Codex `isTemplateUnfilled` check on `spec-review.md` — orchestrator rejects `spec_review: done` when the artifact is still the bare template.
- README "Supported platforms" section — macOS/Linux supported; Windows requires WSL2 (#22).
- Three new `docs/decisions.md` entries — "Declared Canon vs Executable Canon"; "Canon is a quality layer, not an authoring tool"; "Track new work in BACKLOG.md by default".

### Fixed

- `.claude/settings.local.json` filename in `.gitignore` (#14).
- `task.sh release-init` dead `short=` reassignment removed (#21).
- `docs/product-owner.md` reference removed from agent startup prompts (#15).
- `.agent/docs-map.json` Citation grounding block removed from the code-review template (#16).
- GalleryPlanner project names scrubbed from canon-supplied source comments and test fixtures (#18).
- README install step includes `mustache` + `@types/mustache` (#12).
- Node version docs aligned to 24.x only.
- `phaseCommands` quotes the absolute `task.sh` path (#9).
- `retryAgentForPhase` maps phase to session slot instead of the deprecated flat `claude` slot (#10).
- Post-Claude `review.md` template check reads from the active worktree, not REPO_ROOT (#11).
- First-implement worktree creation creates `task/<id>` directly in the worktree from `baseBranch` (#6).
- `code_review` retries run in the active worktree.
- Various script-location references aligned with the `run-task` module split.

### Removed

- `npm run setup-hooks` script on `main` (the merge-guard hook file is deliberately dev-only). Closes #13.

## [0.2.0] — 2026-05-08

### Added

- ESLint with `@typescript-eslint/recommendedTypeChecked` as the repo's lint gate. `npm run lint` required for all changes.

## [0.1.0] — 2026-05-07

### Added

- **Post-commit handoff verification at code-review pre-flight** — the pipeline cross-checks the committed diff against every bundle member's handoff Changes table.

### Fixed (harness safety)

- **`autoCommitCode()` post-commit verification via `git diff HEAD --name-only`** — catches silent-partial-commit failures where `git status` reports clean but the file actually differs from HEAD.
- **`--ship` pre-flight branch safety** — three independent guards (`assertTaskBranchPushed`, `assertNoOpenPRForTask`, `assertOriginTaskBranchAbsent`) prevent destruction of unpushed work and silent shipping of remote-only commits.
- **Worktree creation aborts with "run `npm install` in `REPO_ROOT` first"** when `package.json` exists but `REPO_ROOT/node_modules` is missing.

### Changed

- `--reroute` help text clarified.

## [0.0.1] — 2026-05-07

Initial extraction of canon from its embedded source project. Pipeline built but unverified end-to-end.
