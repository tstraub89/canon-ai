## Summary

- Restructured `code_review` into a synthesis foreman that spawns two isolated review lenses in parallel: an anchored lens (spec + Stage 1/2 charter, unchanged from today's review) and a cold lens (diff only, no spec context). The foreman deduplicates findings, resolves cold-lens calls that the spec explains as intended, classifies each surviving finding as code-bug or spec-gap, and writes the single `review.md` + verdict.
- Added `spec_gap` verdict: when the root cause is a missing or wrong requirement, `code_review` halts for human amendment instead of rerouting to implementation. Wired across all seven verdict surfaces (type union, runtime validator, CLI help, status.json template, extraction regex, review.md template, routing intercept).
- New `.claude/agents/code-review-anchored.md` and `code-review-cold.md` lens definitions are canon-owned and ship to adopters via `canon upgrade`.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`)

## Notes

- The `code_review` phase session becomes the foreman — it spawns `.claude/agents/code-review-anchored.md` and `.claude/agents/code-review-cold.md` as sub-agents and performs dedup + cold-vs-spec reconciliation + altitude classification in its own reasoning (no Node synthesis layer in this MVP). Automated tests cover the deterministic Node surface: verdict plumbing, `spec_gap` routing + no-qa-advance, phase-level fail-loud, and the foreman prompt contract. Synthesis quality (dedup accuracy, altitude calls) is validated via the Human Test Plan on a real task.
- `scripts/run-task/phases/code-review.ts` was not modified: the foreman is purely prompt-driven and the existing single-`claude -p` dispatch already provides the right shell. The `code-review-round-1.md` / `-round-n.md` prompt templates are retained (with charter-reference comments) but are no longer dispatched for direct review.
- Cold-lens isolation is prompt-enforced at injection (the foreman never passes spec content to the cold lens). A `tools:` allow-list would harden it further if a leak is ever observed in practice.
- Before relying on the new gate: run HTP steps 2 (`spec_gap` halt on a spec-wrong task) and 6 (fail-loud on a broken foreman return), and confirm lens model tier (opus on a delicate task) on the first real exercise.
