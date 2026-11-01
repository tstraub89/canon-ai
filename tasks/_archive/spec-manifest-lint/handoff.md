# Implementation Handoff: spec-manifest-lint

> Author: Codex | Spec: `tasks/spec-manifest-lint/spec.md` | Plan: `tasks/spec-manifest-lint/plan.md`
> Current state: reroute 1, implementing the operator's Amendment. This report supersedes the earlier handoff narrative and retains all prior red-first evidence.

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/markdown-table.ts` | Shared manifest visibility, heading, and raw table-block scan; preserve full cells for lint while retaining consumer column mapping. Exclude actual comments and fences, preserving literal comment examples in inline code; expose open-construct kind and opening line at EOF. |
| `src/orchestrator/validation.ts` | Eight-kind manifest lint requiring a nonempty Design manifest, shared-scan consumer, task-aware reader, issue formatter, pre-flights, and spec-done gate. |
| `src/orchestrator/main.ts` | Forward force to plan entry and return lint issues from spec evidence recovery without throwing. |
| `src/orchestrator/phases/plan.ts` | Check every task before any plan agent or in-progress transition; block or warn under force. |
| `src/orchestrator/phases/implement.ts` | Check every task before agents, scaffold commits, branch setup, or review-loop handling. |
| `src/orchestrator/cli.ts` | Include manifest pre-flights in force help. |
| `src/orchestrator/prompts/index.ts` | Canonical exported manifest contract and spec self-check. |
| `src/orchestrator/prompts/templates/spec-revision.md` | Restate the manifest contract for revisions. |
| `tests/markdown-table.test.ts` | Scanner visibility, raw extra cells, section boundaries, comment-example regressions, and unclosed-construct metadata. |
| `tests/run-task-validation.test.ts` | Original and amendment lint/gate coverage, all eight issue kinds, valid grammar, bypasses, red-first unclosed-block tests, and adopter-safe diagnostics. |
| `tests/run-task-safety.test.ts` | Evidence recovery, both phase entries including missing manifests, force, valid fixture manifests, resume, worktree-only state writes, bundles, and main-dispatch wiring. |
| `tests/run-task-reroute-preflight.test.ts` | Fast-tier reroute reads the malformed amendment from the active worktree. |
| `tests/run-task-prompts.test.ts` | Pin the contract across authoring surfaces including the foreman, and validate the rendered full-send example row with the shared lint/scan. |
| `tests/run-task-prompts.golden.json` | Regenerated original spec/revision snapshots and the amended full-send foreman snapshot. |
| `.canon/templates/spec.md`, `templates/.canon/templates/spec.md` | Contract beneath Affected Files and in the author checklist; generated mirror synced. |
| `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md` | Author self-check contract and generated mirror. |
| `.claude/skills/canon-spec-review/SKILL.md`, `templates/.claude/skills/canon-spec-review/SKILL.md` | Narrow structural item 3 to scope completeness; explain format enforcement. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Gate, recovery, pre-flights, bypasses, full-send interaction, required Design manifest, and unclosed-block errors; mirror synced. |
| `docs/codebase-map.md` | Index shared scanner and lint entry points. |
| `docs/lessons-learned.md` | Remove the now-mechanized fused-row lesson. |
| `docs/BACKLOG.md` | Mark the Affected Files shift-left half complete; retain the docs-reference half. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt tracked bundles. |
| `tasks/spec-manifest-lint/notes.md`, `tasks/spec-manifest-lint/handoff.md`, `tasks/spec-manifest-lint/status.json` | Implementation observations, evidence, and phase bookkeeping through the task helper. |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Shared manifest contract and a valid two-column example for full-send amendments. |
| `tests/task-cli.test.ts` | Supply a canonical Design manifest in the managed-worktree spec-done fixture; preserve the routing assertions and main-checkout decoy. |
| `tasks/spec-manifest-lint/done.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/lessons.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/metrics.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/plan.md` | Operator amendment and reroute planning/review artifact; retained as task inputs. |
| `tasks/spec-manifest-lint/pr-body.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/quality-log.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/review-cold-codex-run-1.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/review-cold-codex-run-2.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/review-cold-codex-run-3.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/review-cold-codex.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/review-prior-1.md` | Archived pre-reroute reviews; final round approved with nits and no blocking findings. |
| `tasks/spec-manifest-lint/review.md` | Prior pipeline, review, QA, or telemetry artifact retained; no implementation edits beyond the recorded task work. |
| `tasks/spec-manifest-lint/spec-review.md` | Operator amendment and reroute planning/review artifact; retained as task inputs. |
| `tasks/spec-manifest-lint/spec.md` | Operator amendment and reroute planning/review artifact; retained as task inputs. |

## Canon Governance

Authoritative provenance remains in the canon object of `tasks/spec-manifest-lint/status.json`.

| Field | Source |
|---|---|
| Upstream repo | status.json.canon.upstream_repo |
| Upstream commit | status.json.canon.upstream_commit |
| Orchestrator commit | status.json.canon.orchestrator_commit |
| Codex CLI | status.json.canon.codex_cli |
| Claude Code | status.json.canon.claude_code |

## Intent & Rationale

The original implementation remains: lint and all manifest consumers share the same visible headings and raw table blocks; path cells reuse the existing parser. Fenced/commented examples are excluded, with guards for inline code, complete short comments, and literal unclosed mid-cell markers. Lint rejects malformed rows/headings and runs at spec done, evidence recovery, and plan/implement entry. Pre-flights check all bundle members in their active task checkout before agents start. Force warns and bypasses the pre-flights; the existing env bypass applies to spec done.

The amendment supersedes no-table acceptance. A spec now requires a nonempty exact Affected Files table under a recognized Design section; optional behavioral Amendment sections may omit a table. The scan exposes the kind and opening line of a construct still open at EOF without changing what it hides. Lint reports that root cause before a missing-manifest issue when the open construct hides Design. The same gate callers enforce both new kinds without additional routing changes.

Full-send amendment guidance now carries the canonical contract verbatim and a two-column example. The rendered example is linted in a valid Design-plus-Amendment spec and checked for path extraction. Only the full-send out-of-scope golden changed in this reroute. Docs and their generated mirror state both new requirements.

The archived review in `tasks/spec-manifest-lint/review-prior-1.md` ends at Round 3, approved with nits and no unresolved blocking finding. Earlier correctness fixes remain in place. The amendment resolves its unclosed-block and foreman-contract follow-ups. The updated Amendment Affected Files table also authorizes the task-CLI fixture correction, resolving the earlier cap conflict. Only its worktree-side filled spec changed; its routing assertions and supervising-checkout decoy remain intact. Other optional follow-ups remain outside this reroute's scope.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Track one open-construct record alongside existing fence/comment state. | The scan permits only one active construct. Updating the record at open/close avoids separate opener-location fields and keeps hiding unchanged. | AC-A2 met; opening-line and reset cases tested. |
| Preserve the earlier non-manifest scanners. | The manifest scanner is shared by lint and consumers; refactoring review/handoff scanners would expand behavioral risk. | Original AC-6/AC-8 behavior retained. |
| Reject every duplicate exact heading, including an empty duplicate. | Original AC-5 has no table-presence predicate. | Original AC-5 retained. |
| Copy the contract verbatim into the foreman template. | Matches the existing revision-template pattern; the carrier test detects drift. No additional prompt-builder field is needed. | AC-A3 met without another runtime abstraction. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Fused backticked extras rejected with row/section and literal-pipe escape guidance; prose extras and escaped pipes pass. |
| AC-2 | Met | Missing separators and split/singleton blocks rejected. |
| AC-3 | Met | Existing cell parser reasons retained, including partial per-path failures; valid comma/directory grammar preserved. |
| AC-4 | Met | Ignored heading cases and underscore emphasis flagged; Unaffected Files accepted when a valid Design manifest is present. |
| AC-5 | Met | Duplicates rejected within each H2; separate Design/Amendment tables coexist. |
| AC-6 | Met | Original red-first regressions remain green; real fenced/commented content excluded and prior over-hiding fixes retained. |
| AC-7 | Met | Empty-first-column errors remain gated on backticked tokens in other cells. |
| AC-8 | Met (amended) | No-table acceptance is explicitly superseded by AC-A1. Other valid shapes and static task-scope fixture pass; archive consumer paths unchanged. The worktree CLI fixture now also supplies the required Design manifest. |
| AC-9 | Met | Missing manifests and other issues hard-fail spec completion with fix guidance; override/env bypass coverage retained. |
| AC-10 | Met | Evidence recovery returns issues without throwing or marking the spec done. |
| AC-11 | Met | Both entry handlers block missing manifests before agents; force, clean input, resume, bundles, and active-checkout behavior remain covered. |
| AC-12 | Met | All eight kinds, including fence/comment unclosed variants, checked for internal implementation names in formatted gate/pre-flight output. |
| AC-13 | Met | Original contract carriers, review completeness guidance, help, docs, mirrors, and snapshots retained; foreman is now an additional pinned carrier. |
| AC-14 | Met | Mechanized lesson removal and backlog done/open split retained. |
| AC-15 | Met | All 127 archived specs recalibrated; counts and samples below. |
| AC-A1 | Met | Missing Design, missing exact heading/table, and empty table fail; a valid Design with table-less Amendment passes. Gate and both phase-entry cases tested. |
| AC-A2 | Met | Unclosed fences/comments report construct and 1-based opening line; both required cases ran red first; closed/literal/short-comment controls pass. |
| AC-A3 | Met | Rendered foreman contains the contract and a lint-valid example row that extracts its path; golden regenerated. |
| AC-A4 | Met | Docs/mirror require Design scope and reject unclosed constructs. Obsolete no-table-valid sentence has zero matches under docs, templates, and source. |
| AC-A5 | Met | Missing-manifest count 3, each classified below; unclosed-block count 0; archives untouched. |

## Edge Cases Considered

- A header-only table does not establish scope; a readable data row is required. A malformed row still receives its own existing issue.
- An unclosed construct before Design reports both its root cause and missing scope, in that order. A trailing unclosed comment after valid scope reports only the unclosed issue.
- Existing literal mid-cell comment markers remain literal. Fully closed examples and complete short comments report no open state.
- Design-before-Amendment consumer ordering and first-exact-heading semantics are unchanged.
- Missing-manifest tests provide valid context for unrelated heading/prose cases. Resume tests restore an actual manifest; the bundle leader also has valid scope.

## Blockers

No execution blockers remain. The earlier fixture scope blocker is resolved by the updated amendment and the now-passing worktree CLI test.

- **[ambiguity] Empty-manifest interpretation.** The amendment does not explicitly define a header-only table. Following the reroute plan, required scope means at least one data row under the first exact Affected Files heading in at least one recognized Design section. Tests pin empty tables as missing and behavioral Amendment sections as optional.

## Red-First Evidence

Rows from all earlier rounds are carried forward unchanged below. They describe historical pre-fix runs; this reroute did not repeat them. New amendment rows ran against committed HEAD 2f7889cc02c9ad08ea4910eda99ba67c3c04cf84 before any production edits. Initial dirt was task-artifact input/state only, with no aborted production edits to set aside.

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-6 fenced displacement | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='AC-6 manifest' tests/run-task-validation.test.ts` | a4b4174ecb96123db1756311c7c97a79db1a6d51 | Expected ['real.ts']; received ['example.ts']. Assertion failed. | Pass: exactly ['real.ts']. |
| AC-6 commented table | Same command as preceding row | a4b4174ecb96123db1756311c7c97a79db1a6d51 | Expected ['real.ts']; received ['real.ts', 'old.ts']. Assertion failed. | Pass: exactly ['real.ts']. |
| AC-6 / AC-8 — C2 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='revision [CR]' tests/run-task-validation.test.ts` | 34470c8b46c102d6458d0a8604e134aebbd64e59 | Each of three inline/invalid backtick opener cases returned [] instead of ['a.ts']. | All three pass; exactly ['a.ts']; lint clean. |
| AC-6 / AC-8 — C3 | Same command as preceding row | 34470c8b46c102d6458d0a8604e134aebbd64e59 | Unclosed mid-cell marker returned ['a.ts'] instead of ['a.ts', 'b.ts', 'c.ts']; the amendment was hidden. | Pass: all three paths returned; real block/closed-inline control also passes. |
| AC-1 — R1 | Same command as preceding row | 34470c8b46c102d6458d0a8604e134aebbd64e59 | The fused-cell message lacked the required backslash-pipe escape. | Pass: escape and literal-pipe explanation present. |
| AC-4 — R2 | Same command as preceding row | 34470c8b46c102d6458d0a8604e134aebbd64e59 | Unaffected Files incorrectly returned an ignored-heading issue. | Pass: no issue; Tests for affected files still rejected. |
| AC-8 — C1 | Selected valid-grammar test with a filesystem read interceptor simulating an archived live spec | 34470c8b46c102d6458d0a8604e134aebbd64e59 | The original test from git show HEAD, loaded from a scratch copy with only import locations rewritten, threw ENOENT at its live artifact read. | The revised test passes under the same interceptor. |
| AC-4 — N1 | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='round 2 N' tests/run-task-validation.test.ts` | 286ca9fe14e92c7ab3df9ada177bb0572e07d69f | Both underscore-emphasized headings returned zero issues instead of one ignored-heading issue. | Both pass; Unaffected Files remains valid. |
| AC-6 / AC-8 — N2 | Same command as preceding row | 286ca9fe14e92c7ab3df9ada177bb0572e07d69f | Each complete short comment returned [] instead of ['a.ts'] for the following live table. | Both pass: ['a.ts'] and clean lint. |
| AC-6 — N3 mutation | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='revision C3: real block' tests/run-task-validation.test.ts` | 286ca9fe14e92c7ab3df9ada177bb0572e07d69f with only inline-comment stripping disabled | Strengthened test failed: expected no lint issues, received fused-cells for row 1. | Pass with stripping restored; included in final full suite. |
| AC-A2 unclosed fence before Design | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='amendment AC-A2 red-first' tests/run-task-validation.test.ts` | 2f7889cc02c9ad08ea4910eda99ba67c3c04cf84 | Expected unclosed-block then missing-manifest; received []. | Pass: fence opening line 1 and both issues reported. |
| AC-A2 trailing unclosed comment | Same command as preceding row | 2f7889cc02c9ad08ea4910eda99ba67c3c04cf84 | Expected exactly one unclosed-block; received []. | Pass: exactly one comment issue at its opening line after live scope. |

