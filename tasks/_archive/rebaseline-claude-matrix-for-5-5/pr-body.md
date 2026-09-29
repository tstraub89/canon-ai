## Summary

- Re-baseline canon's Claude model/effort matrix for the 5.5 generation: replace the old five-column, per-phase table with two tiers — *light* (Sonnet) for XS/S and *strong* (Opus) for M and above — capped at `high` effort everywhere (no more `xhigh`), with `qa` staying on the light model at `medium` regardless of size.
- Add `CLAUDE_MODEL_LIGHT` / `CLAUDE_MODEL_STRONG` env vars to override each tier's model independent of the existing per-phase pins and the legacy `CLAUDE_MODEL` catch-all; document the full precedence order.
- Remove a dead, duplicate copy of the policy-resolution logic from `src/orchestrator/env.ts` so `src/orchestrator/policy.ts` is the single resolver for Claude model/effort config.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` changed)

## Notes

- A pin now replaces only the model, never the effort — effort always comes from the size/tier cell. If you're pinning `CLAUDE_MODEL_REVIEW` or `CLAUDE_MODEL_PLAN` to a specific model today, your M/L review or plan effort drops from `high` to `medium` after this lands. That's intentional (see `docs/decisions.md` "Model-generation re-baseline (2026-09): Claude defaults → 5.5 generation"), not a regression.
- Budget caps for plan/review are unchanged even though M/L now runs Opus at medium (pricier per call than the old Sonnet high). Watch invocation costs after this ships; `CLAUDE_BUDGET` is the escape hatch if a phase starts hitting its cap.
- `dist/cli/index.js` changed too, even though this is a policy/env change — it imports the same `env.ts` module that lost its duplicate config block. Verified the committed bundle matches a fresh `npm run build` byte-for-byte.
- Two small precedence-pair combinations (e.g. a phase pin coexisting with the legacy `CLAUDE_MODEL` var) aren't separately asserted in the test suite, though the resolver logic itself is exercised and correct for them. Flagged as optional follow-up, not a blocker.
