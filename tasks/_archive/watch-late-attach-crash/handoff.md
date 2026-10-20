# Implementation Handoff: watch-late-attach-crash

> Author: Codex | Spec: `tasks/watch-late-attach-crash/spec.md` | Plan: `tasks/watch-late-attach-crash/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed — or a comma-separated list of files in the first column when they're tightly coupled (e.g. a canon-managed root file with its `templates/` mirror, or a generated artifact with its source script). The first column holds one or more tokens — each either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — separated by commas, with an optional short note after the last token. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. Group only files that change together for the same reason; unrelated files read better on separate rows. Every listed path must exist in `git diff <base>...HEAD` after auto-commit.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

> **Directory paths:** backticking a path to an existing directory is fine — `docs-refs-check` accepts it. A backticked directory path that no longer exists (for example, one this task deleted) can be reported as a missing reference, so describe removed directories in prose or use the markdown-link form above.

| File | What Changed |
|---|---|
| `src/cli/commands/watch.ts` | Shared crash evidence helper used by attach and idle classification; attach reports fresh marker reasons. |
| `tests/watch.test.ts` | Late attach regression, evidence boundaries, in-progress fallback, and watch exit behavior. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Exit code 4 documentation now covers attach before or after process exit; mirror generated. |
| `dist/cli/index.js` | Rebuilt CLI bundle. |

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

Extracted the existing idle-path evidence check into `findCrashEvidence()` and reused it for late attach. Attach retains its existing generic `in_progress` death and `nothing_to_watch` outcomes when evidence is absent, clean, or stale. The death reporter includes the evidence reason when available.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Reuse computed pid liveness in the helper | The plan signature would probe the same resolved pid a second time in each classifier. Passing the already computed liveness preserves the existing idle-path probe behavior and avoids duplicate probing. | No AC impact. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Red-first test failed before fix with `nothing_to_watch`; passes after fix with marker reason. |
| AC-2 | Met | Pending after done with no log/runtime pid remains `nothing_to_watch`. |
| AC-3 | Met | Unit test covers clean and stale non-zero markers. |
| AC-4 | Met | In-progress with fresh marker carries reason; without evidence retains generic hint. |
| AC-5 | Met | `watchCmd` late attach exits 4, writes stable summary, and includes reason/resume command on stderr. |
| AC-6 | Met | `classifyAttach` and `classifyIdle` both call `findCrashEvidence`; `timestampMs >= statusMtimeMs` occurs once at `src/cli/commands/watch.ts:409`. |
| AC-7 | Met | Exit code 4 row covers attach before/after exit; template generated and sync check passes. |
| AC-8 | Met | Required validation matrix passed; bundle rebuilt. |

## Edge Cases Considered

- No run log and no runtime pid evidence leaves a pending phase as `nothing_to_watch`.
- Clean and stale non-zero markers are ignored; the existing one-second tolerance remains in one shared comparison.
- `human_review` remains outside attach-time crash evidence, preserving the spec non-goal.

## Blockers

- None.
- [ambiguity] The plan interprets the non-goal on `human_review` as excluding a pending `human_review` phase from attach-time crash evidence; that behavior is preserved.

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
| `npm test` | Pass | 1,520 passed, 0 failed, 1 skipped by sandbox restriction (`REPO_ROOT` linked-worktree test requires `.git` writes). |
| `npm run build` | Pass | Rebuilt `dist/cli/index.js`. |
| `npm run sync-templates:check` | Pass | |
| `npm run docs-refs-check` | Pass | All refs OK. |

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

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `<lint>` | Pass | |
-->
