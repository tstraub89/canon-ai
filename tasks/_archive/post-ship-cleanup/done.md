# Completion Summary: post-ship-cleanup — Cleanup of trivial leftovers from blast-radius, self-check evidence, and path-scoped pitfalls

> For the human. This is what you need to know.

## What Changed

Fourteen small fixes left over from three shipped tasks. The implementer's related-files map no longer lists the pipeline log docs or words like `True`, `None`, and `Pass` as identifiers, and it treats acronym plurals like `IDs` as non-identifiers. The Self-Check evidence gate now rejects the template placeholder when it is wrapped in bold or code markup, and rejects evidence that still says `<reason>`. The pitfall selector accepts one-dash table separators (`|-|-|`) and treats an empty `CANON_PATTERNS_MD_PATH` as unset instead of dropping `docs/patterns.md`. The docs now say how a path counts as a pitfall citation and which function is the live per-task gate. Each behavior change has a test that failed on `main` first, except the docs-only items and the P6 header test, which were checked by reading and by running the test.

## Files Changed

- `src/orchestrator/blast-radius.ts` — stoplist for literal/status words, acronym-plural filter, git grep exit handling, telemetry-file exclusion
- `src/orchestrator/validation.ts` — markup-wrapped placeholder detection and `<reason>` rejection in `checkSelfCheckEvidence`
- `src/orchestrator/main.ts` — corrected comment above `checkImplementEvidence` (names `validateHandoffAgainstSpec`)
- `src/orchestrator/pitfalls.ts` — one-dash separator rule; empty `CANON_PATTERNS_MD_PATH` falls back
- `tests/blast-radius.test.ts` — tests for B1–B5, including the fail-open positive control
- `tests/run-task-validation.test.ts` — self-check placeholder and `<reason>` cases
- `tests/pitfalls.test.ts` — `|-|-|` index parsing and empty-override fallback
- `tests/run-task-prompts.test.ts` — no-Affected-Files state header assertion
- `docs/patterns.md` — live gate named, `validateHandoff()` described as test-parity, path-citation syntax, index-table exception
- `docs/product-context.md` — live gate named, test-parity note
- `docs/codebase-map.md` — index-table exception
- `docs/pipeline-orchestrator.md` — `CANON_PITFALLS_DOCS_ROOT` row covers the patterns-doc fallback
- `README.md` — index-table exception
- `templates/docs/patterns.md` — adopter-neutral example path (`example-app/src/store/**`), path-citation syntax
- `templates/docs/pipeline-orchestrator.md` — mirror of the env row
- `.claude/skills/canon-init/write-guide.md` and `templates/.claude/skills/canon-init/write-guide.md` — path-citation syntax (root and mirror)
- `dist/orchestrator/run-task.js` — rebuilt bundle

## How to Test

1. Start a small task whose spec mentions `True`, `None`, and `IDs` as code. Expected: the implementer's related-files map does not list those words, and it does not list `docs/lessons-learned.md`, `docs/pipeline-invocations.md`, or `docs/task-quality-log.md`.
2. In a handoff's Self-Check table, put the example text in bold (`**_(…)_**`) or in code marks, then in a second run write `N/A — <reason>`. Expected: both are sent back for a real reason. Write `N/A — no tests changed` and real evidence. Expected: both are accepted.
3. Add a pitfall index table whose separator row is `|-|-|`. Expected: its rows are selected as an index.
4. Set `CANON_PATTERNS_MD_PATH` to an empty value. Expected: pitfall selection still reads `docs/patterns.md` from the docs root.

## Test Results

Results below are from the implementer's `handoff.md` Validation Outcomes. QA did not re-run them.

| Check | Result |
|---|---|
| `npm run lint` | Pass |
| `npm run type-check` | Pass |
| `npm test` | Pass — 2,162 passed, 0 failed, 1 skipped |
| `npm run build` | Pass — `dist/orchestrator/run-task.js` rebuilt; `dist/cli/index.js` unchanged |
| `npm run docs-refs-check` | Pass |
| `npm run sync-templates:check` | Pass |
| Targeted suites (blast-radius, run-task-validation, pitfalls, run-task-prompts) | Pass — 418 passed |
| `git diff --check` | Pass |
| Code review Stage 1 (AC-1 to AC-9) | Met for all nine ACs |

The full suite reports 1 skipped test. The handoff does not name it, so this QA pass has not verified it. See Open Questions.

