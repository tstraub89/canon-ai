# Implementation Handoff: preflight-failure-routing

> Author: Codex | Spec: `tasks/preflight-failure-routing/spec.md` | Plan: `tasks/preflight-failure-routing/plan.md`

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/validation.ts` | Added bucketed pre-flight classification, the in-diff `Fail – unrelated` laundering guard, suffix-tolerant cited-file extraction, absolute-path suffix matching, the amended bare-basename reference gate, basename last-segment matching for basename-plus-line citations, and the restored all-row plain-Fail scan for non-required validation rows. |
| `scripts/run-task/phases/code-review.ts` | Replaced the undifferentiated pre-flight rejection path with bucket-aware review-block framing and implement-vs-auto-block routing. |
| `scripts/run-task/prompts/index.ts` | Made the implement-revision pre-flight branch bucket-neutral and pointed Codex at the review.md pre-flight block. |
| `scripts/run-task/prompts/templates/implement-revisions.md` | Removed handoff-only/source-unnecessary wording and documented neutral fix-handoff/fix-code/both handling. |
| `scripts/run-task/prompts/templates/code-review-round-1.md` | Added reviewer instruction that a changed file cannot be labeled unrelated. |
| `scripts/run-task/prompts/templates/implement.md` | Added implementer instruction that `Fail – unrelated` applies only outside files Codex changed. |
| `tests/run-task-validation.test.ts` | Added tests for cited-path extraction, changed-file matching, classifier buckets, own-file laundering rejection, absolute-path citations, bare-basename gating, basename-plus-line matching, non-required plain-Fail rows, routing priority, and review-block framing. |
| `tests/run-task-prompts.test.ts` | Added direct assertions that the pre-flight revision prompt is bucket-neutral. |
| `tests/run-task-prompts.golden.json` | Regenerated prompt snapshots for the changed implement and code-review prompt templates. |
| `AGENTS.md` | Updated declared canon for invalid own-file `Fail – unrelated` entries. |
| `CLAUDE.md` | Updated Stage 1 validation-gate guidance for invalid own-file `Fail – unrelated` entries. |
| `templates/AGENTS.md` | Synced mirror of the AGENTS.md canon block. |
| `templates/CLAUDE.md` | Synced mirror of the CLAUDE.md canon block. |
| `docs/decisions.md` | Updated the existing decision entry to note the deterministic pre-flight layer on top of Stage 1 credibility review. |
| `dist/scripts/run-task.js` | Rebuilt bundled orchestrator artifact. |

## Intent & Rationale

The implementation makes pre-flight classification explicit and shared. Validation outcomes, AC coverage, malformed Changes rows, and bundle diff mismatches now become `format`, `regression`, or `blocked` blockers from one helper. Code review uses that classification to write targeted review.md instructions: handoff-structure issues say "Fix the handoff," real failed checks say "Fix the code," mixed fixable blockers include both, and blocked-only infrastructure rows halt through `autoBlockPhase` with recovery guidance.

The reroute amendments close the remaining laundering paths for non-repo-relative citations. Absolute POSIX and Windows cited paths now match changed files by walking repo-relative suffixes, while bare filenames without a line reference are rejected before Stage 1 credibility review. Bare filenames with `:line` pass the outer reference check and then compare against changed-file last path segments, so `editor.spec.ts:1231` is treated as in-diff when `e2e/specs/editor.spec.ts` changed.

Reroute round 3 restores the pre-refactor behavior that any plain `Fail` row in Validation Outcomes is blocking, even when that check is not listed in the spec's Validation Required section. The restored scan is narrow: it skips required rows to avoid duplicate blockers, ignores non-required `Pass`, and leaves non-required `Fail – unrelated` rows on the existing Stage 1 credibility path.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Added pure route/message helpers in `scripts/run-task/phases/code-review.ts` | The spec requires unit assertions on review.md framing and routing. Exporting `determinePreflightRoute` / `buildPreflightReviewBlock` keeps that coverage lightweight without spawning the full orchestrator or Claude. | Meets AC-3a/3b/3c/5/6; no behavior reduction. |
| Absolute-path comparison lives in `matchAgainstChangedFiles` rather than mutating `extractCitedFilePaths` output | Keeping extraction and comparison separate makes the matching rule explicit and testable for relative, POSIX absolute, and Windows drive-letter paths. | Meets AC-1a and AC-8; no behavior reduction. |
| The amended outer reference gate requires either `:line` or a path separator plus filename extension, rather than accepting any slash token | This preserves the existing vague-prose rejection for notes like `unit/e2e failure`; a raw slash regex would treat that prose as a specific file reference. | Meets AC-1b while preserving the original vague-notes guard. |
| `dist/cli/index.js` is not in the Changes table | `npm run build` left this artifact byte-identical in this worktree. Listing a net-zero file would create a false handoff→diff mismatch. | None; generated artifacts that changed are listed. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: laundering guard rejects own-file "unrelated" | Met | `validateHandoffAgainstSpec` and `classifyPreflightBlockersFromData` reject `Fail – unrelated` when Notes cite a changed file; covered in `tests/run-task-validation.test.ts`. |
| AC-1a: absolute-path citation resolves to in-diff match | Met | `matchAgainstChangedFiles` walks absolute-path suffixes and the classifier emits a regression blocker for `/workspace/repo/e2e/specs/editor.spec.ts:1231` when `e2e/specs/editor.spec.ts` is changed. |
| AC-1b: bare basename without `:line` rejected | Met | `hasSpecificFailUnrelatedReference` rejects `editor.spec.ts` as format-invalid; `editor.spec.ts:1231` passes the outer check and proceeds to the AC-1c in-diff matcher. |
| AC-1c: basename plus `:line` matches changed-file last segment | Met | `matchAgainstChangedFiles` scans changed-file last segments for bare basenames; `editor.spec.ts:1231` with `e2e/specs/editor.spec.ts` in `changedFiles` emits a regression blocker, while `foo.spec.ts:1231` does not. |
| AC-1d: known limitations documented | Met | `tasks/preflight-failure-routing/spec.md` Known Risks documents the `:line`-only, same-basename false-positive, and URL-citation limitations with rationale. |
| AC-2: genuinely-unrelated accept path preserved | Met | Not-in-diff cited files still produce no unrelated-fail issue; covered in classifier and `validateHandoffAgainstSpec` tests. |
| AC-3a: format blocker gets handoff-fix framing | Met | `buildPreflightReviewBlock` emits `### Fix the handoff` with structural items; unit-tested. |
| AC-3b: regression blocker gets code-fix framing | Met | `buildPreflightReviewBlock` emits `### Fix the code`, names the failing check, and omits the old "resubmit handoff" verdict; unit-tested. |
| AC-3c: mixed fixable blockers stack both framings | Met | Mixed format + regression blockers render both sections and route to implement; unit-tested. |
| AC-4: regression/format routing and counters unchanged | Met | Fixable pre-flight failures still call `taskPhasePreflightRejected`; existing counter-schema tests cover counter behavior and new route tests cover implement routing. |
| AC-5: infra-blocked only halts for human | Met | Blocked-only classification routes `auto_block`, writes infrastructure triage/recovery text, and calls `autoBlockPhase`; unit-tested for route/message. |
| AC-6: fixable work wins over halt | Met | `determinePreflightRoute` returns implement when any format/regression blocker exists, even with blocked rows; unit-tested. |
| AC-7: declared-canon defense in depth | Met | AGENTS.md, CLAUDE.md, code-review prompt, implement prompt, and synced template mirrors now state own-file unrelated labels are invalid. |
| AC-8: in-diff match tolerates line/column suffix | Met | `extractCitedFilePaths` strips `:line` and `:line:col`; unit-tested. |
| AC-9: coverage for classification/routing branches | Met | `tests/run-task-validation.test.ts` covers all three buckets, both in-diff guard directions, suffix matching, absolute suffix matching, basename last-segment matching, mixed priority, and review-block framing. |
| AC-10: implement-revision prompt is bucket-neutral | Met | The pre-flight branch no longer includes retired handoff-only phrases and points at `## Validation Gate` / `## Pre-Flight Rejection`; direct prompt assertions cover this branch. |
| AC-11: non-required plain-Fail row becomes regression blocker | Met | `classifyPreflightBlockersFromData` scans every Validation Outcomes row after required-check classification; non-required plain `Fail` emits one regression blocker, non-required `Pass` and `Fail – unrelated` do not, and required `Fail` rows are not double-counted. |

