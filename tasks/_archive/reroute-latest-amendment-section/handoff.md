# Implementation Handoff: reroute-latest-amendment-section

> Author: Codex | Spec: `tasks/reroute-latest-amendment-section/spec.md` | Plan: `tasks/reroute-latest-amendment-section/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `scripts/run-task/validation.ts` | Reworked `sliceRerouteRoundSection` to keep a file-wide fence/comment scan while selecting the latest same-round heading and deriving the end boundary from the latest section. Updated the doc-comment to explain the rejected-amendment recovery path that appends same-round duplicates. |
| `tests/run-task-validation.test.ts` | Added regression coverage for duplicate same-round sections, single-match and no-match behavior, round-1 bare-label duplicates, fenced fake headings, earlier-section fence carry, and the end-to-end `checkRerouteEvidence` fresh-verdict path. |
| `dist/scripts/run-task.js` | Rebuilt via `npm run build` so the bundled validator matches `scripts/run-task/validation.ts`. |
| `dist/cli/index.js` | Rebuilt as a shared bundle artifact because the same validator is bundled into the CLI entrypoint too. |
| `tasks/reroute-latest-amendment-section/notes.md` | Appended an implement note about the shared bundle rebuild producing both dist artifacts. |
| `tasks/reroute-latest-amendment-section/status.json` | Advanced the task state through `implement → done` via `canon task phase reroute-latest-amendment-section implement done`. |

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

The fix is read-only and keeps the existing verdict contract intact. `sliceRerouteRoundSection` now treats the latest same-round section as authoritative, which matches the rejected-amendment recovery path where a revised rerun appends a second same-round heading. The implementation keeps fence/comment awareness across the whole file so fenced examples cannot masquerade as real headings, and the tests exercise both the direct slicer and the reroute evidence gate that consumes it.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| `dist/cli/index.js` rebuilt in addition to `dist/scripts/run-task.js` | `validation.ts` is bundled into both entrypoints, so a clean `npm run build` updated both generated artifacts. | None; this is generated output from the same source change. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: Last same-round section wins. | Met | `sliceRerouteRoundSection` now overwrites the candidate heading on every matching same-round heading, and the duplicate-round-2 test asserts the returned slice contains the later `Approved` section. |
| AC-2: Single-section and absent cases covered. | Met | Added direct tests for one matching round-2 section, `null` when no matching heading exists, and round-1 bare-label duplicates selecting the latest bare heading. |
| AC-3: Fence/comment-awareness preserved, tracked continuously from file start. | Met | The helper still skips fenced/commented lines during the file-wide selection scan, and the new fenced-heading tests cover both a fake fenced heading and a fence opened in an earlier same-round section. |
| AC-4: `checkRerouteEvidence` reads the fresh verdict end-to-end. | Met | Added a `checkRerouteEvidence('spec_review', ...)` regression with stale `Changes requested` followed by fresh `Approved`; the assertion expects `verdict: 'approved'`. |

## Edge Cases Considered

- Round 1 uses the bare `## Amendment Review` heading, and the helper now picks the latest bare heading the same way it picks the latest `Round N` heading.
- A fenced or commented `## Amendment Review Round N` line is ignored even when it appears before the selected real heading.
- The section still ends at the next real `#`/`##` heading, so later content outside the amendment section does not leak into verdict extraction.

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
| `npm run lint` | Pass | `scripts/run-task/validation.ts` and `tests/run-task-validation.test.ts` lint clean. |
| `npm test` | Pass | Full suite passed, including the new reroute regression tests. |
| `npm run build` | Pass | Rebuilt the generated bundles, including `dist/scripts/run-task.js` and `dist/cli/index.js`. |
| `npm run type-check` | Pass | No type regressions. |
| `npm run sync-templates:check` | not_configured | Spec marked this check as N/A. |
| `E2E` | not_configured | Spec marked this check as N/A. |

## Ready for Review

- [ ] All spec ACs met (see AC Coverage table above)
- [ ] All applicable validation checks pass (no failures)
- [ ] All deviations from plan documented with rationale
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
