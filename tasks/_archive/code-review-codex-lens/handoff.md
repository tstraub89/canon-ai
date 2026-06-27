# Implementation Handoff: code-review-codex-lens

> Author: Codex | Spec: `tasks/code-review-codex-lens/spec.md` | Plan: `tasks/code-review-codex-lens/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/agents/codex.ts` | Added `runColdCodexReview()` for `codex exec review --json --base <base> -m <model>`, NDJSON `agent_message` capture, no-output failure classification, duration return, and fake-binary test seam. |
| `scripts/run-task/phases/code-review.ts` | Runs cold-Codex once per code-review invocation before the foreman, writes `review-cold-codex.md` to each task dir, logs duration, hard-stops on unavailable review, and passes findings into the foreman prompt. Added dependency injection for phase tests. |
| `scripts/run-task/prompts/index.ts` | Threads optional cold-Codex findings into `promptCodeReview()` render data. |
| `scripts/run-task/prompts/templates/code-review-foreman.md` | Reframed the foreman around three inputs, added the injected cold-Codex section, preserved the two Claude Task lenses, and added separate code-validity/spec-scope adjudication rules. |
| `.canon/templates/review.md` | Updated review artifact wording for three lenses and cold-Codex dismissal entries. |
| `.claude/agents/code-review-anchored.md` | Updated anchored lens charter wording from the old count to three-lens pipeline. |
| `.claude/agents/code-review-cold.md` | Updated cold-Claude lens charter wording from the old count to three-lens pipeline. |
| `docs/decisions.md` | Rewrote the old count/Codex-phase decisions and added the orchestrator-run cold-Codex design decision. |
| `docs/pipeline-orchestrator.md` | Documented the sequential cold-Codex step, artifact, hard-fail behavior, bundle behavior, duration log line, and three-input foreman flow. |
| `docs/product-context.md` | Updated the review glossary and roadmap language for the cross-model three-lens review. |
| `tests/run-task-code-review.test.ts` | Added cold-Codex runner and code-review phase tests covering success ordering, mini model, artifact writes, bundle single-run behavior, and hard-fail before foreman. |
| `tests/run-task-prompts.test.ts` | Updated prompt assertions to cover the injected cold-Codex slot and three-input foreman framing. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt golden snapshots. |
| `templates/.canon/templates/review.md` | Synced generated mirror of `.canon/templates/review.md`. |
| `templates/.claude/agents/code-review-anchored.md` | Synced generated mirror of `.claude/agents/code-review-anchored.md`. |
| `templates/.claude/agents/code-review-cold.md` | Synced generated mirror of `.claude/agents/code-review-cold.md`. |
| `templates/docs/pipeline-orchestrator.md` | Synced generated mirror of `docs/pipeline-orchestrator.md`. |
| `dist/scripts/run-task.js` | Rebuilt bundled orchestrator output from the source changes. |

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

The implementation keeps cold-Codex outside the foreman so failure handling stays deterministic: the orchestrator owns the Codex subprocess, captures only the review text, and stops before any Claude review if the text cannot be obtained. The foreman remains a Claude synthesis session that spawns only the anchored and cold-Claude Task lenses, then adjudicates those two outputs plus the injected cold-Codex text.

