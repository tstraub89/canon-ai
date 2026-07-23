# Implementation Handoff: fix-installed-provenance-version

> Author: Codex | Spec: `tasks/fix-installed-provenance-version/spec.md` | Plan: `tasks/fix-installed-provenance-version/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed — or a comma-separated list of files in the first column when they're tightly coupled (e.g. a canon-managed root file with its `templates/` mirror, or a generated artifact with its source script). The first column holds one or more tokens — each either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — separated by commas, with an optional short note after the last token. No wildcards, no unfilled `<placeholder>` text, and no prose-embedded paths. Group only files that change together for the same reason; unrelated files read better on separate rows. Every listed path must exist in `git diff <base>...HEAD` after auto-commit.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/canon-snapshot.ts` | Classifies installed package source paths, preserves driving/host commit attribution, and records canon version. |
| `scripts/run-task/types.ts` | Adds required `canon_version` to `CanonStamp`. |
| `.canon/templates/status.json`, `templates/.canon/templates/status.json` | Adds the scaffolded canon version field and synced mirror. |
| `tests/run-task-canon-snapshot.test.ts` | Covers installed, override, regression, version, linked-worktree, submodule-adopter, and refresh behavior. |
| `dist/cli/index.js`, `dist/scripts/run-task.js` | Rebuilt bundles. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documents installed-package stamping and version field. |
| `docs/decisions.md` | Records version-based installed identity and related non-goals. |

## Canon Governance

The authoritative provenance stamp for this task lives in `status.json.canon`. Reference those fields here instead of duplicating them as a second source of truth.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Canon version | `status.json.canon.canon_version` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Installed mode is detected from canon's executing source path (`node_modules`/`_npx`) before git-topology classification. It records `<unavailable>` for canon's commit while retaining the adopter or host commit as `orchestrator_commit`; native and vendored attribution remains unchanged. Version resolution uses the explicit test seam, `CANON_VERSION`, or `dev`.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Added a dedicated installed upstream-repository override test in addition to the plan's primary installed fixture. | AC-1b explicitly requires preserving `CANON_UPSTREAM_REPO` overrides in installed mode. | Strengthens AC-1b; no negative impact. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Installed fixtures assert `<unavailable>` and reject adopter SHAs as canon identity. |
| AC-1b | Met | Tests preserve the default slug, explicit `CANON_UPSTREAM_REPO`, and driving/host orchestrator commit. |
| AC-2 | Met | Regression test is named for #196 and asserts the fixed unavailable/version behavior. |
| AC-3 | Met | Explicit released-version and unset-environment `dev` tests cover `canon_version`. |
| AC-4 | Met | Native test retains real commit attribution and asserts a populated version. |
| AC-4b | Met | Linked-worktree source path remains native with a real commit. |
| AC-5 | Met | Vendored test retains submodule/host commits and adds version assertion. |
| AC-5b | Met | Installed-in-submodule fixture uses distinct adopter and host SHAs and records host attribution. |
| AC-6 | Met | Refresh test keeps canon identity stable while following adopter commit changes. |
| AC-7 | Met | Root template, synced mirrors, and sync check cover the stamp shape. |

## Edge Cases Considered

- Installed paths under local/global npm layouts and `_npx` are identified without comparing source and repo roots.
- Native linked worktrees and vendored paths remain outside the installed predicate.
- Installed canon inside a submodule adopter checks host attribution before any native fallback.
- Version resolution is call-time/environment-based, so tests do not capture ambient values at import.

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
> Record every check in spec.md's Validation Required section here, plus any extra checks you ran. Required checks should not be marked `N/A` or `not_configured` — run the check or adjust the spec; the code reviewer verifies coverage against the spec. The `Check` cell is for human readability (the pre-flight gate no longer string-matches it against the spec), so write whatever names the check clearly — but keep a check's label identical across a baseline row and any later `### Re-run validation` row so its result updates in place.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint completed successfully. |
| `npm run type-check` | Pass | TypeScript check completed successfully. |
| `npm test` | Pass | 1,025 passed, 1 skipped; 1,026 total. |
| `npm run build` | Pass | Rebuilt both declared dist artifacts successfully. |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `git diff --check` | Pass | No whitespace errors. |

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
