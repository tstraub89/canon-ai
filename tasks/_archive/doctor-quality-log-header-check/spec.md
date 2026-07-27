# Spec: doctor-quality-log-header-check — canon doctor: detect stale/malformed task-quality-log.md header

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

`scripts/run-task/quality-log.ts`'s `upsertQualityLogRow` (the writer invoked inside `taskPhase()`'s `qa → done` transition, shipped in v2.4.0 as `reconcile-qa-quality-log-summary`, PR #213) is deliberately fail-soft: when `locateLogTable` can't find a `## Log` table whose header contains every column in `CANON_LOG_HEADERS`, it calls `warn()` (`console.error`) and skips the row rather than blocking the transition (`docs/decisions.md` §"Task quality-log row upserted at the qa → done transition": "the write must remain fail-soft"). That fail-soft contract is correct and stays unchanged by this task.

The gap is detection, not fail-soft-ness. This happened for real: an adopter repo's `docs/task-quality-log.md` still had the pre-2.4.0 header shape after upgrading to an installed 2.4.0. Nothing checks an adopter's `docs/task-quality-log.md` header proactively — not `canon doctor`, not `canon upgrade` (confirmed: `docs/task-quality-log.md` appears in neither `CANON_OWNED` nor `DELIMITED` in `src/lib/canon-owned.ts`, nor in `HEADER_ONLY_SYNC` in `src/cli/commands/upgrade.ts`, which lists only `docs/pipeline-invocations.md` — `canon upgrade` never reads, writes, or reports on this file in any mode). Two tasks ran through `qa → done` during a detached/background run; the writer's `warn()` went only to that process's `console.error`, nobody was watching it live, and both tasks now have no quality-log row at all — the warning was real but undiscoverable after the fact.

This is a detection/observability gap, confirmed by reading the source (`scripts/run-task/quality-log.ts:293-348`, `src/cli/commands/upgrade.ts`, `src/lib/canon-owned.ts`) and cross-checked against the already-open backlog item anticipating exactly this scenario (`docs/BACKLOG.md` §"Verify the quality-log writer live under an installed 2.4.0"). Not a bug-fix task — no regression test applies; this is new detection surface, not a change to existing wrong behavior.

## Decision

Add a new `canon doctor` check, `checkQualityLog(cwd)`, that reads the repo's `docs/task-quality-log.md` (via `getQualityLogFile(cwd)`) and reports whether its `## Log` table header still contains every column `CANON_LOG_HEADERS` requires — using the writer's own detection logic, not a reimplementation, so the check can never silently drift out of sync with what the writer actually requires.

- `docs/task-quality-log.md` absent → `pass` (the writer self-heals: `upsertQualityLogRow` creates the file fresh from `STANDARD_QUALITY_LOG_SKELETON` on first write, so a missing file is not a problem state).
- File present, `locateLogTable` finds a well-formed `## Log` table → `pass`.
- File present, `locateLogTable` returns `null` (no `## Log` heading, no table under it, or a header missing a required column) → `warn`, with a `detail` string naming the file path and pointing at `templates/docs/task-quality-log.md` as the reference header shape.

`checkQualityLog` joins the existing `canonChecks` array in `doctorCmd` (`src/cli/commands/doctor.ts`), alongside `checkTemplates` / `checkCanonVersion` / `checkSkills` — same section, same `Check` shape, same `pass`/`warn`/`fail` display convention. `warn` (not `fail`) matches the writer's own fail-soft posture — this check surfaces the risk without turning `canon doctor` into a new hard gate over a file the writer already tolerates being wrong.

To make this possible without duplicating `locateLogTable`'s parsing logic in `doctor.ts`, `scripts/run-task/quality-log.ts` exports two symbols that are currently module-private (verified via grep — each has exactly one call site today, both inside `quality-log.ts` itself): `CANON_LOG_HEADERS` (a static readonly string tuple) and `locateLogTable` (a pure function, `readonly string[] → LocatedLogTable | null`, no I/O). Both changes are export-only — no logic changes, so `upsertQualityLogRow`'s existing behavior and its existing tests (`tests/run-task-quality-log.test.ts`) are unaffected.

