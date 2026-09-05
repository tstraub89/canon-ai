# Spec: update-from-npm-registry — `canon update` installs stable releases from the npm registry; drop the postinstall hook script

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

canon-ai is now published to the npm registry (`canon-ai@3.0.0`, with provenance) and the README's primary install path is `npm install -g canon-ai`. `canon update` predates that: it always installs from GitHub. `src/cli/commands/update.ts` resolves a release tag with `git ls-remote`, then runs `npm install [-g|<save flag>] --install-links github:<slug>#<sha>` (`update.ts:451`, `478`, `487`). Two consequences for adopters:

1. **An npm install is silently converted into a git install.** The first `canon update` after `npm install -g canon-ai` replaces the registry package with a `github:` spec that `npm ls` shows with no `resolved` source, loses the registry's provenance attestation, and pulls the full repository from GitHub instead of the 280 kB tarball.
2. **The npx branch recommends a form the README no longer leads with.** When run under `npx`, `canon update` prints `npx --install-links github:tstraub89/canon-ai upgrade` (`update.ts:394`), the only remaining runtime string that names the git install form.

Separately, the published package carries a `postinstall` script, `scripts/install-git-hooks.mjs`, whose only real effect is to install canon-ai's own contributor pre-commit hook via `simple-git-hooks`; it exits 0 without doing anything in every adopter context (no `.git/`, no devDependencies, worktree `.git` file). npm's install-scripts policy now warns on every adopter install: `1 package has install scripts not yet covered by allowScripts: canon-ai@3.0.0 (postinstall: node scripts/install-git-hooks.mjs)`, observed on 2026-09-04 installing 3.0.0 from the registry. Adopters pay a warning for a script that can never do anything for them.

Nothing reads `.canon/provenance.json` today (`src/cli/index.ts:37` says so; `doctor.ts` and `canon-snapshot.ts` have no reader), so changing what `canon update` records breaks no consumer. A stale comment in `src/cli/commands/init.ts:85-93` still says canon-ai "isn't on the npm registry".

## Decision

`canon update` installs from the npm registry whenever the registry is where the requested build lives, and keeps the GitHub path for everything the registry does not publish:

- **Stable channel on the canonical package** (default; slug is `tstraub89/canon-ai` and no `--channel`/`--ref`): resolve the highest final release tag from GitHub exactly as today, then verify that `canon-ai@<version>` exists on the registry, then install `canon-ai@<version>` (no `--install-links`, no `github:`). If the registry does not have that version, refuse with a message naming the version, saying the release exists on GitHub but has not reached npm, and pointing at the GitHub fallback (`--ref v<version>`), with no install run. Fail closed, matching the existing "no fallback to an unpinned source" rule.
- **`--channel main`, `--ref <ref-or-sha>`, or a `CANON_UPSTREAM_REPO` override**: unchanged, the git path (`--install-links github:<slug>#<sha>`), because those builds are not on the registry.
- **npx branch**: the recommendation becomes `npx canon-ai@latest upgrade`.
- **Provenance** keeps its shape and gains a registry-aware `source`: for a registry install, `source` is `canon-ai@<version>` and `resolved_sha` is still the release tag's commit SHA, so a future reader can pair the registry version with the GitHub commit. Git-path installs record the `github:` spec as today. The `channel` values are unchanged.

The published package stops running scripts on install: `postinstall` is removed from `package.json`, `scripts/install-git-hooks.mjs` leaves the npm `files` list, and contributors install the hook once with a dev-only `npm run hooks` documented in CONTRIBUTING. CI's `sync-templates:check` remains the guardrail for a contributor who skips it.

Observable differences:

- An adopter who installed from npm and runs `canon update` stays on the registry package; `npm ls -g canon-ai` shows a registry-resolved 3.x, not a git spec.
- `canon update` on a release that is tagged but not yet published refuses with a clear message instead of quietly installing from git.
- Installing `canon-ai` no longer prints an install-scripts warning.
- `canon update --channel main`, `--ref`, and fork installs behave exactly as before.

