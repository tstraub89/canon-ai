# Release Process — canon-ai

This document covers the **mechanics** of cutting a canon-ai release. For the **policy** (what counts as patch / minor / major, who authorizes bumps, changelog scope), see [`decisions.md`](decisions.md) §"Versioning and release policy".

## Branch model

canon-ai uses **release-branch-per-version**:

- **Task branches** → PR to the active `release/vMAJ.MIN` branch.
- **`release/vMAJ.MIN`** is temporary. One per minor or major version (`release/v1.3`, `release/v1.4`, `release/v2.0`). Patch releases reuse the same minor branch (1.4.0, 1.4.1, 1.4.2 all on `release/v1.4`). Major bumps get a new branch.
- **`release/vMAJ.MIN` → `main` PR** is the release boundary. The version bump and CHANGELOG date land in this PR. The squash-merge to `main` triggers auto-release.
- **`main`** is the published state. Tags and GitHub releases live on `main`.
- **Release branches are deleted on merge** (the repo's PR settings + canon's `--ship` flow handle this automatically). No persistent integration branch to keep in sync.

There is no direct-to-`main` path. Hotfixes follow the same flow — branch off `main`, accumulate the patch, PR back.

> **History**: Through 1.3.x, canon-ai used a persistent `dev` integration branch. That model required an extra "reset `dev` to `origin/main` after each squash-merge" operator step (the squash collapsed `dev`'s history into one new commit on `main`, leaving `dev`'s old history redundant and producing `CONFLICTING` next PRs). 1.4.0 switched to release-branch-per-version — the same flow `canon task release-init` was already built for and the flow canon-ai recommends to adopters.

## Triggering a release

The product owner says something like "ship v1.4.0" or "let's do a patch":

1. **Decide tier** (patch / minor / major) per [`decisions.md`](decisions.md) §"Versioning and release policy". Confirm with the product owner if it's anything but patch.
2. **Identify or create the release branch** (next section).
3. **Accumulate task work** on the release branch until the scope is complete.
4. **Ship** by opening `release/vMAJ.MIN` → `main` PR and squash-merging.

## Creating a new release branch (minor or major bump)

When starting work on a new minor or major version:

```bash
# Make sure local main matches origin.
git checkout main && git pull origin main && git status --porcelain

# Create the release branch off main.
git checkout -b release/v1.4 main

# Bump versions atomically. Use npm version + the lockfile refresh, never sed
# (the 1.1.3 picocolors bug shipped from a too-broad sed substitution).
npm version 1.4.0 --no-git-tag-version
npm install --package-lock-only

# Sync .canon/version. The auto-release workflow asserts package.json's
# version equals .canon/version and dies if they diverge.
echo "1.4.0" > .canon/version
```

Add the CHANGELOG block manually — the existing format is `## [<version>] — <date|unreleased>`:

```markdown
## [1.4.0] — unreleased

<!-- Bullets land here as tasks ship. Replace "unreleased" with the real date when opening the release PR. -->
```

Commit and push:

```bash
git add package.json package-lock.json .canon/version CHANGELOG.md
git commit -m "chore: initialize release/v1.4 (version 1.4.0)"
git push -u origin release/v1.4
```

> **Note**: `canon task release-init <version>` is a helper that scaffolds this for adopters, but as of 1.4.0 it has two known bugs against canon-ai's release format: it doesn't update `.canon/version`, and the CHANGELOG block it inserts (`## v1.4 - unreleased`) doesn't match the bracketed format the auto-release workflow extracts (`## [1.4.0] — <date>`). Tracked in BACKLOG. Until those are fixed, do the initialization manually as shown above.

## Patch release on an existing minor

For a patch release on a minor that already shipped (e.g., 1.4.1 after 1.4.0 has been published and `release/v1.4` was deleted on merge):

```bash
# Start fresh off the current main (which has the 1.4.0 squash).
git checkout main && git pull origin main
git checkout -b release/v1.4 main
```

