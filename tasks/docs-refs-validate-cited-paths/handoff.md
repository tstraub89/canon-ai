# Implementation Handoff: docs-refs-validate-cited-paths

> Author: Codex | Spec: `tasks/docs-refs-validate-cited-paths/spec.md` | Plan: `tasks/docs-refs-validate-cited-paths/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

> One row per file changed. The first column must be either `` `path/to/file.ext` `` or `[path/to/file.ext](url)` — no wildcards, no combined paths, no placeholder text. Each row's path must exist in `git diff <base>...HEAD` after auto-commit.
>
> **Deleting a file?** In this table use the `[path/to/file.ext](path/to/file.ext)` markdown-link form — **not** backticks and **not** bare prose. Backticks trip `docs-refs-check` (a backtick path-ref to a now-missing path under a `validDirs` dir reads as broken); bare prose fails this table's path parse (the first column must be a backtick-path or a markdown-link). The markdown-link is the one form that satisfies both.

| File | What Changed |
|---|---|
| [scripts/docs-refs-check.mjs](scripts/docs-refs-check.mjs) | Added module-private `stripLineCitation(target)` and used it in both class-1 bare backtick ref sites so collected gitignore candidates and missing-file checks normalize the same stripped base path. Removed the class-1 line-citation skip so cited refs now validate their base file while keeping the original `ref` text in findings. |
| [templates/scripts/docs-refs-check.mjs](templates/scripts/docs-refs-check.mjs) | Regenerated synced mirror of `scripts/docs-refs-check.mjs` after the source change. |
| [tests/docs-refs-check.test.ts](tests/docs-refs-check.test.ts) | Added coverage for comma-list citations on existing files, missing cited files reporting the full original ref text, and gitignored cited refs staying skipped. |
| [tasks/docs-refs-validate-cited-paths/status.json](tasks/docs-refs-validate-cited-paths/status.json) | Task artifact updated by the pipeline to record the final phase transition from `implement` to `code_review`. |

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

Normalize line-cited backtick refs before both collection and validation, then let the existing missing-file gate run on the stripped base path. That closes the current validation gap for cited refs, preserves the existing line-citation handling for files that do exist, and keeps gitignore skipping keyed on the same normalized path at both sites.

## Deviations from Plan

**Spec ACs are binding. Plan approach is guidance.** You may implement differently than the plan specifies if you have good reason — document it here. Undocumented deviations and silently dropped ACs are critical violations.

| Deviation | Rationale | AC impact |
|---|---|---|
| _(none)_ | | |

## AC Coverage

Cross-reference each Acceptance Criterion from spec.md and confirm it is met.

| AC | Status | Notes |
|---|---|---|
| AC-1: A new module-private function `stripLineCitation(target)` exists in `scripts/docs-refs-check.mjs` and returns the input with a trailing line-citation suffix removed for all forms listed in *Decision* (single, range w/ ASCII/en/em dash, comma-list, comma-list-with-ranges, `#L` forms). Verify by unit assertions on representative inputs (e.g. `stripLineCitation('a/b.ts:151,254')` → `'a/b.ts'`; `stripLineCitation('a/b.ts:5')` → `'a/b.ts'`; `stripLineCitation('a/b.ts#L10-L20')` → `'a/b.ts'`; `stripLineCitation('a/b.ts')` → `'a/b.ts'` unchanged). | Met | Implemented as a private helper in [`scripts/docs-refs-check.mjs`](scripts/docs-refs-check.mjs) and exercised through the new comma-list coverage plus the existing line-citation pass cases. |
| AC-2: A backtick ref with a comma-list citation whose **base file exists** produces **no** finding. Verify: doc containing `` `scripts/fixture-target.ts:151,254` `` with `scripts/fixture-target.ts` present → `runChecks` returns `[]`. | Met | Covered by [`tests/docs-refs-check.test.ts`](tests/docs-refs-check.test.ts) in `line-citation refs: comma-list citation on an existing file passes`. |
| AC-3: A backtick ref with a line citation (single, range, **or** comma-list) whose **base file does NOT exist** produces a `missing file` finding, and the finding's `ref` field contains the full original text including the citation. Verify: doc containing `` `src/does-not-exist.ts:151,254` `` → one finding with `reason: 'missing file'` and `ref` including `:151,254`. | Met | Covered by [`tests/docs-refs-check.test.ts`](tests/docs-refs-check.test.ts) in `line-citation refs: missing file reports the full cited ref text`. |
| AC-4: Existing line-citation behavior for **existing** files is preserved — the current `line-citation refs: ascii hyphen, en-dash, and em-dash all pass` test stays green (single `:5`, ranges `:10-20`/`:30–40`/`:50—60`, and `#L10-L20`/`#L30–L40` all pass when the file exists). | Met | Existing test stayed green and now runs alongside the new comma-list case. |
| AC-5: The gitignore-skip still applies to a line-cited ref. Verify: a doc ref whose stripped base path is gitignored is skipped (no finding) — i.e. the candidate set built in `collectCandidateTargetPaths` keys on the stripped path so the `git check-ignore` batch and the check-site lookup agree. | Met | Covered by [`tests/docs-refs-check.test.ts`](tests/docs-refs-check.test.ts) in `gitignored target paths are skipped when the ref is line-cited`, and by stripping in both collector and checker. |
| AC-6: The three non-class-1 ref handlers (symbol-in-file, section `§`, anchor-link) are unchanged — `isLineCitationTarget` is still referenced by them and their existing tests stay green. | Met | The symbol/section/anchor handlers were left untouched; the full docs-refs test file still passes. |
| AC-7: `npm run docs-refs-check` run against the current repo tree passes (exit 0). The tightened check must not surface any pre-existing line-cited ref in canon's own docs/tasks/templates whose base path is actually missing; if it does, that is a real broken ref — fix the ref in the offending doc and note it in `handoff.md` (do not loosen the checker to hide it). | Met | `npm run docs-refs-check` returned exit 0 with `All refs OK`. |

