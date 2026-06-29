# Implementation Handoff: task-metadata-helpers

> Author: Codex | Spec: `tasks/task-metadata-helpers/spec.md` | Plan: `tasks/task-metadata-helpers/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `tasks/task-metadata-helpers/handoff.md` | Filled this implementation handoff with the current diff, AC coverage, validation results, and review notes. |
| `tasks/task-metadata-helpers/notes.md` | Appended raw implementation observations about `task set` warning semantics and `base_branch` empty-string rejection. |
| `tasks/task-metadata-helpers/status.json` | Recorded the implement → done phase transition and refreshed task bookkeeping. |
| `src/task/index.ts` | Added `taskSet()` with settable/redirect/immutable field routing, value validation, past-pending warning, `updated` refresh, and `taskCmd` dispatch/usage wiring. |
| `scripts/run-task/state.ts` | Exported `validateBranchField()` so `base_branch` can reuse the existing branch-name validation shape. |
| `src/cli/index.ts` | Added `canon task set` to the CLI help text. |
| `docs/pipeline-orchestrator.md` | Added the `set` row to the `canon task` subcommand reference table. |
| `templates/docs/pipeline-orchestrator.md` | Synced the canon-managed mirror for the `set` documentation row. |
| `AGENTS.md` | Added `set` to the `canon task` command list. |
| `tests/task-cli.test.ts` | Added direct-handler coverage for valid writes, invalid values, redirects, immutables, warnings, and `taskCmd` dispatch. |
| `tests/cli.test.ts` | Extended the CLI help assertion to cover the new `set` surface. |
| `dist/cli/index.js` | Rebuilt the CLI bundle to reflect the new task helper, command help, and docs text. |

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

`taskSet()` follows the same pattern as the existing mutators in `src/task/index.ts`: read the task file, validate the requested field/value, mutate the in-memory status object, and persist through `writeStatusAtomic()`. The field taxonomy is explicit so every named field either writes safely, redirects the operator to the sanctioned command, or refuses as immutable.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| None | The implementation matched the plan and spec shape; no scope or behavioral deviation was needed. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `canon task set <id> task_size L` updates `task_size` to `L` in `tasks/<id>/status.json`, re-derives the top-level `status` pointer, and refreshes the top-level `updated` timestamp to `today()` — matching every other mutator in `src/task/index.ts` ([index.ts:226,438,534,737,954,1044,1087](../../src/task/index.ts)) — via the existing atomic write path (`writeStatusAtomic`). Verified by a test that runs the handler against a fixture task and asserts the on-disk field changed, `status.status` stays consistent with phase state, and `status.updated` was set to today's stamp. | Met | Covered by `task set updates task_size, re-derives status, and refreshes updated timestamp` in [tests/task-cli.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/task-cli.test.ts). |
| AC-2: Each settable field validates its value: `task_size` is rejected unless it is one of `XS`/`S`/`M`/`L`/`XL` (reuse the `TaskSize` domain from `scripts/pipeline-policy.ts`); `delicate` and `worktree` accept only `true`/`false` (case-insensitive) and reject anything else; `base_branch` reuses the existing branch-name validation shape — the rejections in `validateBranchField` (`scripts/run-task/state.ts:117-130`): leading-dash (flag-like), control characters / whitespace, and the `:` refspec separator — **and additionally rejects an empty/whitespace-only string** (unlike the parse-time validator, which tolerates empty as "default base"); `title` rejects an embedded newline (mirroring `taskNew`'s single-line rule). Verified by tests asserting a descriptive throw/non-zero exit for each invalid value — including a `base_branch` case for each rejected shape (empty, leading-dash, embedded space, embedded `:`) — and a successful write for a valid one. | Met | Covered by the valid/invalid value tests in [tests/task-cli.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/task-cli.test.ts). |
| AC-3: The guarded run-stance/gate fields — `canon task set <id> full_send true` and `canon task set <id> human_spec_gate false` — each exit non-zero, write nothing to `status.json`, and print a message naming the sanctioned mechanism (`canon run --full-send` / re-run `canon run`). Verified by tests asserting the file is byte-unchanged **and** the message contains the named redirect target. (Called out separately from AC-4 because these are the fields whose raw write would bypass a guard.) | Met | Covered by the guarded-field assertions in [tests/task-cli.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/task-cli.test.ts). |
| AC-4: The remaining recognized fields refuse with a **category-correct message**, not merely a no-op: Redirect group (`status` → `task phase`, `branch` → git-identity/not-via-set, and `phases`/`sessions`/`canon`/`escalations` → their owning commands): each exits non-zero, writes nothing, and the message names the correct sanctioned command for that group. Immutable group (`id`, plus one of `created`/`updated`/a `_`-prefixed key): each exits non-zero, writes nothing, and the message states the field is immutable/not editable — text that is **distinct from** the redirect guidance. Verified by tests per representative field asserting both the file is byte-unchanged AND the message matches the category's expected contract (redirect target named vs. immutable reason named), so an implementation that prints a generic or wrong-category message fails. | Met | Covered by the redirect and immutable assertions in [tests/task-cli.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/task-cli.test.ts). |
| AC-5: An unknown field (`canon task set <id> nope 1`) exits non-zero with a message that lists the settable field names. Verified by a test asserting the error text enumerates `task_size`/`delicate`/`worktree`/`base_branch`/`title`. | Met | Covered by the unknown-field assertion in [tests/task-cli.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/task-cli.test.ts). |
| AC-6: Setting a settable field on a task whose top-level `status` is past `pending` (e.g. `implement` in progress) still writes the value but emits a warning that it takes effect on the next `canon run`; setting it on a `pending` task emits no such warning. Verified by two tests (warning present / absent) capturing stdout. | Met | Covered by the warning/no-warning assertions in [tests/task-cli.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/task-cli.test.ts). |
| AC-7: `set` is registered: it appears in `taskCmd()`'s dispatch and in `usage()` (`src/task/index.ts`), and in the `canon task` help text (`src/cli/index.ts`). Verified by a test asserting the dispatcher routes `set` to the handler, plus the structural doc/help assertions below. | Met | Covered by the dispatch assertion in [tests/task-cli.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/task-cli.test.ts) and the help assertion in [tests/cli.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/cli.test.ts). |
| AC-8: Operator-facing surfaces document the new subcommand: the task-subcommand table in `docs/pipeline-orchestrator.md` gains a `set` row (covering the three-category behavior and the redirect rationale), and the command list in `AGENTS.md` (line 37) adds `set`. The generated mirror `templates/docs/pipeline-orchestrator.md` is regenerated by the pre-commit sync hook and declared as a generated artifact. | Met | Updated the docs surface and mirror, and `npm run sync-templates:check` passed. |
| AC-9: Full suite green: `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (committed `dist/` matches a fresh build), `npm run sync-templates:check`, `npm run docs-refs-check`. | Met | All required checks passed in this session. |

