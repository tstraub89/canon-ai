# Implementation Handoff: discovery-nudge

> Author: Codex | Spec: `tasks/discovery-nudge/spec.md` | Plan: `tasks/discovery-nudge/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| `src/cli/commands/doctor.ts` | Added exported `RECOMMENDED_NUDGE`; added `checkCanonDiscoveryNudge(cwd)` as a loose, warn-only canon-presence check over `CLAUDE.md` and `AGENTS.md`; registered it in the `Canon setup` doctor checks. |
| `README.md` | Added a short `Discovery nudge (recommended)` subsection near adoption/setup that shows the recommended canon orientation line in a fenced text block. |
| `tests/cli.test.ts` | Added doctor-check coverage for warn/pass/read-only behavior and a README drift test that compares the documented nudge text to `RECOMMENDED_NUDGE`. |
| `dist/cli/index.js` | Regenerated via `npm run build` so the shipped CLI bundle reflects the new doctor check and README drift constant. |
| `tasks/discovery-nudge/handoff.md` | Wrote the implementation handoff, including AC coverage, validation results, and the current diff footprint. |
| `tasks/discovery-nudge/status.json` | Task-state metadata updated during the implementation pass; remains part of the branch diff that the orchestrator will carry forward. |

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

Followed the spec’s recommend-only pattern rather than seeding any adopter files. `doctor.ts` now has one exported source-of-truth constant and one advisory check that only looks for a case-insensitive `canon` mention in either agent file, which keeps the warning soft enough to avoid alarm fatigue while still surfacing the orientation line after Task C removes the managed canon block. The README mirrors the constant exactly, and the test suite locks the two together so the text cannot drift silently.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| None | Implementation matched the plan. | None |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: single-source constant | Met | `RECOMMENDED_NUDGE` is exported from `src/cli/commands/doctor.ts` and used by both the doctor warning and the README drift test. |
| AC-2: loose warn-only doctor check | Met | `checkCanonDiscoveryNudge(cwd)` returns `warn` only when neither file mentions canon, `pass` when either file does, and never returns `fail`. |
| AC-3: advisory surfaces the recommendation | Met | The warning detail includes `RECOMMENDED_NUDGE` text and tells the operator to add it to `CLAUDE.md`. |
| AC-4: README documents it | Met | `README.md` now has a `Discovery nudge (recommended)` subsection with the recommended line. |
| AC-5: drift test | Met | `tests/cli.test.ts` compares the README text block to `RECOMMENDED_NUDGE`. |
| AC-6: recommend-only, no adopter-file writes | Met | `git diff --name-only -- src/cli/commands/init.ts templates/CLAUDE.md templates/AGENTS.md` is empty, and the new doctor check is read-only. |
| AC-7: build artifact current | Met | `npm run build` regenerated `dist/cli/index.js`; the diff contains the expected bundle update for the shipped CLI. |

## Edge Cases Considered

- Either agent file can independently satisfy the doctor check, which avoids a false warning when one file mentions canon and the other does not.
- The warning uses a substring match instead of an exact phrase match so rewording the orientation line does not create alarm fatigue.
- The read-only test checks file contents before and after the doctor call so an accidental write would be visible.

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
| `npm run lint` | Pass | eslint completed cleanly. |
| `npm run type-check` | Pass | `tsc -p tsconfig.json --noEmit` completed cleanly. |
| `npm test` | Pass | Full suite passed, including the new doctor and README drift tests. |
| `npm run build` | Pass | Rebuilt the CLI bundle; `dist/cli/index.js` was regenerated. |
| `npm run docs-refs-check` | Pass | README references were clean. |
| E2E — N/A | not_configured | No UI surface in scope. |

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
