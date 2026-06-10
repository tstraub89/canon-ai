# Done: v1.11-harness-cleanup — --pr CI self-cancellation + budget-by-tier

## What Changed

Two independent orchestrator fixes shipped together.

**Fix A — `canon run --pr` no longer races its own CI run.**

Previously `--pr` pushed two commits: an artifacts commit (which opened or synchronized the PR), then a `chore: record pr.number` commit (which updated `status.json` with the pinned PR number). Both events landed in the same GitHub Actions concurrency group with `cancel-in-progress: true`, causing whichever CI run started second to cancel the first. On every `--pr`, the head commit's run ended up cancelled — leaving a red badge that required a manual `gh run rerun`.

The original fix used a `[skip ci]` marker on the non-head artifacts commit. Code review found a P2 risk: a transient `gh pr create` failure could leave the marked commit as the permanent head with CI suppressed until a successful re-run. The spec was amended to eliminate the second commit entirely.

**The fix:** `pr.number` is now persisted to a **gitignored task-local sidecar** (`tasks/<id>/.pr-number`) by `recordPinnedPRNumber()` — no stage, commit, or push step. `--pr` produces exactly **one** pushed commit (the artifacts commit), which is the PR head. GitHub receives a single `pull_request` event and fires a single CI run. `--ship` reads `pr.number` from the sidecar for merge-evidence and falls back to branch-lookup for tasks created before this release.

**Fix B — Claude phase budget scales by effective task size.**

Every Claude pipeline session previously spawned with a flat $5 budget cap. On large `code_review` runs — Opus foreman spawning two lens sub-agents over a large diff — the session exhausted $5 mid-work. The budget is now tiered by effective size:

| Effective size | Budget |
|---|---|
| S | `$5.00` |
| M | `$5.00` |
| L | `$10.00` |
| XL or any `delicate: true` | `$20.00` |

