# Completion Summary: qa-drafts-pr-body — QA drafts a filled PR body for --pr

> For the human. This is what you need to know.

## What Changed

The QA phase now drafts `tasks/<id>/pr-body.md` — a filled, outward-facing PR body written without canon attribution. When `canon run --pr` runs for a single task, it uses this file as the PR body (when populated) instead of passing the raw repo template to `gh pr create`. The resolution order is: `CANON_PR_BODY` env → populated `pr-body.md` → repo PR template → `--fill`. Bundle runs and absent or stub `pr-body.md` files fall back to the prior behavior with a visible log line explaining why.

The QA prompt now instructs the QA agent to fill the repo's PR template (resolved worktree-first, matching `--pr`'s own precedence) or write a default skeleton when no template exists. A new `isPrBodyTemplate` stub detector in `validation.ts` defines "populated" consistently across both the QA phase and `--pr`. The `pr-body.md` template is a first-class canon-managed artifact scaffolded by `canon task new`, synced by `canon upgrade`, and committed alongside other task artifacts at `--pr` time.

## Files Changed

| File | What |
|---|---|
| `scripts/run-task/phases/qa.ts` | Resolves PR template worktree-first; passes it to `promptQa` |
| `scripts/run-task/prompts/index.ts` | `promptQa` accepts + injects the resolved PR template or default skeleton signal |
| `scripts/run-task/prompts/templates/qa.md` | Instructs QA to write a filled outward-facing `pr-body.md` with no canon attribution |
| `scripts/run-task/main.ts` | Inserts populated-`pr-body.md` into `--pr` body-resolution chain; bundle + absent/stub → log + fallback |
| `scripts/run-task/validation.ts` | Adds `isPrBodyTemplate` (sibling of `isDoneMdTemplate`) |
| `scripts/run-task/worktree.ts` | Adds `pr-body.md` to `TASK_ARTIFACT_FILES` |
| `.canon/templates/pr-body.md` | New canon-managed artifact stub template |
| `src/lib/canon-owned.ts` | Registers `.canon/templates/pr-body.md` in `CANON_OWNED` |
| `templates/AGENTS.md` | Mirror: AGENTS.md task-artifact and QA-summary updates |
| `templates/CLAUDE.md` | Mirror: QA `pr-body.md` guidance |
| `templates/docs/pipeline-orchestrator.md` | Mirror: new `--pr` body-resolution order and task-artifact listing |
| `templates/.canon/templates/pr-body.md` | Mirror: new canon template stub |
| `dist/cli/index.js` | Rebuilt bundle (CLI/doc changes) |
| `dist/scripts/run-task.js` | Rebuilt bundle (orchestrator + QA prompt changes) |
| `docs/pipeline-orchestrator.md` | Documents new `--pr` body-resolution order + `pr-body.md` artifact |
| `docs/codebase-map.md` | Adds `pr-body.md` row to task-artifact-templates table |
| `AGENTS.md` | Documents `pr-body.md` in task artifact list, QA handoff sequence, and `--pr` allow-list |
| `CLAUDE.md` | Notes QA drafts `pr-body.md` |
| `tests/run-task-safety.test.ts` | New coverage: `resolveQaPrBody`, `--pr` fallback log, bundle fallback |
| `tests/run-task-validation.test.ts` | New coverage: `isPrBodyTemplate` positive/negative/missing cases |
| `tests/run-task-prompts.golden.json` | Regenerated QA snapshot for template injection branches |
| `tests/run-task-prompts.test.ts` | New coverage: explicit PR-template injection path |
| `tests/cli.test.ts` | Adds `templates/.canon/templates/pr-body.md` to adopter-shipped leakage scan |

## How to Test

Follow the Human Test Plan from the spec:

1. In a repo that **has** a PR template, run a task through the pipeline to the QA step. Read `tasks/<id>/pr-body.md` and confirm it follows the template's sections, describes what actually shipped, and reads like a person wrote it — with no mention of canon or AI tooling.
2. Open the draft PR via `canon run <id> --pr`. Confirm the PR opens pre-filled with that body, not the raw empty template.
3. In a repo with **no** PR template, run a task to QA and confirm the drafted body has sensible default structure (Summary / Changes / How to test / Notes).
4. Set `CANON_PR_BODY` and run the same flow; confirm your override still wins over `pr-body.md`.
5. Take a task without a drafted `pr-body.md` (or replace it with the stub), open the PR, and confirm it still opens — falling back to prior behavior — with a visible log line explaining the fallback.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite, including new prompt / safety / validation coverage |
| `npm run build` | Pass | `dist/` rebuilt after source changes |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| E2E | Not applicable | No UI surface — deferred per spec |

## Human Verification Required

None.

## Decisions Made

- The body is outward-facing with no canon attribution — preserves the 1.3.0 ninja-mode guarantee.
- Soft fallback only; the QA phase is not gated on `pr-body.md` (`done.md` remains the only hard gate).
- Bundle runs do not combine per-task bodies; they fall back with a log line. Bundle synthesis is deferred to the `/canon-pr` BACKLOG entry.
- Worktree-first template resolution in both QA and `--pr` ensures they see the same template, even when a task branch has added or edited the repo's PR template.
- `TASK_ARTIFACT_FILES` in `worktree.ts` is bookkeeping (the actual `--pr` commit stages the entire task dir); the real upgrade-sync mechanism is the `CANON_OWNED` entry in `src/lib/canon-owned.ts`.

## Open Questions

None.

## Proposed Changelog

**Proposed version bump**: Minor (`1.9.0`) — new agent capability (QA-drafted PR bodies) without breaking existing usage or requiring adopter migration.

**Proposed `### Added` entry for `[Unreleased]`** (human finalizes copy):

- **QA drafts a filled PR body for single-task `--pr` runs.** After the QA phase, `tasks/<id>/pr-body.md` contains a filled, outward-facing PR body — no canon attribution, written to read as if a human authored it. `canon run --pr` resolves the body in order: `CANON_PR_BODY` env (unchanged, still wins) → populated `pr-body.md` → repo PR template → `--fill`. When no body is available (absent or still the scaffold stub), `--pr` falls back to the prior behavior and logs why. Bundle PRs are unchanged. `pr-body.md` is a new canon-managed template artifact, scaffolded by `canon task new` and synced by `canon upgrade`.
