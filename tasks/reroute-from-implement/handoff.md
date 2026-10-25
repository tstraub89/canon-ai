# Implementation Handoff: reroute-from-implement

> Author: Codex | Spec: `tasks/reroute-from-implement/spec.md` | Plan: `tasks/reroute-from-implement/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/state.ts` | Shared admission predicate, finite positive counters, and legacy review-round fallback shared with banner rendering. |
| `src/orchestrator/main.ts` | Uses the predicate; renders implement/code_review sub-states and singular/plural activity details, with missing review phases explicitly labelled missing. |
| `src/task/index.ts` | Spec-gate note uses the shared predicate and full rule, including the review-round/pre-flight qualifier. |
| `src/orchestrator/review-loop.ts` | Loop-cap reason offers spec amendment plus reroute alongside reset-code-review. |
| `src/orchestrator/cli.ts` | Run help describes the full admission predicate and review-round/pre-flight qualifier. |
| `src/orchestrator/context.ts` | Reroute state header uses phase-neutral wording. |
| `src/orchestrator/prompts/index.ts` | Human-decision framing, session-specific non-resumed preamble, conditional handoff grounding, and Round Scope feasibility pointer. |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Complete-or-partial scope, unfinished earlier work, accurate tracked/untracked leftover guidance, obsolete-leftover removal, and isolated red-first runs including unfinished earlier ACs. |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Plans amendment plus unfinished earlier work under Round Scope; conditions prior-handoff use on a filled artifact. |
| `src/orchestrator/prompts/templates/spec-review-reroute.md` | Phase-neutral human amendment framing. |
| `tests/run-task-reroute-preflight.test.ts` | Admission matrix with explicit entry phases, legacy fallback, malformed counter boundaries, mutation-free refusals, bundles, both-tier resets, complete banner details, and missing-review cases. |
| `tests/run-task-code-review.test.ts` | Pins both loop-cap recovery paths at implement and review entry. |
| `tests/task-cli.test.ts` | Opposite-outcome spec-gate notes for all implement-entry admit states and unstarted implementation. |
| `tests/recovery-hints.test.ts` | Updated registry formatting and real implement-entry loop-cap → printed reroute recovery fixture. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Added resumed implement-reroute golden; regenerated only permitted reroute entries; updated Round Scope and committed-HEAD assertions. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Full predicate, partial-round scope, tracked/untracked source-edit handling, and phase-specific loop-cap recovery; mirror synced from root. |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Full operator-facing predicate; mirror synced from root. |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Two recovery paths for spec_review blocks, three for code_review blocks; synced from root. |
| `docs/patterns.md` | Documents aborted source edits remaining dirty, distinguishes tracked/untracked omissions, and directs removal of obsolete leftovers. |
| `docs/decisions.md` | Records reversal of the predecessor's implement-entry exclusion, legacy fallback, and rationale; removes extra blank line. |
| `README.md` | Full predicate in flags prose and command reference; admission and amendment pre-flight are separate sentences. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt bundles; second build reproduced both byte-for-byte. |
| `tasks/reroute-from-implement/handoff.md`, `tasks/reroute-from-implement/notes.md`, `tasks/reroute-from-implement/status.json` | Rewritten cumulative handoff, observations, and pipeline-owned phase progress. |
| `tasks/reroute-from-implement/spec.md`, `tasks/reroute-from-implement/plan.md`, `tasks/reroute-from-implement/spec-review.md`, `tasks/reroute-from-implement/review.md`, `tasks/reroute-from-implement/review-prior-1.md`, `tasks/reroute-from-implement/metrics.md` | Incoming human/pipeline reroute artifacts preserved; these were already dirty or untracked at this phase’s entry. |

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

