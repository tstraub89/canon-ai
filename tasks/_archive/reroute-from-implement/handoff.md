# Implementation Handoff: reroute-from-implement

> Author: Codex | Reroute round: 2 | Spec: `tasks/reroute-from-implement/spec.md` | Plan: `tasks/reroute-from-implement/plan.md`

## Changes

| File | What Changed |
|---|---|
| `src/orchestrator/state.ts` | Single-task admission predicate and shared review-round reader used by admission, banner, getIterations, and pipeline context; legacy/null fallback and invalid-value handling. |
| `src/orchestrator/main.ts` | Single-task and anchored shared-branch bundle admission, per-task qualification and recovery messages, unified counter consumers, reset routing, and accurate missing-phase/banner details. |
| `src/task/index.ts` | Spec-gate note uses the unchanged single-task predicate and describes the bundle exception; import sorted. |
| `src/orchestrator/review-loop.ts` | Loop-cap reason offers spec amendment plus reroute alongside reset-code-review. |
| `src/orchestrator/cli.ts` | Run help describes the single-task rule, review/pre-flight qualifier, and anchored shared-branch sibling exception. |
| `src/orchestrator/context.ts` | Reroute state header uses phase-neutral wording. |
| `src/orchestrator/prompts/index.ts` | Session-neutral reroute preamble, Round Scope pointer, conditional grounding, and newest numeric archive guidance for non-exempt implement and plan tasks, with missing-directory handling. |
| `src/orchestrator/prompts/templates/implement-reroute.md` | Complete-or-partial scope, unfinished earlier work, accurate tracked/untracked leftover guidance, obsolete-leftover removal, and isolated red-first runs including unfinished earlier ACs, with tracked copies and untracked moves confirmed before the run and every file restored afterwards. |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Plans amendment plus unfinished earlier work under Round Scope; conditions prior-handoff use on a filled artifact. |
| `src/orchestrator/prompts/templates/spec-review-reroute.md` | Phase-neutral human amendment framing. |
| `tests/run-task-reroute-preflight.test.ts` | Single-task and shared-branch admission matrices, unchanged rejection bytes, combined downstream handoff/scope checks, state-sensitive recovery, missing phases, explicit entry phases, complete reset/banner assertions, and null/invalid counter cases. |
| `tests/run-task-code-review.test.ts` | Pins both loop-cap recovery paths at implement and review entry. |
| `tests/task-cli.test.ts` | Opposite-outcome spec-gate notes for all implement-entry admit states and unstarted implementation. |
| `tests/recovery-hints.test.ts` | Updated registry formatting and real implement-entry loop-cap → printed reroute recovery fixture. |
| `tests/run-task-prompts.test.ts`, `tests/run-task-prompts.golden.json` | Resumed prompt golden, archive/no-archive assertions for both non-exempt builders, scoped reroute golden regeneration, Round Scope and committed-HEAD checks. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Full admission rule including shared-branch siblings/whole-bundle recovery, partial-round scope, leftover handling, phase-specific loop-cap recovery, and binding archived findings; mirror synced from root. |
| `.claude/skills/canon-pipeline/SKILL.md`, `templates/.claude/skills/canon-pipeline/SKILL.md` | Full predicate including same-branch approved siblings and whole-bundle recovery; heading broadened; mirror synced from root. |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Two recovery paths for spec_review blocks and three for code_review, with block-specific stale-context triggers; synced from root. |
| `docs/patterns.md` | Documents aborted source edits remaining dirty, distinguishes tracked/untracked omissions, and directs removal of obsolete leftovers. |
| `docs/decisions.md` | Records implement-entry admission, legacy/null fallback, shared-branch sibling exception, and declined marker/no-branch alternatives; whitespace corrected. |
| `README.md` | Full rule and bundle exception in both reference surfaces; admission and amendment pre-flight remain separate sentences. |
| `dist/cli/index.js`, `dist/orchestrator/run-task.js` | Rebuilt bundles; second build reproduced both byte-for-byte. |
| `tasks/reroute-from-implement/handoff.md`, `tasks/reroute-from-implement/notes.md`, `tasks/reroute-from-implement/status.json` | Rewritten cumulative handoff, observations, and pipeline-owned phase progress. |
| `tasks/reroute-from-implement/spec.md`, `tasks/reroute-from-implement/plan.md`, `tasks/reroute-from-implement/spec-review.md`, `tasks/reroute-from-implement/review.md`, `tasks/reroute-from-implement/review-prior-1.md`, `tasks/reroute-from-implement/metrics.md` | Cumulative human/pipeline artifacts preserved across reroutes; incoming spec/plan/review progress was not discarded. |
| `tasks/reroute-from-implement/review-prior-2.md`, `tasks/reroute-from-implement/review-cold-codex.md`, `tasks/reroute-from-implement/review-cold-codex-run-2.md` | Round-2 incoming review/archive artifacts preserved. |

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

