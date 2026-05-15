# Spec: prompt-fidelity-tests — Prompt-fidelity regression test suite rebuild

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

The original `tests/run-task-prompts.test.ts` + `tests/run-task-prompts.golden.json` were deleted
because they had three portability failures:

1. **Absolute paths baked into goldens** — goldens contained the local worktree path, so they only
   passed on one machine.
2. **Live `docs/patterns.md` injected at render time** — `buildKnownPitfalls()` reads the real file,
   so goldens went stale with every lessons sweep.
3. **`TASKS_DIR` hardcoded at module load** — `taskDirFor()` derived the task directory from
   `REPO_ROOT` at import time; fixture writes to a temp dir didn't redirect the production reads.

The prompt builders (`scripts/run-task/prompts/index.ts`) now have no regression coverage. Any
change to a template or helper can silently corrupt what agents receive.

## Decision

Rebuild the suite with portable infrastructure that eliminates all three failures:

1. **`CANON_TASKS_DIR_OVERRIDE`**: make `taskDirFor()` read this env var at call time; tests set it
   to a `mkdtempSync` temp dir before calling any builder.
2. **`CANON_PATTERNS_MD_PATH`**: make `buildKnownPitfalls()` read this env var at call time; tests
   point it at a committed stub file with fixed content.
3. **`<REPO_ROOT>` placeholder normalization**: after calling each builder, replace the live
   `REPO_ROOT` value with the literal string `<REPO_ROOT>` before comparing or storing. No absolute
   paths in committed goldens.

With these three changes in place, the test creates a temp fixture task, calls all prompt builders,
normalizes the output, and compares against committed goldens. An `UPDATE_GOLDENS=1` env var
regenerates the golden file when templates are intentionally changed.

## Non-Goals

- Bundle-mode or fast-tier prompt variants — single task, full tier only.
- `buildContextBlock` injection — fixture specs have empty Affected Files tables, so the block
  returns `''` naturally; no override needed.
- `promptImplement` resume mode — happy-path `fresh` mode only.
- Exhaustive multi-scenario coverage per builder — one representative call per builder is enough to
  catch template or wiring regressions.

## Acceptance Criteria

- [ ] **AC-1**: In `scripts/run-task/state.ts`, two functions read `CANON_TASKS_DIR_OVERRIDE` at
  call time when set:
  - `taskDirFor(id)` returns `path.join(process.env.CANON_TASKS_DIR_OVERRIDE, id)` instead of
    `path.join(TASKS_DIR, id)`.
  - `statusFileFor(id)` returns `path.join(process.env.CANON_TASKS_DIR_OVERRIDE, id, 'status.json')`
    instead of going through `resolveTaskCwd`. This is necessary because `readStatus()` calls
    `statusFileFor()`, and `promptCodeReview` calls `getBaseBranch()` which calls `readStatus()` —
    the worktree-aware `resolveTaskCwd` path does not consult `taskDirFor` and would look in
    `REPO_ROOT/tasks/<id>/` for a fixture task that only exists in the temp dir.

- [ ] **AC-2**: `buildKnownPitfalls()` in `scripts/run-task/context.ts` reads patterns content from
  the path at `process.env.CANON_PATTERNS_MD_PATH` (when set) instead of
  `path.join(REPO_ROOT, 'docs/patterns.md')`. The `## Known Pitfalls` extraction regex and return
  format are unchanged.

- [ ] **AC-3**: `tests/run-task-prompts.test.ts` exists and covers all 10 prompt builder calls:
  `promptSpec`, `promptSpecRevision`, `promptSpecReview`, `promptPlan`, `promptImplement` (fresh),
  `promptImplementRevisions` (iteration 1), `promptImplementReroute` (reroute 1),
  `promptCodeReview` (round 1), `promptCodeReview` (round N / iteration 1), `promptQa`.

- [ ] **AC-4**: The test creates all fixture files in `fs.mkdtempSync(...)`, sets
  `process.env.CANON_TASKS_DIR_OVERRIDE` and `process.env.CANON_PATTERNS_MD_PATH` before any
  builder calls, normalizes output by replacing the live `REPO_ROOT` value with `<REPO_ROOT>`, and
  removes the temp dir in a `finally` block.