Amendment round 1 adds the legacy iterations fallback consistently to admission and banner details. Guidance now distinguishes modified tracked omissions (auto-commit refusal) from unlisted untracked files (not committed or reviewed, rejected at QA-end), and preserves red-first evidence while requiring isolated committed-HEAD runs for unfinished earlier red-first ACs. Loop-cap recovery docs distinguish code_review-only reroute from spec_review recovery.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Ran the binding AC-1 loop-cap and route-back tests red-first; added the chained recovery-hint test after the fix. | The two mandatory rows reproduced the admission bug before any source edits. The additional chain verifies the real auto-block path, emitted hint, amendment, and successful reroute after implementation. | No AC omitted; red-first evidence below covers both mandated rows. |
| Admission/reset matrix runs every admitted row for both M and XS. | Broadens the requested both-tier implement-entry reset coverage to existing admitted phases too. | Additional coverage only. |
| New actionable-hint registry entry chains implement-entry recovery; existing review-entry behavior is covered by direct reason assertions and the admission matrix. | Keeps the existing code_review-entry reset chain intact while exercising the newly admitted state through its actual printed reroute. | AC-6 and AC-11 met. |
| Amendment: updated the decision’s counter description beyond the planned whitespace fix. | Its exact-field list would contradict the newly required legacy fallback; the repository requires changed contracts to stay aligned across restatements. | Keeps AC-12 consistent with AC-A6. |
| Amendment: updated the existing prompt test’s pre-fix-HEAD regex as well as its Round Scope assertions. | AC-A3 deliberately replaces the old pre-fix definition. | Verifies the new contract. |
| The plan’s proposed allowlist blocker was not carried forward. | The real parser walks Design and Amendment separately; a direct call returned both recovery-file paths without malformed cells. | No parser/spec edit or unresolved scope gap. |

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
| AC-A1 | Met | Implement prompt and both docs distinguish tracked refusal from untracked omission/QA-end rejection, and direct removal of obsolete leftovers. Spec overstatements are superseded by the amendment; the spec was not edited by this implementation. |
| AC-A2 | Met | Loop-cap docs retain cap/reset recovery for both phases and add spec-amendment/reroute only for code_review. Recovery skill has A/B for spec_review and A/B/C for code_review. Both mirrors match. |
| AC-A3 | Met | Fresh/resumed golden entries include unfinished original/earlier red-first ACs, preserve satisfied evidence, require isolated committed HEAD with leftovers set aside/restored, and retain only the spec’s named environment escape or a wrong-premise-style blocker. |
| AC-A4 | Met | Step 7 includes unfinished earlier work; non-resumed preamble explicitly refers to the agent session; plan shape and feasibility pointer use Round Scope without changing parsed Reroute Plan headings. |
| AC-A5 | Met | Help/note qualifiers match, README clauses are separate, and missing-code_review banner/rejection tests pass. |
| AC-A6 | Met | Shared fallback reads current-loop review rounds then legacy iterations; M/XS admit and predicate rows reproduced red-first and pass after the fix. Present zero/invalid current-loop values do not fall back. |
| AC-A7 | Met | Every admitted row has an explicit expected phase; singular/plural round and pre-flight details are asserted. Removing details causes the targeted tests to fail. |
| AC-A8 | Met | Decision heading has one blank separator; new registry entry uses quoted keys with no stray blank line. |
| AC-A9 | Met | All required checks pass; cumulative original-base golden comparison still has only the original permitted changes, and round-1 comparison changes exactly four reroute keys. |

## Edge Cases Considered

- Absent/null current-loop review-round fields fall back to legacy iterations. Present zero, string, negative, NaN, or infinite values do not fall back and provide no activity evidence. If both fields are absent there is no round evidence.
- Earlier phases reject even with stale review activity or a blocked downstream review.
- Route-back can clear the verdict while current-loop activity remains positive; admission uses that activity.
- Real loop-cap recovery leaves implement pending and code_review blocked with an empty verdict; the chained test follows the printed command successfully.
- A first interrupted implementation can leave a pristine handoff and dirty source files. Prompts require worktree grounding, preservation of completed red-first evidence, isolated pre-fix runs for unfinished red-first ACs, and complete Changes-table coverage of intended work. Obsolete leftovers should be removed.
- The pre-existing possibility of stale filled handoff evidence advancing rerouted implement remains outside scope, with code review as the backstop.

## Blockers