Current mutation checks also failed as intended: removing missing-manifest emission breaks AC-A1; forcing open metadata to null breaks both AC-A2 tests (the trailing-comment case cannot pass through missing-manifest); removing the foreman contract breaks AC-A3. Each temporary mutation was restored. Prior gate/wiring mutations and the observable-inline-comment mutation remain recorded by the carried evidence and archived review.

## Archive Calibration

Scanned all **127** archived specs: **15 distinct specs flagged**. Counts are specs per kind and overlap. The prior six-kind counts remain unchanged; all 127 consumer path arrays also match pre-amendment HEAD.

| Issue kind | Specs flagged |
|---|---|
| fused-cells | 3 |
| header-less-block | 0 |
| malformed-path | 4 |
| empty-first-cell | 0 |
| ignored-heading | 9 |
| duplicate-heading | 0 |
| missing-manifest | 3 |
| unclosed-block | 0 |

Every hit of the new kinds is classified here:

| Kind | Spec | Classification |
|---|---|---|
| missing-manifest | `tasks/_archive/add-ci/spec.md`:129 | Real defect: standalone H2 Affected Files, with no Design manifest read by consumers. |
| missing-manifest | `tasks/_archive/adopt-eslint/spec.md`:138 | Real defect: same pre-convention standalone H2 table, with no Design manifest. |
| missing-manifest | `tasks/_archive/fix-pipeline-bugs/spec.md`:46 | Real defect: standalone H2 scope table and no Design manifest. |
| unclosed-block | No hits | No classification needed; no archived specs edited. |

