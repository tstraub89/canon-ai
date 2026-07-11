# Completion Summary: per-phase-code-review-budget — Per-phase CLAUDE_BUDGET — code_review gets its own budget curve

> For the human. This is what you need to know.

## What Changed

`code_review` now gets its own Claude session budget instead of sharing a flat per-size cap with `spec`/`plan`/`qa`. Since `code_review` started running a three-lens review (an anchored Claude pass, a spec-blind cold Claude pass, and a cold Codex pass, all synthesized by a foreman — sometimes including an empirical test re-run to confirm a finding), it's a structurally more expensive session than the other three phases, which are single-pass. A live M-tier task in another project actually exhausted its shared $10 budget mid-review and needed a manual override to finish. `spec`/`plan`/`qa` keep today's budgets unchanged (XS/S $5, M/L $10, XL $20); `code_review` now runs a steeper curve (XS $5, S $10, M $15, L $20, XL $40). The flat `CLAUDE_BUDGET` env-var override still works exactly as before — set it and every phase uses that one number, regardless of size.

## Files Changed

- `scripts/pipeline-policy.ts` — split the size-only budget table into a single-pass table (unchanged values) and a new `code_review` table, combined into a phase-by-size table; `resolveBudget()` gained a `phase` parameter.
- `tests/pipeline-policy.test.ts` — restructured budget assertions to check all four phases per size, added a delicate-task row and a `CLAUDE_BUDGET` flat-override row.
- `docs/pipeline-orchestrator.md` — replaced the old flat `CLAUDE_BUDGET` description with a new Claude Budget Matrix table showing the single-pass vs. `code_review` split across all five sizes.
- `templates/docs/pipeline-orchestrator.md` — auto-regenerated mirror of the above (no hand edit).
- `docs/decisions.md` — recorded the phase-aware budget decision and marked the prior size-only equalization note as superseded.
- `dist/scripts/run-task.js` — rebuilt to include the policy change.

## How to Test

1. Run a small (XS or S) task through the pipeline and watch the `code_review` phase's startup log line (`→ Model: ... | Effort: ... | Budget: ...`).
   Expected: at XS, `code_review`'s budget matches `spec`/`plan`/`qa`; at S and above it's visibly higher.
2. Run (or inspect a recent) M-tier task's `code_review` phase.
   Expected: budget shown is $15, not the old shared $10.
3. Check `docs/pipeline-orchestrator.md`'s Claude Budget Matrix.
   Expected: it shows the phase/size split and notes that `CLAUDE_BUDGET` still overrides flat across phases.
4. Set `CLAUDE_BUDGET=15.00` and run any task.
   Expected: every phase (spec, plan, code_review, qa) uses exactly $15.

## Test Results

| Check | Result |
|---|---|
| Lint | Pass |
| Type-check | Pass |
| Unit tests | Pass (939 tests; handoff run showed 938 pass/1 environment-conditional skip, independent code-review re-run showed 939/0 — no `Fail` either way) |
| E2E tests | not_configured — no standalone E2E script; covered by orchestrator integration/subprocess coverage in `npm test` |
| Build | Pass (`dist/` rebuilt, no diff against committed output) |
| `docs-refs-check` | Pass |
| `sync-templates` / `sync-templates:check` | Pass |
| `grep resolveBudget(` call-site check (AC-5) | Pass — only the phase-aware signature and its single call site remain |

Code review (anchored Claude + cold Claude + cold Codex, foreman-synthesized) verified all 7 ACs met, no correctness bugs, no spec gaps. Verdict: **Approved with nits**.

## Human Verification Required

None. No `human_pending` validation checks remain.

One operational (non-code) item flagged by code review: **this branch is 2 commits behind `main`** (`main` has a CHANGELOG correction and a backlog-triage commit this branch doesn't). The task's own contribution only touches the 6 files listed above and doesn't conflict with either commit, but a two-dot diff or a stale fast-forward merge could make those commits look reverted. Recommend rebasing/merging current `main` into this branch before merging, so the merge lands cleanly. Not a code defect, and not something re-implementation would fix.

## Proposed Changelog

- **`CLAUDE_BUDGET` now gives `code_review` its own, higher budget curve instead of sharing a flat per-size cap with `spec`/`plan`/`qa`.** Since `code_review` runs a three-lens review (anchored Claude, cold Claude, and a cold-Codex diff review, synthesized by a foreman — sometimes including an empirical test re-run to confirm a finding), it's a structurally costlier session than the other three phases, which are single-pass. `spec`/`plan`/`qa` keep today's values (XS/S $5.00, M/L $10.00, XL $20.00); `code_review` now runs XS $5.00, S $10.00, M $15.00, L $20.00, XL $40.00. The `CLAUDE_BUDGET` env var is unchanged — set it and every phase still uses that one flat value regardless of size. See the Claude Budget Matrix in `docs/pipeline-orchestrator.md`.

## Decisions Made

- Kept `spec`/`plan`/`qa` on one shared budget table rather than three separate identical tables, since they're the same curve by design per spec.
- Moved `resolveBudget()`'s call site into the per-phase closure per the spec's explicit instruction — this drops a small memoization (budget was computed once per policy call, now once per phase lookup), but `resolveBudget` is pure and O(1), so code review confirmed this is negligible and spec-intended, not a regression.
- `docs/BACKLOG.md` and `docs/task-quality-log.md`, which still describe the old flat-per-phase `CLAUDE_BUDGET` in older historical log entries, were left untouched — they're dated append-only records, not the current contract, and the spec's Docs Impact didn't list them.

## Open Questions

- Only the M `code_review` cell ($15) has direct incident evidence behind it; S ($10), L ($20), and XL ($40) are extrapolations along the same ramp (documented as such in `docs/decisions.md`). Worth revisiting once real usage data accumulates across sizes — a follow-up tuning task, not a defect in this one.
- Rebase/merge-onto-`main` housekeeping noted above should happen before this merges.
