# Implementation Handoff: docs-refs-adopter-config

> Author: Codex | Spec: `tasks/docs-refs-adopter-config/spec.md` | Plan: `tasks/docs-refs-adopter-config/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `scripts/docs-refs-check.mjs` | Split adopter-tunable arrays into merged canon defaults + optional sibling config load, preserved `VALID_DIRS`/`NOISY_SOURCE_PATHS` exports, and added `loadAdopterConfig` / `mergeAdopterConfig` helpers. |
| `scripts/docs-refs-config.mjs` | New adopter-owned config for canon-ai-dev; re-adds `templates` to the effective docs-refs allowlists without touching the canon-owned checker. |
| `scripts/docs-refs-check.mjs.d.ts` | Declared `AdopterConfig`, `loadAdopterConfig`, `mergeAdopterConfig`, the preserved `VALID_DIRS` export, and the expanded `runChecks` options shape. |
| `templates/scripts/docs-refs-check.mjs` | Synced mirror of the root checker after the config split. |
| `templates/scripts/docs-refs-check.mjs.d.ts` | Synced mirror of the root declaration after the config split. |
| `templates/scripts/docs-refs-config.mjs` | New adopter-scaffold config shipped in `templates/` for fresh `canon init` installs. |
| `src/cli/commands/upgrade.ts` | Added the safe cutover: pre-split repos scaffold `scripts/docs-refs-config.mjs`, defer the checker write, expose `cutoversDeferred`, and print the move-your-entries instruction in both normal and `--check` flows. |
| `tests/docs-refs-check.test.ts` | Added coverage for default-vs-config merges, malformed configs, exported symbol shapes, and the per-array allow/skip behavior. |
| `tests/cli.test.ts` | Added upgrade cutover coverage for pre-split, post-cutover, `--check`, and dirty-refusal/`--force` paths. |
| `docs/architecture.md` | Documented `scripts/docs-refs-config.mjs` as the adopter-tunable surface and updated the `canon upgrade` note to mention the scaffolded config. |
| `docs/codebase-map.md` | Added the new docs-refs config row under configuration. |
| `dist/cli/index.js` | Rebuilt bundle reflecting the `upgrade` command changes. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The checker now owns canon defaults and loads adopter overrides from a sibling config that `canon upgrade` does not overwrite. That keeps the existing `docs-refs-check` behavior stable when no config exists, while moving the mutable arrays out of the clobbered file and giving existing adopters a safe migration path that scaffolds config first, defers the checker rewrite, and surfaces an explicit cutover message.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| None | The implementation followed the planned loader/merge/cutover shape, including the `runChecks` test seam and the `UpgradeResult.cutoversDeferred` signal. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: With **no** `scripts/docs-refs-config.mjs` present, `runChecks(repoRoot)` produces byte-identical findings to today on the same input (defaults applied; no throw). | Met | `mergeAdopterConfig(null)` preserves the old default behavior; the existing `tests/docs-refs-check.test.ts` cases still pass unchanged against the new loader. |
| AC-2: With a config exporting `noisySourcePaths: ['docs/archive']`, a broken ref inside `docs/archive/**` is skipped while a broken ref outside it is still reported. | Met | Covered by `tests/docs-refs-check.test.ts` `config merge: noisySourcePaths skips archive sources only when configured`. |
| AC-3: With a config exporting `validDirs: ['infra']`, a backtick ref `` `infra/foo.ts` `` is validated (and reported missing if absent), whereas with no config it is treated as out-of-allow-list and skipped. | Met | Covered by `tests/docs-refs-check.test.ts` `config merge: validDirs validates infra refs only when configured`. |
| AC-4: With a config exporting `markdownRootDirs: ['documentation']`, a markdown file under `documentation/` is walked and its broken refs reported; with no config that dir is not walked. | Met | Covered by `tests/docs-refs-check.test.ts` `config merge: markdownRootDirs walks documentation only when configured`. |
| AC-5: A **malformed** config (syntax error, or exporting a non-array / wrong shape) degrades to canon defaults with no throw; `runChecks` still returns findings rather than crashing. | Met | Covered by `tests/docs-refs-check.test.ts` `malformed config degrades to defaults without throwing` using both a syntax-error fixture and a wrong-shape fixture. |
| AC-6: The effective canon-default `validDirs` and `markdownRootDirs` **no longer contain `templates`**; canon-ai-dev's committed `scripts/docs-refs-config.mjs` re-adds it, so canon-ai-dev's own `npm run docs-refs-check` continues to walk/validate `templates/`. | Met | `mergeAdopterConfig(null)` excludes `templates`, `loadAdopterConfig('scripts/docs-refs-config.mjs')` re-adds it, and `npm run docs-refs-check` passed. |
| AC-7: `docs-refs-check.mjs` still **exports** `VALID_DIRS` (a Set) and `NOISY_SOURCE_PATHS` (an array) holding the effective merged values; the `tests/docs-refs-check.test.ts` import and `scripts/docs-refs-check.mjs.d.ts` declarations remain valid. | Met | Covered by the module export-shape test and `npm run type-check` passing with the updated `.d.ts`. |
| AC-8: `runUpgrade` on a simulated repo whose `scripts/docs-refs-check.mjs` is pre-split shape (no `docs-refs-config` import) **and** has no `scripts/docs-refs-config.mjs`: the result **scaffolds** `scripts/docs-refs-config.mjs` from the canon default, **does not** include `scripts/docs-refs-check.mjs` in the written/upgraded set this run, and surfaces a cutover indicator the CLI prints as the move-your-entries instruction. | Met | Covered by `tests/cli.test.ts` `runUpgrade: pre-split docs-refs checker scaffolds config and defers checker upgrade`. |
| AC-9: After the config exists (post-cutover, or a repo whose `docs-refs-check.mjs` already imports the config), `runUpgrade` overwrites `scripts/docs-refs-check.mjs` normally and does **not** re-trigger the cutover. | Met | Covered by `tests/cli.test.ts` `runUpgrade: after config exists, docs-refs checker upgrades normally and does not re-cutover`. |
| AC-10: `canon upgrade --check` reports the cutover plan (would-create config, would-defer the script) **without writing**, and the dirty-refusal / `--force` semantics apply to the scaffolded config write like any other managed write. | Met | Covered by `tests/cli.test.ts` `runUpgrade --check: cutover plans config scaffold without writing` and `runUpgrade: dirty cutover scaffold is refused without --force and overwritten with --force`. |
| AC-11: `scripts/docs-refs-config.mjs` is **absent** from `CANON_OWNED` and `DELIMITED` (`src/lib/canon-owned.ts`); `npm run sync-templates:check` passes (the new config files are template-only / adopter-owned and are not subject to root↔templates sync). | Met | `src/lib/canon-owned.ts` was left unchanged, and `npm run sync-templates:check` passed after syncing the mirror files. |
| AC-12: `docs/architecture.md` and `docs/codebase-map.md` describe `scripts/docs-refs-config.mjs` as the adopter-tunable surface (replacing "edit the constant in the script"); `npm run docs-refs-check` passes with the new refs. | Met | Both protected docs were updated and `npm run docs-refs-check` passed. |

## Edge Cases Considered

- Missing or malformed `scripts/docs-refs-config.mjs` falls back to canon defaults without throwing.
- The exported `VALID_DIRS` Set and `NOISY_SOURCE_PATHS` array stay mutable references so the existing tests that temporarily mutate the default skip list keep working.
- The cutover path treats a deleted/tracked `scripts/docs-refs-config.mjs` as the dirty case for refusal, which is the real tracked-state failure mode for a scaffolded config write.
- The checker mirror under `templates/` stays byte-synced, while `templates/scripts/docs-refs-config.mjs` remains adopter-scaffold content and is intentionally outside the sync set.

## Blockers

- None.

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed cleanly. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` | Pass | Full suite passed: 669 passed, 0 failed, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`; postbuild normalized one file. |
| `npm run sync-templates:check` | Pass | Canon-managed root/template files remained in sync after the mirror refresh. |
| `npm run docs-refs-check` | Pass | The checker passed with the new config split and docs refs. |
| `E2E — N/A` | not_configured | No E2E surface in this CLI-only repo. |

## Ready for Review

- [ ] All spec ACs met (see AC Coverage table above)
- [ ] All applicable validation checks pass (no failures)
- [ ] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->

## Iteration 2 — addressing review round 1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|
| `scripts/docs-refs-check.mjs` | Made `main()` async, resolved `<repoRoot>/scripts/docs-refs-config.mjs` at the CLI entrypoint, passed that config through to `runChecks`, and handled the Promise-aware self-invocation so exit codes stay numeric. |
| `scripts/docs-refs-check.mjs.d.ts` | Updated the exported `main()` signature to `Promise<number>`. |
| `src/cli/commands/upgrade.ts` | Split docs-refs cutover into two predicates: scaffold `scripts/docs-refs-config.mjs` whenever it is missing, but defer the checker rewrite only when the checker is pre-split and the config is missing. |
| `templates/scripts/docs-refs-check.mjs` | Synced mirror of the async CLI-entrypoint change in the root checker. |
| `templates/scripts/docs-refs-check.mjs.d.ts` | Synced mirror of the `Promise<number>` `main()` declaration. |
| `tests/docs-refs-check.test.ts` | Added a CLI-path regression proving that a repoRoot check uses the target repo's own config file rather than the checker install-location sibling. |
| `tests/cli.test.ts` | Added the two missing upgrade matrix cases: new-checker + missing-config, and new-checker + present-config. |
| `dist/cli/index.js` | Rebuilt the bundled CLI so the shipped `upgrade` path matches the source changes. |
| `tasks/docs-refs-adopter-config/notes.md` | Appended a reroute note capturing the repo-root-relative config resolution and split scaffold/defer cutover behavior. |

### Findings addressed

- `_correctness bug:_` the checker CLI was loading adopter config from the checker install location instead of the repo being checked → fixed in `scripts/docs-refs-check.mjs`.
- `_correctness bug:_` `runUpgrade` only scaffolded `scripts/docs-refs-config.mjs` on pre-split repos, so a new checker with a missing config could silently stay unscaffolded → fixed in `src/cli/commands/upgrade.ts`.
- `_contract fix:_` `main()` now returns a Promise, so the declaration and self-invocation had to move together to preserve numeric exit codes → fixed in `scripts/docs-refs-check.mjs.d.ts` and the module tail.

### AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: With **no** `scripts/docs-refs-config.mjs` present, `runChecks(repoRoot)` produces byte-identical findings to today on the same input (defaults applied; no throw). | Met (unchanged from round 1) | Existing `tests/docs-refs-check.test.ts` cases still pass unchanged; the reroute only changed the CLI path, not `runChecks`' default fallback. |
| AC-2: With a config exporting `noisySourcePaths: ['docs/archive']`, a broken ref inside `docs/archive/**` is skipped while a broken ref outside it is still reported. | Met (unchanged from round 1) | Covered by `tests/docs-refs-check.test.ts` `config merge: noisySourcePaths skips archive sources only when configured`. |
| AC-3: With a config exporting `validDirs: ['infra']`, a backtick ref `` `infra/foo.ts` `` is validated (and reported missing if absent), whereas with no config it is treated as out-of-allow-list and skipped. | Met (unchanged from round 1) | Covered by `tests/docs-refs-check.test.ts` `config merge: validDirs validates infra refs only when configured`. |
| AC-4: With a config exporting `markdownRootDirs: ['documentation']`, a markdown file under `documentation/` is walked and its broken refs reported; with no config that dir is not walked. | Met (unchanged from round 1) | Covered by `tests/docs-refs-check.test.ts` `config merge: markdownRootDirs walks documentation only when configured`. |
| AC-5: A **malformed** config (syntax error, or exporting a non-array / wrong shape) degrades to canon defaults with no throw; `runChecks` still returns findings rather than crashing. | Met (unchanged from round 1) | Covered by the malformed-config fixture in `tests/docs-refs-check.test.ts`. |
| AC-6: The effective canon-default `validDirs` and `markdownRootDirs` **no longer contain `templates`**; canon-ai-dev's committed `scripts/docs-refs-config.mjs` re-adds it, so canon-ai-dev's own `npm run docs-refs-check` continues to walk/validate `templates/`. | Met (unchanged from round 1) | `mergeAdopterConfig(null)` still excludes `templates`; `npm run docs-refs-check` passed after the reroute change and template sync. |
| AC-7: `docs-refs-check.mjs` still **exports** `VALID_DIRS` (a Set) and `NOISY_SOURCE_PATHS` (an array) holding the effective merged values; the `tests/docs-refs-check.test.ts` import and `scripts/docs-refs-check.mjs.d.ts` declarations remain valid. | Met (unchanged from round 1) | The export-shape test still passes and `npm run type-check` passed with the updated declaration file. |
| AC-8: `runUpgrade` on a simulated repo whose `scripts/docs-refs-check.mjs` is pre-split shape (no `docs-refs-config` import) **and** has no `scripts/docs-refs-config.mjs`: the result **scaffolds** `scripts/docs-refs-config.mjs` from the canon default, **does not** include `scripts/docs-refs-check.mjs` in the written/upgraded set this run, and surfaces a cutover indicator the CLI prints as the move-your-entries instruction. | Met | Covered by `tests/cli.test.ts` `runUpgrade: pre-split docs-refs checker scaffolds config and defers checker upgrade`. |
| AC-9: After the config exists (post-cutover, or a repo whose `docs-refs-check.mjs` already imports the config), `runUpgrade` overwrites `scripts/docs-refs-check.mjs` normally and does **not** re-trigger the cutover. | Met | Covered by `tests/cli.test.ts` `runUpgrade: after config exists, docs-refs checker upgrades normally and does not re-cutover` and the new checker-present state below. |
| AC-10: `canon upgrade --check` reports the cutover plan (would-create config, would-defer the script) **without writing**, and the dirty-refusal / `--force` semantics apply to the scaffolded config write like any other managed write. | Met | Covered by `tests/cli.test.ts` `runUpgrade --check: cutover plans config scaffold without writing` and `runUpgrade: dirty cutover scaffold is refused without --force and overwritten with --force`. |
| AC-11: `scripts/docs-refs-config.mjs` is **absent** from `CANON_OWNED` and `DELIMITED` (`src/lib/canon-owned.ts`); `npm run sync-templates:check` passes (the new config files are template-only / adopter-owned and are not subject to root↔templates sync). | Met (unchanged from round 1) | `src/lib/canon-owned.ts` was left alone and `npm run sync-templates:check` passed after re-syncing the mirrors. |
| AC-12: `docs/architecture.md` and `docs/codebase-map.md` describe `scripts/docs-refs-config.mjs` as the adopter-tunable surface (replacing "edit the constant in the script"); `npm run docs-refs-check` passes with the new refs. | Met (unchanged from round 1) | The protected docs remain updated and `npm run docs-refs-check` passed after the reroute work. |
| AC-13: A fixture repo that has its own `scripts/docs-refs-config.mjs` (distinct `validDirs`/`markdownRootDirs` from canon defaults) is validated against **its** config when checked via the repoRoot entry point — not the checker's install-location sibling. | Met | Covered by the new `tests/docs-refs-check.test.ts` CLI case that checks a temp repo with `documentation/` and `infra/` only in its own config. |
| AC-14a: new-checker + config **absent** scaffolds config and upgrades the checker this run, without adding the checker to `cutoversDeferred`. | Met | Covered by the new `tests/cli.test.ts` `runUpgrade: new docs-refs checker with missing config scaffolds config but does not defer`. |
| AC-14b: pre-split + config **absent** scaffolds config, defers the checker, and prints the move-your-entries instruction. | Met (unchanged from round 1) | The original cutover test still exercises the safe-halt path. |
| AC-14c: pre-split + config **present** performs a normal upgrade with no scaffold and no defer. | Met (unchanged from round 1) | Covered by `tests/cli.test.ts` `runUpgrade: after config exists, docs-refs checker upgrades normally and does not re-cutover`. |
| AC-14d: new-checker + config **present** performs a normal upgrade with no scaffold and no defer. | Met | Covered by the new `tests/cli.test.ts` `runUpgrade: new docs-refs checker with config present upgrades normally and does not scaffold`. |
| AC-15: `main()` in `scripts/docs-refs-check.mjs` becomes async but still exits numerically through the CLI, and the declaration file stays aligned. | Met | The CLI spawn tests still exit `0`/`1` correctly, `scripts/docs-refs-check.mjs.d.ts` now declares `Promise<number>`, and the reroute change kept the `runChecks` API sync. |

### Blockers

- None.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed cleanly after the reroute edits. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly with the `Promise<number>` declaration. |
| `npm test` | Pass | Full suite passed: 673 passed, 0 failed, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`; postbuild normalized one file. |
| `npm run sync-templates:check` | Pass | The template mirrors were re-synced and the check returned clean. |
| `npm run docs-refs-check` | Pass | The checker passed with the repo-root config resolution change. |
| `git diff --check` | Pass | No whitespace or patch-format issues in the final diff. |
