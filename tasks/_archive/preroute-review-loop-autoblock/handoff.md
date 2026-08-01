# Implementation Handoff: preroute-review-loop-autoblock

> Author: Codex | Spec: `tasks/preroute-review-loop-autoblock/spec.md` | Plan: `tasks/preroute-review-loop-autoblock/plan.md`

## Changes

| File | What Changed |
|---|---|
| `scripts/run-task/review-loop.ts` | Added the shared spec/code loop evaluators, loop-local and per-task combined-attempt calculations, state-derived recovery reasons, zero-cap support, and the non-stepped cap-raise command. |
| `scripts/run-task/phases/spec.ts`, `scripts/run-task/phases/implement.ts` | Added revision-entry cap checkpoints before agent invocation and, for implementation, before branch/worktree or artifact-commit side effects. |
| `scripts/run-task/phases/spec-review.ts`, `scripts/run-task/phases/code-review.ts` | Retained defense-in-depth review-entry backstops while routing them through the shared evaluators. |
| `src/task/index.ts` | Narrowly enabled code-review reset from the new pre-route block state; made forced review acceptance complete only a pending, derived-current predecessor; projected bundle results before writes; and derived the printed next phase from persisted state. |
| `src/cli/commands/watch.ts` | Made blocked markers terminal only when no orchestrator is live, prioritized ambiguous PID refusal, applied liveness to `--until`, and kept stale-heartbeat/live-PID runs progressing. |
| `scripts/run-task/env.ts`, `scripts/run-task/policy.ts` | Added and shared strict raw-string validation for `MAX_REVIEW_LOOPS`, preserving zero while warning and defaulting malformed, fractional, trailing-junk, or negative values. |
| `tests/run-task-safety.test.ts` | Added real-git subprocess coverage for pre-agent blocking, continuation and repeated resume, side-effect prevention, reset behavior, forced-accept continuation into QA, and stepped/plain raised-cap behavior with invocation logging. |
| `tests/run-task-code-review.test.ts` | Added evaluator/backstop/formula/reason tests, including loop-local semantics, zero-cap blocking, state-dependent recovery clauses, and the command without `--step`. |
| `tests/task-cli.test.ts` | Added reset narrowness and forced-accept predicate tests for code/spec loops, in-progress and earlier-phase negatives, and atomic mixed-bundle refusal. |
| `tests/watch.test.ts` | Added primary/backstop live/dead crossings, ambiguous PID precedence, idle/attach/progress classifications, and `--until` settlement regressions. |
| `tests/pipeline-policy.test.ts`, `tests/run-task-harness.test.ts` | Added subprocess config tests proving identical invalid-value fallback/warnings and valid zero handling at both config surfaces. |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Replaced the stale phase-mismatch reset instruction with cap-raise/resume guidance and regenerated the adopter mirror. |
| `docs/architecture.md`, `docs/product-context.md` | Corrected revision-entry checkpoint and recovery documentation, including both review-loop reset commands. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Documented revision-entry blocking, continuation/reset behavior, and the plain raised-cap command; regenerated the canon-managed mirror. |
| `docs/BACKLOG.md` | Recorded the separate unreachable `promptSpecRevision` defect without widening this task into prompt selection. |
| `dist/scripts/run-task.js`, `dist/cli/index.js` | Rebuilt both published bundles from the final TypeScript sources. |

## Canon Governance

| Field | Source |
|---|---|
| Upstream repo | `status.json.canon.upstream_repo` |
| Upstream commit | `status.json.canon.upstream_commit` |
| Orchestrator commit | `status.json.canon.orchestrator_commit` |
| Codex CLI | `status.json.canon.codex_cli` |
| Claude Code | `status.json.canon.claude_code` |

## Intent & Rationale

The cap is evaluated at the entry to the revision work it is meant to prevent, while the review-entry check remains as a backstop. Both checkpoints use shared pure evaluators, so threshold, counter, bundle, and reason behavior cannot drift between call sites. Persisted phase state remains the continuation contract.

The reroute amendment closes the downstream consequences of that state shape. Forced acceptance mirrors the predecessor to `done` only for the exact pending/current/blocked case and refuses divergent bundle outcomes before any write. Watcher consumers use process liveness—not phase identity—to distinguish a live resume from a terminal block. Cap parsing now validates the untouched environment string and deliberately preserves zero as an immediate-block override.

## Deviations from Plan

| Deviation | Rationale | AC impact |
|---|---|---|
| The AC-18 follow-on QA invocation assertion lives in `tests/run-task-safety.test.ts`, while predicate/message cases remain in `tests/task-cli.test.ts`. | The safety suite already provides the real-git `main()` subprocess and logging fake-agent infrastructure needed to prove QA, rather than Codex, is invoked. | None; AC-18's state and invocation contracts are both exercised. |
| `dist/cli/index.js` remains included although the original Affected Files table omitted it. | The original AC-16 and amended `src/task/index.ts` changes affect the published CLI entry point; a fresh required build necessarily regenerates this bundle. | None; avoids shipping stale generated code. |

