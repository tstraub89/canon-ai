# QA Summary: code-review-counter-reset-helper

## What Changed

Added `canon task reset-code-review <TASK-ID>` — a new subcommand that safely resets the `code_review` phase counters when the auto-block loop cap fires, replacing the prior instruction to hand-edit `status.json` directly.

The helper:
- Sets `phases.code_review.status = "pending"`, `iterations_current_loop = 0`, `preflight_rejections_current_loop = 0`, and clears the stale `verdict`
- Archives the existing `review.md` to `review-prior-N.md` (next free N) before resetting, preserving the prior review for reference
- Drops the `claude_review` session entry so the next review round starts fresh
- Preserves the lifetime `iterations` counter (the durable audit trail) — only the current-loop counters are zeroed
- Re-derives the top-level `status` pointer and writes atomically (no inconsistent state)
- Routes to the worktree `status.json` when one exists past plan, consistent with `taskResetSpecReview` and the other task helpers

The single-task and bundle auto-block recovery messages in `code-review.ts` were rewritten to instruct `canon task reset-code-review <id>` instead of the prior hand-edit guidance. `docs/pipeline-orchestrator.md` and its `templates/` mirror were updated to match.

## Files Changed

| File | Change |
|---|---|
| `src/task/index.ts` | Added `taskResetCodeReview()` and wired `reset-code-review` into `taskCmd` switch + usage |
| `scripts/run-task/phases/code-review.ts` | Rewrote single-task and bundle auto-block recovery strings to point at the helper |
| `tests/task-cli.test.ts` | New unit tests for the helper, dispatch, error paths, worktree routing, archive/session behavior, and the `iterations`-unchanged invariant |
| `docs/pipeline-orchestrator.md` | Refreshed task-management table and auto-block guidance to reference the new helper |
| `templates/docs/pipeline-orchestrator.md` | Synced template mirror |
| `dist/cli/index.js` | Rebuilt |
| `dist/scripts/run-task.js` | Rebuilt |

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — full suite, including new `reset-code-review` and worktree-routing tests |
| `npm run build` | Pass — both dist artifacts rebuilt and committed |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | deferred_by_spec — Spec Validation Required marked N/A; reviewer noted the check would have passed (root and template are in sync) |
| E2E | deferred_by_spec — no UI surface |

## Human Verification Required

None.

## Decisions Made

- **`iterations` (lifetime counter) is not reset.** Only `iterations_current_loop` and `preflight_rejections_current_loop` are zeroed — matching what the auto-block message instructs and what actually unblocks the loop. The lifetime counter is the durable audit trail (per the "never reset iteration counters" signal rule).
- **No consolidation with `reset-spec-review`.** The two helpers have different field sets (`code_review` adds `preflight_rejections_current_loop`); a future unifying refactor may consolidate, but that is out of scope here.
- **`docs/pipeline-orchestrator.md` updated even though not in spec Affected Files.** It already contained the stale hand-edit recovery guidance; updating it keeps operator docs consistent with the new helper (documented as a deviation in the handoff).

## Open Questions

None.

## Proposed Changelog

**Scope:** canon-ai changelog audience is adopters and operators — new commands, behavior changes, and bug fixes that affect how they run `canon`. This task adds a net-new operator-facing subcommand → `Added` entry.

**Proposed version bump:** patch within `release/v1.12`. The new subcommand is additive with no breaking change. If the project's policy treats any new subcommand as a minor bump, bump to the next minor instead — human to decide.

### Added

- **`canon task reset-code-review <TASK-ID>` provides a safe, helper-driven recovery path from a `code_review` auto-block.** Running it archives the prior `review.md`, zeroes the current-loop counters, clears the stale verdict, and re-derives the top-level status — identical to how `reset-spec-review` works for the spec-review phase. The auto-block recovery message now instructs operators to run this command instead of hand-editing `status.json`.
