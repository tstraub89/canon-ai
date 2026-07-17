# Spec Review: allow-comma-separated-multipath-cells

> Reviewer: Codex | Spec: `tasks/allow-comma-separated-multipath-cells/spec.md`

## Shape Check

> Strategic read of the spec itself — does it solve the right problem in the right shape? **Silence is the default**; only write here if something is actually off. A concern here is the lead reason for a `changes_requested` verdict.

- Is the problem real? (Would doing nothing be fine? Is this a symptom of something else?)
- Is the framing right? (Does the spec solve the stated problem, or one adjacent to it?)
- Is there a materially simpler solution that changes the shape of the work?
- Is the AC decomposition right? (Compound ACs, missing ACs, ACs solving symptoms not causes?)

(no concerns)

## Feasibility Check

Does the spec's approach work against the actual codebase?

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

> Things the spec gets wrong about the current codebase.

- **[Non-blocking nit] Treat the BACKLOG text as resolved historical context,
  not a still-open problem.** `docs/BACKLOG.md:47` marks the multi-table item
  resolved and states that `parseAllTablesH3` superseded it; the current
  `parseAffectedFilesFromSpec` also calls `parseAllTablesH3`. The spec instead
  calls that entry's multi-table problem "still-open" / "open" in AC-9, its
  Affected Files row, and Known Risks. The planned edit remains implementable,
  but the plan should preserve the checked/resolved outcome and put the three
  cell-format statements into accurate historical tense while removing the
  retired one-path guidance.

### Missing Edge Cases

> Scenarios the spec doesn't account for.

- **[Non-blocking nit] Pin the generic markdown-link path through the new
  tokenizer.** The Decision allows the trailing annotation after either token
  kind, and the current parser accepts `[a.ts](a.ts) note`; a link destination
  may also contain a comma without that comma being a list separator. AC-2
  covers balanced parentheses in a two-link list, while AC-3 covers annotation
  and comma handling only with a backtick token. During implementation, add one
  compact regression such as
  `[a.ts](https://example.test/a,b), [b.ts](b.ts) note` so both stated grammar
  properties stay token-kind-independent.

### Type Safety / Interface Gaps

> Type mismatches, missing interfaces, or signature errors.

(none)

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase (list items above)
