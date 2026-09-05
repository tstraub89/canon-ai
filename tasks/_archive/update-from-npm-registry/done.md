# Done: update-from-npm-registry

## Summary

`canon update` now installs stable releases of canon-ai from the npm registry instead of from GitHub. Since canon-ai publishes to npm, an adopter who installed with `npm install -g canon-ai` used to have their first `canon update` silently convert that into a GitHub-sourced install — losing npm's provenance attestation and pulling the whole repository instead of the small published package. Now `canon update` resolves the latest release tag as before, confirms that exact version is published to npm, and installs `canon-ai@X.Y.Z` from the registry. A project-local update pins the exact version (`--save-exact`) so a plain `npm install` later can't silently float canon-ai to a newer version; a global update is unaffected since it writes no manifest. If a release is tagged on GitHub but hasn't reached npm yet (a normal few-minute window right after a release), `canon update` refuses with a clear message naming the version and pointing at the GitHub fallback (`--ref vX.Y.Z`), instead of quietly falling back to a git install. `--channel main`, `--ref`, and fork overrides are untouched — they still install from GitHub.

Separately, the published npm package no longer runs any install-time script. It used to ship a `postinstall` hook whose only real job is installing canon-ai's own contributor pre-commit hook — something that can never do anything in an adopter's repo, but which triggered npm's install-scripts warning on every adopter install. Contributors now run `npm run hooks` once after cloning instead.

## Files Changed

- `src/cli/commands/update.ts` — registry-existence check (via an injected npm runner) before a stable-channel install; installs `canon-ai@X.Y.Z` from the registry (`--save-exact` for local installs); refusal message when the version isn't yet published or the check fails; npx message now says `npx canon-ai@latest upgrade`; provenance `source` records the registry spec for registry installs. Git-path (`--channel main`, `--ref`, fork override) behavior is unchanged.
- `tests/cli.test.ts` — argv assertions for the registry path (local x3 save-flag variants, global), registry-absent and check-failed refusal tests, provenance content assertions for both paths, exact-manifest-pin fixture, npx wording test, and confirmation that git-path installs never invoke the registry check.
- `package.json` — removed the `postinstall` lifecycle script and `scripts/install-git-hooks.mjs` from the published `files`; added a dev-only `hooks` script.
- `package-lock.json` — regenerated so the root entry no longer claims `hasInstallScript: true`; no dependency changes.
- `scripts/install-git-hooks.mjs` — header reworded to describe explicit contributor invocation instead of a postinstall wrapper.
- `CONTRIBUTING.md` — documents the one-time `npm run hooks` step and the CI template-sync guardrail for a contributor who skips it.
- `README.md` — "Updating" paragraph now says releases install from the registry and describes exact local version pinning; `--channel main`/`--ref` still install from GitHub.
- `src/cli/commands/init.ts` — stale "isn't on the npm registry" comment rewritten.
- `docs/codebase-map.md` — `canon update` row and the contributor git-hooks row updated to match the new behavior.
- `CHANGELOG.md` — `[Unreleased]` gained a `### Changed` and a `### Removed` bullet (see Proposed Changelog below).
- `dist/cli/index.js` — rebuilt.

## How to Test

1. On a machine where canon was installed via `npm install -g canon-ai`, run the updater. It should report the latest release, install it, and afterward the package manager should show the tool as coming from the npm registry, not a GitHub address.
2. Run the updater asking for the development channel (`--channel main`). It should install from GitHub exactly as before and say so.
3. Install a packed build of this change globally and confirm no install-scripts warning appears; installing the current released version the same way still shows one.
4. Try updating in the brief window right after a release is tagged but before it reaches npm (or simulate it). The updater should stop without installing, name the version, say it hasn't reached the registry yet, and show the GitHub fallback command for that exact release.
5. Clone the repo fresh, follow the contributing setup instructions, and make a commit touching a canon-managed file. The setup should include a one-time hook-install command, and after running it the commit should auto-sync the template mirror.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint clean. |
| `npm run type-check` | Pass | TypeScript check clean. |
| `npm test` | Pass | 1,204 passed, 1 skipped, 0 failed (plus a 200/200 pass on the targeted `tests/cli.test.ts` re-run after iteration 2). |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js`; orchestrator bundle unchanged. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm pack --dry-run` | Pass | Packed contents exclude `scripts/install-git-hooks.mjs`. |
| E2E | deferred_by_spec | Spec's Validation Required marks E2E N/A — no UI surface. |

## Human Verification Required

None. The latest handoff `## Validation Outcomes` table (iteration 2) has no `human_pending` rows; every check is a direct `Pass` or the spec-declared `deferred_by_spec` E2E row.

**Handoff pre-merge checklist:**
- [x] Version correct — spec's Non-Goals explicitly defers the version bump to the next release cut (3.1.0 per `docs/decisions.md` §"Versioning and release policy"); no bump expected in this task.
- [x] Changelog updated — `[Unreleased]` already carries the `### Changed`/`### Removed` bullets (AC-10).
- [x] PR body current — see `tasks/update-from-npm-registry/pr-body.md`.
- [ ] Final CI/CD checks green — confirm on the PR before merge.
- [x] Final diff matches spec intent — code review round 2 verdict is **Approved**; all 11 ACs (including the amendment's AC-11) verified Met.

## Decisions Made During Implementation

- **Registry probe uses `--global` for global installs**, not just a matching cwd, because npm's global command ignores project-local `.npmrc` settings; the local vs. global probe needed to mirror the install's own configuration scope to avoid a false pass/fail.
- **Local registry installs pin with `--save-exact`** (spec amendment, round 1 of the pre-reroute review): the original AC-1 argv (`npm install <save flag> canon-ai@X.Y.Z`) would have written a floating `^X.Y.Z` range into the adopter's manifest under npm's default `save-prefix`, silently weakening the "no fallback to an unpinned source" guarantee the git path it replaces had for free. This was caught as a spec-gap that persisted across three review rounds before the spec was amended (AC-1 amended, AC-11 added) and the task rerouted.
- **`CANONICAL_NPX_SOURCE` was deleted** rather than left dead, since the npx message no longer needs a GitHub-shaped string.
- **`package-lock.json` regenerated in a temp npm cache** (`/private/tmp/canon-update-npm-cache`) because the sandbox's default npm cache contains root-owned files; the resulting diff is metadata-only (root `hasInstallScript` flag removed).

## Open Questions

None outstanding. The one substantive judgment call (whether local registry installs should float or pin exactly) was resolved by the spec amendment before implementation proceeded past reroute; code review round 2 found no remaining code-bugs or spec-gaps.

## Proposed Changelog

> Entry text only — version number and bump tier are decided at the release step, not here. The entries below already reflect what's live in `CHANGELOG.md`'s `[Unreleased]` section; QA reviewed them for scope and voice and found no changes needed.

### Changed

- `canon update` installs stable releases from the npm registry after verifying the tagged version; `--channel main`, `--ref`, and fork overrides continue to use GitHub, and tagged releases not yet published refuse with a retry message and GitHub fallback.

### Removed

- The package no longer runs the contributor hook as an npm postinstall script; contributors can run `npm run hooks` once.

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 1
- Validation gaps: 0
- Notes: Spec-gap (missing `--save-exact`) survived 3 spec-blind review rounds pre-reroute and was fixed by amendment; post-reroute round 1 found an AC-4 test-coverage gap (registry-path provenance content unasserted), closed in round 2 with an Approved verdict.
