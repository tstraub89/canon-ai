## Summary

- Bump canon's shipped Codex defaults from the 5.6 generation to GPT-6 (`gpt-6-luna` mini / `gpt-6-sol` full), following OpenAI's 2026-09-22 release — both cheaper per token, Sol also better on coding benchmarks.
- Harden the shared Codex startup prompt and three implement-phase instructions so headless pipeline runs don't stall on a clarification question: Codex now records ambiguity as a handoff Blocker and keeps going instead of ending the session.
- Replace a dead branch-sync instruction (with stale `git fetch`/`git pull` commands) with a plain statement that the orchestrator owns branch state.
- Update stale "5.6-generation" doc references and add a dated `docs/decisions.md` entry covering the re-baseline, the rejected GPT-6 Astra option, the Luna cost/quality trade-off, and the prompt-hardening outcome.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- This is a **minor** canon-supplied-default change per `docs/decisions.md` §"Versioning and release policy" — env-var override chains and effort-tier routing are unchanged, only the two fallback model strings move. Rollback: set `CODEX_MODEL_MINI=gpt-5.6-luna` / `CODEX_MODEL_FULL=gpt-5.6-sol`.
- Luna is a genuine trade-off, not a strict upgrade: it's ~60% cheaper per task but regresses slightly on public coding benchmarks (measured at max effort; canon runs it at medium/high, where no public data exists for this comparison). Canon routes every XS–L phase through Luna, so this lands on most runs. A follow-up is committed in `docs/decisions.md`: compare M/L `code_review` reroute rate and iteration counts on GPT-6 against the 5.6-era baseline via `docs/task-quality-log.md`.
- Added a new test asserting `toResumePrompt` strips the updated startup block from spec-review, fresh-implement, and implement-revisions prompts and that resumed output starts with the `[Resumed session` banner.
- Code review flagged one cosmetic nit (an unintended indent on a reworded bullet in `implement-revisions.md`) and approved with nits; left as-is since it's a plain-text prompt, not rendered markup, so it carries no functional risk.