Bundle behavior follows the existing shared-branch model. `runCodeReviewPhase()` calls cold-Codex once with the active worktree and base branch, then writes the same captured findings artifact to each bundled task before starting the foreman.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| `runColdCodexReview()` treats empty captured findings as `success: false`, even if the process exits cleanly. | The plan's success sketch mentioned subprocess failure flags, but AC-2 defines "can't be obtained" as no findings output. The helper now matches the AC directly. | Strengthens AC-2. |
| Added `CodeReviewPhaseDeps` injection in `code-review.ts` instead of testing the phase through live git/Codex/Claude subprocesses. | The phase has several production collaborators before and after the new step. Dependency injection keeps tests phase-level while proving ordering, bundle writes, mini-model selection, and hard-fail behavior without live agent CLIs. | Supports AC-1, AC-2, AC-5, AC-14. |
| Fake Codex scripts are created inline in `tests/run-task-code-review.test.ts` instead of a separate fixture file. | The scripts are tiny and test-specific; keeping them inline avoids a new fixture artifact. | No AC impact. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: cold-Codex before foreman, mini model, artifact | Met | `runCodeReviewPhase()` calls `runColdCodexReview()` before `runClaude()`, writes `review-cold-codex.md`, and test asserts ordering/model/artifact. |
| AC-2: unavailable Codex review stops before foreman/qa | Met | Phase exits with code 1 before `runClaude()` when findings are unavailable; bundle test asserts no foreman and `qa` remains pending. |
| AC-3: cold means unprompted/unanchored branch diff | Met | Runner invokes `codex exec review --json --base <base> -m <model>` with no custom prompt/spec injection or artifact filtering. |
| AC-4: run-log duration line | Met | Phase measures around the cold review call and logs `→ cold-codex review (<taskIds>): <n>s`. |
| AC-5: bundle contract | Met | One cold review call per phase invocation; same findings written to every task; failure exits before any member advances. |
| AC-6: foreman receives fresh cold-Codex findings | Met | `promptCodeReview()` accepts findings and phase passes the fresh result every review round before foreman launch. |
| AC-7: foreman still spawns two Claude lenses only | Met | Foreman template keeps `code-review-anchored` and `code-review-cold` Task instructions and explicitly says not to run Codex. |
| AC-8: separate reconciliation checks and no off-AC cold dismissal | Met | Foreman template separates code validity for cold lenses from spec scope for anchored findings and forbids dismissing verified cold findings for being off-AC. |
| AC-9: lens-count wording on live surfaces | Met | Updated foreman template, review template, and both Claude lens charters; mirrors synced. |
| AC-10: structural sweep | Met | Required `rg` command returned no matches after template sync. |
| AC-11: decisions old count rule rewritten | Met | `docs/decisions.md` now scopes near-clone caution to same-model additions and records cross-family exception. |
| AC-12: parked Codex phase decision updated | Met | `docs/decisions.md` records cold-Codex as adopted in-pipeline and PR-level Codex as retained backstop. |
| AC-13: new design decision recorded | Met | Added cold-Codex design entry covering orchestrator-run sequential review, mini model, hard-fail, bundle contract, and concurrency tradeoff. |
| AC-14: tests | Met | Added `tests/run-task-code-review.test.ts`; updated prompt test and golden. Full suite passes. |
| AC-15: docs | Met | Updated `docs/pipeline-orchestrator.md` and `docs/product-context.md`; synced pipeline doc mirror. |
| AC-16: build/sync/validation | Met | Build, sync, lint, type-check, tests, docs refs, and grep gate all run. `dist/scripts/run-task.js` is regenerated and listed in Changes for the orchestrator-owned commit. |

## Edge Cases Considered

- Codex exits nonzero with no `agent_message`: treated as review unavailable.
- Codex exits cleanly with no `agent_message`: treated as review unavailable.
- Codex emits findings text: treated as successful review text for foreman adjudication regardless of finding severity.
- Bundle success: one review result fans out to every task artifact.
- Bundle failure: exits before foreman and before any task reaches `qa`.
- Re-review: phase obtains a new cold-Codex result each round instead of reusing prior artifacts.
- Prompt callers that omit findings get an explicit warning that missing cold-Codex is not approval evidence.

## Blockers

- (none)

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Clean after fixing test fake shapes. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit`. |
| `npm test` | Pass | 886 pass, 1 skipped, 0 fail. |
| `UPDATE_GOLDENS=1 npm test` | Pass | 886 pass, 1 skipped, 0 fail; regenerated prompt golden stayed consistent. |
| `npm run build` | Pass | Build completed and regenerated `dist/scripts/run-task.js`, which is listed in Changes for the orchestrator-owned commit. Pre-commit `git diff --exit-code -- dist/` returns nonzero because that generated dist change is intentionally still uncommitted in this phase. |
| `npm run sync-templates` | Pass | Generated canon-managed mirrors. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| Structural grep gate (AC-10) | Pass | Required `rg -n --hidden ...` command returned no matches. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
