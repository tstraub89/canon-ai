## Summary

- Bump canon's shipped Codex defaults from the 5.6 generation to GPT-6 (`gpt-6-luna` mini / `gpt-6-sol` full), following OpenAI's 2026-09-22 release — both cheaper per token, Sol also better on coding benchmarks.
- Add a headless/bias-to-action block so a non-interactive pipeline run doesn't stall on a clarification question: Codex now records ambiguity as a handoff Blocker and keeps going instead of ending the session. This block is gated to non-interactive `runCodex` calls only — `canon run --interactive` sessions keep the operator-present prompt and ask-first behavior unchanged.
- Reword three implement-phase instructions that used "stop" in a way a literal model could misread as "end the session" so they clearly mean "don't make that edit, record the Blocker, and keep going."
- Replace a dead branch-sync instruction (with stale `git fetch`/`git pull` commands) with a plain statement that the orchestrator owns branch state.
- Update stale "5.6-generation" doc references and add a dated `docs/decisions.md` entry covering the re-baseline, the rejected GPT-6 Astra option, the Luna cost/quality trade-off, the prompt-hardening outcome, and the interactive/non-interactive scoping.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- This is a **minor** canon-supplied-default change per `docs/decisions.md` §"Versioning and release policy" — env-var override chains and effort-tier routing are unchanged, only the two fallback model strings move. Rollback: set `CODEX_MODEL_MINI=gpt-5.6-luna` / `CODEX_MODEL_FULL=gpt-5.6-sol`.
- Luna is a genuine trade-off, not a strict upgrade: it's ~60% cheaper per task but regresses slightly on public coding benchmarks (measured at max effort; canon runs it at medium/high, where no public data exists for this comparison). Canon routes every XS–L phase through Luna, so this lands on most runs. A follow-up is committed in `docs/decisions.md`: compare M/L `code_review` reroute rate and iteration counts on GPT-6 against the 5.6-era baseline via `docs/task-quality-log.md`.
- The first implementation put the headless guidance in the shared `CODEX_STARTUP` block, which every Codex session receives, including interactive ones — that was wrong, since it told an operator-present interactive session "nobody reads your messages" and told it to bypass the ask-first/approval requirements interactive mode exists to preserve. Caught during review and fixed by moving that guidance into a separate block that's only prepended on non-interactive invocations (fresh and resumed); this is the version that shipped.
- Added test coverage asserting `toResumePrompt` strips the updated startup block correctly, and that the new headless block reaches fresh and resumed non-interactive `runCodex` calls but never an interactive one.
- Code review (three independent lenses) approved with two low-severity test-fragility nits — no correctness, guardrail, or spec-gap findings. Left as-is per approved-with-nits.