## Human Verification Required

None.

Pre-merge checklist (Handoff Validation). Items QA could not confirm:
- [ ] Version correct — not decided at QA; the release step owns the bump tier.
- [ ] Changelog updated — not done at QA; the release step owns it (see Proposed Changelog).
- [x] PR body current — `tasks/post-ship-cleanup/pr-body.md` written from the final diff.
- [ ] Final CI/CD checks green — not run; no PR has been opened.
- [x] Final diff matches spec intent — every AC is Met in the code review's Stage 1 table.

No CI job is renamed or added, so the branch-ruleset step does not apply.

## Proposed Changelog

Entry text only. The version and bump tier are set at the release step.

### Fixed

- **The implementer's related-files map ignores literal and status words and pipeline log docs.** Words like `True`, `None`, and `Pass`, and acronym plurals like `IDs`, are no longer searched as identifiers. `docs/lessons-learned.md`, `docs/pipeline-invocations.md`, and `docs/task-quality-log.md` no longer appear in the map.
- **Self-Check evidence rejects the template placeholder when it is wrapped in bold or code marks, and rejects a copied `<reason>`.** An evidence cell written entirely in parentheses is also rejected as a placeholder. The rejection message says how to fix it.
- **Index tables with one-dash separator rows (`|-|-|`) are read as pitfall indexes.**
- **An empty `CANON_PATTERNS_MD_PATH` falls back to `docs/patterns.md`** instead of dropping the patterns doc from pitfall selection.

### Changed

- **The patterns doc and the canon-init write guide say how a path counts as a pitfall citation.** A path counts only inside backticks or as a markdown link target. A directory prefix needs a trailing `/`, a glob needs `*`, and a bare file name never matches.

## Judgment Calls to Confirm

- Literal/status words — chosen: a fixed, case-sensitive stoplist of exact tokens; alternative: drop the single-capitalized-word rule (that rule catches component names like `Widget`).
- Placeholder shape — chosen: the whole Evidence cell is parenthesized after markup is stripped; alternative: match the template's exact placeholder strings. Both cold reviewers flagged this one (see Open Questions).
- Telemetry exclusion — chosen: reuse `PIPELINE_TELEMETRY_FILES`; alternative: a blast-radius-local list.

## Decisions Made

- The telemetry exclusion goes through the shared `excludedPath()` check, so reference hits and identifier hits both drop the three pipeline log docs.
- `gitGrep` treats exit status 1 as no matches. Any other non-zero exit, including a signal, throws. The map's caller still catches the error and fails open.
- The empty-override check runs at call time, so `CANON_PATTERNS_MD_PATH=""` falls through to `CANON_PITFALLS_DOCS_ROOT` and then to `docs/patterns.md`.
- `validateHandoff()` stays in the docs as the test-parity function for `classifyPreflightBlockers()`. The spec kept it, and the docs say so.
- The scaffold example in `templates/docs/patterns.md` now uses `example-app/src/store/**`. New scaffolds change; existing adopter docs do not.

## Open Questions

1. **Parenthesized-evidence rejection.** The cold-Codex lens (P2) and the cold-Claude lens both flagged that a legitimate cell like `(verified both entry points against the diff)` is rejected. The anchored lens approved it as a nit. The spec accepted this as a Known Risk. Keep the shape rule, or narrow it to the template's exact placeholder strings? If retries show up in practice, narrowing is a spec change, not a code fix.
2. **Which test was skipped?** `npm test` reports 1 skipped test, and the handoff does not name it. Name it, or confirm it was skipped before this task.
3. **Changelog scope for the docs items.** The path-citation rule (P4) is in the changelog draft because adopters writing pitfalls need it. The index-table exception (P7) and the scaffold path (P3) are not. Confirm, or drop the Changed bullet.
4. **Plan artifact.** `tasks/post-ship-cleanup/plan.md` is still the empty template. The implementer ran from the spec alone (handoff "Deviations from Plan"). The pipeline should have filled the plan; this is for the human to decide whether it needs a fix.

## Quality Log

- Spec verdict: approved
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Code review approved_with_nits; the parenthesized-evidence nit was disagreed on and accepted as a spec-level risk, not a blocker.

Maintenance: lessons-learned.md plus this task's fragment have 34 entries; a human lessons sweep is due (see docs/lessons-learned.md → "How to use this doc").

## Root Cause

None.
