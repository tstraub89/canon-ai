# Code Review: doctor-quality-log-header-check

> Reviewer: Claude | Spec: `tasks/doctor-quality-log-header-check/spec.md`
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

The foreman independently re-ran `npm run build` against the final source tree and confirmed `git status --porcelain -- dist/` is clean afterward — `dist/` is a faithful build of source, not stale (AC-10). Only `dist/cli/index.js` changed, matching the handoff's claim.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `export const CANON_LOG_HEADERS` and `export function locateLogTable` at `scripts/run-task/quality-log.ts:9,134`; export-only, no logic change; `tests/run-task-quality-log.test.ts` untouched and still passing. |
| AC-2 | Met | `checkQualityLog` (`src/cli/commands/doctor.ts:287`) imports `getQualityLogFile`/`locateLogTable` and calls `locateLogTable(content.split('\n'))` directly — no local reimplementation of the header-membership check. |
| AC-3 | Met | `checkQualityLog: missing file → pass` unit test passes. |
| AC-4 | Met | `checkQualityLog: well-formed log table → pass` unit test passes, fixtured from the repo's real `docs/task-quality-log.md`. |
| AC-5 | Met | `checkQualityLog: malformed header → warn...` unit test passes; `detail` contains both the relative file path and the `templates/docs/task-quality-log.md` reference. |
| AC-6 | Met | `checkQualityLog(cwd)` present in `canonChecks` array, `doctor.ts:701`, alongside `checkTemplates`/`checkCanonVersion`/`checkSkills`. |
| AC-7 | Met | `git diff main...HEAD -- src/cli/commands/upgrade.ts` is empty; `grep task-quality-log src/cli/commands/upgrade.ts` returns no matches. |
| AC-8 | Met | `docs/codebase-map.md` gained a new row for `scripts/run-task/quality-log.ts`; the doctor row's description now mentions "task-quality-log header." |
| AC-9 | Met | `checkQualityLog: unreadable path → warn instead of throwing` unit test passes; the generic catch (non-`ENOENT`) returns `warn` with a "could not read" detail rather than propagating. |
| AC-10 | Met | Foreman-verified: fresh `npm run build` produces a dist identical to the committed one. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work — no auto-migration, no `canon upgrade` changes, no writer fail-soft contract changes, no `CANON_LOG_HEADERS` content changes)
- [x] Known Risks addressed or documented as accepted (cwd-not-worktree-aware convention explicitly inherited per spec's stated rationale; dist staleness risk closed by independent build verification)
- [x] Human Test Plan is satisfiable by the implementation (missing file → pass, well-formed → pass, malformed header → warn, restore → pass — all directly exercised by the unit tests and the check's logic)

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

Small, well-scoped change. The doctor check is a thin, read-only wrapper around the writer's own `locateLogTable`/`getQualityLogFile`, exactly as the spec required — no parallel reimplementation of header-detection logic. Error handling distinguishes `ENOENT` (pass, self-heals) from other read failures (warn, doesn't throw) per AC-9. Tests cover all four boundary cases (missing, well-formed, malformed, unreadable). Both Claude lenses and the pre-obtained cold-Codex lens independently signaled approve/clean, with only low-severity, low-confidence polish notes surfacing — no correctness bugs, no test-integrity issues, no spec gaps.

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none)

#### Optional Cleanup / Nit

- **Path-format inconsistency between the check's two warn branches.** `src/cli/commands/doctor.ts:311` (read-error branch) reports the absolute `logPath` in its detail message, while the malformed-header branch a few lines below computes and displays `relative(cwd, logPath)`. Not spec-mandated (AC-9 only requires the failure be named, not a specific path format) but worth normalizing for consistent doctor output. *(Flagged by 1 lens: anchored.)*
- **`CANON_QUALITY_LOG_FILE_OVERRIDE` can make the check's displayed label diverge from the file it actually reads.** `checkQualityLog` resolves its target via `getQualityLogFile(cwd)`, which honors a test-only env-var override independent of `cwd`. Every other doctor check in this file resolves its target via a plain `join(cwd, ...)`. If that env var were ever set in the process running `canon doctor` (a real-world footgun only if a test harness or wrapper script leaks it into an interactive shell), the check would silently validate a different file than the one named in its label/detail. Foreman verified `CANON_QUALITY_LOG_FILE_OVERRIDE` is genuinely test-only infrastructure (used only in `tests/task-cli.test.ts` / `tests/run-task-safety.test.ts`, referenced in `docs/BACKLOG.md`), so this is a theoretical footgun, not an active bug — the check correctly delegates to the writer's own path-resolution for consistency (which is the spec's explicit intent), and the override existing at all predates this task. *(Flagged by 2 lenses: anchored + cold-Claude — cross-model agreement, but both independently rated it low severity/low-medium confidence and this reviewer concurs it's a nit: the override is test-injection-only, not a production doctor-usage path.)*
- **Hardcoded advice string `templates/docs/task-quality-log.md` isn't derived from any shared constant.** If the template's location ever moves, this guidance goes stale with no compiler/test signal (the test asserts against the same literal string). *(Flagged by 1 lens: cold-Claude.)*
- **AC-4's "well-formed" fixture copies the live repo's own `docs/task-quality-log.md`** rather than using a synthetic minimal fixture, coupling that test's pass/fail to the current state of a document every task's QA phase edits. *(Flagged by 1 lens: anchored.)*
- **Widened public surface of `quality-log.ts`.** `CANON_LOG_HEADERS`, `LocatedLogTable`, and `locateLogTable` are now exported solely for `doctor.ts`'s reuse. This is the spec's explicit intent (AC-2, single source of truth) rather than an accident, but it does mean any future change to `locateLogTable`'s behavior (e.g. header-uniqueness handling) now has a second consumer to consider. No current divergence found. *(Flagged by 1 lens: cold-Claude.)*
- **Uniform `warn` treatment of all non-`ENOENT` read failures** (permissions error, directory-instead-of-file, etc.) means a real permissions problem is reported identically to a directory-shape edge case. This matches AC-9's explicit design intent (mirrors the writer's own `ENOENT`-vs-other-errors posture and the existing `checkCodexProjectTrust` pattern) — not a gap, just noted for completeness. *(Flagged by 1 lens: cold-Claude.)*

#### Spec Gaps

(none)

### Dismissed Cold Findings

- Dismissed (cold-Codex): no findings raised — cold-Codex's pass-through summary ("delegates to the existing parser, handles missing and unreadable files appropriately, is wired into the CLI, and the generated bundle is consistent") aligns with Stage 1/2 above; nothing to dismiss.

All cold-Claude and anchored findings above were verified against the diff/code and retained as nits (none reached code-bug or spec-gap altitude) — none were dismissed as invalid.

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
