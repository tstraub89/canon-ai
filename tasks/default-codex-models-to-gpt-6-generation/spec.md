# Spec: default-codex-models-to-gpt-6-generation — Default Codex models to GPT-6 Luna/Sol and harden prompts for headless runs

> Written by: Claude | Review by: Codex
> Status: draft

## Problem

Two related gaps, both triggered by OpenAI's GPT-6 Sol/Luna release (2026-09-22):

1. **Shipped Codex defaults are a generation behind.** Adopters who don't set `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL` get `gpt-5.6-luna` / `gpt-5.6-sol`. The GPT-6 counterparts cost half as much per token: Sol goes from $4/$20 to $2/$10 and Luna from $0.20/$1.20 to $0.10/$0.50 per 1M input/output tokens. Both model IDs were verified resolvable via a `codex exec -m <id>` probe on 2026-09-23. GPT-6 Astra, the flagship, is deliberately not adopted because its cost doesn't fit canon's token-discipline thesis.
   - **Sol** improves on coding: the Artificial Analysis Coding Agent Index rises 55→57, Terminal-Bench 37→43%, and SWE-Atlas-QnA 54→58%.
   - **Luna** slightly regresses on coding while costing ~60% less per task: Coding Agent Index 43→41, SWE-Atlas-QnA 49→44%, DeepSWE 66→64%. It also emits ~25% more output tokens. Canon routes every XS–L phase to the mini model, so this trade-off lands on most runs and must be recorded along with a follow-up measurement and a rollback path.

2. **Canon's Codex prompts never say the session is headless.** `docs/decisions.md` §"Guardrail prompts carry an implicit model-strength calibration" requires re-checking reviewer and guardrail prompts on every default-generation bump. OpenAI's GPT-6 migration guidance says the model "asks clarifications more readily" unless told to "bias towards action". It also says the model is "more sensitive to instructions contained in skills and other files".
   - Under `codex exec`, nobody answers a question. A final message that asks for clarification simply ends the turn. The phase never reaches `done`, and the orchestrator stops with "Phase '…' did not reach 'done' … Stopping for human review." That failure is loud, but it costs a human interrupt that the prompt could have prevented.
   - The audit of the five Codex prompt templates plus `CODEX_STARTUP` found four concrete issues:
     - (a) No prompt states that the session is non-interactive.
     - (b) Three instructions say "stop" in a way a literal model can read as "end the session" rather than "stop this edit": `implement.md` Scope Discipline rule 1, `implement.md`'s Red-First Checkpoint, and `implement-revisions.md`'s red-first bullet.
     - (c) Nothing tells Codex what to do when a project instruction file it auto-loads says "ask before X".
     - (d) `CODEX_STARTUP` carries a "Branch sync (non-pipeline sessions)" instruction with `git fetch`/`git pull --rebase` commands. `CODEX_STARTUP` is only ever rendered into pipeline prompts, so the model is asked to classify its own session next to commands it must not run.
   - `spec-review.md` passed the calibration check unchanged: it has no "push harder" framing, no "silence is failure" framing, and an explicit scope boundary.

## Decision

- **Defaults.** Change the two shipped Codex fallback defaults to `gpt-6-luna` (mini) and `gpt-6-sol` (full). Env-var names, precedence chains, routing, and the model/effort matrix are unchanged.
- **Headless paragraph.** Add a headless / bias-to-action paragraph to the shared Codex startup block, so every non-resumed Codex pipeline prompt (spec review, amendment review, implement, implement revisions, implement reroute) carries it. It tells Codex:
  - The session is non-interactive: nobody reads its chat messages or answers questions mid-session, so it must not stop to ask for confirmation or clarification.
  - To resolve an ambiguity, record the question and the interpretation it chose in the phase's artifact, then proceed on that interpretation. In implement, that record is a handoff Blocker labelled `[ambiguity]`.
  - Finish all the work the prompt authorizes before ending. Biasing toward action never expands scope: the Affected Files scope cap and the other scope rules still bind.
  - Always end by writing the phase artifact and running the phase command(s) the prompt lists, including when it recorded Blockers.
