# Changelog

> Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). canon-ai uses SemVer per [`docs/decisions.md`](docs/decisions.md).

## [1.3.2] — 2026-05-19

Polish patch — low-risk fixes deferred from 1.3.0/1.3.1 review rounds, plus the GP "auto-commit pathspec on already-deleted files" recovery wedge.

### Fixed

- **Auto-commit no longer fails with `pathspec did not match` on files already deleted in an earlier task-branch commit.** When a handoff lists a file that Codex deleted in a previous iteration (the deletion is committed in `baseRef..HEAD`, working tree no longer has the path), the prior bulk `git add -A -- <every handoff file>` call rejected the whole operation because `git add` can't match a path that doesn't exist in the working tree AND isn't tracked. The missing-file precheck already exempted these paths (case (b) — committed in `baseRef..HEAD`); the bulk-stage step now exempts them too via a new `settledDeletions` set built in the same loop. If *every* handoff path falls in this category (rare — Codex would have to delete every claimed file and not modify any), auto-commit returns cleanly without a stage step. Surfaced by the GP starter-preview-renderer task hitting this on every recovery iteration.
- **`canon task accept` rollback now uses atomic tmp+rename instead of direct `writeFileSync`.** The forward path uses `writeStatusAtomic` (tmp + rename); the mid-bundle rollback path used a direct `writeFileSync` and would corrupt the file it was trying to restore if interrupted mid-write. Rollback now writes to `<file>.rollback.tmp` first then renames, matching the atomicity of the forward path.
- **`parseHandoffPathCell` rejects markdown links with empty URL `[foo]()`.** Codex won't produce this on purpose, but a template-substitution bug stripping the URL would otherwise slip through with an empty link. The strict parser's URL slot now requires at least one non-paren character.
- **`canon doctor` codex-trust check accepts single-quoted TOML values.** The codex CLI writes double-quoted (`trust_level = "trusted"`), but operators editing the config by hand often use single quotes. TOML allows both — the check now accepts either via an extended regex.
- **`canon doctor` codex-trust check handles root `/` as a trusted ancestor.** If `~/.codex/config.toml` has an entry for `/` itself trusted (exotic but valid — would cover every workspace by inheritance), the prior `startsWith(`${canonicalProject}${pathSep}`)` produced `//` which never matched. The inherited-ancestor loop now detects the root case and compares without the trailing separator.
- **Operator docs correct the "`--ship` is post-merge cleanup only" framing.** `--ship` calls `gh pr merge --squash --delete-branch` itself before tearing down the worktree and archiving — the operator should not merge the PR manually. The `CLAUDE.md` quick-refs, the orchestrator reference table row, the "Normal sequence" line, and the description paragraph were all updated to reflect what `--ship` actually does. (Both root and templates copies.)

## [1.3.1] — 2026-05-19

