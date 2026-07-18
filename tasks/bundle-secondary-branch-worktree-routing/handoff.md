# Implementation Handoff: bundle-secondary-branch-worktree-routing

> Author: Codex | Spec: `tasks/bundle-secondary-branch-worktree-routing/spec.md` | Plan: `tasks/bundle-secondary-branch-worktree-routing/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/state.ts` | Added fail-closed worktree enumeration and content-based secondary ownership resolution on the empty-main-branch path. |
| `scripts/run-task/git.ts` | Made first-implement worktree bootstrap write every member directly to the override-aware destination, secondaries first and leader last. |
| `tests/run-task-safety.test.ts` | Added the real-git wrong-main-write regression and focused negative/fail-closed ownership tests. |
| `docs/patterns.md` | Documented bundle-secondary content resolution, fail-closed scanning, and the no-cache rule. |
| `dist/cli/index.js` | Regenerated the published CLI bundle with the resolver change. |
| `dist/scripts/run-task.js` | Regenerated the orchestrator bundle with the resolver and bootstrap changes. |

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

Bundle secondaries now discover their shared leader worktree from validated worktree-local task state instead of depending on a branch hint written into the main checkout. The scan is gated to `worktree: true` tasks whose main branch is still empty, requires the candidate's own branch to match its checked-out branch, and fails closed when enumeration or candidate validation cannot establish safe ownership. The first-implement bootstrap complements that resolver by writing each member through explicit paths returned by `ensureWorktree`, preserving `CANON_TASKS_DIR_OVERRIDE` and avoiding resolver recursion.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| The real-git regression imports source via an absolute file URL and compares the resolved worktree through `fs.realpathSync`. | Its subprocess runs with the fixture repository as `cwd`; an absolute import keeps it on the active task source, while realpath normalization handles macOS `/var` → `/private/var` canonicalization. | None; AC-1 still asserts the exact canonical leader worktree. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: wrong-main-write regression | Met | Real-git bundle test verifies the worktree secondary branch, unchanged/clean main secondary, and secondary resolution to the leader worktree. |
| AC-2: override-aware bootstrap destination | Met | `ensureBranch` uses the returned leader path or override root and writes secondaries before the leader. Existing override bundle test passes unchanged. |
| AC-3: match rule and fail-closed resolution | Met | Candidate reads use `readStatusFromPath`; enumeration failure, invalid candidate, ambiguity, match, and no-match outcomes are distinct. |
| AC-4: negative and fail-closed tests | Met | Added inherited-dir, main `worktree:false`, candidate `worktree:false`, multi-match, enumeration-failure, malformed-JSON, and schema-invalid tests. |
| AC-5: no self-reference recursion | Met | Scan uses raw `fs`/git plus `readStatusFromPath`; bootstrap uses explicit destinations plus `readStatusFromPath`/`writeStatusToFile`. |
| AC-6: existing behavior preserved | Met | Full suite passes, including unchanged leader/single-task, override, reuse, secondary-hint, and main-checkout tests. |
| AC-7: existing branch-hint die path | Met | Non-empty main branch path and its existing missing-worktree failure remain unchanged and pass in the full suite. |
| AC-8: accurate log | Met | Retained log now follows worktree-only writes for every bundle member. |
| AC-9: build artifacts | Met | Both declared dist artifacts regenerated; a repeat build produced identical SHA-1 hashes. |
| AC-10: clean validation | Met | Lint, type-check, full tests, build, and docs refs all pass. |

## Edge Cases Considered

- Detached-HEAD worktrees have no branch entry and cannot match.
- Successful enumeration with zero valid matches falls back to `REPO_ROOT`; failed enumeration dies.
- Present malformed or schema-invalid candidates die before any fallback.
- Multiple self-consistent claimants die and name every matching path.
- Main and candidate `worktree: false` gates prevent stale-worktree false matches.
- Override-root writes remain authoritative in test-harness and adopter override flows.

## Blockers

- None.

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
| `npm run lint` | Pass | Final run after all source and test edits. |
| `npm run type-check` | Pass | Final run after all source and test edits. |
| `npm test` | Pass | Full test suite, including all new and unchanged worktree-routing cases. |
| `npm run build` | Pass | Rebuilt both dist entry points; repeat build was byte-stable. |
| `npm run docs-refs-check` | Pass | All references OK. |

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
