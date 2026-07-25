# Spec: reconcile-qa-quality-log-summary — Write the QA task-quality-log row from task state at the qa→done transition

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The QA phase appends a one-row task summary to `docs/task-quality-log.md`. The only instruction governing it is a single prompt line — `scripts/run-task/prompts/templates/qa.md:47`: "Append one row per task to docs/task-quality-log.md (see that file for column definitions)." No code writes the row; there is no per-task row identity, no upsert rule, no derivation from task state, and nothing constrains where the row lands. The mechanism is **deterministic** (fixed inputs hit the same behavior every run), confirmed two ways: source inspection (grep across `scripts/`/`src/` finds no writer — only the prompt line and telemetry-allowlist references) and James's completed-reroute reproduction.

Two failures follow directly:

1. **The first-pass snapshot becomes the permanent record.** When a task reroutes through spec_review → implement → code_review → QA again, nothing revisits the original row. James's `schedule-date-corrections` finished with `status.json` counters `spec_review.iterations_total: 6` and `code_review.iterations_total: 2`, while its quality row still read `Spec iter: 1 / Review iter: 1`.

2. **Rows land outside the table.** Nothing anchors the append inside the `## Log` table, so rows can land below the `## Periodic Reviews` heading (James saw five). Those rows are outside the trend-analysis surface entirely.

**Which columns can be derived, and which cannot.** Exactly two have a sound source in task state — monotonic, retained across resets and reroutes:

| Column | `status.json` source |
|---|---|
| Spec iter | `phases.spec_review.iterations_total` |
| Review iter | `phases.code_review.iterations_total` |

James's headline discrepancy lives entirely in these two. The rest cannot be derived and must stay QA-authored:

- **Human reroute?** — no durable human-only signal exists. `implement.reroute_count` is bumped by `rerouteFromHumanReview()` (`scripts/run-task/main.ts:2447`), but that function serves **both** genuine `human_review` reroutes **and** blocked `code_review` `spec_gap` reroutes (`main.ts:2346-2367`, labeled `code_review spec_gap` at `main.ts:2420`), incrementing for every bundle member either way. Archived `ship-shared-doc-dirt-preservation` has `reroute_count: 2` with a correct `Human reroute? No`.
- **Spec verdict** — the schema defines it as the **first** spec_review verdict (`docs/task-quality-log.md:21`), but `status.json` retains only the latest and clears it on reset (`src/task/index.ts`). Not derivable from current status, though the prior artifact is archived on disk.
- **Dropped ACs / Validation gaps / Notes** — qualitative QA judgment.

**Where the write must happen.** All four paths that set `qa → done` funnel through `taskPhase` (`src/task/index.ts`): the QA agent running the rendered phase command inside its own session (`phaseCommands(..., 'qa', 'done')`), the `done.md`-salvage branch in `runQaPhase` (`scripts/run-task/phases/qa.ts`), `tryEvidenceAdvance`'s `qa` case (`scripts/run-task/main.ts:2890`), and the operator/skill recovery documented in `.claude/skills/canon-pipeline/SKILL.md` and `recovery.md`. `taskPhase` already performs a derived write at this exact point — `updateReviewCounters` — and `done.md` is on disk on every one of those paths. So the transition itself is the one place a row write covers every path with no agent cooperation.

Impact: portfolio trend data contradicts task state, efficiency comparisons reward tasks with stale or misplaced records, and readers cannot tell a final summary from a first-QA snapshot. Related: closed issue #34 (missing QA observability rows) — this is the reroute-staleness variant, not merely a missing row.

## Decision

A deterministic writer, invoked from the `qa → done` transition, owns the task's quality-log row:

1. **One row per task, keyed by task id, correct by construction.** Because the write happens inside the transition, every path that completes QA produces the row — no agent step to skip, no path to forget. A second QA pass after a reroute updates that row in place rather than appending a duplicate.

2. **The writer owns placement.** The row is written inside the `## Log` table: after the header separator, before `## Periodic Reviews` when that heading exists, else at the end of the table. A data row is never emitted below `## Periodic Reviews`. If the task's **own** row already sits outside the table, the writer relocates it inward rather than leaving a duplicate stranded.

