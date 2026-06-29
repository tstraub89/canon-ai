# Completion Summary: task-metadata-helpers — canon task set — set task metadata fields without hand-editing status.json

> For the human. This is what you need to know.

## What Changed

Added `canon task set <id> <field> <value>` — a new subcommand that gives operators a sanctioned way to update task metadata fields without hand-editing `status.json`. Every field resolves to one of three outcomes: settable fields (`title`, `task_size`, `delicate`, `worktree`, `base_branch`) write cleanly with validation; guarded or derived fields (`full_send`, `human_spec_gate`, `status`, `branch`, `phases`, `sessions`, `canon`, `escalations`) refuse and print the correct command to use instead; immutable fields (`id`, `created`, `updated`, `_`-prefixed keys) refuse with a terse explanation. Setting a field on an already-running task succeeds but warns that the change takes effect on the next `canon run`.

Two correctness gaps were caught in review and fixed before ship: (1) the handler was writing to the supervising-checkout copy of `status.json` instead of the active worktree copy — caught in code review round 1, fixed in iteration 2 with a worktree-routing fix and a routing regression test. (2) An amendment after PR-level Codex review introduced a topology-field lock: `worktree` and `base_branch` cannot be changed once a branch has been recorded, because a post-branch topology flip leaves `resolveTaskCwd` unable to locate the active worktree (the "bricked task" class). The lock is evaluated before value parsing; metadata fields (`title`, `task_size`, `delicate`) remain settable at any point.

## Files Changed

- `src/task/index.ts` — `taskSet()` handler: three-category field taxonomy, value validation, topology-lock guard, past-pending warning, `updated` timestamp refresh; dispatch and help wiring.
- `scripts/run-task/state.ts` — exported `validateBranchField()` for reuse by `taskSet()`.
- `src/cli/index.ts` — added `canon task set` to the CLI help block.
- `docs/pipeline-orchestrator.md` — added `set` row to the task-subcommand reference table documenting the metadata/topology split and the pre-branch-only lock.
- `templates/docs/pipeline-orchestrator.md` — generated mirror (synced by pre-commit hook).
- `AGENTS.md` — added `set` to the `canon task` command list.
- `tests/task-cli.test.ts` — coverage for valid writes, invalid values, redirects, immutables, past-pending warning, dispatch, worktree-routing regression, topology-lock tests, and arg-count rejection.
- `tests/cli.test.ts` — extended CLI help assertion.
- `dist/cli/index.js` — rebuilt bundle.

## How to Test

1. **Happy path — resize a task:** `canon task new resize-test "test" && canon task set resize-test task_size L`. Run `canon task status resize-test` and confirm `task_size` is now `L`.
2. **Invalid value:** `canon task set resize-test task_size Medium` → confirm non-zero exit with an error naming the valid sizes.
3. **Guarded field:** `canon task set resize-test full_send true` → confirm non-zero exit with a message pointing to `canon run --full-send`.
4. **Derived field:** `canon task set resize-test status done` → confirm non-zero exit pointing to `canon task phase`.
5. **Unknown field:** `canon task set resize-test nope 1` → confirm the error text lists the settable field names.
6. **Past-pending warning:** advance `resize-test` past pending, then `canon task set resize-test task_size M` → write succeeds AND prints a warning about taking effect on the next `canon run`; on a `pending` task the same command writes silently.
7. **Topology lock:** once a branch is recorded on a task, `canon task set <id> worktree false` should be rejected with an error naming the recorded branch and why it is locked.
8. Expected: every field either changes or gives you the right command — no JSON editing needed.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final re-run in Iteration 3. |
| `npm run type-check` | Pass | Final re-run in Iteration 3. |
| `npm test` | Pass | Full suite passed after reroute changes and review-artifact cleanup in Iteration 3. |
| `npm run build` | Pass | `dist/cli/index.js` rebuilt to match source. |
| `npm run sync-templates:check` | Pass | Mirror aligned. |
| `npm run docs-refs-check` | Pass | |

## Human Verification Required

None.

## Proposed Changelog

> Entry text only. Version number and bump tier are decided at the release step.

**`canon task set` — update task metadata without hand-editing `status.json`.** `canon task set <id> <field> <value>` sets flat top-level task fields directly from the CLI. Settable fields: `task_size`, `delicate`, `worktree`, `base_branch`, `title`. Guarded run-stance fields (`full_send`, `human_spec_gate`) redirect to the correct command instead of writing; derived and nested orchestrator-owned fields refuse with clear guidance. Unknown fields list the settable ones. Topology fields (`worktree`, `base_branch`) are locked once a branch is recorded to prevent task-state corruption. Setting a metadata field on an in-progress task succeeds but prints a warning that the change takes effect on the next `canon run`.

## Decisions Made

- **Three-category field taxonomy with no silent no-ops.** Every field is explicitly classified; the command never silently drops a write.
- **Topology-field lock (amendment after PR review).** `worktree`/`base_branch` rejected when `status.branch` is non-empty; lock evaluated before value parsing. Metadata fields remain settable at any point.
- **Extra positional args rejected (not silently dropped).** `canon task set <id> title New Title` exits non-zero with a hint to quote multi-word values.
- **Warning keys off phase progress, not the top-level `status` pointer.** A freshly scaffolded task has all phases pending but its top-level `status` already reads `spec`; keying off the top-level pointer would false-warn on every new task.
- **`base_branch` rejects empty/whitespace-only strings.** The shared `validateBranchField()` treats empty as "use the default base"; explicit rejection is safer at the CLI setter level.
- **No `--force` path into guarded fields.** The redirects exist to preserve the guards; there is no flag to bypass them via `set`.
- **Worktree-aware resolver required.** `taskSet()` must route through the worktree-aware resolver before locating `status.json` — caught in code review (round 1), fixed in iteration 2.

## Open Questions

None.
