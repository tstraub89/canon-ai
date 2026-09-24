# Done: default-codex-models-to-gpt-6-generation

## Summary

Canon's shipped Codex model defaults move from the 5.6 generation to GPT-6 (`gpt-6-luna` for mini-tier work, `gpt-6-sol` for full-tier), triggered by OpenAI's 2026-09-22 GPT-6 release. Alongside the version bump, canon's Codex prompts now tell Codex explicitly that a **non-interactive** pipeline session is headless: don't stop to ask a clarifying question, record ambiguity as a Blocker in the phase artifact and proceed, finish all authorized work, and always end by writing the artifact and running the phase command — even when a Blocker was recorded. That headless guidance was originally added to the shared `CODEX_STARTUP` block (received by every session, including `canon run --interactive`), but a human-approved reroute during implementation caught that this made false claims to an operator-present interactive session and told Codex to bypass ask-first/approval requirements an operator specifically chose interactive mode to keep. The fix moved that content into a new `CODEX_HEADLESS` block that `runCodex` prepends only on non-interactive invocations (fresh and resumed), never on interactive ones. Three prompt instructions that said "stop" in a way a literal model could misread as "end the session" now say clearly "don't make that edit, record the Blocker, and keep going." A dead "branch sync" instruction (with `git fetch`/`git pull` commands) is replaced with a plain statement that the orchestrator owns branch state. Stale references to the retired "5.6-generation" naming were updated across docs, and a dated entry in `docs/decisions.md` records the re-baseline, the rejected GPT-6 Astra option, the Luna cost/quality trade-off with its follow-up measurement plan, the prompt-hardening outcome, and the interactive/non-interactive scoping.

## Files Changed

