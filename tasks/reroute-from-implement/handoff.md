# Implementation Handoff: reroute-from-implement

> Author: Codex | Spec: `tasks/reroute-from-implement/spec.md` | Plan: `tasks/reroute-from-implement/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/state.ts` | Shared admission predicate and finite positive current-loop counter reader. |
| `src/orchestrator/main.ts` | Uses the predicate; renders implement and code_review sub-states in banners and gate rejections. |
| `src/task/index.ts` | Spec-gate note uses the shared predicate and states the expanded rule. |
| `src/orchestrator/review-loop.ts` | Loop-cap reason offers spec amendment plus reroute alongside reset-code-review. |
| `src/orchestrator/cli.ts` | Run help describes the full admission predicate. |
| `src/orchestrator/context.ts` | Reroute state header uses phase-neutral wording. |
| `src/orchestrator/prompts/index.ts` | Updated human-decision framing, both preamble variants, heading guidance, and conditional handoff grounding. |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Complete-or-partial scope, worktree grounding, unfinished earlier work, and dirty-file handoff coverage. |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Plans amendment plus unfinished earlier work; conditions prior-handoff use on a filled artifact. |
| `src/orchestrator/prompts/templates/spec-review-reroute.md` | Phase-neutral human amendment framing. |
| `tests/run-task-reroute-preflight.test.ts` | Admission matrix, direct predicate boundaries, mutation-free refusals, bundle cases, both-tier reset assertions, and sub-state text. |
| `tests/run-task-code-review.test.ts` | Pins both loop-cap recovery paths at implement and review entry. |
| `tests/task-cli.test.ts` | Opposite-outcome spec-gate notes for all implement-entry admit states and unstarted implementation. |
| `tests/recovery-hints.test.ts` | Updated registry and real implement-entry loop-cap → printed reroute recovery fixture. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Added resumed implement-reroute golden; regenerated only permitted reroute entries. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Full predicate at each required surface, partial-round scope, and uncommitted source-edit guidance; mirror synced from root. |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Full operator-facing predicate; mirror synced from root. |
| `docs/patterns.md` | Documents aborted implementation source edits remaining dirty after reroute. |
| `docs/decisions.md` | Records reversal of the predecessor's implement-entry exclusion and its rationale. |
| `README.md` | Full predicate in flags prose and command reference. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt bundles; second build reproduced both byte-for-byte. |
| `tasks/reroute-from-implement/handoff.md`, `tasks/reroute-from-implement/notes.md`, `tasks/reroute-from-implement/status.json` | Implementation evidence, observations, and pipeline-owned phase progress. |

## Canon Governance

Provenance remains authoritative in `tasks/reroute-from-implement/status.json`.

| Field | Source |
|---|---|
| Upstream repo | `tasks/reroute-from-implement/status.json` → `canon.upstream_repo` |
| Upstream commit | `tasks/reroute-from-implement/status.json` → `canon.upstream_commit` |
| Orchestrator commit | `tasks/reroute-from-implement/status.json` → `canon.orchestrator_commit` |
| Codex CLI | `tasks/reroute-from-implement/status.json` → `canon.codex_cli` |
| Claude Code | `tasks/reroute-from-implement/status.json` → `canon.claude_code` |

## Intent & Rationale

Admit reroutes once implementation has begun, using one predicate for routing and spec-gate recovery advice. Existing reroute reset mechanics already produce the required counters, flags, and tier-specific next phase, so they were retained. Prompts now cover unfinished original and earlier-amendment work as well as the newest amendment, using actual worktree state and only filled-in handoffs as evidence.

