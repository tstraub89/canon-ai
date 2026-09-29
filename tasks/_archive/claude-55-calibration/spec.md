# Spec: claude-55-calibration — Calibrate Claude pipeline prompts for the 5.5 generation

> Written by: Claude | Review by: Codex
> Status: draft
> Size: M | delicate: true (edits every unattended Claude phase preamble, both code-review lens charters, and code_review routing; a miscalibrated reviewer silently degrades every later review)
> Supersedes Codex's human-authorized draft, preserved at `tasks/claude-55-calibration/spec.codex-draft.md`. That draft's model-routing change and evaluation protocol are dropped here. Model and effort defaults move to the separate `rebaseline-claude-matrix-for-5-5` task.

## Problem

`docs/decisions.md` §"Guardrail prompts carry an implicit model-strength calibration (2026-07)" requires review and guardrail prompts to be re-checked whenever the default model generation changes, and names "silence is failure" framing and unbounded scope as the patterns to look for. The Codex-side audit ran for the GPT-6 bump (the paragraph at `docs/decisions.md:432`) and produced `CODEX_HEADLESS`. The Claude-side audit has not run, although canon's `opus`/`sonnet` aliases now resolve to the 5.5 generation. Reading the current Claude prompts turned up three calibration issues, plus a fourth issue in plans (confirmed by reading the files cited; this is prompt calibration, not a reproduced runtime regression):

1. **Contradictory clean-result instruction.** `src/orchestrator/prompts/templates/code-review-foreman.md:126` tells the foreman "a quiet lens output is a bug in the lens, not a clean diff." The cold lens charter (`.claude/agents/code-review-cold.md:34-39`) defines `COLD_FINDINGS: (none)` / `COLD_OVERALL_SIGNAL: approve` as its valid clean return, and the anchored charter has no empty form at all. A literal model that reads the foreman line will treat a legitimate clean review as a failure. Nothing defines what the foreman should do when a lens really returns nothing usable, and the orchestrator has no way for a reviewer to stop the run without a verdict. `checkAndRoute` (`src/orchestrator/main.ts:3175-3212`) treats every code_review status other than `done`, including an agent-set `blocked`, as an unfinished phase. It tries evidence recovery, which needs a checked verdict (`main.ts:2988-2995`), then resumes Claude with an instruction to run `code_review done <verdict>` (`main.ts:3079-3131`). A reviewer that stops honestly is pushed toward inventing a verdict. (Confirmed by tracing that path during spec_review; the only caller of `checkAndRoute` is the phase loop at `main.ts:3690`.)
2. **No unattended-session contract for Claude.** `runClaude` (`src/orchestrator/agents/claude.ts:57-120`) sends the rendered prompt unchanged in unattended (`-p`) mode. No Claude phase is told that nobody will answer questions, what to do with ambiguity, that finishing means writing the artifact and running the phase command, or that it must not continue into other phases. `CODEX_HEADLESS` (`src/orchestrator/prompts/helpers.ts:27-30`) covers all of this for Codex, prepended only on non-interactive calls (`src/orchestrator/agents/codex.ts:42-43`). Anthropic's Opus 5.5 prompting guidance warns that unattended progress reports can end a turn before completion.
3. **Unbounded review delegation.** The foreman spawns its two lenses (`code-review-foreman.md:94-120`), but nothing says it may spawn *only* those. Neither charter says a lens must do its own review rather than spawn further reviewers. Anthropic's Sonnet 5.5 launch notes that at max effort the model more often launched Claude Code's multi-agent code-review skill and made out-of-scope edits.
4. **Plans have no feasibility check.** `plan.md` asks for ordered steps, files, and patterns (`src/orchestrator/prompts/templates/plan.md:7-14`). `plan-reroute.md` and the fast-tier combined spec/plan instruction (`src/orchestrator/prompts/index.ts:84,87`) ask the same. No phase reviews `plan.md` before Codex implements from it (`implement.md:13` treats it as guidance). A 2026-09-28 read-only analysis of 422 archived canon and adopter tasks found:
   - **Codex follows plans closely.** It changed approach substantively in only 6% of tasks.
   - **Plans cause a large share of review defects.** In a sample of 11 changes-requested tasks, about 40% of the non-hygiene blocking findings traced to something the plan got wrong or left out. Those findings fell into three groups:
     - the plan prescribed the wrong mechanism, without tracing the real runtime path;
     - it prescribed a regression test that can't fail when the code is wrong;
     - it missed a caller or file a search would have found, including unexamined boundary values in predicates it wrote out.
   - **Plans also do real work.** The plan caught a genuine feasibility problem in 6 of the 11 tasks.

   The data is observational, its classification was not checked against the code, and the sample is small. That is enough to aim this check, not enough to justify a plan-review phase, which tstraub89/canon-ai#68 tracks. Item 4 is a plan-quality fix rather than a model-calibration one. It rides in this task because it edits the same prompt surfaces, and the model change in `rebaseline-claude-matrix-for-5-5` already moves plan quality in the same release, so shipping it separately would not make the #68 re-measurement cleaner.