Original sampled hits, retained with their concrete scope/content-loss distinctions:

| Kind | Sample | Classification and concrete loss |
|---|---|---|
| fused-cells | `tasks/_archive/parser-cwd-worktree-mode/spec.md`:138 | Real silent table-content loss: unescaped logical OR splits Change code into six cells against a two-cell header; later backticked code/path mentions are discarded. Column-1 scope path survives. |
| fused-cells | `tasks/_archive/runtime-validation-phase/spec.md`:197 | Real silent table-content loss: logical OR splits Change code into four cells; trailing backticked expressions are discarded. Column-1 scope path survives. |
| fused-cells | `tasks/_archive/scope-pr-auto-commit-to-affected-files-v2/spec.md`:83 | Real silent table-content loss: logical OR splits Change code into four cells; later backticked content is discarded. Column-1 scope path survives. |
| malformed-path | `tasks/_archive/codex-code-review-phase/spec.md`:148 | Real scope loss: slash-separated backticked file tokens structurally reject the whole first cell. The same shape occurs on rows 149–151. |
| malformed-path | `tasks/_archive/full-send-mode/spec.md`:164 | Real scope loss: prose identifies a prompt source without a path token. Dispatcher and reroute test rows at 167–168 have the same defect. |
| malformed-path | `tasks/_archive/runtime-validation-phase/spec.md`:198 | Real scope loss: plus-separated tokens structurally reject both paths; row 205 uses another unsupported join. |
| ignored-heading | `tasks/_archive/add-ci/spec.md`:129 | Real scope loss: H2 Affected Files is outside the accepted Design/Amendment H3 structure, so its table is never read. |
| ignored-heading | `tasks/_archive/adopt-eslint/spec.md`:138 | Real scope loss: same standalone H2 defect; table paths are not read. |
| ignored-heading | `tasks/_archive/docs-refs-adopter-config/spec.md`:179 | Real ignored-table defect: suffixed amendment heading is not read. Its note says these paths are already in Design, so this sample loses the amendment table without shrinking the union of paths. |

