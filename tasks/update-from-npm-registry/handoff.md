# Implementation Handoff: update-from-npm-registry

> Author: Codex | Spec: `tasks/update-from-npm-registry/spec.md` | Plan: `tasks/update-from-npm-registry/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/cli/commands/update.ts` | Stable canonical updates verify npm availability, use global/local npm configuration scopes correctly, install local releases with `--save-exact`, preserve git paths for development/ref/fork updates, and report registry semver pins. |
| `tests/cli.test.ts` | Covers registry/local/global argv, registry refusal, cwd/config scope, exact manifest pinning, exact-pin announcements, git-path preservation, and npx wording. |
| `package.json` | Removed npm lifecycle hook and hook file from published files; added contributor-only `hooks` script. |
| `package-lock.json` | Removed stale root `hasInstallScript` metadata; dependency metadata is otherwise unchanged. |
| `scripts/install-git-hooks.mjs` | Reworded the header for explicit contributor invocation. |
| `CONTRIBUTING.md` | Documents one-time `npm run hooks` setup and the CI guardrail. |
| `README.md` | Documents registry-first updates and exact local version pinning. |
| `src/cli/commands/init.ts` | Rewrote stale registry-status commentary. |
| `CHANGELOG.md` | Added Unreleased Changed and Removed entries. |
| `docs/codebase-map.md` | Updated update-command and contributor-hook descriptions. |
| `dist/cli/index.js` | Rebuilt committed CLI bundle. |

## Intent & Rationale

Stable canonical releases are resolved from GitHub for their immutable tag SHA, verified on npm, and installed from the registry. Local installs use `--save-exact` so the adopter manifest preserves the exact release selected by canon; global installs use global npm configuration and write no manifest. Development channels, refs, and fork overrides remain GitHub installs. The contributor hook is explicit rather than an adopter-facing npm lifecycle script.

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: Stable canonical installs come from the registry | Met | Local three-save-flag argv includes `--save-exact`; global argv is `install -g canon-ai@8.2.0` without it. |
| AC-2: Registry existence is verified first and refusal is loud | Met | E404 and network/error tests assert required refusal text, exit 1, and no install spawn. |
| AC-3: Non-registry builds keep the git path | Met | Main, named ref, SHA ref, and fork tests retain the original git argv and bypass npm verification. |
| AC-4: Provenance pairs registry version with tag SHA | Met | Registry source is `canon-ai@X.Y.Z`; version and resolved tag SHA remain recorded; exact and ranged manifest pins are displayed. |
| AC-5: npx message names the package, not the repo | Met | Asserts `npx canon-ai@latest upgrade`; obsolete GitHub npx constant is gone. |
| AC-6: Package runs no install scripts | Met | No lifecycle install script remains; `hooks` is explicit and the packed tarball excludes the hook script. |
| AC-7: Contributors are told how to get the hook | Met | Setup runs `npm run hooks` and explains the CI sync guardrail. |
| AC-8: Detection and gates are untouched | Met | Existing detection, gate, and resolver tests pass; those function bodies/signatures were not changed. |
| AC-9: Adopter docs say registry first | Met | README and init/codebase documentation describe registry releases and GitHub development paths; README documents exact local pinning. |
| AC-10: Changelog | Met | Unreleased Changed and Removed entries added. |
| AC-11: Manifest pin is exact after a local registry update | Met | Red-first integration fixture simulates npm manifest writes and asserts `devDependencies['canon-ai'] === '8.2.0'`. |

## Edge Cases Considered

- A canonical-looking `CANON_UPSTREAM_REPO` override still forces the git path because override presence is independent of slug value.
- Local registry checks use the realpath-canonicalized install root; global checks add `--global` so project-local `.npmrc` settings cannot diverge from `npm install -g`.
- npm’s absent-version response is a non-zero exit with an E404 JSON object on stdout; other malformed/network results fail closed and include stderr.
- Existing manifests containing `^X.Y.Z`, `~X.Y.Z`, or exact `X.Y.Z` are rendered as the current version in announcements.

## Deviations and Validation Notes

- The implementation uses npm’s `--global` flag on the registry probe to match global install configuration semantics; matching cwd alone was insufficient because global npm ignores project-local configuration.
- The required red-first AC-11 run was performed before the production fix. It failed with `^8.2.0 !== 8.2.0`, confirming the missing exact-pin behavior.
- `npm install --package-lock-only` encountered a sandbox permission error unlinking the pre-existing `node_modules/.package-lock.json`, but it updated the root lockfile metadata. The resulting `package-lock.json` diff contains only removal of the root `hasInstallScript` field; no dependency churn.
- The default npm cache is root-owned in this sandbox, so package dry-run validation used `/private/tmp/canon-update-npm-cache`.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint clean. |
| `npm run type-check` | Pass | TypeScript check clean. |
| `npm test` | Pass | 1,204 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js`; orchestrator bundle unchanged. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm pack --dry-run` | Pass | Temporary npm cache used; packed contents exclude `scripts/install-git-hooks.mjs`. |
| E2E | deferred_by_spec | Spec: Validation Required — N/A, no UI surface. |

## Ready for Review

- [x] All spec ACs met, including Amendment AC-11
- [x] All applicable validation checks pass
- [x] Red-first checkpoint recorded

## Iteration 2 — addressing review round 1

### Findings addressed

- Added exact `provenance.json` content assertions to the stable registry-path tests for all supported local dependency blocks and for global installs. The assertions pin `source`, `channel`, `version`, `resolved_sha`, and `updated_at`, closing the AC-4 verification gap identified in Round 1.

### AC delta

- AC-4: Registry-path provenance content is now directly verified for both local and global install types; no production behavior changed.

### Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `node --import tsx --test tests/cli.test.ts` | Pass | 200 passed, 0 failed. |
| `npm run lint` | Pass | ESLint clean. |
| `npm run type-check` | Pass | TypeScript check clean. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
