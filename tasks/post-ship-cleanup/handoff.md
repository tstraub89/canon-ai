# Implementation Handoff: post-ship-cleanup

> Author: implementer | Spec: `tasks/post-ship-cleanup/spec.md` | Plan: `tasks/post-ship-cleanup/plan.md`
>
> **Per-iteration sections.** This file is cumulative across review rounds. The sections below cover Iteration 1 (initial implementation). On subsequent revisions, append a new `## Iteration N — addressing review round N-1` section near the bottom rather than rewriting the file — the reviewer reads it as the cumulative record.

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/blast-radius.ts` | Filter exact status/literal tokens and acronym plurals, throw on git grep failures other than exit 1, and omit registered telemetry files. |
| `tests/blast-radius.test.ts` | Add regression coverage for token extraction, git statuses, telemetry exclusion, and the pass-through positive control. |
| `src/orchestrator/validation.ts` | Reject markup-wrapped parenthesized placeholders and literal `<reason>` evidence. |
| `tests/run-task-validation.test.ts` | Cover the two markup forms, copied reason placeholder, accepted N/A reason, and real evidence. |
| `src/orchestrator/main.ts` | Correct the implement-evidence comment to describe `validateHandoffAgainstSpec`. |
| `docs/patterns.md` | Clarify path citations and identify the live per-task gate plus its test-parity helper. |
| `docs/product-context.md` | Identify the live per-task gate and its test-parity helper. |
| `docs/codebase-map.md` | Clarify that index tables are excluded from whole-section prose injection. |
| `README.md` | Clarify that index tables are excluded from whole-section prose injection. |
| `src/orchestrator/pitfalls.ts` | Accept one-dash table separators and treat an empty patterns override as unset. |
| `tests/pitfalls.test.ts` | Cover `|-|-|` index parsing and empty-override fallback through the docs root. |
| `tests/run-task-prompts.test.ts` | Assert the no-Affected-Files state header in an implement prompt. |
| `templates/docs/patterns.md` | Use an adopter-neutral example path and document path-citation syntax. |
| `.claude/skills/canon-init/write-guide.md`, `templates/.claude/skills/canon-init/write-guide.md` | Document path-citation syntax in the canon-init guide and its generated mirror. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Document the patterns-doc fallback root and preserve the test-only scope of the override. |
| `dist/orchestrator/run-task.js` | Rebuild the tracked orchestrator bundle from the updated source. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

Applied the nine spec criteria at their existing source, test, documentation, and generated-bundle surfaces. Kept the existing map fail-open behavior at its caller while making `gitGrep` distinguish ordinary no-match status 1 from failures. Reused `PIPELINE_TELEMETRY_FILES` as the telemetry exclusion source.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| No implementation steps were specified; `tasks/post-ship-cleanup/plan.md` contains only the plan scaffold. Implemented directly from the binding spec. | The spec fully defines each change and test. | None |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1: B1 and B2 token filtering | Met | `tests/blast-radius.test.ts` asserts only `Widget` and `URLParser` remain. Red-first evidence is below. |
| AC-2: B3 git grep exit handling | Met | `tests/blast-radius.test.ts` asserts status 1 returns `[]` and an empty-stderr status 2 throws. Red-first evidence is below. |
| AC-3: B4 telemetry exclusion | Met | `tests/blast-radius.test.ts` verifies a lessons-log reference does not appear. Red-first evidence is below. |
| AC-4: B5 fail-open positive control | Met | The existing fail-open test now asserts its shim pass-through yields a non-empty block; the targeted test passed. |
| AC-5: S1 self-check evidence | Met | `tests/run-task-validation.test.ts` rejects both wrapped forms and `N/A — <reason>`, and accepts `N/A — no tests changed` and real evidence. Red-first evidence is below. |
| AC-6: S2 validation references | Met | The live gate is named `classifyPreflightBlockers`; remaining `validateHandoff()` hits describe test parity or test cases. The `src/orchestrator/main.ts` comment names `validateHandoffAgainstSpec` and describes required validation outcomes only. |
| AC-7: P1 and P2 pitfalls | Met | `tests/pitfalls.test.ts` covers an index separator of `|-|-|` and an empty override falling back under the docs root. Red-first evidence is below. |
| AC-8: P3–P5 and P7 docs | Met | Updated the scaffold example, citation guidance, env-var row and index-table exception. `npm run docs-refs-check` and `npm run sync-templates:check` pass. |
| AC-9: P6 prompt header | Met | `tests/run-task-prompts.test.ts` asserts the exact `- Relevant files: none (spec has no Affected Files table)` line. |

## Edge Cases Considered

- The token stoplist is exact and case-sensitive; valid component identifiers remain searchable.
- `gitGrep` preserves the existing overflow behavior while treating exit 1 as no matches and other child exit statuses as errors.
- Telemetry exclusion is applied through the shared path filter used for both reference and identifier matches.
- Placeholder detection runs after stripping Markdown emphasis/code markup; a real N/A reason and ordinary evidence remain accepted.
- The empty override is evaluated at call time and falls back through `CANON_PITFALLS_DOCS_ROOT` to `docs/patterns.md`.

## Blockers

- None.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-1 | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/blast-radius.test.ts tests/run-task-validation.test.ts tests/pitfalls.test.ts tests/run-task-prompts.test.ts` | `0e6203c655bb99a07a4f63bedba3e7a81d41ebc2` | Extracted `True`, `None`, `Pass`, `IDs`, and `URLs` in addition to the two intended identifiers. | Targeted suites and full `npm test` pass. |
| AC-2 | Same grouped command as AC-1 | `0e6203c655bb99a07a4f63bedba3e7a81d41ebc2` | The empty-stderr exit-2 shim did not throw; the status-1 no-match assertion already returned `[]`. | Targeted suites and full `npm test` pass. |
| AC-3 | Same grouped command as AC-1 | `0e6203c655bb99a07a4f63bedba3e7a81d41ebc2` | The map listed `docs/lessons-learned.md` for both the affected-file reference and spec identifier. | Targeted suites and full `npm test` pass. |
| AC-5 | Same grouped command as AC-1 | `0e6203c655bb99a07a4f63bedba3e7a81d41ebc2` | The bold-wrapped placeholder, code-wrapped placeholder, and copied `<reason>` cell produced no Self-Check issue. | Targeted suites and full `npm test` pass; valid N/A and real-evidence cases pass. |
| AC-7 | Grouped command as AC-1; exact P1 case: `node --test --test-name-pattern='Known Pitfalls index tables accept the' --import ./tests/md-loader-register.mjs --import tsx tests/pitfalls.test.ts` | `0e6203c655bb99a07a4f63bedba3e7a81d41ebc2` | The empty patterns override returned no selected block. The exact `|-|-|` index test also failed with no Area index. | Targeted suites and full `npm test` pass. |

