# Implementation Handoff: configurable-docs-freshness

> Author: Codex | Spec: `tasks/configurable-docs-freshness/spec.md` | Plan: `tasks/configurable-docs-freshness/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/docs-freshness.ts` | New: loader and validator for `.canon/config.json`; pure resolver (protected / admitted / configured / QA prompt editable + flagged sets); default-protected constant; dot-aware glob matching |
| `src/orchestrator/worktree.ts` | Remove `PIPELINE_MANAGED_DOCS`; remove or rework `PIPELINE_SHARED_DOCS` |
| `src/orchestrator/main.ts` | `commitQaArtifacts`, `commitHumanReviewFiles` (incl. the Affected-Files filter), the full-send scope check, `classifyAndPreserveSharedDocDirt` read the resolver; run-start config validation and unknown-key warning in `main()` before heartbeat/ship/reroute; abort/warning text |
| `src/orchestrator/validation.ts` | `buildAffectedFilesAllowlist` admits a caller-supplied doc set; `verifyBaseDrift` passes the admitted set at QA-done; shared-doc dirt helpers take the configured set |
| `src/orchestrator/phases/code-review.ts` | Pre-flight scope check admits the admitted set |
| `src/orchestrator/phases/qa.ts` | Compute the filtered diff and QA prompt sets; pass to `promptQa`; probe-failure warning |
| `src/orchestrator/phases/spec.ts` | Pass the configured `paths` map to `promptSpec` / `promptSpecRevision` |
| `src/orchestrator/prompts/index.ts` | `promptQa`, `promptSpec`, `promptSpecRevision` accept and render the doc lists / map |
| `src/orchestrator/prompts/templates/qa.md` | Docs freshness bullet renders the resolved list; empty-set wording; conditional `## Docs drift` instruction |
| `src/orchestrator/prompts/templates/spec.md` | Conditional docs-map block |
| `src/orchestrator/prompts/templates/spec-revision.md` | Conditional docs-map block |
| `src/orchestrator/cli.ts` | Allow-list help text |
| `src/cli/index.ts` | Allow-list help text |
| `src/cli/commands/doctor.ts` | New docs-freshness check in the Config section |
| `.canon/templates/spec.md` | Docs Impact and Affected Files guidance wording |
| `templates/.canon/templates/spec.md` | Synced mirror |
| `.canon/README.md` | Carve out `config.json` as adopter-owned |
| `templates/.canon/README.md` | Synced mirror |
| `.claude/skills/canon-spec/SKILL.md` | Phase 1: read the docs-freshness config if present |
| `templates/.claude/skills/canon-spec/SKILL.md` | Synced mirror |
| `.canon/config.json` | New: canon-ai dogfood config |
| `docs/pipeline-orchestrator.md` | Allow-list, code_review pre-flight and `--ship` dirt paragraphs |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror |
| `README.md` | "Configuring docs freshness" subsection |
| `docs/BACKLOG.md` | `.canon/config.json` entry: shipped slice, field-name reconciliation |
| `docs/codebase-map.md` | New module; qa.md Docs Freshness line |
| `docs/patterns.md` | QA-done widening references |
| `dist/cli/index.js` | Rebuilt via `npm run build` |
| `dist/orchestrator/run-task.js` | Rebuilt via `npm run build` |
| `tests/docs-freshness.test.ts` | New: resolver and loader tables (AC-1, AC-2, AC-4 loader half) |
| `tests/run-task-ship.test.ts` | Run-start refusal (AC-3); `--ship` classification (AC-6) |
| `tests/run-task-safety.test.ts` | QA-end and human-review admission tests (AC-4, AC-6, AC-7) |
| `tests/run-task-validation.test.ts` | `buildAffectedFilesAllowlist` / `verifyBaseDrift` / pre-flight tests (AC-6) |
| `tests/run-task-prompts.test.ts` | QA and spec prompt tests (AC-5, AC-8) |
| `tests/run-task-prompts.golden.json` | Regenerated goldens |
| `tests/cli.test.ts` | Doctor check, upgrade preservation, init non-scaffold (AC-9, AC-10) |
| `tests/docs-refs-check.test.ts` | Shipped-markdown fixture without a config (AC-12) |

## Canon Governance

The authoritative provenance stamp is in status.json.canon; no separate stamp was created.

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

