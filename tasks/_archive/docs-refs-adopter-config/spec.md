# Spec: docs-refs-adopter-config — Move adopter-tunable docs-refs-check arrays into a non-clobbered config file

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

`scripts/docs-refs-check.mjs` is in `CANON_OWNED` (`src/lib/canon-owned.ts:18`), so `canon upgrade` overwrites it wholesale from the `templates/` mirror. But the script contains three arrays whose own comments instruct adopters to **edit them after `canon upgrade`**:

- `NOISY_SOURCE_PATHS` (`scripts/docs-refs-check.mjs:60`) — adopter skip-list for historical/append-only doc trees.
- `VALID_DIRS` (`scripts/docs-refs-check.mjs:39`) — top-level dir allow-list. (`AGENTS.md:188` even cites this as *the* canonical "docs gate" symbol.)
- `MARKDOWN_ROOT_DIRS` (`scripts/docs-refs-check.mjs:63`) — which root dirs get walked for markdown sources.

"Wholesale-owned file" and "adopters edit this after upgrade" are contradictory: every `canon upgrade` silently drops the adopter's additions. The failure is on a slow fuse — `docs-refs-check` still passes on the upgrade commit because the lost entries only surface as broken-ref errors when a *future* file lands under one of the dropped paths, producing green-CI-on-upgrade / red-CI-a-week-later skew.

Concrete: GP (`tstraub89/gallery_wall`) ran `canon upgrade` 2026-05-25 and lost its `NOISY_SOURCE_PATHS` entries. It failed safe that time (no broken refs *yet*), but the structural bug is intact. Tracked at `docs/BACKLOG.md:519`.