The original comment-example false positive in `tasks/_archive/canon-docs-dedup/spec.md` remains fixed: literal markers inside inline code do not hide its row. Earlier review accepted classifying the fused-cell samples as table-content truncation even when their column-1 scope paths survive. No new false positive was observed.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint succeeded. |
| `npm run type-check` | Pass | TypeScript succeeded. |
| `npm test` | Pass | Final full suite: 1,925 tests, 1,924 passed, zero failed, 1 existing sandbox skip. The formerly failing managed-worktree fixture now passes. |
| `npm run build` | Pass | Both tracked bundles rebuilt. |
| `npm run sync-templates:check` | Pass | Root docs and generated mirror aligned. |
| `npm run docs-refs-check` | Pass | References verified, including a final run after writing this handoff. |
| Scoped parser and validation tests | Pass | 279 tests passed in the amendment pass; coverage also passed in the final full suite. |
| Managed-worktree task CLI fixture | Pass | The selected test reproduced missing-manifest rejection before its fixture correction and passes afterward with all original routing assertions. |
| Scoped phase-entry and worktree tests | Pass | 10 tests passed, including new missing-manifest blocks before both agents and corrected resume fixtures. |
| Prompt snapshots and foreman example | Pass | 70 tests passed with regenerated golden; normal assertions also passed in the full suite. Only the full-send out-of-scope golden changed this reroute. |
| New mutation checks | Pass | Missing manifest, unclosed metadata, and foreman-contract mutations all fail their targeted tests; source restored. |
| Archive calibration and consumer differential | Pass | 127 specs; per-kind counts/classifications above; zero consumer path-array differences. |
| Scope and handoff coverage | Pass | Every branch/dirty/untracked task path is listed; no source edit outside the Affected Files union. Whitespace check passed. |

The earlier deterministic contract/fixture failure is resolved by the now-authorized fixture correction. All required checks were rerun and pass. E2E remains explicitly inapplicable per the spec. The one existing suite skip is the restricted-git linked-worktree test; fish-dependent subchecks also report fish unavailable.

## Ready for Review

- [x] Original and amendment behavior implemented within the authorized cap
- [x] All required validation checks pass
- [x] Prior and new red-first evidence retained
- [x] Deviations and the resolved scope issue documented
