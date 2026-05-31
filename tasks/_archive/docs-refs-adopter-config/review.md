# Code Review: docs-refs-adopter-config

> Reviewer: Claude | Spec: `tasks/docs-refs-adopter-config/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Review runs in two stages on the first round. **Stage 1 is a gate.** If it fails, skip Stage 2 entirely and send back — do not write code-quality findings against code that's about to change.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results — all Pass; `E2E` correctly `not_configured`
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: No config → byte-identical findings | Met | `mergeAdopterConfig(null)` preserves canon defaults; existing 669-test suite passed unchanged. |
| AC-2: `noisySourcePaths` skips archive only when configured | Met | `tests/docs-refs-check.test.ts:373-405`. |
| AC-3: `validDirs: ['infra']` validates infra refs only when configured | Met | `tests/docs-refs-check.test.ts:407-425`. |
| AC-4: `markdownRootDirs: ['documentation']` walks new dir only when configured | Met | `tests/docs-refs-check.test.ts:427-445`. |
| AC-5: Malformed config → defaults, no throw | Met | `tests/docs-refs-check.test.ts:447-479`; syntax-error and wrong-shape fixtures both return null. |
| AC-6: Canon defaults exclude `templates`; canon-ai-dev config re-adds it | Met | `CANON_VALID_DIRS` at `scripts/docs-refs-check.mjs:34` excludes `templates`; `scripts/docs-refs-config.mjs` re-adds it; `tests/docs-refs-check.test.ts:354-366` asserts both. |
| AC-7: `VALID_DIRS` (Set) and `NOISY_SOURCE_PATHS` (array) still exported with merged values | Met | Exported at `scripts/docs-refs-check.mjs:124-125`; `.d.ts` updated; type-check passes. |
| AC-8: Pre-split → scaffold config, defer checker, emit cutover indicator | Met | `tests/cli.test.ts` "pre-split docs-refs checker scaffolds config and defers checker upgrade". |
| AC-9: Post-cutover → checker upgrades normally, no re-cutover | Met | `tests/cli.test.ts` "after config exists, docs-refs checker upgrades normally and does not re-cutover". |
| AC-10: `--check` plans without writing; dirty/`--force` semantics apply | Met | Two `tests/cli.test.ts` cases cover `--check` and dirty-refusal/`--force`. |
| AC-11: `docs-refs-config.mjs` absent from `CANON_OWNED`/`DELIMITED`; sync-templates:check passes | Met | `src/lib/canon-owned.ts` confirmed: neither path listed; handoff reports sync-templates:check Pass. |
| AC-12: `docs/architecture.md` and `docs/codebase-map.md` updated; docs-refs-check passes | Met | Both updated in diff; docs-refs-check Pass in handoff. |

### Dropped Sections Check

- [x] Non-goals respected — "revert hint fix", "auto-migrating literals", "adding new carve-outs", "changing validator logic", "CI/doctor wiring", "general config schema" are all absent from the diff
- [x] Known Risks addressed — cutover detection tested (AC-8/9); `templates` removal guarded by canon-ai-dev config + AC-6 test; async load resolved via top-level await; `--check` covered by AC-10; base-drift allow-list complete in spec Affected Files
- [x] Human Test Plan satisfiable — implemented behavior maps to all 8 steps

### Stage 1 Verdict

- [x] **Pass** — proceeding to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Clean implementation. The loader/merge/cutover design matches the spec's behavioral contract: the checker module holds canon defaults, loads a sibling config at module init via top-level await, merges additive sets, and exports the effective values. The upgrade cutover correctly halts, scaffolds, and defers in one pass. Test coverage is thorough and direct. One risk/guardrail finding below — not blocking.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

**`loadAdopterConfig` silently abandons ALL config when any single export is missing or wrong-type** — `scripts/docs-refs-check.mjs:110-113`:

```js
if (!noisySourcePaths || !validDirs || !markdownRootDirs) return null;
```

If an adopter removes one of the three exports from their config (e.g., prunes the file to only `noisySourcePaths`), `loadAdopterConfig` returns `null` and `mergeAdopterConfig(null)` produces bare canon defaults — silently discarding the adopter's skip entries. The spec says "may export `noisySourcePaths`, `validDirs`, and `markdownRootDirs`" (each optional independently), but the loader treats them as all-or-nothing.

`mergeAdopterConfig` already handles partial objects correctly (each absent key falls back to `[]`), so `loadAdopterConfig` could return a partial config object and let `mergeAdopterConfig` resolve defaults. The current behavior means any adopter who deletes an export gets silent no-op behavior on the remaining ones.

Real-world impact is low — the scaffold always provides all three — but the failure mode is silent, which is exactly the bug class this task was designed to prevent. Not blocking given the scaffold constraint, but note the asymmetry with `mergeAdopterConfig`'s design.

#### Optional Cleanup / Nit

(none)

#### Spec Gaps

(none)

## Final Verdict

- [x] **Approved with nits** — ship after addressing optional items (or not)

The one risk/guardrail (all-or-nothing `loadAdopterConfig` vs. spec's "may export" language) is non-blocking and low-risk given the scaffold always provides all three exports. Human may ship as-is or ask Codex to relax to per-export validation.

---

<!--
On re-review, append below this line:

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
- [ ] Needs re-review

> Round 3+: findings must be `correctness bug` or `spec gap` only — no `optional cleanup/nit` and no wording-only changes. We are tightening, not exploring.
-->

## Round 2 — verifying Iteration 2's response to round 1

### Stage 1 — Acceptance Criteria Re-Check

| AC | Status | Notes |
|---|---|---|
| AC-1: No config → byte-identical findings | Met (unchanged from round 1) | `mergeAdopterConfig(null)` path untouched; 673-test suite passes. |
| AC-2: `noisySourcePaths` skips configured tree only | Met (unchanged from round 1) | `tests/docs-refs-check.test.ts:373-405`. |
| AC-3: `validDirs` enables infra refs only when configured | Met (unchanged from round 1) | `tests/docs-refs-check.test.ts:407-425`. |
| AC-4: `markdownRootDirs` walks custom dir only when configured | Met (unchanged from round 1) | `tests/docs-refs-check.test.ts:427-445`. |
| AC-5: Malformed config → defaults, no throw | Met (unchanged from round 1) | `tests/docs-refs-check.test.ts:447-488`; thin-loader now lets `mergeAdopterConfig` be the single validator — wrong-shape compares equal to `mergeAdopterConfig(null)`. |
| AC-6: Canon defaults exclude `templates`; canon-ai-dev config re-adds | Met (unchanged from round 1) | `tests/docs-refs-check.test.ts:354-366`; `npm run docs-refs-check` passed. |
| AC-7: `VALID_DIRS` (Set) and `NOISY_SOURCE_PATHS` (array) exported with merged values | Met (unchanged from round 1) | `scripts/docs-refs-check.mjs` exports both; `.d.ts` updated; type-check passes. |
| AC-8: Pre-split + absent config → scaffold, defer, cutover indicator | Met (unchanged from round 1) | `tests/cli.test.ts:1104-1161`. |
| AC-9: Config exists → checker upgrades normally, no re-cutover | Met (unchanged from round 1) | `tests/cli.test.ts:1226-1285`. |
| AC-10: `--check` plans without writing; dirty/`--force` apply | Met (unchanged from round 1) | `tests/cli.test.ts:1351-1427`. |
| AC-11: Config absent from `CANON_OWNED`/`DELIMITED`; sync-templates:check passes | Met (unchanged from round 1) | `src/lib/canon-owned.ts` unchanged; sync-templates:check Pass. |
| AC-12: Docs updated; docs-refs-check passes | Met (unchanged from round 1) | diff confirms both docs updated; docs-refs-check Pass. |
| AC-13: CLI loads config from `<repoRoot>`, not checker install location | Met | `tests/docs-refs-check.test.ts:553-575` — temp repo with distinct `validDirs`/`markdownRootDirs`; CLI exits 1 for the broken ref; assertion confirms target repo's config was used. |
| AC-14a: New-checker + absent config → scaffold config, no defer, checker upgrades this run | Met | `tests/cli.test.ts:1162-1224` — asserts `cutoversDeferred = []`, config and checker both in `upgraded`. |
| AC-14b: Pre-split + absent config → scaffold, defer, message | Met | AC-8 test is this case; unchanged. |
| AC-14c: Pre-split + present config → normal upgrade, no scaffold, no defer | Met | `tests/cli.test.ts:1226-1285` — pre-split checker + existing config; asserts `cutoversDeferred = []`, checker in `upgraded`, config not in `upgraded`. |
| AC-14d: New-checker + present config → normal upgrade, no scaffold, no defer | Met | `tests/cli.test.ts:1287-1349` — asserts `cutoversDeferred = []`, config not in `upgraded`. |
| AC-15: `main()` async; CLI exits with numeric code | Met | `main().then(code => { process.exitCode = code; })` at module tail; `.d.ts` declares `Promise<number>`; existing CLI spawn tests (exit-0 / exit-1) still pass. |

### Verifying Round 1 findings

- _risk/guardrail:_ `loadAdopterConfig` all-or-nothing vs. spec "may export" → addressed by switching to a thin pass-through loader; `mergeAdopterConfig` is now the single per-key validator and coerces absent/non-array keys to `[]` rather than discarding the whole config object. New test `partial config file: a single exported array is honored, not dropped` (`tests/docs-refs-check.test.ts:490-515`) pins the behavior. ✓

### New findings

**optional cleanup/nit** — `printDocsRefsCutover` message references `'see "Updated" above'` but under `--check` the config appears in the "Would upgrade:" section, not an "Updated:" section (`src/cli/commands/upgrade.ts:353-362` / `dist/cli/index.js:3702-3705`). The mismatch is advisory-text-only and does not affect correctness or the adoption flow. Deferred at reviewer discretion.

### Verdict for this round

- [x] **Approved with nits**

All 15 ACs met (12 original + 3 amendment). Round 1 risk/guardrail addressed. Nit is advisory text under `--check` only; does not block shipment.