## Self-Check

| Check | Evidence |
|---|---|
| Test integrity | `tests/blast-radius.test.ts` pins token output, status 1/status 2 handling, telemetry exclusion, and a non-empty shim pass-through; AC-1–3 red runs are recorded above. `tests/run-task-validation.test.ts` pins both wrapped placeholders, `<reason>`, valid N/A and real evidence; AC-5 red run is recorded above. `tests/pitfalls.test.ts` pins `|-|-|` and the empty env fallback; AC-7 red run is recorded above. `tests/run-task-prompts.test.ts` asserts the exact rendered state-header line. |
| Restatement sweep | Searched `validateHandoff()` with `git grep -n 'validateHandoff()' -- docs templates/docs src`; remaining hits in `docs/patterns.md` and `docs/product-context.md` identify test parity, and `docs/codebase-map.md` describes test cases. Checked Known Pitfalls prose-injection claims in `README.md`, `docs/codebase-map.md`, `docs/patterns.md`, `templates/docs/patterns.md`, and both canon-init write-guide copies; they account for index tables. Updated the `CANON_PITFALLS_DOCS_ROOT` row in `docs/pipeline-orchestrator.md` and its mirror. |
| Sibling parity | `checkSelfCheckEvidence()` is used by the live pre-flight classifier and `validateHandoff()`; the new rejection cases assert both agree. `excludedPath()` is shared by reference and identifier results, and the telemetry test checks both. Both the active patterns doc root and the unset/empty override paths are covered. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm test` | Pass | 2,162 passed, 0 failed, 1 skipped. |
| `npm run build` | Pass | Rebuilt `dist/orchestrator/run-task.js`; `dist/cli/index.js` had no diff. |
| `npm run docs-refs-check` | Pass | All refs OK after writing this handoff. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync after the final doc edits. |
| Targeted regression suites | Pass | `node --test --import ./tests/md-loader-register.mjs --import tsx tests/blast-radius.test.ts tests/run-task-validation.test.ts tests/pitfalls.test.ts tests/run-task-prompts.test.ts` — 418 passed. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met (see AC Coverage table above)
- [x] All applicable validation checks pass (no failures)
- [x] All deviations from plan documented with rationale