3. **Derived columns come from task state; judgment columns come from QA.** The five derived cells have exactly one source each, and none is ambiguous:

   | Cell | Source |
   |---|---|
   | Date | The UTC calendar date at write time. **Not** read from `status.json` — neither `created` nor `updated` is the row's meaning, and `updated` is mutated in memory by the transition before its atomic write, so reading it would be order-dependent. Refreshed on every write, so the row dates the most recent QA completion. |
   | Task | The task id. |
   | Size | `task_size ?? 'M'` (matching `maxSize` in `scripts/pipeline-policy.ts`), suffixed ` delicate` when `delicate` is true — the format existing rows already use (`M delicate`, `S`). |
   | Spec iter | `phases.spec_review.iterations_total ?? 0` |
   | Review iter | `phases.code_review.iterations_total ?? 0` |

   `Spec verdict`, `Human reroute?`, `Dropped ACs`, `Validation gaps`, and `Notes` are supplied by QA through a delimited block in `done.md`; on a re-upsert, any cell QA omits keeps the existing row's value. That is what lets the first-recorded `Spec verdict` persist across a reroute while QA can still correct `Human reroute?` on a later pass. No column is fabricated from an unsound source.

4. **Cells are placed by header name, never by fixed position.** The writer reads the `## Log` table's actual header row and writes each cell under its matching header, mirroring how the existing parser maps cells (`scripts/run-task/markdown-table.ts`). Columns the writer does not own — an adopter's added column — are preserved: their existing values are carried through on an update and left empty on an insert. If the header is missing any of the ten canon columns the writer needs, the table is treated as malformed: warn and skip rather than write. A positionally-fixed row is explicitly forbidden, because an adopter column inserted anywhere but the end would silently file every subsequent value under the wrong header — a successful but misaligned write, which no fail-soft check can catch.

5. **Pre-existing duplicates are reconciled by an explicit per-cell precedence.** The old blind-append mechanism can already have left a task with several rows — two inside `## Log`, or one inside plus a stray below `## Periodic Reviews`. The writer converges to exactly one in-table row and removes the task's other copies. When those rows **disagree**, the surviving value is decided per cell, in document order (top to bottom, across both sections — for an append-only log that order is chronological):

   | Cell(s) | Rule | Why |
   |---|---|---|
   | `Spec verdict` | **Earliest** non-empty value wins | The schema defines this column as the *first* spec_review verdict (`docs/task-quality-log.md:21`); taking the latest would destroy exactly the value the column means. |
   | `Human reroute?`, `Dropped ACs`, `Validation gaps`, `Notes` | **Latest** non-empty value wins | These are corrigible judgments — a later QA pass exists to supersede an earlier reading. |
   | Adopter-added columns | **Latest** non-empty value wins | Same corrigible-judgment default; canon has no semantics for them. |
   | Derived cells | Not applicable — always recomputed from task state | See item 3. |

   A cell empty in every duplicate stays empty. QA-supplied values for the current pass take precedence over all reconciled history, per item 3.

6. **Judgment values are normalized first, then round-trip exactly.** Serialization is a two-step contract against canon's own parser, `splitTableLine` (`scripts/run-task/markdown-table.ts`):

   - **Step 1 — normalization (lossy, declared).** Line breaks are flattened to a single space: both `\n` and `\r\n`. This is unavoidable, not a choice — the parser reads one table row per physical line, so a line break cannot survive inside a cell. The normalized string, not the raw input, is the value of record.
   - **Step 2 — exact round-trip (lossless).** Every character surviving normalization must parse back to the identical string. That requires escaping **backslashes before pipes**, because the parser treats a pipe as escaped only when preceded by an **odd** run of backslashes. Citing `safeCell` (`scripts/run-task/metrics.ts`) as the convention is not enough: it escapes pipes but not backslashes, so a `Notes` value of `a\|b` serializes to an even backslash run, the parser splits on that pipe, and the cell silently truncates to `a\`.

   (The same latent gap in `safeCell` itself is out of scope — `docs/pipeline-invocations.md` cells are model names and statuses, not free prose.)

7. **The write never breaks the pipeline.** A quality-log write failure — unreadable or malformed log, missing or incomplete `## Log` header, I/O error — emits a loud warning and lets the phase transition proceed. Telemetry must not become a new way for `qa → done` to fail. An absent log file is created with the standard header and table rather than treated as an error.