## Decision

1. **Valid, clean, and missing lens returns.**
   - **Valid:** a return in the lens's charter format. That includes the charter's empty form (a clean review) and the anchored lens's Stage-1-fail form (no Stage 2, `OVERALL_SIGNAL: changes_requested`).
   - **Missing:** an absent return, or one that doesn't follow the charter format.
   - **What changes:** the foreman's "quiet lens output is a bug" sentence is replaced with this distinction. A clean return is valid evidence. A missing lens is re-spawned once. If it is still missing, the foreman records that in `review.md`, checks no verdict box, and runs `canon task phase <id> code_review blocked` (no verdict) for every task in the review. It does not approve, and it does not guess at findings.
   - **Lenses:** they keep their over-report instruction ("Coverage is your job; filtering is not."). The anchored charter gains the literal empty form `STAGE_2_FINDINGS: (none)`.
   - **Orchestrator routing:** a reviewer's `blocked` becomes a real stop. After the code_review phase runs, if any task in the run has code_review status `blocked`, the orchestrator treats it as a deliberate stop for the human, not an unfinished phase:
     - no task in the run gets evidence recovery or a retry;
     - code_review is blocked for the whole bundle with an escalation, as the `spec_gap` stop does, because bundle members share one branch;
     - the stop message names each task's `review.md` and the recovery (`canon task reset-code-review <id>`, then `canon run <id>`);
     - the run exits with the pipeline's existing stop-for-human exit code (2).

     This is a new branch in `checkAndRoute`, checked before its per-task recovery loop. Every other status, every other phase, and the existing post-foreman reset keep their current behavior. (That reset puts code_review back to `pending` when `review.md` is still the unfilled template, `src/orchestrator/phases/code-review.ts:449-452`, so a `blocked` with no written `review.md` still gets the normal retry.)
   - **Unchanged:** verdict rules, finding categories, the round-3+ tighten line, and cold-lens blindness.
2. **`CLAUDE_HEADLESS`, on unattended Claude calls only.** A new exported constant, the Claude counterpart to `CODEX_HEADLESS`.
   - **Where it goes:** `runClaude` prepends it inside its unattended `attempt()`, *after* any resume wrapping, the same order as `codex.ts:42-43`. A resumed prompt therefore begins with the preamble, followed by the `[Resumed session` marker. One placement covers fresh calls, resumed calls, the resume-not-found fallback, and the retry path (`src/orchestrator/main.ts:3131`). The interactive branch never receives it.
   - **What it states:**
     - nobody reads messages or answers questions until the phase ends;
     - ambiguity is recorded, with the interpretation chosen, in the phase artifact or `tasks/<id>/notes.md`, and the phase proceeds;
     - the phase is complete only when its artifact is written and its phase command has run; a progress summary or an offer to continue is not completion;
     - do only this phase: don't run `canon run`, advance another phase, or start review passes, review skills, or reviewer sub-agents the prompt didn't ask for;
     - a check that couldn't run or failed is reported as such, never as passed;
     - if a project instruction file says to ask or wait for approval before an action, there is no one to ask. Skip that action unless this prompt explicitly authorizes it, record the question in the phase artifact, and continue with the rest of the authorized work.