Amendment round 2 keeps single-task admission unchanged and admits a pending zero-activity sibling only alongside an independently qualifying task with the same non-empty recorded branch. Every member must satisfy one of those conditions. Non-exempt plan and implement prompts now point to the highest existing review archive and preserve unresolved findings unless superseded by the amendment.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| Ran the binding AC-1 loop-cap and route-back tests red-first; added the chained recovery-hint test after the fix. | The two mandatory rows reproduced the admission bug before any source edits. The additional chain verifies the real auto-block path, emitted hint, amendment, and successful reroute after implementation. | No AC omitted; red-first evidence below covers both mandated rows. |
| Admission/reset matrix runs every admitted row for both M and XS. | Broadens the requested both-tier implement-entry reset coverage to existing admitted phases too. | Additional coverage only. |
| New actionable-hint registry entry chains implement-entry recovery; existing review-entry behavior is covered by direct reason assertions and the admission matrix. | Keeps the existing code_review-entry reset chain intact while exercising the newly admitted state through its actual printed reroute. | AC-6 and AC-11 met. |
| Amendment: updated the decision’s counter description beyond the planned whitespace fix. | Its exact-field list would contradict the newly required legacy fallback; the repository requires changed contracts to stay aligned across restatements. | Keeps AC-12 consistent with AC-A6. |
| Amendment: updated the existing prompt test’s pre-fix-HEAD regex as well as its Round Scope assertions. | AC-A3 deliberately replaces the old pre-fix definition. | Verifies the new contract. |
| The plan’s proposed allowlist blocker was not carried forward. | The real parser walks Design and Amendment separately; a direct call returned both recovery-file paths without malformed cells. | No parser/spec edit or unresolved scope gap. |
| Round 2 compares branch values exactly after rejecting blank/whitespace-only values, rather than comparing trimmed values as the plan suggested. | Shared-branch evidence should be the same persisted branch string; normalization must not equate different recorded refs. | Meets AC-B1 without widening admission. |
| Round 2 archive guidance is appended by shared per-task-line plumbing; no additional plan-template edit was needed. | Both templates already render these lines, and an unconditional archive sentence would violate the no-archive case. | AC-B4 met for both builders. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1 | Met | All five implement-entry admit states plus existing phases; zero/absent counters and earlier/complete phases reject with unchanged status and review bytes. Loop-cap and route-back reproduced red-first. |
| AC-2 | Met | Original different-branch unstarted-sibling rejection and mixed-bundle cases remain covered. AC-B1 supersedes only the blanket denial for same-branch pending siblings with a qualifying anchor. |
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
| AC-A9 | Met | All required checks pass; cumulative original-base golden comparison still has only the original permitted changes, and round-1 comparison changes exactly four reroute keys (that round’s comparison). |
| AC-B1 | Met | Shared-branch pair admits and both reset; empty, whitespace, missing/different branch, missing review, both newly rerouted without activity, and a lone task reject unchanged. Combined distinct A/B handoff/scope checks pass; B-only checks identify A’s file. |
| AC-B2 | Met | Single zero-activity rejection distinguishes revising the current amendment from revising the spec/plan; both name plain canon run, with opposite-outcome assertions. |
| AC-B3 | Met | Docs, skill, decision, help, README and note describe the exception. Whole-bundle guidance replaces any need to split; partial-admission errors list qualifying/non-qualifying tasks. |
| AC-B4 | Met | Both non-exempt builders select review-prior-10 over review-prior-2, state unresolved findings remain binding unless superseded, and emit no archive guidance when absent. Red-first reproduced both missing pointers. |
| AC-B5 | Met | Fresh/resumed golden entries require copying tracked leftovers, moving untracked leftovers out, confirming copies before the red run, and restoring every set-aside file. |
| AC-B6 | Met | All production code_review current-loop readers use currentLoopReviewRounds. Null/absent fallback, explicit zero, malformed and missing values are tested; generic phase counter and seeding writers are classified below. |
| AC-B7 | Met | Preamble avoids assuming interruption; recovery triggers distinguish spec text from code/handoff; rejection removes repetition; skill heading keeps ordinal 6; missing implement is explicit; import order sorted. |
| AC-B8 | Met | Existing admit-started bundle now asserts both banners, both pending/rerouted/count+1 implementations, cleared review verdict/counters, and derived next phases. |
| AC-B9 | Met | Required checks pass; only two implement-reroute golden keys change against round-2 entry HEAD; no new or removed keys. |

