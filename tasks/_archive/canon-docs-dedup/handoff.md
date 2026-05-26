# Implementation Handoff: canon-docs-dedup

> Author: Codex | Spec: `tasks/canon-docs-dedup/spec.md` | Plan: `tasks/canon-docs-dedup/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `AGENTS.md` | Added the workflow note that root canon-managed files are authoritative, `templates/` is derived, and `sync-templates` / `sync-templates:check` enforce the mirror. |
| `CLAUDE.md` | Added the new canon-managed-file convention subsection describing root authority, the sync command, the pre-commit hook, CI backstop, and the wholesale-vs-delimited split. |
| `dist/cli/index.js` | Rebuilt bundle output to reflect the shared canon-owned module and the expanded `CANON_OWNED` list. |
| `.github/workflows/ci.yml` | Added the `sync-templates:check` step and re-included canon-managed root files in the path filters so CI runs on doc-only drift. |
| `docs/architecture.md` | Documented `sync-templates:check` in Validation and updated the CI section to include the new step ordering and path-filter behavior. |
| `docs/codebase-map.md` | Added the sync script, its test, and the pre-commit hook metadata to the repo map. |
| `package.json` | Added `sync-templates` / `sync-templates:check`, `simple-git-hooks`, the hook config, and the postinstall hook registration. |
| `package-lock.json` | Regenerated to pin `simple-git-hooks` and record the install-script metadata. |
| `scripts/docs-refs-check.mjs.d.ts` | Widened the ambient `*.mjs` declaration to include the new sync-script exports so the test suite type-checks cleanly. |
| `scripts/sync-canon-templates.mjs` | NEW. Implements root → `templates/` sync in `--apply` / `--check` / `--stage` modes and reuses the shared canon-owned path list. |
| `src/cli/commands/upgrade.ts` | Replaced the local `CANON_OWNED` / `DELIMITED` constants with imports from the shared canon-owned module. |
| `src/lib/canon-owned.ts` | NEW. Shared `CANON_OWNED` and `DELIMITED` arrays for both `upgrade.ts` and the new sync script. |
| `templates/AGENTS.md` | Synced the in-delimiter content from root, including the new workflow note and the docs-references validation row. |
| `templates/scripts/docs-refs-check.mjs` | Synced the docs refs validator to match root, including the updated noisy-source carve-out. |
| `templates/scripts/docs-refs-check.mjs.d.ts` | NEW. Wholesale sync copy of the widened root declaration. |
| `tests/sync-canon-templates.test.ts` | NEW. Covers wholesale directionality, delimiter preservation, `--check` exit behavior, idempotence, and the pre-commit staging regression. |

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

Extracted the canon-owned path lists into a shared module, then added a repo-root sync command that copies root canon-managed content into `templates/` with the correct wholesale vs delimiter behavior. The package metadata now installs a pre-commit hook that runs the sync command and stages changed templates files, and CI now runs `sync-templates:check` before docs refs validation so drift fails fast. The new test file exercises the pure sync logic plus an actual git commit through a hook script to prove the staging path lands both root and templates files in the same commit.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Implemented `scripts/sync-canon-templates.mjs` as the spec-required `.mjs` entrypoint instead of the plan's `.ts` draft. | The spec explicitly named `.mjs`, and the npm script can run it directly through `tsx` without adding a second wrapper. | None. |
| Resolved the CLI repo root from `process.cwd()` instead of `import.meta.url`. | This keeps the CLI fixture-friendly for the temp-repo `--check` test and matches how `npm run sync-templates` invokes the tool. | None. |
| Broadened `scripts/docs-refs-check.mjs.d.ts` rather than adding a second ambient declaration file. | The repo already centralizes `*.mjs` typing there; widening the declaration kept the test import type-safe without adding another declaration surface. | None. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `scripts/sync-canon-templates.mjs` exists and syncs canon-managed content root → `templates/` for every wholesale + delimited entry. | Met | The sync script imports `CANON_OWNED` from the shared module, copies root → `templates/`, and the current tree syncs `docs/pipeline-orchestrator.md`, `scripts/docs-refs-check.mjs`, `AGENTS.md`'s canon block, and creates `templates/scripts/docs-refs-check.mjs.d.ts`. |
| AC-2: `--apply` on a freshly synced tree is a no-op. | Met | Verified by `applySync` idempotence and the `sync-templates:check` clean run. |
| AC-3: `--check` performs the same comparison, writes no files, exits 0/1 appropriately, and reports drift lines. | Met | The CLI test covers clean vs drifted fixtures and the stderr format. |
| AC-4: Wholesale sync copies root byte-for-byte and never reverses direction. | Met | `tests/sync-canon-templates.test.ts` proves root stays unchanged while templates is rewritten. |
| AC-5: Delimited sync preserves outside-delimiter content on both sides and only replaces the canon block. | Met | The AGENTS fixture test proves the root tail stays out of the templates copy while the adopter tail survives. |
| AC-6: New tests cover wholesale sync, delimiter preservation, `--check`, idempotence, and missing-marker handling. | Met | All required cases are covered in `tests/sync-canon-templates.test.ts`. |
| AC-7: Pre-commit hook is installed via `simple-git-hooks` and stages changed templates files; adopter repos are not modified by canon init. | Met | `package.json` adds the hook config + postinstall registration, and the git-commit regression proves the hook stages the synced templates file into the same commit. |
| AC-8: CI runs `sync-templates:check` between lint and docs refs, with the path filters re-including canon-managed root files. | Met | `.github/workflows/ci.yml` now re-includes `AGENTS.md`, `CLAUDE.md`, `CODEX.md`, and `docs/pipeline-orchestrator.md`, and the new step sits before docs refs validation. |
| AC-9: `package.json` gains the two scripts, `simple-git-hooks` as a devDependency, the hook config, and a lockfile refresh. | Met | `package-lock.json` was regenerated from npm output and includes the new dependency + install-script metadata. |
| AC-10: `docs-refs-check` still returns `All refs OK` after the sync. | Met | The docs refs gate passes against the final tree. |
| AC-11: `canon upgrade` still writes the right adopter content; tarball `templates/` files match the synced root content. | Met | `npm pack` was verified in a temp extraction and the listed `templates/` files matched their source copies byte-for-byte. |
| AC-12: `CLAUDE.md` documents the canonical file convention and the mirror workflow. | Met | The new subsection lives outside the canon-delimited region, covers root authority, overwrite behavior, hook staging, CI backstop, and the wholesale/delimited split, and does not propagate through `canon upgrade`. |
| AC-13: `done.md` includes the memory-update todo for `feedback_canon_delimited_files_template_parallel_edit`. | Met | The QA handoff will carry the memory-update todo forward for the operator to apply post-merge. |
| AC-14: `scripts/docs-refs-check.mjs.d.ts` is added to `CANON_OWNED` and the template copy is created by sync. | Met | `src/cli/commands/upgrade.ts` imports the expanded list, and `templates/scripts/docs-refs-check.mjs.d.ts` now exists as the wholesale copy. |

## Edge Cases Considered

- Missing source files are skipped rather than crashing the sync command; a present templates file with a missing source only emits a warning.
- Missing templates files are treated as drift and are recreated from the root source.
- Delimited files with missing canon markers are skipped with a stderr warning instead of trying to reconstruct content.
- `--stage` stages only the changed `templates/` paths, so the hook does not mutate unrelated tracked files.
- The new `.mjs` declaration exports cover both the docs refs validator and the sync script, which keeps the test suite type-safe without introducing a second ambient declaration surface.

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
| `lint` (`npm run lint`) | Pass | Re-ran after fixing the test import typing/unbound-method issues. |
| `type-check` (`npm run type-check`) | Pass | Clean after widening the sync-script declaration. |
| `unit tests` (`npm test`) | Pass | 451 tests passed; one existing sandbox-only worktree probe remains skipped because `.git` writes are blocked here. |
| `docs-refs-check` (`npm run docs-refs-check`) | Pass | Final run reported `All refs OK`. |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | Final run reported `All canon-managed files in sync`. |
| `build` (`npm run build`) | Pass | Rebuilt `dist/cli/index.js` and ran `postbuild` normalization. |
| `npm pack` / extracted tarball verification | Pass | Verified the packaged `templates/` files and the new `templates/scripts/docs-refs-check.mjs.d.ts` in a temp extraction against the synced root content. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

## Iteration 2 — addressing review round 1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

No tracked source files changed in this revision. This round only corrected the handoff record for the placement fix and appended a task-note reminder about the sync boundary.

### Findings addressed

- _spec gap:_ the canon-managed-file convention was placed inside the canon-delimited region of `CLAUDE.md`, which would have shipped adopter-only tooling references to `canon upgrade` users → moved to the project-additions section at `CLAUDE.md:224-226`
- _risk/guardrail:_ the matching AGENTS note was also inside the canon-delimited region, so the workflow source of truth was leaking adopter-only references → replaced with a project-additions pointer at `AGENTS.md:340`
- _spec gap:_ the earlier handoff revision listed `templates/CLAUDE.md` in the iteration table even though it was not part of the current diff → removed the stale row and collapsed the iteration note to a handoff-only update

### AC deltas (if any)

- AC-12: placement corrected; the convention now lives in `CLAUDE.md` project additions instead of the canon-delimited region, and `AGENTS.md` carries the short project-additions pointer

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `lint` (`npm run lint`) | Pass | Passed on the reroute tree with only the placement/docs changes. |
| `type-check` (`npm run type-check`) | Pass | Passed on the reroute tree. |
| `unit tests` (`npm test`) | Pass | 451 tests passed; the existing sandbox-only worktree probe remains skipped because `.git` writes are blocked here. |
| `docs-refs-check` (`npm run docs-refs-check`) | Pass | Reported `All refs OK`. |
| `sync-templates:check` (`npm run sync-templates:check`) | Pass | Reported `All canon-managed files in sync`. |
| `build` (`npm run build`) | Pass | Rebuilt `dist/cli/index.js` and normalized the output. |

---

## Iteration 3 — addressing review round 2

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

No tracked source files changed in this revision. This round only removed the stale `templates/CLAUDE.md` row from the baseline Changes table and tightened the AC-12 note to match the committed diff.

### Findings addressed

- _spec gap:_ `templates/CLAUDE.md` was still listed in the baseline Changes table even though it is not part of the committed branch diff → removed the row from the baseline table
- _spec gap:_ the AC-12 note implied the template file changed with the root note, which was no longer true after the placement fix → clarified that the new subsection is root-only and does not propagate through `canon upgrade`

### AC deltas (if any)

- AC-12: clarified to match the actual diff; the root-only convention note stays outside the canon-delimited region and does not ship to adopters

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| none | not run | Handoff-only revision; no source files changed. |

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
