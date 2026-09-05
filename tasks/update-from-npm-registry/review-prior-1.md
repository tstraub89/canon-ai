# Code Review: update-from-npm-registry

> Reviewer: Claude (foreman synthesis of anchored-Claude, cold-Claude, cold-Codex)

## Stage 1 — Anchored Lens: AC Compliance

Anchored lens verdict: **pass**. All 10 ACs verified Met, including direct code reads for AC-4 (provenance `source`/`resolved_sha` pairing) and AC-2 (E404-absent vs. check-failed classification don't conflate).

| AC | Status |
|---|---|
| AC-1 | Met |
| AC-2 | Met |
| AC-3 | Met |
| AC-4 | Met |
| AC-5 | Met |
| AC-6 | Met |
| AC-7 | Met |
| AC-8 | Met |
| AC-9 | Met |
| AC-10 | Met |

No Stage 1 gaps.

## Stage 2 / Findings

- **[code-bug]** (flagged by cold-Codex; independently verified in code) — `src/cli/commands/update.ts:328` (`checkRegistryVersion` call) / `defaultNpmViewRunner` (`update.ts` near line ~318): the `npm view` registry check spawns with no `cwd` (defaults to the process's own cwd), while the subsequent `npm install` for a **local** install runs with `cwd: installRoot` (`update.ts:526`). If `canon update` is invoked from a directory other than `installRoot` (or one with a different `.npmrc`/registry config), the registry check can query a different registry than the one the install actually uses — producing a false refusal, or a passing check followed by an install that fails or resolves differently. Verified: `defaultNpmViewRunner` takes no `cwd` parameter at all, so there is no way to pass `installRoot` through today. Fix: thread the install root through the npm-view runner call, mirroring how `runGit`/`spawn` already receive an explicit `cwd`.

- **[code-bug]** (cold-Claude, verified in code) — `currentPinFromManifest()` (`update.ts:295-305`) only recognizes the legacy git-pin format (`/#([0-9a-f]{40})$/i`). After this change, a registry install writes a bare npm version spec to the manifest (`"canon-ai": "^X.Y.Z"` via default npm `save-prefix`, see next finding), which the regex never matches. Confirmed via `formatAnnouncement()`'s only caller (`update.ts:504-511`): on any `canon update` run *after* the adopter's first registry-based update, the printed announcement's `current: ... @ unknown` line permanently loses the previously-accurate pin display — a real regression in operator-facing diagnostic output introduced by the new manifest format, with no corresponding update to the reader that must now parse it.

- **[spec-gap]** (cold-Claude, verified in code) — `update.ts:526-533`: the local-install registry argv (`npm install <saveFlag> canon-ai@X.Y.Z`) has no `--save-exact`, and this repo has no `.npmrc` setting `save-exact=true` (confirmed: `npm config get save-exact` → `false`, `save-prefix` → `^`). So a project that depends on canon-ai via `devDependencies` gets `"canon-ai": "^X.Y.Z"` written after `canon update`, not an exact pin — unlike the git-path spec (`github:<slug>#<sha>`), which is inherently exact. This weakens the "no fallback to an unpinned source" invariant the spec itself states as foundational (Known Risks / Decision section): a later unrelated `npm install` in that project could silently float canon-ai to a newer minor/patch version without ever going through `canon update`'s registry-existence check. AC-1, however, literally specifies the exact argv shape used here with no `--save-exact` flag — the implementation matches the AC to the letter, so this is a spec omission rather than a deviation from spec. Recommend adding `--save-exact` to the local-install registry argv and amending AC-1 accordingly in a follow-up.

### Nits (non-blocking)

- `package-lock.json` still records `hasInstallScript: true` for the root package (confirmed at the root `packages[""]` entry) even though `postinstall` was removed from `package.json` in this diff. Regenerate the lockfile (`npm install` / `npm ci` will do it) so committed metadata matches. (Flagged by cold-Codex.)
- `scripts/install-git-hooks.mjs`'s header comment (lines 3-14) still describes itself as a "Postinstall wrapper" that "ships in the npm tarball via the `files` glob" — both now false given this diff (invoked via `npm run hooks`; removed from `files`). Not in this task's Affected Files, but worth a follow-up touch-up. (Flagged by cold-Claude.)
- `tests/cli.test.ts:361-369` ("npx recommends the registry package") passes a `packageDir` with no real `package.json` backing it, so `ownPackageName()` always falls into its catch-default `'canon-ai'` branch — the test can't distinguish "read name from manifest" from "always print canon-ai". Harmless today, low-value gap. (Flagged by anchored lens.)

## Dismissed Cold Findings

- Dismissed (cold-Claude): `ownPackageName()`/registry-target mismatch if a renamed fork's `package.json.name` doesn't exist on the registry — the spec's fork-override path (`CANON_UPSTREAM_REPO`) already takes the git path exclusively per AC-3, and this scenario (a fork that renames its `package.json.name` without setting the override) is explicitly out of the spec's supported configurations; low confidence, low real-world likelihood, no actionable fix within this task's scope.
- Dismissed (cold-Claude): the shell-fixture `npm` stub in `buildUpdateRedFirstFixture` can never return E404/failure for `npm view`, so the two "red-first" integration tests don't exercise `checkRegistryVersion`'s failure branches end-to-end. Real gap, but the failure branches are already covered by dedicated unit tests with hand-rolled `npmViewRunner` (AC-2's two required tests); redundant coverage in the integration fixture is a nice-to-have, not a hole in verification.
- Dismissed (cold-Claude): non-null assertion `stableVersion as string` after the registry check — verified type-safe in practice (`usesRegistry` is true only in the branch that sets `stableVersion`); no bug, purely stylistic.

## Final Verdict

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

Two code-bugs (registry-check cwd mismatch; broken current-pin display after a registry install) require changes before this can proceed.

## Round 2

### Stage 1 — Anchored Lens: AC Compliance

Anchored lens verdict: **pass**. Re-read `handoff.md`'s "Iteration 2 — addressing review round 1" section and verified both round-1 code-bugs directly in `src/cli/commands/update.ts`. All 10 ACs remain Met; no regressions in the areas iteration 2 touched.

| AC | Status |
|---|---|
| AC-1 | Met |
| AC-2 | Met |
| AC-3 | Met |
| AC-4 | Met |
| AC-5 | Met |
| AC-6 | Met |
| AC-7 | Met |
| AC-8 | Met |
| AC-9 | Met |
| AC-10 | Met |

No Stage 1 gaps.

**Round-1 findings verified fixed:**
- Registry-check cwd mismatch (local path): `update.ts:498` now computes `registryCwd = detection.type === 'local' ? detection.installRoot as string : cwd` and threads it into `checkRegistryVersion`; the local `npm install` at `update.ts:536` uses the same `installRoot`. Confirmed by both Claude lenses and by the foreman's own read.
- `currentPinFromManifest()` displaying `unknown` after a registry install: `update.ts:303-304` adds a semver-recognizing regex; new tests assert `current: ... @ 8.1.0` / `@ 2.2.0` instead of `unknown`. Confirmed fixed by both Claude lenses.

### Stage 2 / Findings

- **[code-bug]** (cold-Codex; independently verified empirically by the foreman, not merely by code-reading — both Claude lenses missed this) — `src/cli/commands/update.ts:498` (global branch) / `:546` (global install spawn): for a **global** update, iteration 2 made the registry-check `npm view` call and the actual `npm install -g` share the same literal `cwd` value, which fixes the *local* path but does not fix the *global* path, because `npm install -g` and `npm view` (without `-g`) do not consult the same effective npm configuration even when given the identical `cwd`. Verified directly: in a directory with a project-level `.npmrc` setting `registry=<custom>`, `npm config list` (no `-g`) resolves the project registry, but `npm config list -g` does not — confirming `npm install -g` ignores project-level `.npmrc` entirely, while a plain `npm view <cwd-scoped>` (as used for the preflight) still picks it up. `npm view <pkg> --global` was confirmed to bypass the project config and resolve correctly, matching what `-g` install would consult. So a global update run from a directory with a project `.npmrc` pointing at a different/unreachable registry can have its `checkRegistryVersion` preflight check the wrong registry (false refusal, or a false pass followed by an install against a different registry than the one just verified) — the exact failure mode described in the Codex finding, on the global path specifically since the local-path fix (matching `cwd` to `installRoot`) doesn't generalize to `-g`, which ignores `cwd`-scoped config outright. Both Claude lenses treated "same cwd variable" as proof the paths are aligned; that assumption is empirically false for the global path. Fix: pass `--global`/`-g` semantics through to the registry-view call for the global branch (e.g., add `--global` to the `npm view` args when `detection.type !== 'local'`, or otherwise force it to resolve only user/global config), not just match `cwd`.

- **[spec-gap]** (carried from Round 1, unaddressed — cold-Claude re-flagged, anchored lens confirmed still open) — `update.ts:533-536`: the local-install registry argv still has no `--save-exact`; iteration 2's handoff explicitly left this unaddressed ("neither is in the spec's Affected Files and neither is required by an AC"). Still stands as a legitimate spec omission per Round 1's reasoning (AC-1 literally specifies the exact argv without `--save-exact`). Not blocking on its own, but should not be lost — recommend a follow-up task/AC amendment.

### Nits (non-blocking, unaddressed since Round 1 — explicitly deferred by iteration 2 with stated rationale)

- `package-lock.json` still records `hasInstallScript: true` for the root package.
- `scripts/install-git-hooks.mjs`'s header comment still calls itself a "Postinstall wrapper" shipped "via the `files` glob" — both now false.
- `tests/cli.test.ts`'s "npx recommends the registry package" test can't distinguish reading the real manifest name from the `ownPackageName()` fallback default.

### Dismissed Cold Findings (Round 2)

- Dismissed (cold-Claude): `checkRegistryVersion`'s E404 classification could misattribute a genuinely-nonexistent/misnamed package as "not yet published" — same class as Round 1's dismissed fork-rename edge case; out of the spec's supported configurations (a fork must use `CANON_UPSTREAM_REPO`, which forces the git path per AC-3). Low confidence, low severity, no actionable fix in scope.
- Dismissed (cold-Claude): CHANGELOG.md's "GitHub fallback" wording allegedly overstates the mechanism (it's a suggested manual `--ref` flag, not an automatic fallback) — the spec's own Decision text uses the identical framing ("pointing at the GitHub fallback (`--ref v<version>`)"), so the CHANGELOG's phrasing is consistent with spec-intended wording, not a doc-accuracy bug.
- Dismissed (cold-Claude): TOCTOU gap between the registry preflight and the actual `npm install` — already accounted for in the spec's own reasoning (Design § "Why a registry pre-check, and why one task": `npm install` on an unpublished version exits non-zero with no partial install regardless of the preflight, so the preflight only improves the error message, not correctness). Low severity, low confidence, no fix required.
- Dismissed (cold-Claude): the two "red-first" integration-fixture tests still can't exercise `checkRegistryVersion`'s failure branches end-to-end (unchanged from Round 1) — still covered redundantly by the dedicated unit tests; not a hole in verification.

### Round 2 Verdict

- [ ] Approved
- [ ] Approved with nits
- [x] Changes requested
- [ ] Spec gap

One code-bug survives: the global-update registry-check/install config mismatch (`npm view` vs. `npm install -g` divergent config resolution) was not actually fixed by iteration 2's cwd-matching change, despite fixing the equivalent local-path bug.

## Round 3

> Synthesis discipline this round: lenses stayed high-recall (full findings reproduced in their outputs), but only `correctness bug` / `code-bug` and `spec-gap` findings drive the verdict here — nits and wording-only findings are folded or dropped below.

### Stage 1 — Anchored Lens: AC Compliance

Anchored lens verdict: **pass**. Re-verified the Round 2 code-bug fix directly in `src/cli/commands/update.ts`. All 10 ACs remain Met.

| AC | Status |
|---|---|
| AC-1 | Met |
| AC-2 | Met |
| AC-3 | Met |
| AC-4 | Met |
| AC-5 | Met |
| AC-6 | Met |
| AC-7 | Met |
| AC-8 | Met |
| AC-9 | Met |
| AC-10 | Met |

No Stage 1 gaps.

**Round-2 finding verified fixed, empirically (not just by code-reading), by both Claude lenses independently:** `checkRegistryVersion` now accepts a `global` parameter that adds `--global` to the `npm view` args for the global-install branch (`update.ts:337-341`, called with `detection.type !== 'local'` at `update.ts:500-502`). Both the anchored lens and the cold-Claude lens independently ran real `npm view --global` against a directory with a bogus project-level `.npmrc` registry and confirmed it bypasses the project config exactly as `npm install -g` does — closing the exact gap Round 2 identified. This matches the foreman's own empirical verification from Round 2 (same test method, same conclusion). New test `tests/cli.test.ts:922-945` pins the fixed argv (`['view', '--global', 'canon-ai@8.2.0', 'version', '--json']`).

### Stage 2 / Findings

No surviving `code-bug` findings this round.

- **[spec-gap]** (carried from Rounds 1 and 2, unaddressed across three iterations — re-flagged independently by both Claude lenses this round) — `update.ts:536-538`: the local-install registry argv still has no `--save-exact`, so a project depending on canon-ai via `devDependencies` still gets a floating `"^X.Y.Z"` range written after a registry-based `canon update`, unlike the git-path's inherently exact `github:#sha` pin. This is not a code deviation — AC-1 literally specifies the argv shape used here — so it remains a genuine spec omission, not a bug in the implementation. It has now survived three review rounds without a spec decision either way (add `--save-exact` and amend AC-1, or explicitly document that project-local installs are allowed to float). Per this round's synthesis discipline, a real spec-gap still drives the verdict (only pure nits/wording are dropped) — this is a substantive, repeatedly-confirmed gap, not a wording preference, so it is not being folded away here.

### Findings folded/dropped this round (nits and wording-only, per Round 3 discipline)

- `package-lock.json`'s stale `hasInstallScript: true` (carried since Round 1) — cosmetic, no functional effect.
- `scripts/install-git-hooks.mjs`'s stale "Postinstall wrapper" header comment (carried since Round 1) — cosmetic, no functional effect.
- `tests/cli.test.ts`'s "npx recommends the registry package" test not distinguishing manifest-read from fallback-default (carried since Round 1) — test-quality nit, not a hole in verified behavior.
- New this round: `buildUpdateRedFirstFixture`'s fake-npm shim assumes `$2` is always the `pkg@version` spec, which would break if a future test reused it for a global-path scenario (flagged independently by both lenses) — real but dormant, affects no test that exists today, and is a fixture-quality nit rather than a defect in shipped code.
- New this round: `checkRegistryVersion`'s "could not verify … (no output)" message could mis-describe an unexpected-but-successful npm response shape (cold-Claude, low confidence, not observed against real npm) — message-wording nit.
- New this round: `checkRegistryVersion`'s `global` boolean parameter is positional and could be mis-ordered in a future edit (anchored lens, low confidence) — style nit, no compiler-visible risk today since call sites are correct.
- Confirmed non-bug (cold-Claude): dropping `--install-links` on the registry install path is intentional and correct (the flag exists only to avoid git-cache symlinking, irrelevant to a real tarball install).

### Dismissed Cold Findings (Round 3)

- Dismissed (cold-Claude): `checkRegistryVersion`'s "no output" message could be misleading for an unexpected-but-successful npm response shape — folded above as a nit; no functional defect, not observed against real npm.

### Round 3 Verdict

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] Spec gap

Both round-2 code-bugs are now genuinely fixed and empirically re-verified (foreman + both lenses independently confirmed the `--global` fix against real npm behavior). No `code-bug` findings survive this round. One `spec-gap` remains and has now persisted, unaddressed, across all three review rounds: the local-install registry argv's missing `--save-exact`. Per the verdict rule (spec-gap with no code-bugs → `spec_gap`), this requires a spec decision — either amend AC-1 to require `--save-exact`, or explicitly document that project-local registry installs are allowed to float on a caret range — before this task can be marked approved.
