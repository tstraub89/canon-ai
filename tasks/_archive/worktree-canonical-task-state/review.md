# Code Review: worktree-canonical-task-state

## Validation Gate

**BLOCKED — pre-flight rejected handoff before full review:**

- AC Coverage table only contains template placeholder rows (Status "Met / Partial / Not met") — fill in actual AC statuses
- Validation Required item missing from handoff.md: `lint` (`npm run lint`). Handoff has rows for: . (Required canonicalized to: 'lint'.)
- Validation Required item missing from handoff.md: `type-check` (`npm run type-check`). Handoff has rows for: . (Required canonicalized to: 'type-check'.)
- Validation Required item missing from handoff.md: `unit tests` (`npm test`) — full suite passes. Handoff has rows for: . (Required canonicalized to: 'tests'.)
- Validation Required item missing from handoff.md: `build` (`npm run build`) — required per `docs/architecture.md` Full build binding; CI gates on `git diff --exit-code -- dist/`. Handoff has rows for: . (Required canonicalized to: 'build'.)

## Verdict

- [x] **Changes requested** — fix the above and resubmit handoff.

---

## Round 2 — verifying iteration 1's response to round 1

### Round 1 findings verification

**Finding: AC Coverage had template placeholder rows** → **Addressed.** Iteration 2 appended the concrete AC-1 through AC-26 table; all rows have specific "Met" statuses with evidence notes.

**Finding: Missing validation rows (lint, type-check, unit tests, build)** → **Addressed.** Handoff now records Pass for lint, type-check, unit tests (479 / 478 pass / 1 skip), build, docs-refs-check, and sync-templates:check.

### Stage 1 — not re-run (already passed in round 1 pre-flight; re-review is of iteration changes only)

### Stage 2 — new findings from iteration 1's changes

**optional cleanup/nit** — `taskDirForCwd` accepts `cwd` but silently discards it via `void cwd` when `tasksRoot()` is relative (`state.ts`, mirrored in both dist bundles). The parameter is kept for API compatibility, but its name implies it is used. Renaming to `_cwd` would signal intentional discard at the source level and prevent a future caller from passing a non-`process.cwd()` value and expecting it to take effect. No behavioral impact today.

**optional cleanup/nit** — `canon task list` now routes each entry through `resolveTaskCwd`, so a task with `worktree: true` in its `status.json` but a deleted worktree will cause `die()` during list (`state.ts:67–71`). The previous code would silently show stale REPO_ROOT state. Crashing fast is defensible, but if there is a `--tolerateMissingWorktree` use case for list, the existing guard in `getActiveCwd` (`tolerateMissingWorktree` option) is not threaded through here. No action required for this task unless the product decision is that list should be robust to orphaned worktree pointers.

### Verdict

- [x] **Approved with nits** — both nits are cleanup items with no behavioral impact on the core feature. Ship as-is or address in a follow-up.
