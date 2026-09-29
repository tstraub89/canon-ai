# Code Review: claude-55-calibration

> Reviewer: Claude | Spec: `tasks/claude-55-calibration/spec.md`
>
> **Per-round sections.** This file is cumulative across review rounds. The Stage 1 / Stage 2 structure below covers Round 1 (initial review). On re-review, append a new `## Round N` section near the bottom rather than rewriting earlier rounds — Codex reads only the latest round's section to know what to address.

Code review is synthesized by a foreman from three lenses: an anchored Claude lens that applies the Stage 1 / Stage 2 charter below, a cold-Claude lens that reads only the diff, and a cold-Codex lens pre-obtained by the orchestrator as an unanchored diff review from a different model family. The foreman writes this single consolidated artifact and verdict.

**Scope:** Full — base `main` — reason: Round 1 (initial review)

Lens returns: anchored → `approve`; cold-Claude → `changes_requested` (8 findings, all self-rated low or medium); cold-Codex → no actionable findings.

## Stage 1 — Spec Compliance (gate)

### Validation Gate

- [x] Validation Outcomes table has no `Fail` results
- [x] All checks required by the spec's "Validation Required" section were run
- [x] No required checks were skipped without justification

The anchored lens re-ran the checks. `npm test` gave 1333 passed, 0 failed, 0 skipped. The one skip in the handoff's run is not one of this task's tests: the task's two test files run 98 tests with 0 skipped. `lint`, `type-check`, `sync-templates:check` and `docs-refs-check` pass. cold-Claude confirmed that a rebuilt `dist/orchestrator/run-task.js` matches the committed copy.

### Acceptance Criteria Check