8. **Attempt history is retained.** The writer touches only the task's own row. It never mutates `status.json` counters or per-round artifacts (`spec-review.md`, `review.md`, `spec-review-prior-N.md`) — those already encode the full attempt history, so it survives without a new event log.

**No qa-done rejection path.** Once the transition owns the write, a missing, misplaced, or duplicated row is structurally impossible rather than something to detect, so this task adds no gate and no new way to block `qa → done`. Operator decision (2026-07-24), recorded because the issue's minimum-compatible shape named a blocking completeness check: the check's intent is met by construction, and adding a rejection path to a load-bearing state transition would create a false-block surface for every task in exchange for catching only a manual hand-edit of the log.

## Non-Goals

- **No immutable per-attempt event log.** The issue's "preferred" design (per-attempt events with `event_id`, subject SHA/digest, reason codes, and regenerated Markdown) waits for adopter pull.
- **No qa-done gate or blocking completeness check.** See the Decision's closing note. Nothing in this task may add a rejection path to `qa → done`.
- **No derivation of `Spec verdict` or `Human reroute?` from `status.json`.** Both lack a sound source (see Problem). An implementation must not "helpfully" derive `Human reroute?` from `implement.reroute_count`.
- **No new `status.json` field.** This task does not add a persisted human-reroute flag or first-verdict field to close the derivation gap — schema growth on a delicate surface for low value.
- **No retroactive cleanup of other tasks' rows.** Historical rows stay as written; already-misplaced rows belonging to *other* tasks are left alone. (The writer relocates only the row for the task it is writing — per Decision item 2.)
- **No column-schema change.** The `## Log` table's 10-column header and the `## Periodic Reviews` boundary are unchanged. Correcting the stale "appends"/"append-only" prose that describes the *behavior* is in scope; the column schema is not.

## Acceptance Criteria

