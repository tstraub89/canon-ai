# Spec: update-install-root-provenance — `canon update` targets its own install root, pinned to an immutable release

> Written by: Claude | Review by: Codex
> Status: done
> Bundles GitHub issues #188 and #189's **updater half** (filed by James Hazel, triaged 2026-07-11). Backlog: `docs/BACKLOG.md` §"📦 Distribution & Portability". **Scope split (round 5, operator decision):** the doctor provenance-*reading* check is a follow-up task — see the "doctor reads install provenance" BACKLOG entry. This task ships the updater fixes and the provenance *write*; `doctor.ts` is untouched.
> **Altitude note (round 7, operator decision):** this spec states behavioral contracts. Implementation mechanics (harness layout, command forms, seam shape) live in §Implementation Notes as non-binding guidance for the plan/implement phases — the compiler and tests are the checker for those, not spec review.

## Problem

`canon update` neither knows **where** it should install nor **what** it should install. Two confirmed defects, one theme: the updater must mutate the exact install it's running from, pinned to an immutable release.

**Defect A (#188) — local updates run npm in the invocation directory, not the install root.** `detectInstallType()` (`src/cli/commands/update.ts:8`) correctly classifies the *running package* (it inspects the package's own directory, derived from `import.meta.url`), but returns only a bare type string. `updateCmd()` then passes `process.cwd()` as npm's cwd (`update.ts:27`, spawn at `update.ts:47`) with args `install --save-dev --install-links github:tstraub89/canon-ai`. Invoking one install's `dist/cli/index.js update` from a different repo therefore runs `npm install --save-dev` *in that other repo* — silently adding/updating `canon-ai` as a devDependency in a project that may never have had it, mutating its `package.json` and lockfile.

*Mechanism confirmed*: reporter reproduced it with a recorded npm shim against v2.2.0 (`3687092`) — a scratch `install/` layout invoked from an `adopter/` directory showed `npm cwd: …/adopter` with the `--save-dev` args (full transcript in issue #188). Verified against source this session: `update.ts:27` (`const cwd = process.cwd()`), `update.ts:47` (`spawnSync('npm', cmdArgs, { stdio: 'inherit', cwd })`).

**Defect B (#189) — the update source is a mutable branch.** The default source `CANON_GITHUB_SOURCE = 'github:tstraub89/canon-ai'` (`update.ts:24`) has no `#ref`, so npm resolves the repository's default branch — `canon update` can install unreleased `main` code that carries the same `package.json` version as the tagged release and is indistinguishable from it.

*Mechanism confirmed*: reporter's audit of 2026-07-11 — `refs/tags/v2.2.0 → 3687092`, `main → d4d65c9` (ahead by 3), both trees claiming package version `2.2.0`. Verified against source this session: the unqualified source constant at `update.ts:24`. This blind spot has already bitten canon's own dogfooding (the unreleased #182 review lens silently absent from pipeline runs while reporting the released version). The *detection* half of #189 — doctor comparing recorded provenance — is the split-out follow-up; this task makes identity *recordable* by pinning installs and persisting what was installed.

**Sequencing inside this task**: Defect A's `installRoot` work is the foundation — resolve *where* the install lives, then Defect B decides *what* ref lands there. Implement in that order.

## Decision

`canon update` becomes install-root-aware and release-pinned:

1. **Install detection returns the root.** `detectInstallType()` returns `{ type, installRoot }` instead of a bare string. For `local`, `installRoot` is the realpath-canonicalized directory that owns the `node_modules` containing the running package — a symlinked package dir resolves to the real install root. For `global`/`npx`, `installRoot` is `null`.
2. **Local updates run npm with `cwd = installRoot`** — never `process.cwd()`.
3. **Guarded mutation — two ordered gates, fail closed.** Before spawning npm for a local update: **(gate 1, layout — AC-4)** a `package.json` must exist at the resolved `installRoot`. **(gate 2, dependency — AC-3)** that manifest must parse and must list `canon-ai` in `dependencies`, `devDependencies`, or `optionalDependencies`; an unparseable manifest is a probe error and refuses (fail closed). Gate 1 runs first, so a missing manifest is always a layout refusal, never a dependency refusal — exactly one refusal fires for any input, each with its own distinctly-worded message naming what was checked. Every refusal: non-zero exit, no npm spawn.
4. **Announce the target — without reading provenance.** Before any mutation, print: install type, resolved install root (local), current version + SHA, and target version + SHA. Current version is the running executable's own baked version (the updater *is* the package being updated); current SHA is parsed from the install-root manifest's own `canon-ai` dependency pin when it carries one, else `unknown` (tolerant and display-only — odd shapes yield `unknown`, never a refusal; global installs always `unknown`). `.canon/provenance.json` is **not** consulted — it has no reader in this task.
5. **One effective slug drives resolution, install, and provenance.** The resolver's remote, the npm `github:` install target, and the provenance `source` all derive from a single effective owner/repo slug: `CANON_UPSTREAM_REPO` (trimmed) when set and non-empty, else the canonical `tstraub89/canon-ai` — the same convention `captureCanonSnapshot()` already uses. A fork override therefore resolves from, installs from, and records the same repo — the pinned SHA is always reachable from the install target. The slug is never derived from the adopter repo's `origin`.
6. **Stable channel pins to the latest final release.** By default, `canon update` resolves the latest **final** release tag on the effective repo — the highest SemVer among tags matching strict `vX.Y.Z` form; prerelease and otherwise-suffixed tags (e.g. `v9.0.0-rc.1`) are **excluded** from stable selection — and installs the tag's **commit** (peeled through any annotated tag) as `github:<effective-slug>#<sha>`, keeping `--install-links`. Resolution is git-native (no `gh`, no GitHub REST API), must not block on interactive credential prompts (auth failure surfaces as an actionable refusal), and **fails closed**: resolution error, no tags, or only non-final tags → abort with non-zero exit and no npm spawn — never a fallback to the unpinned mutable source.
7. **Labeled development installs; SHAs short-circuit resolution.** `--channel main` resolves the effective repo's `main`; `--ref <ref>` accepts a named ref **or a 40-hex commit SHA**. A 40-hex SHA is already immutable, so it skips remote resolution and is pinned directly — existence is deliberately fail-late at npm's own fetch (satisfies the backlog contract `--ref <sha>`). Named refs resolve to the single matching remote commit, peeled through annotated tags; zero matches or two-plus distinct matching commits refuse (fail closed, no unpinned fallback). Both channels label the output as a development install with its commit. `--channel` and `--ref` are mutually exclusive; `--channel` accepts only `main`; unknown flags are rejected with a supported-flags message (the `parseUpgradeArgs` convention).
8. **Provenance is persisted, write-only.** After a successful install, `canon update` writes `.canon/provenance.json` — `{ source, channel, resolved_sha, updated_at }` plus `version` for the stable channel only — at the install target's root (local: `installRoot`; global: the invoking repo when a `.canon/` directory exists, else print-only with a note). `source` is the exact pinned target passed to npm. Stable `version` is stored as bare `X.Y.Z` (leading `v` stripped) — the format `.canon/version` already uses — so the follow-up doctor comparison is like-for-like from day one. The file is meant to be committed (not gitignored). **Nothing reads it in this task** — not the announcement (item 4) and not `doctor.ts` (untouched).

**Red-first strategy.** The regression proofs for AC-2 and AC-6 must not depend on seams that only exist post-fix. They run the **real pre-fix executable**: a fixture where the package's committed build genuinely *is* the installed package under an `install/` root, invoked (by absolute path) with the subprocess working directory in a sibling `adopter/` repo, against a PATH-shimmed fake `npm` (a recorder that installs nothing) and fake `git` (canned responses) — mirroring the reporter's own repro, hermetic, no network, no real installs. Pre-fix, the recorder observes the defects directly (wrong cwd; unpinned source); post-fix, the same test observes the contract. The injection seam (`updateCmd(args, deps?)`) still lands with the fix, but only as post-fix unit-test plumbing — it follows the existing `stopCmd`/`watchCmd` deps convention, including an injectable exit so refusal tests can observe non-zero exits in-process (`update.ts` currently terminates via `process.exit`).

## Non-Goals

- **No `doctor.ts` changes.** The provenance-*reading* check is the split-out follow-up task (see the "doctor reads install provenance" BACKLOG entry, which also carries the manifest-pin identity idea). Structural backstop: this task's diff contains no `src/cli/commands/doctor.ts` hunk.
- **No `canon upgrade` changes** (issue #187's separate backlog entry).
- **No `gh` CLI dependency and no GitHub REST API.**
- **No support for vendored/submodule canon layouts in `canon update`** — no install root exists; update refuses with guidance (those users update via git + `canon upgrade`).
- **No changes to task-run provenance** (`captureCanonSnapshot()` / `CanonStamp` / `CANON_UPSTREAM_REPO` in `scripts/run-task/canon-snapshot.ts` — a different layer; the effective-slug helper here reads the same env var by the same rule but lives in `update.ts`).
- **No change to the npx guidance path** — the npx branch keeps its existing suggestion text; pinning is enforced positively on spawned installs by AC-6's target assertion.
- **No npm-registry publish path.**
- **No re-enabling of init-time `package.json` mutation** (`init.ts:83–95` stays commented out).
- **No remote existence pre-check for `--ref <sha>`** — fail-late at npm's fetch is the contract.

## Acceptance Criteria

- [ ] **AC-1 — install detection returns the root.** `detectInstallType()` returns `{ type: 'local' | 'global' | 'npx', installRoot: string | null }` per Decision item 1. All existing `detectInstallType` tests in `tests/cli.test.ts` are updated to the new shape, plus a new case asserting a symlinked package dir yields the *real* install root, not the symlink's apparent parent. Verify: `npm test`.
- [ ] **AC-2 — red-first regression for #188.** A subprocess test implements the red-first strategy (fixture per §Implementation Notes; the fixture's CLI entrypoint is invoked by **absolute path** so the invocation is independent of the adopter working directory). It asserts: (a) the npm recorder observed `cwd` = the install root (realpath), and (b) the adopter repo's `package.json` and lockfile are byte-identical afterwards. **Red-first proof:** the same test, run against the pre-fix committed build, fails on (a) — the recorder observes the adopter directory as cwd. Note the red run in the handoff. (The test consumes the committed `dist/`; CI's build-before-test order plus the reproducible-dist gate keep it fresh — run `npm run build` before `npm test` locally.)
- [ ] **AC-3 — dependency gate (gate 2), fail closed.** *Given a manifest exists at `installRoot` (gate 1 passed):* manifest-doesn't-list-canon-ai and manifest-unparseable each refuse — non-zero exit (observed via the seam's injectable exit), dependency-guard message naming the checked root, zero npm invocations recorded. Manifest listing `canon-ai` in any of the three dependency blocks proceeds. Unit tests cover all three outcomes. This AC does **not** own the missing-manifest case — that is AC-4.
- [ ] **AC-4 — layout gate (gate 1), owns the missing-manifest case.** No `package.json` at the resolved install root → refusal with a layout message (distinct wording from AC-3's), zero npm invocations. Runs before gate 2, so exactly one refusal fires for any input. Unit test: missing manifest → layout refusal.
- [ ] **AC-5 — target announcement.** Before spawning npm, output includes install type, resolved install root (local), current version + SHA, and target version + SHA, sourced per Decision item 4. Target version: stable = the resolved tag as bare `X.Y.Z`; dev channels = `unknown` (only a commit is resolved). Target SHA: always the pinned 40-hex commit. Unit tests: stable run with a pinned manifest (current SHA shown; target bare `X.Y.Z`, no leading `v`); stable run with an unpinned manifest (current SHA `unknown`); `--channel main` run (target version `unknown`, SHA shown); and an assertion that the announcement renders identically whether or not a `.canon/provenance.json` exists in the fixture (no provenance read).
- [ ] **AC-6 — red-first regression for #189: stable pins the latest final release commit.** Riding the AC-2 fixture: the fake git advertises a tag set and the npm recorder must receive exactly `github:tstraub89/canon-ai#<commit-sha-of-the-highest-final-vX.Y.Z-tag>` — asserted by shape (`/^github:tstraub89\/canon-ai#[0-9a-f]{40}$/`) and value. **Red-first proof:** against the pre-fix build, the recorder receives the bare unpinned source (same red run as AC-2). Post-fix unit cases: (i) a `main` commit ahead of the newest tag does not change the stable target (issue acceptance case); (ii) an annotated tag resolves to its peeled **commit**, not the tag object; (iii) **a prerelease tag newer than the highest final release (e.g. `v9.0.0-rc.1` above `v8.2.0`) is excluded — stable selects the final release**; (iv) a `CANON_UPSTREAM_REPO` fork override (set after module import, per the env-override test pitfall) flows to all three surfaces — resolver remote, npm target, persisted provenance `source` — with matching slug.
- [ ] **AC-7 — resolution failure aborts.** Resolution error, empty tag list, or a tag list containing **only non-final tags** each → non-zero exit, zero npm invocations, and no fallback to the unpinned source (message offers none). Unit tests for all three.
- [ ] **AC-8 — labeled dev channels; SHA short-circuit.** `--channel main` pins `main`'s resolved commit; `--ref <named-ref>` pins the ref's resolved commit (peeled through annotated tags); `--ref <40-hex-sha>` pins the given SHA with **zero resolver invocations** (asserted via the injected resolver/command seam). All three label output as a development install with the commit and target `github:<effective-slug>#<sha>`. Refusals (fail closed, zero npm invocations): zero matching remote refs; two-plus distinct matching commits (ambiguity message). Flag errors: `--channel` + `--ref` together; `--channel` with anything but `main`; unknown flags (supported-flags message). Unit tests per outcome.
- [ ] **AC-9 — provenance persisted, write-only.** After a seam-driven successful install, `.canon/provenance.json` at the install target's root contains `source` (the exact pinned target passed to npm), `channel` (`stable` | `main` | `ref`), `resolved_sha` (40-hex), `updated_at` (ISO 8601), and `version` **only for stable** (bare `X.Y.Z`); dev channels omit the key. Global installs: written to the invoking repo's `.canon/` when present, else print-only with a note. Failed installs write nothing. Unit tests: stable write (asserting stored `version` is bare, matching `.canon/version`'s format); `main` write (no `version` key); `--ref <sha>` write (`resolved_sha` = the given SHA); global-with-`.canon`; global-without (skip + note); failed-install no-write.
- [ ] **AC-10 — docs and help.** README.md's `canon update` row and install section reflect pinning, the new flags, and the provenance file — described strictly as **written by `canon update` for future tooling**; no doc sentence states or implies anything currently reads it, and the README `canon doctor` row is **not** edited. `printHelp()` in `src/cli/index.ts` documents `--channel` / `--ref` (including the 40-hex SHA form). Verify: `npm run docs-refs-check` passes; README diff contains no current-consumption claim.
- [ ] **AC-11 — build integrity.** `npm run build` run; committed `dist/cli/index.js` matches a fresh build (CI's reproducible-dist gate). Any additional dist artifact the build rewrites is declared in the handoff Changes table.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/cli/commands/update.ts` | Install-root detection + gates; pinned resolution (stable final-tag / main / ref / SHA short-circuit) via effective slug; announcement; provenance write; flag parsing; `deps?` seam |
| `src/cli/index.ts` | `printHelp()` text for `canon update` flags |
| `tests/cli.test.ts` | Updated detection tests; subprocess red-first test; unit tests for gates, announcement, resolver, flags, provenance write |
| `README.md` | `canon update` row + install-section pinning/flags/provenance note (written-for-future-tooling wording; `canon doctor` row untouched) |
| `dist/cli/index.js` | Generated — rebuilt bundle (declare any further dist deltas in the handoff) |
| `docs/codebase-map.md` | Protected doc, QA touch: `canon update` row description gains pinning/provenance |

### Interaction Dependencies

- `canon upgrade` writes `.canon/version` (unchanged); the follow-up doctor task consumes the `.canon/provenance.json` format shipped here.
- npm's `--install-links` flag is load-bearing for the install path; the pinned target must keep it.
- The subprocess red-first test depends on the committed `dist/` being fresh — guaranteed in CI by build-before-test order plus the reproducible-dist gate (AC-11).

### Data Model Changes

New persisted file: `.canon/provenance.json` — `{ source: string, channel: 'stable' | 'main' | 'ref', resolved_sha: string, updated_at: string, version?: string }` (`version` present only for `channel: 'stable'`, bare `X.Y.Z`). Written by `canon update`; **nothing reads it in this task** — the tolerant-parse contract for this committed, hand-editable file belongs to the follow-up doctor task. Internal CLI API changes (callers confined to `update.ts` and tests): `detectInstallType()` return shape; `updateCmd()` optional `deps?` parameter. No change to shared pipeline/status types; no change to `doctor.ts` exports.

### Implementation Notes (non-binding — plan/implement own these; the compiler and tests are the checker)

- Red-first fixture sketch: temp dir with `install/package.json` (devDependency on `canon-ai`) + the repo's committed `dist/` and `package.json` copied to `install/node_modules/canon-ai/`; sibling `adopter/package.json` + lockfile; fake `npm` recorder and fake `git` (canned `ls-remote`-style output) prepended to the subprocess `PATH`; subprocess cwd = `adopter/`; entrypoint invoked by absolute path into `install/node_modules/canon-ai/dist/cli/index.js`.
- Tag listing: `git ls-remote --tags https://github.com/<effective-slug>.git` with `GIT_TERMINAL_PROMPT=0`; peeled `^{}` lines carry the commit SHA for annotated tags. Named-ref resolution: `git ls-remote <url> <refspec>` (`refs/heads/main` for the main channel; the raw ref otherwise).
- Seam shape: follow `stop.ts`'s `deps` convention (`exit ?? process.exit`, injected runners); useful members here: `packageDir`, `spawnRunner`, `resolver`/command-runner, `exit`. Production defaults preserve real behavior; the seam is not reachable from the CLI arg surface.
- Existing test helpers to reuse: `withTempDir`, `runCanonCli` in `tests/cli.test.ts`; the injectable-runner fakes in `tests/run-task-canon-snapshot.test.ts`.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — required: `src/**` changes affect `dist/` output; committed dist must match fresh build (and the AC-2/AC-6 subprocess test consumes it)
- [x] `npm run docs-refs-check` — README + codebase-map edits
- [ ] E2E — N/A (no end-to-end runtime surface)

## Docs Impact

- `docs/codebase-map.md`: the `canon update` row's description goes stale — QA updates it to mention release pinning and provenance.
- Other protected docs: none expected. (`docs/release-process.md` describes how tags are *cut*, which this task consumes but does not change.)

## Known Risks

- **Credential prompts.** The repo is private; resolution must not block on an interactive prompt and must surface auth failure as an actionable refusal. npm's `github:` fetcher falls back https→SSH (hosted-git-info), so auth that satisfies npm does **not** guarantee a bare https `git ls-remote` succeeds — resolution mirrors npm's transport fallback (see §Amendment, AC-12).
- **Prerelease and odd tags.** Stable selection considers only strict `vX.Y.Z` tags (Decision item 6); a prerelease tag must never outrank a final release, and a tag universe with no final release aborts rather than guessing. AC-6(iii)/AC-7 are the guards.
- **Annotated vs lightweight tags.** The pinned SHA must be the tag's *commit* (peeled), never the tag object. AC-6(ii)/AC-8 assert it.
- **`--ref <sha>` is fail-late by design.** A mistyped or unpushed SHA fails at npm's fetch with npm's own error; update must still exit non-zero and write no provenance (AC-9's failed-no-write case).
- **Stale local `dist/` can mislead the red-first test.** It executes the committed build; CI is immune (build-before-test + reproducible-dist gate), and the AC notes the local build-first requirement.
- **Symlinked layouts resolve; pnpm refuses.** Realpath-canonical `installRoot` means symlinked packages (npm `--install-links`, linked dev checkouts) proceed against the real root; pnpm's virtual store realpaths to a root with no adopter manifest and correctly hits the layout refusal (pnpm out of scope).
- **Hoisted npm workspaces refuse conservatively.** canon-ai declared in a member manifest while `node_modules` sits at the workspace root → gate 2 refuses; the message must name what was checked so the user isn't stranded. Loosening is future work.
- **Global installs have no natural provenance home.** Provenance freshness for a global engine is bounded by the last repo it was updated from; the follow-up doctor task inherits this caveat.
- **Wrong-remote resolution.** Resolving tags from the adopter repo's `origin` would pin the wrong repository's tags; Decision item 5 forbids any install-root-derived remote.
- **Fork override coherence.** Resolver remote, npm target, and provenance `source` must agree or a fork's pinned SHA is unreachable from the install target; AC-6(iv) asserts all three surfaces.
- **`v`-prefix normalization.** Tags are `vX.Y.Z`; `.canon/version` is bare. Persisting the literal tag name would poison the follow-up doctor comparison from day one; AC-9 asserts the stored value.
- **Junk args become errors.** `updateCmd` previously ignored its args; strict parsing is intentional (matches `canon upgrade`), and the error lists supported flags.

## Human Test Plan

1. In a project that uses canon as a local dev dependency, run the update command with no options. Expected: it announces which install it's updating, shows the current version and the target version with its exact commit identifier (on the very first pinned update the current commit may honestly read as unknown), completes, and afterwards the project has a record of the exact source commit it received. Run it a second time: the current commit identifier now shows too.
2. Create a throwaway project that has nothing to do with canon. From inside it, invoke the *first* project's canon update. Expected: the throwaway project's dependency manifest and lockfile are completely untouched — the update either targets the right install or refuses with a clear explanation.
3. Run the update with the development-channel option. Expected: the output clearly labels the result as a development install and shows the exact commit it installed.
4. Run the update in a project whose manifest does not actually list canon as a dependency. Expected: a clear refusal explaining what was checked; nothing about the project changes.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier); ACs name grep-verified symbols
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) *Problem* states the confirmed mechanism and how it was confirmed; *Acceptance Criteria* includes red-first regression-test ACs (AC-2, AC-6) with a seam-free red mechanism

---

## Amendment

> Filed 2026-07-18 at `human_review` after real-environment testing (reroute round 1). Scope: resolution **transport** only — every other contract in this spec is unchanged.

**Finding.** Stable-channel resolution fails on the operator's machine — and by the same mechanism would fail on the reporter's. The resolver queries the remote exclusively over the https transport with terminal prompts disabled; the repo is private and the machine authenticates to GitHub via SSH only (no non-interactive https credential), so the very first resolver call errors with "could not read Username" and the default `canon update` invocation aborts. Confirmed by running the resolver's exact command outside any sandbox (fails) and the SSH-form equivalent (succeeds; returns the real tag list). Fail-closed held — no wrong mutation — but the headline feature refuses for 100% of the repo's current real installs.

**Premise correction (supersedes the Known Risks "Credential prompts" entry).** That entry claimed resolution needs "the same auth the npm `github:` install path already requires." False: npm's `github:` fetcher has an https→SSH fallback chain (hosted-git-info), which is exactly why `npm install github:…` has always worked on SSH-only machines where a bare https `ls-remote` cannot. The resolver must mirror that fallback rather than assume auth parity with npm.

**Amended contract (extends Decision items 6–7).**

- Every remote resolution — stable tag listing and named-ref resolution alike — attempts the https transport first; on any failure it retries the identical query over the SSH transport. Success on either transport yields identical downstream behavior (same pinned target, announcement, provenance).
- Both attempts are strictly non-interactive: git terminal prompts disabled **and** SSH batch mode, so neither a credential prompt nor a passphrase/host-key prompt can hang a headless run.
- Both transports failing → the existing fail-closed abort (non-zero exit, no npm spawn, never an unpinned fallback); the refusal message names both transports attempted and remains actionable.
- The `--ref <40-hex-sha>` short-circuit is unaffected: still zero resolver invocations.

**Additional acceptance criterion.**

- [ ] **AC-12 — resolution transport fallback, on both resolution paths.** Via the injected command seam and/or the fixture's fake git (which records each invocation's arguments and environment), asserted **separately for stable tag listing and for named-ref resolution** (cases a–c run against each path): (a) https succeeds → exactly one resolver invocation, no SSH attempt; (b) https fails, SSH succeeds → resolution succeeds with downstream target and provenance identical to (a); (c) both transports fail → non-zero exit, zero npm invocations, refusal message names both transports; (d) every resolver invocation on either path carries the non-interactive environment (terminal prompts disabled; SSH batch mode) — asserted by the recorder. Unit tests per outcome per path. The stable-path case (b) is red against the pre-amendment implementation.

**Implementation note (non-binding, per the altitude note).** SSH URL form `git@github.com:<slug>.git`; non-interactive via `GIT_TERMINAL_PROMPT=0` plus `GIT_SSH_COMMAND='ssh -oBatchMode=yes'` on both attempts. This mirrors npm hosted-git-info's transport chain. The existing 30s timeout applies per attempt.
