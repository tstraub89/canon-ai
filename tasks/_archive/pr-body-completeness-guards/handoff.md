# Implementation Handoff: pr-body-completeness-guards

> Author: Codex | Spec: `tasks/pr-body-completeness-guards/spec.md` | Plan: `tasks/pr-body-completeness-guards/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `src/cli/commands/doctor.ts` | Exported `EXPECTED_TEMPLATES` and added `pr-body.md` so `checkTemplates()` warns when the scaffold template is missing. |
| `scripts/run-task/validation.ts` | `isPrBodyTemplate()` now treats blank/whitespace-only content as unfilled before the sentinel check. |
| `tests/cli.test.ts` | Added coverage for missing `pr-body.md`, the all-templates pass case, and the `CANON_OWNED`-derived drift guard. |
| `tests/run-task-validation.test.ts` | Added blank/whitespace `isPrBodyTemplate()` cases and an end-to-end `resolveQaPrBody()` fallback test for a blank single-task `pr-body.md`. |
| `dist/cli/index.js` | Rebuilt from `doctor.ts`; carries the updated template list into the CLI bundle. |
| `dist/scripts/run-task.js` | Rebuilt from `validation.ts`; carries the blank-body guard into the task runner bundle. |

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

Use the existing doctor template check and QA PR-body resolution path rather than adding a parallel validator. `pr-body.md` now participates in the scaffold warning list, and blank or whitespace-only PR-body files fall back the same way a missing or stub template does. The drift guard stays tied to `CANON_OWNED` so future template additions cannot silently skip the doctor check.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: `canon doctor` flags a missing `pr-body.md` template. | Met | `src/cli/commands/doctor.ts:20-23` adds `pr-body.md`; `tests/cli.test.ts:364-386` covers the pass and warn cases. |
| AC-2: Drift guard: `EXPECTED_TEMPLATES` covers the canon-owned template set, derived from `CANON_OWNED`. | Met | `tests/cli.test.ts:389-401` derives `.canon/templates/` basenames from `CANON_OWNED` and asserts they all appear in `EXPECTED_TEMPLATES`. |
| AC-3: Blank `pr-body.md` is treated as unfilled (falls back). | Met | `scripts/run-task/validation.ts:661-669` returns `true` for blank/whitespace-only content; `tests/run-task-validation.test.ts:133-158` covers blank, whitespace-only, populated, stub, and missing-file behavior. |
| AC-4: `resolveQaPrBody` falls back on a blank file end-to-end. | Met | `tests/run-task-validation.test.ts:149-158` writes a blank single-task `pr-body.md` and asserts fallback resolution. |

## Edge Cases Considered

- Missing `pr-body.md` still returns the existing fallback path because the read throws before the predicate runs.
- Whitespace-only content counts as blank because the guard uses `content.trim() === ''`.
- Bundle PR-body behavior is unchanged; `resolveQaPrBody()` returns the bundle fallback before it reaches the predicate.
- The drift guard derives its template list from `CANON_OWNED` instead of duplicating the doctor list.

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
| `npm run lint` | Pass | |
| `npm test` — new tests + full suite | Pass | Added blank-body and drift-guard coverage; full suite passed. |
| `npm run type-check` | Pass | |
| `npm run build` — rebuild + commit `dist/` | Pass | Rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`; postbuild normalized 1 file. |
| `npm run sync-templates:check` — N/A | not_configured | Spec marked this check N/A; no canon-owned template files changed. |
| E2E — N/A | not_configured | Spec marked this check N/A. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
- [ ] Branch is current with `origin/<base>`

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