- [ ] **AC-1 (derived counters — red-first):** For a task whose `status.json` has `spec_review.iterations_total = 6` and `code_review.iterations_total = 2`, completing QA yields a row reading `Spec iter = 6` and `Review iter = 2`. A test seeds James's `schedule-date-corrections` counter values; it fails against the current blind-append behavior (which leaves `1 / 1`) and passes after the fix. A second case omits both `iterations_total` fields entirely (both are optional on `PhaseEntry` and validation accepts them absent) and asserts `0 / 0` rather than a throw or a blank cell.
- [ ] **AC-1b (`Date` and `Size` cells bound exactly):** `Date` is the UTC calendar date at write time and is refreshed on a re-upsert — a test asserts it does not come from `status.created` or `status.updated` by seeding those to distinct sentinel dates and checking neither appears. `Size` renders `task_size ?? 'M'` plus a ` delicate` suffix when `delicate` is true — tests cover an explicit size, an absent `task_size` (expects `M`), and a delicate task (expects the suffix, matching the format existing rows use).
- [ ] **AC-2 (upsert — exactly one row):** After an initial QA completion and a second post-reroute QA completion on the same task, `docs/task-quality-log.md` holds exactly one `## Log` row whose Task cell matches the task id, with the second write replacing the first in place. A test asserts a count of exactly one matching row after two passes.
- [ ] **AC-3 (placement, including relocation):** The row lands inside the `## Log` table — after the header separator, before `## Periodic Reviews` when present. Three tests: (a) a fixture with a `## Periodic Reviews` section — no data row appears at or after that heading; (b) an anchorless fixture (no filler sentinel row, no `## Periodic Reviews`) — the row is appended inside the `## Log` table without throwing; (c) a fixture where the task's own row already sits below `## Periodic Reviews` — after the write exactly one row for that task exists and it is inside the table.
- [ ] **AC-4 (judgment columns recorded and preserved):** The five QA-authored columns (`Spec verdict`, `Human reroute?`, `Dropped ACs`, `Validation gaps`, `Notes`) are written as QA supplied them, and on a re-upsert any omitted cell keeps the existing row's value. Three tests: (a) supply all five, assert they appear alongside the derived cells; (b) re-upsert with changed counters and all five omitted — the counters update while all five retain their prior values, including a `Spec verdict` of `changes_requested` that must not be rewritten to the current `status.json` verdict; (c) structural-Markdown fixtures for `Notes`, asserted against the two-step contract in Decision item 6 — **exact round-trip** for a pipe and for a **backslash immediately before a pipe** (`a\|b`), each recovering the identical string through `splitTableLine`; and **declared normalization** for a `\n` and a `\r\n`, each asserted to recover the flattened single-space form rather than the supplied string, since the parser reads one row per physical line. Every case keeps the row's cell count. The backslash case fails against pipe-only escaping and is the regression guard for the truncation path in Decision item 6.
- [ ] **AC-4b (header-driven placement, adopter columns preserved):** Cells are written under their matching header rather than by fixed position. Tests: (a) a log whose header has an extra adopter column inserted **before** a canon column — every canon value lands under its own header and the adopter column's existing value is preserved on update (this fails against a positionally-fixed writer, which would misalign silently); (b) an insert into that same table leaves the adopter column empty rather than shifting cells; (c) a header missing a canon column the writer needs is treated as malformed — warn, skip the write, and leave the file unchanged.
- [ ] **AC-4c (pre-existing duplicates converge by the declared precedence):** Starting from a log the old blind-append mechanism could have produced, the writer leaves exactly one in-table row for the task, removes its other copies, refreshes the derived cells, and resolves judgment cells by the per-cell precedence in Decision item 5. Both fixtures carry **conflicting** values so the test proves the semantics rather than counting rows: (a) two rows for the task inside `## Log` with different `Spec verdict` and different `Notes` — the earliest `Spec verdict` and the latest `Notes` survive; (b) one row inside `## Log` plus a stray below `## Periodic Reviews` with conflicting values — same resolution, single surviving in-table row. Rows belonging to other tasks are byte-unchanged in both.
- [ ] **AC-5 (no unsound derivation — negative guard):** For a task rerouted via the `code_review` `spec_gap` path (`implement.reroute_count > 0`, no `human_review` rejection), the written row's `Human reroute?` is whatever QA supplied — it is not set to `Yes` from the counter. A test reproduces archived `ship-shared-doc-dirt-preservation` (`reroute_count: 2`, row reads `No`) and asserts the cell is untouched by the counter.
- [ ] **AC-6 (all four qa-done paths produce the row):** Each path that advances `qa → done` yields the row, because the write lives in the transition: (a) the rendered agent phase command, (b) the `done.md`-salvage branch in `runQaPhase`, (c) `tryEvidenceAdvance`'s `qa` case, (d) a direct operator `canon task phase <id> qa done` as documented in the canon-pipeline skill. Tests drive (b), (c), and (d) on a task with no existing row and assert a row is present afterward and the phase reached `done`.
- [ ] **AC-7 (fail-soft — telemetry never blocks the transition):** With the log file malformed (no `## Log` table) or unwritable, `qa → done` still succeeds and a warning names the problem. With the log file absent, it is created with the standard header and table and the row is written. Tests cover the malformed case, the unwritable case, and the absent case; none may leave the phase short of `done`.
- [ ] **AC-8 (attempt history untouched):** A write modifies only the task's own row. A test asserts that afterward, `status.json` counters, the task's `spec-review.md` / `review.md`, and any sibling task's row are byte-unchanged.
- [ ] **AC-9 (prompt contract + derived copies):** `scripts/run-task/prompts/templates/qa.md` replaces the blind-append instruction with the new contract: QA supplies its five judgment cells in the `done.md` block and never edits `docs/task-quality-log.md` directly. `tests/run-task-prompts.golden.json` is regenerated and the `dist/` bundles rebuilt so committed artifacts match source; the prompt-golden test passes.
- [ ] **AC-10 (stale append-only prose corrected):** The behavioral descriptions contradicting the new write are fixed: the `docs/task-quality-log.md` header prose, its hand-maintained seed `templates/docs/task-quality-log.md`, and all three mentions in `docs/architecture.md` — the QA step summary, the "Both files are append-only" telemetry paragraph, and the `autoBlockPhase()` bullet, whose claim that it "appends to `task-quality-log.md`" is false and must be removed rather than reworded (`scripts/run-task/state.ts` shows it only sets `blocked`, bumps `auto_block_count`, and pushes an escalation). A grep AC covers all three architecture.md sites plus the two log-file headers; historical rows are not rewritten. Same AC also corrects the `Size` column's documented value domain in both log files, which currently reads `S / M / L / XL` and omits `XS` — a real `TaskSize` the task CLI accepts and the writer will emit for a fast-tier completion (`scripts/pipeline-policy.ts`, `src/task/index.ts`). Value domain only; the column schema is unchanged.
- [ ] **AC-11 (tests cannot write the real repository log):** The writer's log path is redirectable, mirroring `CANON_METRICS_FILE_OVERRIDE` / `getMetricsFile` in `scripts/run-task/metrics.ts`, so transition-level tests never mutate the repo's own `docs/task-quality-log.md`. `CANON_TASKS_DIR_OVERRIDE` alone is insufficient because `resolveTaskCwd()` still falls back to `REPO_ROOT`. A test asserts that with the override set, a `qa → done` transition writes only to the override path and leaves the repository copy untouched; the existing `tryEvidenceAdvance` regression in `tests/run-task-safety.test.ts` is updated to set it.
- [ ] **AC-12 (validation suite green):** `npm run lint`, `npm run type-check`, `npm test`, `npm run build`, and `npm run docs-refs-check` all pass; committed `dist/` matches a fresh build.