## Edge Cases Considered

- Notes with `path:line` and `path:line:col` both normalize to the changed-file path before matching.
- POSIX absolute paths and Windows drive-letter paths match by walking suffixes until a repo-relative changed-file key is found.
- Bare basename citations without `:line` are too ambiguous for `Fail – unrelated`; basename-plus-line now compares against changed-file last path segments.
- A `:line`-only citation and URL-style citations still pass to Claude Stage 1 because they do not produce a deterministic changed-file match.
- Same-basename matches intentionally over-catch in the safe direction: if any changed file has the cited basename, the failure is treated as a regression blocker.
- An empty changed-files set preserves the existing `Fail – unrelated` accept path; this avoids false positives when no diff is available.
- Non-required validation rows only restore the old plain-`Fail` blocker behavior; non-required `Fail – unrelated` remains a Claude Stage 1 credibility question.
- Bundle pre-flight passes the union of changed files to every task classifier, so a file changed by any bundle member cannot be called unrelated.
- Blocked rows are only terminal when no fixable format/regression blocker exists anywhere in the pre-flight failure set.
- The pre-flight review block keeps `## Validation Gate` and `## Pre-Flight Rejection` headings and avoids `## Round` headings so existing review verdict parsing is preserved.

## Blockers

- None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | Final run passed: 744 pass, 1 skipped, 0 failures. |
| `npm run build` | Pass | Rebuilt `dist/scripts/run-task.js`; `dist/cli/index.js` remained byte-identical. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | All refs OK. |

## Ready for Review

- [x] Original and amended ACs are covered.
- [x] Required validation checks pass.
- [x] Blockers are clear: none.