Recovery release for v1.3.0. The auto-release workflow tagged v1.3.0 at the *first* commit that bumped `package.json` (`b826f2b`) rather than the merge commit, while extracting release notes from main's HEAD — so the v1.3.0 release page advertised six fixes that weren't actually in the tagged code. v1.3.0 release notes were corrected to match the tag; this release ships the missing five fixes (originally intended for 1.3.0) plus the workflow fix that prevents the mismatch from recurring. Filed by James as [#87](https://github.com/tstraub89/canon-ai/issues/87) (P0), [#88](https://github.com/tstraub89/canon-ai/issues/88) (P0), [#89](https://github.com/tstraub89/canon-ai/issues/89) (P1), [#90](https://github.com/tstraub89/canon-ai/issues/90) (P1), [#91](https://github.com/tstraub89/canon-ai/issues/91) (P2), [#92](https://github.com/tstraub89/canon-ai/issues/92) (P2).

### Added

- **`canon doctor` checks codex project trust.** `codex exec` fails hard if the workspace isn't in `~/.codex/config.toml`'s trusted-projects list — a friction adopters hit on their first canon run in a new repo. The check parses that config, applies nearest-ancestor inheritance (so `/Users/x` trusted covers `/Users/x/repo` when there's no override), treats explicit non-trusted child entries as overriding a trusted parent, and prints the exact one-line TOML block to add when the workspace isn't covered.
- **`canon task accept` accepts multiple task IDs for bundle mode.** Usage is now `canon task accept <id...> <phase> [--force]`. The handoff coverage check unions every task's handoff against one `baseRef..HEAD` diff, so sibling tasks in a bundle don't cross-reject each other's files. All tasks must share `base_branch` and working tree. Closes [#89](https://github.com/tstraub89/canon-ai/issues/89).

### Fixed

- **`canon task accept` parser rejects absolute paths and `..`-traversals.** v1.3.0's release notes advertised this but the tagged code only rejected `*` / `?` / `<` / `>`. Absolute paths and `..` segments poison the batched `git check-ignore --stdin -z` call by causing `git` to exit 128 with no partial stdout — a single bad entry would silently invalidate the entire gitignored-set lookup for that handoff. Rejecting them at the parse boundary keeps the batched filter call clean. Closes [#90](https://github.com/tstraub89/canon-ai/issues/90).
- **Gitignored handoff entries exempt from existence and coverage checks.** Build-generated artifacts like `public/sitemap.xml` regenerated by a tracked script can't appear in `git diff`, `git status`, or `ls-files --error-unmatch`, so the prior auto-commit hit a "report this as a bug" fallback on every iteration that referenced one. A new `filterGitIgnoredPaths` helper batches `git check-ignore --stdin -z` and is consulted by auto-commit, the post-commit verifier, the diff coverage check, evidence-advance, and `canon task accept`. Evidence-advance still refuses to advance when *all* listed files are gitignored — gitignored entries alone aren't source evidence.
- **`canon task list` no longer crashes on non-canonical `status.json`.** A task whose `status.json` lacks the canonical `phases.spec` shape (hand-written tasks, older imports) used to crash the entire listing with `Cannot read properties of undefined (reading 'spec')`. Each row is now wrapped: invalid files render as `INVALID: <reason>` and the listing continues; the command exits non-zero if any invalid was encountered. Closes [#83](https://github.com/tstraub89/canon-ai/issues/83).
- **`canon run --pr` no longer injects "Auto-generated by canon-ai for `<label>`" into PR bodies.** The default now uses the repo's `.github/pull_request_template.md` if present (lowercase or uppercase, `.github/` or `docs/` or repo root — looked up in the active worktree first so branch-local template edits are respected) and falls back to `--fill` (commit messages) otherwise. Adopters who want attribution can set `CANON_PR_BODY` with `$LABEL` and `$TITLE` placeholders.
- **`canon run --pr` at `human_review` is idempotent on the dirty-tree path.** The dirty-tree commit-then-create branch used to call `gh pr create` unconditionally and die on its "PR already exists" exit code when a PR had been opened on a prior run. Both `human_review` paths now route through a shared helper that checks for an open PR on the (branch, base) pair via `gh pr list` first and prints the URL if one exists. Extends the same guarantee [#72](https://github.com/tstraub89/canon-ai/issues/72) added for the clean-tree retry branch.
- **`docs/pipeline-orchestrator.md` lists all four `canon task accept` operator-facing guards.** The reference previously documented only the clean working tree and non-empty `baseRef..HEAD` guards. Now also covers the malformed-handoff-row rejection and the handoff/diff coverage check, with the same accuracy in `templates/docs/pipeline-orchestrator.md`. Closes [#91](https://github.com/tstraub89/canon-ai/issues/91).

### Changed

- **`auto-release.yml` extracts release notes from the tagged tree, not from the workflow's checkout.** The workflow uses `git blame -- package.json` to identify the version-bump commit and tags that SHA — preserving the self-heal retry property where a failed release followed by another push still tags the same commit deterministically. The bug was elsewhere: the "Extract CHANGELOG block" step read `CHANGELOG.md` from the workflow's working tree (main HEAD), not from the bump SHA's tree. When scope was added under the same version after the bump commit, the tag pointed at an early state while the notes described the final state — the v1.3.0 mismatch James filed in [#87](https://github.com/tstraub89/canon-ai/issues/87) and [#88](https://github.com/tstraub89/canon-ai/issues/88). The fix is one line: `git show "${BUMP_SHA}":CHANGELOG.md` instead of reading the workspace file. Adds a post-publish verification step that re-reads `CHANGELOG.md` from the published tag and asserts the version header is present. Closes [#92](https://github.com/tstraub89/canon-ai/issues/92).

## [1.3.0] — 2026-05-19

Hotfix release responding to a GP dogfood that exposed two related failure classes: the 1.2.0 handoff parser silently extracted bare filenames from Codex's combined/wildcard rows (triggering downstream `diff→handoff` mismatches), and the auto-commit state machine had no operator escape hatch when manual recovery was needed — leaving the pipeline wedged after a manual commit.

> **Note (added 2026-05-19):** v1.3.0's GitHub release was originally published with notes describing six additional fixes ([#87](https://github.com/tstraub89/canon-ai/issues/87)). Those fixes were *not* in the tagged code at `b826f2b`. The release page has been corrected to match this entry, and the missing fixes ship as part of [v1.3.1](#131--2026-05-19). The workflow bug that caused the discrepancy is also fixed in v1.3.1.

### Added

- **`canon task accept <id> <phase> [--force]` — operator escape hatch for manually-committed work.** When an operator has manually committed implementation work on the task branch and `canon run` keeps re-running auto-commit against the already-landed commit, `canon task accept` marks the phase done AND sets `phases.<phase>.operator_accepted: true` so the post-phase dispatch (auto-commit for implement) is skipped on subsequent runs. Today only the `implement` phase is supported. Guards: (1) clean source-tree (pipeline-owned paths like `tasks/<id>/...` and `PIPELINE_TELEMETRY_FILES` exempt), (2) non-empty `baseRef..HEAD`, (3) handoff Changes table has no malformed rows, (4) handoff coverage matches the diff (every diff file in the handoff and vice versa). `--force` bypasses all four. The acceptance is pinned to `operator_accepted_sha` (HEAD at accept time) — a later commit on the task branch invalidates the skip — and is automatically cleared whenever `implement` is moved away from `done` (reroute, changes_requested, manual `canon task phase`). Auto-commit also re-checks working-tree cleanliness on each dispatch so an accept followed by uncommitted edits cannot silently bypass auto-commit.

### Fixed

- **Strict handoff Changes-table parser rejects combined rows, wildcards, and unfilled placeholders.** The 1.2.0 parser ran a single permissive `` /`([^`]+)`/ `` regex against the first column and returned whatever match it found — so a row like `` `sitemap.xml`, `llms.txt` `` silently extracted `sitemap.xml` (a non-existent root path) and the real `public/sitemap.xml` was dropped. The new parser anchors each cell to either `` `path` `` or `[path](url)`, rejects multiple paths in one cell, rejects `*` and `?` wildcards (square brackets allowed — they're valid filename chars), and rejects unfilled angle-bracket placeholders like `` `<path>` ``. Errors surface at code_review pre-flight, auto-commit, and evidence-advance with the specific rejection reason per cell instead of failing later with cryptic "missing file" diagnostics.
- **Handoff template no longer ships a literal `` | `<path>` | ... | `` example row.** Both the baseline `## Changes` table and the iteration `### Changes` block start with an empty body and a one-line format hint above. The strict parser would reject the placeholder anyway; removing it from the template avoids the rejection in the first place.

## [1.2.0] — 2026-05-18

### Added

- **`canon upgrade --check`, `--force`, `--no-stage`.** `canon upgrade` no longer silently overwrites dirty managed files. By default it now detects modified/staged managed targets via `git status --porcelain` and refuses with an enumerated list of dirty paths (exit code 2). Pass `--force` to overwrite anyway, `--check` (or `--dry-run`) to preview without writing, or `--no-stage` to skip the post-write `git add`. Untracked managed paths (first-install scenario) are treated as clean — no committed history to lose. Closes [#63](https://github.com/tstraub89/canon-ai/issues/63).
- **`canon upgrade` now header-only-syncs `docs/pipeline-invocations.md`.** Resolves the [1.1.2] "Known limitation" by refreshing the canon-owned header (intro + table column definitions) above the markdown table separator while preserving every appended telemetry row below the separator byte-for-byte. CRLF line endings are preserved verbatim (the separator regex anchors to end-of-line without consuming `\r`). Adopters whose `pipeline-invocations.md` is missing the table separator get a clear skip message instead of silent data loss. Closes [#67](https://github.com/tstraub89/canon-ai/issues/67).
- **`canon doctor` enforces Claude Code ≥ 2.1.72.** `checkClaudeVersion()` runs `claude --version`, parses semver, and fails fast below the verified-safe floor that supports `--effort` — blocking the orchestrator from handing an unsupported CLI a flag it does not understand. As a fallback for users who skip `canon doctor`, Claude spawn failures mentioning the unknown `--effort` option now print a one-line hint directing them back to `canon doctor` and the upgrade command. README Prerequisites tightened to `Claude Code (≥ 2.1.72)`. Closes [#70](https://github.com/tstraub89/canon-ai/issues/70).
- **Release process documented + automated.** New `docs/release-process.md` covering branch model, bump mechanics (`npm version --no-git-tag-version` + `npm install --package-lock-only`, never `sed`), the dev → main release PR, tagging, hotfix path, and the auto-release workflow. New `.github/workflows/auto-release.yml` triggered on push to `main` verifies lockfile integrity by regenerating `package-lock.json` and diffing against the checked-in file (catches the 1.1.3 picocolors-style transitive corruption), blames `package.json`'s `version` line to identify the actual release commit (so a self-heal retry on a later push still tags the right SHA), gates on the GitHub release object existing (idempotent — supports recovery from tag-created-but-release-failed state), extracts the matching `## [<version>] — <date>` block from `CHANGELOG.md`, and creates the tag + release in one shot. Closes [#66](https://github.com/tstraub89/canon-ai/issues/66).
- **Private-distribution and license language made explicit in README.** New "Private distribution" callout near the install command (`gh auth login` required, repo access required, not on public npm). Phase 1 roadmap tightened so public-npm reads as a future direction not a Phase 1 deliverable. License section expanded to match `LICENSE`'s proprietary/confidential framing. Closes [#68](https://github.com/tstraub89/canon-ai/issues/68).

### Fixed

- **`canon run <id> --pr` now handles `complete` and stays idempotent when a PR already exists.** The terminal dispatch now treats `complete` the same as `human_review` for `--push` / `--pr`, so a task that has already reached `complete` no longer dies with `Unknown phase: complete`. On a rerun, the idempotent `--pr` path detects an already-open draft PR and prints its URL instead of trying to recreate it. `canon run <id>` with no flags at `complete` now prints a state-aware banner for the three exit states: open PR, pushed with no PR, or not pushed yet. Closes [#72](https://github.com/tstraub89/canon-ai/issues/72).
- **`canon run <id> --ship` is idempotent on partial cleanup and auto-deletes a stale remote task branch.** `--ship` previously died hard when the worktree was already gone, forcing the operator to recreate one purely so `--ship` could destroy it; `getActiveCwd` now accepts `tolerateMissingWorktree: true` and the ship path uses it. The human_review allowlist gate resolves against the active worktree cwd (falling back to the env override or `REPO_ROOT`) so worktree-scoped tasks no longer false-positive on the supervising checkout's working tree. Auto-delete of a stale `origin/task/<id>` branch uses exact head-ref matching (`gh pr list --json number,headRefName` filtered by `headRefName === branch` in code, constrained to the task's base branch), dodging the `gh pr list --head` prefix-match behavior that could match adjacent branch names (gh CLI issue #10816).
- **`canon task post-merge-sync` nudges archive-ready tasks** instead of going silent on the common happy flow. The nudge filter previously matched only `human_review`, but the documented squash-merge + `--ship` flow advances `human_review.status` to `done` — moving `derivePhase(status)` to `complete`. The filter now includes both, so the typical post-merge cleanup gets surfaced. The post-merge dirty-tree guard was also narrowed: only the `reset --hard` path warrants the blanket refusal; fast-forward updates no longer error on unrelated dirty files.
- **Auto-commit handles markdown-link handoff paths and hard-fails on source-dirty empty handoff.** `parseHandoffFiles` now accepts both `` `path` `` and `[path](url)` syntax in handoff Changes tables — Codex sometimes emits the markdown-link form, which the prior backtick-only parser silently dropped. The empty-handoff branch previously warned but did not fail; if the working tree had real changes that weren't mentioned in any handoff, the pipeline would continue reading working-tree diff instead of a real commit, and code-review/QA would approve against uncommitted changes. Now hard-fails when the source is dirty and the parsed handoff is empty. Surfaced by the pr-at-complete pipeline dogfood (PR #75 iter 0).
- **Validation pre-flight diagnostics sharpened.** `canonicalizeValidationCheck` no longer leaves a trailing backslash on cells with escaped inner backticks (e.g. `` `Type checking: \`npm run type-check:all\`` ``) — those rows canonicalized to a key that never matched their required-check counterpart. The shortcut path is now rejected only when the captured backtick span *ends* with `\` (the actual escape-backtick signature), so cells with internal backslashes in regex labels or paths (e.g. `` `grep \w+` ``, Windows paths) correctly use the shortcut. The "Validation Required item missing from handoff.md" error now lists the canonical key derived from the spec entry AND the canonical keys actually present in the handoff. The pending-row case is split out with its own message ("present but unfilled — still in template 'pending' state") so the agent's silent-no-op state is distinct from a genuinely absent row. Closes [#71](https://github.com/tstraub89/canon-ai/issues/71).
- **Retired `runtime_validation` phase removed from shipped pipeline docs.** Dropped `Orchestrator runtime validation` from both fast/full tier diagrams in `templates/docs/pipeline-orchestrator.md` and `docs/pipeline-orchestrator.md`; added a "Where validation happens" paragraph. New regression test scans operational docs (root + templates `AGENTS.md` / `CLAUDE.md` / `CODEX.md` + both `pipeline-orchestrator.md` copies) for retired phase tokens, case-insensitively. Historical context (decisions.md, lessons-learned.md, BACKLOG, CHANGELOG) intentionally excluded. Closes [#64](https://github.com/tstraub89/canon-ai/issues/64).
- **README permission allowlist re-synced with `canon doctor`.** Restored `Bash(jq *)` (incorrectly dropped in an earlier pass — `jq` is for operator inspection, not canon runtime). Promoted 13 entries from the canon-ai-dev + GP local-settings overlap: `cat`, `head`, `tail`, `grep`, `wc`, `echo`, `tr`, `xargs`, `tee` (read tools + pipeline glue), and `npm test` / `audit` / `ci` plus `npx tsc *` (both bare and `*`-suffixed forms — Claude Code's glob doesn't match empty trailing). README explainer added distinguishing the built-in `Read` / `Glob` / `Grep` tools from bash-pipe equivalents. Tracked `.claude/settings.json` re-synced; SessionStart hook fixed (`./scripts/task.sh list` → `canon task list`, broken since 1.0.0). New drift test parses the README JSON block and asserts equality with `RECOMMENDED_ALLOW`. Closes [#65](https://github.com/tstraub89/canon-ai/issues/65).

### Changed

- **`dist/` builds are now reproducible across worktrees.** New `postbuild` step (`scripts/normalize-dist-paths.mjs`) normalizes the path comments tsup embeds for each bundled module, so worktree builds (which symlink `node_modules` back to the supervising checkout for speed) and CI's clean-checkout builds produce byte-identical `dist/` files. Without this, the CI `dist/` freshness gate fails immediately after any worktree-built commit. Discovered when PR #73 (claude-min-version dogfood) hit the freshness gate; documented for future tasks in `docs/lessons-learned.md`.

## [1.1.3] — 2026-05-17

### Fixed

- **Restored `picocolors` entry in `package-lock.json` to its real version.** A too-broad `sed` substitution during the 1.1.2 release (`sed 's/"version": "1.1.1"/"version": "1.1.2"/g'`) bumped not just the canon-ai root version entries but also the picocolors lockfile entry, which happened to be at 1.1.1. The resolved URL and integrity hash still pointed at the actual picocolors-1.1.1 tarball, so `npm ci` worked (matched hash → install succeeded), but the version-vs-URL mismatch is the kind of dirty lockfile state that npm audit and lockfile-linter tools flag. No adopter impact (the lockfile doesn't ship — `files` excludes it), but caught by Codex on PR #61 review post-merge. Lesson: when bumping the project version in `package-lock.json`, edit lines 3 and 9 specifically, not via a global `sed` — other transitive deps may share the version string.

## [1.1.2] — 2026-05-17

### Fixed

- **`canon upgrade` now syncs `docs/pipeline-orchestrator.md` to existing adopters.** The 1.1.1 reframe of that file (from "canon-ai internals reference" to "adopter-facing pipeline reference") only helped fresh `canon init` runs — `docs/pipeline-orchestrator.md` wasn't in `CANON_OWNED`, so existing adopters' copies were stuck on the 1.1.0 source-path-laden version with no path to update short of re-init or manual copy. Added to `CANON_OWNED` in [src/cli/commands/upgrade.ts](src/cli/commands/upgrade.ts). Adopters who run `canon upgrade` after picking up 1.1.2 will get the cleaned reference. Pure canon documentation — adopters never customize it — so overwriting is safe. Caught by GP after rolling 1.1.1 forward and noticing their docs were unchanged.

### Known limitation

- `docs/pipeline-invocations.md` has the same staleness pattern (its template header gets canon updates; adopters' copies don't) but is NOT in `CANON_OWNED` because it accumulates auto-appended telemetry rows below the header — overwriting would wipe history. A future release will add header-only sync (or migrate the file's adopter-mutable rows to a separate location) so canon updates can flow without data loss. Other `docs/*` files (`architecture.md`, `decisions.md`, `patterns.md`, `lessons-learned.md`, `codebase-map.md`, `product-context.md`, `task-quality-log.md`) are adopter-content-owned by design and don't have this pattern.

## [1.1.1] — 2026-05-17

Adopter-feedback cleanup from a fresh GP install of 1.1.0. No runtime behavior change; doc + scaffold fixes only.

### Fixed

- **README install command** — now reads `npm install -g --install-links github:tstraub89/canon-ai`. Without `--install-links`, npm symlinks the global install to its git cache rather than copying the committed `dist/`, which leaves the `canon` bin pointing at a transient path and command-not-found after install reports success. The `--install-links` flag packs+installs as a regular dependency, which is what a stable global CLI needs. The 1.1.0 README still recommended `npm install -g canon-ai` (which assumes a public npm registry publish that doesn't exist) — corrected to the github-URL form. Also drops `jq` from the Prerequisites list (no longer required since 1.1.0).
- **Stale canon-internal source-path references in adopter-facing shipping content.** Post-1.1.0, canon's adopter install has no `scripts/` directory — everything is bundled into `dist/scripts/run-task.js`. But shipping files still referenced source paths from canon-ai's dev repo (`scripts/run-task.ts`, `scripts/task.sh`, `scripts/run-task/policy.ts`, `scripts/run-task/canon-snapshot.ts`, etc.) that don't exist in any adopter install. The 1.1.0 self-contained refactor updated the CLI surface (`canon run`, `canon task`) but missed sweeping the docs/scaffold templates that describe canon's mechanics. Adopter-facing files cleaned up in this release: `templates/AGENTS.md`, `templates/CLAUDE.md`, `templates/CODEX.md`, `templates/docs/pipeline-orchestrator.md`, `templates/docs/pipeline-invocations.md`, and the canon-owned skills (`canon-status`, `canon-spec`, `canon-pipeline`, `canon-init`). The biggest reframe: `templates/docs/pipeline-orchestrator.md` was an "internals reference" written for canon-ai contributors — now positioned as a reference for *using* canon's pipeline (flags, model matrix, env vars, recovery patterns). Source-path references and the "canon's own self-modification rules" section are removed; adopters who want to inspect canon-ai's internals can browse [the canon-ai repo](https://github.com/tstraub89/canon-ai) directly.

### Changed

- **`canon init` no longer mutates the adopter's `package.json`.** `updatePackageJson()` in [src/cli/commands/init.ts](src/cli/commands/init.ts) used to write `"canon-ai": "^<version>"` to `devDependencies` and add a `"canon": "canon"` script alias. Since canon-ai isn't published to the npm registry, the devDep entry broke adopters' `npm install` and CI (resolves to a non-existent registry package). The script alias was a functional no-op once `canon` is on PATH globally. Function body is preserved (commented out, ready to revive) for when canon ships to npm proper.
- **`canon update` now targets the GitHub source.** Previously hardcoded `npm install -g canon-ai@latest` (registry-only), which broke for everyone who installed canon-ai via the documented github URL flow. Now uses `npm install -g --install-links github:tstraub89/canon-ai` (and the local-devDep variant). The constant `CANON_GITHUB_SOURCE` in [src/cli/commands/update.ts](src/cli/commands/update.ts) is the single switch point — flip it (and drop `--install-links`) when canon ships to npm. Caught by Codex on the release review.

## [1.1.0] — 2026-05-17

### Fixed

- **`npm install -g github:tstraub89/canon-ai` now works reliably — the definitive fix.** 1.0.1's `prepare: "tsup"` failed because npm 11's `pacote` git-source prep doesn't reliably install devDeps before firing the prepare hook ([npm/cli#8440](https://github.com/npm/cli/issues/8440)). 1.0.2 committed `dist/` so the prepare hook wasn't needed, but exposed a *second* failure mode: `esbuild`'s native postinstall — a transitive dep via canon's runtime `tsx` dependency — hit `spawn sh ENOENT` during `npm install -g`. 1.1.0 fixes it at the root: the entire `tsx → esbuild → native-postinstall` chain is removed from the adopter's runtime dep graph. No native postinstalls in the install graph = no postinstall-script bugs from npm. The canon-self-contained refactor below describes how. See [PR #58](https://github.com/tstraub89/canon-ai/pull/58).
- **`syncWorktreeTelemetry` no longer strands managed-doc edits on the task author.** The function was copying AND resetting the worktree path for every file in `PIPELINE_SHARED_DOCS` — correct for auto-appended telemetry, wrong for managed docs (`docs/architecture.md`, `docs/codebase-map.md`, `docs/patterns.md`, etc.) that a task INTENDS to edit on its own branch. Those edits were mirrored into supervising's dirty state and skipped from autoCommit, surfacing as auto-commit coverage failures. Fixed: only telemetry resets; managed docs stay dirty in the worktree for autoCommit to absorb atomically. A divergence guard preserves external manual edits in supervising. Surfaced and fixed during the canon-self-contained pipeline run.
- **CI's `npm install -g` verify step now uses `--install-links`.** Without it, npm symlinks the global install to the git cache and the `canon` bin symlink ends up command-not-found despite the install reporting success.

### Changed

- **canon is self-contained at runtime.** Adopters' runtime requirements drop from `{node, git, bash, jq}` (plus the `tsx → esbuild` chain) to just `{node, git}`. The 693-line `scripts/task.sh` bash+jq helper becomes `src/task/index.ts` (in-process TS, same `canon task` subcommands and semantics). The orchestrator compiles to `dist/scripts/run-task.js` via tsup; prompt templates inline as static build-time imports. The shipped install surface is `dist/` + `templates/` + `CHANGELOG.md` (no `.ts` source, no shell scripts, no README image assets).
- **`canon run <id>` spawns `node dist/scripts/run-task.js`** instead of `tsx scripts/run-task.ts`. The dogfood path for canon-ai contributors is `npm run build && canon run <id>`.

### Removed

- **`scripts/task.sh`** (693 lines of bash+jq) — replaced by `src/task/index.ts`. Same `canon task` API.
- **`scripts/run-task/task-sh.ts`** — orchestrator phase handlers call the new TS task module directly.
- **`jq` hard dependency** — `canon init` and `canon doctor` no longer require it.
- **`scripts/` and `public/` from `package.json` `files`** — not installed by adopters anymore.
- **`tsx` from `dependencies`** — moved to `devDependencies`. Not in adopters' runtime install graph.
- **`mustache` from `dependencies`** — moved to `devDependencies`. tsup bundles it into `dist/` via `noExternal: ['mustache']`, so the bundled CLI has no runtime import from `node_modules` and there's no need to ship mustache as an adopter dep. Adopter install graph is now just `canon-ai` itself — one package, zero transitive runtime deps. Caught by Codex on the release PR.
- **`npm run-task` dev shortcut** — removed. Use `npm run build && canon run <id>`.

## [1.0.2] — 2026-05-16

### Fixed

- **Git-based installs actually work now — commit `dist/` instead of building at install time.** v1.0.1's `prepare: "tsup"` hook fails in practice because npm 11's `pacote` git-source preparation does not reliably install devDependencies into its cache-clone before firing `prepare`. Verified locally: npm's debug log shows the nested install placing exactly one `placeDep ROOT canon-ai` and then running `prepare` against an empty `node_modules`, so tsup is never on disk and the build dies with `sh: tsup: command not found` (exit 127). This is [npm/cli#8440](https://github.com/npm/cli/issues/8440), open and unfixed across multiple npm versions. The industry-standard workaround for git-installable TypeScript CLIs is to commit the build artifact rather than rely on `prepare`. Canon now does that: `dist/` is removed from `.gitignore`, the `prepare` script is gone, and CI enforces freshness with `npm run build && git diff --exit-code -- dist/` so a stale `dist/` fails before merging. The CI assertion that *also* failed to catch this last time (`npm pack && grep dist/`) is replaced with a real `npm install -g "git+file://$GITHUB_WORKSPACE"` + `canon --version` in a clean tmpdir, exercising the actual adopter path end-to-end. Discovered while installing 1.0.1 fresh against the canon-ai private repo; same broken-binary symptom as [discussion #56](https://github.com/tstraub89/canon-ai/discussions/56), but the underlying cause is an npm bug, not a missing hook.

## [1.0.1] — 2026-05-16

### Fixed

- **Git-based installs now produce a working `canon` binary.** Added `"prepare": "tsup"` to `package.json` scripts so `npm install github:tstraub89/canon-ai` (and any git-URL install) builds `dist/` on the consumer side before install completes. Previously the tarball npm built from the cloned repo shipped without `dist/` because `dist/` is gitignored and there was no `prepack`/`prepare` hook — leaving `bin: "./dist/cli/index.js"` pointing at a non-existent file, so `node_modules/.bin/canon` ended up a broken symlink and `canon --version` / `canon doctor` / every other CLI command failed for adopters installing via git. CI now wipes `dist/` and runs `npm pack`, asserting `package/dist/cli/index.js` is in the tarball, so a regression of the `prepare` hook will fail CI before shipping. Reported by [James in discussion #56](https://github.com/tstraub89/canon-ai/discussions/56).

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