## Design

### Affected Files

> Any protected doc Claude expects QA to touch (codebase-map, decisions, patterns, architecture, product-context, pipeline-orchestrator) must be listed here. Telemetry files (lessons-learned, task-quality-log, pipeline-invocations) are auto-committed and do not need a row.

| File | Change |
|---|---|
| `scripts/run-task/quality-log.ts` *(new; name and home non-binding)* | Deterministic upsert writer: reads the derived cells from `status.json`, takes the judgment cells as input, owns row identity, placement, and relocation; fail-soft on malformed/unwritable logs, creates an absent log. Models `recordMetric` (`scripts/run-task/metrics.ts`) for table writing and the sentinel-upsert shape of `upsertCanonBlock` (`src/lib/canon-block.ts`). |
| `src/task/index.ts` | Invoke the writer from `taskPhase` on the `qa → done` transition, alongside the existing `updateReviewCounters` derived write. Includes reading the judgment cells from the task's `done.md`. |
| `scripts/run-task/prompts/templates/qa.md` | Replace the line-47 blind-append instruction with the `done.md`-block contract (AC-9). |
| `tests/task-cli.test.ts` | Transition-level tests: the four qa-done paths (AC-6), fail-soft behavior (AC-7), and log-path isolation (AC-11). This is the file that exercises `taskPhase` / `taskCmd` dispatch. |
| `tests/run-task-quality-log.test.ts` *(new)* | Writer unit tests: derived counters incl. absent-counter fallback (AC-1), `Date`/`Size` binding (AC-1b), upsert (AC-2), placement + relocation (AC-3), judgment cells incl. escaping (AC-4), header-driven placement (AC-4b), duplicate convergence (AC-4c), negative derivation guard (AC-5), history untouched (AC-8). |
| `tests/run-task-safety.test.ts` | Update the existing `tryEvidenceAdvance` `qa → done` regression to set the quality-log path override so it stops driving the transition with no log fixture (AC-11). |
| `tests/run-task-prompts.golden.json` | Regenerated QA prompt golden (`UPDATE_GOLDENS=1 npm test`). |
| `dist/scripts/run-task.js`, `dist/cli/index.js` | Rebuilt bundles (`npm run build`). Both are declared: `src/task/index.ts` and the edited `scripts/run-task/*` sources bundle into both entry points. Commit all `dist/` deltas. |
| `docs/task-quality-log.md`, `templates/docs/task-quality-log.md` | Correct the header prose describing the QA write as an append (AC-10). The seed is **hand-maintained** — it is not in `CANON_OWNED`, so `npm run sync-templates` does not propagate the root edit and `sync-templates:check` will not catch a forgotten mirror. Both must be edited explicitly. |
| `docs/architecture.md` | Correct all three append-only mentions, including removing the false `autoBlockPhase()` quality-log claim (AC-10). |
| `docs/decisions.md` | New dated entry: the quality-log row is written from task state at the `qa → done` transition; only `Spec iter` / `Review iter` have a sound derived source (`reroute_count` conflates human and `spec_gap` reroutes; `status.json` retains only the latest verdict); and why no gate and no new schema field were added. |