## Edge Cases Considered

- Absent/null current-loop review-round fields fall back to legacy iterations. Present zero, string, negative, NaN, or infinite values do not fall back and provide no activity evidence. If both fields are absent there is no round evidence.
- Earlier phases reject even with stale review activity or a blocked downstream review. Same-branch sibling admission requires both pending phase entries and an independently qualifying anchor; siblings cannot bootstrap each other.
- Route-back can clear the verdict while current-loop activity remains positive; admission uses that activity. An approved sibling with zero counters can now accompany the qualifying branch owner, keeping downstream scope intact.
- Real loop-cap recovery leaves implement pending and code_review blocked with an empty verdict; the chained test follows the printed command successfully.
- A first interrupted implementation can leave a pristine handoff and dirty source files. Prompts require worktree grounding, preservation of completed red-first evidence, isolated pre-fix runs for unfinished red-first ACs, and complete Changes-table coverage of intended work. Obsolete leftovers should be removed.
- The pre-existing possibility of stale filled handoff evidence advancing rerouted implement remains outside scope, with code review as the backstop.

## Blockers

No implementation blocker remains. The following interpretations were applied without waiting for clarification:

- [ambiguity] Does AC-B1 supersede the original blanket zero-counter bundle exclusion? Interpreted as yes, only for a pending same-branch sibling anchored by an independently qualifying named task. The original different-branch AC-2(a) case still rejects; single-task admission is unchanged.
- [ambiguity] Does AC-B3 require the bundle exception on the earlier full-rule help, README and spec-gate-note surfaces too? Interpreted as yes under the existing restatement rules; all are in the cumulative Affected Files union and were updated. No scope expansion was needed.

The earlier plan’s allowlist concern remains resolved: the current parser reads Amendment sections and includes both recovery files. Base-only changes from main’s external advance were excluded using the task’s three-dot contribution diff; no branch operation was performed.

## Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| AC-1: implement-entry loop-cap | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='loop-cap\|route-back' tests/run-task-reroute-preflight.test.ts` | d6c00c31540646ac4d0d36b0595e0ca5a798759c, test-only edits | Expected exit 0, got 1 at the old phase gate; summary showed implement with code_review blocked and no verdict. | Both M and XS rows pass; full suite passes. |
| AC-1: route-back | Same command as preceding row | d6c00c31540646ac4d0d36b0595e0ca5a798759c, test-only edits | Expected exit 0, got 1 at the old phase gate; summary showed implement with code_review pending and no verdict despite iterations_current_loop=1. | Both M and XS rows pass; full suite passes. |
| AC-A6: legacy review-round alias | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='legacy iterations' tests/run-task-reroute-preflight.test.ts` | f17a1d5bd9fbf8a773a6fafb53ce537002d0d5a4, test-only source edits; incoming task artifacts preserved | M and XS admission rows exited 1 at the phase gate despite iterations=1; direct predicate returned false. Three expected failures before any non-test source edit. | All three pass after shared fallback; missing-review and invalid-current-field cases also pass; full suite passes. |
| AC-B4: non-exempt archive pointers | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='archive pointer' tests/run-task-prompts.test.ts` | 80b702390e39b77eafc54f0c8196ab757367bcaf, test-only edits | Both with-archive tests failed because plan and implement task lines omitted review-prior-10; both no-archive cases passed. | All four pass after conditional archive plumbing; full prompt file has 60 passing tests. |
| AC-B1: shared-branch recovery (supplementary) | `node --test --import ./tests/md-loader-register.mjs --import tsx --test-name-pattern='shared-branch sibling admit' tests/run-task-reroute-preflight.test.ts` | 80b702390e39b77eafc54f0c8196ab757367bcaf, test-only edits | A zero-counter approved sibling plus B with one current-loop review round on task/task-a was rejected at the phase gate (exit 1). | Admits, resets both tasks, and passes combined handoff/scope checks. Eight shared-branch scenarios pass. |

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | Final source/test changes pass ESLint. |
| `npm run type-check` | Pass | TypeScript no-emit check. |
| `npm test` | Pass | Final rerun: 1720 tests, 1719 pass, 1 skipped, 0 failures; 172.8 seconds. An earlier run caught accidentally altered fake-agent newline escapes; the original fixture strings were restored and this rerun passed. |
| `npm run build` | Pass | Both bundles generated; second build byte-identical. |
| `npm run sync-templates:check` | Pass | All three cumulative edited root/mirror pairs match. |
| `npm run docs-refs-check` | Pass | Passed after writing the rewritten handoff and notes. |
| Focused routing/task/recovery suites | Pass | 227 tests passed after restoring the fake-agent fixture strings; all eight shared-branch cases also passed after the final fixture refinement. |
| Prompt golden regeneration and verification | Pass | UPDATE_GOLDENS=1 run and subsequent ordinary run: 60 tests pass each. |
| Golden key comparison | Pass | Against 80b702390e39b77eafc54f0c8196ab757367bcaf only promptImplementReroute and promptImplementReroute_resumed changed; no added/removed keys. |
| Wording sweep / counter-reader grep | Pass | Zero prohibited non-exempt wording or old-set identifiers. Reader/writer classification below. |
| Generated CLI help smoke | Pass | Compiled help includes the shared-branch exception; exits 0. |
| Scope and whitespace checks | Pass | Cumulative 27 product files are within the union Affected Files. Scope uses main...HEAD plus dirty changes; git diff --check passes. |
| E2E | not_configured | Spec Validation Required explicitly marks E2E N/A: no UI surface. |