(The companion bug — `canon upgrade`'s "Revert: `git checkout -- <file>`" hint being wrong for staged files — was fixed inline separately and is **out of scope** here; see Non-Goals.)

## Decision

Move the three adopter-tunable arrays out of the canon-owned script into a separate **adopter-owned** config module, `scripts/docs-refs-config.mjs`, that `canon upgrade` never overwrites. The canon-owned `docs-refs-check.mjs` keeps canon-universal **defaults** baked in, optionally loads the sibling config, and uses the **union** of the two. The config file is scaffolded once (by `canon init`) and owned by the adopter forever after.

Behavioral contract (the *what*, not the *how* — mechanics deferred to plan):

1. **Adopter config is optional and additive.** `scripts/docs-refs-config.mjs`, if present beside the script, may export `noisySourcePaths`, `validDirs`, and `markdownRootDirs` (string arrays). The effective value of each is `canon_default ∪ adopter_value` (order-independent union; dedup). A missing or malformed config degrades to canon defaults with **no throw and no crash** — `docs-refs-check` must run identically to today on a repo with no config file.

2. **Canon defaults live in the script; canon-ai-dev's own additions live in canon-ai-dev's config.** The script's baked-in defaults are the canon-universal sets: `validDirs` = `{src, scripts, tests, docs, public, tasks, .github, .canon, .claude, .codex}` (**`templates` removed** — adopters have no `templates/` dir); `markdownRootDirs` = `{docs, tasks}` (**`templates` removed**); `noisySourcePaths` = `[]`. canon-ai-dev's committed `scripts/docs-refs-config.mjs` re-adds `templates` to `validDirs` and `markdownRootDirs`, so canon-ai-dev's own `npm run docs-refs-check` still walks and validates `templates/` exactly as today.

3. **Exported symbols are preserved.** `docs-refs-check.mjs` continues to export `VALID_DIRS` and `NOISY_SOURCE_PATHS`, now holding the *effective* (merged) values, so the `.d.ts`, the test import, and the `AGENTS.md:188` ref stay valid.

4. **`canon init` scaffolds the config for free.** Placing `templates/scripts/docs-refs-config.mjs` (canon-universal defaults, no `templates`, empty skip-list, with explanatory comments) in the `templates/` tree means `scaffoldTemplates` (`src/cli/commands/init.ts`) copies it into new adopters' `scripts/` automatically. No `init.ts` change required.

5. **`canon upgrade` performs a safe cutover (halt, never silent-overwrite) for existing adopters.** When upgrade detects the pre-split shape — the project's current `scripts/docs-refs-check.mjs` does **not** import `./docs-refs-config.mjs` **and** `scripts/docs-refs-config.mjs` does not yet exist — it:
   - (a) scaffolds `scripts/docs-refs-config.mjs` from the canon default (routed through the same pending-write machinery as every other managed write, so `--check` / dirty-refusal / `--force` / `--no-stage` stay uniform);
   - (b) does **not** overwrite `scripts/docs-refs-check.mjs` this run, so the adopter's current customizations remain on disk as the migration source;
   - (c) prints an actionable message: move any custom `NOISY_SOURCE_PATHS` / `VALID_DIRS` / `MARKDOWN_ROOT_DIRS` entries from the current `docs-refs-check.mjs` into the new `docs-refs-config.mjs`, then re-run `canon upgrade` to finish updating the script. (Adopters with no customizations just re-run.)
   On the next run the config exists → cutover condition is false → `docs-refs-check.mjs` upgrades normally. **No parsing of the adopter's array literals; no silent data loss.**

**Key decision to confirm at spec gate (migration shape):** I chose the *safe-halt* cutover (#5) over the two alternatives the BACKLOG floated. **Auto-extraction** (parse the adopter's old array literals and write them into the new config) is rejected: parsing JS literals in `canon upgrade` is brittle, and a mis-parse silently drops entries — reproducing the exact bug class on the cutover. **Doc-only** (just document the manual move, no upgrade change) is rejected: it leaves the slow-fuse silent overwrite intact for any future adopter. The safe-halt is ~the same code as auto-extraction, has zero silent-loss failure mode, and the only cost is one extra `canon upgrade` re-run at the cutover. If you'd rather ship the core split (config extraction + init scaffold, AC-1…AC-7) and drop the upgrade-side migration (AC-8…AC-10) — relying on a one-time manual config creation for the single known adopter (GP) — say so and I'll carve it out.

## Non-Goals

- **The "Revert: `git checkout -- <file>`" hint fix.** Already corrected inline in `src/cli/commands/upgrade.ts` (now `git checkout HEAD -- <file>`); not part of this task.
- **Auto-migrating array literals by parsing the old script.** Explicitly rejected (see Decision); the cutover is a halt, not a parser.
- **Adding new canon-universal carve-outs** (e.g. the `isNoisySourceFile` exemptions for `docs/BACKLOG.md`, templates, task artifacts). Those stay hardcoded in the script — they are canon-universal, not adopter-tunable. This task only relocates the *adopter-tunable* arrays.
- **Changing what `docs-refs-check` validates** (the four ref classes, gitignore-skip, placeholder handling). Pure relocation + load/merge + cutover; the checking logic is unchanged.
- **New CI/`canon doctor` wiring.** Out of scope.
- **A `config.json`-style general canon config schema** (`docs/BACKLOG.md:352`). This is a single-purpose `.mjs` config, not the start of a general config system.

## Acceptance Criteria

Checklist of verifiable outcomes. Each item must be testable.

- [ ] AC-1: With **no** `scripts/docs-refs-config.mjs` present, `runChecks(repoRoot)` produces byte-identical findings to today on the same input (defaults applied; no throw). *(Verify: existing `tests/docs-refs-check.test.ts` suite still passes unchanged.)*
- [ ] AC-2: With a config exporting `noisySourcePaths: ['docs/archive']`, a broken ref inside `docs/archive/**` is skipped while a broken ref outside it is still reported. *(Verify: new loader/merge test.)*
- [ ] AC-3: With a config exporting `validDirs: ['infra']`, a backtick ref `` `infra/foo.ts` `` is validated (and reported missing if absent), whereas with no config it is treated as out-of-allow-list and skipped. *(Verify: new merge test.)*
- [ ] AC-4: With a config exporting `markdownRootDirs: ['documentation']`, a markdown file under `documentation/` is walked and its broken refs reported; with no config that dir is not walked. *(Verify: new merge test.)*
- [ ] AC-5: A **malformed** config (syntax error, or exporting a non-array / wrong shape) degrades to canon defaults with no throw; `runChecks` still returns findings rather than crashing. *(Verify: new test with a deliberately broken config fixture.)*
- [ ] AC-6: The effective canon-default `validDirs` and `markdownRootDirs` **no longer contain `templates`**; canon-ai-dev's committed `scripts/docs-refs-config.mjs` re-adds it, so canon-ai-dev's own `npm run docs-refs-check` continues to walk/validate `templates/`. *(Verify: canon-ai-dev's own `npm run docs-refs-check` passes in CI; a unit test asserts the bare script default excludes `templates` and the merged result with canon-ai-dev's config includes it.)*
- [ ] AC-7: `docs-refs-check.mjs` still **exports** `VALID_DIRS` (a Set) and `NOISY_SOURCE_PATHS` (an array) holding the effective merged values; the `tests/docs-refs-check.test.ts` import and `scripts/docs-refs-check.mjs.d.ts` declarations remain valid. *(Verify: type-check passes; test import resolves.)*
- [ ] AC-8: `runUpgrade` on a simulated repo whose `scripts/docs-refs-check.mjs` is pre-split shape (no `docs-refs-config` import) **and** has no `scripts/docs-refs-config.mjs`: the result **scaffolds** `scripts/docs-refs-config.mjs` from the canon default, **does not** include `scripts/docs-refs-check.mjs` in the written/upgraded set this run, and surfaces a cutover indicator the CLI prints as the move-your-entries instruction. *(Verify: new `tests/cli.test.ts` case asserting the `UpgradeResult` shape.)*
- [ ] AC-9: After the config exists (post-cutover, or a repo whose `docs-refs-check.mjs` already imports the config), `runUpgrade` overwrites `scripts/docs-refs-check.mjs` normally and does **not** re-trigger the cutover. *(Verify: new `tests/cli.test.ts` case.)*
- [ ] AC-10: `canon upgrade --check` reports the cutover plan (would-create config, would-defer the script) **without writing**, and the dirty-refusal / `--force` semantics apply to the scaffolded config write like any other managed write. *(Verify: new `tests/cli.test.ts` case under `--check`.)*
- [ ] AC-11: `scripts/docs-refs-config.mjs` is **absent** from `CANON_OWNED` and `DELIMITED` (`src/lib/canon-owned.ts`); `npm run sync-templates:check` passes (the new config files are template-only / adopter-owned and are not subject to root↔templates sync). *(Verify: `npm run sync-templates:check` is green; a code reading of `canon-owned.ts` confirms exclusion.)*
- [ ] AC-12: `docs/architecture.md` and `docs/codebase-map.md` describe `scripts/docs-refs-config.mjs` as the adopter-tunable surface (replacing "edit the constant in the script"); `npm run docs-refs-check` passes with the new refs. *(Verify: docs-refs-check green; doc review.)*

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

| File | Change |
|---|---|
| `scripts/docs-refs-check.mjs` | **Remove** the inline `const NOISY_SOURCE_PATHS = []` (line 60), `const VALID_DIRS = new Set([...])` (lines 39–51), `const MARKDOWN_ROOT_DIRS = ['docs','tasks','templates']` (line 63), and their "Adopters: edit after `canon upgrade`" comments (lines 14–15, 38, 53–59). **Add** canon-default constants (canon-universal sets, `templates` excluded) + a load-once-at-module-init merge of the sibling `./docs-refs-config.mjs` (graceful absence/malformed → defaults). Keep exporting effective `VALID_DIRS` and `NOISY_SOURCE_PATHS`. Add a small exported, pure loader/merge helper as the test seam. Mechanics (top-level-await dynamic import vs. sync read; exact helper signature) deferred to plan. |
| `scripts/docs-refs-config.mjs` | **New, canon-ai-dev-owned** (committed in this repo; **not** in `CANON_OWNED`). Exports `{ noisySourcePaths: [], validDirs: ['templates'], markdownRootDirs: ['templates'] }` so canon-ai-dev's own check still covers `templates/`. |
| `templates/scripts/docs-refs-config.mjs` | **New, template-only adopter default.** Exports `{ noisySourcePaths: [], validDirs: [], markdownRootDirs: [] }` (canon-universal defaults already live in the script; nothing project-specific here) with comments explaining what adopters typically add. Scaffolded into adopter `scripts/` by `canon init`'s `templates/` walk. Authored directly; **not** synced from the root config (it is not canon-owned, so `sync-canon-templates` ignores it). |
| `scripts/docs-refs-check.mjs.d.ts` | **Canon-owned** (`canon-owned.ts:19`), so editing it triggers the pre-commit sync hook to regenerate its mirror (next row). Add the loader/merge helper declaration (if exported); spell out the preserved `VALID_DIRS` export (the current `.d.ts` declares `NOISY_SOURCE_PATHS` but **not** `VALID_DIRS`); keep `runChecks` (wildcard `*.mjs` module). |
| `src/cli/commands/upgrade.ts` | Add the safe-cutover migration in `runUpgrade` (Decision #5): detect pre-split shape + absent config → queue a pending write of `scripts/docs-refs-config.mjs` from the canon default template, exclude `scripts/docs-refs-check.mjs` from this run's writes, set a cutover flag on `UpgradeResult`; `upgradeCmd` prints the move-your-entries instruction. Reflect under `--check`. |
| `dist/` | **Build artifact (committed; CI enforces `npm run build && git diff --exit-code dist/`).** Editing `src/cli/commands/upgrade.ts` regenerates the bundled `dist/cli/index.js`. **No manual edit** — produced by `npm run build`. Directory-form entry so the `--pr` base-drift gate (trailing-slash = directory prefix) accepts the regenerated bundle without a ship-time spec amendment. Only the source edit in `src/` drives this; the `scripts/`-side changes ship raw and are not bundled. |
| `templates/scripts/docs-refs-check.mjs` | Auto-synced mirror of the root script (via `npm run sync-templates`; pre-commit hook handles it). Will contain the `./docs-refs-config.mjs` import. **No manual edit** — but **must be declared here** so the `--pr` base-drift allow-list (= task-dir + telemetry + this table; templates mirrors are NOT auto-unioned) accepts the regenerated mirror at ship time. |
| `templates/scripts/docs-refs-check.mjs.d.ts` | Auto-synced mirror of the root `.d.ts` (regenerated by the pre-commit sync hook whenever the source `.d.ts` changes). **No manual edit** — declared here for the same `--pr` base-drift reason as the row above. Omitting it forces a spec amendment + re-push at `--pr` time. |
| `tests/docs-refs-check.test.ts` | Add loader/merge coverage: config present (each of the three arrays), absent, malformed (AC-2…AC-7). |
| `tests/cli.test.ts` | Add cutover coverage on `runUpgrade`: pre-split→halt+scaffold, post-cutover→normal, `--check` plan (AC-8…AC-10). |
| `docs/architecture.md` | Update the adopter opt-in note (around line 159) and validation matrix (around line 140) to point at `scripts/docs-refs-config.mjs` as the tuning surface. |
| `docs/codebase-map.md` | Add a row for `scripts/docs-refs-config.mjs` (around line 97). |

### Interaction Dependencies

- **`canon init` (`scaffoldTemplates`)** — relies on the templates-walk copying `templates/scripts/docs-refs-config.mjs`; confirmed by reading `init.ts` (walks the whole `templates/` tree, copies any file the adopter lacks). No code change.
- **`sync-canon-templates.mjs`** — iterates only `WHOLESALE_SYNC` (= `CANON_OWNED`) and `DELIMITED`. Since the config is in neither, sync ignores it; the root config (`templates`-bearing) and the template default (canon-universal) legitimately differ with no drift error. Confirmed by reading `buildSyncPlan`. The canon-internal-leak guard scans only `.md` files, so the new `.mjs` import is not flagged.
- **`AGENTS.md:188`** — references `VALID_DIRS` in `docs-refs-check.mjs`; preserved as an exported symbol (AC-7), so the ref stays valid and `docs-refs-check` does not break on it.
- **`docs-refs-check.mjs.d.ts` wildcard `declare module '*.mjs'`** — the new config import inside the `.mjs` is not type-checked across the boundary by tsc; the test import path is unaffected. Plan should confirm no new type error arises from the import.

### Data Model Changes

New optional on-disk contract: `scripts/docs-refs-config.mjs` exporting `{ noisySourcePaths?: string[], validDirs?: string[], markdownRootDirs?: string[] }`. No change to `status.json` or any persisted pipeline state. `UpgradeResult` gains one field to signal the cutover (exact name deferred to plan).

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build`
- [x] `npm run sync-templates:check` — root↔templates mirror must stay consistent (and confirm the new config is correctly *outside* the sync set)
- [x] `npm run docs-refs-check` — doc refs to the new config file must resolve
- [ ] E2E — N/A (no E2E suite in this project)

## Docs Impact

- `docs/architecture.md` — adopter opt-in note + validation matrix row point at `scripts/docs-refs-config.mjs`.
- `docs/codebase-map.md` — new row for the config file.
- `AGENTS.md` — the `VALID_DIRS` example (line 188) stays accurate because the symbol is preserved; no edit required, but QA should confirm it still reads correctly.
- Telemetry (`docs/lessons-learned.md`, `docs/task-quality-log.md`) — auto-committed at QA; the "owned-file with an adopter-edit point is a contradiction; relocate to a non-owned sibling" lesson is worth an entry.

## Known Risks

- **Cutover detection is the load-bearing correctness point.** Detection is a literal check ("does the current `docs-refs-check.mjs` import `./docs-refs-config.mjs`?") + "does the config exist?". A false *new-shape* read (treating a pre-split file as already-migrated) would overwrite and lose customizations — but pre-split files definitionally lack the import string, so the risk is low. A false *old-shape* read just causes a harmless extra re-run. Tests must cover both shapes (AC-8/AC-9). Worst credible failure is bounded and git-recoverable.
- **`templates` removed from canon defaults is a behavior change for canon-ai-dev itself.** If canon-ai-dev's own `scripts/docs-refs-config.mjs` is ever deleted, refs to `templates/**` stop being validated (treated as out-of-allow-list, silently skipped) rather than erroring. Mitigated by committing the config and asserting the merged result includes `templates` (AC-6). Flagged so review checks canon-ai-dev's own gate stays green.
- **Module-init config load couples canon-ai-dev's test run to its own config file.** Because the script loads the sibling config at import time, canon-ai-dev's tests see `templates` in the effective dirs. Existing fixtures don't create `templates/` dirs, so walking it is a no-op; existing tests should pass unchanged (AC-1). Plan should keep the merge unit-testable via an injectable directory/path seam rather than only the implicit sibling, so absence/malformed cases can be exercised against temp dirs.
- **Async load vs. synchronous `runChecks`.** If the implementer uses a dynamic import for the `.mjs` config, the load must complete before `runChecks` runs (e.g. top-level await at module init) so `runChecks` stays synchronous and the `.d.ts`/tests don't churn. A sync read+parse is the alternative. Either is acceptable; the contract is "loaded once, before first check, `runChecks` stays sync." Flagged because picking wrong here ripples into ~40 test call sites.
- **`--check` must reflect the cutover** (would-create config, would-defer script) without writing, or operators get a surprise on the real run. Covered by AC-10.
- **`--pr` base-drift allow-list completeness (ship-time gotcha).** The base-drift gate's allow-list is task-dir + telemetry + this spec's Affected Files; regenerated artifacts are NOT auto-unioned. This task regenerates three committed artifacts that must therefore be declared (and are): the bundled `dist/cli/index.js` (from `npm run build`, because `src/cli/commands/upgrade.ts` is edited), and the two canon-owned templates mirrors `templates/scripts/docs-refs-check.mjs` + `templates/scripts/docs-refs-check.mjs.d.ts` (from the pre-commit sync hook, because both `scripts/docs-refs-check.mjs` and its `.d.ts` are canon-owned). Omitting any one forces a spec amendment + re-push at `--pr` time. Implementer/QA must rebuild `dist/` and let the sync hook stage the mirrors before `--pr`.

## Human Test Plan

Steps for the product owner. "The repo" below means a checkout that already uses canon and has the older docs-refs checker.

1. In a repo on the *old* version of the checker (e.g. GP), add a couple of custom skip entries to the checker's adopter list and commit them, as you do today.
2. Upgrade canon to the version with this change, then run `canon upgrade`.
3. **Expected:** canon reports that it created a new `scripts/docs-refs-config.mjs` (with empty/default contents) and that it did **not** update the checker script yet, with a short instruction to move your custom entries into the new file and re-run.
4. Open your existing checker script (still untouched), copy your custom entries into the new `scripts/docs-refs-config.mjs`, and save.
5. Run `canon upgrade` again. **Expected:** the checker script updates normally this time; your custom entries are intact in the config file.
6. Run the docs reference check (`npm run docs-refs-check`). **Expected:** it behaves exactly as before — your custom skip entries are still honored.
7. Run `canon upgrade` a third time (or any later upgrade). **Expected:** the config file is left completely untouched — your entries survive every future upgrade. This is the whole point: the annoyance is gone.
8. Sanity check on a *fresh* canon repo: run `canon init`. **Expected:** a `scripts/docs-refs-config.mjs` is scaffolded automatically with default (empty) contents and explanatory comments.

---

## Spec Quality Checklist

> Claude: complete this before marking spec done. Fix anything unchecked.

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; plan is a pipeline phase). Decision/Affected Files reference real symbols (`runUpgrade`, `scaffoldTemplates`, `buildSyncPlan`, `WHOLESALE_SYNC`, `NOISY_SOURCE_PATHS`, `VALID_DIRS`, `MARKDOWN_ROOT_DIRS`).
- [x] Known Risks covers failure modes for the trickiest ACs (cutover detection, `templates` default removal, async load, `--check`)
- [x] Human Test Plan uses product language only (no code, no file names) — uses file names sparingly where the product owner must open/edit them; otherwise behavior-oriented
- [x] Validation Required has at least one entry marked `- [x]`

---

## Amendment

> Filed after a manual Codex review of PR #121 surfaced two P2 correctness gaps that the spec/plan/implement/review chain didn't catch. Both are bounded edge-refinements of the config-resolution and cutover logic — the core design (adopter-owned sibling config + union merge + safe-halt cutover) is unchanged. Rerouting to `implement` to address them.

### Problem (delta)

1. **The adopter config is resolved relative to the checker's install location, not the repo being checked.** `scripts/docs-refs-check.mjs` loads its config once at module init from its own sibling (`new URL('./docs-refs-config.mjs', import.meta.url)`), and `runChecks(repoRoot, options)` falls back to that module-level config whenever `options.adopterConfig` is undefined — including from `main()`, which passes no options. So `node scripts/docs-refs-check.mjs <other-repo>` (and any `runChecks(foreignRepo)` without an explicit config) walks the target repo's docs but applies *this* repo's allowlist. The primary adopter flow (`npm run docs-refs-check`, no arg, from the repo root) is unaffected — sibling == repo root — so the blast radius is the foreign-repo path-arg invocation, which canon doesn't use today. It is nonetheless an internal-consistency footgun: `repoRoot` drives file-walking but not config.

2. **`canon upgrade` scaffolds the config only when the checker is pre-split, not whenever the config is missing.** The cutover predicate (`isPreSplitDocsRefs`) requires the checker to *lack* the `./docs-refs-config.mjs` import. A repo with the **new** checker but a **missing** `scripts/docs-refs-config.mjs` (config deleted/lost after migration, or scaffolded-checker-without-config) therefore gets no scaffold — the new checker silently runs on canon defaults. The scaffold decision should key on config *presence*; only the checker-overwrite *deferral* should key on pre-split shape.

### Decision (delta)

1. **Resolve the config relative to `repoRoot` at the CLI entry.** `main()` loads `<repoRoot>/scripts/docs-refs-config.mjs` and applies it (passing it through `options.adopterConfig`), so checking any repo uses *that* repo's config. The module-sibling load is retained only as the source for the exported `VALID_DIRS` / `NOISY_SOURCE_PATHS` symbols and as the `runChecks`-without-options fallback. `runChecks` stays **synchronous** — the per-repo load happens in `main`, NOT inside `runChecks` (that would ripple async through ~40 test call sites and is explicitly out of scope). **Because the config load is async (dynamic `import()`), `main` becomes `async`, and two entrypoint changes are load-bearing (NOT deferrable mechanics) for correct CLI exit codes:** (a) the bottom self-invocation `process.exitCode = main();` MUST be rewritten to handle the returned Promise (e.g. `main().then(code => { process.exitCode = code; });`) — otherwise `process.exitCode` is assigned a (truthy) Promise and the CLI's exit code is wrong; (b) `scripts/docs-refs-check.mjs.d.ts` MUST update `main`'s declared return type from `number` to `Promise<number>`.
2. **Split scaffold from defer in the upgrade cutover.** Scaffold `scripts/docs-refs-config.mjs` from the canon default template whenever it is absent, regardless of checker shape. Defer the checker overwrite **and** print the move-your-entries instruction only when the checker is pre-split **and** the config is absent (the customization-preservation cutover). Config present → no scaffold, no defer, normal upgrade.

### Acceptance Criteria (amendment)

- [ ] AC-13: A fixture repo that has its own `scripts/docs-refs-config.mjs` (distinct `validDirs`/`markdownRootDirs` from canon defaults) is validated against **its** config when checked via the repoRoot entry point — not the checker's install-location sibling. *(Verify: a `tests/docs-refs-check.test.ts` case that loads a config from a temp repo's own path and asserts that repo's allowlist applies; and that the bare `npm run docs-refs-check` in-repo flow is unchanged.)*
- [ ] AC-14 — **scaffold and defer are independent decisions, covering all four states.** Invariant: **scaffold the config ⟺ the config file is absent**; **defer the checker overwrite + print the move-your-entries instruction ⟺ the checker is pre-split AND the config is absent.** The full matrix must be verified (new `tests/cli.test.ts` cases unless noted):
  - [ ] AC-14a (new-checker + config **absent**): config scaffolded; checker **not** added to `cutoversDeferred` (upgrades normally this run).
  - [ ] AC-14b (pre-split + config **absent**): config scaffolded; checker deferred (added to `cutoversDeferred`); move-your-entries message surfaced — unchanged cutover behavior (existing AC-8 case still passes).
  - [ ] AC-14c (pre-split + config **present**): **normal upgrade** — checker overwritten, no scaffold queued for the config, not deferred. *(This is the run-2 state of a cutover; pins that defer is gated on config-absence, not pre-split alone.)*
  - [ ] AC-14d (new-checker + config **present**): normal upgrade — no scaffold, no defer (existing AC-9 case still passes; add an assertion that no `docs-refs-config.mjs` write is queued).
- [ ] AC-15: After `main` becomes async, the CLI still exits with the correct **numeric** code — `0` when all refs are OK, `1` when broken refs are found — i.e. `process.exitCode` is the resolved number, never a pending Promise. *(Verify: the existing `tests/docs-refs-check.test.ts` CLI spawn cases — "exits 0 …" / "exits non-zero …" — still pass; they assert the spawned process's exit status.)*

### Affected Files (amendment)

> All paths below are already in the `## Design` Affected Files table, so the `--pr` base-drift allow-list is already complete; listed here to scope the amended-implement prompt. No new paths.

| File | Change |
|---|---|
| `scripts/docs-refs-check.mjs` | `main()` becomes `async`, resolves + loads `<repoRoot>/scripts/docs-refs-config.mjs`, and applies it via `options.adopterConfig`; module-sibling load kept for exports + no-options fallback; `runChecks` stays sync. **Rewrite the bottom self-invocation `process.exitCode = main();` to await the returned Promise.** |
| `scripts/docs-refs-check.mjs.d.ts` | Update `main`'s declared return type to `Promise<number>` (mandatory — `main` becomes async). Mirror regenerates via the sync hook. |
| `src/cli/commands/upgrade.ts` | Scaffold `docs-refs-config.mjs` when the file is missing (any checker shape); defer the checker overwrite + emit the move-your-entries message only when pre-split AND config missing. |
| `tests/docs-refs-check.test.ts` | New AC-13 test (foreign/temp-repo config resolution). |
| `tests/cli.test.ts` | New AC-14a test (new-checker + missing-config scaffolds without deferring); AC-14b/c assertions. |

### Known Risks (amendment)

- **The `main()`-loads-repoRoot fix targets the CLI path only — `runChecks(foreignRepo)` without `options.adopterConfig` is intentionally unsupported.** It still falls back to the module-sibling config; programmatic callers MUST pass `options.adopterConfig` to check a foreign repo. Rationale: canon's only invocation is the CLI, and programmatic callers (tests) already pass the config explicitly. Making `runChecks` itself async to fully close this is explicitly **rejected** (ripples to ~40 test sites; the cost dwarfs the unused-invocation gap). This is a documented library limitation, not an oversight.
- **Scaffolding an empty config when missing restores the file, not lost entries.** If an adopter's customized config was deleted, re-scaffolding writes the empty default — it re-establishes the tuning surface and prevents the silent "no config → canon defaults" state, but does not recover entries that already lived only in git history. Intended scope; not a data-recovery mechanism.