## Non-Goals

- No auto-migration or repair of a malformed header. The check reports the problem; fixing the file (adding missing columns, hand-editing, or a future dedicated migration) is left to the operator.
- No change to `canon upgrade` — it still doesn't read, write, or report on `docs/task-quality-log.md` in any mode. This task adds a `canon doctor` check only.
- No change to the writer's fail-soft contract (`upsertQualityLogRow` in `scripts/run-task/quality-log.ts` keeps warning and skipping on a malformed header — this task does not touch that function's behavior).
- No durable persistence of skipped-row warnings (e.g., surfacing a skip in `canon status`/`canon watch` after the fact). Filed as a separate follow-up; this task is detection-at-`canon doctor`-time only.
- No changes to `CANON_LOG_HEADERS`'s contents or to the `## Log` table schema itself.

## Acceptance Criteria

- [ ] AC-1: `scripts/run-task/quality-log.ts` exports `CANON_LOG_HEADERS` and `locateLogTable` (adding the `export` keyword only — no signature or logic change). Verify: `grep -n "^export const CANON_LOG_HEADERS" scripts/run-task/quality-log.ts` and `grep -n "^export function locateLogTable" scripts/run-task/quality-log.ts` both match; `npm test` still passes `tests/run-task-quality-log.test.ts` unchanged.
- [ ] AC-2: `src/cli/commands/doctor.ts` defines `export function checkQualityLog(cwd: string): Check` that imports `getQualityLogFile` and `locateLogTable` from `scripts/run-task/quality-log.ts` (no local reimplementation of the header-membership check). Verify: read the function; it calls `locateLogTable` and does not contain its own copy of a "header contains all required columns" comparison.
- [ ] AC-3: When `getQualityLogFile(cwd)` resolves to a path that does not exist, `checkQualityLog(cwd)` returns `{ status: 'pass', ... }`. Verify: unit test in `tests/cli.test.ts` with a `withTempDir` fixture containing no `docs/task-quality-log.md`, asserting `status === 'pass'`.
- [ ] AC-4: When the file exists with a well-formed `## Log` table (all `CANON_LOG_HEADERS` columns present, in any order), `checkQualityLog(cwd)` returns `{ status: 'pass', ... }`. Verify: unit test with a fixture built from the real skeleton (`docs/task-quality-log.md`'s own current header, or `STANDARD_QUALITY_LOG_SKELETON`'s shape), asserting `status === 'pass'`.
- [ ] AC-5: When the file exists but its `## Log` table header is missing at least one required column (mirroring the existing malformed-header fixture pattern in `tests/run-task-quality-log.test.ts`, e.g. a header with `Notes` removed), `checkQualityLog(cwd)` returns `{ status: 'warn', ... }` with a `detail` string that names the file's relative path and mentions `templates/docs/task-quality-log.md` as the reference shape. Verify: unit test asserting `status === 'warn'` and `detail` matches both substrings.
- [ ] AC-6: `checkQualityLog(cwd)` is wired into `doctorCmd`'s `canonChecks` array in `src/cli/commands/doctor.ts`, so a real `canon doctor` invocation includes it in the printed "Canon setup" section. Verify: read `doctorCmd`'s `canonChecks` array construction; `checkQualityLog(cwd)` appears alongside `checkTemplates(cwd)` / `checkCanonVersion(cwd)` / `checkSkills(cwd)`.
- [ ] AC-7: `canon upgrade` is unmodified by this task — it still does not reference `docs/task-quality-log.md` anywhere. Verify: `git diff <base>...HEAD -- src/cli/commands/upgrade.ts` is empty, and `grep -n "task-quality-log" src/cli/commands/upgrade.ts` returns no matches (same as before this task).
- [ ] AC-8: `docs/codebase-map.md` gains a row for `scripts/run-task/quality-log.ts` (currently absent — confirmed by its absence today) describing the writer and its exported detection symbols, and the existing doctor row's description is updated to mention the new check. Verify: `grep -n "quality-log.ts" docs/codebase-map.md` matches a new row; the doctor row's detail text mentions the quality-log check.
- [ ] AC-9: When reading `docs/task-quality-log.md` fails for a reason other than the file not existing (e.g. a permission error, or the path being a directory), `checkQualityLog(cwd)` catches the error and returns `{ status: 'warn', ... }` naming the failure — it must not let the exception propagate and abort the rest of `canon doctor`. This matches the writer's own posture (`upsertQualityLogRow` distinguishes `ENOENT` self-heal from other read errors, which it warns on) and the existing `checkCodexProjectTrust` pattern in `doctor.ts` of catching and downgrading to `warn` rather than the uncaught-`readFileSync` pattern some other checks use. Verify: unit test in `tests/cli.test.ts` with a fixture where the quality-log path is a directory (or otherwise unreadable), asserting `checkQualityLog` returns `status: 'warn'` rather than throwing.