The gate still requires every bundle member to qualify. The spec_gap exemption remains narrower: mixing a spec_gap block with implement entry requires amendments for both tasks. Live-run protection remains before reroute processing. No schema, dependency, git-operation, or auto-commit policy changes were introduced.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Ran the binding AC-1 loop-cap and route-back tests red-first; added the chained recovery-hint test after the fix. | The two mandatory rows reproduced the admission bug before any source edits. The additional chain verifies the real auto-block path, emitted hint, amendment, and successful reroute after implementation. | No AC omitted; red-first evidence below covers both mandated rows. |
| Admission/reset matrix runs every admitted row for both M and XS. | Broadens the requested both-tier implement-entry reset coverage to existing admitted phases too. | Additional coverage only. |
| New actionable-hint registry entry chains implement-entry recovery; existing review-entry behavior is covered by direct reason assertions and the admission matrix. | Keeps the existing code_review-entry reset chain intact while exercising the newly admitted state through its actual printed reroute. | AC-6 and AC-11 met. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | All five implement-entry admit states plus existing phases; zero/absent counters and earlier/complete phases reject with unchanged status and review bytes. Loop-cap and route-back reproduced red-first. |
| AC-2 | Met | Whole-bundle rejection for an unstarted sibling, admission with an in-progress implement/human_review pair, and amendment requirements on both mixed spec_gap/loop-cap members. |
| AC-3 | Met | Both callers use isRerouteAdmitted; direct predicate matrix and malformed-counter cases pass. Identifier grep finds zero old-set references in source. |
| AC-4 | Met | Explicit implement-entry loop-cap fixture is implement pending, code_review blocked, empty verdict; former fixture is labelled code_review-phase auto-block. |
| AC-5 | Met | Every admitted implement state tested for M and XS: pending/rerouted/count+1, cleared code-review verdict/counters, and derived spec_review versus implement. |
| AC-6 | Met | Banner sub-state assertions, rejected implement-pending text, full predicate refusal, and both-entry loop-cap reason assertions pass. |
| AC-7 | Met | All five implement-entry admit states emit amendment/reroute note; zero-activity pending state emits the opposite branch and full rule. |
| AC-8 | Met | All four prohibited wording searches return zero non-exempt hits; remaining phase-list statements classified below. |
| AC-9 | Met | Read regenerated implement-reroute fresh/resumed and plan reroute entries: complete-or-partial, unfinished earlier work, newest-amendment precedence, worktree diff, conditional handoff, and dirty-file coverage are present. Delta-only instructions removed. |
| AC-10 | Met | Added only promptImplementReroute_resumed; six permitted existing keys changed; every other value byte-identical to base d6c00c31540646ac4d0d36b0595e0ca5a798759c. |
| AC-11 | Met | Required help/docs/skill surfaces state the predicate; source edits remain in worktree guidance present; recovery-hint registry passes. |
| AC-12 | Met | Decision entry names the reversed Non-Goal, fake-phase workaround, real implement-entry states, and concurrent-run guard. |
| AC-13 | Met | Root/template sync passes; both generated bundles reproduce exactly on a second build. |

## Edge Cases Considered

- Absent, null, string, negative, NaN, and infinite counters cannot provide admission evidence. Legacy iterations alone is not consulted.
- Earlier phases reject even with stale review activity or a blocked downstream review.
- Route-back can clear the verdict while current-loop activity remains positive; admission uses that activity.
- Real loop-cap recovery leaves implement pending and code_review blocked with an empty verdict; the chained test follows the printed command successfully.
- A first interrupted implementation can leave a pristine handoff and dirty source files. Prompts require worktree grounding and complete Changes-table coverage.
- The pre-existing possibility of stale filled handoff evidence advancing rerouted implement remains outside scope, with code review as the backstop.

## Blockers