| AC | Status | Notes |
|---|---|---|
| AC-1: Clean-result contradiction removed | Pass | None of the four foreman render paths matches `quiet lens output is a bug`. Each names the empty forms, the Stage-1-fail form, one re-spawn, `approval evidence`, no checked verdict box, and `code_review blocked` for every task. The anchored lens reproduced the red run against main's template. |
| AC-1b: Reviewer `blocked` stops the run | Pass | `src/orchestrator/main.ts:3201-3204` fires only when phase is `code_review` and a status is `blocked`, before the recovery loop. The single, mixed-bundle, reset and unchanged-path fixtures are present. The red run was reproduced: 0 escalations against main. |
| AC-2: Explicit clean forms in both charters | Pass | The anchored charter has `STAGE_2_FINDINGS: (none)`. The cold charter keeps `COLD_FINDINGS: (none)`. Both keep "Coverage is your job; filtering is not." The mirrors are byte-identical. |
| AC-3: Preamble on unattended calls only | Pass | `src/orchestrator/agents/claude.ts:108-109` prepends the preamble after resume wrapping, inside `attempt()`, so fallback gets it too. The interactive path does not. The fake-claude tests use a dynamic import, and the red run was reproduced. |
| AC-4: Preamble content | Pass | There is a token for each element of Decision §2, including the "skip unless authorized" rule. `CLAUDE_STARTUP` contains none of them. |
| AC-5: Delegation bound | Pass | The foreman is limited to exactly the two lenses plus a re-spawn and must never substitute its own review. Both charters say to spawn no sub-agents. `CLAUDE_HEADLESS` forbids unrequested reviewers. The existing tests pass. |
| AC-6: Feasibility content | Pass | `planFeasibilityCheck` (`src/orchestrator/prompts/index.ts:72-84`) covers every element of §4, the N/A allowance, and the `[plan]` contradiction rule, and says not to change the spec or widen scope. |
| AC-7: Feasibility in every planning path, and nowhere else | Pass | Plan single and bundle renders (Approach), the shared reroute steps (Delta), and the fast-tier single, bundle and `selfCheck` paths all carry it. It is absent from the exempt verdict line and from the full-tier `promptSpec`. |
| AC-8: Goldens and bundle | Pass | Exactly the seven allowed golden keys changed. The `dist` bundle is rebuilt and the mirrors are in sync. |
| AC-9: Decision record | Pass | The new `##` entry follows the GPT-6 entry (the #69 entry sits between them). It covers all required elements, with a separate plan paragraph citing #68. |
| AC-10: Routing documented | Pass | The Phase Routing row is at `docs/pipeline-orchestrator.md:380`, and the mirror is identical. |

### Dropped Sections Check

- [x] Non-goals respected (no out-of-scope work)
- [x] Known Risks addressed or documented as accepted
- [x] Human Test Plan is satisfiable by the implementation

Every committed file is in Affected Files. The uncommitted working-tree files are pipeline telemetry and artifacts.

### Stage 1 Verdict

- [x] **Pass** — proceed to Stage 2
- [ ] **Fail** — skip Stage 2, final verdict below is `Changes requested`

## Stage 2 — Code Quality (only if Stage 1 passed)

### Summary

The implementation is tight and matches the spec. The routing stop is narrow: only a reviewer-set code_review `blocked` reaches it, because every orchestrator auto-block exits before `checkAndRoute`. The preamble sits at the single spawn point in `runClaude`, so fresh, resumed, fallback and retry calls all get it. The tests cover each AC with a red run the lenses reproduced. No blocking findings survived. One cold-Claude finding is a real residual gap outside what the spec covers, and it deserves a follow-up (first item under Risk / Guardrails).

### Findings

#### Correctness Bugs

(none)

#### Risk / Guardrails

- **Non-blocking follow-up: the retry path can still push toward a made-up verdict when the foreman stops between writing `review.md` and running `blocked`.** Altitude: out-of-spec residual; tracked as a follow-up, not a spec-gap halt. Source: cold-Claude. Location: `src/orchestrator/main.ts:3200` and `main.ts:3079-3086`.
  - This holds against the code. The blocked check runs once, before the recovery loop. Suppose the foreman writes a no-verdict `review.md` but its turn ends (budget cap, early stop) before it runs `code_review blocked`. The status stays `in_progress`, evidence recovery fails because no verdict is checked, and `retryAgentForPhase` sends `canon task phase <id> code_review done <verdict>`. That is the pressure Problem item 1 set out to remove.
  - If the foreman runs `blocked` during the retry, the retry returns `drift` and the run exits 2 with the generic message: no escalation and no `reset-code-review` guidance.
  - The spec's Interaction Dependencies reason only about a `blocked` that is already set when `checkAndRoute` runs. The implementation matches the spec, and the path needs two unlikely events in a row, so this does not block.
  - Suggested follow-up issue, two parts. (a) Re-check for `blocked` after a code_review retry returns `drift`, and route it to `stopForReviewerBlock`. (b) Have the code_review retry prompt offer `blocked` when `review.md` is filled but has no checked verdict.
- **Red-first replay for AC-1 crashes the file instead of failing one test.** Altitude: code-bug (test ergonomics), low severity, non-blocking. Source: anchored. Location: `tests/run-task-prompts.test.ts:20`.
  - The file imports `CLAUDE_HEADLESS` by name at the top, so against the pre-change `helpers.ts` the whole file fails to load.
  - AC-3's rule to use a dynamic import applies to the fake-claude tests, and those follow it. The AC-1 assertion itself was independently shown to fail correctly against the old template, so the behavior is proven. Only the recorded red command can't be replayed as written.
  - Optional fix: use a namespace import in this file too.

#### Optional Cleanup / Nit

- **Re-spawn limit is ambiguous (flagged by 2 lenses: anchored and cold-Claude).** Location: `src/orchestrator/prompts/templates/code-review-foreman.md:122` vs `:124`. "At most one re-spawn of a lens whose return is missing" reads as one in total, while "Re-spawn a missing lens once" reads as once per lens. Say "one re-spawn per missing lens" so a foreman with two malformed returns knows it may retry both. Decision §3 has the same ambiguity.
- **Step order in `plan-reroute.md`.** Location: `src/orchestrator/prompts/templates/plan-reroute.md:19`. The feasibility check is step 7 and begins "Before writing steps", but step 6 already asks for the steps. Moving it before step 6, or rewording it, would remove the contradiction. Source: anchored.
- **Dangling reference repaired as plain prose.** Location: `docs/decisions.md:451`. The rebaseline spec is not absent: it is at `tasks/_archive/rebaseline-claude-matrix-for-5-5/spec.md`, which I verified exists. `decisions.md` already cites `tasks/_archive/` paths, so a link would pass `docs-refs-check` and keep the pointer. Source: anchored.
- **Operator recovery guide doesn't cover the new stop.** Location: `.claude/skills/canon-pipeline/recovery.md`. It doesn't mention the reviewer-set `blocked` stop. The stop message is self-describing and `spec_gap` isn't there either, so this matches precedent. Source: anchored, low confidence.

#### Spec Gaps

(none that halt)

The anchored lens noted that two plan-writing surfaces lack the feasibility check: the operator-run XS path in `.claude/skills/canon-spec/SKILL.md` and the fast-tier "Also update plan.md" line in `spec-revision.md`. The spec's Non-Goals exclude `spec-revision.md` deliberately, and the plan phase logged the gap in `notes.md`. So this is a scoped choice, not an ambiguity the implementer had to guess at, and it is recorded here as a candidate follow-up under `docs/patterns.md` §"A rule homed on multiple guidance surfaces must reach every tier — and carry its full predicate at every occurrence".

### Dismissed Cold Findings

- Dismissed (cold-Claude): a template `review.md` plus `blocked` is reset to `pending` by the post-foreman check, so the stop is lost (`phases/code-review.ts:447`). Reason: the spec's Known Risks accept this explicitly ("A `blocked` without a written `review.md` still retries … That is correct"), and the foreman prompt orders the write before the command.
- Dismissed (cold-Claude): a strict charter format turns small format drift into hard stops (`code-review-foreman.md:247`). Reason: this is the spec's design. Known Risks say "The valid/missing split is structural (the charter format, or not)", and the Known Risks entry on the `blocked` outcome accepts stops that reach the human as the intended trade. The clean empty forms are now explicit in both charters, which narrows accidental drift.
- Dismissed (cold-Claude): a hand-set code_review `blocked` gets the reviewer-stop message and an escalation (`main.ts:3174`). Reason: AC-1b defines the branch as any code_review `blocked`. Stopping for the human is the correct outcome whoever set the status, and the lens itself rated this low/low.
- Dismissed (cold-Claude): the stop message prints relative `tasks/<id>/review.md` paths, which are wrong in worktree mode (`main.ts:3176`). Reason: this matches the existing stop messages (for example the spec_review stop at `main.ts:3305`), and the review file is meant to be read in the task's worktree, where the operator works on the task.
- Dismissed (cold-Claude): the preamble is re-sent on every resumed prompt (`claude.ts:108`). Reason: AC-3 requires this. A resumed or fallback call must carry the preamble, so stripping it would be a regression.
- Dismissed (cold-Claude): test integrity, meaning no tests cover `blocked` arriving during the retry or a template-plus-`blocked` combination (`tests/run-task-code-review.test.ts:971`). Reason: no existing test is weakened or compromised. The first case is folded into the follow-up under Risk / Guardrails, and the second is spec-accepted (see above).
- Cold-Codex: no findings were reported ("no actionable regressions"), so there is nothing to dismiss.

## Final Verdict

- [ ] **Approved** — ship as-is
- [x] **Approved with nits** — ship after addressing optional items (or not)
- [ ] **Changes requested** — must address Stage 1 failures or Stage 2 correctness/risk items before shipping
- [ ] **Spec gap** - root cause is the spec, not the code; halt for human instead of routing to implement

---

<!--
On re-review, append below this line:

Heading rule for ANY append to this file: only real review rounds may use a
`## Round N` heading. The verdict parser scopes to the latest `## Round` body —
an administrative block (pre-flight rejection, halt note, audit stamp) headed
`## Round …` with no verdict checkbox makes the parser return no verdict and
breaks routing. Administrative appends use a non-Round heading (e.g.
`## Pre-Flight Rejection (round N)`) and omit the verdict checkbox entirely.
-->
