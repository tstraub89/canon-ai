# Spec: upgrade-template-override-nudge — Nudge on customized task-template overrides when `canon upgrade` touches their canon source

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Canon has two completely separate, mutually-unaware code paths around task templates:

1. **Override resolution** (`canon task new`): `taskNew()` in `src/task/index.ts` resolves the override root via `taskTemplateOverrideRoot()` (`src/task/index.ts:81-82` → `path.join(tasksRoot(), '_templates')`, where `tasksRoot()` honors `CANON_TASKS_DIR_OVERRIDE` and defaults to `tasks`), checks `<override-root>/<name>` first, and falls back to `.canon/templates/<name>` (the loop at `src/task/index.ts:213-217`, over `listTemplateFiles()`). A project can pin a customized copy of any task template there. **The override root is NOT a hardcoded literal `tasks/_templates/`** — it is whatever `taskTemplateOverrideRoot()` returns for the project's environment.
2. **Upgrade sync** (`canon upgrade`): `runUpgrade()` in `src/cli/commands/upgrade.ts` one-way-overwrites the canon-owned files in `CANON_OWNED` — which includes `.canon/templates/<name>` — but never reads or mentions the task-template override root.

The consequence: when `canon upgrade` changes `.canon/templates/spec.md`, a project carrying a customized `<override-root>/spec.md` silently drifts. The override keeps being used by `canon task new` while the canon template it was forked from has moved on. Today the only safeguard is a line in `.canon/README.md` telling users to *manually* `diff` their overrides after every upgrade — guidance nobody reliably follows, and which the upgrade command itself never reinforces.

Canon already has the exact precedent for closing this gap: the `cutoverWarnings` field on `UpgradeResult` + `printDocsRefsCutoverWarning()` emit a post-upgrade heads-up when an adopter's customizations need manual reconciliation after a canon-owned file was overwritten. This task applies the same pattern to task-template overrides.

## Decision

Throughout this spec, **override root** means the directory `taskTemplateOverrideRoot()` resolves for the project (default `tasks/_templates/`, but `${CANON_TASKS_DIR_OVERRIDE}/_templates` when that env var is set) — i.e. the exact directory `canon task new` reads overrides from. The default-case examples below write `tasks/_templates/<name>`; the detection must use the resolver, not that literal (AC-12).

When `canon upgrade` changes a canon task template (`.canon/templates/<name>`) **and** the project carries a corresponding customized override (`<override-root>/<name>`), print a polite heads-up listing each affected override and the command to diff it against the new canon template. The nudge fires **only** when this upgrade actually touched that template — an unchanged template never triggers a nudge, even if an override exists.

The nudge is **informational only**: it does not change which files are written, does not change the exit code, does not refuse, and does not modify the overrides. It mirrors the existing `cutoverWarnings` behavior: surfaced in both apply mode and `--check` mode, printed as a heads-up section in `upgradeCmd()`.

Suppression: an override that is byte-identical to the *new* canon template has nothing to reconcile, so it is not listed.

The listed override paths in the heads-up are the resolved `<override-root>/<name>` paths, so the diff command they show is copy-pasteable for projects using a custom `CANON_TASKS_DIR_OVERRIDE`.

## Non-Goals