- **Instruction precedence.** Add one line to the startup block: if a project instruction file or other repository guidance says to ask the user, or to wait for approval before acting, there is no one to ask in this session. Record the question in the phase artifact and continue with the authorized work. The line must not assert what any adopter agent file contains, and it must not claim general precedence over project guidance. It covers only the ask/wait case.
- **Branch sync.** Replace the "Branch sync (non-pipeline sessions)" sentence with a plain statement that the orchestrator manages branch state: do not fetch, pull, rebase, or push, and read the working tree as-is.
- **The three "stop" instructions.** Reword each so that "stop" clearly means "don't make that edit or fix". Codex then records the labelled Blocker in the handoff, completes remaining work that doesn't depend on the blocked item, finishes the handoff, and runs the phase command.
  - The handoff is the channel that reaches a human. Blockers surface through `code_review`, whose `spec_gap` verdict halts the pipeline.
- **Docs.**
  - Update the current-state surfaces that name the 5.6 defaults or the "5.6-generation re-eval".
  - Add a dated `docs/decisions.md` entry recording: the re-baseline, the Astra rejection, the Luna trade-off with its follow-up measurement and rollback, and the prompt-audit outcome (what changed, and that `spec-review.md` passed unchanged).

This is a **minor** change under §"Versioning and release policy" (changed canon-supplied default). The CHANGELOG entry is written at release time, not in this task.

## Non-Goals

