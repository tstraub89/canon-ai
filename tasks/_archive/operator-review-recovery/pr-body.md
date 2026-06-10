## Summary

- Add two audited operator-recovery paths for agent review disagreements: `canon run --reroute` from a `code_review` `spec_gap` block (previously only from `human_review`), and `canon task accept <ids> spec_review|code_review --reason "<why>"` to sanction a review with a mandatory written reason and `sanctioned` verdict
- New `sanctioned` verdict routes as an advance (spec_review → plan; code_review → qa) but is legible as an operator override in `status.json`; mintable only via `canon task accept --reason`, so the `operator_accepted*` + `notes.md` audit trail is guaranteed
- Rewrites the spec_gap recovery block (console + persisted escalation reason) to present only the two audited paths; removes the old `canon task phase … code_review pending` / `… done approved` recommendation; both paths name the full blocked-bundle IDs so no sibling is stranded

## Validation

- [x] `npm run lint`
- [x] `npm run type-check`
- [x] `npm test`
- [x] `npm run docs-refs-check`
- [x] `npm run build` (rebuilt `dist/cli/index.js` and `dist/scripts/run-task.js`)

## Notes

The fix path relaxes `rerouteFromHumanReview`'s entry predicate to also accept the case where every task in the invocation is `code_review blocked` and at least one carries `spec_gap`. The existing reset loop already covers every task in the bundle, so no new reset logic was needed — the change is purely in the entry guard and in the stale-sanction clearing that was added alongside it.

The bless path is a distinct branch in `taskAccept` that deliberately skips the implement-only guards (non-empty diff, handoff coverage, SHA-pin-to-skip-auto-commit) — those guards exist to protect the auto-commit step, which doesn't exist on review phases.

In a mixed blocked bundle, the bless path preserves a sibling that already carried `approved`/`approved_with_nits` — it is unblocked but not relabeled as a sanction. The fix path discards every member's verdict (the tree is re-implemented), so there is no verdict to preserve on that side.

`sanctioned` is absent from `extractCheckedVerdict` by design — it is status-only and never written into a review artifact, so teaching the artifact parser to recognize it would be dead, misleading code.
