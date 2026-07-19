# Completion Summary: update-install-root-provenance — canon update targets its own install root, pinned to an immutable release

> For the human. This is what you need to know.

## What Changed

`canon update` used to run `npm install` in whatever directory it was invoked from, and it pulled from the mutable `main` branch — so running one project's `canon update` from inside a different, unrelated project could silently add `canon-ai` as a dependency there (issue #188), and even a same-repo update could quietly install unreleased code that reports the same version number as the last tagged release (issue #189). This task makes `canon update` figure out where it's actually installed (following symlinks to the real directory), refuse to touch anything unless that directory has a manifest that already lists `canon-ai` as a dependency, and — by default — install a specific, immutable release commit instead of a moving branch. It also adds labeled `--channel main` / `--ref <ref-or-sha>` development-install options, prints a clear before/after summary of what version and commit are being installed, and writes a provenance record under `.canon` of exactly what was installed (nothing reads this file yet — a follow-up task will teach `canon doctor` to check it). `canon doctor` itself is untouched in this task.

## Files Changed

- `src/cli/commands/update.ts` — install-root detection/gating, git-native immutable resolution (stable/main/ref/SHA), announcement, provenance write, flag parsing, injectable seams
- `src/cli/index.ts` — `printHelp()` text for the new `--channel`/`--ref` flags
- `tests/cli.test.ts` — red-first subprocess regression, detection/gate/resolver/announcement/channel/provenance test coverage
- `README.md` — `canon update` row + install section documenting pinning, flags, and the write-only provenance file
- `docs/codebase-map.md` — `canon update` row description updated to match the new behavior
- `dist/cli/index.js` — rebuilt generated CLI bundle

## How to Test

1. In a project where canon-ai is a local dev dependency, run `canon update` with no flags. Expected: it announces the install type, the resolved install directory, the current version/commit, and the target release version/commit, then completes and writes a provenance record. Run it again — the current commit now shows too (instead of "unknown").
2. From inside a completely unrelated throwaway project, invoke the *first* project's `canon update` (e.g. by path to its CLI). Expected: the unrelated project's `package.json` and lockfile are completely untouched — either the update correctly targets the first project's install, or it refuses with a clear explanation.
3. Run `canon update --channel main` (or `--ref <ref>` / `--ref <40-char-sha>`). Expected: the output clearly labels it as a development install and shows the exact commit installed.
4. Run `canon update` in a project whose manifest doesn't list `canon-ai` as a dependency at all. Expected: a clear refusal explaining what was checked, and nothing changes.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (1009 passed, 1 explicitly skipped — pre-existing, unrelated) |
| E2E tests | deferred_by_spec — Spec: §Validation Required, "N/A (no end-to-end runtime surface)" |
| Build | Pass (committed `dist/cli/index.js` re-verified byte-identical to a fresh build) |
| `npm run docs-refs-check` | Pass |

## Human Verification Required

None. No Validation Outcomes rows are `human_pending`.

One standard pre-merge checklist item isn't yet confirmable at this stage because no PR has been opened: **Final CI/CD checks green** — only local validation has run so far (see Test Results). Confirm CI is green on the PR before merging. All other checklist items (version bump — not QA's call, changelog drafted below, PR body drafted, diff matches spec intent) are in order.

## Proposed Changelog

- **`canon update` now targets its own install root and pins to an immutable release commit instead of the mutable default branch.** Previously, `canon update` ran `npm install` in the invocation directory rather than the directory it was actually installed in — invoking one project's `canon update` from inside an unrelated project could silently add `canon-ai` as a devDependency there. It also had no `#ref` pin, so it could install unreleased `main` code indistinguishable from the last tagged release. `canon update` now resolves the real install root (following symlinks), refuses to run unless a manifest at that root already lists `canon-ai` as a dependency, and by default installs the latest final release's commit pinned by SHA. A new `--channel main` flag and an extended `--ref <ref-or-40-char-sha>` form install and clearly label a development commit instead. Before installing, it announces the install location, current version/commit, and target version/commit; after a successful install, it writes a provenance record under `.canon` (write-only for now — no `canon update` or `canon doctor` behavior reads it yet).

## Decisions Made

- **pnpm-global installs now refuse instead of silently mutating the wrong directory.** The fix for the pnpm/hoisted-workspace layout gate (AC-4) can't distinguish a pnpm-managed *local* project dependency from a pnpm-managed *global* tool install — both produce the same nested-`node_modules` shape, so both now hit the layout refusal. Before this fix, a globally pnpm-installed `canon-ai` fell through to `type: 'global'` and ran `npm install -g` — but that command targets npm's own global prefix, not pnpm's actual store, so it was already a #188-class wrong-target mutation that exited 0 without updating the real running install. The operator reviewed this trade-off and explicitly accepted the stricter, fail-closed behavior via `canon task accept` (code_review verdict overridden from `spec_gap` to `sanctioned`, 2026-07-18): refusing is strictly more honest than a silent no-op success, and the spec's Known Risks already declared pnpm out of scope without carving out a local/global distinction. Nothing can land an install or provenance write at the wrong directory under either behavior. A pnpm-aware refusal message that helps a global-pnpm user find an alternative is deferred to the backlog as an XS follow-up.
- **Doctor's provenance-reading half was split out to a follow-up task**, per an earlier operator scope decision recorded in the spec (round 5): this task ships detection, gating, pinning, announcement, and the provenance *write*; nothing reads the provenance record yet, and `doctor.ts` has no hunk in this diff.
- **Stable-channel tag matching rejects leading-zero version components** (e.g. `v01.2.0`) in addition to excluding prerelease/suffixed tags — a stricter interpretation of the spec's "strict `vX.Y.Z`" contract, intentional and documented in the handoff's Deviations table.
- **The runtime provenance filename is documented without a backtick path reference** (prose only), since `docs-refs-check` treats backtick paths as checked-in repository references and this file is created at runtime.

## Open Questions

None outstanding — the one design ambiguity surfaced during code review (pnpm local vs. global layout conflation) was already adjudicated and accepted by the operator (see Decisions above).