Build SHA-256 values after both identical builds:

- `dist/cli/index.js`: 88531e8b4b0149838d194741a0bc63ef11a622b21507ef8486bcb903155abeaa
- `dist/orchestrator/run-task.js`: 22a2b63163458800023ed5c3fbd90c0ff0f3a5f8b48ce373455243852345a25c

### Wording sweep and phase-list classification

Ran case-insensitive extended-regex searches over source, docs, skills, templates, README, and dist, excluding the spec-permitted historical/telemetry paths. Each returned zero hits:

- `completed .?implement`
- `previously shipped|implementation shipped|complete and shipped`
- `post-review fix path`
- `admitted phase \(.?code_review.?, .?qa.?, or .?human_review.?\)`

The remaining phase-list regex produced 15 hits, all updated to the full predicate; none are a shortened admission-rule statement. Full-rule surfaces now include the anchored shared-branch exception; the rejection’s single-task rule is followed by its bundle clause. Help splits the list over source lines and was read and smoke-tested separately.

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

### Amendment round-1 golden comparison (carried forward)

Against round-1 implementation e8c2d129e2b79b15fb93171fea403ddf4711e87b:

```text
added: []
removed: []
changed: ['promptImplementReroute', 'promptPlan_reroute_round1', 'promptPlan_reroute_bundle', 'promptImplementReroute_resumed']
```

Every other value is byte-identical to round 1. The amendment added no key and changed no spec-review or non-reroute key.

### Amendment round-2 golden comparison

Against 80b702390e39b77eafc54f0c8196ab757367bcaf:

```text
added: []
removed: []
changed: ['promptImplementReroute', 'promptImplementReroute_resumed']
```

Archive cases use separate fixture task IDs and assert their rendered task lines directly, so no archive-specific golden key was necessary. Plan/spec-review and all non-reroute golden values remain byte-identical to round-2 entry.

### Review-round reader verification

`grep -nE 'iterations_current_loop \?\? ' src/orchestrator/main.ts src/orchestrator/state.ts src/task/index.ts` returns only:

| Location | Classification |
|---|---|
| `src/orchestrator/state.ts`:448 | The one review-round reader: current-loop field, nullish legacy fallback, finite-positive normalization. |
| `src/orchestrator/main.ts`:3581 | Generic phaseIterationCount; its contract is explicitly outside AC-B6. |

The `??=` occurrences at `src/task/index.ts`:412 and :560 are unchanged seeding writes that populate persisted current-loop counters before incrementing them. They are not parallel counting consumers. getIterations, buildPipelineState, describeRerouteEntryPhase, and the single-task predicate all call currentLoopReviewRounds. Lifetime iterations_total fallbacks are a separate metric. Helper null/invalid inputs are tested without changing persisted-status validation.

## Ready for Review