- **Effort tiers.** No re-evaluation of the model/effort matrix for GPT-6; the tiers in `src/lib/pipeline-policy.ts` are unchanged. OpenAI's guidance is to preserve current effort. Canon's Codex matrix uses only `medium`/`high`, both still supported.
- **Reviewer prompts.** No changes to `spec-review.md`, `spec-review-reroute.md`, `code-review-foreman.md`, the Claude lens charters, or the cold-Codex lens. The cold-Codex lens uses Codex's built-in `codex exec review` prompt, which canon doesn't author.
- **`implement-reroute.md`.** No edits. Its red-first paragraph uses "record a `[wrong-premise]` Blocker instead of implementing" with no bare "stop", and the new startup paragraph covers its end-of-session behavior.
- **Other prompt cleanups.** No dedup of the grounding rule repeated across `CODEX_STARTUP` and the templates, and no tone change to the all-caps reroute banner.
- **Claude models.** No Claude model changes. Canon's Claude defaults are the `opus`/`sonnet` aliases, which already resolve to the current generation.
- **CHANGELOG.** No `CHANGELOG.md` edit; that's release-time.
- **Adopter agent files.** No new content that asserts what adopter `AGENTS.md` / `CLAUDE.md` contain.
- **Historical `5.6` references stay as they are.** These are `CHANGELOG.md`, the dated `docs/decisions.md` entries, `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `tasks/_archive/**`, `docs/harness-audit-2026-06.md`, and `docs/canon-opus48-gpt55-report.md`. AC-2 carries the permitted-to-remain list.

## Acceptance Criteria

- [ ] AC-1: **Defaults bumped in both config copies.**
  - In `src/orchestrator/env.ts` and `src/orchestrator/policy.ts`, `codexModelMini` falls back to `'gpt-6-luna'` and `codexModelFull` falls back to `'gpt-6-sol'`.
  - The override chains are otherwise byte-identical: `CODEX_MODEL_MINI ?? CODEX_MODEL_DEFAULT ?? …` and `CODEX_MODEL_FULL ?? CODEX_MODEL_DELICATE ?? …`.
  - Verify by reading both files, and with `git grep -n "gpt-6-luna\|gpt-6-sol" -- src/orchestrator/env.ts src/orchestrator/policy.ts`, which must return exactly 4 lines.
- [ ] AC-2: **No current-state surface names the retired defaults.**
  - `git grep -nE "gpt-5\.6-(luna|sol)" -- src dist tests docs/pipeline-orchestrator.md templates README.md .claude .canon docs/product-context.md docs/architecture.md docs/codebase-map.md docs/patterns.md` returns zero results.
  - Permitted to remain, not searched: `CHANGELOG.md`, `docs/decisions.md` (dated historical entries), `docs/pipeline-invocations.md`, `docs/task-quality-log.md`, `docs/lessons-learned.md`, `tasks/**`.
  - The env-var table in `docs/pipeline-orchestrator.md` shows `gpt-6-luna` / `gpt-6-sol` as the `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL` defaults, and `npm run sync-templates:check` passes (the mirror is synced).
- [ ] AC-3: **The headless paragraph is present in the Codex startup block.** `CODEX_STARTUP` contains text that conveys all four of these:
  - (a) The session is non-interactive: no one reads chat messages or answers questions mid-session, so do not stop to ask for confirmation or clarification.
  - (b) Resolve ambiguity by recording the question and the chosen interpretation in the phase's artifact, then proceeding on it. It names the handoff `[ambiguity]` Blocker for implement.
  - (c) Finish all work the prompt authorizes before ending, and this does not expand scope: the Affected Files cap and other scope rules still bind.
  - (d) Always end by writing the phase artifact and running the listed phase command(s), including when Blockers were recorded.
  - Verify by reading `CODEX_STARTUP`, and by the rendered goldens for `promptSpecReview`, `promptImplement_fresh`, `promptImplementRevisions`, and the non-resumed `promptImplementReroute` all containing it.
- [ ] AC-4: **The ask/approval precedence line is present and narrowly scoped.**
  - `CODEX_STARTUP` tells Codex that when a project instruction file or other repository guidance says to ask the user or wait for approval, it records the question in the phase artifact and continues with the authorized work.
  - The line does not name `AGENTS.md` or `CLAUDE.md`, does not describe their contents, and does not claim that the prompt overrides project guidance generally.
  - Verify by reading `CODEX_STARTUP`, and with `git grep -n "AGENTS.md\|CLAUDE.md" -- src/orchestrator/prompts/helpers.ts`, which returns zero results.
- [ ] AC-5: **The dead branch-sync instruction is replaced.**
  - `CODEX_STARTUP` no longer contains "Branch sync", `git fetch`, or `git pull`. It states that the orchestrator manages branch state, and that Codex must not fetch, pull, rebase, or push and should read the working tree as-is.
  - The existing Git-ownership rule (no `git add`/`commit`/`push`; read-only git is fine) and the `[pipeline]` Blocker instruction are unchanged in meaning.
  - Verify with `git grep -nE "Branch sync|git fetch|git pull" -- src/orchestrator/prompts/helpers.ts tests/run-task-prompts.golden.json`, which returns zero results.
- [ ] AC-6: **The three "stop" instructions mean "stop that edit", not "end the session".** Each of the following says, in its own words: don't make the out-of-scope edit or unconfirmed fix; record the labelled Blocker in `handoff.md`; complete remaining work that doesn't depend on the blocked item; finish the handoff; run the phase command.
  - `implement.md` Scope Discipline rule 1.
  - `implement.md` Bug/Flake-Fix Red-First Checkpoint (`[wrong-premise]`).
  - `implement-revisions.md` red-first bullet (`[wrong-premise]`).
  - The scope-cap rule states that the handoff Blocker is how the gap reaches a human.
  - The original phrases "stop, document the gap", "stop — the spec's mechanism is wrong", and "stop and record a `[wrong-premise]` Blocker" no longer appear. Verify with `git grep -nE "stop, document the gap|stop — the spec's mechanism is wrong|stop and record a" -- src/orchestrator/prompts/templates`, which returns zero results.
  - Every other rule in those paragraphs keeps its meaning. That means the no-silent-scope-expansion rule, the rule never to report an outcome for a run that didn't happen, and the environment-bound escape.
- [ ] AC-7: **Resume stripping still works with the new startup block.**
  - A new test in `tests/run-task-prompts.test.ts` asserts that `toResumePrompt(...)` removes `CODEX_STARTUP` from the rendered output of `promptSpecReview`, `promptImplement` (fresh), and `promptImplementRevisions`.
  - The returned string must not contain `CODEX_STARTUP` and must start with the `[Resumed session` banner.
  - The test passes on the post-change code.
- [ ] AC-8: **Stale "5.6-generation" pointers updated.**
  - `docs/product-context.md` (the Full-tier bullet) and the `codexMatrix` comment in `src/lib/pipeline-policy.ts` no longer say "pending 5.6-generation re-eval". Each now names the GPT-6 generation as the pending re-eval.
  - `docs/product-context.md` points at the new `docs/decisions.md` entry.
  - Verify with `git grep -n "5\.6-generation" -- docs/product-context.md src/lib/pipeline-policy.ts`, which returns zero results.
- [ ] AC-9: **New dated `docs/decisions.md` entry.** A new entry headed `## Model-generation re-baseline (2026-09): Codex defaults → GPT-6 generation` records:
  - (a) The default bump and that it is a minor change.
  - (b) Astra considered and rejected on cost.
  - (c) The Luna trade-off with the numbers from *Problem*.
  - (d) The follow-up measurement: compare M/L `code_review` reroute rate and iteration counts, as recorded in `docs/task-quality-log.md`, for tasks run on GPT-6 against the 5.6-era baseline.
  - (e) The rollback path: `CODEX_MODEL_MINI=gpt-5.6-luna`, and `CODEX_MODEL_FULL=gpt-5.6-sol` if needed, while the 5.6 models remain available.
  - (f) The prompt-audit outcome per §"Guardrail prompts carry an implicit model-strength calibration": the four fixes landed, and `spec-review.md` passed unchanged.
  - (g) That effort-tier re-evaluation remains a separate future task.
  - The 2026-07 5.6 entry is left intact as history. Verify by reading the entry.
- [ ] AC-10: **Build and goldens are current.**
  - `npm run build` produces no uncommitted diff under `dist/` after the change is committed.
  - `UPDATE_GOLDENS=1 npm test` has been run and `tests/run-task-prompts.golden.json` reflects the new `CODEX_STARTUP` and template text.
  - `npm test` then passes without `UPDATE_GOLDENS`.

## Design

### Affected Files

| File | Change |
|---|---|
| `src/orchestrator/env.ts` | Codex mini/full fallback defaults → `gpt-6-luna` / `gpt-6-sol` (AC-1). |
| `src/orchestrator/policy.ts` | Same two fallback defaults, duplicated copy (AC-1). |
| `src/orchestrator/prompts/helpers.ts` | `CODEX_STARTUP`: add the headless / bias-to-action paragraph and the ask/approval precedence line; replace the branch-sync sentence (AC-3, AC-4, AC-5). |
| `src/orchestrator/prompts/templates/implement.md` | Reword Scope Discipline rule 1 and the Red-First Checkpoint "stop" instructions (AC-6). |
| `src/orchestrator/prompts/templates/implement-revisions.md` | Reword the red-first bullet's "stop" instruction (AC-6). |
| `src/lib/pipeline-policy.ts` | `codexMatrix` comment: "5.6-generation re-eval" → GPT-6 generation (AC-8). Comment only; no matrix change. |
| `tests/run-task-prompts.test.ts` | New resume-stripping test (AC-7). |
| `tests/run-task-prompts.golden.json` | Regenerated goldens (AC-10). |
| `dist/cli/index.js` | Rebuilt bundle (inlines `env.ts`) (AC-10). |
| `dist/orchestrator/run-task.js` | Rebuilt bundle (inlines `env.ts`, `policy.ts`, prompts) (AC-10). |
| `docs/pipeline-orchestrator.md` | Codex model overrides table defaults (AC-2). |
| `templates/docs/pipeline-orchestrator.md` | Synced mirror via `npm run sync-templates` (AC-2). |
| `docs/product-context.md` | Full-tier bullet: GPT-6 re-eval pointer (AC-8). |
| `docs/decisions.md` | New 2026-09 re-baseline entry (AC-9). |

#### Implementation Notes (non-binding — plan/implement own the exact wording)

Suggested `CODEX_STARTUP` addition, placed after the grounding/resumed-session lines:

> Headless session: this runs non-interactively — nobody reads your messages or answers questions until the phase ends. Don't stop to ask for confirmation or clarification. When something is ambiguous, record the question and the interpretation you chose in this phase's artifact (in implement, a handoff Blocker labelled `[ambiguity]`) and proceed on it. Finish all the work this prompt authorizes before ending — acting on your own judgment never widens scope; the Affected Files cap and every other scope rule still bind. Always end by writing the phase artifact and running the phase command(s) listed at the end of this prompt, including when you recorded Blockers — a session that ends without them stalls the pipeline.
>
> If a project instruction file or other repository guidance tells you to ask the user or wait for approval before acting, there is no one to ask in this session: record the question in the phase artifact and continue with the authorized work.

Suggested branch-state replacement: "Branch state: the orchestrator manages it — do not fetch, pull, rebase, or push; read the working tree as-is."

Suggested scope-cap wording: "…do not make that edit. Record the gap in `handoff.md` under *Blockers* — the handoff is how it reaches a human — then finish the remaining in-scope work, the handoff, and the phase command. Do not silently expand scope."

### Interaction Dependencies

- **Resume stripping.** `toResumePrompt` strips `CODEX_STARTUP` by exact match of `\n\n${block}\n\n`. Changing the constant's content is safe because the pattern is built from the same constant. The surrounding blank lines in each template must stay as they are, and AC-7 pins that.
  - Resumed sessions therefore don't re-receive the headless paragraph. They already have it from the session's first turn.
- **Code review.** `code_review` reads `handoff.md` Blockers. A scope-gap or wrong-premise Blocker reaching review is the designed human-attention path, via the `spec_gap` verdict or findings.
- **Precedence line vs. adopter files.** The precedence line interacts with whatever adopter instruction files Codex auto-loads. It is deliberately limited to the ask/wait case so adopters' coding standards and conventions keep full force.

### Data Model Changes

None.

## Validation Required

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test` — full suite clean, run once without `UPDATE_GOLDENS` after regenerating
- [x] `npm run build` — `dist/` matches a fresh build
- [x] `npm run docs-refs-check`
- [x] `npm run sync-templates:check`
- [ ] E2E — N/A for this repo

## Docs Impact

- `docs/decisions.md`: new entry (AC-9).
- `docs/product-context.md`: Full-tier bullet pointer (AC-8).
- `docs/pipeline-orchestrator.md`: defaults table (AC-2).
- `docs/architecture.md`, `docs/codebase-map.md`, `docs/patterns.md`: no change expected.

## Known Risks

- **Bias-to-action overriding scope.** A literal model told to "finish all work" may widen scope to avoid leaving a Blocker. The paragraph must tie completion to *authorized* work and restate that the scope cap binds (AC-3c). Reviewers should read the final wording for any phrasing that reads as "do whatever it takes".
- **Over-broad precedence.** If the precedence line is worded as "this prompt overrides project instructions", Codex may ignore adopters' legitimate coding conventions. AC-4 restricts it to the ask/wait case.
- **Premature `done`.** Always running the phase command could let Codex mark implement `done` with a real Blocker the pipeline then reviews. That is the intended flow: pre-flight and `code_review` read the handoff, and `spec_gap` halts. It is strictly better than a stalled session, but it depends on reviewers actually reading Blockers.
- **Luna quality.** The coding regression is measured at max effort. Canon runs Luna at `medium`/`high`, where no public data exists. Mitigation: the AC-9 follow-up measurement and the env rollback.
- **Resume-strip whitespace.** `implement-reroute.md` renders `{{{startup}}}` followed by a single literal newline, and relies on the next block's leading newline. Adding a trailing newline inside `CODEX_STARTUP` would break stripping for that path. Keep the constant's leading and trailing edges unchanged; AC-7 covers the main paths.
- **Goldens regenerated blindly.** `UPDATE_GOLDENS=1` accepts any rendered change. Code review should diff the golden JSON and confirm that only the intended text changed.

## Human Test Plan

1. Start a small canon task without any Codex model override set, and watch the run.
2. Confirm the run's model log shows the new GPT-6 Luna model for spec review and implement, and GPT-6 Sol only for extra-large or delicate tasks.
3. Confirm the implement phase finishes on its own: it writes its handoff and moves to code review without stopping to ask a question.
4. Set the mini-model rollback setting back to the previous Luna model and start another run; confirm it uses the older model.
5. Expected: runs complete unattended on the new models, and the rollback setting still works.

---

## Spec Quality Checklist

- [x] Every AC states exactly how to verify it (not just "it works")
- [x] Affected Files lists specific files (not directories) with specific change descriptions
- [x] Plan steps (fast tier) reference actual function/file names from the codebase — N/A (full tier)
- [x] Known Risks covers failure modes for the trickiest ACs
- [x] Human Test Plan uses product language only (no code, no file names)
- [x] Validation Required has at least one entry marked `- [x]`
- [x] (Bug/flake fixes) — N/A: feature/default change, not a bug fix