None. The plan’s allowlist concern was resolved by reading and invoking the current parser; both recovery files are included from the amendment table. No unresolved ambiguity or scope gap remains.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-1: implement-entry loop-cap | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='loop-cap\|route-back' tests/run-task-reroute-preflight.test.ts` | d6c00c31540646ac4d0d36b0595e0ca5a798759c, test-only edits | Expected exit 0, got 1 at the old phase gate; summary showed implement with code_review blocked and no verdict. | Both M and XS rows pass; full suite passes. |
| AC-1: route-back | Same command as preceding row | d6c00c31540646ac4d0d36b0595e0ca5a798759c, test-only edits | Expected exit 0, got 1 at the old phase gate; summary showed implement with code_review pending and no verdict despite iterations_current_loop=1. | Both M and XS rows pass; full suite passes. |
| AC-A6: legacy review-round alias | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='legacy iterations' tests/run-task-reroute-preflight.test.ts` | f17a1d5bd9fbf8a773a6fafb53ce537002d0d5a4, test-only source edits; incoming task artifacts preserved | M and XS admission rows exited 1 at the phase gate despite iterations=1; direct predicate returned false. Three expected failures before any non-test source edit. | All three pass after shared fallback; missing-review and invalid-current-field cases also pass; full suite passes. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final source/test changes pass ESLint. |
| `npm run type-check` | Pass | TypeScript no-emit check. |
| `npm test` | Pass | 1695 tests: 1694 pass, 1 skipped, 0 failures; 212.8 seconds. |
| `npm run build` | Pass | Both bundles generated; second build byte-identical. |
| `npm run sync-templates:check` | Pass | All three cumulative edited root/mirror pairs match. |
| `npm run docs-refs-check` | Pass | Passed after writing this rewritten handoff and notes. |
| Focused routing/task/recovery suites | Pass | 206 tests passed across the three amendment behavioral test files. |
| Prompt golden regeneration and verification | Pass | UPDATE_GOLDENS=1 run and subsequent ordinary run: 56 tests pass each. |
| Golden key comparison | Pass | Round-1 and original-base comparisons detailed below; only allowed reroute keys changed. |
| Banner mutation check | Pass | Removing detail clauses and restoring missing→pending made 10 tests fail; source restored byte-for-byte and all 10 passed. Full-suite code and final code are identical. |
| Wording sweep / single-predicate identifier grep | Pass | Zero prohibited non-exempt hits, zero old-set identifiers; 15 full-predicate phase-list hits classified below. |
| Generated CLI help smoke | Pass | Compiled run help shows full predicate and the review-round/pre-flight qualifier; exits 0. |
| Scope and whitespace checks | Pass | Cumulative 27 product files are within the union Affected Files; remaining changes are this task’s artifacts. git diff --check passes. |
| E2E | not_configured | Spec Validation Required explicitly marks E2E N/A: no UI surface. |

Build SHA-256 values after both identical builds:

- `dist/cli/index.js`: 882dd60c52127d2d13e59857b609c8d8a0945196199cd46b167eb7c74daf7efd
- `dist/orchestrator/run-task.js`: 881eb6cb89ce9b9f55f417ec7a157329b3f1ebd72f2fcce18920b56f3ddb0314

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
| `docs/decisions.md` new decision | Full predicate with exact state/counter fields and legacy fallback. |
| `dist/cli/index.js` and `dist/orchestrator/run-task.js` | Generated full spec-gate note and rejection message. |

Cumulative golden comparison against d6c00c31540646ac4d0d36b0595e0ca5a798759c changed only promptImplementReroute, promptSpecReview_reroute_round1, promptSpecReview_reroute_round2, promptSpecReview_reroute_bundle, promptPlan_reroute_round1, and promptPlan_reroute_bundle. The sole addition is promptImplementReroute_resumed.

### Amendment golden comparison

Against round-1 implementation e8c2d129e2b79b15fb93171fea403ddf4711e87b:

```text
added: []
removed: []
changed: ['promptImplementReroute', 'promptPlan_reroute_round1', 'promptPlan_reroute_bundle', 'promptImplementReroute_resumed']
```

Every other value is byte-identical to round 1. The amendment added no key and changed no spec-review or non-reroute key.

## Ready for Review

- [x] All spec ACs met (see AC Coverage).
- [x] All applicable validation checks pass.
- [x] All deviations from plan documented with rationale.