### Interaction Dependencies

- **`taskPhase`** (`src/task/index.ts`): the single choke point for all four qa-done paths, and already the home of a derived write (`updateReviewCounters`). The new write must not alter the existing phase-gate behavior, the ordering guarantees, or the `CANON_SKIP_PHASE_GATE` escape.
- **Reroute counter preservation** (`scripts/run-task/main.ts` reroute block): `iterations_total` is explicitly preserved across reroutes, which is what makes the two derived columns trustworthy on a second QA pass. A future change that reset those totals would silently degrade this feature.
- **Worktree/telemetry handling** (`scripts/run-task/worktree.ts`): `docs/task-quality-log.md` is in `PIPELINE_TELEMETRY_FILES` — auto-committed at the QA-end commit and base-drift-exempt. The writer must target the live root file in the **active checkout**, not the supervising `REPO_ROOT`, per the worktree-path rule in `docs/patterns.md`. Note `taskPhase` runs in both orchestrator and agent-session contexts, so path resolution must hold for both.
- **Adopter repos**: the writer runs on every adopter's `qa → done`. Drift in prose or extra sections must not throw (AC-7); drift in the table's **header** is handled by header-name placement with unknown columns preserved, or classified malformed and skipped (AC-4b). "Tolerate without throwing" is insufficient on its own here — the dangerous case is a successful but misaligned write.
- **`scripts/run-task/markdown-table.ts`**: the existing header-keyed row parser. The writer should read the header through the same convention so reads and writes cannot disagree about column identity.

### Data Model Changes

None. No `status.json` schema change, no column-schema change. The derived counters already exist on `PhaseEntry` (`scripts/run-task/types.ts`).

### Implementation Notes (non-binding — owned by plan/implement, checked by tests, not spec_review)

- **`done.md` block shape.** The delimiter style and cell encoding for QA's five judgment cells (HTML-comment sentinels vs. a heading; `key: value` lines vs. a one-row table) is plan's call, as is whether the parser lives in the writer module or beside the existing `done.md` readers in `validation.ts`. It must tolerate an absent block and an absent individual cell.
- **Row identity.** Match on the Task cell (task id) within the `## Log` table, plus the same match below `## Periodic Reviews` for the relocation case.
- **Placement anchor.** Insert or replace between the table header separator (`|---|...`) and the `## Periodic Reviews` heading; do not depend on the filler sentinel row's exact string.
- **Absent counters.** A bare `implement` entry and other unseeded counters are normal (the shipped `.canon/templates/status.json` omits them) — absent reads as 0 rather than throwing.
- **Cell count.** Emit one cell per header actually present (per Decision item 4 and AC-4b) — never a fixed ten in canon's documented order, which would misalign against an adopter-added column. Emit an empty cell rather than omitting one when a judgment value is absent, so the row still parses.

## Validation Required

| Change Type | Required Check Categories |
|---|---|
| Most changes | Linting, type checking, unit tests |
| Docs references | Docs references |
| Routes / config / build | Full build |

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — run the full suite; check here means "suite runs clean," not "new tests were added"
- [x] `npm run build` — edits to `src/**` and `scripts/run-task/**` rewrite the committed `dist/` bundles; CI fails on stale `dist/`
- [x] `npm run docs-refs-check` — this task edits `docs/architecture.md`, `docs/decisions.md`, `docs/task-quality-log.md`, and adds task artifacts
- [ ] `npm run sync-templates:check` — **not required**: no file this task edits is in `CANON_OWNED`. `templates/docs/task-quality-log.md` is a hand-maintained seed outside the sync set, which is why AC-10 edits it explicitly.

