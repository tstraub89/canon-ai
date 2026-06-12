# Spec: code-review-counter-reset-helper — canon task helper to reset code_review iteration counter

> Written by: Claude | Review by: Codex
> Status: draft | reviewed | approved | implemented

## Problem

When `code_review` auto-blocks on the loop cap, the recovery message it prints ([`scripts/run-task/phases/code-review.ts:236–238`](../../scripts/run-task/phases/code-review.ts), and the bundle variant ≈ line 275) instructs the operator to **hand-edit `status.json`**:

> "set `phases.code_review.status = "pending"`, `phases.code_review.iterations_current_loop = 0`, and `phases.code_review.preflight_rejections_current_loop = 0` in status.json"

This directly contradicts CLAUDE.md's "Prefer `canon task` helpers over hand-editing `status.json`" rule — and hand-editing skips the top-level `status` pointer re-derivation that the helpers perform, producing inconsistent state the dispatcher can misroute from. There is no helper to perform this reset safely, even though the analogous `spec_review` path already has one (`canon task reset-spec-review`, [`src/task/index.ts:1014`](../../src/task/index.ts)).

This is the **S companion fix** carved from backlog item [`docs/BACKLOG.md` "`iterations_current_loop` survives across `--reroute`"](../../docs/BACKLOG.md) (GP failure mode #8). **Diagnosis update (2026-06-12):** the underlying "counter survives the second reroute" bug the backlog worried about is **already fixed** — the repro's "3 in a row" were *pre-flight* rejections, and `rerouteFromHumanReview` did not reset `preflight_rejections_current_loop` until [v1.5.0 (commit 6c9755b)](https://github.com/tstraub89/canon-ai/commit/6c9755b), one week after the report; the reset now lands at [`main.ts:2262`](../../scripts/run-task/main.ts) and is guarded by [`tests/run-task-reroute-preflight.test.ts:485-487`](../../tests/run-task-reroute-preflight.test.ts). So this task is **not** recovery for a live bug — it is plain operator hygiene: the auto-block message still tells operators to hand-edit `status.json`, and the loop cap can legitimately fire when a finding genuinely recurs N times. A helper gives that real case a clean, helper-driven recovery path.

## Decision

Add a `canon task` subcommand that resets the `code_review` phase counters the way the auto-block message describes, and rewrite the auto-block recovery message(s) to point operators at the helper instead of hand-editing `status.json`. The helper mirrors `taskResetSpecReview`'s established shape, adjusted for `code_review`'s field set (which additionally has `preflight_rejections_current_loop`).

**Subcommand name (design decision for review):** `canon task reset-code-review <TASK-ID>`, chosen for direct parity with the existing `reset-spec-review` subcommand — lowest operator surprise. (Alternative considered: a general `reset-counter <id> <phase>` unifying both phases, or a `--reset-iterations` flag on `canon task phase`. Rejected for this S task because the two phases have different field sets and unifying them would pull `reset-spec-review` into scope; a future refactor may consolidate.)

The reset performs, for the task (routing to the worktree `status.json` when one exists past plan, like the other helpers):

- archive an existing `review.md` → `review-prior-N.md` (mirrors `reset-spec-review`'s archival of `spec-review.md`);
- `phases.code_review.status = "pending"`;
- `phases.code_review.iterations_current_loop = 0`;
- `phases.code_review.preflight_rejections_current_loop = 0`;
- `phases.code_review.verdict = ""` (clear stale verdict, per the 1.10.2 reset-clears-verdict invariant);
- drop the `claude_review` session entry if present (mirrors `reset-spec-review` dropping `claude_spec`);
- re-derive the top-level `status` pointer and write atomically.

## Non-Goals

- **Does NOT re-fix the counter-persistence-across-`--reroute` bug** — it is already fixed (v1.5.0) and regression-guarded (see Problem). This task is the helper + message rewrite only; no change to the reroute reset.
- **Does NOT modify or remove `reset-spec-review`.** No consolidation of the two helpers in this task.
- **Does NOT touch the loop-cap logic, `MAX_REVIEW_LOOPS`, or the auto-block trigger conditions** — only the *recovery* path (the helper) and the message text.
- **Does NOT reset `iterations_total`** (the lifetime audit field) — preserved across the reset. The helper resets the loop-local counters: `iterations_current_loop`, its legacy alias `iterations` (which mirrors the current-loop counter, not a lifetime count), and `preflight_rejections_current_loop`. This matches `reset-spec-review` and the reroute reset, both of which zero `iterations` alongside `iterations_current_loop`.

## Acceptance Criteria

- [ ] AC-1: A new subcommand `canon task reset-code-review <TASK-ID>` exists, dispatched from the `taskCmd` switch in `src/task/index.ts` (alongside `reset-spec-review`). Running it on a task at a `code_review` auto-block sets `phases.code_review.status = "pending"`, `iterations_current_loop = 0`, `preflight_rejections_current_loop = 0`, and `verdict = ""`. Verify by unit test asserting the post-reset `status.json` field values.
- [ ] AC-2: The helper re-derives the top-level `status` pointer (no inconsistent state) and writes atomically — consistent with `taskResetSpecReview` / `taskPhase`. Verify by asserting the top-level `status` field after reset.
- [ ] AC-3: The helper routes to the **worktree** `status.json` when one exists past plan (via the same `resolveTaskCwd` / `taskDirForCwd` path the other helpers use). Verify by test with a worktree present.
- [ ] AC-4: An existing `review.md` is archived to `review-prior-N.md` (next free N) before reset; the `claude_review` session entry is dropped if present. Verify by test.
- [ ] AC-5: Invalid input is rejected with a clear error: missing/unknown task id → usage/`no status.json` error; the command operates only on `code_review`. Verify by test on the error paths.
- [ ] AC-6: The `code_review` auto-block recovery message at `code-review.ts:236–238` (single-task) **and** the bundle variant (≈ line 275) are rewritten to instruct `canon task reset-code-review <id>` instead of hand-editing `status.json`. Verify by grep: the hand-edit instruction ("set phases.code_review.status = …" in status.json) no longer appears in those messages, replaced by the helper invocation.
- [ ] AC-7: `iterations_total` (the lifetime audit field) is **not** reset by this helper — it is preserved as the durable audit trail. The loop-local counters `iterations_current_loop`, its legacy alias `iterations`, and `preflight_rejections_current_loop` are all reset to 0 (the alias mirrors the current-loop counter; leaving it stale would still show the loop as round-N to back-compat/external readers). Verify by test asserting `iterations === 0`, `iterations_current_loop === 0`, `preflight_rejections_current_loop === 0`, and `iterations_total` unchanged across a reset.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/task/index.ts` | Add `taskResetCodeReview(id)` (mirror `taskResetSpecReview` at line 1014, adjusted for `code_review` fields incl. `preflight_rejections_current_loop`); add `case 'reset-code-review'` to the `taskCmd` switch (≈ line 1383, next to `reset-spec-review`); add the subcommand to `usage()`. |
| `scripts/run-task/phases/code-review.ts` | Rewrite the auto-block recovery message(s) (≈ lines 236–238 single-task, ≈ 275 bundle) to point at `canon task reset-code-review <id>` instead of hand-editing `status.json`. |
| `dist/cli/index.js` | Regenerated by `npm run build` (bundles `src/**`, incl. `src/task/index.ts`). |
| `dist/scripts/run-task.js` | Regenerated by `npm run build` (`scripts/run-task/main.ts` imports `src/task/index.ts`, and `code-review.ts` is bundled here). |
| `tests/task-cli.test.ts` | Unit tests for `taskResetCodeReview` (mirrors the `reset-spec-review` tests). |
| `docs/pipeline-orchestrator.md` | Document the `canon task reset-code-review` recovery path (replacing the hand-edit instruction). Canon-owned → its `templates/` mirror auto-syncs (next row). |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced from the root doc by the pre-commit hook / `npm run sync-templates` — not hand-edited. Listed so the regenerated mirror falls inside the `--pr` base-drift allow-list and `sync-templates:check` passes. |

> Both dist artifacts are declared because `src/task/index.ts` is imported by the orchestrator (`main.ts:25`) **and** the CLI (`cli/commands/task.ts`), so it bundles into both; `code-review.ts` bundles into `run-task.js`. Mechanics (exact helper body, field handling) deferred to plan/implement; this spec fixes the behavioral contract.

### Interaction Dependencies

- **`reset-spec-review`**: the new helper is its sibling — share the same routing/atomic-write/usage conventions but do not modify the spec-review helper.
- **Auto-block flow** (`code-review.ts`): only the recovery *message strings* change; the block trigger and counter logic are untouched.
- **`canon task accept`**: unrelated recovery path (bless verdict); not changed. The reset helper is the "fix and re-iterate" path, accept is the "bless" path.

### Data Model Changes

None — operates on existing `status.json` fields.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite; add unit tests for `taskResetCodeReview` and the message rewrite
- [x] `npm run build` — touches `src/**` and `scripts/run-task/**` → both `dist/cli/index.js` and `dist/scripts/run-task.js` must be rebuilt and committed
- [ ] `npm run sync-templates:check` — N/A unless a canon-managed root/template pair is touched (none expected)
- [ ] `npm run docs-refs-check` — N/A (no `docs/` change expected; see Docs Impact)
- [ ] E2E — N/A (no UI surface)

## Docs Impact

The hand-edit-vs-helper contradiction lives in code messages, not docs. If the reviewer finds `docs/pipeline-orchestrator.md` documents the auto-block recovery as a hand-edit, update it to reference `canon task reset-code-review`; otherwise none. (CLAUDE.md's Quick-ref for auto-block recovery may also warrant a mention — flag at review, but CLAUDE.md edits ≤10 lines are an inline operator follow-up, not necessarily this task.)

## Known Risks

- **Field-set divergence from `reset-spec-review`**: `code_review` has `preflight_rejections_current_loop` that `spec_review` lacks; the helper must zero it (AC-1) — easy to miss by copy-paste. Reviewer must confirm all three counters/flags are handled.
- **`iterations` alias vs `iterations_total`**: `iterations` is the legacy alias of the current-loop counter (reset it), while `iterations_total` is the lifetime audit field (preserve it). Resetting `iterations_total` would erase the durable auto-block audit signal; leaving `iterations` stale would mislead back-compat readers. AC-7 guards both.
- **Message/helper drift**: if the message says `reset-code-review` but the subcommand is named differently, operators hit "unknown subcommand." AC-6 + AC-1 must agree on the exact name.

## Human Test Plan

1. Drive a task into a code-review auto-block (three consecutive change-requests, or simulate it). **Expected:** the pipeline halts and prints a recovery message.
2. Read the recovery message. **Expected:** it tells you to run a single canon command to reset the review counter — it does **not** tell you to hand-edit the status file.
3. Run that command. **Expected:** a confirmation that the review phase was reset to pending with the loop counter cleared; the task's prior review notes are archived (a "prior" copy is kept), and the long-run iteration count is preserved.
4. Re-run the pipeline. **Expected:** code review runs again from a clean loop counter rather than immediately re-blocking.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — see Affected Files (`taskResetSpecReview` model at `index.ts:1014`, message at `code-review.ts:236`)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
