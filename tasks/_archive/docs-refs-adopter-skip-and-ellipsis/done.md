# QA Summary: docs-refs-adopter-skip-and-ellipsis

## What Changed

`scripts/docs-refs-check.mjs` (and its `templates/` mirror) gained two improvements surfaced during a GP adoption session where canon's stricter gate flagged 38 false positives that GP's prior local script had intentionally skipped:

**1. Adopter-extensible skip surface (`NOISY_SOURCE_PATHS`)**

A new top-level `const NOISY_SOURCE_PATHS = [];` constant was added immediately after the existing `VALID_DIRS` block, with an adopter-edit comment matching the established `VALID_DIRS` style. Adopters fill this array after `canon upgrade` to suppress archive trees, frozen quarterly reviews, or append-only logs that accumulate stale refs by design.

Match semantics:
- Exact file match: `'docs/changelogs.md'` skips only that file
- Directory prefix: `'docs/archive'` skips every file under `docs/archive/`
- Trailing-slash normalization: `'docs/archive/'` and `'docs/archive'` behave identically

`runChecks()` gains an optional second parameter — `runChecks(repoRoot, { skipPaths })` — so tests can inject skip lists without mutating module state. `NOISY_SOURCE_PATHS` is also exported so one dedicated test can prove the no-options runtime path reads the module-level array.

**2. Ellipsis placeholder (`...`)**

`isPlaceholderTarget()` now short-circuits for any target whose string contains `...`. A ref like `` `src/...` `` is treated as a placeholder and produces no finding.

**Files changed:**

| File | What Changed |
|---|---|
| `scripts/docs-refs-check.mjs` | `NOISY_SOURCE_PATHS` constant + comment; `isNoisySourceFile` extended with skip-path matching; `isPlaceholderTarget` ellipsis short-circuit; `runChecks` optional options seam; `NOISY_SOURCE_PATHS` exported |
| `templates/scripts/docs-refs-check.mjs` | Same edits mirrored; pre-existing drift in noisy-source carve-outs untouched |
| `scripts/docs-refs-check.mjs.d.ts` | `runChecks` signature updated with optional `options` param; `NOISY_SOURCE_PATHS` declared as mutable `string[]` |
| `tests/docs-refs-check.test.ts` | Five new test cases covering directory-prefix skip, exact-file skip, trailing-slash normalization, ellipsis placeholder, and the default-array fallback path |

**Deviation noted in handoff:** Task artifact files (`notes.md`, `spec-review.md`) are scanned by the repo-root docs-refs gate even though `spec.md`/`plan.md` are exempt. Codex cleaned backtick refs to nonexistent fixture paths from those artifacts to satisfy AC-7.

## How to Test

1. From the repo root, run `node scripts/docs-refs-check.mjs`. Expected: exits 0 with `All refs OK` — canon's own tree is unaffected because the default skip list is empty and no ellipsis paths exist.
2. Run `npm test`. Expected: all 445 tests pass (plus 1 pre-existing expected skip). Five new test cases are in `tests/docs-refs-check.test.ts`.
3. Run `npm run lint` and `npm run type-check`. Both pass.
4. Open `scripts/docs-refs-check.mjs` and confirm `NOISY_SOURCE_PATHS = []` appears after `VALID_DIRS` with an adopter-edit comment, and that `isPlaceholderTarget` has an explicit `...` short-circuit.
5. Open `templates/scripts/docs-refs-check.mjs` and confirm the same two surfaces are present. Pre-existing differences in the noisy-source exemption block are expected.

Optional smoke test: temporarily add a top-level docs directory to `NOISY_SOURCE_PATHS` (e.g., `'docs/decisions'`) and rerun the docs-refs gate. Expected: still passes with those files skipped. Try with and without a trailing slash — both should behave identically. Revert before committing.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass (445 pass, 1 expected skip) |
| `node scripts/docs-refs-check.mjs` | Pass (All refs OK) |
| Full build | N/A — script not part of tsup bundle |
| End-to-end tests | N/A — no UI surface |

## Decisions Made

- **`NOISY_SOURCE_PATHS` stays `[]` upstream.** GP-specific paths (archive trees, frozen reviews) are not pushed into canon's default. Adopters fill the array for their own conventions after `canon upgrade`.
- **Ellipsis short-circuit is `target.includes('...')` — not a per-segment check.** This catches `src/...`, `<dir>/.../file.ts`, and any other ellipsis-bearing shape. Broader than per-segment matching, which is the point.
- **Per-call options seam preferred over exported-mutable state.** `runChecks(root, { skipPaths })` is isolated by construction — tests don't need `try`/`finally`. The `NOISY_SOURCE_PATHS` export exists only to let one test prove the no-options runtime path is wired; it's not a general-purpose tuning interface.
- **Pre-existing `templates/`-vs-root drift untouched.** The `canon-docs-dedup` task owns reconciling that drift. This task added identical new code to both copies and left the pre-existing difference in place, per AC-5.

## Open Questions

None. All ACs met, all validation passed.

---

## Proposed Changelog

**Target version:** 1.5.0 (unreleased)

**Rationale:** New adopter-facing configurable surface on the `docs-refs-check` script (`NOISY_SOURCE_PATHS`) plus a new placeholder class recognized (ellipsis). Both are additive features visible to any adopter running the gate. Minor bump.

**Proposed entries for `## [1.5.0]` → `### Added`:**

- **`docs-refs-check` adopter skip-path surface.** A new `NOISY_SOURCE_PATHS` constant (initialized empty, placed after `VALID_DIRS`) lets adopters declare paths to exclude from the broken-ref gate after `canon upgrade`. Entries match by exact file path (`'docs/changelogs.md'`) or directory prefix (`'docs/archive'` covers every file under that tree). Trailing slashes are normalized, so `'docs/archive/'` and `'docs/archive'` behave identically. The gate's built-in canon-universal exemptions are unchanged.
- **`docs-refs-check` treats ellipsis (`...`) as a placeholder.** Backtick refs containing `...` (e.g., `` `src/...` ``) are now recognized as placeholder patterns and produce no finding. Extends the existing `<placeholder>` and `[placeholder]` handling.
