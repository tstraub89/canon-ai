# Release Process — canon-ai

This document covers the **mechanics** of cutting a canon-ai release. For the **policy** (what counts as patch / minor / major, who authorizes bumps, changelog scope), see [`decisions.md`](decisions.md) §"Versioning and release policy".

## Branch model

canon-ai uses a two-tier branch model:

- **Task worktree branches** → PR to `dev`. Per-task review happens there.
- **`dev`** is staging. It accumulates one or more shipped tasks.
- **`dev` → `main` PR** is the release boundary. The version bump and CHANGELOG date land in this PR.
- **`main`** is the published state. Tags and GitHub releases live on `main`.

There is no direct-to-`main` path. Hotfixes follow the same flow as everything else — they just have a shorter cycle.

## Triggering a release

The product owner says something like "ship v1.1.4" or "let's do a patch." Claude resolves what that means in git:

1. On `dev`: list commits accumulated since the last tag.
2. Decide tier (patch / minor / major) per [`decisions.md`](decisions.md) §"Versioning and release policy".
3. Confirm with the product owner if the tier is anything but patch — minor/major bumps require human approval per the same decision.

## Bumping the version (on `dev`, before the release PR)

Run these from the `dev` branch checkout. **Do not use `sed` or any broad text replacement on `package.json` or `package-lock.json`** — the 1.1.3 release shipped a corrupted lockfile (picocolors version field rewritten) because of exactly that, and adopters dodged it only because the lockfile doesn't ship. Use the structured tools instead:

```bash
# 1. Bump package.json + lockfile root entry atomically.
npm version <new-version> --no-git-tag-version

# 2. Refresh the lockfile cleanly. This re-resolves dependencies without
#    touching any transitive entries that happen to share a version string.
npm install --package-lock-only

# 3. Update .canon/version to match.
echo "<new-version>" > .canon/version
```

Then:

4. Confirm the `CHANGELOG.md` block for the new version has a real date (e.g., `## [1.1.4] — 2026-05-17`), not `unreleased`. If the block doesn't exist yet, add it with the date and an empty body before agents file bullets.
5. Stage and commit: `git add package.json package-lock.json .canon/version CHANGELOG.md && git commit -m "release: <new-version> — <short theme>"`
6. Push: `git push origin dev`

Verify before opening the release PR: `git diff main..dev -- package-lock.json | grep '"version"' | head -20` — only the root `"version"` lines should change. Any transitive `node_modules/*` version line in the diff is the picocolors bug repeating.

## Shipping `dev` → `main`

1. Open the release PR:
   ```bash
   gh pr create --base main --head dev --title "Release v<new-version>: <short theme>"
   ```
2. Wait for both: (a) CI green on the PR, and (b) Codex's post-PR review (see [`docs/lessons-learned.md`](lessons-learned.md) — CI green alone is not sufficient; the 1.1.3 picocolors bug was caught by Codex's PR review, not CI).
3. Product owner merges the PR (squash or merge commit per the PR's settings).
4. **Auto-release fires.** A GitHub Action on push-to-`main` (`.github/workflows/auto-release.yml`) detects the version change in `package.json`, creates the `v<X.Y.Z>` tag, and publishes a GitHub release with the matching CHANGELOG block. Tagging is idempotent — re-runs on the same version exit silently.

If the auto-release workflow fails (workflow disabled, missing CHANGELOG block, etc.), fall back to manual. **Always tag the version-bump commit explicitly** — `main` may have advanced past the release commit by the time you're running the fallback, and `git tag <name>` with no explicit SHA tags whatever `HEAD` points at:

```bash
git checkout main && git pull

# Find the commit that set the current package.json version — same blame
# trick the workflow uses, reproduced here so the manual fallback doesn't
# tag a later, unrelated commit on main.
LINE=$(grep -n '"version"' package.json | head -1 | cut -d: -f1)
BUMP_SHA=$(git blame -L "$LINE,$LINE" --porcelain -- package.json | awk 'NR==1 { print $1 }')

git tag v<new-version> "$BUMP_SHA"
git push origin v<new-version>
gh release create v<new-version> --target "$BUMP_SHA" \
  --notes "$(awk '/^## \['"<new-version>"'\]/,/^## \[/' CHANGELOG.md | sed '$d')"
```

## Hotfixes

Same flow, shorter cycle. The hotfix lands on a task branch, PRs into `dev`, then a release PR cuts `dev` → `main` with a patch version bump. No direct-to-`main`. No bypassing the version bump (a hotfix that ships without a version bump means adopters who install today and tomorrow get *different* code for the same `.canon/version` value).

If the hotfix is urgent enough that batching with other in-flight `dev` work is unsafe, branch a clean release line: `git checkout main && git checkout -b hotfix/<short>`, land the fix, PR `hotfix/<short>` → `main`. Then merge `main` back into `dev` to sync. This path is the exception, not the default.

## Auto-release workflow

Implemented in `.github/workflows/auto-release.yml`. Triggered on push to `main`. The workflow:

1. Reads `package.json` `version`.
2. Checks `.canon/version` for a match — fails the workflow if they diverge (catches a class of release-bump mistakes).
3. Verifies lockfile integrity (regenerates `package-lock.json` via `npm install --package-lock-only` and diffs against the checked-in file). Fails if any byte changes — catches stale lockfiles and the 1.1.3 picocolors-style transitive corruption.
4. Identifies the version-bump commit by blaming `package.json`'s `version` line. This SHA — not the SHA of whatever push triggered the run — is what gets tagged. Ensures a self-heal retry on a later push still points the tag at the actual release commit.
5. Checks whether a **GitHub release** for `v<version>` already exists — exits silently if so. Gating on the release object (not just the tag) means a prior run that created the tag but failed before publishing the release can self-heal on the next push.
6. Extracts the matching `## [<version>] — <date>` block from `CHANGELOG.md` — fails if the block is missing or has only the `unreleased` placeholder.
7. Creates the tag and a GitHub release with the extracted CHANGELOG body, targeting the version-bump commit from step 4.

The workflow uses `GITHUB_TOKEN` (no manual PAT needed) and runs only on direct push-to-`main` events — pull-request events are ignored so PR previews don't accidentally trigger releases.

## Related references

- [`decisions.md`](decisions.md) §"Versioning and release policy" — what counts as patch / minor / major, who authorizes, changelog scope.
- [`pipeline-orchestrator.md`](pipeline-orchestrator.md) §"Task management (canon task)" — `canon task release-init` helper. *This is for adopter projects that use the canon pipeline to ship releases (e.g., release-branch flows like GP's). canon-ai itself does not currently use `release-init`; bumps happen directly on `dev` per the steps above.*
- [`lessons-learned.md`](lessons-learned.md) — historical release incidents (1.1.2 lockfile, 1.1.3 picocolors).