## AC Coverage

| AC | Status | Notes |
|---|---|---|
| AC-1–AC-5 | Met | Real-git subprocess fixtures prove pre-agent blocking, exit/state/escalation contracts, side-effect prevention, cap-raised ordering, and free repeated re-blocks. |
| AC-6–AC-10 | Met | Shared evaluators own formulas and reasons; per-task combined attempts, per-task reset commands, state-derived clauses, and no-hand-edit guidance are pinned. |
| AC-11–AC-13 | Met | Both review-entry backstops remain, first-pass and lifetime-total negatives stay healthy, and only loop-local counters trigger blocks. |
| AC-14–AC-17 | Met | The adjacent prompt defect is backlog-only, docs/mirrors are current, and reset-code-review is accepted only for the exact pending revision-entry block state. |
| AC-18 | Met | Code/spec forced accepts complete the exact deferred predecessor; negative states remain current, divergent bundles refuse atomically, and a follow-on `main()` run logs QA/Claude without Codex. |
| AC-19 | Met | Existing accept tests pass unchanged; write behavior differs only for the named predecessor predicate and projected mixed-phase bundle refusal. |
| AC-20 | Met | Attach, idle, progress, and `--until` tests cover primary/backstop blocks crossed with live/dead orchestrators plus ambiguous PID precedence. |
| AC-21 | Met | Both config surfaces reject all named invalid raw values with warnings/defaults; zero remains valid and blocks both evaluators at count zero. |
| AC-22–AC-23 | Met | Recovery skill and both documentation surfaces carry the corrected checkpoint/recovery model; managed mirror and docs-reference checks pass. |
| AC-24 | Met | Builders and canonical recovery docs omit `--step`; a plain raised-cap run completes the deferred spec revision and following approved review in one process. |

## Edge Cases Considered

- Mixed bundles calculate review plus pre-flight attempts per task before taking the maximum.
- Spec review reads its own persisted loop-local counter rather than the code-review-derived generic context field.
- Lifetime totals at or above the cap do not block a fresh loop; a validated cap of zero intentionally does.
- Forced acceptance does not declare an in-progress predecessor done and does not skip an earlier pending phase.
- Projected bundle divergence is detected before snapshots, notes, or status writes.
- A blocked review marker with a live PID remains progressing whether the blocked review is current or stale; the same shapes are terminal without a live PID.
- Ambiguous live PIDs refuse attachment before any blocked-marker classification.
- Clean-exit integration fakes update the review artifact as well as status so evidence recovery observes the intended current verdict.

## Blockers

None.

## Validation Outcomes

| Check | Result | Notes |
|---|---|---|
| Amendment red-first regressions | Pass | Before production edits, the targeted command produced four expected failures: forced accept left `implement` pending, live blocked attach returned `auto_block`, blocked+ambiguous returned `auto_block`, and cap zero did not block. The same selections pass after the fixes. AC-20(D) is a contract-lock against an unshipped amendment draft, as specified. |
| Focused reroute regressions | Pass | Forced-accept follow-on QA, both reason builders, plain raised-cap continuation, all watcher crossings, and both cap config surfaces passed. |
| `npm run lint` | Pass | ESLint completed without errors. |
| `npm run type-check` | Pass | TypeScript completed without errors. |
| `npm test` | Pass | Full test suite completed successfully. |
| `npm run build` | Pass | Both published ESM bundles rebuilt successfully. |
| `npm run docs-refs-check` | Pass | All documentation references are valid. |
| `npm run sync-templates:check` | Pass | All canon-managed roots and mirrors are synchronized. |
| `git diff --check` | Pass | No whitespace errors. |

## Ready for Review

- [x] All spec ACs met
- [x] All applicable validation checks pass
- [x] All deviations documented with rationale

## Iteration 2 — addressing review round 1

### Changes

| File | What Changed |
|---|---|
| `scripts/run-task/review-loop.ts` | Disclosed that reset accepts the implementation as-is and re-reviews it, distinguished cap-raise/re-implementation recovery, and restored the review-artifact and concrete pre-flight-format guidance. |
| `src/task/index.ts` | Made the reset success output explicitly report the `implement → done` state write. |
| `tests/run-task-code-review.test.ts`, `tests/task-cli.test.ts` | Added focused assertions for both corrected recovery reasons and the reset success output. |
| `dist/scripts/run-task.js`, `dist/cli/index.js` | Rebuilt both published bundles from the revised guidance and CLI output. |

### Findings addressed

