# Done: reconcile-qa-quality-log-summary

## What Changed

The QA task-quality-log — the one-row-per-task history in `docs/task-quality-log.md` that tracks spec/review iteration counts, dropped ACs, and reroutes — used to be written by a single prompt instruction telling the QA agent to "append a row." No code enforced it: a task that reran spec_review/implement/code_review after a reroute never had its row revisited, so the log kept the *first-pass* counts forever (a real incident: `schedule-date-corrections` finished with 6 spec_review rounds and 2 code_review rounds in `status.json`, but its logged row still read `1 / 1`), and nothing anchored the row inside the log's table, so rows could land below the "Periodic Reviews" heading and silently fall out of trend analysis. This task replaces the blind append with a deterministic writer that runs automatically every time a task's QA phase completes: it recomputes the two counters that have a sound source in task state, takes the five judgment-call columns (spec verdict, human-reroute flag, dropped ACs, validation gaps, notes) from a new block in `done.md`, always places the row inside the log table (relocating it if it was previously misplaced), and reconciles duplicate rows left by the old mechanism. A write that fails (corrupt or unwritable log file) only prints a warning — it can never block a task from finishing QA.

## Files Changed

| File | What Changed |
|---|---|
| `scripts/run-task/quality-log.ts` *(new)* | The upsert writer: derives counters from `status.json`, parses judgment cells from `done.md`, places/relocates the row inside `## Log`, reconciles pre-existing duplicates, and serializes cells with an exact round-trip contract against the existing table parser. |
| `src/task/index.ts` | Invokes the writer from `taskPhase()` whenever a task's `qa` phase completes — the one choke point every completion path (agent, salvage, evidence-advance, operator recovery) already passes through. |
| `scripts/run-task/prompts/templates/qa.md` | Replaced the old "append a row" instruction with a `## Quality Log` block contract QA fills in `done.md`. |
| `tests/run-task-quality-log.test.ts` *(new)*, `tests/task-cli.test.ts`, `tests/run-task-safety.test.ts` | New/updated coverage for the writer and all four qa-done completion paths, including a red-first regression that reproduces the `schedule-date-corrections` staleness bug. |
| `tests/run-task-prompts.golden.json` | Regenerated for the new QA prompt text. |
| `dist/cli/index.js`, `dist/scripts/run-task.js` | Rebuilt bundles (both entry points include the changed source). |
| `docs/task-quality-log.md`, `templates/docs/task-quality-log.md` | Header prose corrected to describe upsert instead of append; `XS` added to the documented Size domain. |
| `docs/architecture.md` | Corrected the QA/telemetry description and removed a pre-existing false claim that `autoBlockPhase()` writes to this log. |
| `docs/decisions.md` | New entry recording the transition-owned, fail-soft upsert design and why `Human reroute?`/`Spec verdict` are not derived from `status.json`. |

## How to Test

This is internal pipeline tooling — verification is via the project's own task-completion flow, not a UI. The spec's Human Test Plan (`tasks/reconcile-qa-quality-log-summary/spec.md` → "Human Test Plan") gives the full manual walkthrough; summarized:

1. Run a task through the pipeline to completion once, with no rework. Open `docs/task-quality-log.md` and confirm the task has exactly one row inside the Log table, with spec/review iteration counts matching what actually happened.
2. Reject that task at human-review so it reruns spec_review → implement → code_review → QA, then reopen the log. Confirm the **same** row now shows updated iteration counts, the originally recorded spec verdict was not overwritten, no duplicate row appeared, and nothing landed below "Periodic Reviews."
3. Hand-move that task's row below "Periodic Reviews," then let it complete QA again. Expect the row to come back inside the Log table with still only one row for that task.
4. Delete the log's table header entirely, then complete QA on a task. Expect QA to finish successfully with a visible warning that the log could not be updated.

## Test Results

All checks below are from `handoff.md`'s Validation Outcomes table, independently re-run and confirmed during code review (see `review.md` Stage 1 Validation Gate).

| Check | Result | Notes |
|---|---|---|
| Red-first regression checkpoint | Pass | Targeted test reproduced the stale-counter bug pre-fix (`'1' !== '6'`), passed post-fix. |
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 1,039 tests: 1,038 passed, 1 environment skip, 0 failed. |
| `npm run build` | Pass | Both dist entry points rebuilt; committed `dist/` matches a fresh build byte-for-byte (independently re-verified in code review). |
| `npm run docs-refs-check` | Pass | |
| `git diff --check` | Pass | No whitespace errors. |

