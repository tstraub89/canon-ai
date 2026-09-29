# Spec: claude-55-calibration — Calibrate Claude prompts and small-task spec routing

> Written by: Codex | Review by: Claude (human-authorized role reversal)
> Status: draft — awaiting independent Claude review
> Proposed size: M | delicate: true (changes pipeline authorship and review behavior)

## Problem

Canon follows current Claude releases through the opus/sonnet aliases, but its explicit effort matrix and prompt instructions do not automatically recalibrate. We need a bounded first adjustment, supported by repository evidence, rather than treating improved benchmark performance as proof that every phase can use a cheaper configuration.

A read-only assessment on 2026-09-28 compared canon and GalleryPlanner quality logs, matched September entries to archived status records, and spot-checked task notes, reviews, and invocation logs. GalleryPlanner's dev/main quality logs were identical and counted once. September contains 105 GalleryPlanner tasks and seven canon tasks. GalleryPlanner's non-delicate XS/S/M cohorts contain 31/41/18 tasks; 22/16/3 respectively record one code-review round, with median review counts 1/2/3. These counts include amendments and reroutes, not just failed implementations. Model aliases in invocation tables do not identify exact Claude versions, and some run logs recover effort but not resolved model IDs. This is observational evidence, not a controlled model comparison.

Representative evidence:

- GalleryPlanner's mobile-history-parity completed cleanly with Sonnet medium review. welcome-import-projects used Sonnet medium and caught substantive re-entry/cancellation bugs; its notes also record later PR-review catches, so its quality-log row alone understates downstream work.
- GalleryPlanner's editable-zoom-input was XS but needed five review rounds around live-state reconciliation and real-device behavior. Small does not necessarily mean easy.
- GalleryPlanner's report-issue-in-app-form records seven review rounds, five implementation reroutes, and only one code-review changes_requested count. mobile-sheet-lazy-retry's original premise was disproved by device testing.
- Canon's update-from-npm-registry needed a missing exact-version-pin requirement added after three spec-blind reviews. Code-review-delta-rerounds and other delicate canon tasks required genuine corrections even with Opus review.

The prompt audit found concrete issues independent of model benchmarks:

1. The foreman says a quiet lens is a bug, while the cold lens explicitly permits an empty findings list. This contradictory instruction pressures synthesis toward findings instead of evidence.
2. Claude phase prompts lack a consistent phase-bounded completion contract. The foreman already explicitly waits for its lenses; other phases should distinguish finishing their assigned phase from continuing the entire pipeline.
3. Review delegation is specified, but recursive delegation/extra review passes are not explicitly bounded.
4. Planning requests ordered steps and existing patterns but does not explicitly require a concise feasibility check covering proposed APIs, repository constraints, test reachability, and relevant lifecycle edges.

These mechanisms were confirmed by reading the current templates, lens charters, shared prompt helpers, Claude invocation wrapper, and policy/config callers. This is policy/prompt calibration, not a claim that we reproduced a model behavior regression.

### External evidence and limits

Consulted 2026-09-28:

