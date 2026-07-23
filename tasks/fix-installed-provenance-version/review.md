# Code Review: fix-installed-provenance-version

> Reviewer: Claude | Spec: `tasks/fix-installed-provenance-version/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

The anchored review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

Did Codex's `handoff.md` pass all applicable checks?

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens independently reran `npm run lint`, `npm run type-check`, `npm test` (1027 pass), `npm run docs-refs-check`, `npm run sync-templates:check`, and `npm run build` (dist rebuilds byte-identical) — all green, matching handoff's Validation Outcomes table.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Pass | `canon-snapshot.ts:89-91`; installed-package test asserts `<unavailable>` and rejects the adopter SHA. |
| AC-1b | Pass | `orchestrator_commit = hostCommit ?? drivingCommit` (adopter commit) preserved; `upstream_repo` slug and `CANON_UPSTREAM_REPO` override both unaffected by the `isInstalled` branch. |
| AC-2 | Pass | Regression test named for #196; asserts fixed unavailable/version behavior. Reasoned red-first: the pre-branch code ignores the new `canonSourcePath`/`canonVersion` seam and falls through to the native path, stamping adopter HEAD — the test would fail against that prior behavior. |
| AC-3 | Pass | `resolveCanonVersion`; explicit released-version test and unset-env `dev`-fallback test both present. |
| AC-4 | Pass | Native (else) branch unchanged; existing native test extended with a version assertion. |
| AC-4b | Pass | Linked-worktree source path classifies as native; canon commit is a real commit, not `<unavailable>`. |
| AC-5 | Pass | Vendored branch unchanged; existing vendored test extended with a version assertion. |
| AC-5b | Pass | Installed-inside-submodule-adopter fixture: canon commit `<unavailable>` (distinct from both adopter and host SHA), `orchestrator_commit` = host SHA. |
| AC-6 | Pass | Refresh test: canon identity (repo slug, `<unavailable>`, version) stable across two refreshes with different adopter commits; `orchestrator_commit` tracks the adopter. |
| AC-7 | Pass | `.canon/templates/status.json` and its `templates/` mirror both gain `canon_version`; `sync-templates:check` passes. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work) — no SHA-baking, no `provenance.json` (under `.canon`) consumption, no `canon doctor` cross-check work attempted.
- [x] Known Risks addressed or documented as accepted — linked-worktree (AC-4b) and adopter-as-submodule (AC-5b) misclassification risks both have dedicated regression tests; install-layout coverage matches the spec's named layouts (local `node_modules`, `_npx`); `dev`-leakage risk is exercised by the fallback test.
- [x] Human Test Plan is satisfiable by the implementation — installed mode shows version + `<unavailable>`, refresh doesn't perturb canon identity, native/vendored unchanged aside from the new version field.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean, well-scoped implementation. The classification order (installed-package → vendored → native) matches the Implementation Notes precisely, and the trickiest cases called out in Known Risks — linked-worktree-stays-native and installed-inside-submodule-adopter — each have a purpose-built regression test. Both cold lenses (Claude and Codex) independently signaled approve; no cross-model agreement on any blocking defect. Surviving findings are all nits or explicitly-acknowledged pre-existing patterns.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- `scripts/run-task/canon-snapshot.ts:29` (`resolveCanonVersion`) — `explicit ?? process.env.CANON_VERSION ?? 'dev'` doesn't guard against an empty-string `CANON_VERSION`, unlike the sibling `upstream_repo` handling a few lines below (`process.env.CANON_UPSTREAM_REPO?.trim()` then a truthy check before falling back to the const). If `CANON_VERSION` is ever exported as `""`, `canon_version` would stamp as `""` instead of falling through to `'dev'`. (Flagged by cold-Claude.) Not a spec violation — the Implementation Notes prescribe exactly this expression (`process.env.CANON_VERSION ?? 'dev'`, "the same expression `bakedVersion()` uses") — and `bakedVersion()` in `src/cli/commands/update.ts` has the identical gap, so this is a pre-existing, spec-sanctioned pattern rather than a new defect. Worth a follow-up guard if it's ever tightened, not blocking here.
- `scripts/run-task/canon-snapshot.ts:22-25` (`isInstalledSourcePath`) duplicates the segment-matching logic already present in `detectInstallType` (`src/cli/commands/update.ts`). The spec's own Implementation Notes explicitly sanctioned this ("Reuse the underlying segment predicate (extract or duplicate the small check)"), so this is accepted duplication debt, not a defect. (Flagged by anchored lens.)
- `scripts/run-task/canon-snapshot.ts:81-85` — `superprojectWorkingTree`/`hostCommit` are computed unconditionally even for the common installed-package case where the adopter isn't itself a submodule, costing one discarded git invocation. Harmless; needed for AC-5b. (Flagged by anchored lens.)
- Compiled `resolveCanonVersion` in `dist/cli/index.js` / `dist/scripts/run-task.js` is `explicit ?? "2.3.0" ?? "dev"` — the `'dev'` fallback is dead code in the shipped artifact once tsup's `define` (`tsup.config.ts`: `define: { 'process.env.CANON_VERSION': JSON.stringify(version) }`) substitutes a literal version string at build time. Verified this exactly mirrors the pre-existing `bakedVersion()` pattern — expected, not a new bug. (Flagged by both cold-Claude and anchored lens; verified against `tsup.config.ts` and confirmed not a regression.)
- `isInstalledSourcePath`'s `node_modules`/`_npx` segment check doesn't cover Yarn Plug'n'Play installs (no `node_modules` directory at all). A PnP-installed canon would misclassify as native and revert to the pre-fix behavior of stamping the adopter's commit. (Flagged by cold-Claude, low confidence.) Real edge case, but PnP is not among the install layouts the spec's Known Risks section names ("Local `node_modules`, pnpm nested/virtual stores, global npm installs, and `npx` caches") — out of the contracted scope for this task, not a violation of any AC. Noted for a future install-layout-coverage follow-up rather than blocking here.

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Claude): "compiled `resolveCanonVersion`'s `'dev'` fallback is unreachable dead code in `dist/`, possibly indicating an unintentional build-time substitution" - verified against `tsup.config.ts`'s `define` config and the pre-existing `bakedVersion()` pattern in `src/cli/commands/update.ts`; the substitution is deliberate and matches an established, already-shipped pattern. Retained above as a nit for completeness, not dismissed as invalid, but confirmed not a bug.
- Dismissed (cold-Claude): "`hostCommit` computed once from `|| '<unavailable>'`, so a transient host-git failure in the installed+submodule-adopter path yields `'<unavailable>'` for `orchestrator_commit` instead of falling back to `drivingCommit`" - this exact fallback shape (`captureGitOutput(...) || '<unavailable>'`) is pre-existing vendored-mode behavior, unchanged by this diff; not a regression introduced here and out of this task's scope (vendored/host-commit resolution is explicitly unchanged per spec's Non-Goals).

Cold-Codex surfaced no findings beyond a general approval statement ("The changes correctly distinguish installed-package execution from native and vendored modes, preserve adopter provenance, and record canon version information. The test suite passes.") — no cross-model agreement to reconcile against any blocking claim.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

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
