## Summary

- Fix a real counter-corruption bug: when a Codex `spec_review` crashed (out-of-credits, auth, network, MCP error) after exiting non-zero without finishing, `checkAndRoute()`'s recovery path read whatever verdict was still sitting in the shared review artifact from the *prior* round and advanced the phase as if the crashed round had actually been reviewed, inflating `iterations_current_loop`/`iterations_total`/`changes_requested_total` and risking a false auto-block on work that was never re-reviewed.
- `checkAndRoute()` now parks (actionable error + exit 2) on a non-zero-exit Codex `spec_review` *before* recovery runs — no verdict is read from disk, no counters move, and the futile one-shot retry is skipped. The park names the exit code, that no verdict was recorded, the likely recoverable causes, and the re-run command.
- Scoped tightly to Codex `spec_review`: a `spec_review` that reached `done` via its own bookkeeping, a clean-exit `spec_review` with a fresh verdict, and `code_review`/`plan`/`implement`/`qa` recovery are all unchanged.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

- This closes an actual incident: a reroute amendment review ran out of Codex credits on two consecutive attempts, each recording a phantom `changes_requested` from the prior round's verdict, pushing the loop counter to the auto-block cap before the revised work had ever been reviewed. Restoring credits and re-running produced a genuine review that approved on the first try — confirming the two intervening verdicts were pure crash artifacts.
- Deliberate tradeoff worth knowing about: a genuine verdict produced right before a non-zero exit (e.g. benign MCP shutdown noise) with skipped self-bookkeeping now parks for a manual re-run instead of auto-advancing like it used to. The old auto-advance for that case was never actually sound — there's no way to distinguish it from the crash case this PR fixes — so this is the fail-closed correction, at the cost of an occasional manual re-run in the rare benign case.
- General in-band "is this verdict fresh" checking (so that rare benign case could keep auto-advancing) is intentionally deferred — it would require first tightening the review-artifact parser to understand structural verdict sections, which is a bigger, separate change. Tracked in `docs/BACKLOG.md`.
- Docs updated: `docs/pipeline-orchestrator.md` (recovery behavior + rationale) and `docs/patterns.md` (new pitfall: a non-zero agent exit isn't a completed review).
- Code review (3 independent lenses) came back approved with nits — the one nit is cosmetic (a crashed review now logs its exit status twice, once from an existing generic line and once from the new park message) and wasn't addressed.