- **No auto-merge or three-way merge of overrides.** Detection and a heads-up only; the human reconciles manually. The override files are never written, moved, or staged by this task.
- **No change to upgrade write behavior.** What gets written, the dirty-target refusal flow, `--force` / `--no-stage` semantics, and all exit codes stay exactly as they are. This task only *reads* additional state and *prints* an additional informational section. (Backed by AC-8's exit-code assertions, not prose alone.)
- **Override scope is the resolved task-template override root only** (the `<override-root>/` mechanism that `canon task new` reads, default `tasks/_templates/`). This task does not extend nudging to `DELIMITED` files (`AGENTS.md`, `CLAUDE.md`), `HEADER_ONLY_SYNC` files, or any other `CANON_OWNED` entry that is not a `.canon/templates/*` task template.

## Acceptance Criteria

- [ ] **AC-1**: `UpgradeResult` (in `src/cli/commands/upgrade.ts`) gains a new field `staleOverrides: string[]`, populated at **every** `return` statement of `runUpgrade()` (the `--check` return, the dirty-refusal return, and the final return). Verify: `tsc` compiles; a test reads `result.staleOverrides` from a `runUpgrade()` call and gets an array (never `undefined`) on each return path.

- [ ] **AC-2** (detection-set contract): The set of template basenames the nudge considers must equal exactly the set `canon task new` can override — i.e. the basenames of `CANON_OWNED` entries that start with `.canon/templates/`. Verify: a drift-guard test asserts the checked set equals `CANON_OWNED.filter(f => f.startsWith('.canon/templates/')).map(f => basename)`. (No hand-maintained second copy of the list — derive it from `CANON_OWNED`, which `upgrade.ts` already imports.)

- [ ] **AC-3** (positive case): For a template basename `<name>`, the resolved `<override-root>/<name>` is listed in `staleOverrides` when **all three** hold: (a) `<override-root>/<name>` exists under `cwd`; (b) `.canon/templates/<name>` is in this run's changed set (`upgraded` in apply mode, `wouldUpgrade` under `--check`); (c) the override's content differs from the **new** canon template content (the bytes written/would-be-written to `.canon/templates/<name>`). Verify: a test (default override root, env unset) sets up a differing `tasks/_templates/<name>` + a changed canon template and asserts the override path appears in `staleOverrides`.

- [ ] **AC-4** ("only if the diff includes the templated file"): If `.canon/templates/<name>` is **not** in this run's changed set (the template is unchanged this upgrade), `<override-root>/<name>` is **not** listed — even when the override exists and differs from the canon template. Verify: a test where the canon template content already matches the project copy (so it lands in `unchanged`, not `upgraded`) and an override exists → `staleOverrides` does not contain it.

- [ ] **AC-5** (suppress on identical): An override that is byte-identical to the new canon template content is **not** listed, even when `.canon/templates/<name>` is in the changed set. Verify: a test with `<override-root>/<name>` equal to the new template bytes → `staleOverrides` excludes it.

- [ ] **AC-6** (`--check` parity): Under `--check`, `staleOverrides` is computed from `wouldUpgrade`. An override that would be listed in apply mode is listed under `--check` with the same setup. Verify: run the AC-3 setup with `{ check: true }` and assert the override appears in `staleOverrides`; assert no files were written (existing dry-run guarantee unaffected).

- [ ] **AC-7** (dirty-refusal → no nudge): When `.canon/templates/<name>` is dirty and the run refuses without `--force`, nothing is written and `.canon/templates/<name>` is absent from both `upgraded` and `wouldUpgrade`, so `<override-root>/<name>` is **not** listed. Verify: a test that makes the canon template path dirty (tracked modification) with a differing override present → dirty-refusal return has empty `staleOverrides`.

- [ ] **AC-8** (informational only — no behavior change): A non-empty `staleOverrides` does not alter exit behavior. `upgradeCmd()` in apply mode still completes without a non-zero exit purely due to stale overrides; the dirty-refusal path still exits `2` driven by `dirtyRefused`, not by `staleOverrides`; `--check` still writes nothing. Verify: tests assert the apply path with stale overrides does not exit non-zero, and the existing dirty-refusal exit-2 test still passes unchanged.

- [ ] **AC-9** (output): When `staleOverrides` is non-empty, `upgradeCmd()` prints a heads-up section that (a) states the overrides are NOT updated automatically, (b) lists each `staleOverrides` entry, and (c) shows a `diff .canon/templates/<name> <override-root>/<name>` command for each entry (the resolved override path, not a hardcoded `tasks/_templates/`). The section prints in both apply mode and `--check` mode. When `staleOverrides` is empty, nothing is printed for this section. Verify: a unit test of the print helper (or captured stdout) asserts the listed paths and the per-file diff command appear when non-empty and are absent when empty.

- [ ] **AC-10** (no overrides / strays): When the override root is absent, or present but contains only files that are not recognized template basenames, `staleOverrides` is empty and `runUpgrade()` does not throw. Verify: a test with no `tasks/_templates/` dir and a test with a stray `tasks/_templates/random.txt` → empty `staleOverrides`, no error.

- [ ] **AC-11** (declared/executable alignment): `.canon/README.md` (root, canon-authoritative) is updated so its "after running `canon upgrade`, check your overrides" guidance reflects that the upgrade command now surfaces changed-template overrides automatically (the manual `diff` remains the reconciliation step). The `templates/.canon/README.md` mirror is refreshed by the sync hook. Verify: `npm run sync-templates:check` passes; the README text mentions the automatic heads-up.

- [ ] **AC-12** (override-root resolution honors `CANON_TASKS_DIR_OVERRIDE`): The override root the nudge scans is resolved through the **same** `taskTemplateOverrideRoot()` resolver `canon task new` uses — not a hardcoded `tasks/_templates/`. When `CANON_TASKS_DIR_OVERRIDE` points the project's task root elsewhere, an override placed under `${CANON_TASKS_DIR_OVERRIDE}/_templates/<name>` is detected (under the AC-3 conditions), and a stray file at the default `tasks/_templates/<name>` is **not** consulted. Verify: a test that sets `CANON_TASKS_DIR_OVERRIDE` to a custom subdir of `cwd`, places a differing override at `${that}/_templates/<name>` with a changed canon template → that path appears in `staleOverrides`; a companion assertion that a literal `tasks/_templates/<name>` placed when the env points elsewhere is **not** listed. (Restore/clear the env var in the test's `finally` so it doesn't leak into sibling tests — match the existing `CANON_TASKS_DIR_OVERRIDE` save/restore pattern in the suite.)

## Design

### Affected Files

| File | Change |
|---|---|
| [src/cli/commands/upgrade.ts](src/cli/commands/upgrade.ts) | Add `staleOverrides: string[]` to `UpgradeResult`; compute it in `runUpgrade()` (derive the template basename set from `CANON_OWNED`; resolve the override root via the shared `taskTemplateOverrideRoot()` resolved against `cwd`; intersect against `<override-root>/<name>` existence + changed-set membership + content-differs-from-new-template); populate at all three return points; add a `printStaleOverrideNudge()`-style helper and call it from both the apply and `--check` branches of `upgradeCmd()`. |
| [src/task/index.ts](src/task/index.ts) | Export `taskTemplateOverrideRoot()` (currently a module-private function at `src/task/index.ts:81-82`) so `upgrade.ts` resolves the override root through the **same** source of truth `canon task new` uses — no second hardcoded `tasks/_templates/` literal. (`tasksRoot()` is its only dependency and stays private; export only what `upgrade.ts` calls.) No behavior change to `task/index.ts` — export-only. |
| [.canon/README.md](.canon/README.md) | Update the post-upgrade override-reconciliation guidance to note the automatic nudge (root copy — edit this one only). |
| [templates/.canon/README.md](templates/.canon/README.md) | Sync-generated mirror of `.canon/README.md` (it is a `CANON_OWNED` entry; `scripts/sync-canon-templates.mjs` mirrors it via `getTargetPath`). Do **not** hand-edit — the pre-commit hook + `npm run sync-templates` regenerate and stage it. Declared here so the `--pr` base-drift gate accepts the regenerated change. |
| [dist/cli/index.js](dist/cli/index.js) | Regenerated by `npm run build` (bundles `src/cli/**`, which now pulls the `taskTemplateOverrideRoot` import). Commit the rebuilt artifact. |
| [tests/cli.test.ts](tests/cli.test.ts) | Add cases: AC-2 drift guard, AC-3 positive, AC-4 unchanged-template, AC-5 suppress-identical, AC-6 `--check` parity, AC-7 dirty-refusal, AC-8 exit-behavior, AC-9 output, AC-10 no-overrides/strays, AC-12 `CANON_TASKS_DIR_OVERRIDE` resolution. Use the existing `withTempDir` + `runUpgrade(projectDir, pkgDir, opts)` fixture pattern. |

> Mechanics deferred to plan/implement: exact helper signature, where in `runUpgrade()` the detection runs, and whether the new-template bytes are read from the pending `WriteOp.content` or re-read from `join(pkgDir, 'templates', '.canon/templates/<name>')`. Override-root join: resolve the shared resolver's result against `cwd` with `path.resolve(cwd, taskTemplateOverrideRoot())` — `path.resolve` (not `join`) so an absolute `CANON_TASKS_DIR_OVERRIDE` is honored verbatim rather than nested under `cwd` (see Known Risks). Whether the resolver returns absolute or relative for a given env is the resolver's concern, not the nudge's. The contracts above (ACs) constrain observable behavior, not internal shape.

### Interaction Dependencies

- **`cutoverWarnings` precedent**: This feature is structurally parallel to `cutoverWarnings` / `printDocsRefsCutoverWarning()`. Follow the same shape (field on `UpgradeResult`, populated in `runUpgrade()`, printed in both `upgradeCmd()` modes). Do not fork a parallel reporting path — add a sibling helper alongside the existing one. (See `docs/patterns.md` "route it through the existing safety queue" — the analog here is "match the existing reporting mechanism," not literally the dirty queue.)
- **`canon task new` override resolution**: Two things must stay equal to what `taskNew()` does — the *basename set* (AC-2's drift guard) and the *override-root directory* (AC-12). The directory is shared by importing `taskTemplateOverrideRoot()` from `src/task/index.ts` rather than re-deriving the path; this is the single-source-of-truth move from `docs/lessons-learned.md` ("a cross-cutting invariant belongs in one shared helper"). **Import-cycle check (deferred to implement)**: `upgrade.ts` currently imports only `lib/canon-owned.js` + `lib/canon-block.js`; `task/index.ts` imports `scripts/run-task/*` (none of which import `commands/upgrade`), so `upgrade → task/index` introduces no cycle. Confirm `tsc`/build stays clean; if a cycle ever appears, the fallback is to extract `tasksRoot()`/`taskTemplateOverrideRoot()` into a tiny shared `lib/` module both sides import — still one source of truth, never a second literal.
- **`build` artifact pairing**: `src/cli/commands/upgrade.ts` bundles into `dist/cli/index.js`. Per `docs/lessons-learned.md` ("declare all dist artifacts"), the `--pr` base-drift gate rejects undeclared changed dist files — `dist/cli/index.js` is declared above. Confirm via `npm run build` output that this is the only dist artifact `upgrade.ts` writes; add any other emitted artifact to Affected Files if the build shows one.

### Data Model Changes

One new field on the `UpgradeResult` interface: `staleOverrides: string[]`. Additive, non-breaking — existing consumers (tests, `upgradeCmd`) read the fields they already use. No `status.json` schema impact, no persisted-state impact.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — `upgrade.ts` change affects `dist/cli/index.js`; committed `dist/` must match a fresh build (CI `git diff --exit-code -- dist/`)
- [x] `npm run sync-templates:check` — `.canon/README.md` is a canon-managed root/template pair; the mirror must stay aligned
- [x] `npm run docs-refs-check` — `.canon/README.md` and task artifacts touched

## Docs Impact

- **`.canon/README.md`** — updated in this task (AC-11).
- **`docs/codebase-map.md`** — heads-up: if it documents `UpgradeResult`'s fields or the upgrade reporting surface, QA should add a one-line note for `staleOverrides`. Likely a no-op (the field is internal), but check at QA.
- **Version bump**: new user-facing feature → minor bump under the project versioning policy. Not part of this task; flagged for the release step.

## Known Risks

- **Wrong "changed set" source.** The nudge must key off `upgraded`/`wouldUpgrade`, not "an override exists" alone — otherwise it fires on every upgrade regardless of whether the template changed, which is exactly the noise the "only if the diff includes the templated file" requirement forbids (AC-4). Easy to get subtly wrong; the unchanged-template test (AC-4) is the guard.
- **Comparison baseline (new vs old template).** Suppression must compare the override against the **new** canon template bytes, not the old project copy or the old template. Comparing against the wrong baseline either suppresses legitimately-stale overrides or nudges on no-op upgrades. AC-5 pins this.
- **Three return points in `runUpgrade()`.** The field must be set on all three returns (AC-1). Missing the dirty-refusal return would leave `staleOverrides` `undefined` there and could crash `upgradeCmd()` destructuring; missing the `--check` return breaks AC-6. Grep the function for `return {` and confirm all carry the field.
- **Override-root reads.** `runUpgrade` must tolerate the resolved override root being absent (the common case — most projects have no overrides) without throwing (AC-10). Guard the existence check.
- **Override-root resolution drift (the spec_review finding this revision closes).** The override directory is NOT a hardcoded `tasks/_templates/` — `canon task new` resolves it via `taskTemplateOverrideRoot()`, which honors `CANON_TASKS_DIR_OVERRIDE`. A literal-path implementation would scan the wrong directory for any project using that env var: it would both miss real stale overrides under the custom root and (worse) report phantom paths the user can't act on. AC-12 pins this; the fix is to import and call the shared resolver, never to re-spell the path. Secondary hazard: resolving an *absolute* `CANON_TASKS_DIR_OVERRIDE` against `cwd` with `path.join` would nest it under `cwd` and silently scan nothing — use `path.resolve(cwd, ...)`, which returns the absolute path unchanged (see the mechanics note).
- **Drift-guard import.** AC-2 needs `CANON_OWNED` (already imported in `upgrade.ts`) accessible to the test; no new export needed since the test derives the expected set from `CANON_OWNED` directly. If the implementation instead hardcodes a basename list, that hardcoded list must be exported and guarded (see `docs/lessons-learned.md` "drift-guard tests require the guarded list to be exported") — but deriving from `CANON_OWNED` avoids that entirely and is preferred.

## Human Test Plan

1. In a repo that uses canon, make a customized copy of one of the task templates into the project's task-template overrides folder, and tweak its contents so it differs from canon's version.
2. Run canon's upgrade in a state where canon's own copy of that same template has changed since the project last synced (e.g., a fresh canon version with an updated template).
3. **Expected**: the upgrade completes normally (files updated and staged as usual, exit code unchanged), and the output now includes a polite heads-up that names your customized override and gives you a one-line command to compare it against canon's new version. Your override file itself is left untouched.
4. Run the upgrade again when nothing about that template changed (or when your override happens to be identical to canon's new version).
5. **Expected**: no heads-up about overrides — the nudge only appears when canon actually changed a template you've overridden and your copy still differs.
6. Run the upgrade preview / dry-run with a customized, now-diverged override.
7. **Expected**: the same heads-up appears in the preview, and (as before) no files are written.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier; plan written post-spec-review)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`

---

## Amendment

> Closes the `spec_gap` from code_review round 1 (both lenses): `canon upgrade --force` overwriting a *dirty* `.canon/templates/<name>` wrote the template but produced **no nudge** for a stale override of it — because detection keyed off the *clean* write set only. That contradicted the Decision ("the nudge fires whenever this upgrade actually touched that template"). Human decision: **fire the nudge** in this case (the `--force` path is the power-user scenario most likely to have in-flight customizations — the worst time to go silent). This amendment changes nudge behavior only; it does not change `--force` *write* semantics, so the "no change to upgrade write behavior" Non-Goal still holds.

### A. Changed-set definition (revises Decision + AC-3)

The "changed set" that drives the nudge is the set of canon templates **actually written this run** (apply mode) or **that would be written** (`--check`) — i.e. exactly the membership reflected in `upgraded` / `wouldUpgrade`:

- apply, no `--force`: the written set is the clean ops → `upgraded`.
- apply, `--force`: the written set is **all** pending ops, including formerly-dirty templates → `upgraded` includes them.
- `--check`: nothing is written; the changed set is `wouldUpgrade` (dirty templates are reported under `dirtyRefused`/would-refuse, *not* `wouldUpgrade`, regardless of `--force` — `--check` is a dry run and does not force).

The contract: **a `.canon/templates/<name>` is in the nudge's changed set iff it appears in this run's `upgraded` (apply) or `wouldUpgrade` (`--check`).** Mechanics note (deferred to implement): compute `staleOverrides` against the actually-reported changed set — e.g. key off `upgraded`/`wouldUpgrade` directly, or pass `options.force ? pending : clean` rather than `clean` alone. Do **not** introduce a separate notion of "changed" that can diverge from what the run reports as upgraded.

AC-3 condition (b) is hereby read as "`.canon/templates/<name>` is in this run's changed set as defined above," which under `--force` includes a dirty template that was written.

### B. New acceptance criterion

- [ ] **AC-13** (`--force` writes a dirty template → nudge fires): When `.canon/templates/<name>` is dirty (tracked modification) **and** `--force` is passed, the template is written (appears in `upgraded`), so a differing `<override-root>/<name>` **is** listed in `staleOverrides`. Verify: a test that makes the canon template path dirty, places a differing override, and calls `runUpgrade(cwd, pkgDir, { force: true })` → the override path appears in `staleOverrides` (and the template appears in `upgraded`). This is the `--force` companion to AC-7 (which keeps its no-nudge guarantee strictly for the **no-`--force` refusal** path: dirty + no force → refused → not written → not listed).

### C. AC-7 unchanged, scope clarified

AC-7 stands exactly as written — it governs the **refusal** path only (dirty **and** the run refuses without `--force`). AC-13 governs the force-write path. The two are mutually exclusive on the `--force` flag; together they cover the dirty-template case completely.

### D. Output wording fix (refines AC-9, from the round-1 nit both lenses flagged)

The heads-up header must not imply the *overrides* were updated — they weren't; the *canon templates* were, and the overrides were **not** auto-synced. AC-9 element (a) is amended to require wording to that effect. Use phrasing equivalent to: **"canon templates changed by this upgrade have customized overrides that were not auto-updated"** (or the spec's own framing: "task-template overrides differ from a canon template changed by this upgrade"). The per-entry line and the `diff .canon/templates/<name> <override-root>/<name>` command (AC-9 b/c) are unchanged.

### E. Optional cleanup (non-blocking)

The cold lens noted a dead-code fallback (`relative(cwd, overridePathAbs) || overridePathAbs`) — `relative()` never returns `''` for a file path under the root, so the `|| overridePathAbs` branch is unreachable. Implementer may drop it for clarity; harmless if left. Not an AC.

### Affected Files delta

No new files. `tests/cli.test.ts` gains the AC-13 case (dirty template + `--force` + differing override → listed). `src/cli/commands/upgrade.ts` changes the changed-set source feeding `getStaleOverrides` (per A) and the nudge header wording (per D). `dist/cli/index.js` rebuilt accordingly.

---

## Amendment Round 2

> Addresses Codex's PR-level review (P2, `src/cli/commands/upgrade.ts:376`) plus the three round-3 code-review nits. The P2 is the **dirty-refusal companion** to the `--force` gap that Amendment (round 1) fixed — same root cause: `staleOverrides` is computed from the `clean` subset instead of "what the run actually reports as changed." On the no-`--force` dirty-refusal path, `runUpgrade()` returns early with **empty `upgraded` / `wouldUpgrade`**, yet `staleOverrides` is still derived from `clean[]` — so a mixed run (one template would-change + another managed file dirty) returns overrides for an upgrade that **did not happen**, violating the `UpgradeResult` contract. The CLI masks it (`process.exit(2)` fires before the nudge prints), so this is invisible to end users but wrong for any programmatic `runUpgrade()` caller. This is a **code bug against the existing changed-set contract** (Amendment round 1, section A), not a new behavioral decision — this round makes that contract explicit as an AC and folds in the cosmetic nits.

### A. New acceptance criterion

- [ ] **AC-14** (dirty-refusal returns no stale overrides): On the no-`--force` dirty-refusal path — where ≥1 pending managed file is dirty so `runUpgrade()` refuses and writes nothing (`upgraded` and `wouldUpgrade` both empty) — `staleOverrides` **must be empty**, even when a clean would-change template in the same run has a differing override. This is the direct consequence of the round-1 changed-set contract ("in `staleOverrides` iff in `upgraded`/`wouldUpgrade`"): both are empty on refusal, so `staleOverrides` is `[]`. Verify: a test with two pending templates — template A clean + would-change with a differing `<override-root>/A` override, template B dirty (tracked modification, no `--force`) — asserts the dirty-refusal return has `deepEqual(staleOverrides, [])` (and `upgraded`/`wouldUpgrade` empty). Implementation: compute the nudge **after** the dirty-refusal branch, or return `[]` on that path — do not derive it from `clean[]` ahead of the refusal check.

### B. Nit cleanups (non-AC, from code-review round 3)

Fold these into the same implement pass; none change behavior:
1. **Stale comment**: the block comment stating only clean writes count (near the `reportedWrites`/changed-set computation in `upgrade.ts`) is misleading under `--force` (where `pending` is the written set). Update it to describe the actual contract.
2. **Parameter name**: `getStaleOverrides`'s parameter is named `clean` but can receive `pending` (under `--force`). Rename to a force-neutral name (e.g. `writtenOps` / `changedOps`) so the name matches what it holds.
3. **Dead code**: remove the unreachable `|| overridePathAbs` fallback (`relative()` never returns `''` for a file path under the root). (Round-1 section E left this optional; round 2 resolves it.)

### C. Scope guard — what does NOT change

AC-13 (round 1, `--force` fires the nudge), AC-7 (no-`--force` refusal → silent), and the round-1 changed-set contract all stand unchanged. AC-14 is the refusal-path corollary of that contract, not a revision of it. No change to write behavior, exit codes, or `--force` semantics — `staleOverrides` is a return-value field only; the dirty-refusal CLI path already exits `2` before any nudge print, so user-facing output is unchanged.

### Affected Files delta (round 2)

No new files. `src/cli/commands/upgrade.ts`: move/guard the `staleOverrides` computation so the dirty-refusal return yields `[]` (AC-14), rename the `getStaleOverrides` param, fix the stale comment, drop the dead-code fallback. `tests/cli.test.ts`: add the AC-14 mixed dirty-refusal test. `dist/cli/index.js`: rebuilt.