- _correctness bug F1:_ `reset-code-review` now discloses its material predecessor write in the success output, while the persisted block reason explains that reset accepts the current implementation as-is and causes re-review rather than re-implementation. The reason explicitly directs operators who want another implementation pass to raise the cap instead.
- _correctness bug F2:_ the code-review block reason again points operators to `tasks/<id>/review.md`, explains when repeated findings imply a spec/approach problem, and restores the concrete malformed Validation Outcomes key example for repeated pre-flight failures.
- _optional nits:_ N1, N2, and N5 were deliberately deferred because the reviewer limited this round to F1/F2 and directed that nothing else be rewritten.

### Deviations clarified

| Deviation | Rationale | AC impact |
|---|---|---|
| The projected-next-phase agreement check also protects non-`--force` review bundles. | A single derived "Next phase" message cannot be truthful for a divergent bundle; refusing before writes is the fail-closed generalization of the AC-18 message fix. | AC-19 remains met; documented in response to N3. |
| `reset-code-review` additionally requires `implement.status === 'pending'` in the new accepted state. | Derived phase `implement` also includes interrupted `in_progress` work; declaring partial work done would bypass the implementation gate. | This safely narrows AC-16 and preserves its intended pending pre-route block; documented in response to N4. |

### AC deltas

- No AC status changed: all AC-1–AC-24 remain met. F1/F2 correct operator guidance on top of the accepted state behavior.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| Focused red-first guidance regressions | Pass | Before the production edits, the reason lacked the artifact pointer and reset semantics, and the success output omitted `implement → done`; both focused tests failed for those omissions, then passed after the fix. |
| `npm run lint` | Pass | ESLint completed without errors. |
| `npm run type-check` | Pass | TypeScript completed without errors. |
| Affected unit tests | Pass | 86 tests passed across `tests/run-task-code-review.test.ts` and `tests/task-cli.test.ts`. |
| `npm run build` | Pass | Both published ESM bundles rebuilt successfully. |
| `npm run docs-refs-check` | Pass | The cumulative handoff and task artifacts contain valid references. |
| `git diff --check` | Pass | No whitespace errors. |

## Iteration 3 — addressing review round 2

### Changes

| File | What Changed |
|---|---|
| `scripts/run-task/review-loop.ts` | Extracted one parameterized reset-semantics clause used by both reason builders; both loops disclose the accepted-as-is predecessor write, while the cap-raise alternative appears only when that revision is actually pending. |
| `tests/run-task-code-review.test.ts` | Replaced the defect-pinning both-state assertion with state-discriminating spec/code pairs and retained the F2 artifact/pre-flight assertions in both code states. |
| `.claude/skills/canon-pipeline/recovery.md`, `templates/.claude/skills/canon-pipeline/recovery.md` | Disclosed that spec reset marks `spec` done and re-reviews without another revision; regenerated the adopter mirror. |
| `docs/product-context.md` | Documented that both reset helpers accept the predecessor as-is and that cap raise is the revision-preserving path. |
| `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` | Added the same reset/predecessor contract to canonical recovery guidance and regenerated its mirror. |
| `dist/scripts/run-task.js` | Rebuilt the published orchestrator bundle from the revised shared reason builder. |

### Findings addressed

- _correctness bug F3:_ the code-loop reason no longer promises an implementation pass at a backstop block. The shared clause emits the cap-raise/deferred-revision alternative only when `implement` is pending; the backstop reason now agrees with its adjacent resume clause.
- _correctness bug F4:_ the spec-loop reason now discloses the identical predecessor write through the same helper, and all three prose surfaces name the accepted-as-is reset semantics. The canon-managed recovery and orchestrator mirrors were regenerated rather than hand-edited.
- _optional nits:_ all Round 2 nits were deferred as directed for this tightening pass.

### AC deltas

- AC-6 and AC-10 remain Met with stronger class-level coverage: one helper owns reset semantics for both loops, and pending/backstop states now receive distinct cap-raise guidance without contradictory unconditional promises.
- All other ACs remain Met and behaviorally unchanged.

### Re-run validation

| Check | Result | Notes |
|---|---|---|
| Focused red-first reason regression | Pass | Before production edits, the new state-discriminating test failed because code guidance lacked the state-specific form and spec guidance lacked reset semantics; the revised four-state test passes. |
| Focused code-review suite | Pass | 17 tests passed. |
| `npm run lint` | Pass | ESLint completed without errors. |
| `npm run type-check` | Pass | TypeScript completed without errors. |
| `npm test` | Pass | Full test suite completed successfully. |
| `npm run build` | Pass | Published bundles rebuilt successfully; only the orchestrator bundle changed in this iteration. |
| `npm run docs-refs-check` | Pass | All documentation references are valid. |
| `npm run sync-templates:check` | Pass | All canon-managed roots and mirrors are synchronized. |
| `git diff --check` | Pass | Current implementation and artifact diffs contain no whitespace errors. |
