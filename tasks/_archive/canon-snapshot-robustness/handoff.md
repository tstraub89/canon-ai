# Implementation Handoff: canon-snapshot-robustness

> Author: Codex | Spec: `tasks/canon-snapshot-robustness/spec.md` | Plan: `tasks/canon-snapshot-robustness/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `tasks/canon-snapshot-robustness/handoff.md` | Filled this implementation handoff with the current diff, AC coverage, validation results, and review notes. |
| `tasks/canon-snapshot-robustness/notes.md` | Appended raw implementation observations about the parent-top-level probe fixture and call-time env override. |
| `tasks/canon-snapshot-robustness/status.json` | Recorded the implement → done phase transition and refreshed task bookkeeping. |
| `scripts/run-task/canon-snapshot.ts` | Added call-time `CANON_UPSTREAM_REPO` override handling and non-submodule vendored-mode detection with a parent-top-level probe. |
| `tests/run-task-canon-snapshot.test.ts` | Added env-override, vendored, native, and probe-failure coverage, plus the fixture updates for the extra git probe. |
| `docs/decisions.md` | Appended the call-time env-override clause to the existing provenance rule. |
| `dist/cli/index.js` | Rebuilt the CLI bundle so the task creation and provenance helpers include the new snapshot logic. |
| `dist/scripts/run-task.js` | Rebuilt the orchestrator bundle to ship the new provenance resolution logic. |

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

`captureCanonSnapshot()` keeps the existing upstream/orchestrator shape but resolves the upstream repo slug at call time and broadens the orchestrator-commit lookup to distinguish true submodules from plain vendored clones. The additional probes are fully injectable through the existing `runGitAt` seam, so the tests cover the new cases without depending on a real repository layout.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| None | The implementation matched the plan and spec shape; no scope or behavioral deviation was needed. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `captureCanonSnapshot()` resolves `upstream_repo` at call time from a trimmed, non-empty `CANON_UPSTREAM_REPO` env var and falls back to `CANON_UPSTREAM_REPO` when the env var is unset, empty, or whitespace-only. Verified by tests that mutate `process.env` after import and call `captureCanonSnapshot()` with native fixtures. | Met | Covered by the env-override and fallback tests in [tests/run-task-canon-snapshot.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/run-task-canon-snapshot.test.ts). |
| AC-2: Submodule detection remains unchanged: when `--show-superproject-working-tree` returns a path, `orchestrator_commit` is the HEAD at that superproject path. Verified by the existing vendored fixture. | Met | Covered by the existing superproject test in [tests/run-task-canon-snapshot.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/run-task-canon-snapshot.test.ts). |
| AC-3: Plain-vendored detection — when the superproject query is empty but the parent directory resolves (via injected `rev-parse --show-toplevel`) to a git toplevel **distinct** from canon's own toplevel, `orchestrator_commit` is the HEAD captured at that enclosing toplevel (and differs from `upstream_commit`). Verified by a new fixture: superproject empty, `ownToplevel = <repoRoot>`, `parentToplevel = <host>`, host HEAD distinct. | Met | Covered by the host HEAD fixture in [tests/run-task-canon-snapshot.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/run-task-canon-snapshot.test.ts). |
| AC-4: Native detection — when the superproject query is empty and the parent directory has no enclosing repo (`--show-toplevel` at the parent returns empty/error) **or** resolves to canon's own toplevel, `orchestrator_commit === upstream_commit` (today's behavior preserved). Verified by two fixtures (no enclosing repo; parent resolves to own toplevel). | Met | Covered by the native fallback fixtures in [tests/run-task-canon-snapshot.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/run-task-canon-snapshot.test.ts). |
| AC-5: Probe failures are non-fatal. If any fallback git invocation errors or returns empty, detection degrades to native without throwing — `captureCanonSnapshot()` still returns a complete `CanonStamp` (consistent with the existing `<unavailable>` handling). Verified by a fixture where the parent `rev-parse` returns a non-`ok` result. | Met | Covered by the no-enclosing-repo fixture in [tests/run-task-canon-snapshot.test.ts](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/tests/run-task-canon-snapshot.test.ts). |
| AC-6: A short note is added to `docs/decisions.md` (the existing `CANON_UPSTREAM_REPO` provenance entry, ~line 37) recording that the slug is now overridable via the `CANON_UPSTREAM_REPO` env var while remaining homed in the symbol. No new decision section; an in-place clause on the existing Rule. | Met | Updated the existing provenance rule in [docs/decisions.md](/Users/tstraub/canon-ai/dev-worktrees/task-metadata-helpers/docs/decisions.md). |
| AC-7: Full suite green: `npm run lint`, `npm run type-check`, `npm test`, `npm run build` (committed `dist/` matches a fresh build), `npm run docs-refs-check`. | Met | All required checks passed in this session. |

## Edge Cases Considered

- The parent-top-level probe only runs after the superproject probe comes back empty, so true submodules keep the existing `orchestrator_commit` behavior.
- `path.resolve()` normalization is required before comparing top-level paths; otherwise a relative/absolute mismatch could falsely classify a monorepo subdir as vendored.
- Empty or whitespace-only `CANON_UPSTREAM_REPO` values are treated as unset at call time, not as an empty stamped repo string.

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
| `npm run build` | Pass | `dist/cli/index.js` and `dist/scripts/run-task.js` were rebuilt from the source changes. |
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
| `tasks/canon-snapshot-robustness/handoff.md` | Appended this review-response record. |
| `tasks/canon-snapshot-robustness/review.md` | Review round 1 notes remain in the task artifact tree and are reflected in the current diff. |

### Findings addressed

- _optional cleanup/nit:_ review round 1 did not raise a blocking issue for this task, so no code changes were required in this revision.

### AC deltas (if any)

- None.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Shared workspace validation already rerun for the bundle after the `task-metadata-helpers` routing fix. |
| `npm run type-check` | Pass | Shared workspace validation already rerun for the bundle after the `task-metadata-helpers` routing fix. |
| `node --test --import ./tests/md-loader-register.mjs --import tsx tests/task-cli.test.ts` | Pass | Shared workspace validation already rerun for the bundle after the `task-metadata-helpers` routing fix. |

## Iteration 3 — addressing reroute round 1

### Changes

| File | What Changed |
|---|---|
| `tasks/canon-snapshot-robustness/spec.md` | Reroute artifact remained in the branch state; the amendment is still a no-op for implementation. |
| `tasks/canon-snapshot-robustness/plan.md` | Reroute plan artifact remained in the branch state; no implementation delta this turn. |
| `tasks/canon-snapshot-robustness/spec-review.md` | Reroute review artifact remained in the branch state; no implementation delta this turn. |
| `tasks/canon-snapshot-robustness/review.md` | Cleaned the broken non-goal citation so docs refs stay green. |
| `tasks/canon-snapshot-robustness/notes.md` | Appended a reroute note about docs-refs hygiene in review artifacts. |
| `tasks/canon-snapshot-robustness/status.json` | Reroute task-state artifact remained updated for the current implement pass. |
| `tasks/canon-snapshot-robustness/handoff.md` | Appended this reroute record. |

### Findings addressed

- _optional cleanup/nit:_ review round 1 on this task still had no blocking implementation finding; the only work here was cleaning the broken review-artifact citation that was tripping docs-refs-check.

### AC deltas (if any)

- None.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Shared workspace validation already rerun for the bundle after the `task-metadata-helpers` routing fix and reroute amendments. |
| `npm run type-check` | Pass | Shared workspace validation already rerun for the bundle after the `task-metadata-helpers` routing fix and reroute amendments. |
| `npm test` | Pass | Shared workspace validation already rerun for the bundle after the `task-metadata-helpers` routing fix and reroute amendments. |
| `npm run build` | Pass | Shared workspace validation already rerun for the bundle after the `task-metadata-helpers` routing fix and reroute amendments. |
| `npm run sync-templates:check` | Pass | Shared workspace validation already rerun for the bundle after the `task-metadata-helpers` routing fix and reroute amendments. |
| `npm run docs-refs-check` | Pass | Shared workspace validation already rerun for the bundle after the `task-metadata-helpers` routing fix and reroute amendments. |
