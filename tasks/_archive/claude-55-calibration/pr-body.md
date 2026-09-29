## Summary

- Fix a contradiction in the code-review foreman prompt where a clean lens return was called a bug — a literal model reading that line could treat a legitimate clean review as a failure.
- Give unattended Claude phases an explicit "no one will answer" contract (the Claude counterpart to Codex's existing headless preamble), so a phase doesn't end early on a progress summary or wait for approval that will never come.
- Bound the code-review foreman's delegation to its two prescribed lenses plus one re-spawn of a missing return, and add real routing: if a reviewer honestly can't produce a verdict twice, the whole run stops for a human instead of being pushed toward a fabricated one.
- Add a proportional feasibility check to the planning prompts (confirm code exists, trace the real path, name callers, state what makes each new test fail, check boundary values), based on a read-only audit of 422 archived tasks showing plans account for a large share of changes-requested findings.

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt + committed `dist/`)
- [x] `npm run sync-templates:check`

## Notes

- Code review verdict: approved with nits. Remaining items are optional wording/ordering cleanups (foreman re-spawn phrasing, a step-order nit in `plan-reroute.md`) and a documented follow-up: a narrow, unlikely two-event sequence where a foreman's turn could still end between writing a no-verdict review and marking it `blocked`, leaving the old retry pressure in place for that one case. None of this blocks shipping.
- The plan feasibility check deliberately doesn't reach two plan-writing surfaces (the operator-run XS path and `spec-revision.md`'s combined plan-update line) — that's a scoped Non-Goal, not a gap, and a dedicated plan-review phase is tracked separately in #68.
- This only changes prompts, routing logic, and templates — no changes to verdict rules, finding categories, or which three lenses review each round.
- Goldens regenerated; only the seven prompt keys touched by this change moved, everything else is byte-identical.
