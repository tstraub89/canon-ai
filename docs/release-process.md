# Release Process — canon-ai

This document covers the **mechanics** of cutting a canon-ai release. For the **policy** (what counts as patch / minor / major, who authorizes bumps, changelog scope), see [`decisions.md`](decisions.md) §"Versioning and release policy".

> **Note**: this is canon-ai's *own* release process. Canon prescribes **no** release model to adopters — see [`decisions.md`](decisions.md) §"Canon prescribes no release model to adopters". Adopters pick their own model (trunk, release-branch, tag-from-main, none); the recipes live in the `/canon-pipeline` skill. This doc is one concrete instance, not a template.

## Branch model

canon-ai uses **trunk-based release-from-`main`**:

- **`main` is the trunk.** Task work accumulates on `main` directly — there are no `release/v<version>` branches.
- **Task branches** → PR to `main`. `canon task new` auto-detects `base_branch: main` from the checkout; the orchestrator's `--pr` / `--ship` target it. (This is the default `base_branch`; nothing special to set.)
- **A release is cut when you decide there's enough on `main` to ship**, not on a fixed branch cadence. Accumulate tasks, then cut.
- **Cutting a release is a single version-bump commit on `main`** (bump + lockfile + `dist/` + CHANGELOG finalize), landed via a small PR. The squash-merge to `main` triggers auto-release.
- **`main` is the published state.** Tags and GitHub releases live on `main`, created automatically by `auto-release.yml` from the version-bump commit.

There is no persistent integration branch and no release-boundary PR between two long-lived branches. Hotfixes are just another task on `main`, released whenever you next cut.

