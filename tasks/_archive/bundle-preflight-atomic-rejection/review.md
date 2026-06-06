# Code Review: bundle-preflight-atomic-rejection

> Reviewer: Claude (synthesis foreman over anchored + cold lenses) | Spec: `tasks/bundle-preflight-atomic-rejection/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. On re-review, append a new `## Round N` section rather than rewriting Round 1.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The only non-`Pass` row is `Docs references` → `Fail – unrelated`. Verified independently: the broken refs in docs/decisions.md pointed at an archived task whose paths moved to tasks/_archive/. The decisions.md file is not in this task's diff, so the breakage was genuinely pre-existing and outside the Affected Files. The Notes cited specific file:line references and the explanation is credible — label accepted, not rubber-stamped. (The pre-existing breakage has since been fixed directly on the base branch.)

I independently re-ran the touched test file: `tests/run-task-validation.test.ts` → **178/178 pass, 0 fail**, including all 9 new bundle pre-flight tests. Lint/type-check/build/template-sync reported `Pass` by Codex and are not re-verified per review policy.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: pre-flight enumerates ALL N tasks | Pass | `writePreflightReviewArtifacts(tasks, …)` and the Route A loop both iterate `tasks` (was `preflightFailed`). `preflightFailed` still computed for per-task BLOCKED content. 2- and 3-task tests confirm. |
| AC-2: failing tasks keep `buildPreflightReviewBlock` shape | Pass | `failuresByTask.get(t.taskId)` branch calls `buildPreflightReviewBlock(failure.classified, route)` unchanged; single-task tests assert the `## Validation Gate`/`## Pre-Flight Rejection`/HALTED shapes. |
| AC-3: no clean stub contains `## Stage 1` | Pass | Both stubs use `## Bundle Pre-Flight {Rejection,Halt}` headings; tests `doesNotMatch(/^## Stage 1\b/m)`. Confirmed compatible with `bundleHasRealPriorReview` (`prompts/index.ts:400`), which keys off `## Stage 1`. |
| AC-4: append over prior real review, non-`## Round` heading, omit verdict | Pass | `appendHeadingN = hasPriorRealReview ? currentPreflight + 1 : null`; append branch omits `# Code Review:` title and the `## Verdict` block; heading is `## Bundle Pre-Flight {Rejection,Halt} (round N) — …`. `extractCheckedVerdict` returns the prior verdict (whole-file scope, no `## Round`). Tested incl. prior-approved divergence. |
| AC-5: ALL N get `taskPhasePreflightRejected` (Route A) | Pass | `for (const { taskId } of tasks)` — failing + clean. |
| AC-6: all N → status `done`, verdict `changes_requested` | Pass | `taskPhasePreflightRejected` sets both; tests assert per task. |
| AC-7: fresh clean stub carries authoritative `Changes requested` checkbox | Pass | Content matches spec shape byte-for-byte; `extractCheckedVerdict` → `changes_requested` (only checkbox, no `## Round`). |
| AC-8: no `recoverPhaseForTask`; bundle reroutes to implement | Pass | `checkAndRoute` gate (`main.ts:2440`) fires only on `phaseStatus !== 'done'`; all done → skipped. `anyChangesRequested` (`main.ts:2566`) reads `status.json` verdict → `routeBackTo(taskIds,'implement')`. End-to-end test drives `checkAndRoute` and asserts both tasks land `implement`. |
| AC-9: preflight + changes_requested counters +1; iteration counters untouched | Pass | `taskPhasePreflightRejected` bumps `preflight_rejections_current_loop/_total` and `changes_requested_total`, leaves `iterations_*`. Tests assert all four per task. |
| AC-10: Route B auto-blocks all; no `taskPhasePreflightRejected`, no reroute | Pass | `auto_block` branch ends in `autoBlockPhase(taskIds,…)` + `process.exit(2)`, structurally before the rejection loop. Test asserts `blocked`, `auto_block_count=1`, one escalation, zero preflight/changes_requested bumps. |
| AC-11: Route B clean stub has no `## Verdict`/checkbox/`## Stage 1` | Pass | Halt stub never pushes a verdict block; test asserts absence + `extractCheckedVerdict === null`. |
| AC-12: `determinePreflightRoute`/`buildPreflightReviewBlock` unchanged | Pass | Neither function touched; existing blocked-only-route test still green. |
| AC-13: combined-counter cap unchanged | Pass | Cap block at top of `runCodeReviewPhase` untouched; Route A bumps `preflight_rejections_current_loop` on every task so max-across-bundle still trips. |
| AC-14: tests cover all enumerated cases | Pass | All 7 listed cases present and passing (2-task, 3-task, append, prior-approved divergence, Route B, all-pass no-op, single-task A+B). |

### Dropped Sections Check

- [x] Non-goals respected — routes not collapsed; single-task path unchanged (tested); no per-task partial advancement; clean stub points at siblings rather than replicating BLOCKED content.
- [x] Known Risks addressed — intentional artifact↔status divergence is pinned by the prior-approved test; Route B "must not regress to implement" is structurally guaranteed (exit before the rejection loop) and tested; append-vs-stomp tested.
- [x] Human Test Plan satisfiable — behavior matches steps 1–6.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2

## Stage 2 — Code Quality

### Summary

Clean, faithful implementation. The pre-flight `review.md` write loop was extracted into an exported, tested seam (`writePreflightReviewArtifacts`) and broadened from `preflightFailed` to all `tasks`, with `buildCleanTaskReviewStub` producing route-and-prior-review-aware sibling stubs. Both route branches are preserved exactly: Route A still calls `taskPhasePreflightRejected` (now bundle-wide) and returns; Route B still `autoBlockPhase` + `process.exit(2)` with no rejection/reroute. The verdict-parsing interactions (`extractCheckedVerdict` whole-file vs `## Round` scoping, `bundleHasRealPriorReview`'s `## Stage 1` gate) are correctly leveraged so the fresh stub's checkbox matches `status.json` while the appended stub defers to the prior real verdict. The exported seam is a documented, AC-strengthening deviation.

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

(none) — I specifically checked the cold-lens risk that broadening the Route A loop to all `tasks` could leak into Route B: it cannot, because `process.exit(2)` in the `auto_block` branch precedes the rejection loop. I also confirmed the next real `code_review` round overwrites a fresh clean stub (no `## Stage 1` → `bundleHasRealPriorReview` forces Round 1 → Claude rewrites `review.md`), so a stub's `changes_requested` checkbox can't pollute a later genuine review.

#### Optional Cleanup / Nit

(none blocking) Two observations, neither actionable:
- The append round-number heading derives from in-memory `t.status.phases.code_review?.preflight_rejections_current_loop`. If that snapshot were ever stale, only the cosmetic `(round N)` label in an audit stub would drift — never routing or verdict. Fine as-is.
- `dist/cli/index.js` was declared in spec Affected Files but stayed byte-identical (documented deviation). Harmless — the `--pr` base-drift allow-list is a superset, so an unchanged declared file doesn't trip the gate. Noted for the ship step.

#### Spec Gaps

(none) — the spec was unusually precise (exact stub shapes, the artifact↔status divergence, per-route counter expectations), and the implementation matched it without guesswork.

## Final Verdict

- [x] **Approved** — ship as-is