3. **Delegation is bounded to the prescribed protocol.** The foreman spawns exactly the two Claude lenses per round, plus at most one re-spawn of a missing lens. It spawns no other reviewers, and it never substitutes its own review for a lens's. Both charters state that the lens does its review itself and spawns no sub-agents.
4. **Plans record a proportional feasibility check.** Before writing steps, the planner confirms:
   - the functions, files, and patterns the plan relies on exist, found by searching rather than recalled;
   - **the real path:** the actual runtime call path the change sits on, including any existing code on it that already does part of the work;
   - **callers:** every caller of each function whose behavior or error contract changes is found and accounted for;
   - **tests that can fail:** for each prescribed regression test, the input or state that sends it through the changed path, so it fails without the change;
   - **predicates:** for any condition or state check the plan writes out, its boundary values (for example zero, empty, or non-numeric) and every state it must handle;
   - every file the steps change is inside the spec's Affected Files;
   - for async or stateful changes: re-entry, cancellation or unmount, stale state, and ownership.

   Results go in a few lines:
   - in the plan's Approach section, for `plan.md` and the fast-tier combined plan;
   - at the top of the appended Delta section, for `plan-reroute.md`, which is append-only.

   An element that doesn't apply is marked N/A in a word, which keeps XS plans short. A contradiction with the spec is recorded in the plan and in `notes.md` with a `[plan]` prefix. It is never resolved by changing the spec or widening scope.

## Non-Goals