## Edge Cases Considered

- Trailing citation stripping is end-anchored, so only citation-shaped suffixes are removed.
- Gitignore skipping now keys on the stripped base path in both the candidate collector and the checker.
- Findings preserve the original cited text in `ref`, so missing-file errors still show the operator exactly what they wrote.

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
| `npm run lint` (`eslint scripts/ tests/ src/`) | Pass | |
| `npm run type-check` (`tsc -p tsconfig.json --noEmit`) | Pass | |
| `npm test` (`node --test --import ./tests/md-loader-register.mjs --import tsx tests/*.test.ts`) | Pass | |
| `npm run docs-refs-check` (`node scripts/docs-refs-check.mjs`) | Pass | |
| `npm run sync-templates:check` | Pass | |

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| [scripts/docs-refs-check.mjs](scripts/docs-refs-check.mjs) | Split `collectGitIgnoredTargets` into prefixes-only source-file behavior by default and candidate-only poison filtering when `filterNonPathTokens` is enabled; the candidate pass now opts in, so gitignored source paths with spaces stay skip-listed while arbitrary backtick tokens still cannot poison the batch. |
| [templates/scripts/docs-refs-check.mjs](templates/scripts/docs-refs-check.mjs) | Regenerated synced mirror after the candidate/source filter split. |
| [tests/docs-refs-check.test.ts](tests/docs-refs-check.test.ts) | Added a regression proving a gitignored markdown source file whose name contains a space is excluded from scanning, and kept the poison-token candidate-pass regression. |
| [tasks/docs-refs-validate-cited-paths/notes.md](tasks/docs-refs-validate-cited-paths/notes.md) | Appended the round-2 observation that the poison filter must remain candidate-only so source-file paths with spaces still flow through the gitignore source pass. |
| [tasks/docs-refs-validate-cited-paths/status.json](tasks/docs-refs-validate-cited-paths/status.json) | Pipeline bookkeeping refreshed for reroute round 2 with `reroute_count=2`. |
| [tasks/docs-refs-validate-cited-paths/handoff.md](tasks/docs-refs-validate-cited-paths/handoff.md) | Appended this reroute iteration record. |

### Findings addressed

- _correctness bug:_ the round-2 poison filter was applied to both `collectGitIgnoredTargets` call sites, which would have dropped real gitignored source paths containing spaces from `ignoredSources` and reintroduced local-vs-CI skew.
- _risk/guardrail:_ the new source-pass regression uses a gitignored markdown file with a space in its name, so it fails if the filter ever becomes shared again.
- _spec gap:_ AC-11 is now covered, and the earlier AC-8 / AC-10 reroute requirements remain green under the split filter.

### AC deltas (if any)

- AC-11: Met
- AC-8: re-confirmed
- AC-10: re-confirmed
- AC-7: re-confirmed against the full worktree tree

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |

## Iteration 4 — addressing review round 3

### Changes

