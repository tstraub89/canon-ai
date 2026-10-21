# Implementation Handoff: base-drift-conflicts-only

> Author: Codex | Spec: `tasks/base-drift-conflicts-only/spec.md` | Plan: `tasks/base-drift-conflicts-only/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/git.ts` | Added typed `probeMergeConflicts` using NUL-delimited `git merge-tree` output and exit/OID disambiguation. |
| `src/orchestrator/validation.ts` | Return the conflict probe with base drift results and build conflict/scope abort messages. |
| `src/orchestrator/main.ts` | Run the gate immediately before each push; soft-reset the just-created human_review commit on dirty-path aborts; report clean base advance and handle force/unsupported/error outcomes. |
| `src/orchestrator/cli.ts`, `src/cli/index.ts` | Updated `--pr` and `--push` help text; corrected the divergent-base gate description. |
| `tests/run-task-safety.test.ts` | Stubbed merge-tree/reset/three-dot fake-git behavior and added real-git and fake-git gate, rollback, hook, retry, force, and probe-failure coverage. |
| `tests/run-task-validation.test.ts` | Updated message and result assertions; added clean/conflict/bad-ref merge-tree probe coverage including a spaced path. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented the conflict-only base-side gate, rollback, version handling, and bypass rules; synced the managed mirror. |
| `docs/codebase-map.md` | Documented the conflict probe helper and push-time gate. |
| `docs/patterns.md` | Added merge-tree exit semantics and distinguished mergeability from tree-diff questions. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Regenerated build output. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The gate now probes the commit Git recorded, including pre-commit hook rewrites. Clean base advancement is informational; actual conflicts and task-changed files outside Affected Files remain blocking. If a dirty-path gate aborts after the human_review commit, a soft reset restores the previous HEAD and leaves the changes staged for a retry.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| None | Implemented the specified probe placement, fake-git behavior, tests, and docs. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Rewritten real-git test passes on clean non-overlapping advance. Pre-fix run failed with the old base-advance abort naming `docs/BACKLOG.md`; command: `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='passes when the base advances on non-overlapping files' tests/run-task-safety.test.ts`. |
| AC-2 | Met | Real-git test passes with another task's spec and status artifacts added to base. |
| AC-3 | Met | Real same-line conflict names the declared path and remediation; HEAD is restored and no task branch is pushed. |
| AC-4 | Met | Existing out-of-scope drift tests still abort; fake-git assertions now verify commit then soft reset and no push. Abort message unit coverage distinguishes causes. |
| AC-4b | Met | Combined conflict and task-scope drift output includes both sections. |
| AC-4c | Met | Dirty admitted-doc, hook-rewritten commit, and clean-tree retry conflict cases are covered. |
| AC-4d | Met | After reverting the base-side edit, rerun succeeds and commits the staged document with task artifacts. |
| AC-5 | Met | Fake-git force case bypasses conflicts with both paths in the warning; force on clean base advance has no override warning. |
| AC-6 | Met | Unsupported Git warns and proceeds; generic probe errors fail closed with and without force; failed soft-reset message includes manual recovery. |
| AC-7 | Met | Help and docs describe conflict-only base blocking; managed mirror synced; required stale-string and restatement greps return no hits. |
| AC-8 | Met | Build, lint, type check, full tests, docs refs, and template sync checks passed. |

## Edge Cases Considered

- Exit 1 with a tree OID means conflicts; exit 1 without an OID means a probe error.
- Conflict path lists may be empty and still represent a conflict.
- Paths containing spaces are parsed with NUL delimiters.
- Git 2.38 or newer is required; exit 129 warns and proceeds.
- Probe errors remain blocking with `--force`.
- Hook rewrites are checked on recorded HEAD, and a failed undo reports the leftover commit and manual reset command.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run build` | Pass | Build output regenerated. |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| `npm test` | Pass | 1,534 tests: 1,533 passed, 1 skipped, 0 failed. |
| E2E | N/A | The task prompt marks E2E as N/A. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `tests/run-task-safety.test.ts` | Require both the conflict-abort header and soft-reset message in the dirty admitted-doc and hook-rewrite cases. Isolated fake-main fixtures in their own temporary Git root so repository-level task artifacts cannot preempt the merge-tree assertions. |
| `src/cli/index.ts` | Updated `--force` help to include the base-drift gate. |
| `src/orchestrator/main.ts` | Avoided implying that all base-advanced files merge cleanly when a separate conflict is reported. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Clarified when remote-boundary gates run and stated scope-drift remediation directly; regenerated the managed mirror. |
| `docs/patterns.md` | Recorded that the merge-tree behavior was verified on git 2.55. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt after CLI and orchestrator edits. |

### Findings addressed

- _correctness bug:_ AC-4c dirty-doc and hook tests could pass because the configured-doc warning printed the path → both tests now require `conflicts with origin/main` and `human_review commit was undone` (`tests/run-task-safety.test.ts:6757`, `:6796`).
- _risk/guardrail:_ top-level `--force` help omitted the base-drift bypass → help now lists it (`src/cli/index.ts:98`).
- _optional cleanup/nit:_ clarified gate timing and scope remediation in the pipeline guide, annotated the Git version in the merge-tree note, and made the post-conflict info line unambiguous.

### AC deltas

- AC-4c: Partial → Met. Both dirty-doc and hook-rewrite tests assert a conflict abort and rollback.
- AC-7: Partial → Met. `--force` help now documents the base-drift bypass.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run build` | Pass | Rebuilt distribution bundles. |
| `npm run sync-templates:check` | Pass | |
| Focused base-drift safety tests | Pass | 8 passed, 0 failed; includes both strengthened AC-4c cases and fake probe outcomes. |
| `npm run docs-refs-check` | Fail – unrelated | The current `tasks/base-drift-conflicts-only/review.md` contains an unresolved example path at line 28; that review artifact is outside the task's Affected Files. |
