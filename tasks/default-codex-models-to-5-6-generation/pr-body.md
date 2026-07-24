## Summary

- Bump canon's shipped Codex model defaults from the retired `gpt-5.4-mini`/`gpt-5.5` to the current `gpt-5.6-luna`/`gpt-5.6-sol`, in both duplicated config copies (`scripts/run-task/env.ts`, `scripts/run-task/policy.ts`) — no other change to routing, effort tiers, or override env-var names/precedence.
- Update every current-state operator-facing surface that named the retired models (env-var reference table, effort-rationale prose in `docs/pipeline-orchestrator.md` and `docs/product-context.md`, a code comment in `scripts/pipeline-policy.ts`) so nothing presents an old model as canon's current default, without asserting any new, unverified claim about 5.6 behavior.
- Add a dated `docs/decisions.md` entry recording the re-baseline and explicitly reconciling it with an earlier caution against chasing a model upgrade to paper over review-quality churn — this is a routine currency bump, not that.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuild + commit `dist/` if `src/` or `scripts/run-task/` changed)

## Notes

- Historical records, telemetry rows, and incidental test fixtures that also happen to contain the retired model strings were left untouched by design — the spec classified them into an explicit permitted-to-remain bucket, verified via a fresh repo-wide grep with zero hits on all current-state surfaces.
- Code review (anchored Claude + cold Claude + cold Codex lenses) converged Approved with nits: no correctness bugs, no risk findings, no spec gaps. The one nit is cosmetic — the reframed rationale prose uses three slightly different phrasings for the same fact across four surfaces; non-blocking.
- `spec_review` converged in 2 rounds; round 1 caught two genuine spec defects (an overreaching byte-identical AC and an AC that contradicted its own allowlist), both fixed in the spec before implementation started.
- The two config objects in `env.ts`/`policy.ts` remain intentionally non-identical beyond the two Codex default lines — `env.ts` legitimately carries extra fields and a different field order.
- Follow-ups intentionally out of scope: re-evaluating effort tiers for the 5.6 generation, and a cosmetic pass to unify the three rationale-prose phrasings (code review nit).