## Non-Goals

- **No change to install-root detection** (`detectInstallType`, `layoutGate`, `dependencyGate`) or the pnpm layout refusal. AC-8 makes this structural.
- **No `canon doctor` provenance reader.** That is the separate backlog entry; this task only keeps the record readable for it.
- **No `prepare` script.** It would fire on every git-URL install, which is the fallback path this task deliberately keeps, and reintroduce the warning there.
- **No change to the README's GitHub install alternative** or to CI's git-install smoke test in `.github/workflows/ci.yml`; both remain valid paths.
- **No registry signature or attestation verification** inside `canon update`. npm verifies provenance at install; canon's added check is only "this version exists on the registry".
- **No version bump.** Ships at the next release cut; per `docs/decisions.md` §"Versioning and release policy" a changed canon-supplied default is a minor bump, so the next cut is 3.1.0.

## Acceptance Criteria

- [ ] **AC-1 — Stable canonical installs come from the registry.** With no channel or ref flag and no `CANON_UPSTREAM_REPO` override, after `resolveStable()` returns version `X.Y.Z` and SHA `S`, `canon update` spawns `npm install <save flag> canon-ai@X.Y.Z` (local) or `npm install -g canon-ai@X.Y.Z` (global). The argv contains neither `--install-links` nor a `github:` spec. Verify: update the four argv-pinning tests in `tests/cli.test.ts` (currently asserting the `--install-links github:` form for stable) to assert the registry argv for local (each of the three save flags) and global.
- [ ] **AC-2 — Registry existence is verified first, and refusal is loud.** Before the install, `canon update` confirms `canon-ai@X.Y.Z` exists on the registry (via an injected runner, mirroring how `runGit` is injected for tests). If the check reports the version absent, `canon update` exits non-zero, runs no `npm install`, and prints a message containing `X.Y.Z`, the phrase `not yet on the npm registry`, the words `retry shortly`, and the fallback `canon update --ref vX.Y.Z`. If the check itself fails (network, npm error), it exits non-zero with the underlying error and runs no install. Verify: two tests, one for "absent" and one for "check failed", each asserting no `npm install` spawn occurred.
- [ ] **AC-3 — Non-registry builds keep the git path.** `--channel main`, `--ref <ref>`, `--ref <40-hex sha>`, and a `CANON_UPSTREAM_REPO` fork override each still spawn `npm install ... --install-links github:<slug>#<sha>` with no registry check. Verify: the existing `main`, `--ref`, and fork-slug tests continue to pass, extended to assert that no registry check ran.
- [ ] **AC-4 — Provenance pairs registry version with tag SHA.** After a registry install, `.canon/provenance.json` has `source: "canon-ai@X.Y.Z"`, `channel: "stable"`, `version: "X.Y.Z"`, and `resolved_sha` equal to the release tag's commit SHA. Git-path installs record the `github:` spec in `source` as today. Verify: assertions added to the existing provenance tests for both paths.
- [ ] **AC-5 — The npx message names the package, not the repo.** Under `npx`, `canon update` prints `npx canon-ai@latest upgrade`. Verify: a new test on the npx branch asserts the new text; `grep -n 'install-links' src/cli/commands/update.ts` returns only the git-path spawn lines and their comments, `grep -rn 'npx --install-links' src/` returns nothing, and `grep -rn 'CANONICAL_NPX_SOURCE' src/ tests/` returns nothing (the constant is deleted, not left dead).
- [ ] **AC-6 — The package runs no install scripts.** `package.json` has no `postinstall` (or `preinstall`/`install`/`prepare`) script and `files` no longer lists `scripts/install-git-hooks.mjs`; `npm pack --dry-run` output does not include that file. A dev-only script `hooks` runs `node scripts/install-git-hooks.mjs`. Verify: `node -p "Object.keys(require('./package.json').scripts)"` contains `hooks` and none of the install-lifecycle names; `npm pack --dry-run 2>&1 | grep -c install-git-hooks` is 0. Red-first check: `npm install -g canon-ai@3.0.0` prints the allow-scripts warning today; a pack of this branch installed the same way prints none (manual, Human Test Plan step 3).
- [ ] **AC-7 — Contributors are told how to get the hook.** `CONTRIBUTING.md` §Development setup adds `npm run hooks` after `npm ci`, with one sentence saying what it installs and that CI's template-sync check catches a skipped step. Verify: read; `npm run docs-refs-check` passes.
- [ ] **AC-8 — Detection and gates are untouched.** `detectInstallType`, `layoutGate`, `dependencyGate`, `resolveStable`, `resolveNamedRef`, and `runGitWithFallback` keep their signatures and behavior. Verify: their existing tests pass unmodified, and `git diff main -- src/cli/commands/update.ts` shows no hunk inside those functions.
- [ ] **AC-9 — Adopter docs say registry first.** README §Install's "Updating" paragraph states that `canon update` installs from the npm registry for releases and from GitHub for `--channel main`/`--ref`. The stale comment block in `src/cli/commands/init.ts:85-93` is rewritten to say canon-ai is on the registry and the per-project devDependency write remains disabled for the reasons that still hold (global installs need no devDep). `docs/pipeline-orchestrator.md` gains no new content unless it already documents `canon update` (it does not today; verify with grep). Verify: read; `npm run docs-refs-check` and `npm run sync-templates:check` pass.
- [ ] **AC-10 — Changelog.** `CHANGELOG.md` `[Unreleased]` gains a `### Changed` bullet for the registry install path (with the tagged-but-unpublished refusal and the unchanged git channels) and a `### Removed` bullet for the postinstall script. Verify: read.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/update.ts` | Stable-canonical branch: registry existence check via an injected npm runner, then `npm install ... canon-ai@X.Y.Z`; refusal message when absent or check fails; npx message text; `source` value for registry installs. Git-path branches unchanged. |
| `tests/cli.test.ts` | Update the four argv-pinning tests; add registry-absent and check-failed refusals, npx message, provenance `source` assertions for both paths, "no registry check on git channels". |
| `package.json` | Remove `postinstall`; remove `scripts/install-git-hooks.mjs` from `files`; add `"hooks": "node scripts/install-git-hooks.mjs"`. |
| `CONTRIBUTING.md` | `npm run hooks` in the setup block with one explanatory sentence. |
| `README.md` | "Updating" paragraph: registry for releases, GitHub for `main`/`--ref`. |
| `src/cli/commands/init.ts` | Rewrite the stale "isn't on the npm registry" comment (comment only, no logic). |
| `CHANGELOG.md` | AC-10 entries under `[Unreleased]`. |
| `docs/codebase-map.md` | `canon update` row mentions registry-first for releases; the "Postinstall git-hooks setup" row (line 150) becomes a contributor `npm run hooks` script row. |
| `dist/cli/index.js` | Rebuilt (bundles `update.ts`, `init.ts`). |
| `dist/orchestrator/run-task.js` | Rebuilt if the bundle changes; declare so the `--pr` gate accepts it either way. |
| `package-lock.json` | Regenerated so the root entry's `hasInstallScript` flag matches the manifest without `postinstall`; only that flag changes (amendment nit). |
| `scripts/install-git-hooks.mjs` | Header comment rewritten for `npm run hooks`; no longer a postinstall wrapper nor in the npm `files` list. Comment-only (amendment nit). |

### Why a registry pre-check, and why one task

- **Pre-check vs. letting `npm install` fail.** `npm install canon-ai@X.Y.Z` on an unpublished version does exit non-zero with no partial install, so the check is not what makes the path fail closed. It exists for the message: the tagged-but-not-yet-published window opens on every release, and an adopter who lands in it should read "not on the registry yet, retry shortly, or `--ref vX.Y.Z`" rather than npm's E404. The check reuses the same npm spawn seam as the install, so the added surface is one call and one message, not a second subsystem.
- **Two halves, one task.** The registry install path and the postinstall removal touch disjoint files, but both are "what an adopter who installed from npm experiences," both are small, and both land in the same minor release. Two pipeline runs would cost more than the coupling; the ACs verify each half independently so either could be reverted alone.

### Implementation Notes (non-binding; owned by plan/implement)

- The registry check can be `npm view canon-ai@X.Y.Z version --json` through the same spawn wrapper used for `npm install`, injected like `runGit` so tests never touch the network. Treat any non-zero exit as "check failed", and an empty or mismatched result as "absent".
- The package name for the registry spec should come from the running package's own `package.json` `name`, not a second literal, so a fork that publishes under another name is not silently pointed at `canon-ai`. The canonical-slug test (`slug === CANON_UPSTREAM_REPO`) is what selects the registry path.
- `CANONICAL_NPX_SOURCE` becomes unnecessary once the npx message names the package; delete it rather than leave a dead constant.

### Interaction Dependencies

- **CI git-install smoke test** (`.github/workflows/ci.yml:108`) installs with `--install-links "git+file://$GITHUB_WORKSPACE"` and runs `canon init`/`doctor`/`task new`. It does not depend on `postinstall` and keeps working; it is also the proof the git path still functions.
- **Future `canon doctor` provenance reader** (backlog): its design assumed a `github:` `source`; AC-4 keeps `resolved_sha` populated for registry installs so that reader can branch on `source` shape without losing the commit identity.
- **Contributors' existing checkouts**: already have the hook installed from a prior `npm install`; nothing changes for them. Fresh clones need `npm run hooks` once.
- **Adopters currently on a git-sourced install** (including anyone who ran `canon update` before this ships): their next `canon update` moves them onto the registry package, which is the intended outcome; npm handles replacing the global install.

### Data Model Changes

`Provenance.source` may now be a registry spec (`canon-ai@X.Y.Z`) as well as a `github:` spec. No schema fields added or removed; `channel` values unchanged.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — `src/cli/**` changes; committed `dist/` must match
- [x] `npm run sync-templates:check`
- [x] `npm run docs-refs-check` — README, CONTRIBUTING, CHANGELOG touched
- [ ] E2E — N/A, no UI surface

## Docs Impact

- `docs/codebase-map.md` — the `canon update` row and the "Postinstall git-hooks setup" row (`docs/codebase-map.md:150`) both describe behavior this task changes; QA should update the update row to mention registry-first and reword the hooks row as a contributor script, not a postinstall.
- `docs/product-context.md` — Flow 1 step 1 says `npm install -D canon-ai` (or global); still true. No change expected.
- `docs/decisions.md` — no settled decision names the update source. QA may add a short entry recording "registry for releases, GitHub for unpublished builds; no install scripts in the published package" if it judges it ledger-worthy.
- `docs/patterns.md`, `docs/architecture.md` — none.

## Known Risks

- **Registry propagation lag.** Right after a release, the GitHub tag exists minutes before `npm view` sees the version. AC-2's refusal turns that window into a clear message with the `--ref` fallback rather than a silent git install; the message should say to retry shortly.
- **Registry check false negatives.** A flaky `npm view` fails closed and blocks an update that would have worked. Acceptable by the existing fail-closed rule; the message carries the underlying npm error so the operator can tell lag from outage.
- **Fork publishing under the same name.** The registry path is selected only for the canonical slug; a fork override always takes the git path, so a fork cannot be pointed at the upstream registry package by accident.
- **Contributor hook drift.** A contributor who never runs `npm run hooks` commits without the template sync; CI's `sync-templates:check` fails the PR. Same guardrail as today for a contributor whose postinstall was skipped by `--ignore-scripts`.
- **Test surface.** Four tests assert exact argv and must change in lockstep with the spawn; keep the git-path assertions byte-identical so AC-3 is provable by their passing unmodified.

## Human Test Plan

1. On a machine where canon was installed from npm, run the updater. Expected: it reports the latest release, installs it, and the package manager still shows the tool as coming from the npm registry afterward, not from a GitHub address.
2. Run the updater asking for the development channel. Expected: it installs from GitHub exactly as before and says so.
3. Install a build of this change globally from a packed tarball. Expected: no warning about install scripts appears; installing the current 3.0.0 release the same way does show one.
4. Simulate a release that is tagged but not yet on the registry (or run the updater in the first minute after a release). Expected: the updater stops without installing, names the version, says it has not reached the registry yet, and shows how to install that exact release from GitHub instead.
5. Clone the repository fresh, follow the contributing setup, and make a commit that touches a canon-managed file. Expected: the setup instructions include a one-time hook command, and after running it the commit auto-syncs the template mirror.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes; N/A for features/refactors) — N/A; the postinstall warning is confirmed by direct observation on 2026-09-04 and AC-6 carries the before/after check

## Amendment

> Round 1, 2026-09-04. Source: `code_review` `spec_gap`, carried across three review rounds; both Claude lenses re-flagged it, no code bugs remain. Approved ACs stand except as amended here.

### What the review found

AC-1 spells out the local-install argv as `npm install <save flag> canon-ai@X.Y.Z`. With npm's default `save-prefix` of `^`, that writes `"canon-ai": "^X.Y.Z"` into a project that depends on canon-ai via `dependencies`/`devDependencies`/`optionalDependencies`. The git path this task replaces wrote `github:<slug>#<sha>`, which is inherently exact. So a registry-based `canon update` would loosen the project's pin from an exact build to a floating range, and a later plain `npm install` in that project could move canon-ai without `canon update` being involved. The spec's own "no fallback to an unpinned source" rule is about resolution, but the same intent applies to what gets written: `canon update` pins.

### Decision change

Local registry installs pin exactly. The local-install argv becomes `npm install <save flag> --save-exact canon-ai@X.Y.Z`, so the manifest records `"canon-ai": "X.Y.Z"`. The global install argv is unchanged (no manifest is written). Git-path installs are unchanged.

### Acceptance criteria amended

- **AC-1 (amended)** — the local argv is `npm install <save flag> --save-exact canon-ai@X.Y.Z`; the three save-flag tests assert `--save-exact` is present and the global test asserts it is absent.
- **AC-11 (new) — Manifest pin is exact after a local registry update.** In the local red-first integration fixture, after `canon update` the project manifest's `canon-ai` entry equals `X.Y.Z` with no range prefix. Verify: one assertion added to that fixture; red-first because the current argv writes `^X.Y.Z`.
- **`currentPinFromManifest()`** already reads a bare version spec after the round-1 fix; AC-4's announcement path must show the exact version on the run *after* a registry update. Verify: covered by the existing "announces current and target pins" test extended with a manifest containing `"canon-ai": "X.Y.Z"`.

### Affected Files delta

| File | Change |
|---|---|
| `src/cli/commands/update.ts` | `--save-exact` on the local registry argv only. |
| `tests/cli.test.ts` | AC-1 argv assertions, AC-11 manifest assertion, the announcement test's exact-pin manifest case. |
| `README.md` | The "Updating" paragraph says a project-local update pins the exact version. |
| `dist/cli/index.js` | Rebuilt. |
| `package-lock.json` | Regenerated so the root entry's `hasInstallScript` flag matches the manifest without `postinstall`; only that flag changes. |
| `scripts/install-git-hooks.mjs` | Header comment rewritten: invoked via `npm run hooks`, no longer a postinstall wrapper, no longer in the npm `files` list. Comment-only. |

### Nits carried, disposition

- `package-lock.json` still says `hasInstallScript: true` at the root entry: regenerate the lockfile (`npm install --package-lock-only`) in this iteration so committed metadata matches the manifest; only that flag should change.
- `scripts/install-git-hooks.mjs` header still calls itself a postinstall wrapper shipped via `files`: rewrite the header in this iteration; comment-only.
- The npx test cannot distinguish "read name from manifest" from the default: leave as is; the fork-rename scenario is out of scope per AC-3.
