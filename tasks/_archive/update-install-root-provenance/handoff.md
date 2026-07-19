# Implementation Handoff: update-install-root-provenance

> Author: Codex | Spec: `tasks/update-install-root-provenance/spec.md` | Plan: `tasks/update-install-root-provenance/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/cli/commands/update.ts` | Resolves the real install root, applies ordered layout/dependency gates, parses strict update flags, resolves immutable stable/main/ref targets, writes provenance after npm succeeds, and now retries remote resolution from HTTPS to SSH with non-interactive Git settings. |
| `src/cli/index.ts` | Documents update pinning, development-channel flags, SHA refs, and provenance behavior in CLI help. |
| `tests/cli.test.ts` | Covers install-root/gate behavior, immutable resolution, provenance, failure paths, and the amendment's HTTPS-success, HTTPS→SSH fallback, dual-failure, argument-equivalence, environment, and red-first cases for stable and named-ref resolution. |
| `README.md` | Documents install-root targeting, release pinning, development flags, and the write-only provenance record. |
| `docs/codebase-map.md` | Updates the `canon update` entry for root detection, gates, immutable resolution, and provenance. |
| `dist/cli/index.js` | Rebuilt generated CLI output from the current source. |

## Intent & Rationale

The updater targets the package's own real install root, refuses unsafe local layouts before any mutation, resolves an immutable commit from the effective upstream slug, and records provenance only after npm succeeds. Remote resolution now mirrors npm's private-GitHub transport behavior: it tries HTTPS first and, on any failure, retries the identical logical query using `git@github.com:<slug>.git`. The Git runner forces `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND=ssh -oBatchMode=yes` on every attempt, so authentication failures are surfaced instead of hanging.

## Red-First Evidence

The amendment's stable-path regression was run against a fresh build before the fallback helper was added. The forced-HTTPS-failure fixture exited non-zero with the pre-amendment refusal and reported `npmLogExists=false`, proving npm was not reached. After the fallback implementation and rebuild, the same red-first subprocess passes, records two `ls-remote` calls in HTTPS-then-SSH order, and installs the same peeled stable SHA.

The original install-root/immutable-target red-first fixture remains in place: it invokes the committed CLI by absolute path from an unrelated adopter directory and verifies the npm cwd, exact pinned target, and byte-identical adopter manifest/lockfile.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Exported `layoutGate()` for direct missing-manifest coverage. | The established detector classifies a `node_modules` path without an owning manifest as global; exporting the pure gate keeps the ordered local refusal directly testable without changing that detection contract. | AC-4 |
| Stable matching rejects leading-zero numeric components as well as prerelease/suffixed names. | This is the strict `vX.Y.Z` interpretation and avoids treating non-SemVer tag names as releases. | AC-6, AC-7 |
| Exported `defaultGitRunner()` for direct environment coverage. | AC-12(d) needs to observe the real subprocess environment rather than an injected fake runner; the export is test-only plumbing and does not change the CLI surface. | AC-12(d) |
| Normalized runtime provenance references in pipeline-generated completion artifacts to prose. | The required docs-reference check treats backtick paths as repository files, while the provenance file is created only in adopter install roots. | Validation only; no product behavior |

## AC Coverage

| AC | Status | Evidence |
|---|---|---|
| AC-1 | Met | `detectInstallType()` returns `{ type, installRoot }`, canonicalizes symlinked roots, and has updated shape tests. |
| AC-2 | Met | Absolute-entrypoint red-first subprocess test records npm cwd at the real install root and compares adopter package/lockfile contents byte-for-byte. |
| AC-3 | Met | Malformed/unrelated manifests refuse before resolver/npm; all three supported dependency blocks select the matching npm save flag. |
| AC-4 | Met | Layout gate owns missing-manifest refusal and nested local-shaped/pnpm-path coverage reaches it before dependency parsing. |
| AC-5 | Met | Announcement tests cover install location, current pin/unknown, stable bare version, development unknown version, and no provenance read. |
| AC-6 | Met | Stable resolution filters strict final tags, prefers peeled annotated-tag commits, excludes newer prereleases, and shares the effective fork slug across resolver, npm target, and provenance. |
| AC-7 | Met | Git failures, empty tags, prerelease-only tags, zero refs, and ambiguous refs fail closed without an unpinned fallback. |
| AC-8 | Met | Main and named refs resolve immutable commits; full SHA refs skip resolution; flag validation and ref ambiguity are covered. |
| AC-9 | Met | Stable/main/ref and global provenance cases verify exact pinned source, SHA, timestamp, bare stable version, post-success writes, and failed-install no-write behavior. |
| AC-10 | Met | Help, README, and codebase map describe pinning/flags/write-only provenance; docs references pass and the doctor row is unchanged. |
| AC-11 | Met | Fresh build completed and generated `dist/cli/index.js` is included. |
| AC-12 | Met | Stable and named-ref tests separately cover one-call HTTPS success, two-call HTTPS→SSH success with URL-only argument differences, dual failure with both transport names, and non-interactive environment; the stable fallback is also exercised through the real dist red-first fixture. |

## Edge Cases Considered

- HTTPS and SSH attempts use the same `ls-remote` query shape and differ only in remote URL.
- Both transports are attempted at most once each; the existing 30-second timeout applies per Git invocation.
- Empty stderr is rendered as `no output`, while both transport names remain in the refusal.
- Full 40-hex SHA refs retain their zero-resolution-call short circuit.
- Symlinked roots, nested local-shaped layouts, annotated tags, prerelease-only tag universes, fork overrides, global installs, and post-npm provenance failures remain covered by the prior implementation.

## Blockers

None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed cleanly after the amendment. |
| `npm run type-check` | Pass | TypeScript completed cleanly. |
| `npm test` | Pass | Full suite passed, including the new transport fallback and refusal tests. |
| `npm run build` | Pass | Fresh tsup build and dist normalization completed. |
| `npm run docs-refs-check` | Pass | All repository references resolved after runtime-only provenance references were normalized in generated completion artifacts. |
| E2E — N/A (no end-to-end runtime surface) | deferred_by_spec | Spec: §Validation Required explicitly marks E2E N/A. |

## Ready for Review

- [x] All original and amended ACs are met.
- [x] Required validation checks pass or are explicitly deferred by the spec.
- [x] Red-first evidence and implementation deviations are recorded.

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/cli/commands/update.ts` | Preserves a caller-provided `GIT_SSH_COMMAND` while adding or normalizing `BatchMode=yes`; the default remains `ssh -oBatchMode=yes` when no custom command is configured. |
| `tests/cli.test.ts` | The direct Git-runner environment test now supplies a custom SSH command and asserts that its identity configuration is preserved alongside batch mode. |
| `dist/cli/index.js` | Rebuilt generated CLI bundle with the SSH-command composition fix. |

### Findings addressed

- _correctness bug:_ `defaultGitRunner` overwrote a user's custom `GIT_SSH_COMMAND`, breaking configured identities/proxy hosts on the SSH fallback leg → `nonInteractiveSshCommand()` composes with custom commands and replaces common explicit BatchMode settings with `yes` rather than discarding the command.

### AC deltas

- AC-12(d): remains Met, now without clobbering caller SSH configuration; every resolver invocation still receives terminal-prompt suppression and SSH batch mode.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed cleanly. |
| `npm run type-check` | Pass | TypeScript completed cleanly. |
| `npm run build` | Pass | Fresh generated CLI includes the composed SSH command behavior. |
| Focused CLI suite | Pass | `tests/cli.test.ts`: 190 passed, 0 failed; includes the custom `GIT_SSH_COMMAND` regression. |