> **History**: Through 1.3.x canon-ai used a persistent `dev` integration branch; 1.4.0–1.12.1 used **release-branch-per-version** (one temporary `release/v<version>` per release, PR'd to `main`). As of 1.12.x the project switched to **trunk-based release-from-`main`**: the orchestrator was already release-model-agnostic (`base_branch` drives everything), v1.12.1 was in practice cut as a one-off bump-PR on `main`, and the release-branch ceremony added a branch lifecycle without a corresponding benefit at canon-ai's scale. The auto-release workflow and the CHANGELOG-date CI gate are version-keyed, so they work identically under either model.

## Accumulating task work

Tasks branch off `main` and PR back to `main` — the normal canon flow, no special setup:

```bash
git checkout main && git pull origin main
# canon task new auto-detects base_branch: main from the checkout
canon task new <id> "Title"
canon run <id>
```

As each task ships (`--ship` squash-merges it to `main`), add its bullet to the **`## [Unreleased]`** block in `CHANGELOG.md` with `/canon-changelog <task-id>` — **single-task append, which works from any branch including `main`** (the skill's `| Any | single task ID |` mode). Do it while the task is fresh, before its `tasks/<id>/done.md` is archived. The in-flight block stays **version-less** (`## [Unreleased]`, Keep-a-Changelog form) — the version isn't decided until you cut, so don't pin it early.

> The skill's *empty-sweep* in-progress-append auto-detection is scoped to a release/working branch, not the default branch — so during accumulation on `main` use the per-task `/canon-changelog <task-id>` form above (single-task append, supported on any branch). Finalization happens later on the short-lived release branch (see "Cutting a release"), where the skill's finalize mode applies normally. Closing the default-branch empty-sweep gap is a backlogged `canon-changelog` refinement.

The version in `package.json` / `.canon/version` / `canon --version` reflects the **last published** release during accumulation. It is bumped at cut time (next section), not while accumulating.

## Cutting a release

When there's enough on `main` to ship, decide the tier (patch / minor / major) per [`decisions.md`](decisions.md) §"Versioning and release policy" — confirm with the product owner for anything but a patch. Then make the release commit on a short-lived branch off `main` and PR it:

```bash
git checkout main && git pull origin main && git status --porcelain
git checkout -b release-vX.Y.Z main   # short-lived; just carries the bump commit

# Bump versions atomically. Use npm version + the lockfile refresh, never sed
# (the 1.1.3 picocolors bug shipped from a too-broad sed substitution).
npm version X.Y.Z --no-git-tag-version
npm install --package-lock-only

# Sync .canon/version. auto-release.yml asserts package.json's version equals
# .canon/version and dies if they diverge.
echo "X.Y.Z" > .canon/version

# Rebuild dist/. The version string is baked into dist/cli/index.js at four
# call sites (doctor's checkCanonVersion, init's writeCanonVersion, runUpgrade,
# printVersion). CI runs `git diff --exit-code -- dist/` on every PR to main and
# fails until dist matches the new version — rebuild AS PART OF the bump commit,
# atomic with package.json. Don't skip even if dist looks clean locally: a fresh
# tsup run may reorder output and a later PR will produce the spurious diff anyway.
npm run build
```

Finalize the CHANGELOG with `/canon-changelog finalize` — you're on the short-lived `release-vX.Y.Z` branch (a release/working branch), so the skill's finalize mode applies normally: it renames the `## [Unreleased]` block to `## [X.Y.Z] — YYYY-MM-DD` and inserts a fresh empty `## [Unreleased]` above it (Keep-a-Changelog convention). CI enforces the date: a PR to `main` whose target version block still says `unreleased`/`Unreleased` fails the "Verify CHANGELOG date" step.

Verify the lockfile, commit, and open the release PR:

```bash
# Only the two root "version" lines should change. Any transitive node_modules/*
# version line is the picocolors-style corruption repeating.
git diff -- package-lock.json | grep '"version"'

git add package.json package-lock.json .canon/version dist/ CHANGELOG.md
git commit -m "chore: release X.Y.Z"
git push -u origin release-vX.Y.Z
gh pr create --base main --head release-vX.Y.Z --title "Release vX.Y.Z: <short theme>"
```

**Wait for both**: (a) CI green on the PR, (b) Codex's post-PR review. CI green alone is not sufficient — the 1.1.3 picocolors bug was caught by Codex's PR review, not CI. Then **squash-merge** (repo settings enforce squash-only; the short-lived branch is deleted on merge). A release commit is operator-authored, so `gh pr merge --squash --delete-branch` is fine here.

**Auto-release fires** on the push to `main`: it tags + publishes `vX.Y.Z` from the version-bump commit. No manual `git tag` / `gh release create`, and no "reset" step — the short-lived branch is gone and the next release branches fresh from `main`.

## Auto-release workflow

Implemented in `.github/workflows/auto-release.yml`. Triggered on push to `main`. The workflow:

1. Reads `package.json` `version`.
2. Asserts `.canon/version` matches — fails the workflow if they diverge.
3. Verifies lockfile integrity (regenerates `package-lock.json` via `npm install --package-lock-only` and diffs against the checked-in file). Catches stale lockfiles + the 1.1.3 picocolors-style transitive corruption.
4. Identifies the version-bump commit by blaming `package.json`'s `version` line. This SHA — not the SHA of whatever push triggered the run — is what gets tagged. A self-heal retry on a later push still tags the correct commit.
5. Checks whether the GitHub release for `v<version>` already exists — exits silently if so. Gating on the release object (not the tag) lets a prior run that created the tag but failed before publishing the release self-heal on the next push. This idempotency is also what makes accumulating further task commits on `main` after a bump safe: subsequent pushes don't re-release an already-published version.
6. Extracts the `## [<version>] — <date>` CHANGELOG block **from the bump SHA's tree** (not the workflow's checkout) — when scope lands after the bump commit, the workflow's HEAD describes a different tree than the SHA being tagged, and reading from HEAD produces release notes that advertise fixes not in the tagged code (the 1.3.0 mismatch). Fails if the block is missing or still has the `unreleased` placeholder.
7. Creates the tag + GitHub release with the extracted body, targeting the version-bump commit.
8. **Post-publish verification**: re-extracts the CHANGELOG block from the published tag and diffs it byte-for-byte against the uploaded release notes. Fails if they disagree (regression guard for the 1.3.0 tag/notes mismatch).
9. **Publishes to npm** (`npm publish --access public`, authenticated by npm Trusted Publishing over OIDC — no token) from the release-cutting push, after the release is verified. Does not run at all unless the repository variable `NPM_TRUSTED_PUBLISHING` is `true`; skips silently when `canon-ai@<version>` is already on the registry. Refuses (fails the step) if the GitHub release is a draft or its tag does not resolve to the bump commit. Skips with a warning if the triggering commit is not the bump commit, because npm's provenance attestation records the triggering commit and must not describe a different tree; that case, and any failed publish, is recovered manually (below), not by re-running. No build or install happens here: `dist/` is committed and CI-verified, and `package.json` has no prepack scripts.

The workflow uses `GITHUB_TOKEN` and runs only on direct push-to-`main` events — pull-request events are ignored so PR previews don't accidentally trigger releases.

**npm publishing setup (one-time, per repository)**: publishing uses npm **Trusted Publishing** (OIDC), not a token. npm announced (July 2026) that granular tokens with 2FA bypass lose direct publishing in January 2027 and become staging-only, so a token-based Actions publish would stop being unattended; trusted publishing is npm's designated replacement. There is nothing to put in an env file or a secret. Setup, in this order: (1) make the GitHub repository public — provenance is generated only from a public repository, and the trusted-publisher record names the repository; (2) on npmjs.com, open the `canon-ai` package → Settings → Trusted Publisher → GitHub Actions, and enter organization or user `tstraub89`, repository `canon-ai`, workflow filename `auto-release.yml` (filename only, not the path), no environment, allowed action "npm publish" (the package must already exist on the registry to configure this; the `0.0.1` placeholder satisfies that); (3) set the repository **Actions variable** `NPM_TRUSTED_PUBLISHING` to `true` (Settings → Secrets and variables → Actions → Variables, or `gh variable set NPM_TRUSTED_PUBLISHING --body true`) — this is the arming switch, and until it is set the publish step does not run; (4) merge the version-bump PR. Requirements the workflow already meets: `id-token: write` on the job, npm ≥ 11.5.1 (checked in the step), and `package.json` `repository` matching the public repo URL. Each package can have one trusted publisher, and only GitHub-hosted runners are supported. **Sequencing matters**: the publish step runs only on the push that creates a GitHub release, and a version whose release already exists is never retried, so steps (1)–(3) must be complete *before* the release-cutting push; a version released before that reaches npm only via the manual fallback below.

## Manual fallback

**npm publish failed or was skipped** (trusted publishing not yet configured or not armed at release time, trigger commit was not the bump commit, transient registry error): publish from the tag by hand, from a machine logged in with `npm login` under an account that owns `canon-ai` (interactive 2FA is fine here):

```bash
git fetch --tags origin
git worktree add --detach /tmp/canon-publish vX.Y.Z
(cd /tmp/canon-publish && npm publish --access public)   # no provenance outside Actions
git worktree remove /tmp/canon-publish
```

The workflow will not retry a version on a later push, by design; check `npm view canon-ai@X.Y.Z version` before assuming it landed.

**GitHub release failed**: If the auto-release workflow fails (workflow disabled, missing CHANGELOG block, etc.), fall back to manual. **Always tag the version-bump commit explicitly** — `main` may have advanced past the release commit by the time you're running the fallback:

```bash
git checkout main && git pull

# Same blame trick the workflow uses.
LINE=$(grep -n '"version"' package.json | head -1 | cut -d: -f1)
BUMP_SHA=$(git blame -L "$LINE,$LINE" --porcelain -- package.json | awk 'NR==1 { print $1 }')

git tag v<new-version> "$BUMP_SHA"
git push origin v<new-version>
gh release create v<new-version> --target "$BUMP_SHA" \
  --notes "$(git show "$BUMP_SHA":CHANGELOG.md | awk '/^## \['"<new-version>"'\]/,/^## \[/' | sed '$d')"
```

## Related references

- [`decisions.md`](decisions.md) §"Versioning and release policy" — what counts as patch / minor / major, who authorizes, changelog scope.
- [`decisions.md`](decisions.md) §"Canon prescribes no release model to adopters" — why this doc is canon-ai-specific and not shipped to adopters.
- [`../CHANGELOG.md`](../CHANGELOG.md) — historical release incidents (1.1.2 lockfile sync, 1.1.3 picocolors lockfile, 1.3.0/1.3.1 tag/notes mismatch recovery, 1.3.2 cleanup).
