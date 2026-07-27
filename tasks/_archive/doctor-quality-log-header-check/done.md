# Completion Summary: doctor-quality-log-header-check — canon doctor: detect stale/malformed task-quality-log.md header

> For the human. This is what you need to know.

## What Changed

`canon doctor` now checks whether an adopter's `docs/task-quality-log.md` header still matches what the QA-phase writer requires. Previously nothing checked this proactively: an adopter could upgrade canon, keep a stale/malformed quality-log header, and the writer would silently skip logging every QA row (the writer is deliberately fail-soft) with no way to discover it later beyond a background process's console output. The new check reuses the writer's own table-detection logic (now exported, not reimplemented) so it can never drift out of sync with what the writer actually requires: a missing file passes (the writer creates one fresh on first write), a well-formed header passes, and a malformed header or unreadable file produces a warning naming the file and pointing at the reference template shape. `canon upgrade` is untouched — it still doesn't read or write this file in any mode.

## Files Changed

- `scripts/run-task/quality-log.ts` — exported previously-private `CANON_LOG_HEADERS` and `locateLogTable` (export-only, no logic change)
- `src/cli/commands/doctor.ts` — added `checkQualityLog(cwd)`, wired into `doctorCmd`'s `canonChecks` array
- `tests/cli.test.ts` — new tests: missing file (pass), well-formed header (pass), malformed header (warn), unreadable path (warn, no throw)
- `docs/codebase-map.md` — new row for `scripts/run-task/quality-log.ts`; updated doctor row description
- `dist/cli/index.js` — regenerated build artifact (doctor.ts now bundles the quality-log module)

## How to Test

1. In a repo with canon-ai installed, delete `docs/task-quality-log.md` if present, then run `canon doctor`. Expected: the "Canon setup" section shows the quality-log check passing (or simply absent from warnings) — a missing file is not flagged.
2. Restore a normal `docs/task-quality-log.md` and run `canon doctor` again. Expected: the check passes.
3. Hand-edit the `## Log` table header to remove one required column (e.g., delete `Notes` from the header row only), then run `canon doctor`. Expected: a warning naming the file and pointing at the reference template shape — not a hard failure that blocks `canon doctor`'s exit code by itself.
4. Restore the original header. Expected: `canon doctor` returns to passing.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (full suite: 1066 passed, 1 skipped, 0 failed) |
| E2E tests | deferred_by_spec — no UI surface changed |
| Build | Pass (only `dist/cli/index.js` changed; `dist/scripts/run-task.js` unchanged) |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | deferred_by_spec — no `CANON_OWNED`/`DELIMITED` files changed |
| `git diff --check` | Pass (no whitespace errors) |
| Upgrade immutability grep/diff | Pass — `src/cli/commands/upgrade.ts` unchanged, no `task-quality-log` reference |

## Human Verification Required

None. No `human_pending` checks remain in the latest Validation Outcomes table.

**Handoff Validation pre-merge checklist:**
- [x] Version correct — unversioned change; minor bump proposed at the release step, not here
- [x] Changelog updated if needed — draft entry below, to be finalized at `/canon-changelog`
- [x] PR body current — see `pr-body.md`
- [x] Final CI/CD checks green — all local validation checks passed (table above)
- [x] Final diff matches spec intent — all 10 ACs met per handoff.md AC Coverage table

## Proposed Changelog

- **`canon doctor` now detects a stale or malformed `docs/task-quality-log.md` header.** The QA-phase writer (`upsertQualityLogRow`) has always been fail-soft: if the `## Log` table header is missing a required column, it warns and skips the row rather than blocking the `qa → done` transition — but nothing checked for this proactively, so an adopter running an older header shape after upgrading canon could lose quality-log rows silently, with the only signal a `console.error` from a possibly-detached background run. `canon doctor` now reads `docs/task-quality-log.md` and reports the same header check the writer itself uses (a missing file still passes, since the writer creates one fresh on first write) — a malformed or unreadable file now surfaces as a warning naming the file and the reference template shape, instead of going undiscovered. `canon upgrade` is unchanged. Ships to adopters via `canon upgrade`.

## Decisions Made

- Delegated all header-detection logic to the writer's own `locateLogTable`/`CANON_LOG_HEADERS` (exported, not reimplemented) so the doctor check can never silently drift out of sync with what the writer requires.
- `warn`, not `fail`, matches the writer's own fail-soft posture — this check surfaces the risk without turning `canon doctor` into a hard gate over a file the writer already tolerates being wrong.
- `checkQualityLog` uses doctor's existing plain-`cwd` convention (not worktree-routed like the writer's `activeCwd`), consistent with every other doctor check — it deliberately checks the supervising checkout, not an in-flight task's worktree copy.
- Read errors other than "file missing" are caught and downgraded to `warn` rather than propagating, matching the existing `checkCodexProjectTrust` pattern in `doctor.ts`.

## Open Questions

None raised by review. Two gaps are intentionally out of scope per the spec's Known Risks: (1) a stale globally-installed canon won't have this check at all until the adopter upgrades canon itself; (2) there's no durable persistence of skipped-row warnings surfaced later in `canon status`/`canon watch` — filed as a separate follow-up, not part of this task.

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Clean run — spec approved_with_nits, code_review approved_with_nits, all 10 ACs met, full validation suite passed with no human_pending items.