## Docs Impact

- **`docs/architecture.md`**, **`docs/decisions.md`**, and the **`docs/task-quality-log.md`** header prose — all corrected or extended by this task at implement (see Affected Files), not deferred to QA.
- **`docs/product-context.md`** — checked: it contains no description of the quality log or of QA's append behavior, so no edit is expected and it is deliberately not in Affected Files.
- **`docs/pipeline-orchestrator.md`** — its only quality-log reference is the `PIPELINE_TELEMETRY_FILES` list, which this task does not change. No edit expected; no `sync-templates` obligation.

## Known Risks

- **Delicate — the write sits inside a load-bearing state transition.** A throw or hang in the writer would break `qa → done` for every task, in canon-ai and in every adopter repo. This is the reason for `delicate: true` and for AC-7's fail-soft contract: the write is wrapped so no log-file condition can escalate into a phase-transition failure. Reviewers should treat any un-guarded throw path in the writer as blocking.
- **Fail-soft trades a guarantee for safety.** With no gate and a fail-soft write, a persistently failing write means a silently missing row again — the original bug class, minus the staleness. Accepted deliberately: the warning is the signal, and a blocking alternative was rejected (see Decision). If missing rows recur in practice, the follow-up is a periodic-review reconciliation report, not a transition-time block.
- **`Human reroute?` and `Spec verdict` remain agent judgment.** A QA agent can still record them wrong; nothing mechanically prevents it. The upsert means a later pass can correct them, which today's frozen row cannot — that is the scoped fix, not full mechanical verification.
- **Adopter log drift.** Adopters' logs may have diverged from the seed (the root canon-ai copy already has, and the seed is unsynced). The writer must place rows correctly against a drifted structure or fail soft — AC-3(b) and AC-7 bound this.
- **Bundle members.** A bundle QA pass calls the transition per member, so each member writes its own row from its own `status.json`. Covered by construction rather than a dedicated AC; plan should confirm the per-member call is not hoisted out of the loop.

## Human Test Plan

1. Run a task through the pipeline to completion once, with no rework. Open the task quality log and confirm the task has exactly one row inside the Log table, with the spec-review and code-review iteration counts matching what actually happened.
2. Reject that task at the human-review step so it goes back for rework, let it run through review and QA a second time, then reopen the log. Confirm the **same** row now shows the updated iteration counts, that the originally recorded spec-review verdict was not overwritten, that no duplicate row appeared, and that nothing landed below the "Periodic Reviews" heading.
3. Hand-move that task's row to the bottom of the file, below the "Periodic Reviews" heading, then let the task complete QA again. Expected: the row comes back inside the Log table and there is still only one row for that task.
4. Corrupt the log — delete the table header row entirely — and complete QA on a task. Expected: the task still finishes its QA step, with a visible warning that the log could not be updated. Completing QA must never be blocked by the log's condition.
5. Expected overall: a task's quality-log row ends up a current summary that agrees with the task's real review history and sits in the Log table, and the log can never stop a task from finishing.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier); mechanics live in non-binding Implementation Notes and cite real symbols
- [x] Known Risks covers failure modes for the trickiest ACs (the in-transition write, fail-soft tradeoff, adopter drift)
- [x] Human Test Plan uses product language only — refers to "the task quality log" and the "Periodic Reviews" heading a product owner reads; no file paths or code symbols
- [x] Validation Required has at least one entry marked `- [x]`, and the one unchecked entry states explicitly why it is not required
- [x] (Bug fix) *Problem* states the confirmed mechanism (deterministic: no writer exists, so the first-pass row is never revisited and placement is unconstrained) and how it was confirmed (source inspection plus James's completed-reroute reproduction); *Acceptance Criteria* includes a red-first regression AC (AC-1)