Bump to the patch version (`1.4.1`), add a new `## [1.4.1] — unreleased` block at the top of CHANGELOG, commit, push, accumulate fixes.

## Accumulating task work on the release branch

Tasks branch off the active `release/vMAJ.MIN` and PR back to it. Use `canon run` for the full pipeline; the orchestrator picks up `base_branch` from `status.json` (`canon task new` auto-detects this from the current checkout, so being on the release branch when creating tasks is enough).

As each task ships, append a bullet to the active `## [<version>] — unreleased` block in `CHANGELOG.md`.

## Shipping `release/vMAJ.MIN` → `main`

When the release scope is complete:

1. **Replace `unreleased` with the date.** Edit the active CHANGELOG block's header to read `## [1.4.0] — 2026-MM-DD`. Commit and push.
2. **Verify the lockfile.** `git diff main..release/v1.4 -- package-lock.json | grep '"version"'` should show only the two root `"version"` lines changing. Any transitive `node_modules/*` version line is the picocolors-style corruption repeating.
3. **Open the release PR:**
   ```bash
   gh pr create --base main --head release/v1.4 --title "Release v1.4.0: <short theme>"
   ```
4. **Wait for both**: (a) CI green on the PR, (b) Codex's post-PR review. CI green alone is not sufficient — the 1.1.3 picocolors bug was caught by Codex's PR review, not CI.
5. **Squash-merge the PR.** The repo's PR settings enforce squash-only with PR title → squash commit subject and PR body → message. The release branch is deleted as part of the merge.
6. **Auto-release fires.** The workflow tags + publishes `v1.4.0`.

No "reset" step. The release branch is gone; the next release branches fresh from main.

## Hotfixes

Same flow as the patch-release section above: branch off `main`, bump the patch version, accumulate the fix(es), PR back, squash-merge. No exceptions — release-branch-per-version is what makes hotfixes safe (each release has its own branch with its own version-bump commit; no shared integration state to corrupt).

## Auto-release workflow

Implemented in `.github/workflows/auto-release.yml`. Triggered on push to `main`. The workflow:

1. Reads `package.json` `version`.
2. Asserts `.canon/version` matches — fails the workflow if they diverge.
3. Verifies lockfile integrity (regenerates `package-lock.json` via `npm install --package-lock-only` and diffs against the checked-in file). Catches stale lockfiles + the 1.1.3 picocolors-style transitive corruption.
4. Identifies the version-bump commit by blaming `package.json`'s `version` line. This SHA — not the SHA of whatever push triggered the run — is what gets tagged. Self-heal retry on a later push still tags the correct commit.
5. Checks whether the GitHub release for `v<version>` already exists — exits silently if so. Gating on the release object (not the tag) lets a prior run that created the tag but failed before publishing the release self-heal on the next push.
6. Extracts the `## [<version>] — <date>` CHANGELOG block **from the bump SHA's tree** (not the workflow's checkout). Fails if the block is missing or still has the `unreleased` placeholder.
7. Creates the tag + GitHub release with the extracted body, targeting the version-bump commit.
8. **Post-publish verification**: re-extracts the CHANGELOG block from the published tag and diffs it byte-for-byte against the uploaded release notes. Fails if they disagree (regression guard for the 1.3.0 tag/notes mismatch).

The workflow uses `GITHUB_TOKEN` and runs only on direct push-to-`main` events — pull-request events are ignored so PR previews don't accidentally trigger releases.

## Manual fallback

If the auto-release workflow fails (workflow disabled, missing CHANGELOG block, etc.), fall back to manual. **Always tag the version-bump commit explicitly** — `main` may have advanced past the release commit by the time you're running the fallback:

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
- [`pipeline-orchestrator.md`](pipeline-orchestrator.md) §"Task management (canon task)" — `canon task release-init` helper (with known-bug notes; see BACKLOG).
- [`lessons-learned.md`](lessons-learned.md) — historical release incidents (1.1.2 lockfile sync, 1.1.3 picocolors lockfile, 1.3.0 tag/notes mismatch, 1.3.2 squash-merge cleanup).