- [x] All spec ACs met (see AC Coverage).
- [x] All applicable validation checks pass.
- [x] All deviations from plan documented with rationale.

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `src/orchestrator/prompts/templates/implement-reroute.md` | F1: require copies of all tracked and untracked non-test leftovers, verify existence and matching content before changing any worktree path, then restore tracked paths and move untracked files. Verify moved destinations before the red run and restore every file afterwards. |
| `tests/run-task-prompts.test.ts` | Two ordering regressions cover fresh and resumed reroute prompts; backup verification must precede both tracked restoration and untracked removal. |
| `tests/run-task-prompts.golden.json` | Regenerated only promptImplementReroute and promptImplementReroute_resumed; all other keys remain byte-identical to revision entry. |
| `src/orchestrator/main.ts` | N2: comment explains why one independently admitted anchor suffices for a sibling while all named tasks still must be admitted. |
| `dist/orchestrator/run-task.js` | Rebuilt bundled prompt with guarded backup ordering. |
| `tasks/reroute-from-implement/handoff.md`, `tasks/reroute-from-implement/notes.md` | Appended revision findings, red-first evidence, verification, and follow-up risk. |
| `tasks/reroute-from-implement/review-cold-codex-run-3.md` | Preserved incoming pipeline review artifact. |
| `tasks/reroute-from-implement/done.md`, `tasks/reroute-from-implement/lessons.md`, `tasks/reroute-from-implement/pr-body.md`, `tasks/reroute-from-implement/quality-log.md`, `tasks/reroute-from-implement/review-cold-codex-run-1.md` | Preserved earlier pipeline artifacts; declared here to complete cumulative Changes-table coverage. |

### Findings addressed

- **F1 — correctness bug:** fixed in `src/orchestrator/prompts/templates/implement-reroute.md`:28. Every leftover now has a verified copy before the first tracked restore or untracked move. The rendered instructions still require confirmation before the red run and restoration of tracked and untracked files afterwards.
- **N2 — optional nit:** addressed at `src/orchestrator/main.ts`:2816 with the requested justification for the anchor's `some()` predicate. Routing behavior is unchanged.
- **R1 — non-blocking follow-up:** retain the review's proposed pre-flight for rejecting partial shared-branch reroutes as follow-up work. The current invocation only examines named tasks, so rerouting a subset can reset those tasks before downstream coverage/scope checks reject the run. The spec deliberately documents naming the entire bundle instead of adding this gate; enforcing it needs a separate design. Recorded in this handoff and notes for operator triage.
- **N1 and N3–N8:** deferred as optional, spec-literal, malformed-state, or outside-scope observations, following the review's classifications. No blocking spec gap remains.

### AC deltas

- AC-A3 and AC-B5 remain Met, with F1's stronger verification-before-clearing order now tested in both prompt variants.
- AC-B9 golden scope remains Met: exactly the two implement-reroute values changed relative to revision-entry HEAD; no keys added or removed. Other AC implementations remain unchanged.
- No deviation from the authorized review fix; earlier Red-First Evidence rows remain intact above.

### Red-First Evidence

| AC | Command | Ran against | Pre-fix failure | Post-fix result |
|---|---|---|---|---|
| F1 / AC-B5: verification precedes clearing leftovers | `node --test --test-name-pattern='reroute red-first verifies backups' --import ./tests/md-loader-register.mjs --import tsx tests/run-task-prompts.test.ts` | 531de25ab1489752caab662c58021a4fc38181e6, test-only edits | Both fresh and resumed cases failed: "verify backups before directing agents to restore their paths to committed contents". No source fix had been applied. | Both pass after reordering; the full prompt suite passes 62/62 with regenerated and then ordinary golden verification. |

### Re-run validation

This revision changes prompt text and one source comment. Per the revision instructions, checks were scoped to those changes; the earlier full-suite result above is historical and was not re-run in this revision.

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | ESLint passed after the source and test changes. |
| `npm run type-check` | Pass | TypeScript no-emit check passed. |
| Prompt golden regeneration and verification | Pass | UPDATE_GOLDENS=1 and ordinary direct-runner invocations of `tests/run-task-prompts.test.ts` each passed 62 tests, with zero failures or cancellations. |
| Golden key comparison | Pass | Compared with 531de25ab1489752caab662c58021a4fc38181e6: only promptImplementReroute and promptImplementReroute_resumed changed; no additions or removals. |
| `npm run build` | Pass | Rebuilt both entry points; only the orchestrator bundle changed. Confirmed the built bundle contains the guarded backup instruction. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `npm run docs-refs-check` | Pass | References checked before and after appending revision artifacts. |
| Scope and whitespace checks | Pass | Cumulative product paths remain within the 27-file cap; every cumulative or dirty path is covered across Changes tables. git diff --check passed. |

### Blockers

None. R1 remains a non-blocking follow-up as explicitly classified by the review.
