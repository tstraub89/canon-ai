# Code Review: update-install-root-provenance

> Reviewer: Claude | Spec: `tasks/update-install-root-provenance/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [ ] Validation Outcomes table has no `Fail` results — the table self-reports `npm run build: Pass`, but this is inaccurate: the committed `dist/cli/index.js` does not match a fresh build (see AC-11).
- [x] All checks required by the spec's "Validation Required" section were run
- [ ] No required checks were skipped without justification — the build-freshness guarantee AC-11 requires was not actually satisfied at commit time, despite the check having been run.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: install detection returns the root | Met | `{type, installRoot}` shape is correct; symlinked-root case resolves via `realpathSync` and is tested (`update.ts:17-30`, `tests/cli.test.ts:367-379`). |
| AC-2: red-first regression for #188 | Partial | Fixture mechanism is sound and genuinely red-first (copies committed `dist/` into a fake install root, invokes by absolute path from a sibling `adopter/` cwd, asserts npm-recorded cwd). But the AC's explicit "(b) byte-identical" requirement is checked via `assert.doesNotMatch(content, /canon-ai/)` (`tests/cli.test.ts:401-402`), not a true byte-for-byte comparison against a pre-run snapshot — see Findings. |
| AC-3: dependency gate | Met | Malformed/unrelated-manifest refusals and all three accepted dependency blocks are exercised through the real `updateCmd()` path with zero-npm-invocation assertions. |
| AC-4: layout gate | **Not Met** | The layout-gate refusal this AC requires is unreachable through the real command path. `detectInstallType()` (`update.ts:17-30`) only ever returns `type: 'local'` after already confirming `existsSync(package.json)` at that exact directory — so `layoutGate()` in `updateCmd()`'s local branch can only fail via a TOCTOU race (file deleted between the two checks), not the scenarios AC-4 and the spec's own Known Risks section describe. The spec explicitly claims "pnpm's virtual store realpaths to a root with no adopter manifest and correctly hits the layout refusal" — this is false against the actual code: that case is classified `global` by `detectInstallType` and silently proceeds to `npm install -g --install-links <target>` with no refusal at all. Only the exported pure `layoutGate()` function is unit-tested in isolation (`tests/cli.test.ts:424-430`); the handoff's own unresolved Blocker (handoff.md:79-81) raises exactly this ambiguity and asks review to adjudicate it — adjudicated here as Not Met. |
| AC-5: target announcement | Met | Covers install type/root/current+target version+SHA; no-provenance-read case asserted. |
| AC-6: stable immutable release pin | Partial | Tag-selection logic (highest final tag, peeled commits, prerelease exclusion, fork-slug propagation) is correct and well-tested at the source level, but the guarantee is only as good as what ships — see AC-11: the committed dist does not carry the strict tag regex this AC depends on. |
| AC-7: resolution failure aborts | Met | All three failure modes (`resolveStable`) correctly abort with no fallback; wiring inspection confirms `return exit(1)` precedes any `spawn` call. (Minor test-coverage nit: only unit-tested at the pure-function level, not through full `updateCmd()` — not a live bug.) |
| AC-8: development channels and SHA short-circuit | Met | Flag parsing, SHA short-circuit (zero resolver calls), and channel labeling are tested through `updateCmd()`. (Same minor coverage nit as AC-7 for the ambiguous/zero-match refusal paths.) |
| AC-9: write-only provenance | Met | Stable/main/ref/global-with/global-without/failed-no-write cases covered; stored version is bare `X.Y.Z`. |
| AC-10: docs and help | Met | README, codebase-map, `printHelp()` updated with write-only/future-tooling wording; `doctor.ts` untouched; `docs-refs-check` passes. |
| AC-11: build integrity | **Not Met** | Committed `dist/cli/index.js` does not match a fresh build. Running `npm run build` in the worktree and diffing against the committed file shows exactly one divergence: `STRICT_FINAL_TAG_RE` in the committed dist is the **old, loose** pattern `/^v(\d+)\.(\d+)\.(\d+)$/`, while `src/cli/commands/update.ts:77` and a fresh build both carry the **strict**, leading-zero-rejecting pattern `/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/` that the handoff's own Deviations table describes as an intentional stricter interpretation of AC-6/AC-7. A user running the shipped, committed CLI (not source) would accept a tag like `v01.2.0` as a valid final release where the reviewed/tested source would reject it — the exact contract AC-6/AC-7 exist to enforce. Confirmed independently by three lenses: the foreman, the anchored lens, and the injected cold-Codex lens. |

### Dropped Sections Check

- [x] Non-goals respected (no `doctor.ts` hunk, no `canon upgrade` changes, no `gh`/REST dependency)
- [ ] Known Risks addressed or documented as accepted — the "pnpm refuses" claim in Known Risks does not hold against the implementation (see AC-4).
- [x] Human Test Plan is satisfiable by the implementation (scenarios 1, 3, 4 hold; scenario 2's non-mutation guarantee holds for the tested paths but is undermined for the pnpm/hoisted-workspace edge case AC-4 was meant to cover)

### Stage 1 Verdict

- [ ] **Pass** — proceed to Stage 2
- [x] **Fail** — skip Stage 2, final verdict below is `Changes requested`

> Stage 2 findings are still recorded below (rather than left as "Not run") so the next iteration gets the full return list in one round instead of discovering them piecemeal across rounds.

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Stage 1 failed on two independent grounds: a stale committed `dist/` bundle (AC-11) and an unreachable layout gate that leaves the pnpm/hoisted-workspace protection the spec promises unimplemented (AC-4). The rest of the implementation — install-root detection, dependency gating, git-native immutable resolution (stable/main/ref/SHA), announcement, and write-only provenance — is solid and well-tested at the unit level; the gaps are concentrated in build hygiene and one specific detection edge case, not in the core resolution/provenance logic.

### Findings

#### Correctness Bugs

- **[code-bug, flagged by 3 lenses: foreman + anchored + cold-Codex] Committed `dist/cli/index.js` is stale relative to `src/cli/commands/update.ts`** — `STRICT_FINAL_TAG_RE` in the shipped bundle is the old loose regex, not the strict leading-zero-rejecting one the source and tests assume. See AC-11 above. Fix: rebuild and recommit `dist/cli/index.js`.
- **[code-bug, flagged by anchored lens, independently verified by foreman] `layoutGate()` (AC-4) is unreachable in the real `canon update` command flow** — `detectInstallType()`'s own local/global split already requires `package.json` to exist before returning `type: 'local'`, so the pnpm/hoisted-workspace cases the spec's Known Risks section names as gate-1 targets instead silently classify as `global` and proceed to `npm install -g` with no refusal. `update.ts:17-30` (detection) vs. `update.ts:84-92` (gate, dead on this path) vs. spec Known Risks "pnpm ... correctly hits the layout refusal" (false against the code). Fix requires resolving the ambiguity the handoff itself flagged: either `detectInstallType` needs to surface a "local-shaped but missing manifest" case distinct from `global` so gate 1 can actually fire, or the spec's Known Risks claim needs correcting to match intended behavior (see Spec Gaps below for the alternate framing).
- **[code-bug, flagged by anchored lens, independently verified by foreman] AC-2's "byte-identical" assertion is a substring check, not a true comparison** — `tests/cli.test.ts:401-402` uses `assert.doesNotMatch(fs.readFileSync(...), /canon-ai/)` against the adopter's `package.json`/lockfile post-run. This catches the specific defect (canon-ai added as a dependency) but would pass even if the adopter's files were reformatted or had unrelated keys mutated — weaker than AC-2's stated "byte-identical" contract. Fix: snapshot the adopter files pre-run and assert full string equality post-run.

#### Risk / Guardrails

- **[spec-gap, flagged by cold-Claude, verified against code] `dependencyGate` accepts `canon-ai` in `dependencies`, `devDependencies`, or `optionalDependencies` (AC-3), but the local-install npm call is hardcoded to `install --save-dev ...` (`update.ts:410`) regardless of which block matched.** An adopter with `canon-ai` under `dependencies` or `optionalDependencies` gets it silently moved to `devDependencies` on update. This behavior predates this task (the pre-fix code always used `--save-dev` unconditionally with no dependency-block check at all), but this task is the one that widened the *gate* to explicitly bless all three blocks as valid without the spec's Decision text ever specifying block-preserving install behavior. Root cause is spec silence, not an implementer error against a written AC — recorded as a spec gap (canon-ai is typically a devDependency in practice, which narrows real-world impact).
- **[nit, flagged by cold-Claude] `defaultGitRunner`'s `git ls-remote` calls (`update.ts:67-74`) have no `timeout`, unlike every other local-tree `git` call in the codebase** — a stalled network connection to github.com could hang `canon update` indefinitely.
- **[nit, flagged by cold-Claude] `writeProvenance` isn't wrapped in try/catch** — a post-install write failure (EACCES, disk full) would crash with a raw stack trace after npm already succeeded, rather than surfacing a clear "update succeeded, provenance not recorded" message.
- **[nit, flagged by cold-Claude] `--ref <value>` is passed unvalidated as a positional arg to `git ls-remote <url> <refspec>`** — a value starting with `-` could be interpreted by git as a flag. Low real-world impact (user supplies the value to their own shell) but no guard exists, unlike the SHA fast path which is regex-validated first.

#### Optional Cleanup / Nit

- `formatAnnouncement`'s `targetLabel` for the `ref` channel prints the literal string `"ref (development)"` rather than the actual `--ref` value requested — unlike `main`, which is self-descriptive. Same gap in the `Provenance` record (no field captures the requested ref string, only `resolved_sha`). (cold-Claude)
- `resolveEffectiveSlug()` (`update.ts:235-238`) re-implements the same `process.env.CANON_UPSTREAM_REPO?.trim() || CANON_UPSTREAM_REPO` logic that already exists in `scripts/run-task/canon-snapshot.ts`, instead of sharing a helper — risk of drift if one copy is edited later. (cold-Claude)
- AC-7/AC-8's ambiguous/zero-match/resolution-failure refusal paths are only unit-tested at the pure `resolveStable()`/`resolveNamedRef()` function level, not through full `updateCmd()` to assert zero npm invocations at the command level as the ACs state (code inspection confirms correct wiring — not a live bug, just a coverage gap). (anchored lens)
- No test asserts the actual npm argv (`['install', '-g', '--install-links', target]`) for the global-install branch — the global provenance test discards `spawnRunner`'s args entirely. (anchored lens + cold-Claude, same underlying gap)

#### Spec Gaps

- See AC-4 above and the correctness-bugs entry for `layoutGate()`: the spec's Known Risks section makes a concrete, falsifiable claim ("pnpm ... correctly hits the layout refusal") that the spec's own Decision-item-1 detection contract (classify missing-manifest `node_modules` parents as `global`) makes structurally impossible to satisfy. This needs a human/spec-owner decision on which side to fix — the AC-4 contract or the detection contract — before re-implementation, since the current code is internally consistent with AC-1's detection behavior but not with AC-4/Known Risks.
- The dependency-block-preserving install question (see Risk/Guardrails above) is a genuine spec silence, not an implementer deviation.

### Dismissed Cold Findings

- Dismissed (cold-Claude): "local install unconditionally creates `.canon/` via `writeProvenance` while global gates on `existsSync('.canon')` — inconsistent guard" — **not a bug.** Spec Decision item 8 / AC-9 explicitly directs this asymmetry: "local: `installRoot`; global: the invoking repo when a `.canon/` directory exists, else print-only with a note." Local installs are already gated by the dependency gate (AC-3) confirming `canon-ai` is a declared dependency at that root, which is the intended "opt-in" signal; global installs have no equivalent signal, hence the conditional.
- Dismissed (cold-Claude): "git ls-remote over https vs. npm install's own auth transport could diverge (SSH vs HTTPS), making resolution fail where npm would have succeeded" — low confidence per the lens's own tag, and the spec's Known Risks section already frames credential-prompt/auth failure as an accepted, actionable-refusal risk ("must surface auth failure as an actionable refusal — the same auth the npm `github:` install path already requires"). No concrete failure mode was demonstrated beyond a plausible-sounding theory; insufficient to treat as a live bug without evidence the two auth paths actually diverge for this repo's configuration.
- Dismissed (cold-Claude): "`layoutGate` is dead code" framed as a pure code-quality nit — superseded by the correctness-bug framing above (it's not just dead code, it's a spec contract that goes unenforced for the exact scenario the spec calls out by name).

## Final Verdict

- [ ] **Approved** — ship as-is
- [ ] **Approved with nits** — ship after addressing optional items (or not)
- [x] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

## Round 2 — verifying iteration 2's response to round 1

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: install detection returns the root | Met (unchanged core; see AC-4 note) | Symlinked-local and ordinary global-npm cases (e.g. `/usr/local/lib/node_modules/canon-ai`) both re-verified correct. The new nested-`node_modules` branch added for AC-4 introduces the behavior discussed under AC-4 below — not itself a violation of AC-1's stated contract (AC-1 never enumerated pnpm-global as a required `global` case), but flagged there since it's the same code. |
| AC-2: red-first regression for #188 | **Met** | `tests/cli.test.ts` now snapshots the adopter's `package.json`/lockfile content before the subprocess run and asserts full string equality (`assert.equal`) afterward — verified directly by reading the test code. Round 1's substring-check gap is closed. |
| AC-3: dependency gate | Met (unchanged from round 1) | No relevant code changed this round. |
| AC-4: layout gate | **Met, with a new spec-gap surfaced** | `detectInstallType()` now surfaces nested `/node_modules/.../node_modules/` layouts (pnpm's virtual store shape) as `type: 'local'`, so the real command path now reaches `layoutGate()` and refuses for exactly the case AC-4/Known Risks describe — round 1's "unreachable gate" gap is closed, confirmed by a new test (`tests/cli.test.ts`, `pnpm-shaped virtual-store path reaches the layout refusal`) and independently re-derived by hand-tracing the code. **However**, this same heuristic can't distinguish a pnpm-managed *local* project dependency from a pnpm-managed *global* tool install — both produce an identical nested-`node_modules` shape, so both now hit the layout refusal identically. Round 1 (before this fix) classified global-pnpm-installed canon-ai as `type: 'global'` and ran a working `npm install -g`; after this fix, that case is misrouted to `type: 'local'` with a bogus `installRoot` inside pnpm's internal store, and permanently refuses. See New Findings below — this is real, verified, and worth a human decision, but it is not a code-bug against written AC text (see rationale below). |
| AC-5: target announcement | Met (unchanged) | No relevant code changed this round. |
| AC-6: stable immutable release pin | Met | Re-verified: `npm run build` in the worktree produces byte-identical output to the committed `dist/cli/index.js` (restored via `git checkout` after diffing — zero residual diff left in the tree). |
| AC-7: resolution failure aborts | Met (unchanged) | No relevant code changed this round. |
| AC-8: development channels and SHA short-circuit | Met (unchanged) | No relevant code changed this round. |
| AC-9: write-only provenance | Met | Now additionally hardened: a post-install `writeProvenance` failure is caught and reported as a clear message rather than a raw stack trace (`update.ts`), matching round 1's nit exactly. Exits 0 in this case since the actual `npm install` already succeeded — consistent with "write-only, best-effort" provenance, not itself a new gap. |
| AC-10: docs and help | Met (unchanged) | No relevant code changed this round. |
| AC-11: build integrity | **Met** | Confirmed by the foreman directly: `npm run build` produces a zero-byte diff against the committed `dist/cli/index.js`. Round 1's stale-bundle gap is closed. |

### Verifying Round 1 findings

- _correctness bug:_ "stale committed `dist/cli/index.js` (AC-11)" → **fixed**, verified independently (fresh build = zero diff against committed file) ✓
- _correctness bug:_ "`layoutGate()` (AC-4) unreachable through the real command path" → **fixed** for the general reachability gap; the mechanism used to fix it has a side effect — see New Findings.
- _correctness bug:_ "AC-2's byte-identical assertion was a weak substring check" → **fixed**, verified true pre/post snapshot equality in `tests/cli.test.ts` ✓
- _spec-gap:_ "dependency-block-preserving install (`--save`/`--save-dev`/`--save-optional` matching whichever block canon-ai was found in)" → **addressed**, verified in code; no test for the simultaneous-multi-block case, but that's a documented-priority nit, not a live bug.
- _nit:_ "`git ls-remote` has no timeout" → **fixed**, 30s timeout added.
- _nit:_ "`writeProvenance` isn't wrapped in try/catch" → **fixed**, clear post-install failure message.
- _nit:_ "`--ref` values starting with `-` are unvalidated" → **fixed**, rejected during argument parsing before any git call.

### New findings (only NEW issues introduced by Iteration 2's changes)

- **[spec-gap, flagged by 2 lenses: anchored + cold-Claude, independently verified by the foreman via direct code tracing] The AC-4 fix's detection heuristic conflates pnpm-local and pnpm-global layouts, silently dropping `canon update` support for globally pnpm-installed canon-ai.** `detectInstallType()`'s new branch (`update.ts`, the `firstNodeModulesIdx !== nodeModulesIdx` check) treats *any* path containing two nested `/node_modules/` segments as `type: 'local'`. Both a local pnpm-managed dependency (`<project>/node_modules/.pnpm/canon-ai@X/node_modules/canon-ai`, where the real adopter manifest lives three levels up at `<project>/package.json` and is never checked) and a global pnpm-managed tool install (`<PNPM_HOME>/global/N/node_modules/.pnpm/canon-ai@X/node_modules/canon-ai`, where the manifest lives at `<PNPM_HOME>/global/N/package.json`, one level up from the naive `projectRoot`) produce this identical shape and are both routed to `layoutGate()`, which only checks the naive `projectRoot` and never climbs further — so both refuse permanently. Before this fix (round 1), the global-pnpm case fell through to `type: 'global'` and ran a working `npm install -g`; this round's fix silently removes that working path with no documentation update and a generic refusal message that doesn't guide a global-pnpm user toward an alternative. **Why this is spec-gap, not code-bug**: the spec's Known Risks section states, without distinguishing local vs. global pnpm, "pnpm's virtual store realpaths to a root with no adopter manifest and correctly hits the layout refusal (pnpm out of scope)" — a blanket framing that the implementation now satisfies literally. AC-4's text ("No `package.json` at the resolved install root → refusal") is also satisfied literally; nothing in the AC or spec text distinguishes "resolved install root" computed via naive last-nested-segment truncation from one that climbs further to find an ancestor manifest. This is a genuine spec ambiguity, not a violation of explicit written text — but it silently changes behavior for a real (if likely rare, and never explicitly documented/blessed) installation method, with no updated Known Risks entry and no user-facing guidance in the refusal message. **Verified fail-closed and safe**: the branch can only fire when the naive `projectRoot` already lacks a `package.json`, and `layoutGate()` re-checks that identical path before any npm/network call — no misclassification here can lead to an install or provenance write at the wrong directory; the only failure mode is "refuses where it used to (arguably already-questionably) succeed." Needs a human decision: is dropping support for globally pnpm-installed canon-ai acceptable as-is, or should detection climb one more level to find a global pnpm store's own manifest before falling back to refusal — and either way, should the Known Risks section and refusal message be updated to say so explicitly?

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [x] **Spec gap** — no surviving code-bugs; the sole surviving finding is a genuine spec ambiguity (pnpm local vs. global scope) requiring a human decision before either accepting the current refusal behavior or directing a further code change.

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.

---

## Round 3 — verifying the AC-12 SSH-fallback amendment (post `canon task accept`, post reroute)

> Context: round 2's spec-gap finding (pnpm local/global conflation) was operator-accepted via `canon task accept` and is **settled — not re-litigated here**. The task then went to `human_review`, where real-environment testing found a genuine new bug (stable-channel resolution errors on SSH-only machines against this private repo, since the resolver only tried HTTPS). The spec was amended (`## Amendment` + AC-12) and the task was rerouted through `implement` to add HTTPS→SSH git transport fallback. This round reviews that amendment.

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged) | `{type, installRoot}` shape and symlink realpath resolution untouched this round. |
| AC-2 | Met (unchanged) | Byte-identical pre/post snapshot assertion (round 1's fix) intact. |
| AC-3 | Met (unchanged) | Dependency-block-preserving save flags intact. |
| AC-4 | Met (settled per round 2 operator accept — not re-litigated) | Nested-`node_modules` detection branch untouched this round. |
| AC-5 | Met (unchanged) | No-provenance-read assertion intact. |
| AC-6 | Met (unchanged) | Stable tag-selection logic unaffected by the transport-fallback wrapper. |
| AC-7 | Met (unchanged) | All three failure modes still abort with no unpinned fallback. |
| AC-8 | Met (unchanged) | Dev channels / SHA short-circuit unaffected. |
| AC-9 | Met (unchanged) | Provenance write cases unaffected. |
| AC-10 | Met (unchanged) | Docs/help correctly silent on the internal SSH-fallback mechanic (not a documented flag). |
| AC-11 | Met | Re-verified independently by the foreman and by the anchored lens: fresh `npm run build` produces a byte-identical `dist/cli/index.js` against the committed file. |
| AC-12 | Met on its own literal terms, but see New Findings — the fallback mechanism itself (order, both resolution paths, timeout, dual-failure messaging, SHA short-circuit bypass) is implemented and tested correctly. The *environment-forcing side effect* of how AC-12(d)'s "non-interactive environment" requirement is satisfied introduces the round's one surviving code-bug. | `runGitWithFallback` is shared by both `resolveStable` and `resolveNamedRef` (`src/cli/commands/update.ts`); https-then-ssh, one attempt each, 30s timeout per attempt, dual-failure message names both transports; `--ref <sha>` confirmed zero resolver calls. |

### Verifying Round 2's finding

- _spec-gap:_ "pnpm local/global layout conflation" → **not re-opened**; operator-accepted via `canon task accept` (`tasks/update-install-root-provenance/notes.md`, 2026-07-18 entry). No code in this round touches that path.

### New findings (issues introduced or newly surfaced by the AC-12 amendment)

- **[code-bug, flagged by 3 lenses: anchored + cold-Claude + cold-Codex, independently verified by the foreman against both the code and the binding spec text] `defaultGitRunner` unconditionally overwrites `GIT_SSH_COMMAND` rather than composing with or defaulting only when unset — `src/cli/commands/update.ts:78-86` (`env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -oBatchMode=yes' }`).** This clobbers any pre-existing custom `GIT_SSH_COMMAND` (non-default identity file, jump host/`ProxyCommand`, `IdentitiesOnly=yes`, etc.) for every resolver git call — including, specifically, the SSH fallback leg that exists *to help users whose HTTPS transport doesn't work*. That population is exactly the population most likely to already have a working custom SSH transport configured, and this code silently replaces it. Concrete failure mode: a user with a working custom `GIT_SSH_COMMAND` (e.g. `ssh -i ~/.ssh/canon_key`) that `npm install github:...` itself would succeed with (npm's own git invocation, spawned separately via `spawn()` at `update.ts:461,470` with no env override, inherits the real environment unmodified) sees the *resolver's* SSH attempt fail — because the forced plain `ssh -oBatchMode=yes` can't authenticate — producing a false "both transports failed" abort even though the machine is correctly configured and the actual install would work fine. Verified against the binding contract, not just the non-binding sketch: the Amendment's **binding** text (AC-12, "Amended contract") only requires "SSH batch mode, so neither a credential prompt nor a passphrase/host-key prompt can hang a headless run" — it does not require discarding a caller's own working transport configuration. The spec's *non-binding* Implementation Note does describe the literal mechanic implemented here ("`GIT_SSH_COMMAND='ssh -oBatchMode=yes'` on both attempts"), but Implementation Notes are explicitly non-binding sketches that plan/implement are expected to correct when they conflict with sound engineering (per the spec's own altitude note) — literal transcription of a non-binding suggestion is not a defense when a strictly more-correct implementation (compose with any existing value, e.g. append `-oBatchMode=yes` to an existing `GIT_SSH_COMMAND` or fall back to `'ssh -oBatchMode=yes'` only when unset) satisfies the same binding non-interactivity requirement without the collateral damage. No test exercises a *conflicting* pre-existing `GIT_SSH_COMMAND` — every env-asserting test (`tests/cli.test.ts:421,451,594,602`) starts from a parent environment that already matches the forced value, so the override-vs-default distinction was never actually exercised. Fix: default `GIT_SSH_COMMAND` (and compose, not replace, when a caller value exists) rather than force it. Severity: medium (real, reproducible regression for a real population; fails closed with a refusal rather than a wrong mutation, but the refusal is a false negative on an already-working setup — and this population is disproportionately the one the whole amendment was written for).

