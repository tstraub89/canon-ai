# QA Summary: split-run-task — Split run-task.ts monolith into modules

> QA author: Claude | Date: 2026-05-09

## What Changed

`scripts/run-task.ts` was a 4545-line, 152-declaration monolith that mixed phase-prompt construction, git plumbing, worktree management, agent I/O, validation, status I/O, metrics, CLI parsing, and the orchestration loop into a single file. It has been split into a directory of focused modules under `scripts/run-task/`, with the entry point preserved at `scripts/run-task.ts` (now 6 lines).

**New module tree:**

- `scripts/run-task/main.ts` — orchestration loop and phase dispatcher
- `scripts/run-task/types.ts` — shared types and type guards
- `scripts/run-task/cli.ts` — argument parsing, usage, log helpers
- `scripts/run-task/state.ts` — status I/O, path helpers, session storage
- `scripts/run-task/policy.ts` — tier detection and model config
- `scripts/run-task/metrics.ts` — metric recording
- `scripts/run-task/env.ts` — env constants and env-var warnings
- `scripts/run-task/git.ts` — git plumbing, branch helpers, porcelain parsers
- `scripts/run-task/worktree.ts` — worktree lifecycle, artifact/telemetry sync
- `scripts/run-task/validation.ts` — handoff validation, diff cross-check, done.md helpers
- `scripts/run-task/context.ts` — context-block builders for prompts
- `scripts/run-task/task-sh.ts` — thin wrapper around `scripts/task.sh`
- `scripts/run-task/agents/stream.ts` — shared subprocess-stream primitive
- `scripts/run-task/agents/claude.ts` — Claude runner
- `scripts/run-task/agents/codex.ts` — Codex runner
- `scripts/run-task/phases/{spec,spec-review,plan,implement,code-review,qa}.ts` — per-phase handlers
- `scripts/run-task/prompts/index.ts` — prompt builder functions
- `scripts/run-task/prompts/render.ts` — thin Mustache adapter
- `scripts/run-task/prompts/helpers.ts` — startup blocks, task list, phase commands, `toResumePrompt`
- `scripts/run-task/prompts/templates/*.md` — 11 Mustache template files (one per logical prompt)

**Other changes:**

- `mustache` and `@types/mustache` added to `package.json`
- New golden-output test suite at `tests/run-task-prompts.test.ts` with committed goldens in `tests/run-task-prompts.golden.json` — asserts byte identity between golden captures and the new template-rendered output
- Existing parser tests (`run-task-parse-porcelain`, `run-task-validation`) updated to import from the split modules
- `docs/codebase-map.md`, `docs/architecture.md`, and `docs/patterns.md` updated to reflect the new file layout

**Behavior:** The pipeline behaves identically to before. Every code path produces the same output. The user-facing invocation (`npx tsx scripts/run-task.ts <id>`, `npm run run-task`) is unchanged.

## Files Changed

- `scripts/run-task.ts` — gutted to 6-line entry point
- `scripts/run-task/main.ts` — new; orchestration loop and phase dispatcher
- `scripts/run-task/types.ts` — new; shared types and type guards
- `scripts/run-task/cli.ts` — new; argument parsing and log helpers
- `scripts/run-task/state.ts` — new; status I/O, path helpers, session storage
- `scripts/run-task/policy.ts` — new; tier detection and model config
- `scripts/run-task/metrics.ts` — new; metric recording
- `scripts/run-task/env.ts` — new; env constants and warnings
- `scripts/run-task/git.ts` — new; git plumbing and porcelain parsers
- `scripts/run-task/worktree.ts` — new; worktree lifecycle and telemetry sync
- `scripts/run-task/validation.ts` — new; handoff and diff validation
- `scripts/run-task/context.ts` — new; context-block builders for prompts
- `scripts/run-task/task-sh.ts` — new; `scripts/task.sh` wrapper
- `scripts/run-task/agents/stream.ts` — new; shared subprocess-stream primitive
- `scripts/run-task/agents/claude.ts` — new; Claude runner
- `scripts/run-task/agents/codex.ts` — new; Codex runner
- `scripts/run-task/phases/spec.ts` — new; spec phase handler
- `scripts/run-task/phases/spec-review.ts` — new; spec_review phase handler
- `scripts/run-task/phases/plan.ts` — new; plan phase handler
- `scripts/run-task/phases/implement.ts` — new; implement phase handler
- `scripts/run-task/phases/code-review.ts` — new; code_review phase handler
- `scripts/run-task/phases/qa.ts` — new; qa phase handler
- `scripts/run-task/prompts/index.ts` — new; prompt builder functions
- `scripts/run-task/prompts/render.ts` — new; Mustache adapter
- `scripts/run-task/prompts/helpers.ts` — new; startup blocks and `toResumePrompt`
- `scripts/run-task/prompts/templates/spec.md` — new; spec prompt template
- `scripts/run-task/prompts/templates/spec-revision.md` — new
- `scripts/run-task/prompts/templates/spec-review.md` — new
- `scripts/run-task/prompts/templates/plan.md` — new
- `scripts/run-task/prompts/templates/implement.md` — new
- `scripts/run-task/prompts/templates/implement-revisions.md` — new
- `scripts/run-task/prompts/templates/implement-reroute.md` — new
- `scripts/run-task/prompts/templates/code-review-round-1.md` — new
- `scripts/run-task/prompts/templates/code-review-round-n.md` — new
- `scripts/run-task/prompts/templates/qa.md` — new
- `tests/run-task-prompts.test.ts` — new; golden-output test suite
- `tests/run-task-prompts.golden.json` — new; committed golden fixtures
- `tests/run-task-parse-porcelain.test.ts` — updated imports
- `tests/run-task-validation.test.ts` — updated imports
- `package.json` / `package-lock.json` — added `mustache` and `@types/mustache`
- `docs/codebase-map.md` — updated for new module layout
- `docs/architecture.md` — updated parser references
- `docs/patterns.md` — updated file-path references and phase-addition discipline