- [ ] AC-10: The committed `dist/` bundle is regenerated from the final source state, not left stale. Verify: after the source and test changes are in place, run `npm run build`, then `git diff --exit-code -- dist/` exits 0 with the regenerated artifacts staged/committed (the same gate CI enforces). At least `dist/cli/index.js` must show a delta relative to the base ref, since `doctor.ts` changed; `dist/scripts/run-task.js` may or may not change and both outcomes are acceptable — what is not acceptable is a committed `dist/` that differs from a fresh build.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/quality-log.ts` | Add `export` to `CANON_LOG_HEADERS` and `locateLogTable` — no other change |
| `src/cli/commands/doctor.ts` | Add `checkQualityLog(cwd: string): Check`; add it to `canonChecks` in `doctorCmd` |
| `tests/cli.test.ts` | New tests: missing file (pass), well-formed (pass), malformed header (warn) |
| `docs/codebase-map.md` | New row for `scripts/run-task/quality-log.ts`; update doctor row's description |
| `dist/cli/index.js` | Generated build artifact — rewritten by `npm run build`. `src/cli/commands/doctor.ts` changes, and it newly imports `scripts/run-task/quality-log.ts`, so that module gets bundled into this entry point. Commit the regenerated file; do not hand-edit |
| `dist/scripts/run-task.js` | Generated build artifact — rewritten by `npm run build` if the `export`-keyword change to `scripts/run-task/quality-log.ts` alters this bundle's output (it already bundles that module via `scripts/run-task.ts`). Declared so the `--pr` base-drift gate accepts it whether or not the build touches it; commit it if `git status` shows it dirty after a fresh build, do not hand-edit |

### Interaction Dependencies

None beyond the files above. `checkQualityLog` is read-only (no writes to `docs/task-quality-log.md`), so it cannot interact with the `qa → done` writer's own read/write cycle, worktree state, or any in-flight task. `doctor` and `upgrade` both resolve `cwd` via plain `process.cwd()` (confirmed: neither does worktree/`activeCwd` resolution) — this check follows that same convention and checks the supervising checkout's copy, consistent with every other doctor check.

### Data Model Changes

None. No change to `CANON_LOG_HEADERS`'s contents, the `## Log` table schema, or `status.json`.

## Validation Required