## Edge Cases Considered

- `base_branch` accepts the existing branch-name validator but needs an explicit empty-string guard first so `set` does not silently preserve the parse-time "default base" behavior.
- The past-pending warning is keyed off phase progress, not the cached top-level `status` pointer, so a scaffolded task with all phases pending does not warn just because its top-level status is already `spec`.
- Boolean parsing stays strict to the JSON shape: only literal `true` / `false` are accepted, case-insensitive, with no widening to `1` / `yes` / `on`.

## Blockers

- None.
- Label ambiguous ACs with `[ambiguity]` and document the interpretation you chose

## Validation Outcomes

> All applicable checks must record a result before submitting for review. Result values:
>
> | Value | Use when |
> |---|---|
> | `Pass` | Agent ran the check; it passed. |
> | `Fail` | Agent ran the check; it failed. Move unresolved failures to Blockers. |
> | `not_configured` | Check doesn't apply to this task type. Only valid for non-required checks. |
> | `N/A` | Legacy synonym for `not_configured`. Prefer `not_configured` going forward. |
> | `human_pending` | Only a human can run this (OAuth, cross-browser, deployed-only smoke). Required checks may use this state; the `human_review` gate will refuse to close the task until the human resolves it OR writes an explicit waiver in done.md. |
> | `deferred_by_spec` | Explicitly out of scope per spec. Requires a spec citation in Notes (e.g., `Spec: §Non-Goals — explicitly defers this`). |
> | `blocked` | Check would have run but infrastructure was unavailable (CI down, network out). Triage required — distinct from `Fail`. |
>
> Required checks (those in spec.md's Validation Required section) cannot be marked `N/A` or `not_configured` — adjust the spec or run the check.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | |
| `npm run build` | Pass | `dist/cli/index.js` was rebuilt from the source changes. |
| `npm run sync-templates:check` | Pass | `templates/docs/pipeline-orchestrator.md` stayed aligned with `docs/pipeline-orchestrator.md`. |
| `npm run docs-refs-check` | Pass | |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

| File | What Changed |
|---|---|

> **Reverting a file?** Perfect revert (no longer in `git diff base...HEAD`): delete it from all prior Changes tables and omit it here. Imperfect revert (still in diff, e.g. trailing newline): add it here as "Reverted to original (describe residual diff)".

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

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/task/index.ts` | `taskSet()` now resolves the task cwd before locating `status.json`, matching the other mutators and fixing the worktree-routing bug at [line 1458](../../src/task/index.ts#L1458). |
| `tests/task-cli.test.ts` | Added a worktree-routing regression that proves `canon task set` writes the active worktree copy and leaves the supervising checkout copy unchanged at [line 284](../../tests/task-cli.test.ts#L284). |
| `docs/pipeline-invocations.md` | Appended the pipeline telemetry rows emitted while rerunning validation for this revision. |
| `tasks/task-metadata-helpers/review.md` | Review round 1 notes remain in the task artifact tree and are reflected in the current diff. |
| `tasks/task-metadata-helpers/notes.md` | Appended the revision note about `taskSet()` needing worktree-aware resolution. |
| `tasks/task-metadata-helpers/handoff.md` | Appended this iteration record. |

### Findings addressed

- _correctness bug:_ `taskSet()` wrote `tasks/<id>/status.json` from `taskDirFromRoot(id)` instead of the active task checkout, so worktree-backed tasks could be mutated in the wrong tree. Fixed at `src/task/index.ts:1458`.
- _spec gap:_ added a regression test that exercises a task with both repo-root and worktree copies of `status.json` and asserts only the worktree copy changes. Covered at `tests/task-cli.test.ts:284`.

### AC deltas (if any)

- AC-1: unchanged in wording, now also covered for worktree-backed tasks by the routing regression.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/task-cli.test.ts` | Pass | Focused regression suite for `taskSet()` routing and surrounding task CLI behavior. |
| `npm test -- tests/task-cli.test.ts` | Fail – unrelated | Broader suite picked up pre-existing docs-ref breakage in task review artifacts: `tests/run-task-safety.test.ts:2061`, `2166`, `2810`, `3522` surfaced `tasks/task-metadata-helpers/review.md:71` and `tasks/canon-snapshot-robustness/review.md:35` broken refs. Repro: rerun the full test command; failure is in review artifacts, not this code change. |

## Iteration 3 — addressing reroute round 1

### Changes

| File | What Changed |
|---|---|
| `src/task/index.ts` | Added the branch-recorded topology lock for `worktree` and `base_branch` before value parsing, while keeping the worktree-aware `status.json` resolution from the prior iteration. |
| `tests/task-cli.test.ts` | Added branch-recorded topology-lock regressions and updated the started-task warning fixture to prove metadata fields still warn and write when branched. |
| `docs/pipeline-orchestrator.md` | Expanded the `set` row to describe the metadata-versus-topology split and the pre-branch-only lock. |
| `templates/docs/pipeline-orchestrator.md` | Synced the `set` row mirror for the topology-lock documentation change. |
| `dist/cli/index.js` | Rebuilt after the source/help/docs changes. |
| `tasks/task-metadata-helpers/spec.md` | Human-review amendment added the topology-lock ACs and reroute delta. |
| `tasks/task-metadata-helpers/plan.md` | Human-review reroute plan added the topology-lock implementation steps. |
| `tasks/task-metadata-helpers/spec-review.md` | Reroute artifact retained as part of the amended task package. |
| `tasks/task-metadata-helpers/review.md` | Cleaned the broken worktree-guidance citation from the round-2 review artifact. |
| `tasks/task-metadata-helpers/notes.md` | Appended reroute notes about topology-lock ordering. |
| `tasks/task-metadata-helpers/status.json` | Reroute task-state artifact remained updated for the current implement pass. |
| `tasks/canon-snapshot-robustness/spec.md` | Amendment is a no-op for implementation, but the reroute package remains part of the current branch state. |
| `tasks/canon-snapshot-robustness/plan.md` | Reroute plan retained for the sibling task; no implementation delta this turn. |
| `tasks/canon-snapshot-robustness/spec-review.md` | Reroute artifact retained for the sibling task; no implementation delta this turn. |
| `tasks/canon-snapshot-robustness/review.md` | Cleaned the broken non-goal citation so docs refs stay green. |
| `tasks/canon-snapshot-robustness/notes.md` | Appended a reroute note about docs-refs hygiene in review artifacts. |
| `tasks/canon-snapshot-robustness/status.json` | Reroute task-state artifact remained updated for the current implement pass. |
| `tasks/task-metadata-helpers/handoff.md` | Appended this reroute record. |

### Findings addressed

- _correctness bug:_ `taskSet()` could still accept topology changes after a branch was recorded, which the amendment now forbids because it can strand the task in an unresolvable topology state. Fixed at `src/task/index.ts:1458`.
- _spec gap:_ added branch-recorded topology-lock tests plus the metadata-on-branched-task warning test to cover the new AC-A2/A3/A4 behavior. Covered at `tests/task-cli.test.ts:284`.
- _optional cleanup/nit:_ removed the broken review-artifact citations that were tripping `docs-refs-check`. Fixed in `tasks/task-metadata-helpers/review.md:71` and `tasks/canon-snapshot-robustness/review.md:35`.

### AC deltas (if any)

- AC-A1: Met (unchanged; the extra-argument guard already existed and still rejects unquoted multi-word values).
- AC-A2: Met (topology fields reject once `status.branch` is recorded; pre-branch writes still succeed).
- AC-A3: Met (metadata fields remain settable on a branched task and still warn after dispatch has started).
- AC-A4: Met (the topology lock fires before value parsing on locked fields).
- AC-A5: Met (docs row updated, template mirror synced, build/test/docs-refs/sync-templates all pass).

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Full suite passed after the reroute changes and review-artifact cleanup. |
| `npm run build` | Pass | `dist/cli/index.js` was rebuilt from the source changes. |
| `npm run sync-templates:check` | Pass | `templates/docs/pipeline-orchestrator.md` stayed aligned with `docs/pipeline-orchestrator.md`. |
| `npm run docs-refs-check` | Pass | |
