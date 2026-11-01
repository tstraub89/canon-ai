# Implementation Handoff: ship-merge-method

> Author: implementer | Spec: `tasks/ship-merge-method/spec.md` | Plan: `tasks/ship-merge-method/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed — or a comma-separated list of files in the first column when they're tightly coupled (e.g. a canon-managed root file with its `templates/` mirror, or a generated artifact with its source script). The first column holds one or more tokens — each either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — separated by commas, with an optional short note after the last token. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. Group only files that change together for the same reason; unrelated files read better on separate rows. Every listed path must exist in `git diff <base>...HEAD` after auto-commit, except gitignored build output listed beside its generator and this task's own artifacts under `tasks/<id>/`; those may be listed without appearing in the diff and are not checked.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

> **Directory paths:** backticking a path to an existing directory is fine — `docs-refs-check` accepts it. A backticked directory path that no longer exists (for example, one this task deleted) can be reported as a missing reference, so describe removed directories in prose or use the markdown-link form above.

| File | What Changed |
|---|---|
| `src/orchestrator/docs-freshness.ts` | Parses and validates `ship.merge_method`, returns the resolved value separately from docs-freshness config, and defaults it to `squash`. |
| `src/orchestrator/main.ts` | Adds fail-closed, read-only PR/settings pre-flight; uses the configured `gh pr merge` method; restores preserved telemetry on merge failure; updates progress and recovery messages. |
| `src/orchestrator/cli.ts` | Documents the configured method in `--ship` help; adds no flag. |
| `src/task/index.ts` | Generalizes `post-merge-sync` help and output wording. |
| `.claude/hooks/canon-guard.mjs`, `templates/.claude/hooks/canon-guard.mjs` | Updates the task-PR merge reason to direct users to the configured `--ship` method; template mirror synced. |
| `tests/canon-guard.test.ts` | Updates assertions for the merge reason wording. |
| `.canon/README.md`, `templates/.canon/README.md` | Documents `ship.merge_method` and its default; template mirror synced. |
| `tests/run-task-ship.test.ts` | Covers each merge method, pre-flight failures/no-mutation guarantees, already-merged skip, and failed-merge telemetry restoration. Extends the fake `gh`. |
| `tests/run-task-safety.test.ts` | Extends the second fake `gh` for allowed-method and open-list behavior; updates the stale merge-method comment. |
| `tests/docs-freshness.test.ts` | Covers valid methods, defaults, invalid values, independent validation without docs-freshness config, and unknown keys. |
| `tests/cli.test.ts` | Covers doctor failure for invalid `ship.merge_method`. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documents method selection, pre-flight order, method-specific behavior, and failure recovery; template mirror synced. |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Generalizes merge and recovery guidance; template mirror synced. |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Generalizes merge recovery guidance; template mirror synced. |
| `README.md` | Updates `--ship` and hook descriptions and adds the `ship.merge_method` configuration example. |
| `docs/decisions.md` | Records the repo-level method setting and default; makes scaffold-push decision wording method-neutral. |
| `docs/patterns.md` | Marks the historical squash invocation as historical and updates its stale source reference. |
| `dist/orchestrator/run-task.js` | Rebuilt from the orchestrator source. |
| `dist/cli/index.js` | Rebuilt from the CLI, config parser, and task command sources. |

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

The shared config loader owns parsing and validation, so every consumer gets the same default and invalid-value behavior. Ship resolves all task branches and performs the read-only PR-list and repository-settings checks before any fetch or other local state change. The selected method is passed to the merge call. If a merge fails and is not confirmed merged, preserved telemetry is restored before the command exits; the error reports partial progress when an earlier PR already merged.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Moved the existing `assertTaskBranchPushed` loop to after the new read-only method pre-flight. | That guard runs `git fetch`, which updates local Git state. A rejected or unreadable pre-flight should stop before the fetch, while the guard still runs before telemetry preservation, branch switching, or destructive work. | AC-3, AC-4 |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `src/orchestrator/docs-freshness.ts` returns the resolved method independently of `docs_freshness`; tests cover valid/invalid values, defaults, non-object `ship`, unknown keys, absent config, and doctor failure. |
| AC-2 | Met | `tests/run-task-ship.test.ts` asserts exactly one anchored merge-method flag for default squash, rebase, and merge, with config loaded from the ship root. |
| AC-3 | Met | Pre-flight runs before the fetch that updates local Git state, telemetry preservation, and branch switching; the fixture asserts `FETCH_HEAD`, branch, telemetry, status, and task directory remain unchanged when the method is disallowed. |
| AC-4 | Met | Listing exit/malformed failures and settings exit/malformed failures fail closed before the fetch. An already-merged/empty-listing test confirms the settings query is skipped. The check remains guarded by `ghAvailable`. |
| AC-5 | Met | The red-first regression proves a failed open-PR merge restores the telemetry append and removes its backup. Message tests cover re-run guidance and the earlier-PR/base-not-pulled case. |
| AC-6 | Met | Progress and recovery output name the configured method; `--ship` help and `post-merge-sync` text are generalized. |
| AC-7 | Met | README, adopter config docs, pipeline docs, decisions, patterns, and skills are updated; canon-managed mirrors are synced. |
| AC-8 | Met | Both fake-`gh` scripts support method settings and failures, PR-list failures/malformed output, and non-mutating merge failure; full test suite passes. |
| AC-9 | Met | Hook guidance directs task-PR merges through the configured method; reason-text assertions are updated and hook behavior is unchanged. |

## Edge Cases Considered

- Absent config file, absent `ship`, and empty `ship` all retain the squash default; invalid settings fail even without `docs_freshness`.
- Confirmed empty PR listings skip repository-settings lookup; unreadable or malformed listings cannot masquerade as no PR.
- Rejected pre-flight leaves the Git fetch marker untouched; the existing pushed-branch safety check runs after a successful pre-flight and before any preservation or branch change.
- Bundled tasks sharing one branch issue one merge; multiple branches use the same configured method in sequence.
- A failed later merge reports earlier merged PRs and that the base has not been pulled; the operator can repair the remaining PR and re-run `--ship`.
- The live GitHub human test plan was not run in this local fake-`gh` environment; deterministic method, pre-flight, and recovery paths are covered by integration fixtures.

## Blockers

- None.

## Red-First Evidence

> Record one row per red-first AC. “Ran against” is the commit of the pre-fix code. In place of a pre-fix failure excerpt, the only alternatives are a reference to a `[wrong-premise]` Blocker, or (for an environment-bound escape) the named alternative's outcome or a statement that it was not executable and why. If the task has no red-first ACs, leave the “none” placeholder row.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-5 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='failed merge restores preserved telemetry dirt' tests/run-task-ship.test.ts` | `7c8e694ce043b648464c452004dbe93d9ce8e290` | Failed because the telemetry backup still existed after the command exited (`existsSync` was `true`, expected `false`). | The same focused test passed after restoration was added; the full `npm test` suite also passed. |

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
> A `Fail` row whose cause lies outside this task's diff: name the result `Fail – unrelated` explicitly, and Notes must cite a specific file reference outside this task's affected files (a sibling worktree path, a fixed-port test's own file, an unrelated spec's path) — the code reviewer only accepts `Fail – unrelated` when Notes names such a reference credibly. Pre-flight's own check is textual — naming a changed file in that row, even to say it passed, can reclassify the whole row as task-owned and reject the handoff. Don't rely on an unqualified filename escaping the check; keep Notes free of any path from this task's diff.
> Record every check in spec.md's Validation Required section here, plus any extra checks you ran. Required checks should not be marked `N/A` or `not_configured` — run the check or adjust the spec; the code reviewer verifies coverage against the spec. The `Check` cell is for human readability (the pre-flight gate no longer string-matches it against the spec), so write whatever names the check clearly — but keep a check's label identical across a baseline row and any later `### Re-run validation` row so its result updates in place.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 2,068 passed, 1 skipped, 0 failed. |
| `npm run build` | Pass | |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | |
| E2E | deferred_by_spec | Spec: Validation Required — N/A, no UI surface. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale

---

<!--
On revision rounds, append below this line:

## Iteration N — addressing review round N-1

### Changes

> One row per file changed in this iteration, or a comma-separated list when files are tightly coupled — see the baseline Changes note above for the grouping guidance and token format. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. (Deleted files: `[path](path)` markdown-link form only — see the baseline Changes note.)

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

### Red-First Evidence

_Include only when this round adds or changes a red-first test or adds missing evidence._

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