`npm run sync-templates:check` was correctly not run: no file this task edits is in `CANON_OWNED`; `templates/docs/task-quality-log.md` is a hand-maintained seed edited explicitly.

## Human Verification Required

None of the validation checks above are `human_pending` — all ran and passed.

One pre-merge checklist item can't be confirmed yet at this stage:
- **Final CI/CD checks green** — not yet applicable; this task hasn't been pushed or opened as a PR, so no CI run exists. Confirm once `canon run --pr` opens the draft PR and CI completes.

## Proposed Changelog

Category: Fixed

**The QA phase's task-quality-log row is now upserted from task state at the `qa → done` transition instead of being blind-appended by the QA agent, so it survives reroutes and always stays inside the log table.** The former mechanism was a single prompt instruction with no code behind it — a task that reran spec_review/implement/code_review after a reroute never had its logged row revisited, so it kept whatever counts the first QA pass recorded (confirmed live: `schedule-date-corrections` finished with `spec_review.iterations_total: 6` / `code_review.iterations_total: 2` in `status.json` while its row still read `1 / 1`), and nothing anchored the write inside the log's table, so rows could land below the "Periodic Reviews" heading and drop out of trend analysis entirely. A deterministic writer inside the `qa → done` transition now owns the row: it recomputes the two counters that have a sound source in task state, takes QA's five judgment cells (spec verdict, human-reroute flag, dropped ACs, validation gaps, notes) from a new `## Quality Log` block in `done.md`, always places the row inside the log table (relocating it if a prior write left it misplaced), reconciles any pre-existing duplicates by an explicit per-cell precedence, and preserves any columns an adopter has added by matching on header name rather than position. A write failure warns instead of blocking the phase transition. Ships to adopters via `canon upgrade`.

## Decisions Made

- **Descoped which quality-log columns are derivable.** Only `Spec iter` and `Review iter` have a sound, monotonic source in `status.json`. `Human reroute?` is explicitly *not* derived from `implement.reroute_count`, because that counter is incremented by the same helper (`rerouteFromHumanReview()`) for both genuine human-review rejections and blocked code_review `spec_gap` recovery — deriving it would misreport spec_gap reroutes as human rejections. `Spec verdict` is not derived from `status.json` either, since the schema defines it as the *first* spec_review verdict but `status.json` only retains the latest. Both stay QA-authored judgment calls, as before — this task only fixes where and when the row is written.
- **No new gate on `qa → done`.** Since the write now happens inside the transition itself, a missing/misplaced/duplicated row becomes structurally impossible rather than something to detect — adding a rejection path would create a false-block risk for every task in exchange for catching only a manual hand-edit of the log. Recorded as an explicit operator decision in the spec.
- **Fail-soft over a guarantee.** A persistently failing write (e.g., an operator hand-corrupts the log) means a silently missing row again — accepted deliberately; the printed warning is the signal, not a block.
- **This task's own quality-log row was added by hand, not by the new writer.** The writer this task ships only takes effect once canon-ai is upgraded/released; the `canon` binary that executes this task's own `qa → done` transition is still the currently-installed global v2.3.0, which has no such writer. So the row for `reconcile-qa-quality-log-summary` in `docs/task-quality-log.md` was written manually this one time, following the old convention, rather than by the mechanism it introduces. Every task's row after this one releases will be written automatically.

## Open Questions

None. Six non-blocking robustness/coverage nits are open from code review (see `review.md` → Stage 2 → Optional Cleanup / Nit) — none are reachable in canon's current sequential, single-writer execution model (e.g., no cross-process file lock, a gap-duplicate edge case that requires a hand-edited log state the writer never produces itself). Worth a follow-up if canon's execution model ever changes, not blocking for this task.

## Quality Log

- Spec verdict: changes_requested
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Fixes stale/misplaced quality-log rows (schedule-date-corrections regression) via a fail-soft, header-driven upsert at the qa→done transition. Spec review: 6 rounds (5 changes_requested) — rounds 1-2 were genuine mechanism errors (wrong derivable-column claims; an agent-invoked writer design that `runQaPhase`'s control flow made architecturally impossible), rounds 3-5 narrowed cell sources, duplicate precedence, and serialization round-trip within the accepted design (Shape Check clean both r3 and r4). Clean single-pass implementation; code review approved_with_nits, 3 lenses, no correctness bugs, 6 non-blocking nits. All 12 ACs met non-vacuously. This row was added by hand — see Decisions Made.