- [ ] **AC-5**: `tests/run-task-prompts.golden.json` is committed, contains one key per test case
  named after the builder + variant (e.g. `promptImplement_fresh`, `promptCodeReview_round1`), and
  contains no absolute paths — all machine-specific values replaced with `<REPO_ROOT>`.

- [ ] **AC-6**: When `process.env.UPDATE_GOLDENS === '1'`, the test writes current normalized
  output to `tests/run-task-prompts.golden.json` and skips assertions. A comment in the test file
  documents: `Run UPDATE_GOLDENS=1 npm test after intentional template changes to regenerate.`

- [ ] **AC-7**: `npm test` passes on a clean checkout without `UPDATE_GOLDENS=1`. The new files
  are picked up automatically by the existing `tests/*.test.ts` glob.

## Design

### Affected Files

| File | Change |
|---|---|
| `scripts/run-task/state.ts` | `taskDirFor()`: read `CANON_TASKS_DIR_OVERRIDE` at call time |
| `scripts/run-task/context.ts` | `buildKnownPitfalls()`: read `CANON_PATTERNS_MD_PATH` at call time |
| `tests/run-task-prompts.test.ts` | New — full prompt-builder test suite |
| `tests/run-task-prompts.golden.json` | New — committed goldens with `<REPO_ROOT>` placeholders |
| `tests/fixtures/patterns.stub.md` | New — fixed-content stub for `buildKnownPitfalls` in tests |

### Interaction Dependencies

`taskDirFor()` is called by `buildKnownRisks()`, `buildContextBlock()`, `extractAffectedFiles()`,
`extractValidationChecks()`, and `extractAcSummary()` — the override covers all of these
transitively.

`getBaseBranch()` calls `readStatus()` which calls `statusFileFor()`, not `taskDirFor()`. That is
why `statusFileFor()` also needs the override (AC-1). Without it, `promptCodeReview` would crash
looking for a fixture task that only exists in the temp dir.

### Data Model Changes

None.

## Validation Required

- [x] `type-check` (`npm run type-check`)
- [x] `test` (`npm test`)
- [x] `lint` (`npm run lint`)

## Docs Impact

None — no pipeline behavior or user-facing behavior changes.

## Known Risks

- **ESM module caching**: `REPO_ROOT` and `TASKS_DIR` are exported as module-level constants in
  `env.ts`. The `CANON_TASKS_DIR_OVERRIDE` check must live inside `taskDirFor()` at call time (not
  in `env.ts`) to avoid re-import issues. The existing `import { TASKS_DIR }` in `state.ts` stays
  as the fallback value; `taskDirFor` just checks the env var first before using it.

- **`getBaseBranch` reads status.json via `statusFileFor`**: `getBaseBranch` → `readStatus` →
  `statusFileFor` (not `taskDirFor`). The `statusFileFor` override in AC-1 handles this. The
  fixture `status.json` must set `base_branch: "main"` to produce a deterministic golden.

- **Fixture `PipelineState` construction**: builders take a `PipelineState` with a full
  `StatusJson`. The fixture needs a minimal but valid `StatusJson`. Use the shape from
  `tasks/_templates/status.json` as reference. Fields that builders inspect (`task_size`, `delicate`,
  `base_branch`, phase entries) must be present.

- **Golden drift on intentional changes**: any template or helper change requires
  `UPDATE_GOLDENS=1 npm test` to regenerate. This is expected behavior — the failure is the signal.

## Human Test Plan

1. Run `npm test` — all existing tests plus the new prompt-fidelity suite pass.
2. Open any file in `scripts/run-task/prompts/templates/` and make a trivial whitespace change.
3. Run `npm test` — the prompt-fidelity test for that template fails with a diff showing the
   change.
4. Run `UPDATE_GOLDENS=1 npm test` — goldens regenerate and `npm test` passes again.
5. Revert the template edit. Run `npm test` — fails again (golden now reflects the whitespace
   edit, template was reverted). Run `UPDATE_GOLDENS=1 npm test` to restore.
6. Inspect `tests/run-task-prompts.golden.json` — no line contains `/Users/`, `/tmp/`, or any
   other absolute path.
