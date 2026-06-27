# Done: code-review-codex-lens — Add cold-Codex third lens to code_review

Canon's `code_review` phase now consults three independent reviewers instead of two. Before the foreman spawns its anchored-Claude and cold-Claude lenses, the orchestrator runs `codex exec review --json --base <base> -m <mini-model>` in the task worktree, captures the findings verbatim to a per-task `review-cold-codex.md` artifact, logs the duration to the run log, and injects the findings into the foreman prompt. The foreman synthesizes all three inputs with separate reconciliation tracks: cold-lens findings (Claude and Codex) are verified against the diff first; anchored-lens findings are reconciled against spec scope only — and a verified cold finding cannot be dismissed merely for being off-AC. Hard-fail is the only mode when Codex is unavailable: the phase stops before synthesis, no silent 2-lens fallback. Bundle runs get one review per invocation, findings fanned to every member task dir, with atomic failure. The prior "two-lens / do not add a third lens" rule in `docs/decisions.md` is overturned; the near-clone caution is scoped to same-model additions, and cross-family decorrelation (GPT + Claude) is named as the exception. All 16 ACs are met, all validation checks pass, and code review approved with nits (no correctness bugs, no blocking items).

## Files Changed

| File | Change |
|---|---|
| `scripts/run-task/agents/codex.ts` | Added `runColdCodexReview()` — `codex exec review --json` NDJSON capture, no-output failure classification, duration return, fake-binary test seam |
| `scripts/run-task/phases/code-review.ts` | Runs cold-Codex once per invocation before foreman; writes `review-cold-codex.md`; logs duration; hard-stops on unavailable review; passes findings to foreman; added `CodeReviewPhaseDeps` injection for tests |
| `scripts/run-task/prompts/index.ts` | Threads optional cold-Codex findings into `promptCodeReview()` render data |
| `scripts/run-task/prompts/templates/code-review-foreman.md` | Three-lens framing; injected cold-Codex section; separate code-validity/spec-scope adjudication; no-off-AC-dismissal rule; cross-model-agreement guard |
| `.canon/templates/review.md` | Three lenses; cold-Codex findings slot; `Dismissed (cold-Codex)` entry format |
| `.claude/agents/code-review-anchored.md` | "two-lens" → "three-lens" charter wording |
| `.claude/agents/code-review-cold.md` | "two-lens" → "three-lens" charter wording |
| `docs/decisions.md` | Generalized `:193`; rewrote `:202` lens-count rule and `:297`/`:303` parked-Codex-phase decision; added orchestrator-run cold-Codex design entry |
| `docs/pipeline-orchestrator.md` | Sequential cold-Codex step, artifact, hard-fail, bundle, duration log line, three-input foreman flow |
| `docs/product-context.md` | Review glossary row and lens roadmap line → cross-model three-lens |
| `tests/run-task-code-review.test.ts` | New test file: cold-Codex ordering+artifact+mini-model, hard-fail-before-foreman, bundle single-run/atomic-failure |
| `tests/run-task-prompts.test.ts` | Injected cold-Codex slot + three-lens framing assertions |
| `tests/run-task-prompts.golden.json` | Regenerated golden snapshots |
| `templates/.canon/templates/review.md` | Auto-synced mirror |
| `templates/.claude/agents/code-review-anchored.md` | Auto-synced mirror |
| `templates/.claude/agents/code-review-cold.md` | Auto-synced mirror |
| `templates/docs/pipeline-orchestrator.md` | Auto-synced mirror |
| `dist/scripts/run-task.js` | Rebuilt orchestrator bundle |

Note: `docs/pipeline-invocations.md` has a staged change from regular code_review Claude foreman invocations writing their metrics rows — expected pipeline behavior, not a spec violation. The cold-Codex duration is a run-log `info()` line only (AC-4); no new `MetricEntry` row was added.

## How to Test

> The first live 3-lens exercise is the next task that runs `code_review` after this merges — this task's own code review ran the previous two-lens path (bootstrap constraint; see spec Known Risks).