| File | What Changed |
|---|---|
| [scripts/docs-refs-check.mjs](scripts/docs-refs-check.mjs) | Removed the Round-2 token-shape filter and replaced the `git check-ignore` batch with a resilient bisection path: a single work-tree probe now short-circuits no-repo runs, and any 128-causing candidate is isolated so it cannot empty the entire gitignore-skip set. |
| [templates/scripts/docs-refs-check.mjs](templates/scripts/docs-refs-check.mjs) | Regenerated synced mirror after the resilient batch rewrite in the source checker. |
| [tests/docs-refs-check.test.ts](tests/docs-refs-check.test.ts) | Replaced the non-discriminating poison-token regression with a symlink-based 128-causer fixture, added the gitignored-space path coverage, and added the no-repo degradation check. |
| [tasks/docs-refs-validate-cited-paths/notes.md](tasks/docs-refs-validate-cited-paths/notes.md) | Appended the round-3 observation that the real 128-causers are outside-repo paths and symlink-traversal paths, not whitespace-bearing tokens. |
| [tasks/docs-refs-validate-cited-paths/handoff.md](tasks/docs-refs-validate-cited-paths/handoff.md) | Appended this reroute iteration record. |
| [tasks/docs-refs-validate-cited-paths/status.json](tasks/docs-refs-validate-cited-paths/status.json) | Pipeline bookkeeping updated for reroute round 3 and the final implement-phase close. |

### Findings addressed

- _correctness bug:_ the Round-2 token-shape filter was solving the wrong problem and was dropping valid gitignored refs with spaces; the new implementation isolates only the actual 128-causers instead of trying to predict token shapes.
- _risk/guardrail:_ the gitignored-space fixture now discriminates the source pass and the candidate pass from the batch resilience behavior, and the symlink-based 128-causer fixture proves a single bad candidate cannot disable the entire skip set.
- _spec gap:_ AC-12, AC-13, AC-14, and AC-15 are now covered; AC-7, AC-8, AC-9, and AC-10 remain green under the round-3 rewrite.

### AC deltas (if any)

- AC-12: Met
- AC-13: Met
- AC-14: Met
- AC-15: Met
- AC-8: re-confirmed with a genuine 128-causer
- AC-9: re-confirmed with a discriminating gitignored-path fixture
- AC-10: re-confirmed
- AC-7: re-confirmed against the full worktree tree

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
| `npm run build` | deferred_by_spec | Spec marks this N/A: the checker runs directly via `node` and is not bundled into `dist/`. |
| E2E | deferred_by_spec | Spec marks this N/A: no UI/runtime surface. |

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
| [scripts/docs-refs-check.mjs](scripts/docs-refs-check.mjs) | Hardened `collectGitIgnoredTargets` so non-path tokens are dropped before the `git check-ignore` batch, preventing flag-like and whitespace-bearing backtick tokens from poisoning the entire gitignore-skip set. |
| [templates/scripts/docs-refs-check.mjs](templates/scripts/docs-refs-check.mjs) | Regenerated synced mirror after the `collectGitIgnoredTargets` hardening. |
| [tests/docs-refs-check.test.ts](tests/docs-refs-check.test.ts) | Replaced the weak gitignore regression with a discriminating fixture under `docs/` that combines a gitignored line-cited path and a poison token, so the test only passes when both dual-site stripping and batch filtering work. |
| [tasks/docs-refs-validate-cited-paths/review.md](tasks/docs-refs-validate-cited-paths/review.md) | Reworded the optional cleanup note to avoid a backtick ref to the hidden settings file so `docs-refs-check` can pass on the task artifact set. |
| [tasks/docs-refs-validate-cited-paths/notes.md](tasks/docs-refs-validate-cited-paths/notes.md) | Appended the reroute note about `git check-ignore` batch poisoning. |
| [tasks/docs-refs-validate-cited-paths/handoff.md](tasks/docs-refs-validate-cited-paths/handoff.md) | Appended this reroute iteration record. |
| [tasks/docs-refs-validate-cited-paths/status.json](tasks/docs-refs-validate-cited-paths/status.json) | Finalized the phase transition from `implement` to `code_review`. |
| [docs/pipeline-invocations.md](docs/pipeline-invocations.md) | Auto-appended pipeline telemetry from this reroute session. |

### Findings addressed

- _correctness bug:_ `collectGitIgnoredTargets` could fail closed on `git check-ignore` exit 128 when a non-path token was present in scanned docs, disabling the gitignore skip for unrelated refs.
- _risk/guardrail:_ the AC-5 regression fixture now proves the gitignore path is exercised under `docs/`, so the test fails if either stripping or batch filtering regresses.
- _spec gap:_ AC-8, AC-9, and AC-10 from the amendment are now covered by the checker change and the updated regression test.

### AC deltas (if any)

- AC-8: Met
- AC-9: Met
- AC-10: Met
- AC-7: re-confirmed against the full worktree tree

### Re-run validation (only checks that re-ran)

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | |
| `npm run docs-refs-check` | Pass | |
| `npm run sync-templates:check` | Pass | |