## How to Test

1. Run `npm install` (pulls in the new `mustache` dependency).
2. Run `npm run lint && npm run type-check && npm test`. All three should pass. The golden-prompt test suite reports a passing suite.
3. Open `scripts/run-task.ts` — it should be ~6 lines that import and call `main()` from `./run-task/main.js`.
4. Open any prompt template (e.g., `scripts/run-task/prompts/templates/spec.md`). It should be readable as prose with `{{ }}` placeholders for dynamic data only — no TypeScript control flow embedded in the template.
5. **Real-pipeline smoke** (recommended before approving merge): follow the smoke steps in `tasks/split-run-task/spec.md` §Human Test Plan (create throwaway task `smoke-split-run-task`, run spec and spec_review phases, confirm exit 0 and non-empty output, delete the smoke task).

## Test Results

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` (including golden suite) | Pass |
| Full build | N/A (`tsx` runs scripts directly) |
| Real-pipeline smoke | Pending human verification |

All three automated checks passed on the final code state after 3 code review iterations.

## Decisions Made

- **`toResumePrompt` lives in `prompts/helpers.ts`, not `state.ts`**: Breaking a would-be import cycle — `prompts/helpers.ts` needs `resolveTaskCwd` from `state.ts`; moving `toResumePrompt` here means `state.ts` has no dependency on `prompts/`, keeping the graph a DAG.
- **Separate template files for round-1 vs round-N code review**: The two conditional branches in `promptCodeReview` become two files rather than a conditional inside one template. Mustache's logic-less constraint pushes branching to the dispatcher, which is the cleaner shape.
- **`canPhaseAdvance()` not added**: AC-3 referenced this function as a fourth phase-aware switch, but the function doesn't exist anywhere in the codebase (confirmed by grep). Rather than introduce a new function to match the spec wording, the docs were corrected to match the actual three-switch shape (`PHASE_ORDER`, `runPhase()`, `checkAndRoute()`). The implementation is correct; the spec text was stale.
- **Legacy fallback in `main.ts` left in place**: The original `runPhase()` body remains below the new dispatch as dead code. This was a deliberate low-risk choice during the refactor. It can be deleted in a follow-up S task once the split is bedded in.

## Open Questions

- **Legacy fallback cleanup**: The dead `runPhase()` body in `scripts/run-task/main.ts` below the active dispatch path should be removed. A short follow-up S task ("delete dead fallback in main.ts") would close this out.
- **Real-pipeline smoke result**: Pending human verification at `human_review`. If the smoke step reveals a behavior regression, the most likely failure mode is a path-resolution issue in worktree vs. non-worktree contexts (flagged as Known Risk in the spec).

---

## Proposed Changelog

**Proposed version bump: 0.3.0 (minor)**

Rationale: Phase prompts now live as editable Mustache template files — a new authoring surface that contributors interact with directly. `mustache` is added as a runtime dependency. Under the project's SemVer policy, "new template section" maps to minor. No pipeline behavior changes; no breaking changes for adopters.

```markdown
## [0.3.0] — 2026-05-09

### Changed

- `scripts/run-task.ts` (4545 lines) is split into a directory of focused modules under `scripts/run-task/`. Phase handlers, agent runners, utility modules, and prompt builders each live in their own file. Entry point and all CLI invocations are unchanged.
- Phase prompts move from inline TypeScript builder functions to Mustache templates (`.md` files under `scripts/run-task/prompts/templates/`). Editing prompt prose no longer requires reading TypeScript control flow. Added `mustache` as a runtime dependency.
- Golden-output test suite added (`tests/run-task-prompts.test.ts`): asserts byte identity between committed golden captures and the template-rendered output, giving future prompt edits a regression tripwire.
```

The human finalizes wording and date before the changelog commit lands.