- [Sonnet 5.5 announcement](https://www.anthropic.com/claude-sonnet-5-5): lower-effort Sonnet is the clearest cost complement to Opus; complex open-ended judgment still favors Opus.
- [Opus 5.5 announcement](https://www.anthropic.com/claude-opus-5-5): encouraging lower-effort coding/review results, not canon-specific recall evidence.
- [Sonnet prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5): lower effort can stop early or skip verification; higher effort can add work and initiate review. Existing prompts generally remain usable.
- [Opus prompting guide](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5): effort labels are not equivalent across generations; unattended progress reports can end a turn before completion.

Vendor observations justify calibration, not promised savings or equivalent defect recall. Canon invokes Claude Code, not the Messages API directly; API-specific thinking/display/cache controls are outside this task.

## Decision

### 1. Calibrate prompts first

- Accept a clean lens result after the assigned checks. Preserve broad candidate discovery, uncertain findings with confidence/severity tags, independent lenses, and evidence-based foreman adjudication. Do not introduce a finding quota or a high-severity-only filter.
- Give each Claude phase a completion boundary: finish its authorized artifacts and required checks, execute its existing phase command when its completion conditions hold, then stop. A progress summary or offer to continue is not completion. Never fabricate a successful artifact or mark an incomplete phase done merely to avoid a stall.
- For unattended Claude calls, explicitly say no live answer is available: make routine decisions within authorization, record material assumptions in the phase artifact, and continue independent authorized work. A genuine blocking ambiguity, missing required approval, or failed prerequisite must remain visible and must not be bypassed. Interactive calls retain the ability to ask and wait.
- The foreman launches only its two prescribed Claude lenses; it consumes the orchestrator-provided Codex findings and waits for both Claude results before synthesis. Lenses do their assigned work without spawning additional reviewers. Other phases must not initiate extra review rounds or proceed into another phase. Preserve phase-authorized actions such as QA's documentation work; do not impose a blanket ban on all subagents or required tests/docs.
- Planning, including reroute planning and XS combined spec/plan, checks that proposed APIs/patterns exist, repository constraints allow the approach, tests reach the intended behavior, and required supporting surfaces fit scope. For async/stateful changes, address re-entry, cancellation/unmount, stale state, and ownership where relevant. A clearly identified contradiction is surfaced, not silently converted into a binding spec change. Keep the plan concise and proportional.
- Keep grounding, red-first evidence, device-test exceptions, cold-review blindness, artifact formats, independent cross-review, and deterministic gates. Do not add generic think-harder language or forbid revisiting earlier conclusions when new evidence contradicts them.

### 2. Introduce one reversible routing change

Change only the default spec model for effective XS/S from Opus to Sonnet; keep medium effort. All other model/effort/budget cells remain unchanged. Effective size and delicate promotion, not nominal size alone, control routing. XS combined spec/plan uses the same selection. A bundle follows its existing effective-size calculation; a delicate member must still select the XL policy.

Add an explicit small-spec override, CLAUDE_MODEL_SPEC_SMALL. Its precedence is: small-specific override, then existing CLAUDE_MODEL_SPEC, then legacy CLAUDE_MODEL, then sonnet. Existing CLAUDE_MODEL_SPEC and CLAUDE_MODEL overrides therefore retain their meaning across all spec sizes when no small override is set. M/L/XL retain their existing spec override chain and opus fallback. Both configuration resolution paths must agree. Rolling back only the new routing requires CLAUDE_MODEL_SPEC_SMALL=opus, without reverting prompt improvements.

There is no automatic classifier for 'routine'. This first routing proposal covers non-delicate XS/S as the existing machine-readable cohort. Authors/operators must assess risk honestly; small async or stateful tasks may need larger sizing or delicate treatment. Describe that limitation rather than claiming all XS/S work is simple. Claude's review should specifically assess whether this cohort is sufficiently narrow, given that XS fast tier skips automated spec review.

### 3. Stage evaluation and defer broader changes

Land/evaluate the prompt changes before enabling the routing change in dogfood runs, using separate commits or operator-controlled rollout with the small-spec override set to opus during the prompt-only period. A release may contain both, but no claim about their separate effects may be made from a combined before/after comparison.

Record the actual model version when available, requested alias/effort, pipeline revision, task risk, and final outcome in a task-local evaluation artifact. No shared telemetry schema change is required. Reuse existing logs and supplement missing data explicitly; unknown values remain unknown.

Before promoting small-spec routing, compare Opus medium and Sonnet medium on at least six fixed historical pre-spec input/code snapshots: three routine XS/S cases, two small lifecycle/async cases, and one case with a previously missed requirement. Use the same prompt version and inputs for both. Claude independently reviews outputs against known task outcomes and source behavior; it does not judge its own authored evaluation outputs. Where independent review would otherwise be by the author, use the human or the other agent instead. Record critical requirement omissions, invented APIs/behavior, scope expansion, feasibility, and required human interventions; measure cost/time only when available. Do not use final approved specs as drafting inputs, since that leaks the answer.

The gate for this bounded sample: no additional consequential requirement omission, unsafe scope expansion, or false completion in the Sonnet arm versus the Opus arm, and no known critical requirement missed by both without correction to the test design/prompt. A failed case means keep Opus for rollout and record the decision, not silently waive the result. Passing six cases is provisional evidence, not statistical equivalence. An unavailable historical input or inability to run the comparison is human_pending and keeps routing on Opus during rollout.

After provisional rollout, inspect the first ten eligible completed tasks through human/PR review, including amendments and fixes after QA. A consequential missed requirement, unsafe scope expansion, or false completion attributable to spec authorship triggers return to Opus pending triage. Evaluate total work through acceptance; fewer rounds or tokens alone are not success. This follow-up is operator-run, not a new automation.

Deferred experiments, recorded but not implemented here: Sonnet medium for bounded M planning; Opus medium for selected M specs; Opus high instead of xhigh for delicate specs/reviews; Sonnet medium for M reviews. No low-effort review/QA change. Test each independently after the first rollout.

## Non-Goals

- No change to Codex models/prompts, review topology, loop caps, full-send semantics, phase state machine, or deterministic gates.
- No automatic continuations, new review agents, API integration changes, task-schema additions, or general evaluation framework.
- No GalleryPlanner source/doc changes or automatic task runs there.
- No broad effort reductions, model version pinning, prompt rewrite, changelog/version bump, or historical-log rewriting.
- No requirement to run paid model comparisons while merely drafting/reviewing this spec. Implementation verification and rollout evaluation are distinct gates.

## Acceptance Criteria

- [ ] AC-1: Effective XS/S spec defaults resolve to Sonnet medium; M/L remain Opus high and XL/delicate Opus xhigh. Tests cover each size, small delicate tasks, mixed bundles, and XS combined spec/plan. Assert all non-spec model/effort/budget decisions retain their prior behavior.
- [ ] AC-2: Both config resolution paths implement the documented small-spec override precedence. Tests cover no override, small-only, spec-only, legacy-only, and conflicting overrides; custom model strings remain intact. Existing typed policy callers/fixtures remain valid. Verify the documented rollback resolves only small specs back to Opus.
- [ ] AC-3: Foreman and both lens charters consistently allow an evidence-backed empty result. Remove silence-as-failure wording while preserving uncertain candidate reporting, confidence/severity tags, code verification, cold blindness, and existing verdict rules. Verify with rendered prompt assertions plus independent semantic review; a clean synthetic review scenario has no instruction requiring a finding.
- [ ] AC-4: Fresh, resumed, revision, and reroute Claude prompts retain the phase-completion boundary. Test spec, plan, code_review, QA, XS combined flow, and bundle command generation. Headless-only text reaches unattended calls but never interactive calls; resume stripping does not remove the task's completion contract. Failed/missing prerequisites are not represented as successful completion.
- [ ] AC-5: Foreman/lens instructions bound review delegation to the existing three-lens protocol and require collection before verdict. Prompt checks confirm lenses are not asked to launch more reviewers, ordinary phases do not start additional review rounds, and foreman cannot replace required independent lenses with its own review.
- [ ] AC-6: Fresh/reroute planning and XS combined spec/plan include proportional feasibility and test-reachability checks, plus conditional lifecycle checks. Rendered tests cover each path and exempt bundle members; no requirement rewrites an exempt task's existing plan. Independent review confirms contradictions remain visible and cannot authorize out-of-scope work.
- [ ] AC-7: Update operator docs and add a dated decision entry describing the small-spec matrix, override precedence/rollback, risk limitation, evidence limits, staged rollout, and deferred experiments. Remove the inaccurate current comment that Sonnet cannot support xhigh without changing the plan effort cap. Runtime/adopter-facing instructions use only scaffolded or explicitly optional project paths; canon/GalleryPlanner-specific evidence stays in this task's artifacts or clearly historical rationale.
- [ ] AC-8: Add a task-local evaluation checklist/results record covering the six paired cases and ten-task follow-up. Record executed results or explicitly pending work, exact configuration/provenance where available, downstream findings, and the rollout decision. Unit/snapshot tests must not be presented as measured model-quality equivalence. Pending/failed evaluation keeps the documented dogfood rollout on the Opus override.
- [ ] AC-9: Root managed files are edited first, mirrors regenerated, prompt goldens regenerated, and both distribution bundles rebuilt. Required checks pass; unrelated existing edits are preserved and called out, not absorbed into this task silently.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/lib/pipeline-policy.ts` | Small-spec selection/config shape; clarify outdated capability comment |
| `src/orchestrator/env.ts` | Small-spec environment resolution |
| `src/orchestrator/policy.ts` | Matching config resolution and forwarding |
| `src/orchestrator/agents/claude.ts` | Deliver headless-only contract safely on fresh/resumed unattended calls |
| `src/orchestrator/prompts/helpers.ts` | Shared Claude phase/headless wording as needed |
| `src/orchestrator/prompts/index.ts` | Render completion/feasibility guidance including combined and reroute paths |
| `src/orchestrator/prompts/templates/spec.md` | Spec phase boundary and combined-plan feasibility |
| `src/orchestrator/prompts/templates/spec-revision.md` | Revision boundary and combined-plan feasibility |
| `src/orchestrator/prompts/templates/plan.md` | Plan completion and feasibility |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Equivalent checks respecting amendment/exemption scope |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Clean-result calibration and bounded delegation |
| `src/orchestrator/prompts/templates/qa.md` | QA phase completion boundary |
| `.claude/agents/code-review-anchored.md` | Clean results and no recursive reviewer delegation |
| `.claude/agents/code-review-cold.md` | Same, preserving blindness and candidate discovery |
| `templates/.claude/agents/code-review-anchored.md` | Generated mirror |
| `templates/.claude/agents/code-review-cold.md` | Generated mirror |
| `tests/pipeline-policy.test.ts` | Routing/override compatibility coverage |
| `tests/run-task-prompts.test.ts` | Phase, resume, combined, reroute, and reviewer contracts |
| `tests/run-task-prompts.golden.json` | Regenerated rendered prompts |
| `tests/run-task-safety.test.ts` | Invocation-mode/config regression coverage where applicable |
| `tests/run-task-code-review.test.ts` | Review protocol regression coverage where applicable |
| `docs/pipeline-orchestrator.md` | Matrix, override and rollout instructions |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror |
| `docs/decisions.md` | Dated calibration decision and limits |
| `templates/docs/decisions.md` | Generated mirror |
| `dist/cli/index.js` | Generated bundle |
| `dist/orchestrator/run-task.js` | Generated bundle |
| [evaluation.md](evaluation.md) | Task-local evaluation checklist/results and rollout decision |

### Interaction Dependencies

The effective-size calculation already promotes delicate tasks and bundles. Config is duplicated in env and policy; both must remain consistent. Prompt startup removal on resume is separate from invocation-mode delivery. XS combines spec and plan and lacks the full-tier spec-review checkpoint. Review lenses inherit the foreman's model/effort. QA has existing authorized documentation writes and must retain them. Runtime Markdown is bundled into published distribution files; root lens charters and managed docs have template mirrors.

### Data Model Changes

Add small-spec model configuration to the internal policy/config surface. No persisted task/status schema or phase-agent assignment changes. The human-authorized authorship reversal applies to this spec only; it does not redefine the pipeline's standard roles.

## Validation Required

Implementation checks (not claimed run during spec authorship):

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run sync-templates:check` after `npm run sync-templates`
- [x] `npm run docs-refs-check`

Use meaningful policy/invocation tests and rendered prompt regressions. For the contradictory clean-result instruction and interactive/headless separation, establish a failing regression assertion before the fix. No UI, E2E, migration, or cross-platform feature is introduced. Paid/live comparisons are the separate rollout gate above; disclose pending results in QA.

## Docs Impact

Update pipeline-orchestrator and decisions as listed. Architecture, codebase-map, patterns, and product-context need no structural update: phases, review topology, and the XL policy remain unchanged. Preserve historical rationale rather than rewriting old observations as new-model evidence.

## Known Risks

- Small tasks can hide lifecycle or data-loss complexity; XS has no automated spec-review backstop. Default expansion must pass independent review and the provisional rollout gate.
- Removing finding pressure could reduce recall if softened into high-confidence-only reporting; preserve broad candidate discovery and explicit check coverage.
- Generic autonomy can bypass approval or falsely advance a phase. Keep mode/phase boundaries explicit and never equate an exit or summary with completion.
- Prompt edits and model changes confound each other unless evaluation holds prompts fixed. Aliases and CLI upgrades can also change the treatment mid-study.
- Six paired tasks and ten prospective tasks are a practical screening sample, not proof of equivalence. Final outcomes include human and PR-review catches after QA.
- Existing uncommitted edits already touch pipeline-orchestrator and the spec-review skill/mirrors; implementation must reconcile the doc overlap without taking ownership of unrelated changes.

## Human Test Plan

1. Ask Claude to review this draft, especially the XS/S cohort, reviewer recall, and blocked-phase behavior. No implementation starts from this draft alone.
2. Compare the paired small-task specifications. Confirm the cheaper configuration retains important requirements and does not invent extra work.
3. Observe a routine small task and a sensitive small task: only the routine one should use the cheaper specification default.
4. Confirm a clean review can approve without invented issues, and a real defect still produces a change request.
5. Confirm unattended work finishes its assigned phase without offering to continue, while an interactive session can still ask a necessary question.
6. Inspect downstream review and human findings before promoting the trial. Use the rollback if specification quality deteriorates.

## Spec Quality Checklist

- [x] ACs name concrete verification methods; live quality evidence is separate from structural tests.
- [x] Affected Files lists specific source, mirror, test, documentation, and generated artifacts.
- [x] Full tier; implementation plan is intentionally deferred to the reviewed-spec phase.
- [x] Known Risks covers small-task misclassification, review recall, completion boundaries, and measurement limits.
- [x] Human Test Plan uses product-level outcomes.
- [x] Required implementation validation is marked above.
- [x] Calibration proposal, not an asserted reproduced model regression; the deterministic prompt contradiction has a red-first regression requirement.
