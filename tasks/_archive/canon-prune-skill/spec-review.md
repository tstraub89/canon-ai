# Spec Review: canon-prune-skill

> Reviewer: Codex | Spec: `tasks/canon-prune-skill/spec.md`

## Shape Check

No concerns. The spec addresses a real maintenance gap: `docs/lessons-learned.md` describes `/canon-sweep` as the human-run inflow process, while no corresponding process reviews the permanent docs after promotion. The proposed skill is appropriately human-invoked and puts per-rule edits behind approval. The adopter experiment supports gist inventories for cross-doc discovery, with source-text confirmation before merges.

## Feasibility Check

- [x] Affected files exist and contain what the spec assumes
- [x] Proposed patterns are consistent with existing conventions
- [x] No conflicts with existing functionality

## Issues Found

### Correctness Issues

None.

### Missing Edge Cases

- **Nit — AC-10:** The plan should define how a “Reviewed and kept” row is identified across runs and what evidence changes make it eligible for re-proposal. The commit body is the only record, but the spec does not require a stable locator or comparison rule. For example, matching by document path plus rule heading/gist and rechecking the listed evidence would make the skip behavior implementable; matching only by prose could miss a renamed rule or treat a wording edit as a new rule. This affects whether AC-10 suppresses unchanged rows without hiding changed evidence. The plan can settle the identifier and comparison procedure.

### Type Safety / Interface Gaps

None.

## Verdict

- [ ] **Approved** — spec is implementable as written
- [x] **Approved with nits** — implementable, but noting observations for plan phase
- [ ] **Changes requested** — spec must be revised before plan phase
