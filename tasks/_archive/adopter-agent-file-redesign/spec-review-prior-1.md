# Spec Review: adopter-agent-file-redesign

> Reviewer: Codex | Spec: `tasks/adopter-agent-file-redesign/spec.md`

## Shape Check

no concerns

## Feasibility Check

- [ ] Affected files exist and contain what the spec assumes
- [ ] Proposed patterns are consistent with existing conventions
- [ ] No conflicts with existing functionality

## Issues Found

### Correctness Issues

- [BLOCKING] `README.md:225` still says `canon upgrade` "does not touch adopter-owned `AGENTS.md` or `CLAUDE.md`." The revised spec names `README.md:106`, `:108`, `:19`, and `:305`, plus the discovery-nudge/recommendation shape, but it never calls out this command-table row in AC-1, AC-2, or the README Affected Files entry (`tasks/adopter-agent-file-redesign/spec.md:41-43,59`). Because `README.md` is in the structural grep scope, this live token-bearing line will still fail AC-1 unless it is explicitly allow-listed or rewritten.

### Missing Edge Cases

- [NIT] `docs/patterns.md`'s Affected Files entry still cites `:62` and `:63`, but the current `AGENTS.md`/`CLAUDE.md` hits in that file are at `:12`, `:56`, `:101`, `:192`, and `:193`. The extra line numbers are stale and could send the implementer to the wrong neighborhood.

### Type Safety / Interface Gaps

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [ ] **Approved with nits** — implementable, but noting observations for plan phase
- [x] **Changes requested** — spec must be revised before plan phase (list items above)