1. Run a task through the pipeline to the code_review step on the merged base.
2. Confirm the review now reflects three independent reviewers — the two existing Claude-family ones plus one GPT-family reviewer — and that the resulting review shows confirmed vs. dismissed findings with reasons, not a verbatim echo.
3. When the cold-Codex reviewer flags something, confirm it is verified against the diff before being carried — a real issue is not waved off just because no AC named it. Where two reviewers (one Claude + one GPT) independently flag the same thing, confirm it is treated as higher-confidence.
4. Simulate Codex unavailability (e.g., a rate-limit condition or an invalid model). Confirm the review does not come back approved — the run stops and asks for re-run attention.
5. After a run, check the run log for a line like `→ cold-codex review (<task>): <n>s` recording how long the Codex step took.
6. Run a two-task bundle through code_review. Confirm the cold reviewer runs once, both tasks' reviews reflect its findings, and if it can't run, both tasks stop together (neither advances to QA).

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean after fixing test fake shapes |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` |
| `npm test` (incl. new code-review phase suite) | Pass | 886 pass, 1 skipped, 0 fail |
| `UPDATE_GOLDENS=1 npm test` | Pass | 886 pass, 1 skipped, 0 fail; golden consistent |
| `npm run build` | Pass | `dist/scripts/run-task.js` rebuilt and committed |
| `npm run sync-templates` | Pass | All canon-managed mirrors generated |
| `npm run sync-templates:check` | Pass | All mirrors in sync |
| `npm run docs-refs-check` | Pass | All refs OK |
| Structural grep gate (AC-10) | Pass | Zero matches for "two-lens" / "do not add a third lens" on live surfaces |
| Code review verdict | Approved with nits | No correctness bugs; 4 optional cleanups (discarded `durationMs`, empty-string footgun, `getColdCodexModel` test gap, diagnostic on format drift); 2 low-confidence risks flagged for dogfood (diff-range parity, `--sandbox` omission) |
| Live 3-lens dogfood | deferred_by_spec | First real exercise is post-merge (spec Known Risks: "this task can't self-test the 3-lens behavior pre-merge") |

## Human Verification Required

**Live dogfood (Human Test Plan, steps 1–6 above):** The 3-lens code_review path activates only after this merges. Run the first post-merge task through code_review and verify the six steps above, with particular attention to:
- Diff-range parity: confirm `codex review --base <branch>` sees the same committed range as `getScopedDiff()` (three-dot). Flagged as a low-confidence risk in code review; operator-confirmed but not test-verified.

**Pre-merge checklist:**
- [ ] Final CI/CD checks green (push branch; confirm CI passes)
- [ ] Final diff matches spec intent — confirmed by code review foreman (all 16 ACs met)

Items that do not require human action:
- Version: decided at release step
- Changelog: proposed below; finalized at `/canon-changelog`
- PR body: written to `tasks/code-review-codex-lens/pr-body.md`

## Proposed Changelog

```
### Added

- **`code_review` now runs three independent reviewers — an anchored Claude lens, a cold Claude lens, and a cold Codex (GPT-family) lens — synthesized by the foreman.** Before spawning the Claude lenses, the orchestrator runs `codex exec review` over the task's branch diff, captures findings to a per-task `review-cold-codex.md` artifact, and injects them for 3-way verify-don't-relay synthesis. Cold findings (Codex and Claude) are verified against the diff before being carried; a verified cold finding can't be dismissed merely for being off-AC. A Codex review that can't be obtained stops the phase hard — no silent fallback to two lenses. Bundle runs use one review per invocation, fan findings to all member task dirs, and fail atomically. Cross-family decorrelation (GPT + Claude) was the empirical driver: Codex routinely found P2s the Claude lenses missed, and the operator was already running `codex review` by hand before every PR. Ships to adopters via `canon upgrade`.
```

## Decisions Made

- **Orchestrator-run over foreman-run**: deterministic hard-fail reuses the existing Codex invocation halt (no new `codex_error` verdict, no foreman poller). A foreman-owned call would have collided with `checkAndRoute()` → `recoverPhaseForTask()`'s one-shot retry.
- **Sequential over concurrent for v1**: the Codex review runs before the foreman; the run-log duration line (AC-4) is the data to decide whether concurrency is worth building.
- **Hard-fail over graceful degradation**: a silent 2-lens fallback would defeat the gate's purpose. Unavailability is transient and re-runnable, matching `implement`/`spec_review` Codex failure behavior.
- **"Cold" means unprompted/unanchored, not spec-blind**: no artifact-filtering construction. Task artifacts (`spec.md`, `handoff.md`, etc.) are uncommitted at `code_review` time — `getScopedDiff()` and `codex review --base` both see the committed `<base>...HEAD` range only.
- **`docs/decisions.md:202` overturned**: near-clone caution scoped to same-model additions; cross-family decorrelation (GPT + Claude) is the documented exception. Empirical driver: Codex routinely found PR P2s the two Claude lenses missed; the operator was already running `codex review` by hand before every PR.

## Open Questions

- **Diff-range parity** (see Human Verification above): confirm in the first dogfood run that `codex review --base` produces the same `<base>...HEAD` committed range as `getScopedDiff()`.
- **Nit: discarded `durationMs`** (`codex.ts:167`): `runColdCodexReview` returns `durationMs` but the phase recomputes its own `Date.now()` bracket. Harmless redundancy; clean up in a follow-up if desired.