One loader validates the adopter-owned docs-freshness config, and one pure resolver computes protected, admitted, configured, editable, and flagged sets. Commit admission is config-only, so mapped QA edits survive reroutes even when a later diff no longer matches their glob. QA's instructions use the rename-aware committed diff to select mapped docs, while excluding telemetry and task artifacts. Existing admission timing and verdict/recovery routing remain in place.

Every invocation validates before heartbeat, lock, status, reroute, or ship actions. Consumers reload the active config rather than caching it; ship reads the supervising checkout's copy. Doctor reports source/counts and configuration problems. Canon-ai opts into its existing six-doc set; adopters default to five. No dependencies, ownership registry entries, or task-state schema fields changed.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Startup uses the existing orphan-state probe and getActiveCwd with missing-worktree tolerance, instead of calling resolveTaskCwd directly. | The direct call broke the existing completed-task PR-body recovery fixture when its directory existed without task status. The selected root still matches the consumer; main/worktree source pairs and the existing recovery test pass. | Preserves AC-3 and existing recovery behavior. |
| Normalize equivalent repo-relative doc spellings before set operations and overlap checks. | Leading ./ is not prohibited for doc values, yet literal comparison would strand such edits or let aliases evade flag-only/telemetry rules. See the ambiguity below. | Adds coverage without rejecting a documented valid doc value. |
| Spec-template guidance lists docs in Affected Files only when implementation should edit them. | The plan's suggested sentence still required rows for predicted QA-only edits. The binding Decision instead separates Docs Impact from implementation scope, and QA admission is already config-only. | Aligns AC-8 with the Decision. |
| Glob expressions are compiled at call time rather than cached. Doctor uses a real git probe in tests instead of an injectable listTracked parameter. | Small configurations do not justify extra state or a second probe seam; real temp-git fixtures exercise the production behavior. | No semantic or coverage change. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | Resolver tables cover defaults, replacement/empty protection, diff-independent admission, matching/nonmatching globs, dot paths, filtered pipeline paths, deduplication, and all flag-only positions. |
| AC-2 | Met | Loader tests cover each malformed category, telemetry in each list, task artifacts, absent/empty/unknown-only configs, unknown-key warnings, and unreadable files. |
| AC-3 | Met | In-process main harness refuses plain, ship, reroute, dry-run, PR, push, and full-send before status/runtime writes. Main/worktree source pairs cover ship and dry-run; unknown keys warn once and proceed. |
| AC-4 | Met | Independent consumers reload malformed config after module import: QA prompt, QA-end commit, human-review commit, and ship classification stop with the loader diagnostic. |
| AC-5 | Met | QA renders editable/flagged sets, matching mappings, empty wording, optional Docs drift, and protected-only fallback with a failure warning. QA goldens regenerated; Two-checkpoint relocation check passes. |
| AC-6 | Met | Admission/timing tables cover QA-end, human-review, and base drift. The shared pre-flight/full-send allowlist test covers mapped-doc reroute persistence, flag-only rejection, and explicit/default pipeline reference treatment. Ship mapped and flag-only dirt aborts; existing telemetry preservation tests pass. |
| AC-7 | Met | Retired managed-doc constant has zero matches across the specified source/test/docs/template surfaces. Both help renderers and affected diagnostics describe configured/admitted docs. |
| AC-8 | Met | Both spec builders render mapped-doc instructions with new goldens; original no-map goldens were verified unchanged before regeneration. Root/mirror spec guidance and canon-spec context instruction updated. |
| AC-9 | Met | Doctor tests cover source/counts, malformed config, unknown keys, missing docs, and unmatched tracked-file globs. Config section includes the new check. |
| AC-10 | Met | Ownership/template assertions, real init CLI non-scaffold check, and upgrade byte-preservation/no-config-refusal check pass. |
| AC-11 | Met | Dogfood config contains all six docs. Built CLI doctor prints a passing Docs freshness line: 6 protected, 0 mappings, 0 flag-only. |
| AC-12 | Met | Ownership README, getting-started schema, admission/prompt/ship reference paragraphs, backlog, codebase map, and patterns updated. Shipped adopter fixture without config/example docs passes and its missing-reference negative control detects a finding. Mirrors synced; docs gates pass. |

## Edge Cases Considered

- Missing config, an empty object, and an absent docs_freshness field retain default semantics; an explicit empty protected array replaces them.
- Dotfiles and dot-directories match wildcards; task artifacts and all three telemetry files are excluded before diff matching.
- A flag-only doc outside protected/mapped docs is configured for ship classification but is never selected for QA merely by flag_only.
- Mapped admission persists independently of a later round's diff, while QA prompt selection remains diff-dependent.
- Unreadable or malformed config never silently falls back, including consumer reloads and ship/reroute entry.
- Unknown keys warn without failing; missing configured docs and unmatched globs warn in doctor.
- No-map spec prompts remain byte-identical to their previous goldens. Protected-doc edits remain dirty in this worktree and all four generated mirrors are declared above.

