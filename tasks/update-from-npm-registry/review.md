# Code Review: update-from-npm-registry

> Round 1 (initial code review). Synthesized from anchored-Claude, cold-Claude, and cold-Codex lenses.

## Stage 1: AC Compliance

Anchored-lens validation gate: **pass** (`npm run build` clean against committed `dist/`; `npm test` 1205/1205 pass).

| AC | Status | Note |
|---|---|---|
| AC-1 | Met | Local argv includes `--save-exact`, global does not (`update.ts:536-538,548`; tests at `cli.test.ts:463,492,573,956`). |
| AC-2 | Met | `checkRegistryVersion` refusal text + no-install-spawn tests (`cli.test.ts:580-618`); E404 JSON shape verified empirically against the live registry. |
| AC-3 | Met | `usesRegistry` gate excludes `--channel main`/`--ref`/`CANON_UPSTREAM_REPO`; git-path tests throw if `npmViewRunner` is ever called. |
| AC-4 | **Partial** | Production code (`update.ts:509-527`) writes the correct provenance shape for the registry path, but no test asserts provenance.json *content* (`source`, `channel`, `version`, `resolved_sha`) for that path — see Findings below. |
| AC-5 | Met | npx message + grep checks confirmed live (no `install-links`/`CANONICAL_NPX_SOURCE` residue). |
| AC-6 | Met | No lifecycle scripts in `package.json`; `hooks` present; `files[]` excludes the hook script. |
| AC-7 | Met | `CONTRIBUTING.md` adds `npm run hooks` + explanatory sentence. |
| AC-8 | Met | `detectInstallType`/`layoutGate`/`dependencyGate`/`resolveStable`/`resolveNamedRef`/`runGitWithFallback` bodies unchanged in the diff. |
| AC-9 | Met | README + `init.ts` comment rewritten; `docs/pipeline-orchestrator.md` confirmed unchanged (doesn't mention `canon update`). |
| AC-10 | Met | CHANGELOG `Changed`/`Removed` bullets present. |
| AC-11 | Met | Red-first fixture and dependency-block test assert exact `X.Y.Z` manifest pin. |

## Stage 2 / Findings

### code-bug: AC-4's required test assertions are missing for the registry path

- **Source**: anchored-lens, verified directly against `tests/cli.test.ts`.
- **File**: `tests/cli.test.ts:935-958` (global registry path), and the local registry-path tests at `cli.test.ts:562-577`, `783-826`.
- AC-4 explicitly requires: "Verify: assertions added to the existing provenance tests for both paths." Only the git-path tests (`main` at 829-857, fork at 859-880, ref at 882-901) assert `provenance.json` content. Every test that exercises the registry/stable branch checks `npmArgs`/`npmViewArgs`/output text or, at most, `provenance.json` *existence* (`cli.test.ts:954`) — never its `source`/`channel`/`version`/`resolved_sha` fields.
- I manually read `update.ts:509-527` and confirmed the production code writes the correct shape (`source: "canon-ai@X.Y.Z"`, `version`, `resolved_sha` from the tag SHA) — this is a verification gap, not a live bug in shipped behavior today. But it is a real code-bug under canon's test-integrity rule: the AC's own verify clause is unmet, so a future regression on the primary new code path this task exists to add (e.g. accidentally swapping `source` for the git spec, or dropping `version`) would pass CI silently.
- Fix: add a `provenance.json` content assertion (source/channel/version/resolved_sha) to the registry-path test(s) exercising both local and global install types.

### Nits (non-blocking)

- **`checkRegistryVersion`'s `JSON.parse(result.stdout)` has no tolerance for incidental stdout noise** (`update.ts:337-359`, cold-Claude). If some npm config/version emits a warning to stdout ahead of the JSON, the parse throws and the function reports "could not verify" even though the lookup succeeded. Plausible but unconfirmed against the project's actual npm version; worth a defensive `JSON.parse` of the last line or a try/extract, but not blocking.
- **`npm view --global ...` relies on an undocumented flag** (`update.ts:337-340`, anchored + cold-Claude, flagged by 2 lenses). Both lenses independently verified it changes behavior as intended (config-scope isolation matching `npm install -g`), but it isn't a documented `npm view` flag and has no test canary for that specific semantic (only argv shape is asserted). Low risk given empirical verification; flag as a follow-up if npm ever changes this.
- **TOCTOU gap between the registry check and the install** (cold-Codex, cold-Claude — flagged by 2 lenses). A version could theoretically be unpublished between `checkRegistryVersion` and the `npm install` a moment later. Low real-world likelihood given npm's immutable-publish model; the spec's Known Risks section already accepts fail-closed behavior on registry flakiness, and this is the same class of window.
- **`currentPinFromManifest`'s new `versionMatch` regex only recognizes bare/`^`/`~` exact-version specs**, not other range forms (`>=`, `1.2.x`, etc.) — those still fall through to `"unknown"` as before (cold-Claude). Cosmetic (announcement text only, not the install target); out of scope per AC-3/AC-11's explicit forms.
- **Test-fixture fragility**: the fake `npm` stub in `buildUpdateRedFirstFixture` (`cli.test.ts` ~114-123) assumes `manifest.devDependencies` already exists and would throw a raw `TypeError` rather than a clean assertion failure if a future fixture manifest lacked that block (cold-Claude). Internal test-harness robustness note only.

## Dismissed Cold Findings

- Dismissed (cold-Claude): `postinstall` removal changes behavior for existing contributor clones — this is the intended behavior per AC-6/AC-7 and the spec's Decision section; CONTRIBUTING.md documents the one-time `npm run hooks` step and CI's `sync-templates:check` is the named guardrail. Not a bug.
- Dismissed (cold-Codex): none — cold-Codex's summary reported no findings beyond a general "validation checks and tests pass" assessment; nothing to adjudicate.

## Final Verdict

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

**Changes requested**: add the missing `provenance.json` content assertions for the registry path (local and global) per AC-4's verify clause. This is the only blocking finding; everything else surviving is a non-blocking nit for the implementer's discretion.

---

## Round 2

> Re-review after Iteration 2 (`handoff.md` "Iteration 2 — addressing review round 1"). Synthesized from anchored-Claude, cold-Claude, and cold-Codex lenses, re-run from scratch.

### Stage 1

Anchored-lens validation gate: **pass**. `git diff main -- src/cli/commands/update.ts` confirms AC-8's protected functions still have no touched bodies; the anchored lens independently re-ran `npm test` against current worktree HEAD and got 1205/1205 pass, 0 skipped.

| AC | Status | Note |
|---|---|---|
| AC-1 (amended) | Met | Unchanged since Round 1. |
| AC-2 | Met | Unchanged since Round 1. |
| AC-3 | Met | Unchanged since Round 1. |
| AC-4 | **Met — gap closed** | `tests/cli.test.ts:576-582` (all three dependency blocks) and `tests/cli.test.ts:962-968` (global) now assert full provenance content (`source: 'canon-ai@8.2.0'`, `channel: 'stable'`, `version: '8.2.0'`, `resolved_sha`, `updated_at`). This closes exactly the Round 1 blocking finding. |
| AC-5 – AC-11 | Met | Unchanged since Round 1; no further diff in iteration 2 touched these paths. |

### Stage 2 / Findings

No code-bugs or spec-gaps survived this round. Iteration 2 was a test-only change (plus the carried-forward, already-approved iteration-1 production code) and both lenses independently signaled **approve**.

**New nit (non-blocking)**: `scripts/install-git-hooks.mjs:37-38` (cold-Claude) — the file's own docstring still reads "Lives in `scripts/` (not in `CANON_OWNED`) — ships in the npm tarball via the `files` glob but isn't installed into adopter repos," but this task's AC-6 removed the file from `package.json`'s `files` array, so it no longer ships in the tarball. The comment is now stale about its own shipping status. Comment-only, no behavioral effect, and exempt from adopter-scope docs discipline per `AGENTS.md` (source comments), but worth a one-line fix since it directly describes the change this task made.

**Carried-forward nits (unchanged disposition from Round 1, still non-blocking)**: `checkRegistryVersion`'s stdout-noise fragility, the undocumented `npm view --global` flag, the TOCTOU window between check and install, `currentPinFromManifest`'s partial range-form coverage, and the red-first fixture's `devDependencies`-presence assumption. All re-flagged by one or both lenses this round with no new information; dispositions from Round 1 stand.

### Dismissed Cold Findings

- Dismissed (cold-Claude): the `--global` "guard is implicit rather than explicit" (`detection.type !== 'local'` vs. `=== 'global'`) and the `stableVersion as string` non-null assertion — both are pre-existing structural choices from iteration 1 already implicitly accepted at Round 1 (not newly introduced by iteration 2's test-only diff), correctness holds today per both lenses' own verification, and neither is tied to any AC. Style preferences for a future refactor, not bugs.

### Verdict for this round

- [x] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

**Approved.** The Round 1 blocking finding (AC-4 provenance-content test coverage) is closed with direct assertions on both the local (all three dependency blocks) and global registry paths. No new code-bugs or spec-gaps surfaced. Remaining nits are optional follow-ups, not blockers.
