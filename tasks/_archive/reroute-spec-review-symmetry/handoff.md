# Implementation Handoff: reroute-spec-review-symmetry

> Author: Codex | Spec: `tasks/reroute-spec-review-symmetry/spec.md` | Plan: `tasks/reroute-spec-review-symmetry/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `CLAUDE.md` | Added reroute quick-reference guidance for full-tier `--expect spec_review`, fast-tier reroute behavior, and the amendment-rejection re-run command. |
| `dist/scripts/run-task.js` | Regenerated bundled CLI output after changing `scripts/run-task/**`. |
| `docs/pipeline-orchestrator.md` | Updated `--reroute`, Worktree Isolation, and Human Reroute docs for full-tier spec-review/plan re-entry, Option B rejection, approved flow-through, fast-tier behavior, and stepped expectations. |
| `scripts/run-task/main.ts` | Made `rerouteFromHumanReview()` tier-aware, full-tier resets `spec_review`/`plan`, preserves monotonic counters, clears `sessions.codex_spec_review`, fixes reroute messaging/commentary, adds Option B routing in `checkAndRoute()`, and makes reroute spec-review retries use the worktree cwd. |
| `scripts/run-task/phases/plan.ts` | Passes `activeCwd` as the `runClaude()` cwd so reroute planning reads the worktree task files. |
| `scripts/run-task/phases/spec-review.ts` | Passes `activeCwd` as the `runCodex()` cwd so reroute amendment review reads the worktree task files. |
| `scripts/run-task/prompts/index.ts` | Registers the new reroute templates and dispatches `promptSpecReview()`/`promptPlan()` to reroute variants when `implement.rerouted` is true, preserving per-task reroute rounds in bundles. |
| `scripts/run-task/prompts/templates/implement-reroute.md` | Instructs implement-reroute to read the matching `## Reroute Plan` section when present, with a base-plan fallback for fast-tier cases. |
| `scripts/run-task/prompts/templates/plan-reroute.md` | New append-only plan-reroute prompt template. |
| `scripts/run-task/prompts/templates/spec-review-reroute.md` | New amendment-review prompt template scoped to amended spec review and prior spec-review context. |
| `templates/CLAUDE.md` | Synced mirror of `CLAUDE.md`. |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror of `docs/pipeline-orchestrator.md`. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt goldens for implement-reroute plus new spec-review-reroute and plan-reroute cases. |
| `tests/run-task-prompts.test.ts` | Added reroute prompt dispatch/golden coverage, including mixed-round bundle assertions. |
| `tests/run-task-reroute-preflight.test.ts` | Added tiered reroute reset, messaging, Option B bundle reset, approved flow-through, spec-review cwd/session, and retry cwd coverage. |
| `tests/run-task-safety.test.ts` | Updated existing `main --reroute clears full_send` assertion to the new full-tier spec_review/plan/implement pending state. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The implementation restores tier symmetry for human reroutes without adding new status fields. Full-tier reroutes now reset back to the existing `spec_review` and `plan` phases, while fast-tier reroutes retain the old direct-to-implement path. The routing guard for rejected amendments blocks to the human before the normal `routeBackTo('spec')` branch, preserving the `implement.rerouted` invariant and keeping bundle tasks aligned by resetting every task's `spec_review` together.

The cwd/session changes are coupled to the routing change: reroute-time `spec_review` and `plan` must run from the task worktree, and the old root-bound `codex_spec_review` session must be cleared so the fresh amendment review actually sees the amended worktree files.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Updated `tests/run-task-safety.test.ts`, which was not listed in the spec Affected Files table. | The required full `npm test` suite had an existing full-send reroute assertion that encoded the old full-tier direct-to-implement state. Updating it is part of preserving the existing test surface under AC-1/AC-2. | Supports AC-1/AC-2; no AC dropped. |
| Updated `templates/docs/pipeline-orchestrator.md`, which was not listed in the spec Affected Files table. | `docs/pipeline-orchestrator.md` is canon-managed with a template mirror. `npm run sync-templates:check` fails unless the mirror is kept in sync. | Supports AC-10/AC-14; no AC dropped. |
| Verified generated `dist/` determinism with a two-build diff hash instead of recording a literal pre-commit `git diff --exit-code -- dist/` success. | Before the orchestrator commit, `dist/scripts/run-task.js` is expected to be dirty because source changed and build output is part of this implementation. A literal `git diff --exit-code -- dist/` would report the intended uncommitted generated diff. | Satisfies AC-14 by showing a fresh rebuild produces the same `dist/` diff. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: Full-tier reroute resets spec_review + plan | Met | `rerouteFromHumanReview()` gates on `detectTier()`, resets full-tier `spec_review`/`plan`, clears verdict/current-loop counters, preserves monotonic fields, leaves fast tier untouched, and tests cover both derived phases and `reroute_count`. |
| AC-2: Tier-aware reroute messaging | Met | Full-tier and fast-tier info output now differs; tests assert the full-tier `spec_review` guidance and fast-tier `implement` wording. |
| AC-3: spec_review-reroute prompt variant | Met | `promptSpecReview()` dispatches on `implement.rerouted`, renders `spec-review-reroute.md`, includes amendment/integration/scope instructions, and prompt tests/goldens cover single and bundle cases. |
| AC-4: plan-reroute prompt variant | Met | `promptPlan()` dispatches on `implement.rerouted`, renders `plan-reroute.md`, instructs append-only reroute plan sections, and prompt tests/goldens cover single and bundle cases. |
| AC-5: Option B routing on amendment rejection | Met | `checkAndRoute()` intercepts reroute plus `changes_requested` before normal `routeBackTo('spec')`, resets the whole bundle's `spec_review`, lists rejected task files only, and exits with the normal `canon run ...` instruction. Tests cover bundle and non-reroute behavior. |
| AC-6: Approved reroute amendment flows through | Met | Existing human spec-gate logic remains unchanged; regression test verifies approved reroute `spec_review` advances to `plan` without a spec gate. |
| AC-7: implement-reroute reads the reroute plan | Met | `implement-reroute.md` now instructs Codex to read the matching reroute plan section when present and fall back to the base plan when absent; golden updated. |
| AC-8: Templates registered | Met | `spec-review-reroute.md` and `plan-reroute.md` are imported and registered in `TEMPLATES`; prompt goldens and type-check render them. |
| AC-9: Stale comment corrected | Met | The reroute comment now documents the never-cleared invariant; `rg -n "rerouted\\s*=|delete .*rerouted|rerouted = false" scripts/run-task` shows only the intended set-true assignment plus reads. |
| AC-10: Docs updated | Met | `docs/pipeline-orchestrator.md`, `CLAUDE.md`, and synced templates document full-tier re-entry, Option B, approval flow-through, fast-tier behavior, and stepped expectations. Docs refs and template sync pass. |
| AC-11: spec_review and plan phases run with `cwd = activeCwd` | Met | `runSpecReviewPhase()` and `runPlanPhase()` pass `activeCwd` to `runCodex()`/`runClaude()`; tests verify first-pass root cwd and reroute worktree cwd. |
| AC-12: Reroute clears stored `codex_spec_review` session | Met | Full-tier reroute deletes `status.sessions.codex_spec_review` only; tests verify the slot is removed, implement session remains, and reroute spec_review starts fresh rather than resuming. |
| AC-13: Recovery retry honors reroute cwd for spec_review | Met | `retryAgentForPhase()` treats `spec_review` as a worktree phase only when `implement.rerouted` is true; tests verify worktree cwd for reroute and REPO_ROOT for non-reroute. |
| AC-14: Validation + build artifacts green | Met | Required validation passed; `dist/scripts/run-task.js` regenerated and a second build produced the same `dist/` diff hash. |

## Edge Cases Considered

- Full-tier and fast-tier reroutes diverge intentionally: full tier re-enters at `spec_review`; fast tier still re-enters at `implement`.
- Bundle reroute with mixed amendment verdicts resets every bundled task's `spec_review` so the next run does not trip phase alignment.
- Bundle reroute prompt generation uses each task's own `reroute_count`, so mixed round 1/round 2 bundles get correct amendment and plan headings.
- Non-reroute `spec_review` `changes_requested` still routes back to `spec`.
- First-pass `spec_review`/`plan` still run from REPO_ROOT because no worktree exists yet.
- Reroute `spec_review` clears the old root-bound session before creating a worktree-bound session, and retry resumes from that same worktree cwd.

## Blockers

- No unresolved implementation blockers.
- `[scope]` `tests/run-task-safety.test.ts` was outside the spec Affected Files table but had to change because the required full test suite asserted the old full-tier reroute phase.
- `[scope]` `templates/docs/pipeline-orchestrator.md` was outside the spec Affected Files table but had to change because the docs file is canon-managed and template sync is required.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` (= `eslint scripts/ tests/ src/`) | Pass | Reran after final source change; exit 0. |
| `npm run type-check` (= `tsc -p tsconfig.json --noEmit`) | Pass | Reran after final source change; exit 0. |
| `npm test` — full suite runs clean (reroute-preflight + prompts goldens included) | Pass | Reran after final source change; 690 tests, 689 pass, 1 existing skip, 0 fail. |
| `npm run build` — touches `scripts/run-task/**`; committed `dist/` must match a fresh build (`git diff --exit-code -- dist/`) | Pass | Reran twice after final source change; build passed and `git diff -- dist/` SHA-256 remained `16a9f3a9ec74f6341f5f13a253078599caef96896b790ac3b44dbeb63ddff908`. |
| `npm run docs-refs-check` — touches `docs/` + `CLAUDE.md` | Pass | Reran after docs/template changes; `All refs OK`. |
| `npm run sync-templates:check` — `CLAUDE.md` edit must be mirrored to `templates/CLAUDE.md` | Pass | Reran after docs/template changes; `All canon-managed files in sync`. |
| E2E — N/A (no UI surface) | deferred_by_spec | Spec: Validation Required marks E2E N/A because this task has no UI surface. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [x] Branch is current with `origin/<base>` as of the local `origin/release/v1.9` ref (`origin/release/v1.9` is an ancestor of HEAD)

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g., trailing newline): add it here as "Reverted to original (describe residual diff)".

### Findings addressed

- _correctness bug:_ "<one-line summary>" → fixed at file:line
- _risk/guardrail:_ ... → ...
- _spec gap:_ ... → ...
- _optional cleanup/nit:_ ... → addressed / deferred (rationale)

### AC deltas (if any)

- AC-N: was Partial → now Met (file:line)

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
