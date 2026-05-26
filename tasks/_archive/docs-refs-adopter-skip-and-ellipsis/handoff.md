# Implementation Handoff: docs-refs-adopter-skip-and-ellipsis

> Author: Codex | Spec: `tasks/docs-refs-adopter-skip-and-ellipsis/spec.md` | Plan: `tasks/docs-refs-adopter-skip-and-ellipsis/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.

| File | What Changed |
|---|---|
| `scripts/docs-refs-check.mjs` | Added top-level `NOISY_SOURCE_PATHS = []` with adopter-edit comment, taught `isNoisySourceFile()` to honor optional skip paths with trailing-slash normalization, added the `...` placeholder short-circuit, threaded `options.skipPaths` through `findBrokenRefs()` / `runChecks()`, and exported `NOISY_SOURCE_PATHS`. |
| `templates/scripts/docs-refs-check.mjs` | Mirrored the same checker changes while preserving the pre-existing root/templates drift in the noisy-source exemption block. |
| `scripts/docs-refs-check.mjs.d.ts` | Updated `runChecks()` to accept the optional `skipPaths` options seam and declared the mutable `NOISY_SOURCE_PATHS` export for test-time mutation. |
| `tests/docs-refs-check.test.ts` | Added coverage for directory-prefix skips, exact-file skips, trailing-slash normalization, ellipsis placeholders, and the default `NOISY_SOURCE_PATHS` runtime path. |

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

The implementation keeps the existing canon-universal exemptions intact, adds an adopter-controlled skip surface that works by exact file match or directory prefix, and treats `...` as a placeholder so forward-looking refs like `src/...` do not fail validation. The new `runChecks(repoRoot, options)` seam keeps tests isolated, while the exported `NOISY_SOURCE_PATHS` proves the no-options runtime path still consults the module default.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| Cleaned `tasks/docs-refs-adopter-skip-and-ellipsis/notes.md` and `tasks/docs-refs-adopter-skip-and-ellipsis/spec-review.md` prose to remove broken backtick refs to nonexistent paths. | The repo-root docs-refs gate scans those task artifacts; leaving the broken refs in place would fail AC-7 even though the implementation code was correct. | None; code behavior unchanged. |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: top-level `NOISY_SOURCE_PATHS = []` with adopter-edit comment after `VALID_DIRS` | Met | Added immediately after the `VALID_DIRS` block in both script copies. |
| AC-2: directory-prefix skip behavior with segment-boundary negative control | Met | The directory-prefix case skips the archive fixture and still reports the adjacent notes fixture, proving the slash boundary holds. |
| AC-2b: exact-file skip behavior with overmatch negative control | Met | The exact-file case skips only the changelogs fixture and still reports the notes-tree negative control, proving there is no sloppy prefix overmatch. |
| AC-2c: trailing-slash normalization | Met | An entry written with a trailing slash behaves the same as the slashless form. |
| AC-2d: default `NOISY_SOURCE_PATHS` consulted with no options | Met | The mutate-and-restore test proves `runChecks(root)` reads the module-level array and returns to the empty default after restore. |
| AC-3: existing canon-universal exemptions preserved unchanged | Met | The root and template checker bodies still hard-code the same canon-universal carve-outs; existing docs-refs tests still pass. |
| AC-4: `isPlaceholderTarget()` returns true for any target containing `...` | Met | Added the explicit `target.includes('...')` short-circuit and covered it with `src/...`. |
| AC-5: templates copy mirrors the new edits without introducing new drift | Met | The template checker received the same new logic, and the remaining root/templates diff is the pre-existing noisy-source carve-out difference only. |
| AC-6: five new test cases added, with only the default-path case mutating module state | Met | The test file now has five new cases; cases (a)–(d) use the options seam, and case (e) mutates and restores `NOISY_SOURCE_PATHS`. |
| AC-6b: `.d.ts` updated for the new export and options surface | Met | `runChecks()` now declares the optional options object and `NOISY_SOURCE_PATHS` is exported as a mutable `string[]`. |
| AC-7: `node scripts/docs-refs-check.mjs` exits 0 with `All refs OK` | Met | Verified on the final tree after cleaning the task-artifact backtick refs. |
| AC-8: `npm run lint`, `npm run type-check`, and `npm test` pass | Met | All three commands completed successfully on the final tree. |

## Edge Cases Considered

- The prefix rule intentionally uses `relPath === norm || relPath.startsWith(norm + '/')` so a directory entry does not accidentally swallow a sibling notes tree.
- The exact-file branch is separate from the prefix branch so a single-file skip can be narrow without widening the match to sibling paths.
- The default-path test restores `NOISY_SOURCE_PATHS` inside `finally` so later tests do not inherit a poisoned skip list.
- The root/templates checker copies still differ in their pre-existing noisy-source exemption regexes; this task did not try to reconcile that drift.
- Task artifact files such as `notes.md` and `spec-review.md` are scanned by the docs-refs gate, so backtick refs to nonexistent paths there can fail validation even though `tasks/<id>/spec.md` and `plan.md` remain exempt.

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
| Linting (`npm run lint`) | Pass | Ran on the final tree. |
| Type checking (`npm run type-check`) | Pass | Ran on the final tree. |
| Unit tests (`npm test`) | Pass | `node --test` completed with 445 passes and 1 expected skip in the sandboxed test environment. |
| Docs references (`npm run docs-refs-check`) | Pass | Passed after cleaning the task-artifact backtick refs that were tripping the repo-root scan. |
| `Full build` | deferred_by_spec | Spec marks this N/A for this task. |
| `End-to-end tests` | deferred_by_spec | Spec marks this N/A for this task. |

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

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

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

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|
| `tasks/docs-refs-adopter-skip-and-ellipsis/handoff.md` | Corrected the Validation Outcomes row labels to the exact required check text and removed backtick-wrapped fixture paths from the AC notes so the repo-root docs-refs checker passes on the handoff itself. |
| `tasks/docs-refs-adopter-skip-and-ellipsis/notes.md` | Added an implement-revision note about the handoff validation table needing exact required-check labels. |

### Findings addressed

- _correctness bug:_ Validation gate rejected the handoff because the required-check labels were paraphrased instead of matching the canonical text exactly. Fixed by rewriting the Validation Outcomes rows to the exact required check names.
- _risk/guardrail:_ The handoff still embedded backtick refs to nonexistent fixture paths, which caused the repo-root docs-refs checker to fail on the artifact itself. Fixed by converting those examples to plain prose.

### AC deltas (if any)

- None.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| Docs references (`node scripts/docs-refs-check.mjs`) | Pass | Reran after cleaning the handoff artifact prose and validation labels. |

## Iteration 3 — addressing review round 2

### Changes

> One row per file changed in this iteration. Same format as the baseline Changes table — `` `path/to/file.ext` `` or `[path/to/file.ext](url)` only.

| File | What Changed |
|---|---|
| `tasks/docs-refs-adopter-skip-and-ellipsis/handoff.md` | Removed inline-code wrapping from the Validation Outcomes Check column so the handoff validator canonicalizes the required checks correctly. |
| `tasks/docs-refs-adopter-skip-and-ellipsis/notes.md` | Added an implement-revision note about leaving the Validation Outcomes Check column as plain text. |

### Findings addressed

- _correctness bug:_ The handoff validator still could not match the required validation checks because the Check column was wrapped in inline code, which changed canonicalization. Fixed by leaving the check labels as plain text.

### AC deltas (if any)

- None.

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| Docs references (`node scripts/docs-refs-check.mjs`) | Pass | Reran after removing the outer inline-code formatting from the Validation Outcomes Check column. |