Setting the `CLAUDE_BUDGET` env var still overrides the tier with a flat cap across all phases. The budget logic lives in `scripts/pipeline-policy.ts` alongside the existing model/effort tier decisions.

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/main.ts` | `recordPinnedPRNumber()` writes `.pr-number` sidecar (no git ops); removed `willPinCommitFollow` and `[skip ci]` marker logic; `--ship` reads sidecar with branch-lookup fallback; retry path passes `cfg.budget` into `runClaude` |
| `scripts/pipeline-policy.ts` | Tiered budget mapping (S/M → `5.00`, L → `10.00`, XL/delicate → `20.00`); `budget` field on `ClaudeModelConfig`; `claudeBudget` override on `PolicyConfig` |
| `scripts/run-task/policy.ts` | Captures `CLAUDE_BUDGET` override and surfaces it via `policyConfig()` / `getClaudeConfig()` |
| `scripts/run-task/env.ts` | `claudeBudget` changed to `string \| null` so policy distinguishes unset (use tier) from explicit set (flat cap) |
| `scripts/run-task/agents/claude.ts` | `runClaude` gains a `budget` parameter; `--max-budget-usd` is passed **only** on the non-interactive (`-p`) path — interactive sessions run uncapped (the CLI documents this flag as print-mode only); flat `config.claudeBudget` read removed |
| `scripts/run-task/phases/spec.ts` | Both `promptSpec` and `promptSpecRevision` pass `cfg.budget` into `runClaude` |
| `scripts/run-task/phases/plan.ts` | Passes `cfg.budget` into `runClaude` |
| `scripts/run-task/phases/code-review.ts` | Passes `cfg.budget` into `runClaude` |
| `scripts/run-task/phases/qa.ts` | Passes `cfg.budget` into `runClaude` |
| `.gitignore` | Added `tasks/**/.pr-number` |
| `src/lib/canon-block.ts` | Added `tasks/**/.pr-number` to shared runtime gitignore pattern list |
| `templates/.gitignore` | Synced sidecar pattern |
| `docs/pipeline-orchestrator.md` | Updated `CLAUDE_BUDGET` documentation for tiered defaults + override semantics |
| `templates/docs/pipeline-orchestrator.md` | Synced `CLAUDE_BUDGET` documentation update |
| `docs/pipeline-invocations.md` | Appended spec_review, plan, and implement invocation audit rows from the reroute pass |
| `tests/run-task-ship.test.ts` | Single-commit assertion (AC-A1), no-marker grep (AC-A2), sidecar written + clean tree (AC-A3), `--ship` reads sidecar + fallback (AC-A4) |
| `tests/pipeline-policy.test.ts` | Budget table rows for each effective size and the `CLAUDE_BUDGET` flat-override case (AC-5/AC-6) |
| `dist/cli/index.js`, `dist/scripts/run-task.js` | Rebuilt artifacts |

## How to Test

1. **Budget tiers (Fix B):** On an L or XL (or delicate) task, start the pipeline with `CLAUDE_BUDGET` unset and confirm the run log shows Claude phases using the higher cap (L → $10, XL/delicate → $20). On an S task, confirm the cap is still $5.
2. **Budget override (Fix B):** Re-run the same task with `CLAUDE_BUDGET=20.00` set and confirm every phase uses the $20 flat cap regardless of size.
3. **One honest CI run on `--pr` (Fix A):** Take a task to `human_review` and run `canon run <id> --pr`. On GitHub, confirm the PR shows a **single** CI run on the head commit that completes without cancellation — no red/cancelled badge, no need to re-run manually.
4. **Ship still works (Fix A):** After PR approval, confirm `canon run <id> --ship` completes normally — `pr.number` is read from the `.pr-number` sidecar (or branch-lookup fallback) and merge-evidence proof succeeds.

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass |
| `npm run build` | Pass |
| `npm run sync-templates:check` | Pass |
| `npm run docs-refs-check` | Pass |

## Human Verification Required

None.

## Decisions Made

- **Sidecar over `[skip ci]`**: The original design used a `[skip ci]` marker. Code review found that a transient `gh pr create` failure could leave the marked commit as the permanent head with CI permanently suppressed. Eliminating the second commit entirely is a net code reduction and removes the race at its root.
- **`pr.number` is no longer in committed `status.json`**: It's now task-local (sidecar, gitignored). Consumed only by same-machine `--ship`; graceful fallback to branch-lookup preserves pre-1.11 compatibility. The anti-branch-reuse pin property from 1.10.2 is preserved.
- **M inherits the $5 cap**: The exhaustion incident was XL/delicate-specific (Opus foreman + two lens sub-agents over a large diff). An M `code_review` runs Sonnet over a smaller diff and $5 is ample. The budget departs from $5 only where heavy phases live.
- **Interactive Claude sessions run uncapped**: `--max-budget-usd` is a print-mode-only CLI flag. Passing it on the interactive branch was either silently ignored or could error at startup. Interactive sessions correctly omit the flag and run without a budget cap — the prior behavior, and the only correct one given the CLI constraint.

## Open Questions

None.

## Proposed Changelog

**For `## [1.11.0] — unreleased`, under `### Fixed`:**

> - **`canon run --pr` no longer cancels its own CI run.** Previously `--pr` pushed two commits (artifacts, then `chore: record pr.number`), triggering two `pull_request` events in the same CI concurrency group — leaving the PR head with a cancelled check on every `--pr` run. The PR number is now stored in a gitignored task-local sidecar (`tasks/<id>/.pr-number`), so `--pr` makes exactly one pushed commit. `--ship` reads the sidecar for merge-evidence and falls back to branch-lookup for tasks created before this release.
> - **Claude phase budget now scales by effective task size.** S/M tasks keep the $5 cap; L tasks get $10; XL and `delicate: true` tasks get $20 — enough for an Opus `code_review` foreman running two lens sub-agents over a large diff. Setting `CLAUDE_BUDGET` still overrides with a flat cap for all phases.

**Version bump:** No new bump needed — these ship within the existing `1.11.0` release. Both are bug fixes; add to the existing `### Fixed` block.

---

Maintenance: lessons-learned.md has 17 entries after this task; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").
