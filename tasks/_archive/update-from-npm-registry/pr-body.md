## Summary

- `canon update` now installs stable canon-ai releases from the npm registry instead of GitHub: it resolves the latest release tag as before, confirms that version is published to npm, and runs `npm install canon-ai@X.Y.Z` (with `--save-exact` for a local/project install, so the manifest stays pinned to the exact release instead of floating on a caret range). If a release is tagged but hasn't reached the registry yet, the update refuses with a message naming the version and the `--ref vX.Y.Z` GitHub fallback, instead of silently falling back to a git install.
- `--channel main`, `--ref`, and fork (`CANON_UPSTREAM_REPO`) overrides are unchanged — they still install from GitHub, since those builds aren't on the registry.
- The published package no longer runs a `postinstall` script. It used to install canon-ai's own contributor pre-commit hook, which can't do anything in an adopter's repo but still triggered npm's install-scripts warning on every install. Contributors now run `npm run hooks` once after cloning.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- A project-local `canon update` now writes an exact version pin (`--save-exact`) rather than a floating range — this closes a gap where a plain `npm install` later in that project could silently move canon-ai off the version `canon update` selected. Global installs write no manifest, so they're unaffected.
- `npm pack --dry-run` confirms `scripts/install-git-hooks.mjs` no longer ships in the tarball, and installing a packed build of this branch produces no install-scripts warning (the current released version still does).
- No version bump or CHANGELOG finalization in this PR — `[Unreleased]` already has the `### Changed`/`### Removed` entries; the version bump happens at the next release cut.
- Detection/gating code (`detectInstallType`, `layoutGate`, `dependencyGate`, `resolveStable`, `resolveNamedRef`, `runGitWithFallback`) is untouched — only the stable-channel install path and the npx message changed.