None. No scope gaps or unresolved ambiguities were encountered.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-1: implement-entry loop-cap | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='loop-cap\|route-back' tests/run-task-reroute-preflight.test.ts` | d6c00c31540646ac4d0d36b0595e0ca5a798759c, test-only edits | Expected exit 0, got 1 at the old phase gate; summary showed implement with code_review blocked and no verdict. | Both M and XS rows pass; full suite passes. |
| AC-1: route-back | Same command as preceding row | d6c00c31540646ac4d0d36b0595e0ca5a798759c, test-only edits | Expected exit 0, got 1 at the old phase gate; summary showed implement with code_review pending and no verdict despite iterations_current_loop=1. | Both M and XS rows pass; full suite passes. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final run passed after replacing unknown template-literal values in test assertions with explicit string conversion. |
| `npm run type-check` | Pass | TypeScript no-emit check. |
| `npm test` | Pass | Node v24.21.0: 1686 tests, 1685 pass, 1 skipped, 0 failures; 227.7 seconds. |
| `npm run build` | Pass | Both bundles generated; second build byte-identical. |
| `npm run sync-templates:check` | Pass | Two edited root/mirror pairs match; no adopter-path leaks. |
| `npm run docs-refs-check` | Pass | Passed after writing this handoff, including the source/docs/notes changes. |
| Focused routing/review/task/recovery suites | Pass | 259 tests passed across the four changed behavioral test files. |
| Prompt golden regeneration | Pass | `UPDATE_GOLDENS=1 node --test --import ./tests/md-loader-register.mjs --import tsx tests/run-task-prompts.test.ts`; 56 tests passed. |
| Golden key comparison | Pass | Compared against base d6c00c31540646ac4d0d36b0595e0ca5a798759c; exact allowed added/changed keys, no removals. |
| Wording sweep / single-predicate identifier grep | Pass | Zero prohibited non-exempt hits, zero old-set identifiers. Classifications below. |
| Generated CLI help smoke | Pass | `node dist/orchestrator/run-task.js --help` shows the full predicate and exits 0. |
| Scope and whitespace checks | Pass | All 25 product files are within Affected Files; remaining changes are this task's artifacts. `git diff --check` passes. |
| E2E | not_configured | Spec Validation Required explicitly marks E2E N/A: no UI surface. |

Build SHA-256 values after both identical builds:

- `dist/cli/index.js`: 9f7954c44c30560230b0722bf20a43a514d626ba2fe6c20f809074c15350b31b
- `dist/orchestrator/run-task.js`: fa83a408e0d4e204859bf483e9cc2a617315802579a60a549353b0afa5bc483b

### Wording sweep and phase-list classification

Ran case-insensitive extended-regex searches over source, docs, skills, templates, README, and dist, excluding the spec-permitted historical/telemetry paths. Each returned zero hits:

- `completed .?implement`
- `previously shipped|implementation shipped|complete and shipped`
- `post-review fix path`
- `admitted phase \(.?code_review.?, .?qa.?, or .?human_review.?\)`

The remaining phase-list regex produced 15 hits, all updated to the full predicate; none are a shortened admission-rule statement. Help splits the list over source lines and was read and smoke-tested separately.

| Surface | Classification |
|---|---|
| `README.md` flags prose and command-reference row | Both updated to the full predicate. |
| `src/orchestrator/main.ts` rejection | Full predicate spans the immediately joined message clauses. |
| `src/task/index.ts` spec-gate note | Updated to the full predicate. |
| `docs/pipeline-orchestrator.md` flags row, Human Reroute opening, full-tier re-entry | All three updated to the full predicate. |
| `templates/docs/pipeline-orchestrator.md` corresponding three surfaces | Generated copies of the full predicate. |
| `.claude/skills/canon-pipeline/SKILL.md` admission sentence | Updated to the full predicate. |
| `templates/.claude/skills/canon-pipeline/SKILL.md` admission sentence | Generated copy of the full predicate. |
| `docs/decisions.md` new decision | Full predicate with exact state/counter fields. |
| `dist/cli/index.js` and `dist/orchestrator/run-task.js` | Generated full spec-gate note and rejection message. |

Golden comparison changed only promptImplementReroute, promptSpecReview_reroute_round1, promptSpecReview_reroute_round2, promptSpecReview_reroute_bundle, promptPlan_reroute_round1, and promptPlan_reroute_bundle. The sole addition is promptImplementReroute_resumed.

## Ready for Review

- [x] All spec ACs met (see AC Coverage).
- [x] All applicable validation checks pass.
- [x] All deviations from plan documented with rationale.
