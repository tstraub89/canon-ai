# Implementation Handoff: allow-comma-separated-multipath-cells

> Author: Codex | Spec: `tasks/allow-comma-separated-multipath-cells/spec.md` | Plan: `tasks/allow-comma-separated-multipath-cells/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> Comma-separated rows group tightly coupled files; unrelated changes remain separate.
>
> The pre-flight coverage check reads rows ONLY from this table and from `### Changes` tables inside `## Iteration N` sections. A file-list table under any other heading is invisible to it — don't invent new coverage sections.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/validation.ts` | Replaced first-path extraction with sequential comma-list tokenization, balanced markdown-link destination parsing, structural rejection, per-path validation, and multi-path propagation to all consumers; removed the lenient single-path wrapper. |
| `scripts/run-task/main.ts` | Updated the malformed-row recovery message to document comma-separated path lists and trailing annotations. |
| `.canon/templates/handoff.md` | Documented multi-path cells in baseline and iteration notes, including grouping guidance and retained prohibitions. |
| `templates/.canon/templates/handoff.md` | Synchronized generated mirror of the handoff template. |
| `tests/run-task-validation.test.ts` | Added parser, spec-table, handoff-table, malformed-structure, per-path validation, and unscanned-table regression coverage; removed retired wrapper tests. |
| `tests/task-cli.test.ts` | Added end-to-end acceptance for a comma-list handoff row and retained rejection coverage with a genuinely malformed row. |
| `docs/BACKLOG.md` | Reworded the three stale historical single-path references without changing the entry's resolved multi-table context. |
| `docs/codebase-map.md` | Updated the parser description for comma-separated backtick and markdown-link tokens. |
| `dist/cli/index.js` | Rebuilt the published CLI bundle from the updated parser. |
| `dist/scripts/run-task.js` | Rebuilt the published orchestrator bundle from the updated parser and recovery message. |

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

The parser now walks each cell from left to right, recognizing backtick tokens and markdown links with balanced destination parentheses. It only treats commas between completed tokens as separators, so commas inside a token or trailing annotation remain literal. Structural failures return no paths, preventing subset extraction; per-path validation is independent so valid siblings remain visible alongside a precise malformed entry.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Added rejection and coverage for an annotation attached without whitespace. | The spec's cell grammar says annotations are whitespace-separated; enforcing that boundary keeps the parser anchored to the documented shape. | Tightens malformed input only; all AC behavior is unchanged. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met. AC IDs may be flat-numbered (`AC-1`) or grouped under section letters (`AC-A1`) — mirror whatever scheme spec.md uses.

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | `parseHandoffChangesRows` extracts both backtick paths with no malformed rows. |
| AC-2 | Met | Mixed tokens, balanced nested destination parentheses, URL commas, and link-tail annotations are covered. |
| AC-3 | Met | Multi-token annotations and annotations containing commas preserve the intended path count. |
| AC-4 | Met | Prose-between-token, juxtaposition, token-in-annotation, dangling-comma, and comma-then-prose cases reject with class-specific reasons and zero subset paths. |
| AC-5 | Met | Wildcard, placeholder, absolute, and traversal siblings each retain the valid path and name the invalid token. |
| AC-6 | Met | A comma inside one backtick token remains one literal path. |
| AC-7 | Met | Design and Amendment Affected Files tables both accept comma-separated cells. |
| AC-8 | Met | `extractHandoffPath` and all tests/references were deleted; structural grep is clean. |
| AC-9 | Met | Retired wording is absent; orchestrator and historical BACKLOG wording now reflect comma-list support. |
| AC-10 | Met | Both handoff template notes document token format, grouping guidance, annotations, and retained prohibitions; mirror check passes. |
| AC-11 | Met | Full unit suite passes, including existing single-path behavior and both affected suites. |
| AC-12 | Met | Fresh build regenerated both required dist bundles. |
| AC-13 | Met | `taskAccept` accepts a covered comma-list row and still refuses prose-between-token rows. |
| AC-14 | Met | `collectUnscannedTableHits` records both paths from a multi-path row under an unrecognized heading. |

## Edge Cases Considered

- Balanced parentheses and commas inside markdown-link destinations.
- Literal commas inside backtick paths and commas inside annotations.
- Empty markdown-link destinations, absolute paths on POSIX/Windows, and nested traversal.
- Extra tokens hidden after apparent prose annotations and directly juxtaposed tokens.
- Partial per-path failures without discarding valid siblings.
- The resolved BACKLOG entry was kept in historical/resolved tense, matching the current file despite the spec's stale "still-open" characterization.

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
| `npm run lint` | Pass | ESLint completed cleanly. |
| `npm run type-check` | Pass | TypeScript no-emit check completed cleanly. |
| `npm test` | Pass | 983 tests: 982 passed, 1 expected environment skip, 0 failed. |
| `npm run build` | Pass | Both published bundles rebuilt; postbuild normalization completed. |
| `npm run sync-templates:check` | Pass | Canon-managed files are in sync. |
| `npm run docs-refs-check` | Pass | All references are valid. |
| AC-9 retired-wording grep | Pass | Zero hits across operative guidance surfaces. |
| AC-8 symbol grep | Pass | Zero `extractHandoffPath` hits in scripts, src, or tests. |

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