## Blockers

- [ambiguity] Should a doc value beginning with ./ be rejected? The spec explicitly rejects that prefix for glob keys but omits it from the exhaustive invalid-doc list. Chose to accept and normalize equivalent repo-relative doc spellings, including separator normalization, before admission and flag-only subtraction. Telemetry/task-artifact aliases remain invalid. Tests pin the interpretation. No functional work is blocked.
- No out-of-scope edits were needed. The optional decisions-doc entry mentioned in Docs Impact is not in Affected Files and was left for QA under canon-ai's protected set.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final run clean; no lint suppressions added. |
| `npm run type-check` | Pass | Final run clean. |
| `npm test` | Pass | Final full suite: 1,432 tests, 1,431 passed, one skipped, zero failures. |
| `npm run build` | Pass | Completed before the final full suite; both declared dist artifacts rebuilt and normalized. |
| `npm run docs-refs-check` | Pass | All refs OK; rechecked after writing phase artifacts. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync after root-to-template sync. |
| No-map spec golden comparison | Pass | Ran the original promptSpec and promptSpecRevision golden tests before regeneration: both passed. Only QA golden values changed; two mapped-spec keys added. |
| Final scoped source/fixture checks | Pass | Nine checks passed covering both source-selection pairs, ship consumer reload/classification, equivalent doc spelling, and the shipped adopter fixture. |
| Built CLI doctor docs-freshness line | Pass | Reports .canon/config.json: 6 protected, 0 mappings, 0 flag-only. This records the docs-freshness line, not unrelated doctor checks. |
| Scope and whitespace audit | Pass | All 37 changed non-task files exactly match the 37 Affected Files rows; git diff --check clean. |

No red-first checkpoint was specified: this is a feature task. Initial validation caught the startup recovery regression and two test-fixture mistakes (void git helper return value and temp-dir tsx resolution); these were corrected before the passing final runs. E2E is explicitly not applicable in the spec because there is no UI surface.

## Ready for Review

