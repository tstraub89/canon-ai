# Completion Summary: fix-installed-provenance-version — Installed-package snapshot records canon version, not adopter HEAD

> For the human. This is what you need to know.

## What Changed

When canon runs as an installed npm package (a global CLI or a project dependency) rather than from its own source checkout, its task provenance stamp used to record the **adopter's** git commit as if it were canon's own commit — because the stamping logic only distinguished "vendored submodule" from "native checkout" and had no notion of "installed package" at all. In that mode there is no recoverable canon commit, so canon now records its own **version** as its identity instead of borrowing a foreign SHA: the canon commit field is set to `<unavailable>`, a new `canon_version` field records the running version (or `dev` if unversioned), the canon repository slug is preserved (honoring a `CANON_UPSTREAM_REPO` override), and the orchestrating commit still correctly tracks whichever repository actually drove the run (the adopter, or its host repository if the adopter itself is nested as a submodule). Native and vendored modes are unchanged except that they now also record `canon_version`. Two tricky misclassification risks — a linked worktree of canon's own source, and an installed canon living inside an adopter that is itself a submodule — were caught during spec review and each now has a dedicated regression test confirming they classify correctly (native and installed-package, respectively) rather than falling into the wrong branch and either blanking a real commit or re-stamping a foreign one.

## Files Changed

- `scripts/run-task/canon-snapshot.ts` — adds installed-package detection (checks canon's own source path for `node_modules`/`_npx` segments) ahead of the existing vendored/native classification; installed mode records `<unavailable>` for the canon commit and preserves the driving/host commit as `orchestrator_commit`; all modes now also resolve and record `canon_version`.
- `scripts/run-task/types.ts` — adds required `canon_version: string` to the `CanonStamp` type.
- `.canon/templates/status.json`, `templates/.canon/templates/status.json` — adds the scaffolded `canon_version` placeholder field to the `canon` block (root + synced mirror).
- `tests/run-task-canon-snapshot.test.ts` — new/extended coverage: installed-package (incl. upstream-repo override), red-first #196 regression, version resolution (explicit + `dev` fallback), native (unchanged + version), native linked-worktree classification guard, vendored (unchanged + version), installed-inside-submodule-adopter, and refresh-immutability.
- `dist/cli/index.js`, `dist/scripts/run-task.js` — rebuilt bundles (both transitively import `canon-snapshot.ts`).
- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` — §"Canon Snapshot Stamping" now documents installed-package behavior and the version field.
- `docs/decisions.md` — §"Canon provenance stamp" now notes installed-package identity-by-version and the related non-goals (no SHA-baking, no consuming the runtime `provenance.json` under `.canon` for this stamp).

## How to Test

1. In a project where canon is installed as a global CLI or project dependency (not run from canon's own source checkout), start a new task and open its task record. Expected: the canon section shows the installed canon's **version**, and never shows one of the project's own commit identifiers as canon's commit.
2. Make a few unrelated commits in that project, then let canon refresh the task. Expected: the canon version recorded for the task stays the same as the project's history moves; only the orchestrating-commit field tracks the project's current commit.
3. In a setup where canon's exact build can't be determined, open a task record. Expected: it shows the canon version and marks the canon commit as unavailable, rather than inventing a commit.
4. In canon's own repository (developing canon on itself), and in a setup where canon is embedded as a sub-component of a larger project, open task records. Expected: those records are unchanged from before this task, aside from now also naming the canon version.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (1,025 passed, 1 skipped per handoff; code review's independent rerun saw 1,027 pass) |
| Build | Pass — both declared `dist/` artifacts rebuilt; code review verified the rebuild is byte-identical to the committed one |
| docs-refs-check | Pass |
| sync-templates:check | Pass |
| git diff --check | Pass — no whitespace errors |

Code review (3-lens: anchored Claude, cold Claude, cold Codex) synthesized to **Approved with nits** — all 12 ACs (AC-1 through AC-7, including the lettered sub-criteria) verified Met, zero correctness bugs or risk/guardrail findings, zero spec gaps. Surviving nits are all pre-existing patterns or out-of-scope edge cases (see `review.md`): an empty-string `CANON_VERSION` edge case matching the spec-sanctioned expression, accepted duplication of the install-path segment check (spec-sanctioned), one unconditional discarded git call needed for AC-5b, dead-code fallback in the compiled bundle (matches the existing `bakedVersion()` pattern), and Yarn PnP installs (no `node_modules` directory) falling outside the spec's named install layouts — flagged as a future install-layout-coverage follow-up, not a defect in this task.

## Human Verification Required

None. All required checks report `Pass` in the latest Validation Outcomes table; no `human_pending` rows.

**Handoff Validation pre-merge checklist:**
- [x] Version correct — no version bump lands with this task; changelog/version bump is a separate human+Claude step per project policy.
- [x] Changelog updated if needed — proposed entry below, pending human finalization at the release step.
- [x] PR body current — see `pr-body.md`.
- [ ] Final CI/CD checks green — confirm on the opened PR.
- [x] Final diff matches spec intent — code review confirmed all ACs Met; diff matches the Affected Files list.

## Proposed Changelog

### Fixed

- **Canon's task provenance stamp no longer records the adopter's commit as canon's own identity when canon runs as an installed npm package.** The stamp discriminated only "vendored submodule" vs. "native checkout" by git topology, so an installed canon (global CLI or project dependency) fell through to the native path and recorded the adopter repository's own `HEAD` as canon's `upstream_commit` — a false canon identity confirmed live across an adopter's task history and reproducible on an exact release build ([#196](https://github.com/tstraub89/canon-ai/issues/196)). Installed-package runs now record `<unavailable>` for the canon commit and a new `canon_version` field naming the executing canon's version instead — canon's version is its identity when no commit is recoverable — while the canon repository slug (including a `CANON_UPSTREAM_REPO` override) and the driving repository's own commit are preserved unchanged. Native and vendored modes are unchanged aside from also gaining `canon_version`. Ships to adopters via `canon upgrade`.

## Decisions Made

- **Classification order is installed-package → vendored (superproject) → native.** Checking canon's own source path for install-layout segments *before* the git-topology superproject probe is what correctly separates "installed canon inside a submodule adopter" (installed-package) from "genuinely vendored canon" (a submodule path never matches the install-path predicate) — this was the second of two misclassification risks caught across spec review's six rounds.
- **`resolveCanonVersion` uses `explicit ?? process.env.CANON_VERSION ?? 'dev'`**, mirroring the existing `bakedVersion()` expression exactly rather than introducing a new version-resolution helper, per the spec's Implementation Notes.
- Spec review took six rounds before the operator sanctioned it via `canon task accept` (round 6 targeted only pre-existing, out-of-scope vendored code); code_review then converged cleanly in a single round.

## Open Questions

None raised by review. The one longer-term item noted (Yarn PnP install-layout coverage) is explicitly out of this task's scope per the spec's Known Risks (which names only local `node_modules`, pnpm virtual stores, global npm, and `npx` caches) and is a candidate for a future task, not a blocker here.
