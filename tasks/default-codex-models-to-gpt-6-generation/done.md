# Done: default-codex-models-to-gpt-6-generation

## Summary

Canon's shipped Codex model defaults move from the 5.6 generation to GPT-6 (`gpt-6-luna` for mini-tier work, `gpt-6-sol` for full-tier), triggered by OpenAI's 2026-09-22 GPT-6 release. Alongside the version bump, canon's shared Codex startup prompt now tells Codex explicitly that pipeline sessions are headless: don't stop to ask a clarifying question, record ambiguity as a Blocker in the phase artifact and proceed, finish all authorized work, and always end by writing the artifact and running the phase command — even when a Blocker was recorded. Three prompt instructions that said "stop" in a way a literal model could misread as "end the session" now say clearly "don't make that edit, record the Blocker, and keep going." A dead "branch sync" instruction (with `git fetch`/`git pull` commands) is replaced with a plain statement that the orchestrator owns branch state. Stale references to the retired "5.6-generation" naming were updated across docs, and a new dated entry in `docs/decisions.md` records the re-baseline, the rejected GPT-6 Astra option, the Luna cost/quality trade-off with its follow-up measurement plan, and the prompt-hardening outcome.

## Files Changed

- `src/orchestrator/env.ts`, `src/orchestrator/policy.ts` — Codex mini/full fallback defaults → `gpt-6-luna` / `gpt-6-sol`.
- `src/orchestrator/prompts/helpers.ts` — `CODEX_STARTUP`: added the headless/bias-to-action paragraph and the narrow ask/approval precedence line; replaced the dead branch-sync sentence.
- `src/orchestrator/prompts/templates/implement.md` — reworded Scope Discipline rule 1 and the Bug/Flake-Fix Red-First Checkpoint's "stop" instruction.
- `src/orchestrator/prompts/templates/implement-revisions.md` — reworded the red-first "stop" bullet.
- `src/lib/pipeline-policy.ts` — `codexMatrix` comment now points at the GPT-6-generation re-eval instead of "5.6-generation."
- `tests/run-task-prompts.test.ts` — new resume-stripping test covering `promptSpecReview`, fresh `promptImplement`, and `promptImplementRevisions`.
- `tests/run-task-prompts.golden.json` — regenerated prompt snapshots.
- `dist/cli/index.js`, `dist/orchestrator/run-task.js` — rebuilt bundles.
- `docs/pipeline-orchestrator.md`, `templates/docs/pipeline-orchestrator.md` — Codex model override table shows the GPT-6 defaults.
- `docs/product-context.md` — Full-tier bullet now points at the GPT-6 re-eval and the new decisions.md entry.
- `docs/decisions.md` — new dated "Model-generation re-baseline (2026-09)" entry.

## How to Test

1. Start a small canon task without setting `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL`, and watch the run.
2. Confirm the run's model log shows GPT-6 Luna for spec review and implement on XS–L tasks, and GPT-6 Sol only for extra-large or delicate tasks.
3. Confirm the implement phase finishes on its own — it writes its handoff and moves to code review without stopping to ask a question mid-session.
4. Set `CODEX_MODEL_MINI=gpt-5.6-luna` (and `CODEX_MODEL_FULL=gpt-5.6-sol` if needed) and start another run; confirm it uses the older model, proving the rollback path still works.

## Test Results

| Check | Result | Notes |
|---|---|---|
| `npm run lint` | Pass | |
| `npm run type-check` | Pass | |
| `npm run docs-refs-check` | Pass | All refs OK. |
| `npm run sync-templates:check` | Pass | All canon-managed files in sync. |
| `UPDATE_GOLDENS=1 npm test` | Pass | 1,222 passed, 1 skipped; regenerated prompt snapshots. |
| `npm test` | Pass | 1,222 passed, 1 skipped. |
| `npm run build` | Pass | Fresh build updated both declared bundles with no drift. |
| E2E | not_configured | Spec explicitly marks E2E N/A for this repo. |

Code review (`review.md`): **Approved with nits** — Stage 1 (spec compliance) passed all 10 ACs; Stage 2 found one cosmetic nit (an unintended 3-space indent on the reworded red-first bullet in `implement-revisions.md:43`, nesting it under an unrelated bullet) with no correctness, risk, or spec-gap findings across the anchored, cold-Claude, and cold-Codex lenses.

## Human Verification Required

None.

**Handoff Validation pre-merge checklist:**
- [ ] Version correct (per project policy — decided at release, not here; this task is scoped as a **minor** default change per `docs/decisions.md` §"Versioning and release policy")
- [ ] Changelog updated if needed (draft below; final entry + version decided at release)
- [ ] PR body current
- [ ] Final CI/CD checks green
- [ ] Final diff matches spec intent

## Decisions Made During Implementation

- Updated the pre-existing structural test assertion in `tests/run-task-prompts.test.ts` that pinned the old `git pull --rebase` branch-sync text, since AC-5 required removing that text; the new assertion pins the replacement branch-state instruction instead (documented as a deviation in `handoff.md`, no AC impact).
- The Stage 2 nit (indentation slip in `implement-revisions.md:43`) was left unaddressed by the pipeline — approved-with-nits explicitly permits shipping without fixing optional cleanup items. It's a cosmetic markdown-structure issue only; the model reads the prompt as plain text, not rendered HTML, so functional risk is low.

## Open Questions Needing Human Input

- None blocking. The AC-9 decisions.md entry commits to a follow-up measurement (compare M/L `code_review` reroute rate and iteration counts on GPT-6 vs. the 5.6-era baseline via `docs/task-quality-log.md`) — that measurement is future work, not something this task or QA can complete now.

## Proposed Changelog

### Changed

- **Canon's shipped Codex model defaults move to the GPT-6 generation.** Adopters who don't set `CODEX_MODEL_MINI` / `CODEX_MODEL_FULL` now get `gpt-6-luna` (mini) and `gpt-6-sol` (full) instead of the 5.6-generation models — both cheaper per token, with Sol also improving on coding benchmarks. Effort tiers and env-var override chains are unchanged; set `CODEX_MODEL_MINI=gpt-5.6-luna` / `CODEX_MODEL_FULL=gpt-5.6-sol` to roll back.
- **Canon's Codex prompts now state explicitly that pipeline sessions are headless.** Codex no longer ends a phase early to ask a clarifying question; it records the ambiguity as a Blocker in the phase artifact and finishes the authorized work instead. Three prompt instructions that used the word "stop" in a way that could be misread as "end the session" now read as "don't make that edit, record the Blocker, and keep going."

## Quality Log
- Spec verdict: approved_with_nits
- Human reroute?: No
- Dropped ACs: 0
- Validation gaps: 0
- Notes: Clean single-iteration run through spec_review and code_review; only surviving finding was a cosmetic markdown-nesting nit, shipped as-is per approved-with-nits.