### Carryover nits (still open, not blocking; unchanged from round 1, not re-litigated in depth)

- `formatAnnouncement`'s `targetLabel` for the `ref` channel still prints the literal `"ref (development)"` rather than the actual `--ref` value requested; no field captures the requested ref string.
- The global-install npm argv assertion still only checks `['install', '-g', '--install-links']` and not the fourth argument (the pinned target string).
- AC-7/AC-8's ambiguous/zero-match refusal paths remain unit-tested only at the pure-function level, not through the full `updateCmd()` path.
- `resolveEffectiveSlug()` duplicates `CANON_UPSTREAM_REPO` trim-or-default logic that also exists in `scripts/run-task/canon-snapshot.ts`.
- `layoutGate`/`dependencyGate` both independently re-derive `installRoot`/`package.json` existence semantics; could share one read.
- `formatAnnouncement`'s `targetVersion` parameter is computed for all channels but only read in the `stable` branch.

### Dismissed Cold Findings

- Dismissed (cold-Claude): "`realpathSync(projectRoot)` calls in `detectInstallType` are unwrapped and could throw an uncaught exception on a broken symlink/permission error, crashing with a raw stack trace instead of a clean `canon update: ...` message." — Verified real (no try/catch anywhere in the call chain, confirmed by reading `src/cli/index.ts`'s dispatch, which has no top-level handler either) but **not new to this round** — these `realpathSync` calls were introduced in round 1's AC-1 work, not by the AC-12 amendment, and no code in this round touches `detectInstallType`. Recorded here as a pre-existing robustness gap worth a follow-up nit, not a blocker for this round's amendment review.
- Dismissed (cold-Claude): "Windows-only `/node_modules/` forward-slash literal check silently never triggers the new pnpm nested-detection branch." — Verified the literal is forward-slash-only, but this exact pattern (`dir.lastIndexOf('/node_modules/')`) predates this task entirely (present in the pre-fix baseline) and is unrelated to the AC-12 amendment under review this round.
- Dismissed (cold-Claude): "Dist-consuming red-first tests could silently pass against stale compiled output if a contributor skips `npm run build` locally." — This is the spec's own explicitly accepted and documented tradeoff, not a gap: spec.md's Red-First Strategy section and Known Risks ("Stale local `dist/` can mislead the red-first test") name this exact risk and accept it, relying on CI's build-before-test ordering plus the reproducible-dist gate (AC-11).
- Dismissed (cold-Claude): "`CANONICAL_NPX_SOURCE` stays hardcoded to the canonical repo regardless of a `CANON_UPSTREAM_REPO` fork override, unlike every other resolution surface." — Spec Non-Goals explicitly states: "No change to the npx guidance path — the npx branch keeps its existing suggestion text." This is a documented Non-Goal, not an oversight.
- Dismissed (cold-Claude): "pnpm virtual-store layouts always hit a hard refusal, so `canon update` can never succeed for pnpm consumers." — This is round 2's finding, already adjudicated and operator-accepted via `canon task accept` (see above); not re-opened.
- Dismissed (cold-Claude): "No inter-process locking around npm install + provenance write." — Generic pre-existing risk of any CLI wrapping `npm install`, not introduced or widened in a materially new way by this task's changes; out of scope for this review.
- Dismissed (cold-Claude): "`result.signal` is discarded, so a killed-by-signal npm child can't be distinguished from a normal failure via the exit code alone." — Lens's own analysis confirms the actual exit-code fallback logic (`result.status ?? 1`) is correct; no live bug identified, self-flagged as low confidence.

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [x] **Changes requested** — the `GIT_SSH_COMMAND` override must default-rather-than-replace before this round's amendment ships; all other AC-12 mechanics are sound.
- [ ] Spec gap

---

## Round 4 — verifying iteration 2's response to round 3 (GIT_SSH_COMMAND fix)

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met (unchanged) | No relevant code changed this round. |
| AC-2 | Met (unchanged) | No relevant code changed this round. |
| AC-3 | Met (unchanged) | No relevant code changed this round. |
| AC-4 | Met (settled per round 2 operator accept — not re-litigated) | No relevant code changed this round. |
| AC-5 | Met (unchanged) | No relevant code changed this round. |
| AC-6 | Met (unchanged) | Re-verified: fresh `npm run build` is byte-identical to committed `dist/cli/index.js`; `STRICT_FINAL_TAG_RE` intact. |
| AC-7 | Met (unchanged) | No relevant code changed this round. |
| AC-8 | Met (unchanged) | No relevant code changed this round. |
| AC-9 | Met on written AC text, with a real but non-blocking edge case surfaced — see New Findings | Stable/main/ref/failed-no-write cases unchanged and solid. The global "invoking repo" branch's cwd-vs-repo-root behavior is real (see below) but not a regression introduced by this round's diff, and not a deviation from this codebase's existing convention. |
| AC-10 | Met (unchanged) | No relevant code changed this round. |
| AC-11 | Met | Re-confirmed independently by both lenses: fresh `npm run build` → zero-byte diff against committed `dist/cli/index.js`; `grep -c nonInteractiveSshCommand dist/cli/index.js` confirms the fix shipped in the committed bundle, not just source. |
| AC-12 | **Met** | Round 3's sole surviving code-bug — `defaultGitRunner` unconditionally overwriting a caller's `GIT_SSH_COMMAND` — is fixed. `nonInteractiveSshCommand()` (`src/cli/commands/update.ts:78-89`) composes with any existing caller command: normalizes an existing compact (`-oBatchMode=...`) or split (`-o BatchMode=...`) flag to `yes` in place, or appends `-oBatchMode=yes` when absent, rather than replacing the command outright. Directly tested (`tests/cli.test.ts:588-606`) with a custom `GIT_SSH_COMMAND=ssh -i /tmp/canon-key` composing to `ssh -i /tmp/canon-key -oBatchMode=yes`. |

### Verifying Round 3's finding

- _code-bug:_ "`defaultGitRunner` unconditionally overwrote a caller's `GIT_SSH_COMMAND`" → **fixed**, verified independently by both lenses and by the foreman directly reading `src/cli/commands/update.ts:78-89` and its dedicated test (`tests/cli.test.ts:594-605`) ✓

### New findings

No code-bugs survive this round. One cross-lens-flagged item was investigated in depth and is recorded below as a non-blocking finding rather than a code-bug, because it turned out to be consistent with this codebase's existing convention rather than a deviation from it — see the adjudication under Dismissed Cold Findings.

### Non-blocking finding (verified real, deferred — not a code-bug, not blocking this round)

- **[deferred, flagged by 3 lenses: cold-Codex + anchored + cold-Claude] Global-install provenance write checks `existsSync(join(cwd, '.canon'))` using the literal invocation `cwd`, never walking up to the invoking repository's actual root — `src/cli/commands/update.ts:489-497`.** A global `canon update` run from a nested subdirectory of a repo whose `.canon/` lives at the repo root (e.g. `/repo/packages/app` when `.canon` is at `/repo/.canon`) prints "no `.canon/` directory found in the current repo... run `canon init` here first" and skips the write, even though the invoking repo does have a provenance home a few levels up. Verified real: `tests/cli.test.ts:837-869` only exercises `.canon` present-or-absent directly at the passed `cwd`, never an ancestor case.

  **Adjudication — the anchored lens and cold-Claude disagreed on a factual point, and the foreman independently checked the codebase to resolve it.** The anchored lens initially classified this as a code-bug, citing `doctor.ts:358`'s `git rev-parse --show-toplevel` as "the codebase's established convention" for resolving a repo root from an arbitrary cwd. The foreman verified this claim directly: `doctor.ts:358`'s repo-root resolution is scoped *only* to `checkCodexProjectTrust()` (a Codex trust-config check unrelated to `.canon`) — every actual `.canon`-scoped check in the same file (`checkTemplates`, `checkCanonVersion`, `checkRecommendedPermissions`, etc.) operates on `join(cwd, '.canon', ...)` directly, with no upward walk, exactly like the code under review. `init.ts:71` and `upgrade.ts:543` do the same (`process.cwd()` passed straight through, no repo-root resolution). So this diff's global-provenance branch is **consistent with every existing sibling canon command's actual behavior**, not a deviation from an established pattern — cold-Claude's read of the codebase was the accurate one.

  Given that, this is not classified as a code-bug (nothing here is "wrong" relative to how every other canon command already behaves) nor escalated to a spec-gap halt (the blast radius is low: a write-only file that "nothing reads yet" per the spec, worst case a mildly-wrong hint text, not a wrong mutation). Per this file's own Foreman Rules of Thumb — "a cross-cutting invariant belongs in one shared helper, not patched per call site... at ≥3 sites, extract the shared helper" — `init.ts`, `upgrade.ts`, and `doctor.ts`'s `.canon` checks are already 3 existing sites sharing this identical cwd-literal limitation; patching only `update.ts`'s new call site in isolation would be scope creep beyond this task and would leave the other three sites inconsistent. This belongs as a dedicated cross-cutting backlog item (repo-root resolution for all `.canon`-scoped canon commands), not a fix owned by this task alone. Recorded here for backlog, not blocking this round.

### Dismissed Cold Findings

- Dismissed (cold-Claude): "`nonInteractiveSshCommand`'s BatchMode regexes are non-global, so only the first occurrence of an existing `-oBatchMode=...`/`-o BatchMode=...` flag is normalized; a later duplicate flag could win depending on ssh's option-precedence rules." — Investigated: OpenSSH's documented precedence rule (`ssh_config(5)`: "for each parameter, the first obtained value will be used") means the *first* occurrence of a repeated keyword-style option wins, not the last — so forcing only the first occurrence to `yes` is the objectively correct behavior for guaranteeing it takes effect, not a gap. Not a bug.
- Dismissed (cold-Claude, narrower residual concern from the same finding): "Oddly-quoted or unusually-spaced existing `BatchMode` settings (e.g. `-o 'BatchMode=no'`) match neither regex and fall through to blind appending, which — given first-wins semantics — would lose to an earlier conflicting setting." — Real in principle but extremely low-probability (requires a caller to have deliberately set `BatchMode=no` via an unusual quoting form in their own `GIT_SSH_COMMAND`) and low severity (worst case reproduces the pre-existing hang risk for an exotic, self-inflicted configuration, not a new regression for any normal setup). Recorded as a nit, not blocking.
- Dismissed (cold-Claude): "Local install's `writeProvenance` unconditionally creates `.canon/` while the new global branch gates on `existsSync('.canon')` — inconsistent guard." — Recurrence of a Round 1 finding already dismissed with citation: Spec Decision item 8 / AC-9 explicitly directs this asymmetry (local installs are already gated by AC-3's dependency-listing check as the "opt-in" signal; global installs have no equivalent signal). Not re-opened.
- Dismissed (cold-Claude): "`CANONICAL_NPX_SOURCE` stays hardcoded regardless of a `CANON_UPSTREAM_REPO` fork override, unlike the resolver/npm/provenance paths." — Recurrence of a Round 3 finding already dismissed with citation: spec Non-Goals explicitly states "No change to the npx guidance path." Not re-opened.
- Dismissed (cold-Claude): "pnpm virtual-store detection lands `installRoot` on the wrong directory, making `canon update` effectively unusable for pnpm consumers." — This is round 2's finding, already adjudicated and operator-accepted via `canon task accept`. Not re-opened.
- Dismissed (cold-Claude): "`writeProvenance` isn't atomic (no write-to-temp-then-rename), so a kill mid-write could corrupt `provenance.json`." — Pre-existing code from round 1, unchanged by this round's diff; low severity for a write-only, not-yet-read file; out of scope for this round.
- Dismissed (cold-Claude): "`installRoot` typed `string | null` but cast `as string` at two call sites rather than the type system enforcing non-null for the `'local'` variant." — Pre-existing typing nit from round 1, unchanged by this round's diff, no live bug (every `'local'`-typed return path does populate it).
- Dismissed (cold-Claude): "Sequential HTTPS-then-SSH `ls-remote` attempts can take up to ~60s combined on a fully unreachable network." — Accurate but not a bug; this is the amendment's own explicitly specified fallback design (spec Amendment: "attempts the https transport first; on any failure it retries... over the SSH transport"), not a new gap.
- Dismissed (cold-Claude): "Failure messages fall back to `'no output'` when `stderr` is empty, missing diagnostics some git/auth failures write to stdout instead." — Low confidence, low severity, speculative; no concrete git/auth failure mode demonstrated that actually writes to stdout instead of stderr for `ls-remote`.

### Verdict for this round

- [ ] Approved
- [x] **Approved with nits** — the round 3 `GIT_SSH_COMMAND` fix is correct and well-tested; no surviving code-bugs or blocking spec gaps. The global-provenance cwd-vs-repo-root behavior is real but consistent with this codebase's existing convention across every sibling canon command — recorded as a deferred cross-cutting backlog item, not a blocker for this task.
- [ ] Changes requested
- [ ] Spec gap

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.

## Round N — verifying iteration N-1's response to round N-1

### Stage 1 — Acceptance Criteria Re-Check

Re-fill this table with every AC from spec.md against the latest code. Earlier AC tables were snapshots of earlier iterations, not reusable proof. ACs whose relevant code paths did not change may be marked `Met (unchanged from round N-1)` with a one-line evidence pointer.

| AC | Status | Notes |
|---|---|---|
| AC-1: ... | Met / Partial / Not Met | ... |
| AC-2: ... | Met / Partial / Not Met | ... |

### Verifying Round N-1 findings

- _correctness bug:_ "<one-line summary>" → addressed (file:line; AC-N now Met in table above) ✓ / still open / no longer relevant
- _risk/guardrail:_ ... → ...

### New findings (only NEW issues introduced by Iteration N's changes)

(none / list)

### Verdict for this round

- [ ] Approved
- [ ] Approved with nits
- [ ] Changes requested
- [ ] Spec gap

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->