- [x] All spec ACs met (see AC Coverage above)
- [x] All applicable validation checks pass
- [x] All deviations from plan documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/main.ts` | Decode git-quoted porcelain paths in the ship shared-doc guard using the existing normalizer; compare NFC keys while retaining configured path spellings for filesystem and git reads. |
| `tests/run-task-ship.test.ts` | Twelve real-git regressions covering non-ASCII, quote, tab, and newline names across protected, mapped, and flag-only configured docs; assert abort and unchanged content/status. |
| `src/orchestrator/docs-freshness.ts` | Collapse consecutive globstar segments before regex construction to remove redundant backtracking. |
| `tests/docs-freshness.test.ts` | Deep matching/nonmatching globstar regression in a subprocess with a five-second deadline. |
| `README.md` | Document single-level, single-segment brace limits, file-path glob keys, and committing config before worktree-isolated tasks. |
| `.claude/skills/canon-spec/SKILL.md`, `templates/.claude/skills/canon-spec/SKILL.md` | Move the config-reading bullet into the Phase 1 context list; regenerate the mirror. |
| `src/cli/index.ts`, `src/orchestrator/cli.ts` | Wrap both allow-list help renderers across consistent lines. |
| `docs/codebase-map.md` | Distinguish the base-drift builder from the admitted-doc helper used by pre-flight and full-send. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuild both published entry points. |

### Findings addressed

- **R1-1 — correctness bug:** the ship classifier now decodes C-style git path escapes before looking up configured docs. The twelve regressions run against real git with core.quotePath=true and cover all three configured-doc classes. All abort with the shared-doc message and leave both file contents and porcelain status unchanged.
- **R1-5 — optional cleanup/nit:** README now states the one-level, single-segment brace rule, unsupported nested/slash-containing alternatives, and the need to use file-matching globs instead of trailing-slash directory keys. No additional config forms were rejected.
- **R1-6 — optional cleanup/nit:** consecutive globstars collapse to one segment; the deep-path regression finishes instead of timing out.
- **R1-12 and R1-13 — optional cleanup/nit:** relocate the skill context bullet and explain branch-checkout config visibility in the README.
- **R1-14 — optional cleanup/nit:** wrap both help renderers and correct the codebase-map helper description. The pre-existing base-drift abort-message omission remains deferred.

Remaining optional items are deferred as permitted by the review's explicit non-blocking classification and its “Required for re-review: finding 1” instruction: R1-2 retains existing phase/QA-end failure state and recovery; R1-3 retains one unknown-key warning in each detached-run stream; R1-4 retains shared-helper coverage for the unchanged call-site wiring. R1-7 would change the spec's exhaustive malformed-input contract; R1-8 keeps doctor's specified tracked-file check; R1-9 keeps the existing prompt argument contract; R1-10 preserves spec-prescribed empty-set wording; R1-11 keeps the existing AC-3 assertions. No blocking review finding remains unaddressed.

### AC deltas

| AC | Status | Notes |
|---|---|---|
| AC-6 | Met | Extend the configured-doc ship guard to real git-quoted Unicode and control-character filenames. |
| AC-1 | Met | Consecutive globstars retain matching semantics while eliminating the reported backtracking case. |
| AC-8 | Met | Context-loading instruction now sits inside the skill's required-read list. |
| AC-12 | Partial | Requested documentation corrections and mirror sync are complete. The repository-wide refs gate has an unrelated reviewer-artifact blocker below; source references have no findings. |

### Regression evidence

- Before changing the ship classifier, ran `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='ship rejects git-quoted' tests/run-task-ship.test.ts`: **12 failed**, each because classification exited **0** instead of aborting on dirty configured docs. After the fix, the same command passed all 12 cases.
- Before collapsing globstars, a 30-globstar/30-level nonmatching probe exceeded two seconds. The added `consecutive globstars` test then failed with **ETIMEDOUT** at its five-second subprocess deadline. After the fix, the complete docs-freshness test file passed all 44 tests, including that matching/nonmatching regression.

### Blockers

- **[ambiguity] Review severity:** the general revision instructions call risk/guardrail findings blocking, but Round 1 explicitly marks findings 2–4 non-blocking and names only finding 1 as required for re-review. Interpreted those three as optional under the review's stated severity; their existing fail-closed recovery, per-stream warning behavior, and shared-helper coverage remain unchanged, as recorded above.
- **[scope] Reviewer-artifact reference error:** `tasks/configurable-docs-freshness/review.md` line 30 backticks an illustrative task path that does not exist. This artifact was already dirty at revision entry, is reviewer-owned, and is outside the spec's Affected Files. It was left unchanged. Running the refs checker reports exactly this one finding and no others. The same finding aborts six PR-path tests in the full suite before they reach their intended branches. The reviewer/operator must correct that example reference before repository-wide checks can be green; the implementation fixes and affected suites are complete.

  Observed failures, all in tests/run-task-safety.test.ts, reproduce with npm test while the reviewer artifact retains that reference:

  | Test | Assertion line |
  |---|---|
  | main --pr on complete is idempotent when an open PR already exists | 4935 |
  | main --pr at human_review is idempotent when an open PR already exists | 5028 |
  | main --pr at human_review with dirty allowed files is idempotent when an open PR already exists (GP #10) | 5133 |
  | main --pr on complete still rejects dirty files outside the human_review allowlist | 5175 |
  | main full-send tail reports the PR URL after pinning pr.number | 5777 |
  | main full-send tail fails closed when draft PR creation fails | 6610 |

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | No lint suppressions added. |
| `npm run type-check` | Pass | Clean. |
| `npm test` | Fail – unrelated | 1,445 tests: 1,438 passed, six failed, one skipped. All six failures are downstream of the out-of-scope reference error in tasks/configurable-docs-freshness/review.md:30. |
| `npm run build` | Pass | Both declared bundles rebuilt before running tests. |
| `npm run docs-refs-check` | Fail – unrelated | Exactly one missing-reference finding in tasks/configurable-docs-freshness/review.md:30, outside the Affected Files and implement artifact ownership. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| Complete affected suites | Pass | Native test runner with the standard two imports, scoped to the docs-freshness and ship test files: 101/101 passed. |
| Reference scan outside reviewer error | Pass | Same runChecks scanner, explicitly reporting the one reviewer-artifact finding separately: zero other findings. This does not replace the failed repository-wide check above. |
| Scope and whitespace audit | Pass | All 37 cumulative committed paths are covered by Changes tables. All 12 source files edited this round are within Affected Files; git diff --check is clean. |

E2E remains explicitly not applicable in the spec; no UI surface changed.