Universal change-type → check-category matrix (project command bindings are in `docs/architecture.md` §Validation):

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |
| UI / interaction changes | End-to-end tests |
| Content / SEO / metadata | Prerender / sitemap / feed regeneration |
| Schema / migration | Migration runner + manual review |
| Cross-platform | Subset of the above on each platform |

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; existing `tests/run-task-quality-log.test.ts` must still pass unchanged (export-only change), plus new `tests/cli.test.ts` cases from AC-3/4/5
- [x] `npm run build` — required: both edited source files feed the published `dist/` bundle. `src/cli/commands/doctor.ts` bundles into `dist/cli/index.js`, and `scripts/run-task/quality-log.ts` bundles into `dist/scripts/run-task.js` (via `scripts/run-task.ts`) *and*, after AC-2's new import, into `dist/cli/index.js` as well. Run a fresh build and commit every `dist/` delta — CI runs `npm run build && git diff --exit-code -- dist/` and fails on a stale committed `dist/` (`docs/architecture.md` §Validation)
- [ ] `<E2E>` — N/A, no UI surface
- [x] `npm run docs-refs-check` — this task edits `docs/codebase-map.md`
- [ ] `npm run sync-templates:check` — not applicable; none of the edited files are in `CANON_OWNED`/`DELIMITED` (confirmed: `docs/codebase-map.md` is root-only, no template mirror, same as `docs/decisions.md`)

## Docs Impact

- `docs/codebase-map.md` — new row for `scripts/run-task/quality-log.ts`; doctor row description updated (see AC-8).

## Known Risks

- **Doctor's `cwd` is not worktree-aware, unlike the writer's `activeCwd`.** The writer always resolves `docs/task-quality-log.md` via `resolveTaskCwd(id)` (worktree-routed); `doctor` and `upgrade` both use plain `process.cwd()`. This check inherits doctor's existing convention deliberately (doctor checks the supervising checkout's health, not any single in-flight task's worktree copy) — this is not a bug to fix here, but worth stating explicitly so a reviewer doesn't read it as an inconsistency with the writer.
- **False confidence if the check passes locally but an adopter runs an older `canon doctor`.** A stale globally-installed canon (e.g., an adopter who hasn't run `canon upgrade` recently) won't have this check at all — `doctor` itself can't retroactively appear in an older install. This task doesn't (and per the pipeline-uses-installed-canon pattern, can't) close that gap; it only helps once the adopter is on a canon version that ships this check and actually runs `canon doctor`.
- **Forgetting the build leaves `dist/` stale and bounces the task late.** The new `doctor.ts` → `quality-log.ts` import pulls a previously CLI-external module into the `dist/cli/index.js` bundle, so the diff there is larger than the source change suggests. Skipping `npm run build` passes lint/type-check/tests locally and then fails CI's `git diff --exit-code -- dist/`; committing a dist artifact the spec didn't declare fails the `--pr` base-drift gate instead. Both artifacts are declared above for that reason.
- **Exporting `CANON_LOG_HEADERS`/`locateLogTable` widens `quality-log.ts`'s public surface.** Both are read-only/pure with a single existing internal caller each; exporting adds no new behavior, but any future refactor of `locateLogTable`'s signature must now consider `doctor.ts` as a second consumer, not just the writer.

## Human Test Plan

1. In a repo with canon-ai installed, delete `docs/task-quality-log.md` if present, then run `canon doctor`. Expected: the "Canon setup" section shows the quality-log check as passing (or simply absent from warnings) — a missing file is not flagged.
2. Restore a normal `docs/task-quality-log.md` (or use the one already in this repo) and run `canon doctor` again. Expected: the quality-log check passes.
3. Hand-edit `docs/task-quality-log.md`'s `## Log` table header to remove one required column (e.g., delete the `Notes` column from the header row only), then run `canon doctor`. Expected: the check reports a warning naming the file and pointing at the reference template shape — not a hard failure that blocks `canon doctor`'s exit code by itself.
4. Restore the original header afterward. Expected: `canon doctor` returns to passing.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A, full tier (S)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names) — file names used are the artifacts the human is asked to edit/observe, unavoidable for a CLI-tool test plan with no other UI surface
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes; N/A for features/refactors) N/A — this is new detection surface, not a fix to existing wrong behavior; no regression test applies
