# Implementation Plan: code-review-counter-reset-helper

> Written by: Claude | Implements: `tasks/code-review-counter-reset-helper/spec.md`

## Approach

Mirror the existing `taskResetSpecReview` helper ([`src/task/index.ts:1014`](../../src/task/index.ts)) for `code_review`, adjusted for `code_review`'s extra field (`preflight_rejections_current_loop`). Wire it into the `taskCmd` switch as `reset-code-review`, and rewrite the two auto-block recovery messages in `code-review.ts` to point at the helper instead of hand-editing `status.json`. Rebuild both dist bundles (`src/task/index.ts` is imported by both the CLI and the orchestrator).

## Steps

### Step 1: Add `taskResetCodeReview(id)` to `src/task/index.ts`

Files: `src/task/index.ts`

Mirror `taskResetSpecReview` (line 1014). Differences for `code_review`:
- archive an existing `review.md` → `review-prior-N.md` (next free N), same pattern as the `spec-review.md` archival;
- on `code_review`: `status = "pending"`, `iterations_current_loop = 0`, `preflight_rejections_current_loop = 0`, `verdict = ""`;
- do **not** reset `iterations` / `iterations_total` (lifetime audit signal — AC-7);
- drop `sessions.claude_review` if present;
- reuse `ensurePhaseEntry`, `resolveTaskCwd` / `taskDirForCwd` (worktree routing), `writeStatusAtomic`, `today()` exactly as `taskResetSpecReview` does so the top-level `status` pointer is re-derived (AC-2, AC-3).

### Step 2: Wire the subcommand

Files: `src/task/index.ts`

Add `case 'reset-code-review': taskResetCodeReview(rest[0] ?? ''); break;` to the `taskCmd` switch (next to `reset-spec-review`, ≈ line 1383). Add a usage line for it in `usage()`. Throw a clear usage error on missing/unknown id (AC-5).

### Step 3: Rewrite the auto-block recovery messages

Files: `scripts/run-task/phases/code-review.ts`

Single-task message (≈ lines 236–238) and bundle variant (≈ line 275): replace the "set `phases.code_review.status = "pending"`, `iterations_current_loop = 0`, `preflight_rejections_current_loop = 0` in status.json" instruction with `Run: canon task reset-code-review <id>` (AC-6). Keep the diagnostic prose about recurring findings.

### Step 4: Tests

Files: `tests/task-cli.test.ts`

Add unit tests mirroring the `reset-spec-review` tests: assert post-reset `code_review.status === "pending"`, `iterations_current_loop === 0`, `preflight_rejections_current_loop === 0`, `verdict === ""`, top-level `status` re-derived, `iterations` unchanged (AC-7), `review.md` archived, `claude_review` session dropped, and the error paths (AC-5).

### Step 5: Rebuild dist

Files: `dist/cli/index.js`, `dist/scripts/run-task.js`

`npm run build` and commit both regenerated bundles (`src/task/index.ts` bundles into both; `code-review.ts` into `run-task.js`). Confirm `git diff --exit-code -- dist/` is clean after build.

## Testing Plan

- **Unit**: `tests/task-cli.test.ts` — the assertions in Step 4.
- **Manual**: drive a code_review auto-block (or hand-set a status fixture), run `canon task reset-code-review <id>`, confirm the phase resets and the pipeline re-runs review from a clean loop counter.
- **E2E**: N/A.

## Rollback Plan

Revert the helper + switch case + message rewrite + dist rebuild. No state-shape change (operates on existing `status.json` fields), no migration. A `status.json` already reset by the helper is indistinguishable from a hand-reset one.