- No model, effort, or budget changes. That is `rebaseline-claude-matrix-for-5-5`.
- No change to Codex prompts, `CODEX_HEADLESS`, or `CODEX_STARTUP`.
- No change to verdict rules, finding categories, the round-3+ tighten line, review topology (three lenses), or the inputs each lens receives.
- No edits to the `spec.md`, `spec-revision.md`, or `qa.md` templates. The completion contract reaches those phases through the preamble.
- No new `.canon/templates/plan.md` section.
- No tool or permission restrictions on sub-agents. The delegation bound is prompt-level.
- No plan-review phase or other new pipeline phase (tstraub89/canon-ai#68 decides that after re-measurement).
- No change to what `--interactive` sessions receive, beyond the foreman, charter, and plan edits every mode shares.
- No routing change for `blocked` in any phase other than code_review, or for any code_review status other than `blocked`. Evidence recovery and the one-shot retry keep serving every other incomplete phase.

## Acceptance Criteria

**Rule for all prompt-text ACs:** tests assert stable keyword tokens (for example `re-spawn`, `approval evidence`, `blocked`, `callers`, `Affected Files`), not full sentences. Wording around the tokens is free. These assertions prove the text is present. They do not prove the model will behave accordingly, and the handoff must not claim otherwise.

- [ ] **AC-1: Clean-result contradiction removed (red-first).** A test over all four code-review goldens' render paths (`promptCodeReview_round1`, `_roundN`, `_deltaRound`, `_fullSendOutOfScope`) asserts:
  - the prompt does not match `/quiet lens output is a bug/`;
  - it names the charter empty form and the anchored Stage-1-fail form as valid returns;
  - a missing lens is re-spawned once, then recorded in `review.md` with no verdict box checked, not treated as approval evidence, and followed by the rendered `code_review blocked` command (no verdict) for every task in the review.

  The handoff records a run where the first assertion fails against the pre-change template.
- [ ] **AC-1b: A reviewer's `blocked` stops the run (red-first).** Tests drive `checkAndRoute('code_review', …)` in a fixture, using the existing `runCheckAndRouteInFixture` harness in `tests/run-task-code-review.test.ts`. Each fixture task has implement `done`, a filled `review.md` with no checked verdict, and no stored `claude_review` session, so the pre-change code can't spawn a real `claude`.
  - **Single task, code_review `blocked`:** the process exits 2; code_review is still `blocked`; `status.json` gains one escalation for code_review; the output names the task's `review.md` and `reset-code-review`; the output does not contain the evidence-recovery warning (`Evidence insufficient`), which is also the line that announces the retry.
  - **Bundle of two, one `blocked` and one `in_progress`:** the process exits 2; both tasks end with code_review `blocked` and an escalation; neither gets evidence recovery.
  - **Recovery:** after the stop, `canon task reset-code-review <id>` succeeds and leaves implement `done` and code_review `pending`.
  - **Unchanged path:** a code_review `in_progress` task with the same `review.md` still takes the evidence-recovery path (its output contains "Evidence insufficient").

  The handoff records a red run where the single-task case fails against the pre-change `checkAndRoute`. Today the recovery warning appears and no escalation is recorded.
- [ ] **AC-2: Explicit clean forms in both charters.** A test asserts:
  - `.claude/agents/code-review-anchored.md` contains the literal `STAGE_2_FINDINGS: (none)` in its return format;
  - the cold charter still contains `COLD_FINDINGS: (none)`;
  - both charters still contain "Coverage is your job; filtering is not."
- [ ] **AC-3: Preamble reaches unattended calls only (red-first).** Fake-`claude` tests modeled on the Codex headless test (`tests/run-task-code-review.test.ts:932-965`, which JSON-encodes argv so a multi-line prompt survives) assert:
  - an unattended fresh call's `-p` prompt begins with `CLAUDE_HEADLESS`;
  - an unattended resumed call's prompt begins with `CLAUDE_HEADLESS` and contains the `[Resumed session` marker after it;
  - an unattended call whose resume id isn't found, where the fake prints "No conversation found with session ID", falls back to a fresh prompt that still begins with `CLAUDE_HEADLESS`;
  - an interactive call's prompt does not contain `CLAUDE_HEADLESS`.

  Tests reach `CLAUDE_HEADLESS` through a namespace or dynamic import, so the red run fails per test rather than crashing the whole file. The handoff records the red run for every positive assertion.
- [ ] **AC-4: Preamble content.** A test asserts `CLAUDE_HEADLESS` carries a token for each Decision §2 element, including the ask/wait rule's "skip unless authorized" direction. It also asserts `CLAUDE_STARTUP` contains none of them, so interactive sessions never receive the preamble through the shared startup block. That is the leak the GPT-6 Codex task hit (`docs/task-quality-log.md`, 2026-09-24 row).
- [ ] **AC-5: Delegation bound.** Assertions confirm:
  - the foreman prompt limits spawning to the two Claude lenses plus one re-spawn, and forbids substituting its own review;
  - each charter says the lens reviews itself and spawns no sub-agents;
  - `CLAUDE_HEADLESS` forbids unrequested review passes and reviewer sub-agents.

  The existing foreman and charter tests (`tests/run-task-prompts.test.ts:537`, `:709`, `:721`) still pass.
- [ ] **AC-6: Feasibility content.** A test on the rendered `promptPlan` output asserts a token for each Decision §4 element, the N/A allowance, and the contradiction rule (plan + `notes.md` `[plan]`; spec unchanged; no scope widening).
- [ ] **AC-7: Feasibility in every planning path, and nowhere else.**
  - **`promptPlan`:** single and bundle renders carry the instruction, with Approach placement.
  - **Reroute `promptPlan`:** the instruction sits in the shared steps under the EXEMPT-skip header (`plan-reroute.md:10`), with Delta placement. An exempt sibling's own verdict line contains no feasibility text (extend the exempt test at `tests/run-task-prompts.test.ts:319`).
  - **`promptSpec` at the fast tier:** the combined instruction carries it in both the single-task and bundle strings, and the combined `selfCheck` bullet asks for the feasibility check. These are new non-golden tests, because the goldens render at the full tier.
  - **`promptSpec` at the full tier:** unchanged.
- [ ] **AC-8: Goldens and bundle.**
  - `tests/run-task-prompts.golden.json` is regenerated with `UPDATE_GOLDENS=1 npm test`.
  - Only these keys change: the four `promptCodeReview_*` keys, `promptPlan`, `promptPlan_reroute_round1`, and `promptPlan_reroute_bundle`. All other keys are byte-identical, since `CLAUDE_HEADLESS` is added in `runClaude` and never appears in a golden.
  - `dist/orchestrator/run-task.js` is rebuilt with `npm run build`.
  - The charter and `docs/pipeline-orchestrator.md` edits are mirrored with `npm run sync-templates`, and `npm run sync-templates:check` passes. That script's internal-path guard means the mirrored files may not cite `src/orchestrator/` paths or the foreman or reroute template filenames.
- [ ] **AC-9: Decision record.** `docs/decisions.md` gains a new `##` entry, "Claude prompt calibration audit (2026-09)", placed after the GPT-6 Codex entry. It records:
  - what was audited;
  - the three calibration fixes, including that a reviewer-set code_review `blocked` is a stop for the human, never recovered into a verdict;
  - the rule that `CLAUDE_HEADLESS` must never move into `CLAUDE_STARTUP`;
  - in its own paragraph, the plan feasibility check, with the analysis summary and a pointer to tstraub89/canon-ai#68.

  `npm run docs-refs-check` passes.
- [ ] **AC-10: Routing documented.** The Phase Routing table in `docs/pipeline-orchestrator.md` gains a code_review row for a reviewer-set `blocked` (no verdict). The row says the whole bundle blocks with an escalation, no retry is attempted, and recovery is `canon task reset-code-review <id>` then `canon run <id>`. Verify with a grep for a Phase Routing table row containing `code_review`, `blocked`, and `reset-code-review`, recorded in the handoff, plus `npm run sync-templates:check` (AC-8).

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/prompts/helpers.ts` | Add exported `CLAUDE_HEADLESS` |
| `src/orchestrator/agents/claude.ts` | Prepend `CLAUDE_HEADLESS` inside the unattended `attempt()` after resume wrapping |
| `src/orchestrator/prompts/templates/code-review-foreman.md` | Valid/clean/missing rule with `blocked` outcome and its rendered commands; delegation bound |
| `src/orchestrator/main.ts` | `checkAndRoute`: stop branch for an agent-set code_review `blocked`, before the per-task recovery loop (Decision §1, orchestrator routing) |
| `src/orchestrator/prompts/templates/plan.md` | Feasibility check, Approach placement, N/A allowance, contradiction rule |
| `src/orchestrator/prompts/templates/plan-reroute.md` | Same, in the shared steps, placed at the top of the Delta section |
| `src/orchestrator/prompts/index.ts` | Feasibility text in the fast-tier combined instruction (single + bundle) and the combined `selfCheck` bullet; `promptCodeReview` renders the `code_review blocked` commands for the foreman |
| `.claude/agents/code-review-anchored.md` | `STAGE_2_FINDINGS: (none)` form; no-sub-agent line |
| `.claude/agents/code-review-cold.md` | No-sub-agent line |
| `templates/.claude/agents/code-review-anchored.md` | Generated mirror |
| `templates/.claude/agents/code-review-cold.md` | Generated mirror |
| `tests/run-task-prompts.test.ts` | AC-1, AC-2, AC-4–AC-7 tests |
| `tests/run-task-code-review.test.ts` | AC-3 fake-`claude` preamble tests, beside the Codex headless test; AC-1b routing tests |
| `tests/run-task-prompts.golden.json` | Regenerated |
| `docs/decisions.md` | AC-9 entry |
| `docs/pipeline-orchestrator.md` | New row in the Phase Routing table for a reviewer-set code_review `blocked` (AC-10) |
| `templates/docs/pipeline-orchestrator.md` | Generated mirror |
| `dist/orchestrator/run-task.js` | Rebuilt bundle |

### Interaction Dependencies

- The retry path (`src/orchestrator/main.ts:3131`) calls `runClaude(prompt, false, …)`, so the preamble reaches it through `attempt()`. The new `blocked` branch means that retry is never sent for a reviewer-set code_review `blocked`, so the retry prompt's `done <verdict>` instruction can't override the foreman's stop.
- Order inside a code_review run: the foreman sets `blocked` → the post-foreman check in `runCodeReviewPhase` resets code_review to `pending` only if `review.md` is still the template → `checkAndRoute` sees `blocked` and stops. The foreman prompt therefore requires writing `review.md` before running the `blocked` command.
- After the stop, `canon task reset-code-review` already works: code_review is the task's current phase because `blocked` is not `done`. Re-running `canon run` without the reset starts another code_review pass without archiving the stopped `review.md`, which is why the stop message points to the reset.
- The phase loop stores the foreman's `claude_review` session before calling `checkAndRoute` (`main.ts:3672-3690`), so in production the pre-change code would really resume that session with the `done <verdict>` retry. The AC-1b fixtures omit the session only so the pre-change red run can't spawn a real `claude`.
- The foreman gets the preamble only when unattended (`phases/code-review.ts:437` passes `interactive`). The lenses are its sub-agents, not `runClaude` calls, so their bound comes from the charters.
- Charter edits reach adopters through `canon upgrade`. The foreman and plan prompts reach them through the npm bundle.
- `rebaseline-claude-matrix-for-5-5` also edits `docs/decisions.md` and `docs/pipeline-orchestrator.md` (different sections: the Claude matrix and env-var rows, not the Phase Routing table) and rebuilds `dist/orchestrator/run-task.js`. Whichever lands second rebases, re-syncs the template mirrors, and rebuilds.
- The main checkout carries an uncommitted edit to `docs/pipeline-orchestrator.md` and its mirror (the `/canon-spec-review` bullet in the full-tier list). This task's worktree doesn't include it, and the edit sits outside the Phase Routing table, so the two should not conflict textually. The human commits that edit separately.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm run sync-templates:check` (after `npm run sync-templates`)
- [x] `npm run docs-refs-check`

## Docs Impact

- `docs/decisions.md` (AC-9, listed).
- `docs/pipeline-orchestrator.md`: one Phase Routing row for the new stop (AC-10, listed). It does not describe the Codex headless block, so it needs no Claude-preamble equivalent.
- The other protected docs are unaffected.

## Known Risks

- **Recall loss from "clean is valid."** Softening the foreman could slide into accepting thin lens output. The valid/missing split is structural (the charter format, or not), and the lenses' over-report instruction is untouched (AC-2).
- **The `blocked` outcome is new foreman behavior.** A lens that fails twice now stops the run where it used to be quietly absorbed. That is the intended trade: the human sees it.
- **The new routing branch could swallow other states.** It must fire only for code_review `blocked`. A wider branch would turn ordinary incomplete phases into hard stops and skip the recovery that normally rescues them. AC-1b's unchanged-path case pins the boundary.
- **A `blocked` without a written `review.md` still retries.** The existing post-foreman reset returns an unfilled review to `pending` before routing runs. That is correct (there is no record of why the reviewer stopped), but it means the stop depends on the foreman writing `review.md` first. The foreman prompt orders it that way (AC-1).
- **A mixed bundle blocks approved siblings.** If the foreman marks only some bundle members `blocked`, the approved ones are blocked too and need the reset. This matches the `spec_gap` stop and is rare, since both lenses review the whole bundle at once.
- **Preamble leaking into interactive sessions.** This is the GPT-6 Codex task's exact failure mode. AC-3 and AC-4 pin the invocation-mode split and keep the text out of `CLAUDE_STARTUP`.
- **Preamble lost on resume or fallback.** Either would silently strip the contract from revision rounds. AC-3 covers both.
- **"Continue" read as permission.** Unattended Claude runs with skipped permission prompts, so an instruction to continue could be read as licence to perform a gated action. The preamble says to skip gated actions unless the prompt authorizes them (AC-4).
- **Feasibility bloat.** Plans are already long (median about 220 lines at S and 400 at M). The instruction asks for results in a few lines, N/A in a word, and findings that change a step go in that step.
- **The check becomes a checkbox.** A planner could claim a search it didn't run. Naming the callers and the failing-test input makes an empty claim visible to code_review and to a human reader. There is still no gate enforcing it.

## Human Test Plan

1. Run a small task through the pipeline where the change is clean. Expected: code review approves without inventing findings.
2. Run a task with a planted defect (for example, an off-by-one in a tested function). Expected: code review still requests changes for it.
3. Stop a code review partway by making one reviewer return nothing usable twice (for example, a temporarily broken reviewer definition). Expected: the run stops and tells you which review file to read and how to restart the review; it does not approve, and it does not quietly retry into a verdict.
4. Watch an unattended run end to end. Expected: each Claude phase finishes by writing its file and advancing its own phase, without ending on a summary or an offer to continue, and never starts the next phase itself.
5. Start a run with the interactive flag. Expected: the session can still stop and ask you a question.
6. Read the plan written for a medium task. Expected:
   - its approach briefly confirms that the code it relies on exists and follows the real path the change touches;
   - it names who else calls anything the change affects;
   - it says what input makes each new test fail without the fix;
   - any conflict with the spec is called out rather than worked around.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it
- [x] Affected Files lists specific files with specific change descriptions
- [x] Plan steps (fast tier) — N/A, full tier
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only
- [x] Validation Required has at least one entry marked `- [x]`
- [x] Bug/flake fixes — mostly N/A (prompt calibration). The `blocked` routing gap is deterministic, confirmed by the code trace cited in *Problem* item 1, and has a red-first AC (AC-1b); the prompt contradiction and missing preamble also have red-first ACs (AC-1, AC-3)