- `src/orchestrator/env.ts`, `src/orchestrator/policy.ts` — Codex mini/full fallback defaults → `gpt-6-luna` / `gpt-6-sol`.
- `src/orchestrator/prompts/helpers.ts` — added the exported `CODEX_HEADLESS` block (headless/bias-to-action paragraph + narrow ask/approval precedence line); `CODEX_STARTUP` keeps only the replaced branch-state sentence.
- `src/orchestrator/agents/codex.ts` — `runCodex` prepends `CODEX_HEADLESS` to the rendered prompt only when the invocation is non-interactive (fresh or resumed); interactive invocations, including `--interactive`/`-I`, never receive it.
- `src/orchestrator/prompts/templates/implement.md` — reworded Scope Discipline rule 1 and the Bug/Flake-Fix Red-First Checkpoint's "stop" instruction.
- `src/orchestrator/prompts/templates/implement-revisions.md` — reworded the red-first "stop" bullet.
- `src/lib/pipeline-policy.ts` — `codexMatrix` comment now points at the GPT-6-generation re-eval instead of "5.6-generation."
- `tests/run-task-prompts.test.ts` — resume-stripping test covering `promptSpecReview`, fresh `promptImplement`, and `promptImplementRevisions`; structural assertions that `CODEX_STARTUP` and `CODEX_HEADLESS` stay separated.
- `tests/run-task-code-review.test.ts` — fake-executable coverage asserting `runCodex` includes `CODEX_HEADLESS` on fresh and resumed non-interactive calls and omits it on interactive calls.
- `tests/run-task-prompts.golden.json` — regenerated prompt snapshots; no headless text remains in template-render goldens.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles.
- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` — Codex model override table shows the GPT-6 defaults.
- `docs/product-context.md` — Full-tier bullet now points at the GPT-6 re-eval and the new decisions.md entry.
- `docs/decisions.md` — new dated "Model-generation re-baseline (2026-09)" entry, including the amendment's interactive/non-interactive scoping.
- `docs/pipeline-invocations.md`, `docs/task-quality-log.md` — pipeline run log entries written automatically by the orchestrator during this task's phases (not hand-edited).

## How to Test

1. Start a small canon task without setting `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL`, and watch the run.
2. Confirm the run's model log shows GPT-6 Luna for spec review and implement on XS–L tasks, and GPT-6 Sol only for extra-large or delicate tasks.
3. Confirm the implement phase finishes on its own — it writes its handoff and moves to code review without stopping to ask a question mid-session.
4. Start an `canon run --interactive` (`-I`) session and confirm the prompt still reads as operator-present (no "nobody reads your messages" framing) — interactive mode keeps ask-first/approval behavior.
5. Set `CODEX_MODEL_MINI=gpt-5.6-luna` (and `CODEX_MODEL_FULL=gpt-5.6-sol` if needed) and start another run; confirm it uses the older model, proving the rollback path still works.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `UPDATE_GOLDENS=1 npm test` | Pass | 1,223 passed, 1 skipped; regenerated prompt snapshots. |
| `npm test` | Pass | 1,223 passed, 1 skipped (code review's own run saw 1,224/0 skipped — an environment-dependent `gitDirWritable`-gated skip, not a regression; see Decisions below). |
| `npm run build` | Pass | Fresh build updated both declared bundles with no drift. |
| E2E | not_configured | Spec explicitly marks E2E N/A for this repo. |

Code review (`review.md`), final round: **Approved with nits** — Stage 1 (spec compliance) passed all 13 ACs (AC-1–10 plus the amendment's AC-11–13), including verifying that `CODEX_HEADLESS` is correctly gated to non-interactive `runCodex` calls. Stage 2 (anchored Claude + cold-Claude + cold-Codex lenses) found no correctness bugs, guardrail violations, or spec gaps — only two low-severity test-fragility nits (a substring-based argv selector in the new `runCodex` test, and a regex-scoped structural assertion tied to incidental formatting rather than a named export boundary), left unaddressed per approved-with-nits.

## Human Verification Required

None.

**Handoff Validation pre-merge checklist:**
- [ ] Version correct (per project policy — decided at release, not here; this task is scoped as a **minor** default change per `docs/decisions.md` §"Versioning and release policy")
- [ ] Changelog updated if needed (draft below; final entry + version decided at release)
- [ ] PR body current
- [ ] Final CI/CD checks green
- [ ] Final diff matches spec intent

## Decisions Made During Implementation

- **Amendment (human-approved reroute, round 1).** The original design put the headless/bias-to-action paragraph and the ask/approval precedence line inside `CODEX_STARTUP`, which every Codex session receives, including `canon run --interactive`. That falsely told an operator-present interactive session "nobody reads your messages" and told it to bypass ask-first/approval requirements — the main reason an operator picks interactive mode. The reroute moved that content into a separate `CODEX_HEADLESS` block that `src/orchestrator/agents/codex.ts`'s `runCodex` prepends only on non-interactive invocations, fresh or resumed, added after resume-prompt wrapping so `retryAgentForPhase`'s non-interactive calls inherit it automatically without a separate call-site change.
- Updated the pre-existing structural test assertion in `tests/run-task-prompts.test.ts` that pinned the old `git pull --rebase` branch-sync text, since AC-5 required removing that text; the new assertion pins the replacement branch-state instruction instead (documented as a deviation in `handoff.md`, no AC impact).
- The two Stage-2 test-fragility nits (substring-based argv matching in the new `runCodex` test; a regex-scoped structural assertion) were left unaddressed by the pipeline — approved-with-nits explicitly permits shipping without fixing optional cleanup items. Both are test-robustness concerns, not production-code or coverage gaps.

## Open Questions Needing Human Input

- None blocking. The `docs/decisions.md` entry commits to a follow-up measurement (compare M/L `code_review` reroute rate and iteration counts on GPT-6 vs. the 5.6-era baseline via `docs/task-quality-log.md`, using each log row's date against this entry's landing date to draw the cohort boundary) — that measurement is future work, not something this task or QA can complete now.

## Proposed Changelog

### Changed

- **Canon's shipped Codex model defaults move to the GPT-6 generation.** Adopters who don't set `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL` now get `gpt-6-luna` (mini) and `gpt-6-sol` (full) instead of the 5.6-generation models — both cheaper per token, with Sol also improving on coding benchmarks. Effort tiers and env-var override chains are unchanged; set `CODEX_MODEL_MINI=gpt-5.6-luna` / `CODEX_MODEL_FULL=gpt-5.6-sol` to roll back.
- **Non-interactive Codex pipeline sessions now know they're headless.** Codex no longer ends a phase early to ask a clarifying question in a detached `canon run`; it records the ambiguity as a Blocker in the phase artifact and finishes the authorized work instead. Three prompt instructions that used the word "stop" in a way that could be misread as "end the session" now read as "don't make that edit, record the Blocker, and keep going." `canon run --interactive` sessions are unaffected — they keep the operator-present prompt and ask-first behavior.

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: One human-approved implement-phase reroute (round 1) corrected a spec design flaw (headless text leaking into interactive sessions) via amendment AC-11–13; code review then approved all 13 ACs with nits (two test-fragility items, no correctness/risk/spec-gap findings).
